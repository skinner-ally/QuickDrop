import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/db'
import { createItem } from '@/db/repo'
import { getSettings, setSettings } from '@/db/settings'

const mocks = vi.hoisted(() => ({
  tauri: true,
  invoke: vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>(),
  register: vi.fn<(shortcut: string, cb: unknown) => Promise<void>>(),
  unregisterAll: vi.fn<() => Promise<void>>(),
}))

vi.mock('@/lib/platform', () => ({
  isTauri: () => mocks.tauri,
  isCaptureWindow: () => false,
  isMac: () => false,
  modKey: () => 'Ctrl',
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/plugin-global-shortcut', () => ({
  register: mocks.register,
  unregisterAll: mocks.unregisterAll,
}))

import { applyImportedShellSettings, clearAllDataAndStopExtension } from './dataDesktop'
import { applyGlobalShortcut, globalShortcutFailure } from './desktop'
import { DEFAULT_SETTINGS } from '@/types'

const TOKEN = 'A'.repeat(43)

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.files.clear(), db.categories.clear(), db.meta.clear()])
  mocks.tauri = true
  mocks.invoke.mockReset()
  mocks.invoke.mockResolvedValue({ running: false, port: null })
  mocks.register.mockReset()
  mocks.register.mockResolvedValue(undefined)
  mocks.unregisterAll.mockReset()
  mocks.unregisterAll.mockResolvedValue(undefined)
})

const applyCalls = () => mocks.invoke.mock.calls.filter(([cmd]) => cmd === 'ext_server_apply')

describe('clearAllDataAndStopExtension', () => {
  it('стирает данные и токен и останавливает приём ровно один раз', async () => {
    await createItem({ type: 'text', content: 'x' })
    await setSettings({ extEnabled: true, extToken: TOKEN, extPort: 50000 })
    expect(await clearAllDataAndStopExtension()).toBeNull()
    expect(await db.items.count()).toBe(0)
    const s = await getSettings()
    expect(s.extEnabled).toBe(false)
    expect(s.extToken).toBe('')
    expect(applyCalls()).toEqual([['ext_server_apply', { enabled: false, port: 47821, token: '' }]])
  })

  it('отказ остановки → текст ошибки для toast; данные всё равно стёрты', async () => {
    await createItem({ type: 'text', content: 'x' })
    mocks.invoke.mockRejectedValue('Порт не закрылся')
    expect(await clearAllDataAndStopExtension()).toBe('Порт не закрылся')
    expect(await db.items.count()).toBe(0)
  })

  it('вне Tauri только стирает', async () => {
    mocks.tauri = false
    await createItem({ type: 'text', content: 'x' })
    expect(await clearAllDataAndStopExtension()).toBeNull()
    expect(await db.items.count()).toBe(0)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})

describe('applyImportedShellSettings', () => {
  const DEFAULT_SHORTCUT = DEFAULT_SETTINGS.globalShortcut

  /** Как при запуске: действует сочетание по умолчанию. */
  async function activate(shortcut: string = DEFAULT_SHORTCUT) {
    expect(await applyGlobalShortcut(shortcut)).toEqual({ ok: true })
    mocks.register.mockClear()
    mocks.unregisterAll.mockClear()
  }

  it('передаёт в Rust флаги из сохранённых настроек', async () => {
    await activate()
    await setSettings({ closeToTray: true, captureWindow: false })
    expect(await applyImportedShellSettings()).toEqual({ shellOk: true })
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('set_shell_options', { closeToTray: true, captureWindow: false })
  })

  it('сочетание из копии совпадает с действующим — повторно не регистрируется', async () => {
    await activate()
    await applyImportedShellSettings()
    expect(mocks.register).not.toHaveBeenCalled()
    expect(mocks.unregisterAll).not.toHaveBeenCalled()
  })

  it('другое сочетание из копии регистрируется сразу', async () => {
    await activate()
    await setSettings({ globalShortcut: 'Alt+Q' })
    expect(await applyImportedShellSettings()).toEqual({ shellOk: true })
    expect(mocks.register).toHaveBeenCalledExactlyOnceWith('Alt+Q', expect.any(Function))
    expect(globalShortcutFailure()).toBeNull()
    // Следующий импорт с тем же значением уже ничего не делает.
    mocks.register.mockClear()
    await applyImportedShellSettings()
    expect(mocks.register).not.toHaveBeenCalled()
  })

  it('сочетание из копии занято — возвращается прежнее, новое помечено неприменённым', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await activate()
    mocks.register.mockImplementation(async (s) => {
      if (s === 'Alt+Q') throw new Error('HotKey already registered')
    })
    await setSettings({ globalShortcut: 'Alt+Q' })
    const r = await applyImportedShellSettings()
    expect(r.shellOk).toBe(true)
    expect(r.shortcutError).toBe('Сочетание Alt+Q из копии не назначено: занято другой программой или записано неверно')
    expect(mocks.register.mock.calls.map(([s]) => s)).toEqual(['Alt+Q', DEFAULT_SHORTCUT])
    expect(globalShortcutFailure()).toBe('Alt+Q')
    // Прежнее снова действует: импорт копии с ним ничего не перерегистрирует.
    mocks.register.mockClear()
    await setSettings({ globalShortcut: DEFAULT_SHORTCUT })
    await applyImportedShellSettings()
    expect(mocks.register).not.toHaveBeenCalled()
  })

  it('отказ команды → shellOk: false; вне Tauri — ничего не вызывается', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await activate()
    mocks.invoke.mockRejectedValue(new Error('нет'))
    expect(await applyImportedShellSettings()).toEqual({ shellOk: false })
    mocks.tauri = false
    mocks.invoke.mockClear()
    await setSettings({ globalShortcut: 'Alt+Q' })
    expect(await applyImportedShellSettings()).toEqual({ shellOk: false })
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.register).not.toHaveBeenCalled()
  })
})
