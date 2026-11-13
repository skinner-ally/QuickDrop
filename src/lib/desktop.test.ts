import { afterEach, describe, expect, it, vi } from 'vitest'

type Handler = (e: { payload: unknown }) => void

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(cmd: string, args?: unknown, options?: unknown) => Promise<unknown>>(),
  getSettings: vi.fn<() => Promise<unknown>>(),
  tauri: true,
  register: vi.fn<(shortcut: string, cb: (e: { state: string }) => void) => Promise<void>>(),
  unregisterAll: vi.fn<() => Promise<void>>(),
  windowListen: vi.fn<(event: string, handler: Handler) => Promise<() => void>>(),
  globalListen: vi.fn<(event: string, handler: Handler) => Promise<() => void>>(),
  win: { unminimize: vi.fn(), show: vi.fn(), setFocus: vi.fn() },
  getItem: vi.fn<(id: string) => Promise<unknown>>(),
  openItemInSection: vi.fn<(item: unknown) => void>(),
  initAutoBackup: vi.fn(),
  toastError: vi.fn(),
}))
vi.mock('@/lib/platform', () => ({
  isTauri: () => mocks.tauri,
  isCaptureWindow: () => false,
  isMac: () => false,
  modKey: () => 'Ctrl',
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@/db/settings', () => ({ getSettings: mocks.getSettings }))
vi.mock('@tauri-apps/plugin-global-shortcut', () => ({
  register: mocks.register,
  unregisterAll: mocks.unregisterAll,
}))
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ listen: mocks.windowListen }),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.globalListen }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => mocks.win }))
vi.mock('@/db/repo', () => ({ getItem: mocks.getItem }))
vi.mock('./actions', () => ({ openItemInSection: mocks.openItemInSection }))
vi.mock('./autoBackup', () => ({ initAutoBackup: mocks.initAutoBackup }))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: vi.fn() } }))

import {
  applyExtensionServer,
  applyShellOptions,
  DESKTOP_ONLY_MESSAGE,
  forgetDirectory,
  generateExtensionToken,
  getAutostart,
  getExtensionDir,
  getExtServerStatus,
  initDesktop,
  openInMain,
  pickDirectory,
  pruneBackups,
  quitApp,
  reconcileApprovedDirs,
  retainDirectories,
  setAutostart,
  showMainWindow,
  toggleCaptureWindow,
  writeExportFile,
} from './desktop'
import { IPC_CHUNK_BYTES } from './ipc'
import { isExtensionToken } from './shellUi'
import { useUi } from '@/store/ui'
import { DEFAULT_SETTINGS } from '@/types'

const DIR = 'D:\\Хранилище Obsidian'
const REL = 'attachments/video.mp4'

afterEach(() => {
  mocks.invoke.mockReset()
  mocks.getSettings.mockReset()
  mocks.register.mockReset()
  mocks.unregisterAll.mockReset()
  mocks.windowListen.mockReset()
  mocks.globalListen.mockReset()
  mocks.getItem.mockReset()
  mocks.openItemInSection.mockReset()
  mocks.initAutoBackup.mockReset()
  mocks.toastError.mockReset()
  for (const fn of Object.values(mocks.win)) fn.mockReset()
  mocks.tauri = true
  useUi.setState({ captureOpen: false, captureDraft: null })
  vi.unstubAllGlobals()
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

// ───────────────────────── этап 7 ─────────────────────────

const TOKEN = 'T'.repeat(39) + '-_z9'

describe('generateExtensionToken', () => {
  it('43 символа base64url, каждый раз новый', () => {
    const a = generateExtensionToken()
    const b = generateExtensionToken()
    expect(isExtensionToken(a)).toBe(true)
    expect(isExtensionToken(b)).toBe(true)
    expect(a).not.toBe(b)
  })
})

describe('applyShellOptions', () => {
  it('передаёт оба флага в camelCase', async () => {
    mocks.invoke.mockResolvedValueOnce(null)
    expect(await applyShellOptions({ closeToTray: true, captureWindow: false })).toBe(true)
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('set_shell_options', {
      closeToTray: true,
      captureWindow: false,
    })
  })

  it('отказ команды — false; вне Tauri — без вызова', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.invoke.mockRejectedValueOnce('Command set_shell_options not found')
    await expect(applyShellOptions(DEFAULT_SETTINGS)).resolves.toBe(false)
    mocks.invoke.mockClear()
    mocks.tauri = false
    expect(await applyShellOptions(DEFAULT_SETTINGS)).toBe(false)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})

describe('toggleCaptureWindow', () => {
  it('возвращает ответ Rust', async () => {
    mocks.invoke.mockResolvedValueOnce(true)
    expect(await toggleCaptureWindow()).toBe(true)
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('toggle_capture_window')
    mocks.invoke.mockResolvedValueOnce(false)
    expect(await toggleCaptureWindow()).toBe(false)
  })

  it('отказ и вне Tauri — бросает', async () => {
    mocks.invoke.mockRejectedValueOnce('Окно не создано')
    await expect(toggleCaptureWindow()).rejects.toThrow('Окно не создано')
    mocks.invoke.mockRejectedValueOnce(undefined)
    await expect(toggleCaptureWindow()).rejects.toThrow('Не удалось показать окно быстрой записи')
    mocks.invoke.mockClear()
    mocks.tauri = false
    await expect(toggleCaptureWindow()).rejects.toThrow(DESKTOP_ONLY_MESSAGE)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})

describe('showMainWindow, openInMain, quitApp', () => {
  it('вызывают свои команды', async () => {
    mocks.invoke.mockResolvedValue(null)
    await showMainWindow()
    await openInMain('id-1')
    await quitApp()
    expect(mocks.invoke.mock.calls).toEqual([['show_main_window'], ['open_in_main', { id: 'id-1' }], ['quit_app']])
  })

  it('show и open не бросают; quit бросает при отказе', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.invoke.mockRejectedValue('нет команды')
    await expect(showMainWindow()).resolves.toBeUndefined()
    await expect(openInMain('id-1')).resolves.toBeUndefined()
    await expect(quitApp()).rejects.toThrow('нет команды')
  })

  it('пустой id и вне Tauri — без вызова', async () => {
    await openInMain('')
    mocks.tauri = false
    await showMainWindow()
    await openInMain('id-1')
    await quitApp()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})

describe('getAutostart / setAutostart', () => {
  it('состояние из Rust без лишних полей', async () => {
    mocks.invoke.mockResolvedValueOnce({ enabled: true, available: true, reason: null, extra: 1 })
    expect(await getAutostart()).toEqual({ enabled: true, available: true })
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('get_autostart')
    mocks.invoke.mockResolvedValueOnce({
      enabled: false,
      available: false,
      reason: 'В отладочной сборке автозапуск не настраивается',
    })
    expect(await getAutostart()).toEqual({
      enabled: false,
      available: false,
      reason: 'В отладочной сборке автозапуск не настраивается',
    })
  })

  it('отказ и вне Tauri — недоступно с причиной', async () => {
    mocks.invoke.mockRejectedValueOnce('Command get_autostart not found')
    expect(await getAutostart()).toEqual({
      enabled: false,
      available: false,
      reason: 'Command get_autostart not found',
    })
    mocks.invoke.mockClear()
    mocks.tauri = false
    expect(await getAutostart()).toEqual({ enabled: false, available: false, reason: DESKTOP_ONLY_MESSAGE })
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('setAutostart: { enabled }, отказ — текст ошибки', async () => {
    mocks.invoke.mockResolvedValueOnce(null)
    expect(await setAutostart(true)).toEqual({ ok: true })
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('set_autostart', { enabled: true })
    mocks.invoke.mockRejectedValueOnce('Не удалось изменить автозапуск: отказано в доступе')
    expect(await setAutostart(false)).toEqual({
      ok: false,
      error: 'Не удалось изменить автозапуск: отказано в доступе',
    })
    expect(mocks.invoke).toHaveBeenLastCalledWith('set_autostart', { enabled: false })
    mocks.invoke.mockClear()
    mocks.tauri = false
    expect(await setAutostart(true)).toEqual({ ok: false, error: DESKTOP_ONLY_MESSAGE })
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})

describe('applyExtensionServer', () => {
  it('включение: порт и токен в Rust, состояние из ответа', async () => {
    mocks.invoke.mockResolvedValueOnce({ running: true, port: 50123 })
    expect(await applyExtensionServer({ extEnabled: true, extPort: 50123, extToken: TOKEN })).toEqual({
      running: true,
      port: 50123,
    })
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('ext_server_apply', {
      enabled: true,
      port: 50123,
      token: TOKEN,
    })
  })

  it('негодный токен или порт при включении в Rust не уходят', async () => {
    for (const extToken of ['', 'короткий', TOKEN + 'x', TOKEN.slice(1) + '=']) {
      expect(await applyExtensionServer({ extEnabled: true, extPort: 47821, extToken })).toEqual({
        running: false,
        port: null,
        error: 'Токен расширения не создан',
      })
    }
    for (const extPort of [80, 70000, 4782.5, Number.NaN]) {
      expect(await applyExtensionServer({ extEnabled: true, extPort, extToken: TOKEN })).toEqual({
        running: false,
        port: null,
        error: 'Порт должен быть от 1024 до 65535',
      })
    }
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('выключение: токен не передаётся, порт — годный', async () => {
    mocks.invoke.mockResolvedValue({ running: false, port: null })
    expect(await applyExtensionServer({ extEnabled: false, extPort: 50123, extToken: TOKEN })).toEqual({
      running: false,
      port: null,
    })
    expect(mocks.invoke).toHaveBeenLastCalledWith('ext_server_apply', { enabled: false, port: 50123, token: '' })
    await applyExtensionServer({ extEnabled: false, extPort: 0, extToken: '' })
    expect(mocks.invoke).toHaveBeenLastCalledWith('ext_server_apply', { enabled: false, port: 47821, token: '' })
  })

  it('отказ команды — не бросает, текст из Rust', async () => {
    mocks.invoke.mockRejectedValueOnce('Порт 47821 занят другой программой')
    expect(await applyExtensionServer({ extEnabled: true, extPort: 47821, extToken: TOKEN })).toEqual({
      running: false,
      port: null,
      error: 'Порт 47821 занят другой программой',
    })
  })

  it('вне Tauri — без вызова', async () => {
    mocks.tauri = false
    expect(await applyExtensionServer({ extEnabled: true, extPort: 47821, extToken: TOKEN })).toEqual({
      running: false,
      port: null,
      error: DESKTOP_ONLY_MESSAGE,
    })
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})

describe('getExtServerStatus', () => {
  it('состояние из Rust; отказ и вне Tauri — не бросает', async () => {
    mocks.invoke.mockResolvedValueOnce({ running: true, port: 47821 })
    expect(await getExtServerStatus()).toEqual({ running: true, port: 47821 })
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('ext_server_status')
    mocks.invoke.mockRejectedValueOnce('Command ext_server_status not found')
    expect(await getExtServerStatus()).toEqual({
      running: false,
      port: null,
      error: 'Command ext_server_status not found',
    })
    mocks.invoke.mockClear()
    mocks.tauri = false
    expect(await getExtServerStatus()).toEqual({ running: false, port: null, error: DESKTOP_ONLY_MESSAGE })
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})

describe('getExtensionDir', () => {
  it('путь из Rust', async () => {
    mocks.invoke.mockResolvedValueOnce('C:\\Program Files\\QuickDrop\\extension')
    expect(await getExtensionDir()).toBe('C:\\Program Files\\QuickDrop\\extension')
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('extension_dir')
  })

  it('нет папки, отказ команды, пустой или не строковый ответ — null, не бросает', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.invoke.mockRejectedValueOnce('Папка расширения не найдена')
    expect(await getExtensionDir()).toBeNull()
    mocks.invoke.mockRejectedValueOnce(new Error('Command extension_dir not found'))
    expect(await getExtensionDir()).toBeNull()
    mocks.invoke.mockResolvedValueOnce('   ')
    expect(await getExtensionDir()).toBeNull()
    mocks.invoke.mockResolvedValueOnce(null)
    expect(await getExtensionDir()).toBeNull()
    mocks.invoke.mockResolvedValueOnce({ path: 'C:\\x' })
    expect(await getExtensionDir()).toBeNull()
  })

  it('вне Tauri — null без вызова Rust', async () => {
    mocks.tauri = false
    expect(await getExtensionDir()).toBeNull()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})

describe('initDesktop', () => {
  type Pressed = (e: { state: string }) => void

  /** Запуск initDesktop с настройками; возвращает обработчик сочетания и подписки окна. */
  async function start(
    settings: Partial<typeof DEFAULT_SETTINGS> = {},
    commands: Record<string, (args?: unknown) => unknown> = {},
  ): Promise<{ press: Pressed; handlers: Map<string, Handler> }> {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, ...settings })
    mocks.invoke.mockImplementation(async (cmd: string, args?: unknown) => {
      const fn = commands[cmd]
      if (fn) return fn(args)
      if (cmd === 'retain_directories') return false
      if (cmd === 'set_shell_options') return null
      throw `Command ${cmd} not found`
    })
    let press: Pressed = () => {}
    mocks.register.mockImplementation(async (_s, cb) => {
      press = cb
    })
    mocks.unregisterAll.mockResolvedValue(undefined)
    const handlers = new Map<string, Handler>()
    mocks.windowListen.mockImplementation(async (event, handler) => {
      handlers.set(event, handler)
      return () => {}
    })
    mocks.globalListen.mockResolvedValue(() => {})
    await initDesktop()
    await vi.waitFor(() => expect(handlers.size).toBe(2))
    return { press: (e) => press(e), handlers }
  }

  const calls = (cmd: string) => mocks.invoke.mock.calls.filter(([c]) => c === cmd)
  const tick = () => new Promise((r) => setTimeout(r, 0))

  it('вне Tauri ничего не делает', async () => {
    mocks.tauri = false
    await initDesktop()
    expect(mocks.getSettings).not.toHaveBeenCalled()
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.register).not.toHaveBeenCalled()
  })

  it('применяет флаги окна, регистрирует сочетание; приём выключен — сервер не трогает', async () => {
    await start({ globalShortcut: 'Alt+Q' })
    expect(calls('set_shell_options')).toEqual([['set_shell_options', { closeToTray: false, captureWindow: true }]])
    expect(calls('ext_server_apply')).toEqual([])
    expect(mocks.register).toHaveBeenCalledWith('Alt+Q', expect.any(Function))
    await vi.waitFor(() => expect(mocks.initAutoBackup).toHaveBeenCalled())
    expect(calls('retain_directories')).toHaveLength(1)
    // Глобальный listen — только для скачиваний, события окна — через подписку окна.
    expect(mocks.globalListen.mock.calls.map(([e]) => e)).toEqual(['download-finished'])
    expect(mocks.windowListen.mock.calls.map(([e]) => e).sort()).toEqual(['open-capture', 'open-item'])
  })

  it('сочетание из другой программы при включённом мини-окне — toggle_capture_window', async () => {
    vi.stubGlobal('document', { hasFocus: () => false })
    const { press } = await start({}, { toggle_capture_window: () => true })
    press({ state: 'Released' })
    press({ state: 'Pressed' })
    await vi.waitFor(() => expect(calls('toggle_capture_window')).toHaveLength(1))
    await tick()
    expect(mocks.win.show).not.toHaveBeenCalled()
    expect(useUi.getState().captureOpen).toBe(false)
  })

  it('главное окно в фокусе или мини-окно выключено — прежний диалог', async () => {
    vi.stubGlobal('document', { hasFocus: () => true })
    const { press } = await start({}, { toggle_capture_window: () => true })
    press({ state: 'Pressed' })
    await vi.waitFor(() => expect(useUi.getState().captureOpen).toBe(true))
    expect(mocks.win.show).toHaveBeenCalled()
    expect(calls('toggle_capture_window')).toEqual([])

    useUi.setState({ captureOpen: false })
    mocks.win.show.mockClear()
    vi.stubGlobal('document', { hasFocus: () => false })
    mocks.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, captureWindow: false })
    press({ state: 'Pressed' })
    await vi.waitFor(() => expect(useUi.getState().captureOpen).toBe(true))
    expect(mocks.win.show).toHaveBeenCalled()
    expect(calls('toggle_capture_window')).toEqual([])
  })

  it('мини-окно не открылось — прежний диалог', async () => {
    vi.stubGlobal('document', { hasFocus: () => false })
    const { press } = await start() // команды toggle_capture_window нет → отказ
    press({ state: 'Pressed' })
    await vi.waitFor(() => expect(useUi.getState().captureOpen).toBe(true))
    expect(calls('toggle_capture_window')).toHaveLength(1)
    expect(mocks.win.show).toHaveBeenCalled()
  })

  it('open-capture и open-item из Rust', async () => {
    const item = { id: 'id-7', status: 'library' }
    mocks.getItem.mockImplementation(async (id) => (id === 'id-7' ? item : undefined))
    const { handlers } = await start()
    handlers.get('open-capture')!({ payload: null })
    expect(useUi.getState().captureOpen).toBe(true)

    handlers.get('open-item')!({ payload: { id: 'id-7' } })
    await vi.waitFor(() => expect(mocks.openItemInSection).toHaveBeenCalledWith(item))

    handlers.get('open-item')!({ payload: { id: 'нет-такой' } })
    await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Запись не найдена'))

    mocks.getItem.mockClear()
    handlers.get('open-item')!({ payload: { id: 5 } })
    handlers.get('open-item')!({ payload: null })
    await tick()
    expect(mocks.getItem).not.toHaveBeenCalled()
  })

  it('приём включён: запуск сервера; не запустился — toast со ссылкой на настройки', async () => {
    await start({ extEnabled: true, extPort: 50123, extToken: TOKEN })
    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Приём от расширения не запущен',
        expect.objectContaining({
          description: 'Command ext_server_apply not found',
          action: expect.objectContaining({ label: 'Настройки' }),
        }),
      ),
    )
    expect(calls('ext_server_apply')).toEqual([['ext_server_apply', { enabled: true, port: 50123, token: TOKEN }]])
  })

  it('приём включён без токена — toast, в Rust ничего не уходит', async () => {
    await start({ extEnabled: true, extToken: '' })
    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Приём от расширения не запущен',
        expect.objectContaining({ description: 'Токен расширения не создан' }),
      ),
    )
    expect(calls('ext_server_apply')).toEqual([])
  })

  it('сервер запустился — без toast', async () => {
    await start({ extEnabled: true, extToken: TOKEN }, { ext_server_apply: () => ({ running: true, port: 47821 }) })
    await vi.waitFor(() => expect(calls('ext_server_apply')).toHaveLength(1))
    await tick()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('сочетание занято — toast, как раньше', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, globalShortcut: 'Alt+Q' })
    mocks.invoke.mockResolvedValue(null)
    mocks.unregisterAll.mockResolvedValue(undefined)
    mocks.register.mockRejectedValue(new Error('HotKey already registered'))
    mocks.windowListen.mockResolvedValue(() => {})
    mocks.globalListen.mockResolvedValue(() => {})
    await initDesktop()
    expect(mocks.toastError).toHaveBeenCalledWith('Сочетание Alt+Q не назначено', expect.any(Object))
  })
})
