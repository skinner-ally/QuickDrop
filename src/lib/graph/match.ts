/**
 * Отбор на графе: какие ноды проходят строку поиска и фильтры экрана (остальные приглушаются).
 * В отличие от computeVisible, раздел не участвует — граф показывает все записи.
 */

import { isNarrowed } from '@/lib/savedSearch'
import { matchesFilterIgnoringTrash, searchItems } from '@/search'
import type { UiFilter } from '@/store/ui'
import type { Category, Item } from '@/types'

export interface GraphMatch {
  active: boolean
  ids: ReadonlySet<string> | null
}

/**
 * Какие записи графа проходят отбор экрана. all — все записи базы (с корзиной, для индекса поиска),
 * nodes — записи графа. Отбор не задан (isNarrowed из lib/savedSearch) → { active: false, ids: null }.
 * Операторы строки (is:…, cat:, даты) работают как в списках; is:trash даёт пустое множество.
 */
export function computeGraphMatch(
  all: readonly Item[],
  nodes: readonly Item[],
  categories: Category[],
  query: string,
  filter: UiFilter,
  now?: number,
): GraphMatch {
  if (!isNarrowed(query, filter)) return { active: false, ids: null }
  const pre = nodes.filter((n) => matchesFilterIgnoringTrash(n, filter))
  if ((query ?? '').trim() === '') return { active: true, ids: new Set(pre.map((n) => n.id)) }
  const hits = searchItems(all, query, categories, { within: pre, now })
  return { active: true, ids: new Set(hits.map((h) => h.item.id)) }
}
