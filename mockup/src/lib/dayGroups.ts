import { startOfDay } from '@/lib/dates'
import { formatDayLabel, NO_DATE } from '@/lib/itemTitle'

export type DayEntry<T> = { kind: 'header'; key: string; label: string } | { kind: 'row'; row: T }

/** Начало суток отметки; null — отметку нельзя показать датой (NaN, вне диапазона Date). */
function dayOf(ts: number): number | null {
  if (typeof ts !== 'number' || Number.isNaN(new Date(ts).getTime())) return null
  const day = startOfDay(ts)
  return Number.isNaN(day) ? null : day
}

/**
 * Вставляет заголовок перед первой строкой каждых суток (по порядку строк). Подпись — formatDayLabel(ts, now).
 * Ключ заголовка — его порядковый номер и начало суток: при дозагрузке строк в конец прежние ключи не меняются,
 * а сутки, встретившиеся дважды не подряд (сортировка по названию, релевантность), получают разные ключи.
 */
export function groupByDay<T>(rows: readonly T[], tsOf: (row: T) => number, now: number): DayEntry<T>[] {
  const out: DayEntry<T>[] = []
  let headers = 0
  let current: number | null = null
  for (const row of rows) {
    const ts = tsOf(row)
    const day = dayOf(ts)
    if (headers === 0 || day !== current) {
      out.push({
        kind: 'header',
        key: `d-${headers}-${day ?? 'none'}`,
        label: day === null ? NO_DATE : formatDayLabel(ts, now),
      })
      headers++
      current = day
    }
    out.push({ kind: 'row', row })
  }
  return out
}
