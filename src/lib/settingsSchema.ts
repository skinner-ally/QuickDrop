import { BACKUP_PERIODS, DEFAULT_SETTINGS, FONT_PREFS, SCENE_PREFS, THEMES, type Settings } from '@/types'

/** Предел длины строковой настройки, символов. */
export const MAX_SETTING_STRING = 4096

const ENUM_VALUES: Partial<Record<keyof Settings, readonly string[]>> = {
  theme: THEMES,
  scene: SCENE_PREFS,
  font: FONT_PREFS,
  backupEvery: BACKUP_PERIODS,
}

/** Целочисленные настройки: [наименьшее, наибольшее] включительно. */
const INT_RANGES: Partial<Record<keyof Settings, readonly [number, number]>> = {
  trashDays: [0, 3650],
  backupKeep: [1, 100],
  extPort: [1024, 65535],
}

/**
 * Годится ли значение для настройки key: тип как у значения по умолчанию плюс правила поля.
 * Единая проверка для чтения из meta (mergeSettings) и импорта (sanitizeSettings).
 */
export function isValidSetting<K extends keyof Settings>(key: K, value: unknown): value is Settings[K] {
  // Ключ приходит и из чужих данных (meta, копия): hasOwn отсекает '__proto__', 'constructor' и т.п.
  if (!Object.hasOwn(DEFAULT_SETTINGS, key)) return false
  if (typeof value !== typeof DEFAULT_SETTINGS[key]) return false

  if (typeof value === 'string') {
    if (value.length > MAX_SETTING_STRING) return false
    const allowed = ENUM_VALUES[key]
    return !allowed || allowed.includes(value)
  }

  if (typeof value === 'number') {
    // typeof не отличает NaN и Infinity от числа.
    if (!Number.isFinite(value)) return false
    const range = INT_RANGES[key]
    if (range) return Number.isInteger(value) && value >= range[0] && value <= range[1]
    // Отметки времени (мс): 0 — «ни разу».
    if (key === 'backupLastAt' || key === 'aiAutoOcrSince') return value >= 0
  }

  return true
}
