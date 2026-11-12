import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { isValidSetting } from '@/lib/settingsSchema'
import { DEFAULT_SETTINGS, type MetaRecord, type Settings } from '@/types'

function isSettingKey(key: string): key is keyof Settings {
  return Object.hasOwn(DEFAULT_SETTINGS, key)
}

/**
 * Накладывает сохранённые значения на DEFAULT_SETTINGS.
 * Чужие ключи meta и значения не того типа (например, из старого импорта) игнорируются.
 */
export function mergeSettings(records: readonly MetaRecord[]): Settings {
  const result: Settings = { ...DEFAULT_SETTINGS }
  const target = result as unknown as Record<string, unknown>
  for (const { key, value } of records) {
    if (!isSettingKey(key)) continue
    if (!isValidSetting(key, value)) continue
    target[key] = value
  }
  return result
}

export async function getSettings(): Promise<Settings> {
  const keys = Object.keys(DEFAULT_SETTINGS)
  const records = await db.meta.bulkGet(keys)
  return mergeSettings(records.filter((r): r is MetaRecord => !!r))
}

export async function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
  await db.meta.put({ key, value })
}

/** Пакетное сохранение нескольких настроек. */
export async function setSettings(patch: Partial<Settings>): Promise<void> {
  const records = Object.entries(patch)
    .filter(([key, value]) => isSettingKey(key) && value !== undefined)
    .map(([key, value]) => ({ key, value }))
  if (records.length) await db.meta.bulkPut(records)
}

/** Live-настройки: undefined, пока идёт первое чтение. */
export function useSettings(): Settings | undefined {
  return useLiveQuery(getSettings, [])
}
