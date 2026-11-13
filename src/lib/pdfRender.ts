import { VISION_MAX_SIDE, VISION_PDF_MAX_PAGES } from './ocrState'
import {
  PDF_ABORTED,
  PDF_ERR_TOO_BIG,
  PDF_MAX_BYTES,
  PDF_TIMEOUT_MS,
  PDF_TIMED_OUT,
  closePdfQuietly,
  createPdfGuard,
  describePdfFailure,
  openPdfGuarded,
} from './pdfText'
import type { PdfDocLike, PdfEngine } from './pdfText'

/** Предел времени на растеризацию одной страницы. */
export const PDF_PAGE_TIMEOUT_MS = 20_000
/**
 * Предел времени на открытие документа — тот же, что у чтения текстового слоя: файл, слой которого
 * прочитан, должен и открываться для распознавания, иначе скан застревал бы между ними.
 */
export const PDF_OPEN_TIMEOUT_MS = PDF_TIMEOUT_MS

const ERR_OPEN_TIMEOUT = 'Не удалось открыть PDF за отведённое время'
const ERR_PAGE_TIMEOUT = 'Не удалось подготовить страницу PDF за отведённое время'
const ERR_PAGE = 'Не удалось подготовить страницу PDF'
const ERR_NO_RENDER = 'Не удалось подготовить страницы PDF'
const ERR_NO_PAGES = 'В PDF нет страниц'

/** Открытый документ для распознавания: первые count страниц из total. */
export interface PdfPages {
  total: number
  count: number
  /**
   * Страница n (1…count) картинкой: растеризуется по запросу, прямо перед отправкой. Отклоняется
   * с русским текстом (сбой, время вышло) или AbortError (прервано через signal).
   */
  page(n: number): Promise<Blob>
  /** Освобождает документ и worker; повторный вызов ничего не делает. Не бросает. */
  close(): Promise<void>
}

export type PdfPagesResult =
  | { status: 'ok'; doc: PdfPages }
  | { status: 'aborted' }
  | { status: 'failed'; error: string; permanent?: true }

export interface PdfPagesOptions {
  maxPages?: number
  signal?: AbortSignal
  engine?: () => Promise<PdfEngine>
}

async function defaultEngine(): Promise<PdfEngine> {
  return (await import('./pdfEngine')).loadPdfEngine()
}

function abortError(): DOMException {
  return new DOMException('Распознавание прервано', 'AbortError')
}

const failed = (error: string, permanent: boolean): PdfPagesResult =>
  permanent ? { status: 'failed', error, permanent: true } : { status: 'failed', error }

/**
 * Открывает PDF для распознавания страниц картинками. Никогда не бросает: итог — в `status`.
 * Пределы и тексты — как у extractPdfText: больше PDF_MAX_BYTES, пароль, битый файл — неустранимо
 * (`permanent`); сбой движка, время вышло, движок без растеризации — временно.
 */
export async function openPdfPages(data: Blob, options: PdfPagesOptions = {}): Promise<PdfPagesResult> {
  try {
    return await open(data, options ?? {})
  } catch (e) {
    const failure = describePdfFailure(e)
    return failed(failure.error, failure.permanent)
  }
}

async function open(data: Blob, options: PdfPagesOptions): Promise<PdfPagesResult> {
  if (data.size > PDF_MAX_BYTES) return failed(PDF_ERR_TOO_BIG, true)
  const { signal } = options
  if (signal?.aborted) return { status: 'aborted' }
  const maxPages =
    typeof options.maxPages === 'number' && Number.isFinite(options.maxPages) && options.maxPages >= 1
      ? Math.floor(options.maxPages)
      : VISION_PDF_MAX_PAGES

  let doc: PdfDocLike
  const guard = createPdfGuard(signal, PDF_OPEN_TIMEOUT_MS)
  try {
    const engine = await guard.run((options.engine ?? defaultEngine)())
    const bytes = new Uint8Array(await guard.run(data.arrayBuffer()))
    guard.check()
    doc = await openPdfGuarded(engine, bytes, guard)
  } catch (e) {
    if (e === PDF_ABORTED) return { status: 'aborted' }
    if (e === PDF_TIMED_OUT) return failed(ERR_OPEN_TIMEOUT, false)
    const failure = describePdfFailure(e)
    return failed(failure.error, failure.permanent)
  } finally {
    guard.dispose()
  }

  let closing: Promise<void> | undefined
  const close = (): Promise<void> => (closing ??= closePdfQuietly(doc))

  const total = Number.isInteger(doc.numPages) && doc.numPages > 0 ? doc.numPages : 0
  if (total === 0) {
    await close()
    return failed(ERR_NO_PAGES, true)
  }
  if (typeof doc.pageImage !== 'function') {
    await close()
    return failed(ERR_NO_RENDER, false)
  }
  if (signal?.aborted) {
    await close()
    return { status: 'aborted' }
  }

  const render = doc.pageImage.bind(doc)
  const count = Math.min(total, maxPages)
  return {
    status: 'ok',
    doc: {
      total,
      count,
      async page(n: number): Promise<Blob> {
        if (!Number.isInteger(n) || n < 1 || n > count) throw new Error(ERR_PAGE)
        if (closing) throw new Error(ERR_PAGE)
        const pageGuard = createPdfGuard(signal, PDF_PAGE_TIMEOUT_MS)
        try {
          pageGuard.check()
          const blob = await pageGuard.run(render(n, VISION_MAX_SIDE))
          if (!(blob instanceof Blob) || blob.size === 0) throw new Error(ERR_PAGE)
          return blob
        } catch (e) {
          if (e === PDF_ABORTED) throw abortError()
          if (e === PDF_TIMED_OUT) throw new Error(ERR_PAGE_TIMEOUT)
          if (e instanceof Error && e.message === ERR_PAGE) throw e
          console.warn('[pdfRender] не удалось растеризовать страницу', e)
          throw new Error(ERR_PAGE)
        } finally {
          pageGuard.dispose()
        }
      },
      close,
    },
  }
}
