import { normalizeTag } from '@/lib/normalize'
import { parseQuery, resolveCategoryName } from '@/search'
import type { Category, Item, ItemFilter } from '@/types'

/**
 * Подсказка в пустой выдаче: чего из запроса и фильтров нет в базе.
 * category — cat:имя из строки поиска; tag — тег из строки или фильтра; filter-category — id категории
 * фильтра, которой больше нет (name — этот id, в тексте не показывается).
 */
export interface QueryHint {
  kind: 'category' | 'tag' | 'filter-category'
  name: string
}

/** Больше двух подсказок подряд не читаются — остальное скажет «Сбросить». */
const MAX_HINTS = 2

/**
 * Чего из запроса и фильтров нет в базе. knownTags === null — теги не проверять (корзина).
 * Порядок: категория строки, категория фильтра, теги (сначала строки, затем фильтра), без повторов.
 */
export function missingQueryTargets(
  query: string,
  filter: Pick<ItemFilter, 'categoryId' | 'tags'>,
  categories: readonly Category[],
  knownTags: readonly string[] | null,
  now?: number,
): QueryHint[] {
  const hints: QueryHint[] = []
  const parsed = parseQuery(query ?? '', now)

  if (parsed.categoryName !== undefined && resolveCategoryName(parsed.categoryName, categories) === undefined) {
    hints.push({ kind: 'category', name: parsed.categoryName.trim() })
  }

  const filterCat = filter.categoryId
  if (typeof filterCat === 'string' && !categories.some((c) => c.id === filterCat)) {
    hints.push({ kind: 'filter-category', name: filterCat })
  }

  if (knownTags !== null) {
    const known = new Set(knownTags)
    const seen = new Set<string>()
    for (const raw of [...(parsed.filter.tags ?? []), ...(filter.tags ?? [])]) {
      const tag = normalizeTag(raw)
      if (!tag || seen.has(tag)) continue
      seen.add(tag)
      if (!known.has(tag)) hints.push({ kind: 'tag', name: tag })
    }
  }

  return hints
}

function hintSentence(hint: QueryHint): string {
  switch (hint.kind) {
    case 'category':
      return `Категории «${hint.name}» нет — возможно, её удалили или переименовали.`
    case 'tag':
      return `Тега #${hint.name} нет ни у одной записи.`
    case 'filter-category':
      return 'Выбранной категории больше нет.'
  }
}

/** Текст подсказок через пробел, не больше двух; null — подсказывать нечего. */
export function queryHintText(hints: readonly QueryHint[]): string | null {
  if (hints.length === 0) return null
  return hints.slice(0, MAX_HINTS).map(hintSentence).join(' ')
}

/** Все теги записей (нормализованные, без повторов) — knownTags для missingQueryTargets. */
export function collectTags(items: readonly Pick<Item, 'tags'>[]): string[] {
  const out = new Set<string>()
  for (const it of items) {
    if (!Array.isArray(it.tags)) continue
    for (const t of it.tags) if (typeof t === 'string' && t) out.add(t)
  }
  return [...out]
}
