import { describe, expect, it } from 'vitest'
import { titleFromUrl } from './linkMeta'
import {
  derivedTitleLine,
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

  it('производный заголовок — без разметки Markdown', () => {
    const t = (content: string, type?: 'text' | 'idea' | 'link' | 'code') => displayTitle({ ...base, content, type })
    expect(t('# Заголовок\nтекст')).toBe('Заголовок')
    expect(t('## План на **год**')).toBe('План на год')
    expect(t('- [ ] купить **хлеб**')).toBe('купить хлеб')
    expect(t('> цитата с [ссылкой](https://a.io)')).toBe('цитата с ссылкой')
    expect(t('См. [[Заметка|подпись]] и `код`')).toBe('См. подпись и код')
    expect(t('```js\nconst x = 1\n```')).toBe('const x = 1')
    expect(t('---\n\n***\n===\n| --- | --- |\nтекст после разделителей')).toBe('текст после разделителей')
    // «#тег» без пробела — не заголовок.
    expect(t('#тег в начале')).toBe('#тег в начале')
    // Заметка к ссылке: свой заголовок страницы важнее, но без него берётся строка заметки без разметки.
    expect(t('**важно**', 'link')).toBe('важно')
  })

  it('свой заголовок, заголовок страницы и имя файла не трогаются', () => {
    expect(displayTitle({ ...base, title: '# Как есть', content: '# Другое' })).toBe('# Как есть')
    expect(displayTitle({ ...base, linkMeta: { title: '**Мета**', status: 'ok' }, content: 'x' })).toBe('**Мета**')
    expect(displayTitle({ ...base, fileName: '__init__.py', content: '# x' })).toBe('__init__.py')
  })

  it('код: строки не очищаются от «разметки»', () => {
    const code = (content: string) => displayTitle({ ...base, type: 'code', content })
    expect(code('# comment\nx = 1')).toBe('# comment')
    expect(code('\n  __init__  ')).toBe('__init__')
    expect(code('---\nx')).toBe('---')
  })

  it('только разметка — запасные варианты', () => {
    expect(displayTitle({ ...base, content: '---\n\n```\n```' })).toBe('Без названия')
    expect(displayTitle({ ...base, content: '***', url: 'https://a.io' })).toBe(titleFromUrl('https://a.io'))
    expect(displayTitle({ ...base, content: '   \n\t' })).toBe('Без названия')
  })
})

describe('derivedTitleLine', () => {
  it('номер строки и текст без разметки', () => {
    expect(derivedTitleLine({ content: 'первая' })).toEqual({ index: 0, text: 'первая' })
    expect(derivedTitleLine({ content: '\n\n  # Тема  \nвторая' })).toEqual({ index: 2, text: 'Тема' })
    expect(derivedTitleLine({ content: '```py\nprint(1)\n```' })).toEqual({ index: 1, text: 'print(1)' })
    expect(derivedTitleLine({ content: '---\r\n\r\n> **цитата**\r\nещё' })).toEqual({ index: 2, text: 'цитата' })
    expect(derivedTitleLine({ content: '\n# x', type: 'code' })).toEqual({ index: 1, text: '# x' })
  })

  it('нет значимой строки — null', () => {
    expect(derivedTitleLine({ content: '' })).toBeNull()
    expect(derivedTitleLine({ content: '\n\n---\n' })).toBeNull()
    expect(derivedTitleLine({ content: undefined as unknown as string })).toBeNull()
  })

  it('просматриваются только первые 50 строк', () => {
    const blank = '\n'.repeat(50)
    expect(derivedTitleLine({ content: `${blank}пятьдесят первая` })).toBeNull()
    expect(derivedTitleLine({ content: `${'\n'.repeat(49)}пятидесятая` })).toEqual({ index: 49, text: 'пятидесятая' })
  })

  it('длинная строка разбирается только в начале', () => {
    const line = `**жирный** ${'слово '.repeat(10_000)}`
    const found = derivedTitleLine({ content: line })
    expect(found?.index).toBe(0)
    expect(found?.text.startsWith('жирный слово')).toBe(true)
    expect(found!.text.length).toBeLessThanOrEqual(1000)
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
