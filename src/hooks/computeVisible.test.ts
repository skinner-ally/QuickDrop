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

describe('computeVisible — корзина', () => {
  const live = mk({ title: 'alpha живая', status: 'inbox' })
  const lib = mk({ title: 'beta', status: 'library', tags: ['x'], favorite: 1 })
  const goneInbox = mk({ title: 'alpha удалённая', status: 'inbox', tags: ['x'], deletedAt: 5000 })
  const goneLib = mk({ title: 'gamma удалённая', status: 'library', deletedAt: 6000 })
  const all = [live, lib, goneInbox, goneLib]

  it('корзина не видна в разделах и не входит в total', () => {
    const inbox = computeVisible(all, cats, { status: 'inbox' }, {}, '', 'newest')
    expect(ids(inbox)).toEqual([live.id])
    expect(inbox.total).toBe(1)

    const everything = computeVisible(all, cats, {}, {}, '', 'oldest')
    expect(ids(everything)).toEqual([live.id, lib.id])
    expect(everything.total).toBe(2)

    // Ни текстом, ни фразой, ни фильтром интерфейса запись из корзины не достать.
    expect(ids(computeVisible(all, cats, {}, {}, 'alpha', 'newest'))).toEqual([live.id])
    expect(ids(computeVisible(all, cats, {}, {}, '"удалённая"', 'newest'))).toEqual([])
    expect(ids(computeVisible(all, cats, {}, { tags: ['x'] }, '', 'newest'))).toEqual([lib.id])
    expect(ids(computeVisible(all, cats, { trashed: false }, {}, '', 'oldest'))).toEqual([live.id, lib.id])
  })

  it('base { trashed: true } показывает только корзину', () => {
    const trash = computeVisible(all, cats, { trashed: true }, {}, '', 'newest')
    expect(ids(trash)).toEqual([goneLib.id, goneInbox.id])
    expect(trash.total).toBe(2)

    const byText = computeVisible(all, cats, { trashed: true }, {}, 'alpha', 'newest')
    expect(ids(byText)).toEqual([goneInbox.id])
    expect(byText.total).toBe(2)

    const byFilter = computeVisible(all, cats, { trashed: true }, { tags: ['x'] }, '', 'newest')
    expect(ids(byFilter)).toEqual([goneInbox.id])
    expect(byFilter.total).toBe(2)

    expect(ids(computeVisible(all, cats, { trashed: true }, { tags: ['x'] }, 'удаленная', 'newest'))).toEqual([goneInbox.id])
    expect(ids(computeVisible(all, cats, { trashed: true }, { tags: ['x'] }, 'gamma', 'newest'))).toEqual([])
    expect(ids(computeVisible(all, cats, { trashed: true }, {}, '"gamma удалённая"', 'newest'))).toEqual([goneLib.id])
    // Статус из запроса сужает и корзину.
    expect(ids(computeVisible(all, cats, { trashed: true }, {}, 'is:library', 'newest'))).toEqual([goneLib.id])
  })

  it('is:trash из раздела «Входящие» снимает статус раздела', () => {
    const r = computeVisible(all, cats, { status: 'inbox' }, {}, 'is:trash', 'oldest')
    expect(ids(r)).toEqual([goneInbox.id, goneLib.id])
    expect(r.total).toBe(2)

    // Статус, названный в самом запросе, действует.
    const onlyLib = computeVisible(all, cats, { status: 'inbox' }, {}, 'is:trash is:library', 'oldest')
    expect(ids(onlyLib)).toEqual([goneLib.id])
    expect(onlyLib.total).toBe(1)

    expect(ids(computeVisible(all, cats, { status: 'inbox' }, {}, 'is:trash gamma', 'oldest'))).toEqual([goneLib.id])
    // Из «Избранного» — тоже вся корзина, а не только избранные записи в ней.
    expect(ids(computeVisible(all, cats, { favorite: true }, {}, 'is:корзина', 'oldest'))).toEqual([goneInbox.id, goneLib.id])
    // Фильтры интерфейса продолжают действовать.
    expect(ids(computeVisible(all, cats, { status: 'inbox' }, { tags: ['x'] }, 'is:trash', 'oldest'))).toEqual([goneInbox.id])
  })

  it('вход в корзину и is:trash не перестраивают индекс поиска', () => {
    resetSearchIndex()
    const many = Array.from({ length: 200 }, (_, i) =>
      mk({ title: `react ${i}`, status: i % 2 ? 'inbox' : 'library', ...(i % 4 === 0 ? { deletedAt: 9000 + i } : {}) }),
    )
    prepareSearchIndex(many, cats)
    expect(getSearchIndexStats()).toMatchObject({ size: 200, rebuilt: true })

    expect(computeVisible(many, cats, { status: 'inbox' }, {}, 'react', 'newest').hits).toHaveLength(100)
    expect(getSearchIndexStats()).toMatchObject({ size: 200, added: 0, replaced: 0, discarded: 0, rebuilt: false })

    const trash = computeVisible(many, cats, { trashed: true }, {}, 'react', 'newest')
    expect(trash.hits).toHaveLength(50)
    expect(trash.total).toBe(50)
    expect(trash.hits.every((h) => h.item.deletedAt !== undefined)).toBe(true)
    expect(getSearchIndexStats()).toMatchObject({ size: 200, added: 0, replaced: 0, discarded: 0, rebuilt: false })

    expect(computeVisible(many, cats, { status: 'inbox' }, {}, 'react is:trash', 'newest').hits).toHaveLength(50)
    expect(computeVisible(many, cats, {}, {}, 'react', 'newest').hits).toHaveLength(150)
    expect(getSearchIndexStats()).toMatchObject({ size: 200, added: 0, replaced: 0, discarded: 0, rebuilt: false })
  })
})

describe('computeVisible — даты', () => {
  const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m, d, h, min).getTime()
  const now = at(2026, 10, 12, 15, 0)
  const d3 = mk({ title: 'третье', createdAt: at(2026, 10, 3, 10) })
  const d6 = mk({ title: 'шестое', createdAt: at(2026, 10, 6, 0, 0) })
  const d9 = mk({ title: 'девятое', createdAt: at(2026, 10, 9, 23, 59) })
  const d12 = mk({ title: 'двенадцатое', createdAt: at(2026, 10, 12, 9) })
  const all = [d3, d6, d9, d12]
  const run = (uiFilter: Parameters<typeof computeVisible>[3], query: string, nowTs = now) =>
    computeVisible(all, cats, {}, uiFilter, query, 'oldest', nowTs)

  it('дата из запроса и uiFilter.from / to пересекаются', () => {
    expect(ids(run({ from: at(2026, 10, 8) }, 'after:2026-11-05'))).toEqual([d9.id, d12.id])
    expect(ids(run({ from: at(2026, 10, 5) }, 'after:2026-11-08'))).toEqual([d9.id, d12.id])
    expect(ids(run({ from: at(2026, 10, 5) }, 'before:2026-11-09'))).toEqual([d6.id, d9.id])
    expect(ids(run({ to: at(2026, 10, 10) - 1 }, 'date:2026-11-06..2026-11-12'))).toEqual([d6.id, d9.id])
    expect(ids(run({ from: at(2026, 10, 10) }, 'before:2026-11-09'))).toEqual([])
    // total считается только по разделу.
    expect(run({ from: at(2026, 10, 8) }, 'after:2026-11-05').total).toBe(4)
  })

  it('относительные даты считаются от переданного now', () => {
    expect(ids(run({}, 'date:today'))).toEqual([d12.id])
    expect(ids(run({}, 'date:week'))).toEqual([d6.id, d9.id, d12.id])
    expect(ids(run({ to: at(2026, 10, 10) - 1 }, 'date:неделя'))).toEqual([d6.id, d9.id])
    expect(ids(run({}, 'date:yesterday', at(2026, 10, 10, 12)))).toEqual([d9.id])
    expect(ids(run({}, 'date:вчера шестое', at(2026, 10, 7, 1)))).toEqual([d6.id])
    // Сортировка по дате при одном лишь операторе даты сохраняется.
    expect(ids(computeVisible(all, cats, {}, {}, 'date:week', 'newest', now))).toEqual([d12.id, d9.id, d6.id])
  })

  it('неверная дата ищется как текст и раздел не сужает', () => {
    expect(ids(run({}, 'date:31.02.2026'))).toEqual([])
    expect(run({}, 'date:31.02.2026').total).toBe(4)
  })
})
