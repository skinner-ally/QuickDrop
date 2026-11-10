import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { describeError, isQuotaError, QUOTA_MESSAGE, readableError } from './errors'

describe('ошибки хранилища', () => {
  const quota = new DOMException('The quota has been exceeded.', 'QuotaExceededError')

  it('распознаёт переполнение и в обёртках Dexie', () => {
    expect(isQuotaError(quota)).toBe(true)
    expect(isQuotaError(new Dexie.QuotaExceededError('full'))).toBe(true)
    // так Dexie отклоняет транзакцию, прерванную из-за квоты
    expect(isQuotaError(new Dexie.AbortError('Transaction aborted', quota))).toBe(true)
    expect(isQuotaError({ name: 'BulkError', failures: { 3: quota } })).toBe(true)
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true)
    expect(isQuotaError(new Dexie.AbortError('Transaction aborted'))).toBe(false)
    expect(isQuotaError(new Error('другое'))).toBe(false)
    expect(isQuotaError(null)).toBe(false)
  })

  it('describeError: квота по-русски, иначе message или запасной текст', () => {
    expect(describeError(new Dexie.AbortError('Transaction aborted', quota))).toBe(QUOTA_MESSAGE)
    expect(describeError(new Error('Файл больше 100 МБ'))).toBe('Файл больше 100 МБ')
    expect(describeError('строка', 'Не удалось сохранить')).toBe('Не удалось сохранить')
    expect(describeError(new Error(''))).toBe('Что-то пошло не так')
  })

  it('readableError заменяет только переполнение', () => {
    const other = new Error('x')
    expect(readableError(other)).toBe(other)
    const readable = readableError(quota)
    expect(readable).toBeInstanceOf(Error)
    expect((readable as Error).message).toBe(QUOTA_MESSAGE)
  })
})
