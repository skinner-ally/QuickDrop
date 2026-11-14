import { matchesFilter, sortItems } from '@/db/repo'
import { matchesFilterIgnoringTrash, parseQuery, queryWords, searchItems } from '@/search'
import type { SearchHit } from '@/search'
import type { UiFilter } from '@/store/ui'
import type { Category, Item, ItemFilter, SortMode } from '@/types'

export type VisibleResult = { hits: SearchHit[]; total: number }

/**
 * Чистая логика списков: base раздела + фильтры UI + строка поиска + сортировка.
 * total — число записей, проходящих только base (для «показано N из M»).
 * items — все записи базы, включая корзину: индекс поиска синхронизируется с полным набором, а
 * раздел и фильтры передаются ограничением within — иначе каждая смена раздела (и вход в корзину)
 * перестраивала бы индекс. now — «сейчас» для относительных дат запроса (тесты).
 */
export function computeVisible(
  items: Item[],
  categories: Category[],
  base: ItemFilter,
  uiFilter: UiFilter,
  query: string,
  sort: SortMode,
  now?: number,
): VisibleResult {
  const parsed = parseQuery(query, now)
  const { status, trashed } = parsed.filter

  let effectiveBase = base
  if (trashed === true) {
    // is:trash ищет в корзине из любого раздела: условия раздела (статус, избранное) снимаются.
    effectiveBase = status !== undefined ? { trashed: true, status } : { trashed: true }
  } else if (status !== undefined) {
    // is:archive и т.п. из строки поиска переопределяют статус раздела.
    effectiveBase = { ...base, status }
  }

  let total = 0
  let pre: Item[] = []
  for (const item of items) {
    // При переопределённом статусе total считаем по нему же, иначе «N из M» врёт.
    if (!matchesFilter(item, effectiveBase)) continue
    total++
    // Корзину уже отобрал base; у фильтров интерфейса такого поля нет.
    if (matchesFilterIgnoringTrash(item, uiFilter)) pre.push(item)
  }

  // Есть слова для поиска — порядок по релевантности. Иначе (пусто, только фразы, только
  // пунктуация вроде «!!!») релевантности нет, а searchItems сохраняет порядок within.
  if (queryWords(parsed.text).length === 0) pre = sortItems(pre, sort)

  return { hits: searchItems(items, query, categories, { within: pre, trash: 'any', now }), total }
}
