import { describe, expect, it } from 'vitest'
import type { Category, Item } from '@/types'
import { computeGraphMatch } from './match'

let seq = 0
function mk(p: Partial<Item> = {}): Item {
  seq++
  return {
    id: `m${seq}`, type: 'text', title: '', content: '', categoryId: null, tags: [], links: [],
    status: 'library', favorite: 0, source: 'manual', createdAt: 1000 + seq, updatedAt: 1000 + seq, ...p,
  }
}

const DAY = 86_400_000
const NOW = new Date(2026, 10, 12, 12).getTime()
const cats: Category[] = [
  { id: 'c1', name: 'Работа', color: 'blue', order: 0, createdAt: 0 },
  { id: 'c2', name: 'Дом и сад', color: 'green', order: 1, createdAt: 0 },
]

const a = mk({ title: 'alpha отчёт', status: 'inbox', categoryId: 'c1', tags: ['x'], createdAt: NOW - 1000 })
const b = mk({ title: 'beta', type: 'link', url: 'https://example.com/', categoryId: 'c2', createdAt: NOW - 40 * DAY })
const c = mk({ title: 'gamma alpha', status: 'archive', prevStatus: 'library', tags: ['x', 'y'], createdAt: NOW - 2 * DAY })
const d = mk({ title: 'delta', type: 'code', categoryId: null, createdAt: NOW - 400 * DAY })
const trashed = mk({ title: 'alpha в корзине', deletedAt: NOW - DAY })
const nodes = [a, b, c, d]
const all = [...nodes, trashed]

const ids = (m: ReturnType<typeof computeGraphMatch>) => (m.ids ? [...m.ids].sort() : null)
const sorted = (...list: Item[]) => list.map((i) => i.id).sort()
const match = (query: string, filter = {}) => computeGraphMatch(all, nodes, cats, query, filter, NOW)

describe('computeGraphMatch', () => {
  it('отбор не задан — неактивен', () => {
    expect(match('', {})).toEqual({ active: false, ids: null })
    expect(match('   ', { tags: [] })).toEqual({ active: false, ids: null })
  })

  it('тип, тег, категория (null — без категории)', () => {
    expect(ids(match('', { types: ['link', 'code'] }))).toEqual(sorted(b, d))
    expect(ids(match('', { tags: ['x'] }))).toEqual(sorted(a, c))
    expect(ids(match('', { categoryId: 'c1' }))).toEqual(sorted(a))
    expect(ids(match('', { categoryId: null }))).toEqual(sorted(c, d))
    expect(match('', { untagged: true }).active).toBe(true)
  })

  it('период фильтра', () => {
    expect(ids(match('', { from: NOW - 7 * DAY, to: NOW }))).toEqual(sorted(a, c))
  })

  it('ничего не подошло — активен, пустое множество', () => {
    const m = match('', { tags: ['нет-такого'] })
    expect(m.active).toBe(true)
    expect(ids(m)).toEqual([])
  })

  it('текст — по всем записям графа, включая архив; корзина не попадает', () => {
    expect(ids(match('alpha'))).toEqual(sorted(a, c))
    expect(ids(match('отчет'))).toEqual(sorted(a))
  })

  it('операторы строки: is:inbox, is:archive, cat:имя, type:', () => {
    expect(ids(match('is:inbox'))).toEqual(sorted(a))
    expect(ids(match('is:archive'))).toEqual(sorted(c))
    expect(ids(match('cat:"Дом и сад"'))).toEqual(sorted(b))
    expect(ids(match('type:code'))).toEqual(sorted(d))
  })

  it('is:trash — пустое множество', () => {
    const m = match('is:trash')
    expect(m.active).toBe(true)
    expect(ids(m)).toEqual([])
    expect(ids(match('is:trash alpha'))).toEqual([])
  })

  it('фильтр панели и строка вместе — по И', () => {
    expect(ids(match('alpha', { tags: ['y'] }))).toEqual(sorted(c))
    expect(ids(match('alpha', { categoryId: 'c2' }))).toEqual([])
    expect(ids(match('is:inbox', { tags: ['x'] }))).toEqual(sorted(a))
  })

  it('записи не из графа не попадают, даже если подходят', () => {
    const m = computeGraphMatch(all, [b, d], cats, 'alpha', {}, NOW)
    expect(ids(m)).toEqual([])
  })
})
