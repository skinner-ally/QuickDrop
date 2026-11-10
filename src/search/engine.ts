import MiniSearch from 'minisearch'
import type { Category, Item, ItemFilter } from '@/types'
import { categoryNameKey } from '@/lib/normalize'
import { matchesFilter } from './filter'
import { foldCollapse, indexTerms, queryTerm, queryWords, tokenize } from './normalize'
import { parseQuery } from './query'

export type SearchHit = { item: Item; score: number; terms: string[] }

export interface SearchOptions {
  /**
   * Искать только среди этих записей (подмножество items: раздел, фильтры интерфейса).
   * Индекс при этом синхронизируется со ВСЕМ items, поэтому смена раздела или фильтра его не
   * перестраивает. Без текста результат идёт в порядке within (удобно передать уже отсортированный).
   */
  within?: readonly Item[]
}

/** Плоский документ индекса: поля записи + имя категории. */
interface IndexDoc {
  id: string
  title: string
  tags: string
  url: string
  content: string
  fileName: string
  linkTitle: string
  linkDescription: string
  siteName: string
  category: string
  language: string
}

type DocField = Exclude<keyof IndexDoc, 'id'>

const FIELDS: DocField[] = [
  'title', 'tags', 'url', 'content', 'fileName',
  'linkTitle', 'linkDescription', 'siteName', 'category', 'language',
]

/** Гигантские вставки (логи, дампы) индексируем по началу — иначе один документ тормозит всё. */
const MAX_INDEXED_CONTENT = 100_000

/** При массовых изменениях пересобрать индекс дешевле, чем делать сотни discard. */
const REBUILD_MIN_CHANGES = 50

function createIndex(): MiniSearch<IndexDoc> {
  return new MiniSearch<IndexDoc>({
    idField: 'id',
    fields: FIELDS,
    storeFields: [],
    tokenize: (text) => tokenize(text),
    processTerm: (term) => indexTerms(term),
    searchOptions: {
      // linkTitle — фактический заголовок ссылки, пока пользователь не задал свой.
      boost: { title: 3, tags: 2, linkTitle: 1.5 },
      prefix: true,
      fuzzy: (term) => (term.length >= 4 ? 0.2 : false),
      combineWith: 'AND',
      tokenize: (text) => tokenize(text),
      processTerm: (term) => queryTerm(term),
    },
  })
}

function toDoc(item: Item, category: string): IndexDoc {
  return {
    id: item.id,
    title: item.title ?? '',
    tags: (item.tags ?? []).join(' '),
    url: item.url ?? '',
    content: (item.content ?? '').slice(0, MAX_INDEXED_CONTENT),
    fileName: item.fileName ?? '',
    linkTitle: item.linkMeta?.title ?? '',
    linkDescription: item.linkMeta?.description ?? '',
    siteName: item.linkMeta?.siteName ?? '',
    category,
    language: item.language ?? '',
  }
}

interface Entry {
  updatedAt: number
  /** Имя категории на момент индексации — переименование категории требует переиндексации. */
  category: string
  /** Нормализованный текст всех полей для «точных фраз»; считается лениво. */
  haystack?: string
}

interface IndexCache {
  index: MiniSearch<IndexDoc>
  entries: Map<string, Entry>
}

export type SearchIndexStats = {
  /** Документов в индексе. */
  size: number
  /** Что сделала последняя синхронизация. */
  added: number
  replaced: number
  discarded: number
  rebuilt: boolean
}

let cache: IndexCache | null = null
let lastSync: Omit<SearchIndexStats, 'size'> = { added: 0, replaced: 0, discarded: 0, rebuilt: false }
/** С каким массивом и именами категорий индекс синхронизирован в последний раз (быстрый путь). */
let syncedItems: readonly Item[] | null = null
let syncedLength = 0
let syncedCats = ''

/** Сбросить кэш индекса (тесты, полная очистка данных). */
export function resetSearchIndex(): void {
  cache = null
  syncedItems = null
  syncedCats = ''
  lastSync = { added: 0, replaced: 0, discarded: 0, rebuilt: false }
}

export function getSearchIndexStats(): SearchIndexStats {
  return { size: cache?.index.documentCount ?? 0, ...lastSync }
}

const categoryOf = (item: Item, names: Map<string, string>) =>
  item.categoryId ? (names.get(item.categoryId) ?? '') : ''

function rebuild(items: Array<[Item, string]>): IndexCache {
  const index = createIndex()
  const entries = new Map<string, Entry>()
  index.addAll(items.map(([item, cat]) => toDoc(item, cat)))
  for (const [item, cat] of items) entries.set(item.id, { updatedAt: item.updatedAt, category: cat })
  return { index, entries }
}

/**
 * Приводит индекс к переданному набору записей: новые — add, изменённые (updatedAt или имя
 * категории) — replace, исчезнувшие — discard. Передавать нужно ВСЕ записи базы: отсутствующие
 * в наборе выбрасываются из индекса.
 */
function syncIndex(items: readonly Item[], catNames: Map<string, string>): IndexCache {
  // Тот же массив (liveQuery отдаёт новый при любой мутации) и те же имена категорий — сверять нечего.
  const catsKey = [...catNames].join('\u0001')
  if (cache && items === syncedItems && items.length === syncedLength && catsKey === syncedCats) {
    lastSync = { added: 0, replaced: 0, discarded: 0, rebuilt: false }
    return cache
  }
  const result = syncIndexSlow(items, catNames)
  syncedItems = items
  syncedLength = items.length
  syncedCats = catsKey
  return result
}

function syncIndexSlow(items: readonly Item[], catNames: Map<string, string>): IndexCache {
  const current: Array<[Item, string]> = []
  const seen = new Set<string>()
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue
    seen.add(item.id)
    current.push([item, categoryOf(item, catNames)])
  }

  if (!cache) {
    cache = rebuild(current)
    lastSync = { added: current.length, replaced: 0, discarded: 0, rebuilt: true }
    return cache
  }

  const { entries } = cache
  const toAdd: Array<[Item, string]> = []
  const toReplace: Array<[Item, string]> = []
  for (const pair of current) {
    const e = entries.get(pair[0].id)
    if (!e) toAdd.push(pair)
    else if (e.updatedAt !== pair[0].updatedAt || e.category !== pair[1]) toReplace.push(pair)
  }
  const toDiscard: string[] = []
  for (const id of entries.keys()) if (!seen.has(id)) toDiscard.push(id)

  const changed = toReplace.length + toDiscard.length
  if (changed > REBUILD_MIN_CHANGES && changed > entries.size / 2) {
    cache = rebuild(current)
    lastSync = { added: current.length, replaced: 0, discarded: 0, rebuilt: true }
    return cache
  }

  try {
    const { index } = cache
    for (const id of toDiscard) {
      index.discard(id)
      entries.delete(id)
    }
    for (const [item, cat] of toReplace) {
      index.replace(toDoc(item, cat))
      entries.set(item.id, { updatedAt: item.updatedAt, category: cat })
    }
    for (const [item, cat] of toAdd) {
      index.add(toDoc(item, cat))
      entries.set(item.id, { updatedAt: item.updatedAt, category: cat })
    }
    lastSync = { added: toAdd.length, replaced: toReplace.length, discarded: toDiscard.length, rebuilt: false }
  } catch {
    // Рассинхрон индекса и кэша (не должен случаться) — надёжнее пересобрать с нуля.
    cache = rebuild(current)
    lastSync = { added: current.length, replaced: 0, discarded: 0, rebuilt: true }
  }
  return cache
}

const categoryNames = (cats: Category[]) => new Map(cats.map((cat) => [cat.id, cat.name]))

/**
 * Построить/обновить индекс заранее (например, в requestIdleCallback после загрузки записей),
 * чтобы первый введённый символ не ждал полной индексации.
 */
export function prepareSearchIndex(items: readonly Item[], categories?: Category[]): void {
  syncIndex(items, categoryNames(categories ?? []))
}

// \0 между полями: фраза не должна «склеиваться» из конца одного поля и начала другого.
const haystackOfDoc = (doc: IndexDoc) => FIELDS.map((f) => foldCollapse(doc[f])).join('\0')

function haystackOf(c: IndexCache, item: Item, catNames: Map<string, string>): string {
  const e = c.entries.get(item.id)
  // Записи нет в индексе (within шире items) — считаем без кэша, чтобы фраза всё равно проверялась.
  if (!e) return haystackOfDoc(toDoc(item, categoryOf(item, catNames)))
  e.haystack ??= haystackOfDoc(toDoc(item, e.category))
  return e.haystack
}

/** Псевдоимена для «без категории», если категории с таким именем нет. */
const NO_CATEGORY = new Set(['none', 'без', 'нет', 'без категории'])

/** id категории по имени (регистр, ё/е, дефисы не важны); null — «без категории»; undefined — нет такой. */
export function resolveCategoryName(name: string, categories: Category[]): string | null | undefined {
  const key = categoryNameKey(name)
  const found = categories.find((c) => categoryNameKey(c.name) === key)
  if (found) return found.id
  if (NO_CATEGORY.has(key)) return null
  return undefined
}

const unique = (arr: string[]) => [...new Set(arr)]

/**
 * Поиск: операторы запроса → фильтр, «фразы» → подстроки, остальное → MiniSearch
 * (префикс + опечатки, все слова обязательны). Пустой текст — все записи, прошедшие фильтр,
 * в исходном порядке (items или options.within) со score 0.
 * items — все записи базы: с ними синхронизируется кэш индекса. Сузить выдачу до раздела
 * или фильтра — через options.within, а не передачей подмножества (иначе индекс перестраивается).
 */
export function searchItems(
  items: readonly Item[],
  raw: string,
  categories?: Category[],
  options?: SearchOptions,
): SearchHit[] {
  const q = parseQuery(raw)
  const cats = categories ?? []

  const filter: ItemFilter = { ...q.filter }
  if (q.categoryName !== undefined) {
    const id = resolveCategoryName(q.categoryName, cats)
    if (id === undefined) return []
    filter.categoryId = id
  }

  const textTerms = queryWords(q.text)
  const phrases = q.phrases.map(foldCollapse).filter(Boolean)
  const phraseTerms = q.phrases.flatMap(queryWords)

  // Индекс нужен только для текста и фраз: чистые фильтры не платят за его построение.
  const catNames = categoryNames(cats)
  const c = textTerms.length > 0 || phrases.length > 0 ? syncIndex(items, catNames) : null

  const passed: Item[] = []
  for (const item of options?.within ?? items) {
    if (!matchesFilter(item, filter)) continue
    if (c && phrases.length > 0) {
      const hay = haystackOf(c, item, catNames)
      if (!phrases.every((p) => hay.includes(p))) continue
    }
    passed.push(item)
  }

  if (!c || textTerms.length === 0) {
    const terms = unique(phraseTerms)
    return passed.map((item) => ({ item, score: 0, terms: [...terms] }))
  }

  const byId = new Map<string, Item>()
  for (const item of passed) if (!byId.has(item.id)) byId.set(item.id, item)

  const extra = [...textTerms, ...phraseTerms]
  const hits: SearchHit[] = []
  for (const r of c.index.search(q.text, { filter: (r) => byId.has(r.id) })) {
    const item = byId.get(r.id)
    if (item) hits.push({ item, score: r.score, terms: unique([...r.terms, ...extra]) })
  }
  return hits.sort((a, b) => b.score - a.score)
}
