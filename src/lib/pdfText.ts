import { MAX_OCR_TEXT, cleanOcrText } from './normalize'

export const PDF_MAX_PAGES = 200
export const PDF_MAX_CHARS = MAX_OCR_TEXT
export const PDF_MAX_BYTES = 50 * 1024 * 1024
export const PDF_TIMEOUT_MS = 30_000
/** Меньше непробельных символов — текстового слоя нет (скан). */
export const PDF_MIN_TEXT_CHARS = 20

export interface PdfDocLike {
  numPages: number
  pageText(page: number): Promise<string>
  close(): Promise<void>
}

export interface PdfEngine {
  /** signal — перестали ждать (прерывание, время вышло): движок сам освобождает несостоявшийся документ. */
  open(data: Uint8Array, signal?: AbortSignal): Promise<PdfDocLike>
}

export interface PdfTextOptions {
  maxPages?: number
  maxChars?: number
  signal?: AbortSignal
  engine?: () => Promise<PdfEngine>
}

export interface PdfTextResult {
  status: 'ok' | 'empty' | 'failed' | 'aborted'
  /** Очищенный (cleanOcrText), '' при empty/failed/aborted. */
  text: string
  /** Всего страниц в файле (0, если не открылся). */
  pages: number
  readPages: number
  /** Упёрлись в предел страниц, символов или времени. */
  truncated: boolean
  /** Русский текст для status === 'failed'. */
  error?: string
  /**
   * Только при failed: повтор с тем же файлом даст то же (больше предела, пароль, не PDF или битый файл).
   * Тайм-аут и сбои движка временные — признака у них нет.
   */
  permanent?: true
}

const ERR_TOO_BIG = 'PDF больше 50 МБ — текст не извлекается'
const ERR_TIMEOUT = 'Не удалось прочитать PDF за отведённое время'
const ERR_PASSWORD = 'PDF защищён паролем'
const ERR_READ = 'Не удалось прочитать PDF'

/** application/pdf или расширение .pdf. */
export function isPdf(file: { mimeType?: string; fileName?: string }): boolean {
  const mime = typeof file.mimeType === 'string' ? file.mimeType.split(';')[0].trim().toLowerCase() : ''
  if (mime === 'application/pdf') return true
  return typeof file.fileName === 'string' && /\.pdf$/i.test(file.fileName.trim())
}

const ABORTED = Symbol('aborted')
const TIMED_OUT = Symbol('timeout')
/** Сколько ждать закрытия документа: зависший worker не должен держать вызывающего. */
const CLOSE_WAIT_MS = 2_000

/**
 * Прерывание по сигналу и по времени. Проверки между страницами мало: pdf.js на битом файле или
 * без worker может не ответить вовсе, поэтому каждое ожидание ещё и состязается с остановкой.
 */
function createGuard(signal: AbortSignal | undefined, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  let stop: (reason: symbol) => void = () => {}
  const stopped = new Promise<never>((_, reject) => {
    stop = reject
  })
  stopped.catch(() => {})
  const timer = setTimeout(() => stop(TIMED_OUT), timeoutMs)
  const onAbort = () => stop(ABORTED)
  signal?.addEventListener('abort', onAbort, { once: true })
  return {
    check(): void {
      if (signal?.aborted) throw ABORTED
      if (Date.now() >= deadline) throw TIMED_OUT
    },
    run<T>(work: Promise<T>): Promise<T> {
      return Promise.race([work, stopped])
    },
    dispose(): void {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

async function defaultEngine(): Promise<PdfEngine> {
  return (await import('./pdfEngine')).loadPdfEngine()
}

function limit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback
}

function countNonBlank(text: string): number {
  return text.replace(/\s+/g, '').length
}

function joinPages(parts: string[], maxChars: number): string {
  let text = parts.join('\n\n')
  if (text.length > maxChars) {
    text = text.slice(0, maxChars)
    const last = text.charCodeAt(text.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1)
  }
  return cleanOcrText(text)
}

async function closeQuietly(doc: PdfDocLike): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      doc.close(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CLOSE_WAIT_MS)
      }),
    ])
  } catch {
    // закрытие — уборка, на результат не влияет
  } finally {
    clearTimeout(timer)
  }
}

interface Failure {
  error: string
  permanent: boolean
}

function describeFailure(e: unknown): Failure {
  const name = typeof e === 'object' && e !== null ? (e as { name?: unknown }).name : undefined
  // Имя исключения pdf.js сохраняет и при передаче из worker.
  if (name === 'PasswordException') return { error: ERR_PASSWORD, permanent: true }
  if (name === 'InvalidPDFException') return { error: ERR_READ, permanent: true }
  console.warn('[pdfText] не удалось прочитать PDF', e)
  return { error: ERR_READ, permanent: false }
}

const failedResult = (failure: Failure, pages = 0, readPages = 0, truncated = false): PdfTextResult => ({
  status: 'failed',
  text: '',
  pages,
  readPages,
  truncated,
  error: failure.error,
  ...(failure.permanent ? { permanent: true as const } : {}),
})

/**
 * Текст из PDF с текстовым слоем. Никогда не бросает: итог — в `status`.
 * `empty` — текста нет или почти нет (скан), `aborted` — прервано через `signal`.
 */
export async function extractPdfText(data: Blob, options: PdfTextOptions = {}): Promise<PdfTextResult> {
  try {
    return await extract(data, options ?? {})
  } catch (e) {
    return failedResult(describeFailure(e))
  }
}

async function extract(data: Blob, options: PdfTextOptions): Promise<PdfTextResult> {
  let pages = 0
  let readPages = 0
  let truncated = false
  const result = (status: Exclude<PdfTextResult['status'], 'failed'>, text = ''): PdfTextResult => ({
    status,
    text,
    pages,
    readPages,
    truncated,
  })

  if (data.size > PDF_MAX_BYTES) return failedResult({ error: ERR_TOO_BIG, permanent: true })
  const { signal } = options
  if (signal?.aborted) return result('aborted')
  const maxPages = limit(options.maxPages, PDF_MAX_PAGES)
  // Длиннее MAX_OCR_TEXT текст всё равно не сохранится: cleanOcrText его обрежет.
  const maxChars = Math.min(limit(options.maxChars, PDF_MAX_CHARS), PDF_MAX_CHARS)

  const guard = createGuard(signal, PDF_TIMEOUT_MS)
  const parts: string[] = []
  let length = 0
  let doc: PdfDocLike | undefined
  try {
    const engine = await guard.run((options.engine ?? defaultEngine)())
    const bytes = new Uint8Array(await guard.run(data.arrayBuffer()))
    guard.check()

    // Свой сигнал, а не signal вызывающего: открытие нужно оборвать и по времени.
    const openCtrl = new AbortController()
    const opening = engine.open(bytes, openCtrl.signal)
    try {
      doc = await guard.run(opening)
    } catch (e) {
      if (e === ABORTED || e === TIMED_OUT) {
        // Движок по сигналу уничтожает worker сам; документ, который всё же успел открыться, закрываем.
        openCtrl.abort()
        opening.then((late) => late.close()).catch(() => {})
      }
      throw e
    }

    pages = Number.isInteger(doc.numPages) && doc.numPages > 0 ? doc.numPages : 0
    const lastPage = Math.min(pages, maxPages)
    let full = false
    for (let n = 1; n <= lastPage && !full; n++) {
      guard.check()
      const raw = await guard.run(doc.pageText(n))
      readPages = n
      const piece = typeof raw === 'string' ? raw.trim() : ''
      if (!piece) continue
      length += (parts.length > 0 ? 2 : 0) + piece.length
      parts.push(piece)
      if (length >= maxChars) {
        full = true
        truncated = length > maxChars || n < pages
      }
    }
    if (!full && lastPage < pages) truncated = true

    const text = joinPages(parts, maxChars)
    if (countNonBlank(text) < PDF_MIN_TEXT_CHARS) return result('empty')
    return result('ok', text)
  } catch (e) {
    if (e === ABORTED) return result('aborted')
    if (e === TIMED_OUT) {
      truncated = true
      const text = joinPages(parts, maxChars)
      if (countNonBlank(text) >= PDF_MIN_TEXT_CHARS) return result('ok', text)
      return failedResult({ error: ERR_TIMEOUT, permanent: false }, pages, readPages, truncated)
    }
    return failedResult(describeFailure(e), pages, readPages, truncated)
  } finally {
    guard.dispose()
    if (doc) await closeQuietly(doc)
  }
}
