import { toast } from 'sonner'
import { updateItem } from '@/db/repo'
import type { ItemPatch } from '@/types'

/** updateItem с показом ошибки пользователю. Возвращает false при неудаче. */
export async function saveItem(id: string, patch: ItemPatch): Promise<boolean> {
  try {
    await updateItem(id, patch)
    return true
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Не удалось сохранить')
    return false
  }
}
