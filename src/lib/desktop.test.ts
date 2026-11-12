import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(cmd: string, args?: unknown, options?: unknown) => Promise<unknown>>(),
}))
vi.mock('@/lib/platform', () => ({
  isTauri: () => true,
  isMac: () => false,
  modKey: () => 'Ctrl',
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))

import { pickDirectory, pruneBackups, writeExportFile } from './desktop'
import { IPC_CHUNK_BYTES } from './ipc'

const DIR = 'D:\\Хранилище Obsidian'
const REL = 'attachments/video.mp4'

afterEach(() => {
  mocks.invoke.mockReset()
})

describe('pickDirectory', () => {
  it('передаёт назначение папки, а не текст заголовка', async () => {
    mocks.invoke.mockResolvedValueOnce('D:\\Копии')
    expect(await pickDirectory({ purpose: 'backup', defaultPath: 'D:\\Копии' })).toBe('D:\\Копии')
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('pick_directory', {
      purpose: 'backup',
      defaultPath: 'D:\\Копии',
    })

    mocks.invoke.mockResolvedValueOnce(null)
    expect(await pickDirectory()).toBeNull()
    expect(mocks.invoke).toHaveBeenLastCalledWith('pick_directory', { purpose: null, defaultPath: null })
  })
})

describe('pruneBackups', () => {
  it('передаёт имя только что сохранённой копии', async () => {
    mocks.invoke.mockResolvedValue({ removed: [], failed: [] })
    await pruneBackups('D:\\Копии', 3, 'quickdrop-backup-20261112-150000.json')
    expect(mocks.invoke).toHaveBeenLastCalledWith('prune_backups', {
      dir: 'D:\\Копии',
      keep: 3,
      protect: 'quickdrop-backup-20261112-150000.json',
    })
    await pruneBackups('D:\\Копии', 3)
    expect(mocks.invoke).toHaveBeenLastCalledWith('prune_backups', { dir: 'D:\\Копии', keep: 3, protect: null })
  })
})

describe('writeExportFile', () => {
  // Две части по IPC_CHUNK_BYTES: первая принята, перед второй — отмена или сбой.
  const twoParts = (): Blob => new Blob([new Uint8Array(IPC_CHUNK_BYTES + 1)])

  it('отмена посреди файла убирает его .qdpart', async () => {
    const controller = new AbortController()
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd !== 'write_export_file') return true
      controller.abort()
      return { path: `${DIR}\\${REL}`, size: IPC_CHUNK_BYTES, done: false }
    })
    await expect(writeExportFile(DIR, REL, twoParts(), controller.signal)).rejects.toThrow('Отменено')
    expect(mocks.invoke.mock.calls.map(([cmd]) => cmd)).toEqual(['write_export_file', 'discard_export_part'])
    expect(mocks.invoke).toHaveBeenLastCalledWith('discard_export_part', { dir: DIR, relPath: REL })
  })

  it('сбой второй части — уборка и исходная ошибка', async () => {
    let parts = 0
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd !== 'write_export_file') return true
      parts += 1
      if (parts === 2) throw 'Не удалось записать файл: на диске не осталось места'
      return { path: `${DIR}\\${REL}`, size: IPC_CHUNK_BYTES, done: false }
    })
    await expect(writeExportFile(DIR, REL, twoParts())).rejects.toThrow(
      'Не удалось записать файл: на диске не осталось места',
    )
    expect(mocks.invoke).toHaveBeenLastCalledWith('discard_export_part', { dir: DIR, relPath: REL })
  })

  it('успешная запись уборку не вызывает', async () => {
    mocks.invoke.mockResolvedValue({ path: `${DIR}\\note.md`, size: 4, done: true })
    expect(await writeExportFile(DIR, 'note.md', 'текст')).toMatchObject({ done: true })
    expect(mocks.invoke.mock.calls.map(([cmd]) => cmd)).toEqual(['write_export_file'])
  })
})
