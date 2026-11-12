import { describe, expect, it } from 'vitest'
import { titleFromUrl } from './linkMeta'
import {
  displayTitle,
  formatBytes,
  formatDateTime,
  formatDayLabel,
  formatRelative,
  NO_DATE,
  TYPE_LABEL,
} from './itemTitle'

const base = { title: '', content: '' }

describe('displayTitle', () => {
  it('приоритеты', () => {
    expect(displayTitle({ ...base, title: ' Заг ', fileName: 'a.txt' })).toBe('Заг')
    expect(displayTitle({ ...base, linkMeta: { title: 'Мета', status: 'ok' } })).toBe('Мета')
    expect(displayTitle({ ...base, fileName: 'a.txt', content: 'x' })).toBe('a.txt')
    expect(displayTitle({ ...base, content: '\n\n  первая  \nвторая' })).toBe('первая')
  })
  it('обрезает длинную строку', () => {
    const r = displayTitle({ ...base, content: 'я'.repeat(200) })
    expect(r.length).toBeLessThanOrEqual(80)
    expect(r.endsWith('…')).toBe(true)
  })
  it('url и запасной вариант', () => {
    expect(displayTitle({ ...base, url: 'https://a.io' })).toBe(titleFromUrl('https://a.io'))
    expect(displayTitle({ ...base, url: 'https://dexie.org/docs/Tutorial/React' })).not.toMatch(/^https?:/)
    expect(displayTitle(base)).toBe('Без названия')
  })
})

describe('formatRelative', () => {
  const now = new Date(2025, 5, 15, 12, 0).getTime()
  it('короткие интервалы', () => {
    expect(formatRelative(now - 10_000, now)).toBe('только что')
    expect(formatRelative(now - 5 * 60_000, now)).toBe('5 мин назад')
    expect(formatRelative(now - 3 * 3_600_000, now)).toBe('3 ч назад')
  })
  it('вчера и дни', () => {
    expect(formatRelative(new Date(2025, 5, 14, 9, 0).getTime(), now)).toBe('вчера')
    expect(formatRelative(new Date(2025, 5, 12, 9, 0).getTime(), now)).toBe('3 дн назад')
  })
  it('дата', () => {
    expect(formatRelative(new Date(2025, 2, 12).getTime(), now)).toBe('12 мар')
    expect(formatRelative(new Date(2024, 2, 12).getTime(), now)).toBe('12 мар 2024')
  })
})

describe('formatDayLabel', () => {
  const now = new Date(2026, 10, 11, 12, 0).getTime()

  it('сегодня и вчера — по календарным суткам, а не по прошедшим часам', () => {
    expect(formatDayLabel(new Date(2026, 10, 11, 0, 0).getTime(), now)).toBe('Сегодня')
    expect(formatDayLabel(new Date(2026, 10, 11, 23, 59, 59, 999).getTime(), now)).toBe('Сегодня')
    expect(formatDayLabel(now, now)).toBe('Сегодня')
    expect(formatDayLabel(new Date(2026, 10, 10, 23, 59).getTime(), now)).toBe('Вчера')
    expect(formatDayLabel(new Date(2026, 10, 10, 0, 0).getTime(), now)).toBe('Вчера')
    // Через границу года.
    expect(formatDayLabel(new Date(2025, 11, 31, 18, 0).getTime(), new Date(2026, 0, 1, 0, 5).getTime())).toBe('Вчера')
  })

  it('дата: месяц словом, год — только если не текущий', () => {
    expect(formatDayLabel(new Date(2026, 10, 9, 23, 59).getTime(), now)).toBe('9 ноября')
    expect(formatDayLabel(new Date(2026, 0, 1).getTime(), now)).toBe('1 января')
    expect(formatDayLabel(new Date(2025, 10, 12, 8, 0).getTime(), now)).toBe('12 ноября 2025')
    expect(formatDayLabel(new Date(2025, 11, 30).getTime(), new Date(2026, 0, 1, 9, 0).getTime())).toBe('30 декабря 2025')
    // Завтрашний и более поздние дни (часы на другом устройстве спешили) — тоже датой.
    expect(formatDayLabel(new Date(2026, 10, 12, 0, 0).getTime(), now)).toBe('12 ноября')
    expect(formatDayLabel(new Date(2027, 2, 8).getTime(), now)).toBe('8 марта 2027')
  })

  it('now по умолчанию — текущее время', () => {
    expect(formatDayLabel(Date.now())).toBe('Сегодня')
  })

  it('негодная отметка — заглушка', () => {
    for (const bad of [9e15, -9e15, Number.NaN, Infinity]) {
      expect(formatDayLabel(bad, now)).toBe(NO_DATE)
      expect(formatDayLabel(now, bad)).toBe(NO_DATE)
    }
    expect(formatDayLabel(undefined as unknown as number, now)).toBe(NO_DATE)
    expect(formatDayLabel(8.64e15, now)).not.toBe(NO_DATE)
    expect(formatDayLabel(-8.64e15, now)).not.toBe(NO_DATE)
  })
})

describe('formatBytes', () => {
  it('единицы', () => {
    expect(formatBytes(0)).toBe('0 Б')
    expect(formatBytes(512)).toBe('512 Б')
    expect(formatBytes(1536)).toBe('1,5 КБ')
    expect(formatBytes(3.2 * 1024 * 1024)).toBe('3,2 МБ')
    expect(formatBytes(1024 ** 3)).toBe('1 ГБ')
  })
})

describe('прочее', () => {
  it('TYPE_LABEL и formatDateTime', () => {
    expect(TYPE_LABEL.link).toBe('Ссылка')
    expect(formatDateTime(new Date(2025, 2, 12, 9, 5).getTime())).toMatch(/12 марта 2025.*09:05/)
  })

  it('дата вне диапазона Date — заглушка, а не RangeError', () => {
    const now = new Date(2025, 5, 15, 12, 0).getTime()
    for (const bad of [9e15, -9e15, Number.NaN, Infinity, undefined as unknown as number]) {
      expect(formatRelative(bad, now)).toBe(NO_DATE)
      expect(formatDateTime(bad)).toBe(NO_DATE)
    }
    // Крайние допустимые значения форматируются.
    expect(formatRelative(-8.64e15, now)).not.toBe(NO_DATE)
    expect(formatDateTime(8.64e15)).not.toBe(NO_DATE)
  })
})
