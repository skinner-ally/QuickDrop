import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { aiHostLabel, visionAvailability } from '@/lib/ai'
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
  await setSettings({ [key]: value } as Partial<Settings>)
}

/** Настройки, от которых зависит, может ли автораспознавание отправлять изображения и куда. */
const AUTO_OCR_KEYS: ReadonlyArray<keyof Settings> = [
  'aiEnabled',
  'aiApiKey',
  'aiBaseUrl',
  'aiModel',
  'aiVisionModel',
  'aiAutoOcr',
]

/** Автораспознавание включено и ИИ готов к запросам. */
function autoOcrActive(s: Settings): boolean {
  return s.aiAutoOcr && visionAvailability(s) === null
}

/**
 * Автораспознавание стало действовать (ИИ включили снова, вернули ключ или модель) или сменился хост API:
 * момент отсчёта задела сдвигается на «сейчас». Иначе записи, накопленные, пока ИИ был выключен, или согласие,
 * данное другому хосту, ушли бы в сеть без вопроса. Явно переданный aiAutoOcrSince не трогается.
 */
function withAutoOcrSince(prev: Settings, patch: Partial<Settings>): Partial<Settings> {
  if (patch.aiAutoOcrSince !== undefined) return patch
  const next: Settings = { ...prev, ...patch }
  if (!autoOcrActive(next)) return patch
  if (autoOcrActive(prev) && aiHostLabel(prev.aiBaseUrl) === aiHostLabel(next.aiBaseUrl)) return patch
  return { ...patch, aiAutoOcrSince: Date.now() }
}

/** Пакетное сохранение нескольких настроек (одной операцией). */
export async function setSettings(patch: Partial<Settings>): Promise<void> {
  const defined = Object.fromEntries(
    Object.entries(patch).filter(([key, value]) => isSettingKey(key) && value !== undefined),
  ) as Partial<Settings>
  const toRecords = (p: Partial<Settings>): MetaRecord[] => Object.entries(p).map(([key, value]) => ({ key, value }))
  if (!AUTO_OCR_KEYS.some((key) => key in defined)) {
    const records = toRecords(defined)
    if (records.length) await db.meta.bulkPut(records)
    return
  }
  // Чтение и запись — в одной транзакции: обход задела не попадёт между сменой настройки и сдвигом отсчёта.
  await db.transaction('rw', db.meta, async () => {
    const records = toRecords(withAutoOcrSince(await getSettings(), defined))
    if (records.length) await db.meta.bulkPut(records)
  })
}

/** Live-настройки: undefined, пока идёт первое чтение. */
export function useSettings(): Settings | undefined {
  return useLiveQuery(getSettings, [])
}
