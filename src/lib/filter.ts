import type { Item, ItemFilter } from '@/types'
import { tagKey } from './normalize'

/**
 * Проверка записи по фильтру (все условия по И). Единственная реализация:
 * db/repo и search реэкспортируют её, чтобы списки и поиск не расходились на одних данных.
 *  - status: значение или массив (пустой массив = без ограничения);
 *  - types: любой из перечисленных (пустой массив = без ограничения);
 *  - categoryId: null = «без категории», undefined = без ограничения;
 *  - tags: запись содержит все перечисленные; теги фильтра нормализуются, пустые пропускаются,
 *    сравнение по правилу поиска (регистр и ё/е не важны);
 *  - favorite, untagged: галочки — фильтруют только при true;
 *  - from/to: диапазон по createdAt включительно.
 */
export function matchesFilter(item: Item, filter: ItemFilter): boolean {
  const { status, types, categoryId, tags, favorite, untagged, from, to } = filter

  if (status !== undefined) {
    if (Array.isArray(status)) {
      if (status.length > 0 && !status.includes(item.status)) return false
    } else if (item.status !== status) return false
  }

  if (types && types.length > 0 && !types.includes(item.type)) return false

  // ?? — запись из старого импорта или повреждённая правкой могла остаться без поля.
  const itemCategory = item.categoryId ?? null
  if (categoryId !== undefined && itemCategory !== categoryId) return false

  const itemTags = Array.isArray(item.tags) ? item.tags : []
  if (tags && tags.length > 0) {
    let own: Set<string> | undefined
    for (const raw of tags) {
      const want = tagKey(raw)
      if (!want) continue
      own ??= new Set(itemTags.map(tagKey))
      if (!own.has(want)) return false
    }
  }

  if (favorite === true && item.favorite !== 1) return false
  if (untagged === true && (itemTags.length > 0 || itemCategory !== null)) return false

  if (from !== undefined && item.createdAt < from) return false
  if (to !== undefined && item.createdAt > to) return false

  return true
}
