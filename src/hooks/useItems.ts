import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { liveQuery, type Subscription } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db'
import { getFile, getPositions } from '@/db/repo'
import { addDays, startOfDay } from '@/lib/dates'
import { isSearchIndexReady, prepareSearchIndexAsync } from '@/search'
import { useUi } from '@/store/ui'
import type { Category, GraphPoint, Item, ItemFilter, SavedSearch } from '@/types'
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

/** Запас для requestIdleCallback: индекс строится не позже, даже если простоя не было. */
export const SEARCH_PREPARE_TIMEOUT_MS = 3000

/**
 * Индекс поиска строится в простое после снимка, а не на первом введённом символе. Повторные
 * вызовы до готовности индекса склеивает prepareSearchIndexAsync. Категории читаются тем же
 * запросом, что в useCategories: тогда поиск сразу берёт готовый индекс.
 */
function schedulePrepareIndex(): void {
  if (isSearchIndexReady()) return
  const run = () => {
    const items = snapshot
    if (!items || isSearchIndexReady()) return
    void db.categories
      .orderBy('order')
      .toArray()
      .then((categories) => prepareSearchIndexAsync(items, categories))
      .catch(() => {
        // необязательная подготовка: поиск построит индекс сам
      })
  }
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: SEARCH_PREPARE_TIMEOUT_MS })
  else setTimeout(run, 0)
}

function subscribeItems(): void {
  subscription = liveQuery(() => db.items.toArray()).subscribe({
    next: (items) => {
      snapshot = items
      failed = false
      retryDelay = ITEMS_RETRY_MIN_MS
      emit()
      schedulePrepareIndex()
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

// Срезы снимка считаются один раз на снимок, а их ссылки стабильны: этого требует
// useSyncExternalStore, и на этом держится быстрый путь индекса поиска (тот же массив — без сверки).
type Slices = { live: Item[]; trashed: Item[] }
const NO_ITEMS: Item[] = []
const slicesCache = new WeakMap<Item[], Slices>()

function slicesOf(all: Item[]): Slices {
  const cached = slicesCache.get(all)
  if (cached) return cached
  let slices: Slices
  if (all.some((it) => it.deletedAt !== undefined)) {
    const live: Item[] = []
    const trashed: Item[] = []
    for (const it of all) (it.deletedAt === undefined ? live : trashed).push(it)
    trashed.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
    slices = { live, trashed }
  } else {
    // Корзина пуста — срез «без корзины» и есть полный снимок: производные кэши и индекс не раздваиваются.
    slices = { live: all, trashed: NO_ITEMS }
  }
  slicesCache.set(all, slices)
  return slices
}

/** Все записи, включая корзину (для поиска); undefined — первое чтение ещё не завершилось. */
export function getItemsWithTrashSnapshot(): Item[] | undefined {
  return snapshot
}

/** Записи вне корзины; undefined — первое чтение ещё не завершилось. */
export function getAllItemsSnapshot(): Item[] | undefined {
  return snapshot && slicesOf(snapshot).live
}

/** Только корзина, недавно удалённые — первыми. */
export function getTrashedItemsSnapshot(): Item[] | undefined {
  return snapshot && slicesOf(snapshot).trashed
}

export function useAllItems(): Item[] | undefined {
  return useSyncExternalStore(subscribeAllItems, getAllItemsSnapshot, getAllItemsSnapshot)
}

export function useTrashedItems(): Item[] | undefined {
  return useSyncExternalStore(subscribeAllItems, getTrashedItemsSnapshot, getTrashedItemsSnapshot)
}

export function useItemsWithTrash(): Item[] | undefined {
  return useSyncExternalStore(subscribeAllItems, getItemsWithTrashSnapshot, getItemsWithTrashSnapshot)
}

export function useTrashCount(): number {
  return useTrashedItems()?.length ?? 0
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
const NO_SEARCHES: SavedSearch[] = []
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

/** Числа боковой панели у категорий (ключ null — без категории) и тегов. */
export type LegendCounts = { tags: TagCount[]; perCategory: ReadonlyMap<string | null, number> }

/**
 * Числа у категорий и тегов боковой панели. Вне «Графа» клик открывает «Базу знаний» — считаются её записи.
 * В «Графе» панель — легенда видимых нод: все записи вне корзины, архив — только при showArchive.
 * items — записи вне корзины (useAllItems). Теги — как computeAllTags: по убыванию числа, затем по алфавиту.
 */
export function computeLegend(items: readonly Item[], inGraph: boolean, showArchive: boolean): LegendCounts {
  const tagCounts = new Map<string, number>()
  const perCategory = new Map<string | null, number>()
  for (const it of items) {
    if (it.deletedAt !== undefined) continue
    if (inGraph ? !showArchive && it.status === 'archive' : it.status !== 'library') continue
    const cat = it.categoryId ?? null
    perCategory.set(cat, (perCategory.get(cat) ?? 0) + 1)
    if (!Array.isArray(it.tags)) continue
    for (const t of it.tags) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)
  }
  const tags = [...tagCounts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  return { tags, perCategory }
}

const legendCache = new WeakMap<Item[], Map<string, LegendCounts>>()
const NO_LEGEND: LegendCounts = { tags: NO_TAGS, perCategory: new Map() }

/** computeLegend по общему снимку: один расчёт на снимок и режим, ссылка стабильна между рендерами. */
export function useLegendCounts(inGraph: boolean, showArchive: boolean): LegendCounts {
  const items = useAllItems()
  if (!items) return NO_LEGEND
  // Вне «Графа» показ архива не влияет: ключ один, лишних пересчётов нет.
  const key = inGraph ? (showArchive ? 'graph+archive' : 'graph') : 'library'
  let byKey = legendCache.get(items)
  if (!byKey) {
    byKey = new Map()
    legendCache.set(items, byKey)
  }
  let out = byKey.get(key)
  if (!out) {
    out = computeLegend(items, inGraph, showArchive)
    byKey.set(key, out)
  }
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

const NO_CATEGORIES: Category[] = []

/** Категории по order; undefined — первое чтение ещё не завершилось (в отличие от «категорий нет»). */
export function useCategoryList(): Category[] | undefined {
  return useLiveQuery(() => db.categories.orderBy('order').toArray(), [])
}

export function useCategories(): Category[] {
  // Общий пустой массив: пока идёт чтение, ссылка не меняется на каждом рендере.
  return useCategoryList() ?? NO_CATEGORIES
}

export function usePositions(): Record<string, GraphPoint> | undefined {
  return useLiveQuery(getPositions, [])
}

export function useSavedSearches(): SavedSearch[] {
  return useLiveQuery(() => db.searches.orderBy('order').toArray(), []) ?? NO_SEARCHES
}

// ───────────────── текущие сутки ─────────────────

const dayListeners = new Set<() => void>()
let dayTimer: ReturnType<typeof setTimeout> | undefined

/** Начало текущих локальных суток. */
export function getDayKey(): number {
  return startOfDay(Date.now())
}

function notifyDay(): void {
  for (const listener of [...dayListeners]) listener()
}

function armDayTimer(): void {
  if (dayTimer !== undefined) clearTimeout(dayTimer)
  // Сработал чуть раньше полуночи — ключ ещё прежний, новый таймер встанет на остаток.
  const next = startOfDay(addDays(getDayKey(), 1))
  dayTimer = setTimeout(onDayTimer, Math.max(next - Date.now(), 0))
}

function onDayTimer(): void {
  dayTimer = undefined
  notifyDay()
  if (dayListeners.size > 0) armDayTimer()
}

/** После сна устройства таймер запаздывает: при возврате в окно сверяемся заново. */
function onDayWake(): void {
  if (document.visibilityState !== 'visible') return
  notifyDay()
  armDayTimer()
}

/** Подписка на смену суток (для useSyncExternalStore и тестов). */
export function subscribeDayKey(listener: () => void): () => void {
  dayListeners.add(listener)
  if (dayListeners.size === 1) {
    armDayTimer()
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onDayWake)
  }
  return () => {
    dayListeners.delete(listener)
    if (dayListeners.size > 0) return
    if (dayTimer !== undefined) clearTimeout(dayTimer)
    dayTimer = undefined
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onDayWake)
  }
}

/** Начало текущих локальных суток; обновляется в полночь. */
export function useDayKey(): number {
  return useSyncExternalStore(subscribeDayKey, getDayKey, getDayKey)
}

export function useVisibleItems(base: ItemFilter): VisibleResult & { loading: boolean } {
  // Полный набор, включая корзину: её отсекает фильтр, а индекс поиска не перестраивается при входе в «Корзину».
  const items = useItemsWithTrash()
  const categories = useCategories()
  const filter = useUi((s) => s.filter)
  const query = useUi((s) => s.query)
  const sort = useUi((s) => s.sort)
  const dayKey = useDayKey()

  // base приходит литералом на каждый рендер — стабилизируем по содержимому.
  const baseKey = JSON.stringify(base)

  return useMemo(() => {
    // Относительные даты запроса («за неделю») считаются от «сейчас»: со сменой суток список пересчитывается.
    void dayKey
    if (!items) return { hits: [], total: 0, loading: true }
    const stableBase = JSON.parse(baseKey) as ItemFilter
    return { ...computeVisible(items, categories, stableBase, filter, query, sort), loading: false }
  }, [items, categories, baseKey, filter, query, sort, dayKey])
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

/** Связанные записи без лежащих в корзине: связь при удалении сохраняется, но в списке её не видно. */
export function useLinkedItems(item: Pick<Item, 'links'> | undefined | null): Item[] {
  const key = item?.links.join('|') ?? ''
  return (
    useLiveQuery(async () => {
      const found = await db.items.bulkGet(key ? key.split('|') : [])
      return found.filter((x): x is Item => !!x && x.deletedAt === undefined)
    }, [key]) ?? []
  )
}
