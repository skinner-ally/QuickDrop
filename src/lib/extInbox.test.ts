import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Item, NewItemInput } from '@/types'

type Handler = (e: { payload: unknown }) => void

const mocks = vi.hoisted(() => ({
  tauri: true,
  capture: false,
  invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(),
  windowListen: vi.fn<(event: string, handler: Handler) => Promise<() => void>>(),
  globalListen: vi.fn(),
  findDuplicateLink: vi.fn<(url: string) => Promise<unknown>>(),
  createAndEnrich: vi.fn<(input: unknown) => Promise<unknown>>(),
  openItemInSection: vi.fn(),
  toastSuccess: vi.fn(),
  getSettings: vi.fn<() => Promise<unknown>>(),
}))

vi.mock('@/lib/platform', () => ({
  isTauri: () => mocks.tauri,
  isCaptureWindow: () => mocks.capture,
  isMac: () => false,
  modKey: () => 'Ctrl',
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ listen: mocks.windowListen }),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.globalListen }))
vi.mock('@/db/repo', () => ({ findDuplicateLink: mocks.findDuplicateLink }))
vi.mock('./actions', () => ({
  createAndEnrich: mocks.createAndEnrich,
  openItemInSection: mocks.openItemInSection,
}))
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: vi.fn() } }))
vi.mock('@/db/settings', () => ({ getSettings: mocks.getSettings }))

type Mod = typeof import('./extInbox')
let mod: Mod

function makeItem(over: Partial<Item> = {}): Item {
  return {
    id: 'id-1',
    type: 'link',
    title: '',
    content: '',
    url: 'https://example.com/a',
    categoryId: null,
    tags: [],
    links: [],
    favorite: 0,
    status: 'inbox',
    source: 'extension',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  } as Item
}

const page = (url = 'https://example.com/a') => ({ v: 1, kind: 'page', url, title: 'Пример' })

/** Отложенный промис для управления порядком в тестах очереди. */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

beforeEach(async () => {
  vi.resetModules()
  mocks.tauri = true
  mocks.capture = false
  mocks.invoke.mockReset()
  mocks.windowListen.mockReset()
  mocks.windowListen.mockResolvedValue(() => {})
  mocks.globalListen.mockReset()
  mocks.findDuplicateLink.mockReset()
  mocks.findDuplicateLink.mockResolvedValue(undefined)
  mocks.createAndEnrich.mockReset()
  mocks.createAndEnrich.mockImplementation(async (input) => makeItem(input as Partial<Item>))
  mocks.openItemInSection.mockReset()
  mocks.toastSuccess.mockReset()
  mocks.getSettings.mockReset()
  mocks.getSettings.mockResolvedValue({ extEnabled: true })
  mod = await import('./extInbox')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('handleExtCapture', () => {
  it('создаёт запись через createAndEnrich и сообщает onSaved', async () => {
    const createAndEnrich = vi.fn(async (input: NewItemInput) => makeItem({ url: input.url }))
    const findDuplicateLink = vi.fn(async () => undefined)
    const onSaved = vi.fn()
    const res = await mod.handleExtCapture(page(), { createAndEnrich, findDuplicateLink, onSaved })
    expect(res).toEqual({ ok: true, duplicate: false })
    expect(findDuplicateLink).toHaveBeenCalledWith('https://example.com/a')
    expect(createAndEnrich).toHaveBeenCalledWith({
      type: 'link',
      url: 'https://example.com/a',
      title: 'Пример',
      status: 'inbox',
      source: 'extension',
    })
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('дубль ссылки → ok + duplicate, запись не создаётся', async () => {
    const createAndEnrich = vi.fn(async () => makeItem())
    const onSaved = vi.fn()
    const res = await mod.handleExtCapture(page(), {
      createAndEnrich,
      findDuplicateLink: async () => makeItem({ id: 'old' }),
      onSaved,
    })
    expect(res).toEqual({ ok: true, duplicate: true })
    expect(createAndEnrich).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('ссылка из выделения тоже проверяется на дубль', async () => {
    const findDuplicateLink = vi.fn(async () => makeItem())
    const createAndEnrich = vi.fn(async () => makeItem())
    const res = await mod.handleExtCapture(
      { v: 1, kind: 'selection', text: 'example.com/a', url: 'https://src.example/' },
      { findDuplicateLink, createAndEnrich },
    )
    expect(res).toEqual({ ok: true, duplicate: true })
    expect(findDuplicateLink).toHaveBeenCalledWith('https://example.com/a')
    expect(createAndEnrich).not.toHaveBeenCalled()
  })

  it('текст из выделения на дубль не проверяется', async () => {
    const findDuplicateLink = vi.fn(async () => makeItem())
    const createAndEnrich = vi.fn(async (input: NewItemInput) => makeItem({ type: input.type }))
    const res = await mod.handleExtCapture(
      { v: 1, kind: 'selection', text: 'Мысль из статьи', url: 'https://src.example/' },
      { findDuplicateLink, createAndEnrich, onSaved: () => {} },
    )
    expect(res).toEqual({ ok: true, duplicate: false })
    expect(findDuplicateLink).not.toHaveBeenCalled()
  })

  it('ошибка createItem → ok: false с текстом, не бросает', async () => {
    const res = await mod.handleExtCapture(page(), {
      findDuplicateLink: async () => undefined,
      createAndEnrich: async () => {
        throw new Error('Адрес должен начинаться с http, https или ftp')
      },
    })
    expect(res).toEqual({ ok: false, duplicate: false, error: 'Адрес должен начинаться с http, https или ftp' })
  })

  it('ошибка без текста → «Не удалось сохранить»; квота → понятный текст', async () => {
    const noText = await mod.handleExtCapture(page(), {
      findDuplicateLink: async () => undefined,
      createAndEnrich: () => Promise.reject('строка, не Error'),
    })
    expect(noText).toEqual({ ok: false, duplicate: false, error: 'Не удалось сохранить' })
    const quota = await mod.handleExtCapture(page(), {
      findDuplicateLink: async () => undefined,
      createAndEnrich: () => Promise.reject(Object.assign(new Error('x'), { name: 'QuotaExceededError' })),
    })
    expect(quota.ok).toBe(false)
    expect(quota.error).toMatch(/Недостаточно места/)
  })

  it('ошибка проверки дубля → ok: false', async () => {
    const res = await mod.handleExtCapture(page(), {
      findDuplicateLink: async () => {
        throw new Error('База недоступна')
      },
      createAndEnrich: async () => makeItem(),
    })
    expect(res).toEqual({ ok: false, duplicate: false, error: 'База недоступна' })
  })

  it('негодное сообщение → ok: false, зависимости не вызываются', async () => {
    const createAndEnrich = vi.fn(async () => makeItem())
    const findDuplicateLink = vi.fn(async () => undefined)
    const res = await mod.handleExtCapture({ v: 1, kind: 'page', url: 'file:///C:/x' }, { createAndEnrich, findDuplicateLink })
    expect(res).toEqual({ ok: false, duplicate: false, error: 'Адрес не поддерживается' })
    expect(createAndEnrich).not.toHaveBeenCalled()
    expect(findDuplicateLink).not.toHaveBeenCalled()
    expect(await mod.handleExtCapture('мусор')).toEqual({
      ok: false,
      duplicate: false,
      error: 'Неизвестный формат сообщения расширения',
    })
  })

  it('длинный текст ошибки обрезается', async () => {
    const res = await mod.handleExtCapture(page(), {
      findDuplicateLink: async () => undefined,
      createAndEnrich: async () => {
        throw new Error('ж'.repeat(5000))
      },
    })
    expect(res.error!.length).toBeLessThanOrEqual(500)
  })

  it('ошибка onSaved не ломает итог', async () => {
    const res = await mod.handleExtCapture(page(), {
      findDuplicateLink: async () => undefined,
      createAndEnrich: async () => makeItem(),
      onSaved: () => {
        throw new Error('toast')
      },
    })
    expect(res).toEqual({ ok: true, duplicate: false })
  })

  it('без зависимостей берёт repo.findDuplicateLink и actions.createAndEnrich', async () => {
    const res = await mod.handleExtCapture(page())
    expect(res).toEqual({ ok: true, duplicate: false })
    expect(mocks.findDuplicateLink).toHaveBeenCalledWith('https://example.com/a')
    expect(mocks.createAndEnrich).toHaveBeenCalledTimes(1)
  })
})

describe('notifySaved', () => {
  it('страница видна → toast с «Открыть»', async () => {
    vi.stubGlobal('document', { visibilityState: 'visible' })
    const item = makeItem({ title: 'Заголовок' })
    mod.notifySaved(item)
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1)
    const [text, opts] = mocks.toastSuccess.mock.calls[0] as [string, { description: string; action: { label: string; onClick: () => void } }]
    expect(text).toBe('Сохранено из браузера')
    expect(opts.description).toBe('Заголовок')
    expect(opts.action.label).toBe('Открыть')
    opts.action.onClick()
    await flush()
    expect(mocks.openItemInSection).toHaveBeenCalledWith(item)
  })

  it('страница скрыта (окно в трее) или документа нет → молча', () => {
    vi.stubGlobal('document', { visibilityState: 'hidden' })
    mod.notifySaved(makeItem())
    vi.stubGlobal('document', undefined)
    mod.notifySaved(makeItem())
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })
})

describe('drainExtInbox', () => {
  it('вне Tauri ничего не делает', async () => {
    mocks.tauri = false
    expect(await mod.drainExtInbox()).toBe(0)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('забирает сообщения и подтверждает каждое по одному', async () => {
    mocks.findDuplicateLink.mockImplementation(async (url) =>
      url === 'https://example.com/dup' ? makeItem({ id: 'old' }) : undefined,
    )
    const calls: string[] = []
    mocks.invoke.mockImplementation(async (cmd, args) => {
      calls.push(cmd)
      if (cmd === 'ext_take_pending') {
        return [
          { requestId: 1, message: page('https://example.com/new') },
          { requestId: 2, message: page('https://example.com/dup') },
          { requestId: 3, message: { v: 1, kind: 'page', url: 'chrome://settings' } },
          { message: page() }, // без requestId — подтвердить нечем, пропускается
        ]
      }
      void args
      return null
    })
    expect(await mod.drainExtInbox()).toBe(3)
    expect(calls).toEqual(['ext_take_pending', 'ext_capture_done', 'ext_capture_done', 'ext_capture_done'])
    const done = mocks.invoke.mock.calls.filter(([c]) => c === 'ext_capture_done').map(([, a]) => a)
    expect(done).toEqual([
      { requestId: 1, ok: true, duplicate: false, error: null },
      { requestId: 2, ok: true, duplicate: true, error: null },
      { requestId: 3, ok: false, duplicate: false, error: 'Адрес не поддерживается' },
    ])
    expect(mocks.createAndEnrich).toHaveBeenCalledTimes(1)
  })

  it('следующее сообщение обрабатывается только после подтверждения предыдущего', async () => {
    const first = deferred<unknown>()
    const order: string[] = []
    mocks.createAndEnrich.mockImplementation(async (input) => {
      const url = (input as NewItemInput).url ?? ''
      order.push(`create ${url}`)
      if (url.endsWith('/1')) await first.promise
      return makeItem({ url })
    })
    mocks.invoke.mockImplementation(async (cmd, args) => {
      if (cmd === 'ext_take_pending') {
        return [
          { requestId: 1, message: page('https://example.com/1') },
          { requestId: 2, message: page('https://example.com/2') },
        ]
      }
      order.push(`done ${(args as { requestId: number }).requestId}`)
      return null
    })
    const run = mod.drainExtInbox()
    await flush()
    expect(order).toEqual(['create https://example.com/1'])
    first.resolve(null)
    expect(await run).toBe(2)
    expect(order).toEqual(['create https://example.com/1', 'done 1', 'create https://example.com/2', 'done 2'])
  })

  it('вызов во время работы не теряется и не идёт параллельно', async () => {
    const gate = deferred<unknown>()
    let takes = 0
    let active = 0
    let maxActive = 0
    mocks.invoke.mockImplementation(async (cmd) => {
      if (cmd !== 'ext_take_pending') return null
      takes++
      active++
      maxActive = Math.max(maxActive, active)
      try {
        if (takes === 1) {
          await gate.promise
          return [{ requestId: 1, message: page('https://example.com/1') }]
        }
        if (takes === 2) return [{ requestId: 2, message: page('https://example.com/2') }]
        return []
      } finally {
        active--
      }
    })
    const a = mod.drainExtInbox()
    await flush()
    // Будильники во время работы: второй проход один, а не два и не параллельно.
    const b = mod.drainExtInbox()
    const c = mod.drainExtInbox()
    expect(b).toBe(a)
    expect(c).toBe(a)
    gate.resolve(null)
    expect(await a).toBe(2)
    expect(takes).toBe(2)
    expect(maxActive).toBe(1)
    expect(mocks.createAndEnrich).toHaveBeenCalledTimes(2)

    // После завершения новый вызов снова идёт к Rust.
    expect(await mod.drainExtInbox()).toBe(0)
    expect(takes).toBe(3)
  })

  it('отказ ext_take_pending и ext_capture_done не бросает', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.invoke.mockRejectedValueOnce(new Error('Недоступно из этого окна'))
    expect(await mod.drainExtInbox()).toBe(0)

    mocks.invoke.mockImplementation(async (cmd) => {
      if (cmd === 'ext_take_pending') return [{ requestId: 7, message: page() }]
      throw new Error('поздно')
    })
    expect(await mod.drainExtInbox()).toBe(1)
    warn.mockRestore()
  })

  it('приём выключен в настройках → записи не создаются, каждое сообщение получает отказ', async () => {
    mocks.getSettings.mockResolvedValue({ extEnabled: false })
    mocks.invoke.mockImplementation(async (cmd) =>
      cmd === 'ext_take_pending'
        ? [
            { requestId: 1, message: page('https://example.com/1') },
            { requestId: 2, message: { v: 1, kind: 'selection', text: 'Мысль', url: 'https://src.example/' } },
          ]
        : null,
    )
    expect(await mod.drainExtInbox()).toBe(2)
    expect(mocks.createAndEnrich).not.toHaveBeenCalled()
    expect(mocks.findDuplicateLink).not.toHaveBeenCalled()
    const done = mocks.invoke.mock.calls.filter(([c]) => c === 'ext_capture_done').map(([, a]) => a)
    expect(done).toEqual([
      { requestId: 1, ok: false, duplicate: false, error: 'Приём выключен' },
      { requestId: 2, ok: false, duplicate: false, error: 'Приём выключен' },
    ])
  })

  it('настройки не прочитались → отказ; включённый приём создаёт запись', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.getSettings.mockRejectedValueOnce(new Error('База недоступна'))
    mocks.invoke.mockImplementation(async (cmd) =>
      cmd === 'ext_take_pending' ? [{ requestId: 3, message: page() }] : null,
    )
    expect(await mod.drainExtInbox()).toBe(1)
    expect(mocks.createAndEnrich).not.toHaveBeenCalled()
    expect(mocks.invoke).toHaveBeenCalledWith('ext_capture_done', {
      requestId: 3,
      ok: false,
      duplicate: false,
      error: 'Приём выключен',
    })

    expect(await mod.drainExtInbox()).toBe(1)
    expect(mocks.createAndEnrich).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenLastCalledWith('ext_capture_done', {
      requestId: 3,
      ok: true,
      duplicate: false,
      error: null,
    })
    warn.mockRestore()
  })

  it('пусто → настройки не читаются', async () => {
    mocks.invoke.mockResolvedValue([])
    expect(await mod.drainExtInbox()).toBe(0)
    expect(mocks.getSettings).not.toHaveBeenCalled()
  })

  it('ответ Rust не массив → ничего не обрабатывается', async () => {
    mocks.invoke.mockResolvedValue({ requestId: 1 })
    expect(await mod.drainExtInbox()).toBe(0)
    expect(mocks.createAndEnrich).not.toHaveBeenCalled()
  })
})

describe('startExtInbox', () => {
  it('подписка окна (не глобальная), затем первый drain; повторный вызов ничего не добавляет', async () => {
    const order: string[] = []
    mocks.windowListen.mockImplementation(async (event) => {
      order.push(`listen ${event}`)
      return () => {}
    })
    mocks.invoke.mockImplementation(async (cmd) => {
      order.push(cmd)
      return []
    })
    await mod.startExtInbox()
    await mod.startExtInbox()
    expect(order).toEqual(['listen ext-capture', 'ext_take_pending'])
    expect(mocks.windowListen).toHaveBeenCalledTimes(1)
    expect(mocks.globalListen).not.toHaveBeenCalled()
  })

  it('событие ext-capture запускает drain', async () => {
    let handler: Handler | undefined
    mocks.windowListen.mockImplementation(async (_event, h) => {
      handler = h
      return () => {}
    })
    mocks.invoke.mockResolvedValue([])
    await mod.startExtInbox()
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    mocks.invoke.mockResolvedValueOnce([{ requestId: 5, message: page() }])
    handler!({ payload: 5 })
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('ext_capture_done', expect.objectContaining({ requestId: 5, ok: true })))
  })

  it('вне Tauri и в мини-окне ничего не делает', async () => {
    mocks.tauri = false
    await mod.startExtInbox()
    mocks.tauri = true
    mocks.capture = true
    await mod.startExtInbox()
    expect(mocks.windowListen).not.toHaveBeenCalled()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('подписка не удалась → не бросает, следующий вызов пробует снова', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.windowListen.mockRejectedValueOnce(new Error('нет окна'))
    mocks.invoke.mockResolvedValue([])
    await expect(mod.startExtInbox()).resolves.toBeUndefined()
    await mod.startExtInbox()
    expect(mocks.windowListen).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})
