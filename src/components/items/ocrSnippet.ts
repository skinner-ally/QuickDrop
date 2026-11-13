import { highlight, makeSnippet } from '@/search'
import type { Item } from '@/types'

/**
 * Фрагмент распознанного текста вложения вокруг совпадения с запросом. Пусто, если запроса нет,
 * текста нет или совпадение не в нём (по имени файла: иначе вышло бы начало текста без подсветки).
 */
export function ocrMatchSnippet(item: Item, terms: string[]): string {
  if (terms.length === 0 || !item.ocrText) return ''
  const text = makeSnippet(item, terms)
  return text && highlight(text, terms).some((p) => p.hit) ? text : ''
}
