import { toast } from 'sonner'
import { addTags, removeTag, updateItem } from '@/db/repo'
import { describeError } from '@/lib/errors'
import { tagKey } from '@/lib/normalize'
import type { ItemPatch } from '@/types'

/** updateItem с показом ошибки пользователю. Возвращает false при неудаче. */
export async function saveItem(id: string, patch: ItemPatch): Promise<boolean> {
  try {
    await updateItem(id, patch)
    return true
  } catch (e) {
    toast.error(describeError(e, 'Не удалось сохранить'))
    return false
  }
}

/**
 * Применяет изменение списка тегов как дельту (addTags/removeTag), а не записью целого массива:
 * параллельные изменения из устаревшего снимка не затирают друг друга.
 */
export function diffTags(current: readonly string[], next: readonly string[]): { added: string[]; removed: string[] } {
  const cur = new Set(current.map(tagKey))
  const nxt = new Set(next.map(tagKey))
  return {
    added: next.filter((t) => !cur.has(tagKey(t))),
    removed: current.filter((t) => !nxt.has(tagKey(t))),
  }
}

export async function saveTags(id: string, current: readonly string[], next: readonly string[]): Promise<boolean> {
  const { added, removed } = diffTags(current, next)
  try {
    if (added.length) await addTags(id, added)
    for (const t of removed) await removeTag(id, t)
    return true
  } catch (e) {
    toast.error(describeError(e, 'Не удалось сохранить'))
    return false
  }
}
