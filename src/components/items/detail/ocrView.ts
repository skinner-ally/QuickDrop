import { cleanOcrText } from '@/lib/normalize'
import { OCR_EDIT_MAX, OCR_VIEW_CHARS, isScanPdf, ocrKindOf, type OcrJob, type OcrNote } from '@/lib/ocrState'
import type { Item } from '@/types'

/** Что уйдёт в сеть, если нажать кнопку: одна картинка или первые страницы PDF картинками. */
export type OcrNetwork = 'image' | 'pdf'

export const OCR_SCAN_PDF_NOTE =
  'В PDF нет текстового слоя. Распознать скан можно через ИИ-помощника: «Настройки → ИИ-помощник»'

export type OcrBlockView =
  | { kind: 'none' }
  | { kind: 'job'; label: string; cancellable: boolean }
  | {
      kind: 'text'
      length: number
      /** Просмотр без правки, очистки и повторного запуска (корзина). */
      readOnly: boolean
      /** Правка в интерфейсе доступна (текст не длиннее OCR_EDIT_MAX). */
      canEdit: boolean
      /** Длиннее OCR_VIEW_CHARS: по умолчанию показывается начало и кнопка «Показать весь текст». */
      tooLong: boolean
      rerun: { label: string; network: OcrNetwork | null } | null
    }
  | { kind: 'failed'; error: string; retry: { network: OcrNetwork | null } | null }
  | { kind: 'empty'; network: OcrNetwork }
  | { kind: 'start'; label: string; network: OcrNetwork | null }
  | { kind: 'note'; text: string }

/**
 * Черновик правки, который repo.setOcrText превратит в пустую строку (стёрт целиком, одни пробелы или
 * управляющие символы). Такой черновик автосохранением не пишется: очистка — только при выходе из правки,
 * через actClearOcrText с «Отменить».
 */
export function isBlankOcrDraft(draft: string): boolean {
  return cleanOcrText(draft) === ''
}

/** Строка о сети: обязательна рядом с любой кнопкой, запускающей отправку изображения. */
export function ocrNetworkLine(network: OcrNetwork, host: string): string {
  return network === 'pdf'
    ? `Первые страницы (до 5) будут отправлены картинками на ${host}`
    : `Изображение будет отправлено на ${host}`
}

export function ocrJobLabel(job: Pick<OcrJob, 'phase' | 'page' | 'pages'>): string {
  if (job.phase === 'queued') return 'В очереди…'
  if (job.page !== undefined && job.pages !== undefined && job.pages > 0) {
    return `Распознаётся: страница ${job.page} из ${job.pages}…`
  }
  return 'Распознаётся…'
}

/** «1 знак», «2 знака», «5 знаков», «21 знак». */
export function charsLabel(n: number): string {
  const mod100 = n % 100
  const mod10 = n % 10
  let word = 'знаков'
  if (mod100 < 11 || mod100 > 14) {
    if (mod10 === 1) word = 'знак'
    else if (mod10 >= 2 && mod10 <= 4) word = 'знака'
  }
  return `${n.toLocaleString('ru-RU')} ${word}`
}

/** Начало текста для просмотра; не рвёт суррогатную пару на границе. */
export function visibleOcrText(text: string, showAll: boolean): string {
  if (showAll || text.length <= OCR_VIEW_CHARS) return text
  let end = OCR_VIEW_CHARS
  const last = text.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return text.slice(0, end)
}

/**
 * Выбор состояния блока «Распознанный текст» по таблице спецификации §4.2. Чистая функция (в vitest нет DOM).
 * aiBlocked — распознавание зрением недоступно (ИИ выключен или не настроен). readOnly — запись в корзине.
 */
export function ocrBlockView(
  item: Item,
  job: OcrJob | undefined,
  note: OcrNote | undefined,
  aiBlocked: boolean,
  readOnly: boolean = item.deletedAt !== undefined,
): OcrBlockView {
  const kind = ocrKindOf(item)
  if (kind === null) return { kind: 'none' }
  const trashed = readOnly || item.deletedAt !== undefined

  if (job) return { kind: 'job', label: ocrJobLabel(job), cancellable: typeof job.cancel === 'function' }

  const text = item.ocrText
  if (text) {
    // Текст слоя PDF без отметки зрения: повтор — локальное извлечение, сеть не нужна.
    const fromLayer = kind === 'pdf' && item.ocrVisionAt === undefined
    let rerun: { label: string; network: OcrNetwork | null } | null = null
    if (!trashed) {
      if (fromLayer) rerun = { label: 'Извлечь заново', network: null }
      else if (!aiBlocked) rerun = { label: 'Распознать заново', network: kind }
    }
    return {
      kind: 'text',
      length: text.length,
      readOnly: trashed,
      canEdit: !trashed && text.length <= OCR_EDIT_MAX,
      tooLong: text.length > OCR_VIEW_CHARS,
      rerun,
    }
  }

  if (trashed) return { kind: 'none' }

  if (note?.status === 'failed') {
    // Картинку без ИИ повторить нельзя (toast с причиной вместо запроса) — кнопки нет; PDF разбирается локально.
    const canRetry = !(kind === 'image' && aiBlocked)
    return {
      kind: 'failed',
      error: note.error || 'Не удалось распознать текст',
      retry: canRetry ? { network: aiBlocked ? null : kind } : null,
    }
  }

  // PDF без отметки зрения и без текста: слой не проверялся либо текст очистил сам пользователь (repo.setOcrText
  // ставит ocrAt и при очистке) — отличить нельзя, поэтому предлагается локальное извлечение, а не «скан».
  // «Нет текстового слоя» — только если слой проверен в этом сеансе (note.empty) или уже распознавали зрением.
  if (kind === 'pdf' && item.ocrVisionAt === undefined && note?.status !== 'empty') {
    return { kind: 'start', label: 'Извлечь текст', network: aiBlocked ? null : 'pdf' }
  }

  const scan = kind === 'image' || isScanPdf(item)
  if (scan && !aiBlocked) {
    if (item.ocrVisionAt !== undefined || note?.status === 'empty') return { kind: 'empty', network: kind }
    return { kind: 'start', label: 'Распознать текст', network: kind }
  }
  if (scan) return kind === 'pdf' ? { kind: 'note', text: OCR_SCAN_PDF_NOTE } : { kind: 'none' }

  // PDF, у которого слой ещё не помечен проверенным: локальное извлечение; со зрением скан пойдёт дальше.
  return { kind: 'start', label: 'Извлечь текст', network: aiBlocked ? null : 'pdf' }
}
