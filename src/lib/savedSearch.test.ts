import { describe, expect, it } from 'vitest'
import { customDateRange, relativeRange } from '@/lib/dates'
import type { UiFilter, View } from '@/store/ui'
import { SAVED_SEARCH_NAME_MAX } from '@/types'
import type { Category } from '@/types'
import {
  alreadySavedText,
  currentSearchQuery,
  findSavedByQuery,
  isNarrowed,
  isSavedSearchActive,
  sectionFilter,
  suggestSearchName,
  viewForQuery,
  type SearchScreen,
} from './savedSearch'

/** Среда, 11 ноября 2026, 15:30 по местному времени. */
const NOW = new Date(2026, 10, 11, 15, 30).getTime()

const CATEGORIES: Category[] = [{ id: 'c1', name: 'Работа', color: 'blue', order: 0, createdAt: 0 }]

const screen = (view: View, query = '', filter: UiFilter = {}, customDates = false): SearchScreen => ({
  view,
  query,
  filter,
  customDates,
})
const save = (s: SearchScreen) => currentSearchQuery(s, CATEGORIES, NOW)

describe('isNarrowed', () => {
  it('строка поиска или любое поле фильтра', () => {
    expect(isNarrowed('', {})).toBe(false)
    expect(isNarrowed('   ', {})).toBe(false)
    expect(isNarrowed('react', {})).toBe(true)
    expect(isNarrowed('', { types: ['link'] })).toBe(true)
    expect(isNarrowed('', { categoryId: 'c1' })).toBe(true)
    // «без категории» — тоже отбор
    expect(isNarrowed('', { categoryId: null })).toBe(true)
    expect(isNarrowed('', { tags: ['a'] })).toBe(true)
    expect(isNarrowed('', { untagged: true })).toBe(true)
    expect(isNarrowed('', { from: 1 })).toBe(true)
    expect(isNarrowed('', { to: 1 })).toBe(true)
  })

  it('пустые и снятые поля — не отбор', () => {
    expect(isNarrowed('', { types: [], tags: [], untagged: false })).toBe(false)
    expect(isNarrowed('', { categoryId: undefined, from: undefined, to: undefined })).toBe(false)
  })
})

describe('sectionFilter', () => {
  it('часть фильтра, которую задаёт раздел', () => {
    expect(sectionFilter('inbox')).toEqual({ status: 'inbox' })
    expect(sectionFilter('library')).toEqual({ status: 'library' })
    expect(sectionFilter('archive')).toEqual({ status: 'archive' })
    expect(sectionFilter('favorites')).toEqual({ favorite: true })
    expect(sectionFilter('trash')).toEqual({ trashed: true })
    expect(sectionFilter('graph')).toEqual({})
    expect(sectionFilter('settings')).toEqual({})
  })
})

describe('currentSearchQuery', () => {
  it('раздел дописывается к запросу', () => {
    expect(save(screen('inbox', 'react'))).toBe('is:inbox react')
    expect(save(screen('library', '', { types: ['link'], categoryId: 'c1', tags: ['js'] }))).toBe(
      'is:library type:link cat:Работа #js',
    )
    expect(save(screen('archive', 'старое'))).toBe('is:archive старое')
    expect(save(screen('favorites', '', { untagged: true }))).toBe('is:fav is:untagged')
    expect(save(screen('trash', 'отчёт'))).toBe('is:trash отчёт')
    // у разделов без отбора (граф, настройки) — только сам запрос
    expect(save(screen('graph', 'react'))).toBe('react')
    expect(save(screen('settings', '#js'))).toBe('#js')
  })

  it('не сузили ничего — пустая строка (сам раздел не сохраняется)', () => {
    for (const view of ['inbox', 'library', 'archive', 'favorites', 'trash', 'graph'] as const) {
      expect(save(screen(view)), view).toBe('')
      expect(save(screen(view, '   ')), view).toBe('')
    }
  })

  it('свой статус в строке поиска: статус раздела не дописывается', () => {
    expect(save(screen('library', 'is:archive react'))).toBe('is:archive react')
    expect(save(screen('inbox', 'is:library'))).toBe('is:library')
    // is:trash тоже заменяет раздел
    expect(save(screen('inbox', 'is:trash'))).toBe('is:trash')
  })

  it('корзина: is:trash дописывается и при своём статусе', () => {
    const query = save(screen('trash', 'is:inbox'))
    expect(query).toBe('is:trash is:inbox')
    expect(viewForQuery(query, NOW)).toBe('trash')
    // свой is:trash не дублируется
    expect(save(screen('trash', 'is:trash отчёт'))).toBe('is:trash отчёт')
  })

  it('избранное: is:fav остаётся при своём статусе, снимается при is:trash', () => {
    expect(save(screen('favorites', 'is:archive'))).toBe('is:fav is:archive')
    expect(save(screen('favorites', 'is:fav react'))).toBe('is:fav react')
    expect(save(screen('favorites', 'is:trash'))).toBe('is:trash')
  })

  it('быстрый период — относительным оператором, свой период — датами', () => {
    const week = relativeRange('week', NOW)
    expect(save(screen('library', '', { from: week.from, to: week.to }))).toBe('is:library date:week')
    // Свой период, совпавший с границами недели, остаётся датами.
    expect(save(screen('library', '', { from: week.from, to: week.to }, true))).toBe(
      'is:library date:2026-11-05..2026-11-11',
    )
    const custom = customDateRange('2026-11-01', '2026-11-10')
    if (!custom.ok || !custom.range) throw new Error('ожидался диапазон')
    expect(save(screen('inbox', '', custom.range, true))).toBe('is:inbox date:2026-11-01..2026-11-10')
    expect(save(screen('inbox', '', { from: custom.range.from }, true))).toBe('is:inbox after:2026-11-01')
  })

  it('круг: сохранённый запрос открывается в том же разделе', () => {
    const cases: Array<[View, string]> = [
      ['inbox', 'react'],
      ['library', 'react'],
      ['archive', 'react'],
      ['favorites', 'react'],
      ['trash', 'react'],
      ['trash', 'is:library'],
    ]
    for (const [view, query] of cases) {
      expect(viewForQuery(save(screen(view, query)), NOW), `${view}: ${query}`).toBe(view)
    }
    // свой статус в строке побеждает раздел
    expect(viewForQuery(save(screen('library', 'is:archive')), NOW)).toBe('archive')
  })
})

describe('viewForQuery', () => {
  it('раздел из операторов запроса', () => {
    expect(viewForQuery('is:trash react')).toBe('trash')
    expect(viewForQuery('is:inbox')).toBe('inbox')
    expect(viewForQuery('is:library #js')).toBe('library')
    expect(viewForQuery('is:archive')).toBe('archive')
    expect(viewForQuery('is:fav')).toBe('favorites')
    // статус важнее избранного: раздел статуса со своим избранным даёт ту же выдачу
    expect(viewForQuery('is:fav is:archive')).toBe('archive')
    expect(viewForQuery('is:корзина is:inbox')).toBe('trash')
  })

  it('без раздела — null', () => {
    expect(viewForQuery('')).toBeNull()
    expect(viewForQuery('react type:link')).toBeNull()
    expect(viewForQuery('is:inbox is:library')).toBeNull()
    expect(viewForQuery('is:inbox is:library is:fav')).toBe('favorites')
    expect(viewForQuery('is:непонятно')).toBeNull()
  })

  it('пары операторов: корзина важнее всего, статус — избранного', () => {
    expect(viewForQuery('is:fav is:inbox')).toBe('inbox')
    expect(viewForQuery('is:archive is:fav')).toBe('archive')
    expect(viewForQuery('is:fav is:trash')).toBe('trash')
    expect(viewForQuery('is:trash is:inbox is:library')).toBe('trash')
    expect(viewForQuery('is:inbox is:inbox')).toBe('inbox')
    expect(viewForQuery(undefined as unknown as string)).toBeNull()
  })

  it('круг для пар: сохранённое из избранного и корзины со своим статусом открывается в разделе с той же выдачей', () => {
    expect(viewForQuery(save(screen('favorites', 'is:inbox')), NOW)).toBe('inbox')
    expect(viewForQuery(save(screen('trash', 'is:fav')), NOW)).toBe('trash')
    // Разделы без отбора (настройки, граф): запрос без раздела — применится в текущем разделе.
    expect(viewForQuery(save(screen('settings', 'react')), NOW)).toBeNull()
    expect(viewForQuery(save(screen('graph', 'react', { tags: ['js'] })), NOW)).toBeNull()
  })
})

describe('findSavedByQuery / alreadySavedText', () => {
  const searches = [
    { id: 'a', name: 'Работа', query: 'is:library cat:Работа' },
    { id: 'b', name: 'Неделя', query: 'is:inbox date:week' },
  ]

  it('тот же запрос (пробелы по краям не важны) — найден; иначе undefined', () => {
    expect(findSavedByQuery(searches, 'is:inbox date:week')?.id).toBe('b')
    expect(findSavedByQuery(searches, '  is:library cat:Работа ')?.id).toBe('a')
    expect(findSavedByQuery(searches, 'is:inbox  date:week')).toBeUndefined()
    expect(findSavedByQuery(searches, 'is:inbox')).toBeUndefined()
    expect(findSavedByQuery(searches, '')).toBeUndefined()
    expect(findSavedByQuery(searches, '   ')).toBeUndefined()
    expect(findSavedByQuery([], 'is:inbox')).toBeUndefined()
  })

  it('текст сообщения', () => {
    expect(alreadySavedText('Неделя')).toBe('Уже сохранён как «Неделя»')
  })
})

describe('isSavedSearchActive', () => {
  const s = (query: string) => ({ query })
  const on = (view: View, query: string, filter: UiFilter = {}) => ({ view, query, filter })

  it('запрос в строке, фильтры пусты, раздел запроса открыт', () => {
    expect(isSavedSearchActive(s('is:library date:week'), on('library', 'is:library date:week'))).toBe(true)
    expect(isSavedSearchActive(s('is:library date:week'), on('library', '  is:library date:week '))).toBe(true)
    expect(isSavedSearchActive(s('is:fav'), on('favorites', 'is:fav'))).toBe(true)
    expect(isSavedSearchActive(s('is:trash x'), on('trash', 'is:trash x'))).toBe(true)
  })

  it('открыт другой раздел — не активен (тот же запрос, набранный в чужом разделе)', () => {
    expect(isSavedSearchActive(s('is:library date:week'), on('inbox', 'is:library date:week'))).toBe(false)
    expect(isSavedSearchActive(s('is:trash x'), on('library', 'is:trash x'))).toBe(false)
    expect(isSavedSearchActive(s('is:fav is:archive'), on('favorites', 'is:fav is:archive'))).toBe(false)
    expect(isSavedSearchActive(s('is:fav is:archive'), on('archive', 'is:fav is:archive'))).toBe(true)
  })

  it('поиск без своего раздела активен в любом разделе', () => {
    expect(isSavedSearchActive(s('react'), on('inbox', 'react'))).toBe(true)
    expect(isSavedSearchActive(s('react'), on('archive', 'react'))).toBe(true)
  })

  it('другой запрос, пустая строка или заданный фильтр — не активен', () => {
    expect(isSavedSearchActive(s('react'), on('inbox', 'react x'))).toBe(false)
    expect(isSavedSearchActive(s('react'), on('inbox', ''))).toBe(false)
    expect(isSavedSearchActive(s(''), on('inbox', ''))).toBe(false)
    expect(isSavedSearchActive(s('react'), on('inbox', 'react', { tags: ['js'] }))).toBe(false)
    expect(isSavedSearchActive(s('react'), on('inbox', 'react', { categoryId: null }))).toBe(false)
    // Пустые поля фильтра — не отбор.
    expect(isSavedSearchActive(s('react'), on('inbox', 'react', { tags: [], types: [] }))).toBe(true)
  })
})

describe('suggestSearchName', () => {
  it('запрос в одну строку; пусто — «Поиск»', () => {
    expect(suggestSearchName('  is:library \n  date:week ', [])).toBe('is:library date:week')
    expect(suggestSearchName('', [])).toBe('Поиск')
    expect(suggestSearchName('   ', [])).toBe('Поиск')
  })

  it('длинный запрос обрезается с «…»', () => {
    const name = suggestSearchName('слово '.repeat(30), [])
    expect(name.length).toBe(SAVED_SEARCH_NAME_MAX)
    expect(name.endsWith('…')).toBe(true)
    expect(name.startsWith('слово слово')).toBe(true)
    expect(suggestSearchName('я'.repeat(SAVED_SEARCH_NAME_MAX), [])).toBe('я'.repeat(SAVED_SEARCH_NAME_MAX))
  })

  it('занятое имя (регистр, ё/е и пробелы не важны) получает номер', () => {
    expect(suggestSearchName('Ёлка', ['елка'])).toBe('Ёлка (2)')
    expect(suggestSearchName('Ёлка', ['ЁЛКА', 'ёлка  (2)'])).toBe('Ёлка (3)')
    expect(suggestSearchName('', ['Поиск'])).toBe('Поиск (2)')
    expect(suggestSearchName('свободно', ['Ёлка'])).toBe('свободно')
  })

  it('длинное занятое имя с номером укладывается в предел', () => {
    const query = 'а'.repeat(100)
    const first = suggestSearchName(query, [])
    const second = suggestSearchName(query, [first])
    expect(second.length).toBeLessThanOrEqual(SAVED_SEARCH_NAME_MAX)
    expect(second.endsWith('… (2)')).toBe(true)
    const third = suggestSearchName(query, [first, second])
    expect(third.endsWith('… (3)')).toBe(true)
  })
})
