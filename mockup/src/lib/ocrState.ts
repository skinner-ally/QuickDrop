import { isPdf } from '@/lib/pdfText'
import type { Item } from '@/types'

// ───────────────────────── пределы (единственное место) ─────────────────────────

/** px по большей стороне после подготовки изображения. */
export const VISION_MAX_SIDE = 2000
/** Меньше по любой стороне — распознавать нечего. */
export const VISION_MIN_SIDE = 24
/** Исходная картинка. */
export const VISION_MAX_SOURCE_BYTES = 30 * 1024 * 1024
/** Подготовленная картинка (до base64). */
export const VISION_MAX_IMAGE_BYTES = 4 * 1024 * 1024
export const VISION_PDF_MAX_PAGES = 5
export const VISION_JPEG_QUALITY = 0.85
/** Между началами фоновых запросов. */
export const VISION_AUTO_INTERVAL_MS = 3_000
/** Фоновых запросов за сеанс (каждая страница PDF — запрос). */
export const VISION_AUTO_SESSION_LIMIT = 100
/** Столько временных ошибок подряд — авто уходит на паузу VISION_AUTO_COOLDOWN_MS. */
export const VISION_AUTO_FAIL_STREAK = 3
export const VISION_AUTO_COOLDOWN_MS = 10 * 60_000
/** Пауза авто после ответа 429. */
export const VISION_RATE_PAUSE_MS = 60_000
export const VISION_BACKLOG_BATCH = 20
export const VISION_BACKLOG_MIN_GAP_MS = 60_000
/** Сколько знаков распознанного текста показывается без «Показать весь текст». */
export const OCR_VIEW_CHARS = 20_000
/** Длиннее — правка в интерфейсе недоступна. */
export const OCR_EDIT_MAX = 50_000

// ───────────────────────── правила ─────────────────────────

export type OcrKind = 'image' | 'pdf'

type OcrFields = Pick<
  Item,
  | 'type'
  | 'mimeType'
  | 'fileName'
  | 'fileId'
  | 'ocrText'
  | 'ocrAt'
  | 'ocrVisionAt'
  | 'ocrClearedAt'
  | 'ocrAutoSkipAt'
  | 'deletedAt'
  | 'createdAt'
>

/** Что за вложение: то же правило, что ocr.textSourceOf (PDF — по isPdf; картинка — type === 'image' с fileId). */
export function ocrKindOf(item: Pick<Item, 'type' | 'mimeType' | 'fileName' | 'fileId'>): OcrKind | null {
  if (!item.fileId) return null
  if (isPdf(item)) return 'pdf'
  return item.type === 'image' ? 'image' : null
}

/**
 * PDF, у которого проверен текстовый слой и текста в нём нет, либо текст получен зрением. Текст, убранный
 * пользователем (ocrClearedAt), — не признак скана: слой мог быть и пустым, и полным.
 */
export function isScanPdf(item: OcrFields): boolean {
  return (
    ocrKindOf(item) === 'pdf' &&
    item.ocrAt !== undefined &&
    ((!item.ocrText && item.ocrClearedAt === undefined) || item.ocrVisionAt !== undefined)
  )
}

/**
 * Запись ждёт распознавания зрением: вне корзины, ocrVisionAt нет, текста нет, пользователь его не убирал;
 * картинка или скан PDF.
 */
export function needsVision(item: OcrFields): boolean {
  if (item.deletedAt !== undefined || item.ocrVisionAt !== undefined || item.ocrText) return false
  if (item.ocrClearedAt !== undefined) return false
  const kind = ocrKindOf(item)
  if (kind === 'image') return true
  return kind === 'pdf' && isScanPdf(item)
}

/**
 * needsVision, запись создана не раньше since и не исключена из авто (ocrAutoSkipAt: отмена, импорт).
 * since = 0 — автораспознавание ни разу не включали: задела нет (иначе включение отправило бы в ИИ весь
 * накопленный архив).
 */
export function isVisionBacklog(item: OcrFields, since: number): boolean {
  return (
    Number.isFinite(since) &&
    since > 0 &&
    item.createdAt >= since &&
    item.ocrAutoSkipAt === undefined &&
    needsVision(item)
  )
}

// ───────────────────────── состояние сеанса ─────────────────────────

export interface OcrOutcome {
  status: 'ok' | 'empty' | 'failed' | 'skipped'
  /** Русский текст для failed. */
  error?: string
  via?: 'text-layer' | 'vision'
  /** PDF-скан: сколько страниц отправлено из скольких. */
  pages?: { read: number; total: number }
  /** Модель оборвала ответ (finish_reason length) или текст обрезан пределом. */
  truncated?: boolean
}

export interface OcrJob {
  phase: 'queued' | 'running'
  manual: boolean
  page?: number
  pages?: number
  cancel?: () => void
}

export interface OcrNote {
  status: 'failed' | 'empty'
  error?: string
  at: number
}

const jobs = new Map<string, OcrJob>()
const notes = new Map<string, OcrNote>()
const listeners = new Set<() => void>()

function emit(): void {
  // Копия: слушатель может отписаться прямо из уведомления.
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch (e) {
      console.warn('QuickDrop: ошибка подписчика состояния распознавания', e)
    }
  }
}

/** Ссылка стабильна до следующего setOcrJob для этой записи (нужно useSyncExternalStore). */
export function getOcrJob(id: string): OcrJob | undefined {
  return jobs.get(id)
}

export function setOcrJob(id: string, job: OcrJob | null): void {
  if (job === null) {
    if (!jobs.delete(id)) return
  } else {
    jobs.set(id, job)
  }
  emit()
}

export function getOcrNote(id: string): OcrNote | undefined {
  return notes.get(id)
}

export function setOcrNote(id: string, note: OcrNote | null): void {
  if (note === null) {
    if (!notes.delete(id)) return
  } else {
    notes.set(id, note)
  }
  emit()
}

export function subscribeOcr(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Для тестов: задачи и примечания стираются, подписчики остаются и получают уведомление. */
export function resetOcrState(): void {
  const had = jobs.size > 0 || notes.size > 0
  jobs.clear()
  notes.clear()
  if (had) emit()
}
