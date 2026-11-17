import { searchNameKey } from '@/lib/normalize'
import { composeQuery, parseQuery } from '@/search'
import type { UiFilter, View } from '@/store/ui'
import { SAVED_SEARCH_NAME_MAX } from '@/types'
import type { Category, ItemFilter, ItemStatus, SavedSearch } from '@/types'

/** Что сейчас на экране списка: раздел, строка поиска и фильтры панели. */
export interface SearchScreen {
  view: View
  query: string
  filter: UiFilter
  customDates: boolean
}

/** Есть ли что сохранять: непустая строка поиска или хотя бы одно поле фильтра. */
export function isNarrowed(query: string, filter: UiFilter): boolean {
  if ((query ?? '').trim() !== '') return true
  // Те же признаки, что у «активных фильтров» в FilterBar: null у категории — «без категории».
  return (
    !!filter.types?.length ||
    !!filter.ideaStatuses?.length ||
    filter.categoryId !== undefined ||
    !!filter.tags?.length ||
    !!filter.untagged ||
    filter.from !== undefined ||
    filter.to !== undefined
  )
}

/** Часть фильтра, которую задаёт раздел: inbox/library/archive → status, favorites → favorite, trash → trashed; иначе {}. */
export function sectionFilter(view: View): ItemFilter {
  switch (view) {
    case 'inbox':
    case 'library':
    case 'archive':
      return { status: view }
    case 'favorites':
      return { favorite: true }
    case 'trash':
      return { trashed: true }
    default:
      return {}
  }
}

/**
 * Часть раздела, которую нужно дописать к запросу, — по тем же правилам, что у computeVisible: что строка
 * поиска переопределяет, то не дописывается.
 */
function sectionPart(view: View, own: ItemFilter): ItemFilter {
  const section = sectionFilter(view)
  switch (view) {
    case 'inbox':
    case 'library':
    case 'archive':
      // Свой статус или is:trash в строке заменяют статус раздела.
      return own.status === undefined && own.trashed !== true ? section : {}
    case 'favorites':
      // computeVisible оставляет избранное и при своём статусе ({ ...base, status }); is:trash его снимает.
      return own.favorite !== true && own.trashed !== true ? section : {}
    case 'trash':
      // В корзине свой статус сужает корзину ({ trashed: true, status }): без is:trash поиск открылся бы
      // в разделе этого статуса.
      return own.trashed !== true ? section : {}
    default:
      return section
  }
}

/** Запрос для сохранения: composeQuery(строка, фильтр + раздел, категории, now, { relativeDates: !customDates }). */
export function currentSearchQuery(screen: SearchScreen, categories: readonly Category[], now?: number): string {
  if (!isNarrowed(screen.query, screen.filter)) return ''
  const at = now ?? Date.now()
  const own = parseQuery(screen.query, at).filter
  const filter: ItemFilter = { ...screen.filter, ...sectionPart(screen.view, own) }
  return composeQuery(screen.query, filter, categories, at, { relativeDates: !screen.customDates })
}

/** Раздел, заданный самим запросом: is:trash → 'trash'; ровно один статус → его раздел; is:fav → 'favorites'; иначе null. */
export function viewForQuery(query: string, now?: number): View | null {
  const filter = parseQuery(query ?? '', now ?? Date.now()).filter
  if (filter.trashed === true) return 'trash'
  const statuses: ItemStatus[] =
    filter.status === undefined ? [] : Array.isArray(filter.status) ? filter.status : [filter.status]
  if (statuses.length === 1) return statuses[0]
  if (filter.favorite === true) return 'favorites'
  return null
}

/** Сохранённый поиск с тем же запросом (пробелы по краям не важны); пустой запрос или такого нет — undefined. */
export function findSavedByQuery<T extends Pick<SavedSearch, 'query'>>(
  searches: readonly T[],
  query: string,
): T | undefined {
  const key = (query ?? '').trim()
  if (!key) return undefined
  return searches.find((s) => (s.query ?? '').trim() === key)
}

/** Текст «Уже сохранён как «<имя>»» — для toast и поповера сохранения. */
export function alreadySavedText(name: string): string {
  return `Уже сохранён как «${name}»`
}

/**
 * Активен ли сохранённый поиск: его запрос стоит в строке, фильтры панели пусты и открыт раздел самого запроса
 * (viewForQuery); поиск без своего раздела активен в любом. В «Графе» раздел не сверяется: поиск применяется там же
 * и только приглушает ноды, а is:<раздел> в запросе — обычный оператор отбора.
 */
export function isSavedSearchActive(
  search: Pick<SavedSearch, 'query'>,
  screen: Pick<SearchScreen, 'view' | 'query' | 'filter'>,
  now?: number,
): boolean {
  const current = (screen.query ?? '').trim()
  if (!current || current !== (search.query ?? '').trim() || isNarrowed('', screen.filter)) return false
  if (screen.view === 'graph') return true
  return (viewForQuery(search.query, now) ?? screen.view) === screen.view
}

const DEFAULT_SEARCH_NAME = 'Поиск'

/** Первые max символов без разрыва суррогатной пары и без пробелов в конце. */
function cut(s: string, max: number): string {
  let end = Math.max(0, Math.min(s.length, max))
  const last = s.charCodeAt(end - 1)
  if (end < s.length && last >= 0xd800 && last <= 0xdbff) end--
  return s.slice(0, end).trimEnd()
}

/** Строка не длиннее max; обрезанная — с «…» в конце. */
function clipName(s: string, max: number): string {
  return s.length > max ? cut(s, max - 1) + '…' : s
}

/** Имя по умолчанию: запрос в одну строку, не длиннее SAVED_SEARCH_NAME_MAX («…» в конце); пусто → «Поиск»; занятое → « (2)», « (3)»… */
export function suggestSearchName(query: string, taken: readonly string[]): string {
  const line = (query ?? '').replace(/\s+/g, ' ').trim() || DEFAULT_SEARCH_NAME
  const used = new Set(taken.map(searchNameKey))
  const first = clipName(line, SAVED_SEARCH_NAME_MAX)
  if (!used.has(searchNameKey(first))) return first
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`
    const candidate = clipName(line, SAVED_SEARCH_NAME_MAX - suffix.length) + suffix
    if (!used.has(searchNameKey(candidate))) return candidate
  }
}
