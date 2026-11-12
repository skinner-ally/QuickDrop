import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { DAY_MS } from './dates'
import { formatDayLabel } from './itemTitle'
import {
  TRASH_DAYS_OPTIONS,
  trashDaysLabel,
  trashDaysLeft,
  trashLeftLabel,
  trashPurgeAt,
  trashPurgeNote,
} from './trash'

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m, d, h, min).getTime()
const NOW = at(2026, 10, 12, 15, 0)

describe('TRASH_DAYS_OPTIONS / trashDaysLabel', () => {
  it('сроки и подписи', () => {
    expect(TRASH_DAYS_OPTIONS).toEqual([7, 14, 30, 90, 365, 0])
    expect(TRASH_DAYS_OPTIONS.map(trashDaysLabel)).toEqual([
      '7 дней',
      '14 дней',
      '30 дней',
      '90 дней',
      '1 год',
      'Не очищать',
    ])
  })

  it('срок вне списка — «N дн.»; выключенная автоочистка — «Не очищать»', () => {
    expect(trashDaysLabel(60)).toBe('60 дн.')
    expect(trashDaysLabel(1)).toBe('1 дн.')
    expect(trashDaysLabel(3650)).toBe('3650 дн.')
    expect(trashDaysLabel(-5)).toBe('Не очищать')
    expect(trashDaysLabel(Number.NaN)).toBe('Не очищать')
  })
})

describe('trashPurgeAt', () => {
  it('deletedAt + срок × сутки — как в repo.purgeExpired', () => {
    expect(trashPurgeAt(NOW, 30)).toBe(NOW + 30 * DAY_MS)
    expect(trashPurgeAt(NOW, 7)).toBe(NOW + 7 * DAY_MS)
    // purgeExpired удаляет записи с deletedAt ≤ now − days × DAY_MS: в момент purgeAt запись уже подлежит очистке.
    const deletedAt = NOW - 30 * DAY_MS
    expect(trashPurgeAt(deletedAt, 30)).toBe(NOW)
  })

  it('автоочистка выключена или запись не в корзине — null', () => {
    expect(trashPurgeAt(NOW, 0)).toBeNull()
    expect(trashPurgeAt(NOW, -1)).toBeNull()
    expect(trashPurgeAt(NOW, Number.NaN)).toBeNull()
    expect(trashPurgeAt(NOW, Infinity)).toBeNull()
    expect(trashPurgeAt(undefined, 30)).toBeNull()
    expect(trashPurgeAt(Number.NaN, 30)).toBeNull()
  })

  it('момент вне диапазона Date — null (датой его не показать)', () => {
    expect(trashPurgeAt(8.64e15, 3650)).toBeNull()
    expect(trashPurgeAt(8.64e15 - 30 * DAY_MS, 30)).toBe(8.64e15)
  })
})

describe('trashDaysLeft', () => {
  it('только что удалённая — весь срок', () => {
    expect(trashDaysLeft(NOW, 30, NOW)).toBe(30)
    expect(trashDaysLeft(NOW - 1, 30, NOW)).toBe(30)
  })

  it('календарные сутки до дня очистки, а не часы', () => {
    expect(trashDaysLeft(NOW - 29 * DAY_MS, 30, NOW)).toBe(1)
    expect(trashDaysLeft(NOW - 10.5 * DAY_MS, 30, NOW)).toBe(20)
    // Очистка сегодня позже — уже «сегодня», а не «ещё 1 дн.».
    expect(trashDaysLeft(NOW - 30 * DAY_MS + 3_600_000, 30, NOW)).toBe(0)
    // Ночью: очистка послезавтра в 23:00 — 2 дня (по часам вышло бы 3).
    const night = at(2026, 10, 12, 1, 0)
    expect(trashDaysLeft(at(2026, 10, 14, 23, 0) - 7 * DAY_MS, 7, night)).toBe(2)
    // Поздно вечером: очистка завтра в 01:00 — 1 день.
    expect(trashDaysLeft(at(2026, 10, 13, 1, 0) - 7 * DAY_MS, 7, at(2026, 10, 12, 23, 0))).toBe(1)
  })

  it('срок наступил или прошёл — 0', () => {
    expect(trashDaysLeft(NOW - 30 * DAY_MS, 30, NOW)).toBe(0)
    expect(trashDaysLeft(NOW - 45 * DAY_MS, 30, NOW)).toBe(0)
  })

  it('выключенная автоочистка, нет deletedAt, негодное now — null', () => {
    expect(trashDaysLeft(NOW, 0, NOW)).toBeNull()
    expect(trashDaysLeft(undefined, 30, NOW)).toBeNull()
    expect(trashDaysLeft(NOW, 30, Number.NaN)).toBeNull()
    expect(trashDaysLeft(NOW, 30, 9e15)).toBeNull()
    expect(trashDaysLeft(8.64e15, 3650, NOW)).toBeNull()
  })
})

describe('trashPurgeNote', () => {
  it('сегодня — без скобок; иначе дата и остаток', () => {
    expect(trashPurgeNote(NOW - 30 * DAY_MS + 3_600_000, 30, NOW)).toBe('Удалится окончательно сегодня')
    expect(trashPurgeNote(NOW - 45 * DAY_MS, 30, NOW)).toBe('Удалится окончательно сегодня')
    expect(trashPurgeNote(NOW - 29 * DAY_MS, 30, NOW)).toBe('Удалится окончательно 13 ноября (ещё 1 дн.)')
    expect(trashPurgeNote(NOW, 30, NOW)).toBe('Удалится окончательно 12 декабря (ещё 30 дн.)')
    expect(trashPurgeNote(NOW, 365, NOW)).toBe('Удалится окончательно 12 ноября 2027 (ещё 365 дн.)')
  })

  it('дата и остаток не противоречат друг другу в любое время суток', () => {
    for (let h = 0; h < 24; h++) {
      const now = at(2026, 10, 12, h, 30)
      for (let dh = 0; dh < 24 * 4; dh += 5) {
        const deletedAt = now - 7 * DAY_MS + dh * 3_600_000
        const left = trashDaysLeft(deletedAt, 7, now)!
        const note = trashPurgeNote(deletedAt, 7, now)
        const day = formatDayLabel(trashPurgeAt(deletedAt, 7)!, now)
        if (day === 'Сегодня') expect(note, `${h}:30 +${dh} ч`).toBe('Удалится окончательно сегодня')
        else expect(note, `${h}:30 +${dh} ч`).toBe(`Удалится окончательно ${day} (ещё ${left} дн.)`)
        expect(note).not.toMatch(/Сегодня|сегодня \(/)
      }
    }
  })

  it('выключенная автоочистка, нет deletedAt, негодные отметки — пусто', () => {
    expect(trashPurgeNote(NOW, 0, NOW)).toBe('')
    expect(trashPurgeNote(undefined, 30, NOW)).toBe('')
    expect(trashPurgeNote(NOW, 30, Number.NaN)).toBe('')
    expect(trashPurgeNote(8.64e15, 3650, NOW)).toBe('')
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

  it('пояс действительно переключён', () => {
    expect(new Date(2026, 2, 28, 12).getTimezoneOffset()).toBe(-60)
    expect(new Date(2026, 2, 29, 12).getTimezoneOffset()).toBe(-120)
  })

  it('весна (29.03, сутки 23 ч): удалённая 28.03 в 23:30 на сутки очищается 30.03 — остаток 2', () => {
    const deletedAt = at(2026, 2, 28, 23, 30)
    expect(trashPurgeAt(deletedAt, 1)).toBe(at(2026, 2, 30, 0, 30))
    const now = at(2026, 2, 28, 23, 45)
    expect(trashDaysLeft(deletedAt, 1, now)).toBe(2)
    expect(trashPurgeNote(deletedAt, 1, now)).toBe('Удалится окончательно 30 марта (ещё 2 дн.)')
  })

  it('осень (25.10, сутки 25 ч): удалённая в 00:30 на сутки очищается в тот же день — «сегодня»', () => {
    const deletedAt = at(2026, 9, 25, 0, 30)
    expect(trashPurgeAt(deletedAt, 1)).toBe(at(2026, 9, 25, 23, 30))
    const now = at(2026, 9, 25, 1, 0)
    expect(trashDaysLeft(deletedAt, 1, now)).toBe(0)
    expect(trashPurgeNote(deletedAt, 1, now)).toBe('Удалится окончательно сегодня')
  })
})

describe('trashLeftLabel', () => {
  it('подписи', () => {
    expect(trashLeftLabel(null)).toBe('')
    expect(trashLeftLabel(0)).toBe('удалится сегодня')
    expect(trashLeftLabel(1)).toBe('ещё 1 дн.')
    expect(trashLeftLabel(30)).toBe('ещё 30 дн.')
  })

  it('вместе с trashDaysLeft', () => {
    expect(trashLeftLabel(trashDaysLeft(NOW, 30, NOW))).toBe('ещё 30 дн.')
    expect(trashLeftLabel(trashDaysLeft(NOW - 40 * DAY_MS, 30, NOW))).toBe('удалится сегодня')
    expect(trashLeftLabel(trashDaysLeft(NOW, 0, NOW))).toBe('')
  })
})
