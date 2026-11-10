import { describe, expect, it } from 'vitest'
import type { Category, Item } from '@/types'
import { getSearchIndexStats, prepareSearchIndex, resetSearchIndex } from '@/search'
import { computeVisible } from './computeVisible'

let seq = 0
function mk(p: Partial<Item> = {}): Item {
  seq++
  return {
    id: `i${seq}`, type: 'text', title: '', content: '', categoryId: null, tags: [], links: [],
    status: 'inbox', favorite: 0, source: 'manual', createdAt: 1000 + seq, updatedAt: 1000 + seq, ...p,
  }
}
const cats: Category[] = [{ id: 'c1', name: 'Работа', color: 'blue', order: 0, createdAt: 0 }]
const ids = (r: ReturnType<typeof computeVisible>) => r.hits.map((h) => h.item.id)

describe('computeVisible', () => {
  const a = mk({ title: 'alpha', status: 'inbox' })
  const b = mk({ title: 'beta', status: 'library', tags: ['x'] })
  const c = mk({ title: 'gamma alpha', status: 'archive' })
  const all = [a, b, c]

  it('base задаёт раздел, total считается по base', () => {
    const r = computeVisible(all, cats, { status: 'inbox' }, {}, '', 'newest')
    expect(ids(r)).toEqual([a.id])
    expect(r.total).toBe(1)
  })

  it('uiFilter сужает выдачу, но не total', () => {
    const r = computeVisible(all, cats, { status: ['inbox', 'library'] }, { tags: ['x'] }, '', 'newest')
    expect(ids(r)).toEqual([b.id])
    expect(r.total).toBe(2)
  })

  it('сортировка применяется без текста', () => {
    expect(ids(computeVisible(all, cats, {}, {}, '', 'newest'))).toEqual([c.id, b.id, a.id])
    expect(ids(computeVisible(all, cats, {}, {}, '', 'oldest'))).toEqual([a.id, b.id, c.id])
  })

  it('с текстом работает поиск', () => {
    const r = computeVisible(all, cats, {}, {}, 'alpha', 'oldest')
    expect(ids(r).sort()).toEqual([a.id, c.id].sort())
  })

  it('is:archive переопределяет статус раздела', () => {
    const r = computeVisible(all, cats, { status: 'inbox' }, {}, 'is:archive', 'newest')
    expect(ids(r)).toEqual([c.id])
    expect(r.total).toBe(1)
  })

  it('пустой список', () => {
    expect(computeVisible([], cats, {}, {}, 'q', 'newest')).toEqual({ hits: [], total: 0 })
  })

  it('запрос из одной пунктуации не отключает сортировку', () => {
    for (const q of ['!!!', '—', '++', '"  "']) {
      expect(ids(computeVisible(all, cats, {}, {}, q, 'newest'))).toEqual([c.id, b.id, a.id])
      expect(ids(computeVisible(all, cats, {}, {}, q, 'oldest'))).toEqual([a.id, b.id, c.id])
    }
  })

  it('смена раздела и фильтров не перестраивает индекс поиска', () => {
    resetSearchIndex()
    const many = Array.from({ length: 300 }, (_, i) =>
      mk({ title: `react ${i}`, status: i % 3 === 0 ? 'inbox' : 'library', tags: i % 2 ? ['x'] : [] }),
    )
    prepareSearchIndex(many, cats)
    expect(getSearchIndexStats().size).toBe(300)

    computeVisible(many, cats, { status: 'inbox' }, {}, 'react', 'newest')
    computeVisible(many, cats, { status: 'library' }, { tags: ['x'] }, 'react', 'newest')
    computeVisible(many, cats, { favorite: true }, {}, 'react', 'newest')
    expect(getSearchIndexStats()).toMatchObject({ size: 300, added: 0, replaced: 0, discarded: 0, rebuilt: false })

    const r = computeVisible(many, cats, { status: 'inbox' }, {}, 'react', 'newest')
    expect(r.hits).toHaveLength(100)
    expect(r.hits.every((h) => h.item.status === 'inbox')).toBe(true)
  })
})
