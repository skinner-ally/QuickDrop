import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/db'
import { createItem, toggleFavorite } from '@/db/repo'
import type { Item } from '@/types'
import {
  ITEMS_RELEASE_DELAY_MS,
  ITEMS_RETRY_MIN_MS,
  computeAllTags,
  computeCounts,
  getAllItemsFailed,
  getAllItemsSnapshot,
  subscribeAllItems,
} from './useItems'

async function until(cond: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout')
    await new Promise((r) => setTimeout(r, 5))
  }
}

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.files.clear(), db.categories.clear(), db.meta.clear()])
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

    await until(() => getAllItemsSnapshot()?.length === 1, ITEMS_RETRY_MIN_MS + 2000)
    expect(getAllItemsFailed()).toBe(false)
    // подписка снова живая: изменения доходят
    await createItem({ type: 'text', content: 'y' })
    await until(() => getAllItemsSnapshot()?.length === 2)

    vi.useFakeTimers()
    unsub()
    vi.advanceTimersByTime(ITEMS_RELEASE_DELAY_MS + 1)
    expect(getAllItemsSnapshot()).toBeUndefined()
  })
})
