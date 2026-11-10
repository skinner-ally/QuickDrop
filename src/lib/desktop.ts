import { getSettings } from '@/db/settings'
import { isTauri } from '@/lib/platform'
import { useUi } from '@/store/ui'

/** Показать и сфокусировать главное окно. */
async function raiseWindow(): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  await win.unminimize()
  await win.show()
  await win.setFocus()
}

async function registerShortcut(shortcut: string): Promise<void> {
  const { register, unregisterAll } = await import('@tauri-apps/plugin-global-shortcut')
  await unregisterAll()
  await register(shortcut, (e) => {
    if (e.state !== 'Pressed') return
    void raiseWindow()
      .catch((err) => console.warn('[desktop] не удалось показать окно', err))
      .finally(() => useUi.getState().openCapture())
  })
}

/** Инициализация desktop-оболочки: глобальное сочетание из настроек. Вне Tauri ничего не делает. */
export async function initDesktop(): Promise<void> {
  if (!isTauri()) return
  try {
    const { globalShortcut } = await getSettings()
    if (globalShortcut) await registerShortcut(globalShortcut)
  } catch (err) {
    console.warn('[desktop] не удалось зарегистрировать глобальное сочетание', err)
  }
}

/** Перерегистрация глобального сочетания при изменении настройки. */
export async function applyGlobalShortcut(shortcut: string): Promise<{ ok: boolean; error?: string }> {
  if (!isTauri()) return { ok: false, error: 'Доступно только в настольной версии' }
  const value = shortcut.trim()
  if (!value) return { ok: false, error: 'Укажите сочетание клавиш' }
  try {
    await registerShortcut(value)
    return { ok: true }
  } catch (err) {
    console.warn('[desktop] сочетание не зарегистрировано', err)
    // Не оставляем приложение без сочетания: пробуем вернуть прежнее
    try {
      const { globalShortcut } = await getSettings()
      if (globalShortcut && globalShortcut !== value) await registerShortcut(globalShortcut)
    } catch {
      /* ignore */
    }
    return { ok: false, error: 'Сочетание занято другой программой или записано неверно' }
  }
}

/** Открыть ссылку в системном браузере (только http/https). Вне Tauri возвращает false. */
export async function openExternal(url: string): Promise<boolean> {
  if (!isTauri()) return false
  try {
    if (!/^https?:\/\//i.test(url)) return false
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
    return true
  } catch (err) {
    console.warn('[desktop] не удалось открыть ссылку', err)
    return false
  }
}
