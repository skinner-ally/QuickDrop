import MiniSearch from 'minisearch'
import type { Category, Item, ItemFilter } from '@/types'
import { categoryNameKey } from '@/lib/normalize'
import { matchesFilter, matchesFilterIgnoringTrash } from './filter'
import { foldCollapse, indexTerms, queryTerm, queryWords, tokenize } from './normalize'
import { parseQuery } from './query'
import type { ParsedQuery } from './query'

export type SearchHit = { item: Item; score: number; terms: string[] }

export interface SearchOptions {
  /**
   * Искать только среди этих записей (подмножество items: раздел, фильтры интерфейса).
   * Индекс при этом синхронизируется со ВСЕМ items, поэтому смена раздела или фильтра его не
   * перестраивает. Без текста результат идёт в порядке within (удобно передать уже отсортированный).
   */
  within?: readonly Item[]
  /** false (по умолчанию) — только вне корзины; true — только корзина; 'any' — корзину не проверять (within уже отобран). */
  trash?: boolean | 'any'
  /** «Сейчас» для относительных дат (тесты). */
  now?: number
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
  ocrText: string
}

type DocField = Exclude<keyof IndexDoc, 'id'>

const FIELDS: DocField[] = [
  'title', 'tags', 'url', 'content', 'fileName',
  'linkTitle', 'linkDescription', 'siteName', 'category', 'language', 'ocrText',
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
    ocrText: (item.ocrText ?? '').slice(0, MAX_INDEXED_CONTENT),
  }
}

interface Entry {
  updatedAt: number
  /** setOcrText не меняет updatedAt — распознанный текст сверяется по своей отметке. */
  ocrAt: number
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
/** Растёт при сбросе: построенный заранее индекс не ставится поверх сброса. */
let generation = 0
let preparing: Promise<void> | null = null
let preparingGeneration = -1

/** Сбросить кэш индекса (тесты, полная очистка данных). */
export function resetSearchIndex(): void {
  cache = null
  syncedItems = null
  syncedCats = ''
  generation++
  lastSync = { added: 0, replaced: 0, discarded: 0, rebuilt: false }
}

/** Индекс уже построен (первый текстовый запрос не будет его ждать). */
export function isSearchIndexReady(): boolean {
  return cache !== null
}

export function getSearchIndexStats(): SearchIndexStats {
  return { size: cache?.index.documentCount ?? 0, ...lastSync }
}

const categoryOf = (item: Item, names: Map<string, string>) =>
  item.categoryId ? (names.get(item.categoryId) ?? '') : ''

const entryOf = (item: Item, category: string): Entry => ({
  updatedAt: item.updatedAt,
  ocrAt: item.ocrAt ?? 0,
  category,
})

function rebuild(items: Array<[Item, string]>): IndexCache {
  const index = createIndex()
  const entries = new Map<string, Entry>()
  index.addAll(items.map(([item, cat]) => toDoc(item, cat)))
  for (const [item, cat] of items) entries.set(item.id, entryOf(item, cat))
  return { index, entries }
}

/**
 * Приводит индекс к переданному набору записей: новые — add, изменённые (updatedAt, ocrAt или имя
 * категории) — replace, исчезнувшие — discard. Передавать нужно ВСЕ записи базы: отсутствующие
 * в наборе выбрасываются из индекса.
 */
const catsKeyOf = (catNames: Map<string, string>) => [...catNames].join('\u0001')

function syncIndex(items: readonly Item[], catNames: Map<string, string>): IndexCache {
  // Тот же массив (liveQuery отдаёт новый при любой мутации) и те же имена категорий — сверять нечего.
  const catsKey = catsKeyOf(catNames)
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

/** Записи с именами категорий, без дублей id. */
function pairsOf(items: readonly Item[], catNames: Map<string, string>) {
  const current: Array<[Item, string]> = []
  const seen = new Set<string>()
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue
    seen.add(item.id)
    current.push([item, categoryOf(item, catNames)])
  }
  return { current, seen }
}

function syncIndexSlow(items: readonly Item[], catNames: Map<string, string>): IndexCache {
  const { current, seen } = pairsOf(items, catNames)

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
    else if (
      e.updatedAt !== pair[0].updatedAt ||
      e.category !== pair[1] ||
      e.ocrAt !== (pair[0].ocrAt ?? 0)
    ) {
      toReplace.push(pair)
    }
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
      entries.set(item.id, entryOf(item, cat))
    }
    for (const [item, cat] of toAdd) {
      index.add(toDoc(item, cat))
      entries.set(item.id, entryOf(item, cat))
    }
    lastSync = { added: toAdd.length, replaced: toReplace.length, discarded: toDiscard.length, rebuilt: false }
  } catch {
    // Рассинхрон индекса и кэша (не должен случаться) — надёжнее пересобрать с нуля.
    cache = rebuild(current)
    lastSync = { added: current.length, replaced: 0, discarded: 0, rebuilt: true }
  }
  return cache
}

const categoryNames = (cats: readonly Category[]) => new Map(cats.map((cat) => [cat.id, cat.name]))

/**
 * Построить/обновить индекс заранее (например, в requestIdleCallback после загрузки записей),
 * чтобы первый введённый символ не ждал полной индексации.
 */
export function prepareSearchIndex(items: readonly Item[], categories?: Category[]): void {
  syncIndex(items, categoryNames(categories ?? []))
}

/** Порция заранее строящегося индекса: и по числу записей, и по объёму текста (PDF до 100 тыс. символов). */
const PREPARE_CHUNK_DOCS = 100
const PREPARE_CHUNK_CHARS = 200_000

/**
 * Построить индекс заранее, порциями с передачей управления между ними: при десятках больших PDF
 * построение занимает до секунды, одной задачей оно держало бы интерфейс. Если индекс уже есть,
 * ничего не делает — изменения досинхронизирует сам поиск. Не бросает наружу ошибок построения.
 */
export function prepareSearchIndexAsync(items: readonly Item[], categories?: readonly Category[]): Promise<void> {
  if (cache) return Promise.resolve()
  if (preparing && preparingGeneration === generation) return preparing
  const started = generation
  // Поиск успел построить индекс сам или его сбросили — построенный здесь уже не нужен.
  const stale = () => cache !== null || generation !== started
  preparingGeneration = started
  const job: Promise<void> = (async () => {
    const catNames = categoryNames(categories ?? [])
    const { current } = pairsOf(items, catNames)
    const index = createIndex()
    let batch: IndexDoc[] = []
    let chars = 0
    for (const [item, cat] of current) {
      const doc = toDoc(item, cat)
      batch.push(doc)
      chars += doc.content.length + doc.ocrText.length + 100
      if (batch.length < PREPARE_CHUNK_DOCS && chars < PREPARE_CHUNK_CHARS) continue
      index.addAll(batch)
      batch = []
      chars = 0
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (stale()) return
    }
    index.addAll(batch)
    if (stale()) return
    const entries = new Map<string, Entry>()
    for (const [item, cat] of current) entries.set(item.id, entryOf(item, cat))
    cache = { index, entries }
    syncedItems = items
    syncedLength = items.length
    syncedCats = catsKeyOf(catNames)
    lastSync = { added: current.length, replaced: 0, discarded: 0, rebuilt: true }
  })()
    .catch((e: unknown) => console.warn('QuickDrop: не удалось построить индекс поиска заранее', e))
    .finally(() => {
      if (preparing === job) preparing = null
    })
  preparing = job
  return job
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
export function resolveCategoryName(
  name: string,
  categories: readonly Category[],
): string | null | undefined {
  const key = categoryNameKey(name)
  const found = categories.find((c) => categoryNameKey(c.name) === key)
  if (found) return found.id
  if (NO_CATEGORY.has(key)) return null
  return undefined
}

/** Фильтр из разобранного запроса: cat:имя переводится в categoryId. null — такой категории нет. */
export function resolveQueryFilter(parsed: ParsedQuery, categories: readonly Category[]): ItemFilter | null {
  const filter: ItemFilter = { ...parsed.filter }
  if (parsed.categoryName !== undefined) {
    const id = resolveCategoryName(parsed.categoryName, categories)
    if (id === undefined) return null
    filter.categoryId = id
  }
  return filter
}

const unique = (arr: string[]) => [...new Set(arr)]

/**
 * Поиск: операторы запроса → фильтр, «фразы» → подстроки, остальное → MiniSearch
 * (префикс + опечатки, все слова обязательны). Пустой текст — все записи, прошедшие фильтр,
 * в исходном порядке (items или options.within) со score 0.
 * items — все записи базы, включая корзину: с ними синхронизируется кэш индекса. Сузить выдачу
 * до раздела или фильтра — через options.within, а не передачей подмножества (иначе индекс
 * перестраивается). Записи корзины в выдачу не попадают без is:trash или options.trash.
 */
export function searchItems(
  items: readonly Item[],
  raw: string,
  categories?: Category[],
  options?: SearchOptions,
): SearchHit[] {
  const q = parseQuery(raw, options?.now)
  const cats = categories ?? []

  const filter = resolveQueryFilter(q, cats)
  if (!filter) return []

  const anyTrash = options?.trash === 'any'
  if (!anyTrash) filter.trashed = q.filter.trashed === true || options?.trash === true
  const matches = anyTrash ? matchesFilterIgnoringTrash : matchesFilter

  const textTerms = queryWords(q.text)
  const phrases = q.phrases.map(foldCollapse).filter(Boolean)
  const phraseTerms = q.phrases.flatMap(queryWords)

  // Индекс нужен только для текста и фраз: чистые фильтры не платят за его построение.
  const catNames = categoryNames(cats)
  const c = textTerms.length > 0 || phrases.length > 0 ? syncIndex(items, catNames) : null

  const passed: Item[] = []
  for (const item of options?.within ?? items) {
    if (!matches(item, filter)) continue
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
