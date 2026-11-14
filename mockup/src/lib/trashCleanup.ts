import { purgeExpired } from '@/db/repo'
import { getSettings } from '@/db/settings'

export const TRASH_CLEANUP_EVERY_MS = 6 * 60 * 60 * 1000
/** Первый запуск — не сразу: старт приложения не должен ждать обхода корзины. */
export const TRASH_CLEANUP_FIRST_MS = 5_000

/**
 * Окончательно удаляет записи, пролежавшие в корзине дольше срока из настроек (trashDays; 0 — не очищать).
 * Возвращает число удалённых. Не бросает: автоочистка — фоновая уборка, её сбой не должен ничего ломать.
 */
export async function cleanupTrash(now?: number): Promise<number> {
  try {
    const { trashDays } = await getSettings()
    return await purgeExpired(trashDays, now)
  } catch (e) {
    console.warn('QuickDrop: не удалось очистить корзину', e)
    return 0
  }
}

/** Запускает автоочистку: первый раз через 5 с, затем каждые 6 ч. Возвращает остановку. */
export function startTrashCleanup(): () => void {
  let interval: ReturnType<typeof setInterval> | undefined
  const first = setTimeout(() => {
    void cleanupTrash()
    interval = setInterval(() => void cleanupTrash(), TRASH_CLEANUP_EVERY_MS)
  }, TRASH_CLEANUP_FIRST_MS)
  return () => {
    clearTimeout(first)
    if (interval !== undefined) clearInterval(interval)
  }
}
