import { describe, expect, it, vi } from 'vitest'
import { IPC_ARGS_HEADER, IPC_CHUNK_BYTES, encodeIpcArgs, invokeChunked, ipcError } from './ipc'
import type { InvokeFn } from './ipc'

interface Call {
  cmd: string
  body: number[]
  args: Record<string, unknown>
  headerValue: string
}

/** Подставной invoke: записывает вызовы, отвечает номером части; fail(i) — отказ на i-й части. */
function recorder(fail?: (index: number) => unknown) {
  const calls: Call[] = []
  const invokeFn: InvokeFn = async <T>(
    cmd: string,
    args?: Record<string, unknown> | Uint8Array,
    options?: { headers: Record<string, string> },
  ) => {
    const index = calls.length
    const headerValue = options?.headers[IPC_ARGS_HEADER] ?? ''
    calls.push({
      cmd,
      body: Array.from(args as Uint8Array),
      args: JSON.parse(decodeURIComponent(headerValue)) as Record<string, unknown>,
      headerValue,
    })
    const failure = fail?.(index)
    if (failure !== undefined) throw failure
    return { part: index } as T
  }
  return { calls, invokeFn }
}

const bytes = (n: number): Blob => new Blob([Uint8Array.from({ length: n }, (_, i) => i + 1)])

describe('encodeIpcArgs', () => {
  it('даёт ASCII-значение, которое декодируется обратно', () => {
    const args = { dir: 'D:\\Резервные копии\\QuickDrop', fileName: 'a b.json', offset: 0, last: true }
    const encoded = encodeIpcArgs(args)
    expect(encoded).toMatch(/^[\x21-\x7e]+$/)
    expect(JSON.parse(decodeURIComponent(encoded))).toEqual(args)
  })
})

describe('ipcError', () => {
  it('строка из Rust становится Error с тем же текстом', () => {
    const e = ipcError('Папка не подтверждена: выберите её заново в настройках', 'запасной')
    expect(e).toBeInstanceOf(Error)
    expect(e.message).toBe('Папка не подтверждена: выберите её заново в настройках')
  })

  it('Error возвращается как есть', () => {
    const original = new Error('исходная')
    expect(ipcError(original, 'запасной')).toBe(original)
  })

  it('иное значение даёт запасной текст', () => {
    for (const value of [undefined, null, 42, { message: 'x' }, '', '   ']) {
      expect(ipcError(value, 'запасной').message).toBe('запасной')
    }
  })
})

describe('invokeChunked', () => {
  it('размер части по умолчанию — 8 МиБ', () => {
    expect(IPC_CHUNK_BYTES).toBe(8 * 1024 * 1024)
    expect(IPC_ARGS_HEADER).toBe('x-qd-args')
  })

  it('пустой blob — один вызов с пустым телом', async () => {
    const { calls, invokeFn } = recorder()
    const result = await invokeChunked<{ part: number }>(invokeFn, 'save_backup', { dir: 'D:\\x' }, new Blob([]))
    expect(result).toEqual({ part: 0 })
    expect(calls).toHaveLength(1)
    expect(calls[0].cmd).toBe('save_backup')
    expect(calls[0].body).toEqual([])
    expect(calls[0].args).toEqual({ dir: 'D:\\x', offset: 0, last: true })
  })

  it('blob меньше части — один вызов', async () => {
    const { calls, invokeFn } = recorder()
    await invokeChunked(invokeFn, 'write_export_file', { dir: 'D:\\x', relPath: 'a.md' }, bytes(3))
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toEqual([1, 2, 3])
    expect(calls[0].args).toEqual({ dir: 'D:\\x', relPath: 'a.md', offset: 0, last: true })
  })

  it('ровно N частей: последняя помечена last', async () => {
    const { calls, invokeFn } = recorder()
    const result = await invokeChunked<{ part: number }>(invokeFn, 'c', {}, bytes(8), { chunkBytes: 4 })
    expect(calls.map((c) => c.body)).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ])
    expect(calls.map((c) => c.args)).toEqual([
      { offset: 0, last: false },
      { offset: 4, last: true },
    ])
    expect(result).toEqual({ part: 1 })
  })

  it('N частей с остатком; возвращён ответ последней части', async () => {
    const { calls, invokeFn } = recorder()
    const result = await invokeChunked<{ part: number }>(invokeFn, 'c', { dir: 'd' }, bytes(10), {
      chunkBytes: 4,
    })
    expect(calls.map((c) => c.body)).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10],
    ])
    expect(calls.map((c) => [c.args.offset, c.args.last])).toEqual([
      [0, false],
      [4, false],
      [8, true],
    ])
    expect(result).toEqual({ part: 2 })
  })

  it('тело каждой части — Uint8Array', async () => {
    const seen: unknown[] = []
    const invokeFn: InvokeFn = async <T>(_cmd: string, args?: Record<string, unknown> | Uint8Array) => {
      seen.push(args)
      return undefined as T
    }
    await invokeChunked(invokeFn, 'c', {}, bytes(5), { chunkBytes: 4 })
    expect(seen).toHaveLength(2)
    expect(seen.every((body) => body instanceof Uint8Array)).toBe(true)
  })

  it('заголовок с кириллическим путём — ASCII и декодируется обратно в args', async () => {
    const { calls, invokeFn } = recorder()
    const args = { dir: 'D:\\Резервные копии\\Быстрые заметки', fileName: 'quickdrop-backup-20261111-093005.json' }
    await invokeChunked(invokeFn, 'save_backup', args, bytes(2))
    expect(calls[0].headerValue).toMatch(/^[\x21-\x7e]+$/)
    expect(calls[0].args).toEqual({ ...args, offset: 0, last: true })
  })

  it('offset и last из args вызывающего не принимаются', async () => {
    const { calls, invokeFn } = recorder()
    await invokeChunked(invokeFn, 'c', { offset: 99, last: false }, bytes(1))
    expect(calls[0].args).toEqual({ offset: 0, last: true })
  })

  it('отказ строкой — Error с этим текстом, следующие части не шлются', async () => {
    const { calls, invokeFn } = recorder((i) => (i === 1 ? 'Не удалось записать файл: на диске не осталось места' : undefined))
    await expect(invokeChunked(invokeFn, 'c', {}, bytes(12), { chunkBytes: 4 })).rejects.toThrow(
      'Не удалось записать файл: на диске не осталось места',
    )
    expect(calls).toHaveLength(2)
  })

  it('отказ не строкой — запасной текст', async () => {
    const { calls, invokeFn } = recorder(() => ({ code: 1 }))
    await expect(
      invokeChunked(invokeFn, 'c', {}, bytes(12), { chunkBytes: 4, fallback: 'Не удалось сохранить копию' }),
    ).rejects.toThrow('Не удалось сохранить копию')
    expect(calls).toHaveLength(1)

    const other = recorder(() => 42)
    await expect(invokeChunked(other.invokeFn, 'c', {}, bytes(1))).rejects.toBeInstanceOf(Error)
  })

  it('отменённый заранее signal — «Отменено», вызовов нет', async () => {
    const { calls, invokeFn } = recorder()
    const controller = new AbortController()
    controller.abort()
    await expect(
      invokeChunked(invokeFn, 'c', {}, bytes(4), { signal: controller.signal }),
    ).rejects.toThrow('Отменено')
    expect(calls).toHaveLength(0)
  })

  it('отмена между частями останавливает передачу', async () => {
    const controller = new AbortController()
    const { calls, invokeFn } = recorder((i) => {
      if (i === 1) controller.abort()
      return undefined
    })
    await expect(
      invokeChunked(invokeFn, 'c', {}, bytes(12), { chunkBytes: 4, signal: controller.signal }),
    ).rejects.toThrow('Отменено')
    expect(calls).toHaveLength(2)
  })

  it('отмена после принятой части убирает временный файл', async () => {
    const controller = new AbortController()
    const { calls, invokeFn } = recorder((i) => {
      if (i === 1) controller.abort()
      return undefined
    })
    const discard = vi.fn(async () => true)
    await expect(
      invokeChunked(invokeFn, 'c', {}, bytes(12), { chunkBytes: 4, signal: controller.signal, discard }),
    ).rejects.toThrow('Отменено')
    expect(calls).toHaveLength(2)
    expect(discard).toHaveBeenCalledTimes(1)
  })

  it('сбой на второй части убирает временный файл, ошибка — исходная', async () => {
    const { invokeFn } = recorder((i) => (i === 1 ? 'Не удалось записать файл: на диске не осталось места' : undefined))
    const discard = vi.fn(async () => {
      throw new Error('уборка не удалась')
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(invokeChunked(invokeFn, 'c', {}, bytes(12), { chunkBytes: 4, discard })).rejects.toThrow(
      'Не удалось записать файл: на диске не осталось места',
    )
    expect(discard).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('сбой чтения части после принятой — тоже уборка', async () => {
    const { invokeFn } = recorder()
    const data = bytes(12)
    const slice = data.slice.bind(data)
    let reads = 0
    vi.spyOn(data, 'slice').mockImplementation((start, end) => {
      reads += 1
      if (reads === 2) throw new Error('Файл недоступен')
      return slice(start, end)
    })
    const discard = vi.fn(async () => true)
    await expect(invokeChunked(invokeFn, 'c', {}, data, { chunkBytes: 4, discard })).rejects.toThrow(
      'Файл недоступен',
    )
    expect(discard).toHaveBeenCalledTimes(1)
  })

  it('без принятых частей и при успехе уборки нет', async () => {
    const discard = vi.fn(async () => true)
    const first = recorder(() => 'Папка не подтверждена: выберите её заново в настройках')
    await expect(invokeChunked(first.invokeFn, 'c', {}, bytes(12), { chunkBytes: 4, discard })).rejects.toThrow(
      'Папка не подтверждена',
    )
    const controller = new AbortController()
    controller.abort()
    await expect(
      invokeChunked(recorder().invokeFn, 'c', {}, bytes(12), { chunkBytes: 4, signal: controller.signal, discard }),
    ).rejects.toThrow('Отменено')
    await invokeChunked(recorder().invokeFn, 'c', {}, bytes(12), { chunkBytes: 4, discard })
    expect(discard).not.toHaveBeenCalled()
  })

  it('некорректный размер части заменяется размером по умолчанию', async () => {
    const { calls, invokeFn } = recorder()
    await invokeChunked(invokeFn, 'c', {}, bytes(5), { chunkBytes: 0 })
    expect(calls).toHaveLength(1)
    expect(calls[0].body).toHaveLength(5)
  })
})
