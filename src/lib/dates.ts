/**
 * Календарные даты для поиска и списков. Всё — в локальном времени пользователя; границы суток
 * строятся через new Date(y, m, d), а дни прибавляются через setDate: сутки при переводе часов
 * длятся 23 или 25 часов, и арифметика в миллисекундах сдвигала бы границу.
 */
import { foldText } from './normalize'

export const DAY_MS = 86_400_000

/** Допустимые годы в датах запроса. */
export const MIN_DATE_YEAR = 1970
export const MAX_DATE_YEAR = 2999

export type DateRange = { from: number; to: number }
export type RelativePeriod = 'today' | 'yesterday' | 'week' | 'month' | 'year'

export const RELATIVE_PERIODS: readonly RelativePeriod[] = ['today', 'yesterday', 'week', 'month', 'year']

export function startOfDay(ts: number): number {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Последняя миллисекунда суток: начало следующих суток − 1. */
export function endOfDay(ts: number): number {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1
}

/** Сдвиг на календарные дни с сохранением местного времени суток. */
export function addDays(ts: number, days: number): number {
  const d = new Date(ts)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

/** Сколько дней охватывает период, считая сегодня. */
const PERIOD_DAYS: Record<Exclude<RelativePeriod, 'yesterday'>, number> = {
  today: 1,
  week: 7,
  month: 30,
  year: 365,
}

/** Отрезок периода относительно now: «неделя» — последние 7 календарных дней, включая сегодня. */
export function relativeRange(period: RelativePeriod, now: number): DateRange {
  const today = startOfDay(now)
  if (period === 'yesterday') {
    const day = addDays(today, -1)
    return { from: startOfDay(day), to: endOfDay(day) }
  }
  return { from: startOfDay(addDays(today, 1 - PERIOD_DAYS[period])), to: endOfDay(today) }
}

const PERIOD_ALIASES = new Map<string, RelativePeriod>([
  ['today', 'today'],
  ['сегодня', 'today'],
  ['yesterday', 'yesterday'],
  ['вчера', 'yesterday'],
  ['week', 'week'],
  ['неделя', 'week'],
  ['month', 'month'],
  ['месяц', 'month'],
  ['year', 'year'],
  ['год', 'year'],
])

const validYear = (y: number) => y >= MIN_DATE_YEAR && y <= MAX_DATE_YEAR

/** Отрезок [начало периода; начало следующего − 1 мс] между двумя календарными датами. */
function span(y: number, m: number, d: number, y2: number, m2: number, d2: number): DateRange {
  return { from: new Date(y, m, d).getTime(), to: new Date(y2, m2, d2).getTime() - 1 }
}

/** Дата-литерал: день, месяц или год. null — не дата или такой даты нет в календаре. */
function parseLiteral(s: string): DateRange | null {
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  let day: [number, number, number] | null = m ? [+m[1], +m[2], +m[3]] : null
  if (!day) {
    m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s)
    if (m) day = [+m[3], +m[2], +m[1]]
  }
  if (day) {
    const [y, mo, d] = day
    if (!validYear(y)) return null
    // Date «исправляет» 31.02 на 3 марта — сверяем, что дата осталась собой.
    const probe = new Date(y, mo - 1, d)
    if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) return null
    return span(y, mo - 1, d, y, mo - 1, d + 1)
  }

  m = /^(\d{4})-(\d{1,2})$/.exec(s)
  let month: [number, number] | null = m ? [+m[1], +m[2]] : null
  if (!month) {
    m = /^(\d{1,2})\.(\d{4})$/.exec(s)
    if (m) month = [+m[2], +m[1]]
  }
  if (month) {
    const [y, mo] = month
    if (!validYear(y) || mo < 1 || mo > 12) return null
    return span(y, mo - 1, 1, y, mo, 1)
  }

  if (/^\d{4}$/.test(s)) {
    const y = +s
    return validYear(y) ? span(y, 0, 1, y + 1, 0, 1) : null
  }
  return null
}

/**
 * Значение оператора даты: литерал (ГГГГ-ММ-ДД, ДД.ММ.ГГГГ, ГГГГ-ММ, ММ.ГГГГ, ГГГГ), период
 * (today, вчера, week…) или диапазон литералов A..B. null — разобрать нельзя.
 */
export function parseDateToken(raw: string, now: number): DateRange | null {
  const s = foldText(raw ?? '').trim()
  if (!s) return null

  const period = PERIOD_ALIASES.get(s)
  if (period) return Number.isFinite(now) ? relativeRange(period, now) : null

  const sep = s.indexOf('..')
  if (sep === -1) return parseLiteral(s)

  const a = parseLiteral(s.slice(0, sep).trim())
  const b = parseLiteral(s.slice(sep + 2).trim())
  if (!a || !b || a.from > b.to) return null
  return { from: a.from, to: b.to }
}

const pad = (n: number, len: number) => String(n).padStart(len, '0')

/** 'ГГГГ-ММ-ДД' по локальному времени; пустая строка для негодной отметки. */
export function formatDateToken(ts: number): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`
}
