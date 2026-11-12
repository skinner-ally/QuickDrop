import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CATEGORY_COLORS, type Category } from '@/types'
import { CategoriesContext } from './CategoryBadge'
import { catBarStyle, catColorVar, useListCategory } from './categoryColor'

describe('catColorVar', () => {
  it('даёт переменную цвета категории', () => {
    expect(catColorVar('blue')).toBe('var(--cat-blue)')
    for (const color of CATEGORY_COLORS) expect(catColorVar(color)).toBe(`var(--cat-${color})`)
  })
  it('без категории — --cat-none', () => {
    expect(catColorVar(null)).toBe('var(--cat-none)')
    expect(catColorVar(undefined)).toBe('var(--cat-none)')
  })
})

describe('catBarStyle', () => {
  it('задаёт --c для px-catbar', () => {
    expect(catBarStyle('green')).toEqual({ '--c': 'var(--cat-green)' })
    expect(catBarStyle(undefined)).toEqual({ '--c': 'var(--cat-none)' })
    expect(catBarStyle(null)).toEqual({ '--c': 'var(--cat-none)' })
  })
})

describe('useListCategory', () => {
  const categories: Category[] = [
    { id: 'c1', name: 'Работа', color: 'blue', order: 0, createdAt: 1 },
    { id: 'c2', name: 'Дом', color: 'green', order: 1, createdAt: 2 },
  ]

  function Probe({ id }: { id: string | null | undefined }) {
    return createElement('i', null, useListCategory(id)?.name ?? 'нет')
  }
  const inList = (id: string | null | undefined) =>
    renderToStaticMarkup(createElement(CategoriesContext.Provider, { value: categories }, createElement(Probe, { id })))

  it('находит категорию в списке провайдера', () => {
    expect(inList('c2')).toBe('<i>Дом</i>')
  })
  it('null, undefined и неизвестный id — undefined', () => {
    expect(inList(null)).toBe('<i>нет</i>')
    expect(inList(undefined)).toBe('<i>нет</i>')
    expect(inList('нет-такой')).toBe('<i>нет</i>')
  })
  it('вне провайдера — undefined', () => {
    expect(renderToStaticMarkup(createElement(Probe, { id: 'c1' }))).toBe('<i>нет</i>')
  })
})
