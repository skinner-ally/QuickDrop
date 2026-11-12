import { describe, expect, it } from 'vitest'
import type { Item } from '@/types'
import { computeLegend } from './useItems'

const item = (id: string, over: Partial<Item>): Item =>
  ({ id, status: 'library', categoryId: null, tags: [], links: [], favorite: 0, ...over }) as Item

describe('computeLegend', () => {
  const items: Item[] = [
    item('l1', { status: 'library', categoryId: 'work', tags: ['a'] }),
    item('i1', { status: 'inbox', categoryId: 'work', tags: ['urgent', 'a'] }),
    item('i2', { status: 'inbox', categoryId: 'home', tags: ['urgent'] }),
    item('ar', { status: 'archive', categoryId: 'work', tags: ['old'] }),
    item('n', { status: 'library', tags: ['a'] }),
    item('t', { status: 'library', categoryId: 'work', tags: ['trash'], deletedAt: 1 }),
  ]

  it('вне «Графа» — только «База знаний»', () => {
    const out = computeLegend(items, false, true)
    expect(Object.fromEntries(out.perCategory)).toEqual({ work: 1, null: 1 })
    expect(out.tags).toEqual([{ tag: 'a', count: 2 }])
  })

  it('в «Графе» с архивом — входящие, база и архив; корзина не считается', () => {
    const out = computeLegend(items, true, true)
    expect(out.perCategory.get('work')).toBe(3)
    expect(out.perCategory.get('home')).toBe(1)
    expect(out.perCategory.get(null)).toBe(1)
    expect(out.tags).toEqual([
      { tag: 'a', count: 3 },
      { tag: 'urgent', count: 2 },
      { tag: 'old', count: 1 },
    ])
  })

  it('в «Графе» без архива — архив не считается; тег только у входящих попадает в список', () => {
    const out = computeLegend(items, true, false)
    expect(out.perCategory.get('work')).toBe(2)
    expect(out.perCategory.get('home')).toBe(1)
    expect(out.tags.map((t) => t.tag)).toEqual(['a', 'urgent'])
  })
})
