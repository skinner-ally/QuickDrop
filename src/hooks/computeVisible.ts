import { matchesFilter, sortItems } from '@/db/repo'
import { parseQuery, queryWords, searchItems } from '@/search'
import type { SearchHit } from '@/search'
import type { Category, Item, ItemFilter, SortMode } from '@/types'

export type VisibleResult = { hits: SearchHit[]; total: number }

/**
 * Чистая логика списков: base раздела + фильтры UI + строка поиска + сортировка.
 * total — число записей, проходящих только base (для «показано N из M»).
 * items — все записи базы: индекс поиска синхронизируется с полным набором, а раздел и фильтры
 * передаются ограничением within — иначе каждая смена раздела перестраивала бы индекс.
 */
export function computeVisible(
  items: Item[],
  categories: Category[],
  base: ItemFilter,
  uiFilter: Omit<ItemFilter, 'status' | 'favorite'>,
  query: string,
  sort: SortMode,
): VisibleResult {
  const parsed = parseQuery(query)

  // is:archive и т.п. из строки поиска переопределяют статус раздела.
  const effectiveBase: ItemFilter =
    parsed.filter.status !== undefined ? { ...base, status: parsed.filter.status } : base

  let total = 0
  let pre: Item[] = []
  for (const item of items) {
    // При переопределённом статусе total считаем по нему же, иначе «N из M» врёт.
    if (!matchesFilter(item, effectiveBase)) continue
    total++
    if (matchesFilter(item, uiFilter)) pre.push(item)
  }

  // Есть слова для поиска — порядок по релевантности. Иначе (пусто, только фразы, только
  // пунктуация вроде «!!!») релевантности нет, а searchItems сохраняет порядок within.
  if (queryWords(parsed.text).length === 0) pre = sortItems(pre, sort)

  return { hits: searchItems(items, query, categories, { within: pre }), total }
}
