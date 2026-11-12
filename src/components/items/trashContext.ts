import { createContext } from 'react'
import { DEFAULT_SETTINGS } from '@/types'

/** Срок хранения в корзине (дней) для строк списка: значение даёт ItemList из настроек. */
export const TrashDaysContext = createContext<number>(DEFAULT_SETTINGS.trashDays)
