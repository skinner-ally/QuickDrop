import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(cmd: string, args?: unknown, options?: unknown) => Promise<unknown>>(),
  getSettings: vi.fn<() => Promise<unknown>>(),
  tauri: true,
}))
vi.mock('@/lib/platform', () => ({
  isTauri: () => mocks.tauri,
  isMac: () => false,
  modKey: () => 'Ctrl',
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@/db/settings', () => ({ getSettings: mocks.getSettings }))

import {
  forgetDirectory,
  pickDirectory,
  pruneBackups,
  reconcileApprovedDirs,
  retainDirectories,
  writeExportFile,
} from './desktop'
import { IPC_CHUNK_BYTES } from './ipc'
import { DEFAULT_SETTINGS } from '@/types'

const DIR = 'D:\\Хранилище Obsidian'
const REL = 'attachments/video.mp4'

afterEach(() => {
  mocks.invoke.mockReset()
  mocks.getSettings.mockReset()
  mocks.tauri = true
  vi.restoreAllMocks()
})

describe('forgetDirectory', () => {
  it('вызывает forget_directory с папкой и возвращает ответ Rust', async () => {
    mocks.invoke.mockResolvedValueOnce(true)
    expect(await forgetDirectory('D:\\Копии')).toBe(true)
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('forget_directory', { dir: 'D:\\Копии', keep: [] })

    mocks.invoke.mockResolvedValueOnce(false)
    expect(await forgetDirectory('D:\\Неизвестная')).toBe(false)
  })

  it('передаёт папки из настроек (keep) без пустых строк', async () => {
    mocks.invoke.mockResolvedValueOnce(true)
    expect(await forgetDirectory('Z:\\QuickDrop', ['\\\\nas\\share\\QuickDrop', '', '   ', DIR])).toBe(true)
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('forget_directory', {
      dir: 'Z:\\QuickDrop',
      keep: ['\\\\nas\\share\\QuickDrop', DIR],
    })
  })

  it('ошибка команды — false, наружу не бросает', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.invoke.mockRejectedValueOnce('Не удалось забыть папку: нет доступа')
    await expect(forgetDirectory('D:\\Копии')).resolves.toBe(false)
  })

  it('пустая строка и вне Tauri — false без вызова', async () => {
    expect(await forgetDirectory('')).toBe(false)
    expect(await forgetDirectory('   ')).toBe(false)
    mocks.tauri = false
    expect(await forgetDirectory('D:\\Копии')).toBe(false)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})

describe('retainDirectories', () => {
  it('вызывает retain_directories без пустых строк', async () => {
    mocks.invoke.mockResolvedValueOnce(true)
    expect(await retainDirectories(['D:\\Копии', '', ' '])).toBe(true)
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('retain_directories', { keep: ['D:\\Копии'] })
    // пустой список — тоже ответ: в настройках папок нет
    mocks.invoke.mockResolvedValueOnce(false)
    expect(await retainDirectories([])).toBe(false)
    expect(mocks.invoke).toHaveBeenLastCalledWith('retain_directories', { keep: [] })
  })

  it('ошибка — false; вне Tauri — без вызова', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.invoke.mockRejectedValueOnce('Не удалось забыть папку: нет доступа')
    await expect(retainDirectories(['D:\\Копии'])).resolves.toBe(false)
    mocks.invoke.mockClear()
    mocks.tauri = false
    expect(await retainDirectories(['D:\\Копии'])).toBe(false)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})

describe('reconcileApprovedDirs', () => {
  it('оставляет подтверждёнными папки из настроек', async () => {
    mocks.getSettings.mockResolvedValueOnce({ ...DEFAULT_SETTINGS, backupDir: 'D:\\Копии', mdExportDir: DIR })
    mocks.invoke.mockResolvedValueOnce(true)
    expect(await reconcileApprovedDirs()).toBe(true)
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('retain_directories', { keep: ['D:\\Копии', DIR] })

    mocks.getSettings.mockResolvedValueOnce({ ...DEFAULT_SETTINGS, backupDir: '', mdExportDir: '' })
    mocks.invoke.mockResolvedValueOnce(true)
    await reconcileApprovedDirs()
    expect(mocks.invoke).toHaveBeenLastCalledWith('retain_directories', { keep: [] })
  })

  it('настройки не прочитаны — ничего не отзывает', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.getSettings.mockRejectedValueOnce(new Error('База недоступна'))
    expect(await reconcileApprovedDirs()).toBe(false)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('вне Tauri — без чтения настроек', async () => {
    mocks.tauri = false
    expect(await reconcileApprovedDirs()).toBe(false)
    expect(mocks.getSettings).not.toHaveBeenCalled()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
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
