import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/db'
import {
  createItem,
  deleteItems,
  getPositions,
  purgeItems,
  restoreFromTrash,
  setPositions,
  toggleFavorite,
} from '@/db/repo'
import { getSearchIndexStats, isSearchIndexReady, resetSearchIndex, searchItems } from '@/search'
import type { Item } from '@/types'
import {
  ITEMS_RELEASE_DELAY_MS,
  ITEMS_RETRY_MIN_MS,
  computeAllTags,
  computeCounts,
  getAllItemsFailed,
  getAllItemsSnapshot,
  getDayKey,
  getItemsWithTrashSnapshot,
  getTrashedItemsSnapshot,
  subscribeAllItems,
  subscribeDayKey,
} from './useItems'

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout')
    await new Promise((r) => setTimeout(r, 5))
  }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Отписка с немедленным освобождением общего снимка: следующий тест начинает с чистого источника. */
function release(unsub: () => void): void {
  vi.useFakeTimers()
  unsub()
  vi.advanceTimersByTime(ITEMS_RELEASE_DELAY_MS + 1)
  vi.useRealTimers()
}

const ids = (items: Item[] | undefined) => items?.map((it) => it.id)

beforeEach(async () => {
  await Promise.all([
    db.items.clear(),
    db.files.clear(),
    db.categories.clear(),
    db.meta.clear(),
    db.positions.clear(),
    db.searches.clear(),
  ])
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('общий источник записей', () => {
  it('любое число потребителей — одно чтение таблицы на мутацию', async () => {
    const spy = vi.spyOn(db.items, 'toArray')
    const calls = [0, 0, 0]
    const unsubs = calls.map((_, i) => subscribeAllItems(() => calls[i]++))
    await until(() => getAllItemsSnapshot() !== undefined)
    const initialReads = spy.mock.calls.length
    expect(initialReads).toBe(1)

    const item = await createItem({ type: 'text', content: 'x' })
    await until(() => getAllItemsSnapshot()?.length === 1)
    const afterCreate = spy.mock.calls.length

    await toggleFavorite(item.id)
    await until(() => getAllItemsSnapshot()?.[0]?.favorite === 1)
    // Чтений на мутацию столько же, сколько было бы у одного потребителя (а не ×3).
    expect(spy.mock.calls.length - afterCreate).toBe(afterCreate - initialReads)
    expect(afterCreate - initialReads).toBeLessThanOrEqual(2)
    expect(calls.every((n) => n >= 2)).toBe(true)

    vi.useFakeTimers()
    for (const u of unsubs) u()
    // Повторная подписка в пределах задержки переиспользует живой снимок.
    const again = subscribeAllItems(() => {})
    expect(getAllItemsSnapshot()).toHaveLength(1)
    again()
    vi.advanceTimersByTime(ITEMS_RELEASE_DELAY_MS + 1)
    expect(getAllItemsSnapshot()).toBeUndefined()
  })

  it('индекс поиска строится заранее после снимка, первый поиск его не ждёт', async () => {
    resetSearchIndex()
    await createItem({ type: 'text', content: 'первая заметка' })
    await createItem({ type: 'text', content: 'вторая заметка' })
    const unsub = subscribeAllItems(() => {})
    await until(() => getItemsWithTrashSnapshot()?.length === 2)
    await until(() => isSearchIndexReady())
    expect(getSearchIndexStats()).toMatchObject({ size: 2, rebuilt: true })

    const categories = await db.categories.orderBy('order').toArray()
    expect(searchItems(getItemsWithTrashSnapshot()!, 'вторая', categories)).toHaveLength(1)
    expect(getSearchIndexStats()).toMatchObject({ size: 2, added: 0, replaced: 0, discarded: 0, rebuilt: false })
    release(unsub)
  })

  it('теги и счётчики считаются один раз на снимок', () => {
    const base: Omit<Item, 'id' | 'tags' | 'status' | 'favorite'> = {
      type: 'text', title: '', content: '', categoryId: null, links: [], source: 'manual',
      createdAt: 1, updatedAt: 1,
    }
    const items: Item[] = [
      { ...base, id: '1', tags: ['a', 'b'], status: 'inbox', favorite: 1 },
      { ...base, id: '2', tags: ['a'], status: 'library', favorite: 0 },
      { ...base, id: '3', tags: ['c'], status: 'archive', favorite: 1 },
    ]
    expect(computeAllTags(items)).toEqual([
      { tag: 'a', count: 2 },
      { tag: 'b', count: 1 },
    ])
    expect(computeAllTags(items)).toBe(computeAllTags(items))
    expect(computeCounts(items)).toEqual({ inbox: 1, library: 1, favorites: 1, archive: 1 })
    expect(computeCounts(items)).toBe(computeCounts(items))
  })

  it('после ошибки чтения подписка повторяется сама, а не застывает до перезагрузки', async () => {
    await createItem({ type: 'text', content: 'x' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(db.items, 'toArray').mockRejectedValueOnce(new Error('DatabaseClosedError'))
    const unsub = subscribeAllItems(() => {})
    await until(() => getAllItemsFailed())
    expect(getAllItemsSnapshot()).toEqual([])
    expect(getTrashedItemsSnapshot()).toEqual([])
    expect(getItemsWithTrashSnapshot()).toEqual([])

    await until(() => getAllItemsSnapshot()?.length === 1, ITEMS_RETRY_MIN_MS + 2000)
    expect(getAllItemsFailed()).toBe(false)
    // подписка снова живая: изменения доходят
    await createItem({ type: 'text', content: 'y' })
    await until(() => getAllItemsSnapshot()?.length === 2)

    vi.useFakeTimers()
    unsub()
    vi.advanceTimersByTime(ITEMS_RELEASE_DELAY_MS + 1)
    expect(getAllItemsSnapshot()).toBeUndefined()
    expect(getTrashedItemsSnapshot()).toBeUndefined()
    expect(getItemsWithTrashSnapshot()).toBeUndefined()
  })
})

describe('срезы снимка: корзина', () => {
  it('пока корзина пуста, срез без корзины — тот же массив, что и полный снимок', async () => {
    const unsub = subscribeAllItems(() => {})
    await until(() => getItemsWithTrashSnapshot() !== undefined)
    const emptyTrash = getTrashedItemsSnapshot()
    expect(emptyTrash).toEqual([])
    expect(getAllItemsSnapshot()).toBe(getItemsWithTrashSnapshot())

    await createItem({ type: 'text', content: 'a' })
    await until(() => getItemsWithTrashSnapshot()?.length === 1)
    expect(getAllItemsSnapshot()).toBe(getItemsWithTrashSnapshot())
    // пустая корзина — один и тот же массив от снимка к снимку
    expect(getTrashedItemsSnapshot()).toBe(emptyTrash)
    release(unsub)
  })

  it('запись в корзине уходит из общего среза и появляется в срезе корзины', async () => {
    const a = await createItem({ type: 'text', content: 'a', tags: ['общий', 'свой'] })
    const b = await createItem({ type: 'text', content: 'b', tags: ['общий'] })
    const c = await createItem({ type: 'text', content: 'c', status: 'library' })
    const spy = vi.spyOn(db.items, 'toArray')
    const unsub = subscribeAllItems(() => {})
    await until(() => getAllItemsSnapshot()?.length === 3)
    const readsBefore = spy.mock.calls.length

    await deleteItems([a.id])
    await until(() => getTrashedItemsSnapshot()?.length === 1)
    // перенос в корзину — такая же мутация, как прочие: одно чтение таблицы
    expect(spy.mock.calls.length - readsBefore).toBe(1)
    expect(ids(getTrashedItemsSnapshot())).toEqual([a.id])
    expect(ids(getAllItemsSnapshot())?.sort()).toEqual([b.id, c.id].sort())
    expect(ids(getItemsWithTrashSnapshot())?.sort()).toEqual([a.id, b.id, c.id].sort())

    // ссылки срезов стабильны между вызовами (требование useSyncExternalStore)
    expect(getAllItemsSnapshot()).toBe(getAllItemsSnapshot())
    expect(getTrashedItemsSnapshot()).toBe(getTrashedItemsSnapshot())
    expect(getItemsWithTrashSnapshot()).toBe(getItemsWithTrashSnapshot())
    expect(getAllItemsSnapshot()).not.toBe(getItemsWithTrashSnapshot())

    // теги и счётчики считаются по срезу без корзины
    const live = getAllItemsSnapshot()!
    expect(computeAllTags(live)).toEqual([{ tag: 'общий', count: 1 }])
    expect(computeCounts(live)).toEqual({ inbox: 1, library: 1, favorites: 0, archive: 0 })

    await restoreFromTrash(a.id)
    await until(() => getTrashedItemsSnapshot()?.length === 0)
    expect(getAllItemsSnapshot()).toBe(getItemsWithTrashSnapshot())
    expect(getAllItemsSnapshot()).toHaveLength(3)

    await purgeItems(b.id)
    await until(() => getAllItemsSnapshot()?.length === 2)
    expect(getTrashedItemsSnapshot()).toEqual([])
    release(unsub)
  })

  it('корзина упорядочена по времени удаления, недавние — первыми', async () => {
    const a = await createItem({ type: 'text', content: 'a' })
    const b = await createItem({ type: 'text', content: 'b' })
    const c = await createItem({ type: 'text', content: 'c' })
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(2_000)
    await deleteItems([b.id])
    now.mockReturnValue(3_000)
    await deleteItems([a.id])
    now.mockReturnValue(1_000)
    await deleteItems([c.id])
    now.mockRestore()

    const unsub = subscribeAllItems(() => {})
    await until(() => getTrashedItemsSnapshot() !== undefined)
    expect(ids(getTrashedItemsSnapshot())).toEqual([a.id, b.id, c.id])
    expect(getAllItemsSnapshot()).toEqual([])
    release(unsub)
  })

  it('setPositions не вызывает чтения таблицы записей', async () => {
    const item = await createItem({ type: 'text', content: 'x' })
    const spy = vi.spyOn(db.items, 'toArray')
    let notified = 0
    const unsub = subscribeAllItems(() => notified++)
    await until(() => getAllItemsSnapshot()?.length === 1)
    const reads = spy.mock.calls.length
    const before = getAllItemsSnapshot()
    const notifiedBefore = notified

    await setPositions({ [item.id]: { x: 10, y: 20 } })
    await pause(60)
    expect(await getPositions()).toEqual({ [item.id]: { x: 10, y: 20 } })
    expect(spy.mock.calls.length).toBe(reads)
    expect(getAllItemsSnapshot()).toBe(before)
    expect(notified).toBe(notifiedBefore)
    release(unsub)
  })
})

describe('текущие сутки', () => {
  it('ключ — начало локальных суток; подписчики узнают о полуночи', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 11, 23, 59, 58))
    expect(getDayKey()).toBe(new Date(2026, 10, 11).getTime())

    let ticks = 0
    const unsub = subscribeDayKey(() => ticks++)
    vi.advanceTimersByTime(1_000)
    expect(ticks).toBe(0)
    expect(getDayKey()).toBe(new Date(2026, 10, 11).getTime())

    vi.advanceTimersByTime(1_500)
    expect(ticks).toBe(1)
    expect(getDayKey()).toBe(new Date(2026, 10, 12).getTime())

    // таймер взводится заново: следующая полночь тоже приходит
    vi.advanceTimersByTime(23 * 3_600_000)
    expect(ticks).toBe(1)
    vi.advanceTimersByTime(3_600_000)
    expect(ticks).toBe(2)
    expect(getDayKey()).toBe(new Date(2026, 10, 13).getTime())

    unsub()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(48 * 3_600_000)
    expect(ticks).toBe(2)
  })

  it('несколько подписчиков делят один таймер', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 11, 31, 23, 59, 59))
    const seen: string[] = []
    const first = subscribeDayKey(() => seen.push('a'))
    const second = subscribeDayKey(() => seen.push('b'))
    expect(vi.getTimerCount()).toBe(1)
    first()
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(1_500)
    expect(seen).toEqual(['b'])
    expect(getDayKey()).toBe(new Date(2027, 0, 1).getTime())
    second()
    expect(vi.getTimerCount()).toBe(0)
  })
})
