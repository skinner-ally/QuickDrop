import { describe, expect, it } from 'vitest'
import {
  DAY_MS,
  addDays,
  endOfDay,
  formatDateToken,
  parseDateToken,
  relativeRange,
  startOfDay,
} from './dates'

// Ожидаемые значения строятся через new Date(y, m, d): тест не зависит от часового пояса.
const at = (y: number, m: number, d: number, h = 0, min = 0, s = 0, ms = 0) =>
  new Date(y, m, d, h, min, s, ms).getTime()
const day = (y: number, m: number, d: number) => ({ from: at(y, m, d), to: at(y, m, d + 1) - 1 })

/** Среда, 11 ноября 2026, 15:30 по местному времени. */
const NOW = at(2026, 10, 11, 15, 30)

describe('startOfDay / endOfDay', () => {
  it('границы суток по местному времени', () => {
    expect(DAY_MS).toBe(86_400_000)
    expect(startOfDay(NOW)).toBe(at(2026, 10, 11))
    expect(endOfDay(NOW)).toBe(at(2026, 10, 11, 23, 59, 59, 999))
    expect(endOfDay(NOW)).toBe(at(2026, 10, 12) - 1)
  })

  it('полночь и последняя миллисекунда остаются в своих сутках', () => {
    const midnight = at(2026, 10, 11)
    expect(startOfDay(midnight)).toBe(midnight)
    expect(endOfDay(midnight)).toBe(at(2026, 10, 12) - 1)
    expect(startOfDay(midnight - 1)).toBe(at(2026, 10, 10))
    expect(endOfDay(midnight - 1)).toBe(midnight - 1)
    expect(startOfDay(endOfDay(NOW))).toBe(startOfDay(NOW))
    expect(endOfDay(startOfDay(NOW))).toBe(endOfDay(NOW))
  })

  it('конец месяца и года', () => {
    expect(endOfDay(at(2026, 11, 31, 8))).toBe(at(2027, 0, 1) - 1)
    expect(endOfDay(at(2028, 1, 29, 8))).toBe(at(2028, 2, 1) - 1)
  })
})

describe('addDays', () => {
  it('календарные дни с сохранением времени суток', () => {
    expect(addDays(NOW, 0)).toBe(NOW)
    expect(addDays(NOW, 1)).toBe(at(2026, 10, 12, 15, 30))
    expect(addDays(NOW, -1)).toBe(at(2026, 10, 10, 15, 30))
  })

  it('через смену месяца и года', () => {
    expect(addDays(at(2026, 0, 31, 10), 1)).toBe(at(2026, 1, 1, 10))
    expect(addDays(at(2026, 2, 1), -1)).toBe(at(2026, 1, 28))
    expect(addDays(at(2028, 1, 28), 1)).toBe(at(2028, 1, 29))
    expect(addDays(at(2026, 11, 31, 23, 59), 1)).toBe(at(2027, 0, 1, 23, 59))
    expect(addDays(at(2026, 0, 1), -1)).toBe(at(2025, 11, 31))
    expect(addDays(at(2026, 10, 11), -364)).toBe(at(2025, 10, 12))
    expect(addDays(at(2026, 10, 11), 365)).toBe(at(2027, 10, 11))
  })
})

describe('relativeRange', () => {
  it('сегодня и вчера — целые сутки', () => {
    expect(relativeRange('today', NOW)).toEqual(day(2026, 10, 11))
    expect(relativeRange('yesterday', NOW)).toEqual(day(2026, 10, 10))
  })

  it('неделя, месяц, год — последние 7 / 30 / 365 календарных дней, включая сегодня', () => {
    const end = at(2026, 10, 12) - 1
    expect(relativeRange('week', NOW)).toEqual({ from: at(2026, 10, 5), to: end })
    expect(relativeRange('month', NOW)).toEqual({ from: at(2026, 9, 13), to: end })
    expect(relativeRange('year', NOW)).toEqual({ from: at(2025, 10, 12), to: end })
  })

  it('не зависит от времени суток и переходит через границу месяца и года', () => {
    expect(relativeRange('week', at(2026, 10, 11))).toEqual(relativeRange('week', at(2026, 10, 11, 23, 59, 59, 999)))
    expect(relativeRange('week', at(2026, 2, 3, 9))).toEqual({ from: at(2026, 1, 25), to: at(2026, 2, 4) - 1 })
    expect(relativeRange('yesterday', at(2026, 0, 1, 0, 5))).toEqual(day(2025, 11, 31))
    expect(relativeRange('month', at(2026, 0, 10, 12))).toEqual({ from: at(2025, 11, 12), to: at(2026, 0, 11) - 1 })
  })
})

describe('parseDateToken', () => {
  it('день: ГГГГ-ММ-ДД и ДД.ММ.ГГГГ, день и месяц — 1–2 цифры', () => {
    expect(parseDateToken('2026-11-05', NOW)).toEqual(day(2026, 10, 5))
    expect(parseDateToken('2026-1-5', NOW)).toEqual(day(2026, 0, 5))
    expect(parseDateToken('05.11.2026', NOW)).toEqual(day(2026, 10, 5))
    expect(parseDateToken('5.1.2026', NOW)).toEqual(day(2026, 0, 5))
    expect(parseDateToken(' 2026-11-05 ', NOW)).toEqual(day(2026, 10, 5))
    expect(parseDateToken('29.02.2028', NOW)).toEqual(day(2028, 1, 29))
    expect(parseDateToken('31.12.2026', NOW)).toEqual({ from: at(2026, 11, 31), to: at(2027, 0, 1) - 1 })
  })

  it('месяц: ГГГГ-ММ и ММ.ГГГГ', () => {
    const nov = { from: at(2026, 10, 1), to: at(2026, 11, 1) - 1 }
    expect(parseDateToken('2026-11', NOW)).toEqual(nov)
    expect(parseDateToken('11.2026', NOW)).toEqual(nov)
    expect(parseDateToken('2026-2', NOW)).toEqual({ from: at(2026, 1, 1), to: at(2026, 2, 1) - 1 })
    expect(parseDateToken('12.2026', NOW)).toEqual({ from: at(2026, 11, 1), to: at(2027, 0, 1) - 1 })
  })

  it('год: ровно 4 цифры, 1970…2999', () => {
    expect(parseDateToken('2026', NOW)).toEqual({ from: at(2026, 0, 1), to: at(2027, 0, 1) - 1 })
    expect(parseDateToken('1970', NOW)).toEqual({ from: at(1970, 0, 1), to: at(1971, 0, 1) - 1 })
    expect(parseDateToken('2999', NOW)).toEqual({ from: at(2999, 0, 1), to: at(3000, 0, 1) - 1 })
    expect(parseDateToken('1969', NOW)).toBeNull()
    expect(parseDateToken('3000', NOW)).toBeNull()
    expect(parseDateToken('02026', NOW)).toBeNull()
    expect(parseDateToken('26', NOW)).toBeNull()
  })

  it('периоды по-английски и по-русски, без учёта регистра', () => {
    for (const [names, period] of [
      [['today', 'сегодня', 'TODAY', 'Сегодня'], 'today'],
      [['yesterday', 'вчера', 'Вчера'], 'yesterday'],
      [['week', 'неделя', 'Week'], 'week'],
      [['month', 'месяц'], 'month'],
      [['year', 'год', 'ГОД'], 'year'],
    ] as const) {
      for (const name of names) expect(parseDateToken(name, NOW), name).toEqual(relativeRange(period, NOW))
    }
    expect(parseDateToken('today', Number.NaN)).toBeNull()
  })

  it('диапазон A..B: от начала A до конца B', () => {
    expect(parseDateToken('2026-11-01..2026-11-05', NOW)).toEqual({ from: at(2026, 10, 1), to: at(2026, 10, 6) - 1 })
    expect(parseDateToken('01.11.2026..2026-12', NOW)).toEqual({ from: at(2026, 10, 1), to: at(2027, 0, 1) - 1 })
    expect(parseDateToken('2025..2026', NOW)).toEqual({ from: at(2025, 0, 1), to: at(2027, 0, 1) - 1 })
    expect(parseDateToken('2026-11-05..2026-11-05', NOW)).toEqual(day(2026, 10, 5))
    // Начало A не позже конца B — диапазон годен, даже если B «внутри» A.
    expect(parseDateToken('2026-11..2026-11-05', NOW)).toEqual({ from: at(2026, 10, 1), to: at(2026, 10, 6) - 1 })
  })

  it('неверное значение — null', () => {
    for (const bad of [
      '',
      '   ',
      'foo',
      'a,b',
      '31.02.2026',
      '29.02.2027',
      '2026-13-45',
      '2026-11-31',
      '2026-00-10',
      '2026-11-00',
      '2026-13',
      '2026-0',
      '13.2026',
      '0.2026',
      '26-11-05',
      '5.11.26',
      '2026-11-5x',
      '2026/11/05',
      '2026-11-05,2026-11-06',
      '2026-11-05..',
      '..2026-11-05',
      '2026-11-05..foo',
      '2026-11-05..2026-11-01',
      '2027..2026',
      'week..today',
      '2026-11-01..today',
      '2026-11-01..2026-11-03..2026-11-05',
    ]) {
      expect(parseDateToken(bad, NOW), JSON.stringify(bad)).toBeNull()
    }
  })
})

describe('formatDateToken', () => {
  it('ГГГГ-ММ-ДД по местному времени', () => {
    expect(formatDateToken(at(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(formatDateToken(at(2026, 10, 11))).toBe('2026-11-11')
    expect(formatDateToken(at(2026, 11, 31, 23, 59, 59, 999))).toBe('2026-12-31')
    expect(formatDateToken(Number.NaN)).toBe('')
  })

  it('разбирается обратно в те же сутки', () => {
    for (const ts of [NOW, at(2026, 0, 1), at(2028, 1, 29, 23, 59, 59, 999), at(1999, 11, 31, 12)]) {
      expect(parseDateToken(formatDateToken(ts), NOW)).toEqual({ from: startOfDay(ts), to: endOfDay(ts) })
    }
  })
})
