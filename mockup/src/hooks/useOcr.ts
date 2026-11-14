import { useSyncExternalStore } from 'react'
import { getOcrJob, getOcrNote, subscribeOcr, type OcrJob, type OcrNote } from '@/lib/ocrState'

/** Идущая или ждущая своей очереди задача распознавания записи (состояние сеанса). */
export function useOcrJob(id: string): OcrJob | undefined {
  return useSyncExternalStore(
    subscribeOcr,
    () => getOcrJob(id),
    () => undefined,
  )
}

/** Итог последней неудачной или пустой попытки (до перезапуска): «ошибка + Повторить», «Текст не найден». */
export function useOcrNote(id: string): OcrNote | undefined {
  return useSyncExternalStore(
    subscribeOcr,
    () => getOcrNote(id),
    () => undefined,
  )
}
