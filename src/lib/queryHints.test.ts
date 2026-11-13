import { describe, expect, it } from 'vitest'
import type { Category } from '@/types'
import { collectTags, missingQueryTargets, queryHintText } from './queryHints'

const cat = (id: string, name: string): Category => ({ id, name, color: 'blue', order: 0, createdAt: 0 })
const cats = [cat('c1', 'Работа'), cat('c2', 'Мои проекты')]
const tags = ['react', 'docs']

describe('missingQueryTargets', () => {
  it('всё есть — подсказок нет', () => {
    expect(missingQueryTargets('', {}, cats, tags)).toEqual([])
    expect(missingQueryTargets('api cat:работа #react tag:docs', { categoryId: 'c2', tags: ['React'] }, cats, tags)).toEqual([])
    expect(missingQueryTargets('cat:"мои  проекты"', {}, cats, tags)).toEqual([])
  })

  it('cat: без категории в базе', () => {
    expect(missingQueryTargets('отчёт cat:Финансы', {}, cats, tags)).toEqual([{ kind: 'category', name: 'Финансы' }])
    expect(missingQueryTargets('cat:"Старые проекты"', {}, cats, tags)).toEqual([
      { kind: 'category', name: 'Старые проекты' },
    ])
  })

  it('cat:none и псевдоимена «без категории» — не подсказка', () => {
    expect(missingQueryTargets('cat:none', {}, cats, tags)).toEqual([])
    expect(missingQueryTargets('cat:"без категории"', {}, cats, tags)).toEqual([])
    expect(missingQueryTargets('cat:', {}, cats, tags)).toEqual([])
  })

  it('категория фильтра, которой больше нет', () => {
    expect(missingQueryTargets('', { categoryId: 'gone' }, cats, tags)).toEqual([{ kind: 'filter-category', name: 'gone' }])
    expect(missingQueryTargets('', { categoryId: null }, cats, tags)).toEqual([])
    expect(missingQueryTargets('', { categoryId: undefined }, cats, tags)).toEqual([])
  })

  it('теги из строки и фильтра, которых нет ни у одной записи; без повторов', () => {
    expect(missingQueryTargets('#vue tag:react,svelte', { tags: ['Vue', 'docs', 'angular'] }, cats, tags)).toEqual([
      { kind: 'tag', name: 'vue' },
      { kind: 'tag', name: 'svelte' },
      { kind: 'tag', name: 'angular' },
    ])
    expect(missingQueryTargets('#"мой тег"', {}, cats, tags)).toEqual([{ kind: 'tag', name: 'мой-тег' }])
  })

  it('knownTags === null — теги не проверяются (корзина)', () => {
    expect(missingQueryTargets('#vue cat:Финансы', { tags: ['x'], categoryId: 'gone' }, cats, null)).toEqual([
      { kind: 'category', name: 'Финансы' },
      { kind: 'filter-category', name: 'gone' },
    ])
  })

  it('порядок: категория строки, категория фильтра, теги', () => {
    const hints = missingQueryTargets('#vue cat:Финансы', { categoryId: 'gone' }, cats, tags)
    expect(hints.map((h) => h.kind)).toEqual(['category', 'filter-category', 'tag'])
  })

  it('без категорий в базе любая cat:имя — подсказка', () => {
    expect(missingQueryTargets('cat:Работа', {}, [], [])).toEqual([{ kind: 'category', name: 'Работа' }])
  })
})

describe('queryHintText', () => {
  it('пусто — null', () => {
    expect(queryHintText([])).toBeNull()
  })

  it('тексты подсказок', () => {
    expect(queryHintText([{ kind: 'category', name: 'Финансы' }])).toBe(
      'Категории «Финансы» нет — возможно, её удалили или переименовали.',
    )
    expect(queryHintText([{ kind: 'tag', name: 'vue' }])).toBe('Тега #vue нет ни у одной записи.')
    expect(queryHintText([{ kind: 'filter-category', name: 'gone' }])).toBe('Выбранной категории больше нет.')
  })

  it('через пробел, не больше двух', () => {
    expect(
      queryHintText([
        { kind: 'category', name: 'А' },
        { kind: 'tag', name: 'b' },
        { kind: 'tag', name: 'c' },
      ]),
    ).toBe('Категории «А» нет — возможно, её удалили или переименовали. Тега #b нет ни у одной записи.')
  })
})

describe('collectTags', () => {
  it('теги всех записей без повторов, мусор пропускается', () => {
    const items = [{ tags: ['a', 'b'] }, { tags: ['b', 'c'] }, { tags: undefined as unknown as string[] }, { tags: [] }]
    expect(collectTags(items).sort()).toEqual(['a', 'b', 'c'])
  })
})
