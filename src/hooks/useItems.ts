import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { liveQuery, type Subscription } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { getFile } from '@/db/repo'
import { useUi } from '@/store/ui'
import type { Category, Item, ItemFilter } from '@/types'
import { computeVisible } from './computeVisible'
import type { VisibleResult } from './computeVisible'

export { computeVisible }
export type { VisibleResult }

// ───────────────── общий источник всех записей ─────────────────
// Один liveQuery на всё приложение: useLiveQuery в каждом хуке (список, теги, счётчики, палитра)
// давал бы отдельное полное чтение таблицы со структурным клонированием всего content
// на КАЖДУЮ мутацию, умноженное на число потребителей.

/** Отписка с задержкой: при смене раздела потребители размонтируются и тут же монтируются снова. */
export const ITEMS_RELEASE_DELAY_MS = 2000
/** Повтор чтения после ошибки: от 1 с, удваивая до 30 с. */
export const ITEMS_RETRY_MIN_MS = 1000
const ITEMS_RETRY_MAX_MS = 30_000

const listeners = new Set<() => void>()
let snapshot: Item[] | undefined
let failed = false
let subscription: Subscription | null = null
let releaseTimer: ReturnType<typeof setTimeout> | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined
let retryDelay = ITEMS_RETRY_MIN_MS

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function clearRetry(): void {
  if (retryTimer !== undefined) clearTimeout(retryTimer)
  retryTimer = undefined
}

function releaseIfIdle(): void {
  releaseTimer = undefined
  if (listeners.size > 0) return
  clearRetry()
  subscription?.unsubscribe()
  subscription = null
  // Без подписки данные устаревают: следующий потребитель дождётся свежего чтения.
  snapshot = undefined
  failed = false
  retryDelay = ITEMS_RETRY_MIN_MS
}

/**
 * После ошибки liveQuery закрывается навсегда. Боковая панель подписана всегда, поэтому «переподписка
 * при новом потребителе» не наступила бы, и список застыл бы до перезагрузки — повторяем сами.
 */
function scheduleRetry(): void {
  if (retryTimer !== undefined || listeners.size === 0) return
  retryTimer = setTimeout(() => {
    retryTimer = undefined
    if (listeners.size > 0 && (!subscription || subscription.closed)) subscribeItems()
  }, retryDelay)
  retryDelay = Math.min(retryDelay * 2, ITEMS_RETRY_MAX_MS)
}

function subscribeItems(): void {
  subscription = liveQuery(() => db.items.toArray()).subscribe({
    next: (items) => {
      snapshot = items
      failed = false
      retryDelay = ITEMS_RETRY_MIN_MS
      emit()
    },
    error: (err: unknown) => {
      console.error('QuickDrop: не удалось прочитать записи', err)
      subscription = null
      failed = true
      // Пустой список вместо вечной «загрузки»; уже прочитанные записи остаются на экране.
      snapshot ??= []
      emit()
      scheduleRetry()
    },
  })
}

/** Подписка на общий список записей (для useSyncExternalStore и тестов). */
export function subscribeAllItems(listener: () => void): () => void {
  listeners.add(listener)
  if (releaseTimer !== undefined) {
    clearTimeout(releaseTimer)
    releaseTimer = undefined
  }
  if (!subscription || subscription.closed) {
    clearRetry()
    subscribeItems()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && releaseTimer === undefined) {
      releaseTimer = setTimeout(releaseIfIdle, ITEMS_RELEASE_DELAY_MS)
    }
  }
}

/** Текущий снимок общего списка; undefined — первое чтение ещё не завершилось. */
export function getAllItemsSnapshot(): Item[] | undefined {
  return snapshot
}

export function useAllItems(): Item[] | undefined {
  return useSyncExternalStore(subscribeAllItems, getAllItemsSnapshot, getAllItemsSnapshot)
}

/** true — последнее чтение записей завершилось ошибкой (чтение повторяется само). */
export function getAllItemsFailed(): boolean {
  return failed
}

/** Для сообщения в интерфейсе: пустой список при ошибке чтения — не «данные исчезли». */
export function useAllItemsFailed(): boolean {
  return useSyncExternalStore(subscribeAllItems, getAllItemsFailed, getAllItemsFailed)
}

// Производные значения считаются один раз на снимок, сколько бы компонентов их ни читали.
type TagCount = { tag: string; count: number }
const NO_TAGS: TagCount[] = []
const NO_COUNTS = { inbox: 0, library: 0, favorites: 0, archive: 0 }
const tagsCache = new WeakMap<Item[], TagCount[]>()
const countsCache = new WeakMap<Item[], typeof NO_COUNTS>()

export function computeAllTags(items: Item[]): TagCount[] {
  const cached = tagsCache.get(items)
  if (cached) return cached
  const counts = new Map<string, number>()
  for (const it of items) {
    if (it.status === 'archive' || !Array.isArray(it.tags)) continue
    for (const t of it.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  const out = [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  tagsCache.set(items, out)
  return out
}

export function computeCounts(items: Item[]): typeof NO_COUNTS {
  const cached = countsCache.get(items)
  if (cached) return cached
  const c = { inbox: 0, library: 0, favorites: 0, archive: 0 }
  for (const it of items) {
    if (it.status === 'inbox') c.inbox++
    else if (it.status === 'library') c.library++
    else c.archive++
    if (it.favorite === 1 && it.status !== 'archive') c.favorites++
  }
  countsCache.set(items, c)
  return c
}

export function useCategories(): Category[] {
  return useLiveQuery(() => db.categories.orderBy('order').toArray(), []) ?? []
}

export function useVisibleItems(base: ItemFilter): VisibleResult & { loading: boolean } {
  const items = useAllItems()
  const categories = useCategories()
  const filter = useUi((s) => s.filter)
  const query = useUi((s) => s.query)
  const sort = useUi((s) => s.sort)

  // base приходит литералом на каждый рендер — стабилизируем по содержимому.
  const baseKey = JSON.stringify(base)

  return useMemo(() => {
    if (!items) return { hits: [], total: 0, loading: true }
    const stableBase = JSON.parse(baseKey) as ItemFilter
    return { ...computeVisible(items, categories, stableBase, filter, query, sort), loading: false }
  }, [items, categories, baseKey, filter, query, sort])
}

export function useAllTags(): Array<{ tag: string; count: number }> {
  const items = useAllItems()
  return items ? computeAllTags(items) : NO_TAGS
}

export function useCounts(): { inbox: number; library: number; favorites: number; archive: number } {
  const items = useAllItems()
  return items ? computeCounts(items) : NO_COUNTS
}

export function useFileUrl(fileId: string | undefined, kind: 'thumb' | 'full' = 'thumb'): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined)

  useEffect(() => {
    setUrl(undefined)
    if (!fileId) return
    let cancelled = false
    let created: string | undefined
    void getFile(fileId).then((file) => {
      if (cancelled || !file) return
      const blob = kind === 'thumb' && file.thumb ? file.thumb : file.blob
      created = URL.createObjectURL(blob)
      setUrl(created)
    })
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [fileId, kind])

  return url
}

export function useItem(id: string | null | undefined): Item | undefined {
  return useLiveQuery(() => (id ? db.items.get(id) : undefined), [id])
}

export function useLinkedItems(item: Pick<Item, 'links'> | undefined | null): Item[] {
  const key = item?.links.join('|') ?? ''
  return (
    useLiveQuery(async () => {
      const found = await db.items.bulkGet(key ? key.split('|') : [])
      return found.filter((x): x is Item => !!x)
    }, [key]) ?? []
  )
}
