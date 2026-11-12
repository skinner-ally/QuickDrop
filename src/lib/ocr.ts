import { db } from '@/db/db'
import { getFile, getItem, setOcrText } from '@/db/repo'
import { describeError } from '@/lib/errors'
import { extractPdfText, isPdf } from '@/lib/pdfText'
import type { Item } from '@/types'

export type TextSource = 'pdf' | 'image'

export interface ExtractOutcome {
  status: 'ok' | 'empty' | 'failed' | 'skipped'
  /** Русский текст для status === 'failed'. */
  error?: string
}

export const BACKFILL_PDF_LIMIT = 10
/** Пауза между порциями фонового обхода. */
export const BACKFILL_PAUSE_MS = 3_000

/** Откуда у записи можно извлечь текст: PDF — из текстового слоя, картинка — распознаванием. */
export function textSourceOf(item: Pick<Item, 'type' | 'mimeType' | 'fileName' | 'fileId'>): TextSource | null {
  if (!item.fileId) return null
  if (isPdf(item)) return 'pdf'
  return item.type === 'image' ? 'image' : null
}

/** Извлечения, которые сейчас идут или ждут очереди: фоновый обход и создание записи не разбирают один файл дважды. */
const running = new Map<string, Promise<ExtractOutcome>>()

// Разборы идут по одному: каждый держит файл целиком в памяти и свой worker pdf.js, а предел времени
// на файл при параллельном разборе пачки срабатывал бы от нехватки процессора.
let queueTail: Promise<unknown> = Promise.resolve()

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = queueTail.then(work, work)
  queueTail = next.catch(() => {})
  return next
}

/**
 * Извлекает текст вложения и записывает его в запись (ocrText/ocrAt). Не бросает.
 * skipped — извлекать нечего, уже извлекали (без force) или работа прервана; failed — не получилось.
 * При неустранимой причине (пароль, битый файл, больше предела, файла нет) ставится отметка ocrAt
 * без текста, чтобы фоновый обход не разбирал файл снова; при временной (время вышло, сбой движка)
 * отметки нет — можно повторить.
 */
export function extractItemText(
  item: Item,
  options: { vision?: boolean; force?: boolean; signal?: AbortSignal } = {},
): Promise<ExtractOutcome> {
  const source = textSourceOf(item)
  // Картинки распознаёт ИИ — этап 8.
  if (source !== 'pdf') return Promise.resolve({ status: 'skipped' })
  if (item.ocrAt !== undefined && !options.force) return Promise.resolve({ status: 'skipped' })

  const current = running.get(item.id)
  if (current && !options.force) return current

  const job = enqueue(() => extractPdf(item.id, options)).finally(() => {
    if (running.get(item.id) === job) running.delete(item.id)
  })
  running.set(item.id, job)
  return job
}

async function extractPdf(
  id: string,
  options: { vision?: boolean; force?: boolean; signal?: AbortSignal },
): Promise<ExtractOutcome> {
  try {
    if (options.signal?.aborted) return { status: 'skipped' }
    // Пока задача ждала очереди, запись могли удалить или уже обработать.
    const item = await getItem(id)
    if (!item || textSourceOf(item) !== 'pdf') return { status: 'skipped' }
    if (item.ocrAt !== undefined && !options.force) return { status: 'skipped' }

    const file = await getFile(item.fileId!)
    if (!file) {
      await markUnreadable(item)
      return { status: 'failed', error: 'Файл не найден' }
    }

    const result = await extractPdfText(file.blob, { signal: options.signal })
    if (result.status === 'aborted') return { status: 'skipped' }
    if (result.status === 'failed') {
      if (result.permanent) await markUnreadable(item)
      return { status: 'failed', error: result.error ?? 'Не удалось прочитать PDF' }
    }

    // Пустой текст тоже записывается: отметка «пробовали» не даёт фоновому обходу разбирать скан снова.
    if (!(await setOcrText(item.id, result.text))) return { status: 'skipped' }
    // Скан без текстового слоя при vision — работа для ИИ (этап 8).
    if (result.status === 'empty' && options.vision) return { status: 'skipped' }
    return { status: result.status }
  } catch (e) {
    return { status: 'failed', error: describeError(e, 'Не удалось извлечь текст') }
  }
}

/** Отметка «пробовали, текста нет». Уже извлечённый текст (повтор с force) не затирается. */
async function markUnreadable(item: Item): Promise<void> {
  if (item.ocrAt === undefined && !item.ocrText) await setOcrText(item.id, '')
}

/** Записи, которые обход в этом сеансе уже пробовал без успеха: до перезапуска к ним не возвращается. */
const triedThisSession = new Set<string>()

async function backfillStep(limit: number): Promise<{ done: number; tried: number }> {
  if (!Number.isFinite(limit) || limit < 1) return { done: 0, tried: 0 }
  const max = Math.floor(limit)
  try {
    // Без .limit(): иначе записи, которые не удаётся разобрать, навсегда занимали бы начало выборки.
    const pending = await db.items
      .filter(
        (it) =>
          it.deletedAt === undefined &&
          it.ocrAt === undefined &&
          textSourceOf(it) === 'pdf' &&
          !triedThisSession.has(it.id),
      )
      .toArray()
    let done = 0
    let failures = 0
    let tried = 0
    for (const item of pending) {
      if (done >= max || failures >= max) break
      tried++
      const { status } = await extractItemText(item)
      if (status === 'ok' || status === 'empty') {
        done++
      } else {
        failures++
        triedThisSession.add(item.id)
      }
    }
    return { done, tried }
  } catch (e) {
    console.warn('QuickDrop: не удалось извлечь текст из PDF', e)
    return { done: 0, tried: 0 }
  }
}

/**
 * Извлекает текст у PDF-записей, с которыми этого ещё не делали (включая архив, без корзины):
 * по одной, не больше limit обработанных за вызов (и не больше limit неудач). Возвращает число
 * обработанных (текст извлечён или его нет).
 */
export async function backfillPdfText(limit: number = BACKFILL_PDF_LIMIT): Promise<number> {
  return (await backfillStep(limit)).done
}

let draining = false

/**
 * Обход порциями по BACKFILL_PDF_LIMIT с паузой, пока есть что пробовать. Завершается: каждая
 * попытка либо ставит записи ocrAt, либо исключает её до конца сеанса. Возвращает число обработанных.
 */
export async function drainPdfBackfill(pauseMs: number = BACKFILL_PAUSE_MS): Promise<number> {
  if (draining) return 0
  draining = true
  let total = 0
  try {
    for (;;) {
      const { done, tried } = await backfillStep(BACKFILL_PDF_LIMIT)
      total += done
      if (tried === 0) return total
      await new Promise((resolve) => setTimeout(resolve, pauseMs))
    }
  } finally {
    draining = false
  }
}
