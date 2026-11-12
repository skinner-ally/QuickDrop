/**
 * Поиск QuickDrop: разбор запроса, фильтры, полнотекстовый индекс MiniSearch, подсветка.
 * Модуль чистый: записи и категории получает аргументами, к IndexedDB не обращается.
 */
export { parseQuery } from './query'
export type { ParsedQuery } from './query'
export {
  searchItems,
  prepareSearchIndex,
  prepareSearchIndexAsync,
  isSearchIndexReady,
  resetSearchIndex,
  getSearchIndexStats,
  resolveCategoryName,
  resolveQueryFilter,
} from './engine'
export type { SearchHit, SearchIndexStats, SearchOptions } from './engine'
export { serializeFilter, composeQuery } from './serialize'
export type { SerializeOptions } from './serialize'
export { highlight, makeSnippet } from './highlight'
export type { HighlightPart } from './highlight'
// Та же функция, что repo.matchesFilter (единая реализация в lib/filter).
export { matchesFilter, matchesFilterIgnoringTrash } from './filter'
export { fold, queryWords, tokenize } from './normalize'
