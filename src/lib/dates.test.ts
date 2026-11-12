import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  DATE_PRESETS,
  DAY_MS,
  addDays,
  customDateRange,
  endOfDay,
  formatDateRange,
  formatDateToken,
  parseDateInput,
  parseDateToken,
  presetOf,
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

describe('DATE_PRESETS / presetOf', () => {
  it('три быстрых периода с подписями', () => {
    expect(DATE_PRESETS).toEqual([
      { id: 'today', label: 'Сегодня' },
      { id: 'week', label: 'За неделю' },
      { id: 'month', label: 'За месяц' },
    ])
  })

  it('узнаёт период только при точном совпадении обеих границ', () => {
    for (const { id } of DATE_PRESETS) {
      const r = relativeRange(id, NOW)
      expect(presetOf(r.from, r.to, NOW)).toBe(id)
      // в другой момент тех же суток — тот же период
      expect(presetOf(r.from, r.to, at(2026, 10, 11, 0, 0))).toBe(id)
      expect(presetOf(r.from, r.to - 1, NOW)).toBeNull()
      expect(presetOf(r.from + 1, r.to, NOW)).toBeNull()
    }
    // «вчера» и «год» в быстрые периоды не входят
    const y = relativeRange('yesterday', NOW)
    expect(presetOf(y.from, y.to, NOW)).toBeNull()
    const year = relativeRange('year', NOW)
    expect(presetOf(year.from, year.to, NOW)).toBeNull()
  })

  it('на следующие сутки прежний период уже не «быстрый»', () => {
    const r = relativeRange('week', NOW)
    expect(presetOf(r.from, r.to, at(2026, 10, 12, 0, 0))).toBeNull()
  })

  it('одна граница или негодное now — null', () => {
    const r = relativeRange('today', NOW)
    expect(presetOf(r.from, undefined, NOW)).toBeNull()
    expect(presetOf(undefined, r.to, NOW)).toBeNull()
    expect(presetOf(undefined, undefined, NOW)).toBeNull()
    expect(presetOf(r.from, r.to, Number.NaN)).toBeNull()
  })

  it('свой период, совпавший с «Сегодня», неотличим по границам: различает только признак customDates', () => {
    const own = customDateRange(formatDateToken(NOW), formatDateToken(NOW))
    if (!own.ok || !own.range) throw new Error('ожидался диапазон')
    expect(presetOf(own.range.from, own.range.to, NOW)).toBe('today')
  })

  it('полночь: последняя миллисекунда суток — ещё прежний период, первая — уже новый', () => {
    const r = relativeRange('week', NOW)
    expect(presetOf(r.from, r.to, at(2026, 10, 11, 23, 59, 59, 999))).toBe('week')
    expect(presetOf(r.from, r.to, at(2026, 10, 12))).toBeNull()
    const next = relativeRange('week', at(2026, 10, 12))
    expect(next).toEqual({ from: at(2026, 10, 6), to: at(2026, 10, 13) - 1 })
  })
})

describe('parseDateInput', () => {
  it('начало суток указанной даты', () => {
    expect(parseDateInput('2026-11-12')).toBe(at(2026, 10, 12))
    expect(parseDateInput(' 2028-02-29 ')).toBe(at(2028, 1, 29))
    expect(parseDateInput('1970-01-01')).toBe(at(1970, 0, 1))
    expect(parseDateInput('2999-12-31')).toBe(at(2999, 11, 31))
  })

  it('пусто, не дата, несуществующий день, год вне 1970…2999 — null', () => {
    for (const bad of ['', '   ', '2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '2026-1-5', '12.11.2026',
      '1969-12-31', '3000-01-01', '20261-01-01', 'today', '2026-11-12T10:00']) {
      expect(parseDateInput(bad), bad).toBeNull()
    }
    expect(parseDateInput(undefined as unknown as string)).toBeNull()
  })

  it('обратно к formatDateToken', () => {
    for (const ts of [NOW, at(2026, 0, 1, 23, 59), at(2000, 1, 29, 12)]) {
      expect(parseDateInput(formatDateToken(ts))).toBe(startOfDay(ts))
    }
  })
})

describe('customDateRange', () => {
  it('обе даты: начало суток «с» и конец суток «по»', () => {
    expect(customDateRange('2026-11-01', '2026-11-10')).toEqual({
      ok: true,
      range: { from: at(2026, 10, 1), to: at(2026, 10, 11) - 1 },
    })
  })

  it('один день: from и to одних суток', () => {
    expect(customDateRange('2026-11-12', '2026-11-12')).toEqual({ ok: true, range: day(2026, 10, 12) })
  })

  it('пустое поле — граница не задана; оба пусты — снять период', () => {
    expect(customDateRange('2026-11-01', '')).toEqual({ ok: true, range: { from: at(2026, 10, 1) } })
    expect(customDateRange('', '2026-11-10')).toEqual({ ok: true, range: { to: at(2026, 10, 11) - 1 } })
    expect(customDateRange('', '  ')).toEqual({ ok: true, range: null })
  })

  it('ошибки', () => {
    expect(customDateRange('2026-11-10', '2026-11-01')).toEqual({ ok: false, error: 'Дата начала позже даты конца' })
    expect(customDateRange('2026-02-30', '')).toEqual({ ok: false, error: 'Неверная дата' })
    expect(customDateRange('', '3000-01-01')).toEqual({ ok: false, error: 'Неверная дата' })
    expect(customDateRange('1969-12-31', '2026-01-01')).toEqual({ ok: false, error: 'Неверная дата' })
    expect(customDateRange('2026-01-01', 'abc')).toEqual({ ok: false, error: 'Неверная дата' })
  })
})

describe('formatDateRange', () => {
  it('диапазон, одна дата и открытые границы', () => {
    expect(formatDateRange(at(2026, 10, 12), at(2026, 10, 14, 23, 59))).toBe('12.11.2026 – 14.11.2026')
    expect(formatDateRange(at(2026, 10, 12), at(2026, 10, 13) - 1)).toBe('12.11.2026')
    expect(formatDateRange(at(2026, 0, 5), undefined)).toBe('с 05.01.2026')
    expect(formatDateRange(undefined, at(2026, 10, 14, 23, 59))).toBe('по 14.11.2026')
    expect(formatDateRange(undefined, undefined)).toBe('')
  })

  it('совпадает с полями своего периода', () => {
    const r = customDateRange('2026-11-01', '2026-11-10')
    if (!r.ok || !r.range) throw new Error('ожидался диапазон')
    expect(formatDateRange(r.range.from, r.range.to)).toBe('01.11.2026 – 10.11.2026')
  })

  it('негодная отметка считается незаданной', () => {
    expect(formatDateRange(Number.NaN, at(2026, 10, 14))).toBe('по 14.11.2026')
    expect(formatDateRange(9e15, undefined)).toBe('')
  })
})

describe('при переводе часов (Europe/Berlin)', () => {
  const prevTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  beforeAll(() => {
    vi.stubEnv('TZ', 'Europe/Berlin')
  })
  afterAll(() => {
    // Снятие переменной пояс не возвращает: сначала явно прежний пояс, затем прежнее значение TZ.
    vi.stubEnv('TZ', prevTz)
    vi.unstubAllEnvs()
  })

  const HOUR = 3_600_000

  it('пояс действительно переключён', () => {
    expect(new Date(2026, 2, 28, 12).getTimezoneOffset()).toBe(-60)
    expect(new Date(2026, 2, 29, 12).getTimezoneOffset()).toBe(-120)
  })

  it('сутки перевода: 29.03 — 23 часа, 25.10 — 25 часов; границы — местная полночь', () => {
    const spring = customDateRange('2026-03-29', '2026-03-29')
    const autumn = customDateRange('2026-10-25', '2026-10-25')
    if (!spring.ok || !spring.range || !autumn.ok || !autumn.range) throw new Error('ожидался диапазон')
    expect(spring.range).toEqual({ from: at(2026, 2, 29), to: at(2026, 2, 30) - 1 })
    expect(spring.range.to! - spring.range.from! + 1).toBe(23 * HOUR)
    expect(autumn.range.to! - autumn.range.from! + 1).toBe(25 * HOUR)
    expect(startOfDay(at(2026, 2, 29, 23, 30))).toBe(at(2026, 2, 29))
    expect(endOfDay(at(2026, 9, 25, 1))).toBe(at(2026, 9, 26) - 1)
    expect(formatDateRange(spring.range.from, spring.range.to)).toBe('29.03.2026')
  })

  it('addDays через перевод часов сохраняет местное время суток', () => {
    expect(addDays(at(2026, 2, 28, 12), 1)).toBe(at(2026, 2, 29, 12))
    expect(addDays(at(2026, 2, 28, 12), 1) - at(2026, 2, 28, 12)).toBe(23 * HOUR)
    expect(addDays(at(2026, 9, 25, 12), -1)).toBe(at(2026, 9, 24, 12))
  })

  it('быстрые периоды через перевод часов: границы — полночь, период узнаётся весь день', () => {
    const now = at(2026, 2, 30, 9)
    const week = relativeRange('week', now)
    expect(week).toEqual({ from: at(2026, 2, 24), to: at(2026, 2, 31) - 1 })
    expect(presetOf(week.from, week.to, at(2026, 2, 30))).toBe('week')
    expect(presetOf(week.from, week.to, at(2026, 2, 30, 23, 59))).toBe('week')
    expect(presetOf(week.from, week.to, at(2026, 2, 31))).toBeNull()

    const today = relativeRange('today', at(2026, 9, 25, 2, 30))
    expect(today).toEqual({ from: at(2026, 9, 25), to: at(2026, 9, 26) - 1 })
    expect(presetOf(today.from, today.to, at(2026, 9, 25, 23, 59))).toBe('today')
  })
})
