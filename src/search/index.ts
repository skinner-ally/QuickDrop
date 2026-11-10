/**
 * Поиск QuickDrop: разбор запроса, фильтры, полнотекстовый индекс MiniSearch, подсветка.
 * Модуль чистый: записи и категории получает аргументами, к IndexedDB не обращается.
 */
export { parseQuery } from './query'
export type { ParsedQuery } from './query'
export {
  searchItems,
  prepareSearchIndex,
  resetSearchIndex,
  getSearchIndexStats,
  resolveCategoryName,
} from './engine'
export type { SearchHit, SearchIndexStats, SearchOptions } from './engine'
export { highlight, makeSnippet } from './highlight'
export type { HighlightPart } from './highlight'
// Та же функция, что repo.matchesFilter (единая реализация в lib/filter).
export { matchesFilter } from './filter'
export { fold, queryWords, tokenize } from './normalize'
