import { clearAllData } from '@/db/seed'
import { getSettings } from '@/db/settings'
import { applyShellOptions, reapplyGlobalShortcut, stopExtensionServer } from '@/lib/desktop'
import { isTauri } from '@/lib/platform'
import type { Settings } from '@/types'

/**
 * Операции с данными, итог которых должен дойти и до оболочки Tauri: Rust не читает IndexedDB и узнаёт
 * о настройках только из команд. Отдельный модуль: seed.ts работает и в вебе, и в тестах без desktop.ts,
 * а мини-окно, которое импортирует desktop.ts, не должно тянуть демоданные.
 */

/**
 * «Удалить все данные»: стирает базу (вместе с токеном и флагом приёма) и останавливает приём от
 * расширения. Rust держит токен в памяти: без остановки старый секрет работал бы до перезапуска.
 * Возвращает текст ошибки остановки для toast или null. Ошибку стирания пробрасывает.
 */
export async function clearAllDataAndStopExtension(): Promise<string | null> {
  await clearAllData()
  if (!isTauri()) return null
  const status = await stopExtensionServer()
  return status.error?.trim() || null
}

export interface ImportedShellResult {
  /** Флаги трея и мини-окна применены; false — вне Tauri или отказ (вступят в силу при следующем запуске). */
  shellOk: boolean
  /** Глобальное сочетание из копии не назначено — текст для toast. */
  shortcutError?: string
}

/**
 * После импорта с заменой: флаги трея и мини-окна и глобальное сочетание из копии применяются в оболочке
 * сразу, а не при следующем запуске. Не бросает.
 */
export async function applyImportedShellSettings(): Promise<ImportedShellResult> {
  if (!isTauri()) return { shellOk: false }
  let settings: Settings
  try {
    settings = await getSettings()
  } catch (err) {
    console.warn('[data] настройки окна после импорта не применены', err)
    return { shellOk: false }
  }
  const [shellOk, shortcut] = await Promise.all([
    applyShellOptions(settings),
    reapplyGlobalShortcut(settings.globalShortcut),
  ])
  return shortcut.ok ? { shellOk } : { shellOk, shortcutError: shortcut.error }
}
