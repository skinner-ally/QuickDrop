import { describe, expect, it } from 'vitest'
import { displayTitle, formatBytes, formatDateTime, formatRelative, TYPE_LABEL } from './itemTitle'

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
    expect(displayTitle({ ...base, url: 'https://a.io' })).toBe('https://a.io')
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
})
