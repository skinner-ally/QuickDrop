/** Понятные пользователю тексты ошибок. */

export const QUOTA_MESSAGE =
  'Недостаточно места в хранилище: очистите корзину, удалите крупные файлы или освободите место на устройстве'

const QUOTA_NAMES = new Set(['QuotaExceededError', 'NS_ERROR_DOM_QUOTA_REACHED'])

/**
 * Переполнение хранилища. Dexie обычно заворачивает его: AbortError транзакции с inner,
 * BulkError с failures, а Safari/старые движки дают DOMException с кодом 22.
 */
export function isQuotaError(e: unknown, depth = 0): boolean {
  if (typeof e !== 'object' || e === null || depth > 4) return false
  const err = e as { name?: unknown; code?: unknown; inner?: unknown; cause?: unknown; failures?: unknown }
  if (typeof err.name === 'string' && QUOTA_NAMES.has(err.name)) return true
  if (typeof DOMException !== 'undefined' && e instanceof DOMException && err.code === 22) return true
  if (isQuotaError(err.inner, depth + 1) || isQuotaError(err.cause, depth + 1)) return true
  const failures = err.failures
  if (failures && typeof failures === 'object') {
    for (const f of Object.values(failures)) if (isQuotaError(f, depth + 1)) return true
  }
  return false
}

/** Текст для toast: квота — по-русски с подсказкой, иначе message ошибки или fallback. */
export function describeError(e: unknown, fallback = 'Что-то пошло не так'): string {
  if (isQuotaError(e)) return QUOTA_MESSAGE
  if (e instanceof Error && e.message) return e.message
  return fallback
}

/** Переполнение хранилища становится Error с понятным текстом; прочие ошибки — как есть. */
export function readableError(e: unknown): unknown {
  return isQuotaError(e) ? new Error(QUOTA_MESSAGE, { cause: e }) : e
}
