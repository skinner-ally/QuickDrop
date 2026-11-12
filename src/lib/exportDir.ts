import { getFile } from '@/db/repo'
import { getSettings } from '@/db/settings'
import { DESKTOP_ONLY_MESSAGE, writeExportFile } from '@/lib/desktop'
import type { SavedFile } from '@/lib/desktop'
import { describeError } from '@/lib/errors'
import { formatBytes } from '@/lib/itemTitle'
import { isTauri } from '@/lib/platform'
import type { Item } from '@/types'

/** Вложение: либо готовый blob, либо fileId из таблицы files (читается через repo.getFile). */
export interface ExportAttachment {
  path: string
  blob?: Blob
  fileId?: string
}

/** Один документ экспорта. Все path — относительные, разделитель '/', уникальные в пределах выгрузки. */
export interface ExportDoc {
  path: string
  markdown: string
  attachments?: readonly ExportAttachment[]
}

export interface ExportDirOptions {
  signal?: AbortSignal
  /** В документах. */
  onProgress?(done: number, total: number): void
  /** Подмена для тестов. */
  write?: (dir: string, relPath: string, data: Blob | string, signal?: AbortSignal) => Promise<SavedFile>
  loadFile?: (fileId: string) => Promise<Blob | undefined>
}

export interface ExportDirReport {
  dir: string
  /** Записано .md */
  docs: number
  /** Записано вложений */
  attachments: number
  bytes: number
  failed: Array<{ path: string; error: string }>
  /**
   * Выгрузка прервана: ошибка общая для всей папки (нет доступа, нет места) повторилась подряд.
   * Текст этой ошибки; записанное до неё — в docs/attachments. Если не записалось ничего, вместо
   * отчёта бросается Error с этим текстом.
   */
  stopped?: string
}

const NO_DIR_MESSAGE = 'Не выбрана папка для экспорта Markdown'
const CANCELLED_MESSAGE = 'Экспорт отменён'
const WRITE_FALLBACK = 'Не удалось записать файл'

/** Папка не найдена, не подтверждена или не выбрана: остальные файлы тоже не запишутся. */
const isFatal = (message: string): boolean => message.startsWith('Папка не ') || message === DESKTOP_ONLY_MESSAGE

/**
 * Отказ записи, который обычно касается всей папки (тексты io_message в src-tauri/src/backup.rs).
 * Одиночный такой отказ бывает и у одного файла (файл занят), поэтому выгрузка прерывается только
 * после FOLDER_FAILURES_TO_STOP таких отказов подряд — без единой удачной записи между ними.
 */
const isFolderWide = (message: string): boolean =>
  message.includes(': нет доступа') || message.includes(': на диске не осталось места')
export const FOLDER_FAILURES_TO_STOP = 3

/** Итог выгрузки одной строкой для экрана. */
export function exportReportSummary(report: ExportDirReport): string {
  const written = `заметок ${report.docs}, вложений ${report.attachments}, ${formatBytes(report.bytes)}`
  const nothing = report.docs === 0 && report.attachments === 0
  if (report.stopped) {
    const reason = report.stopped.replace(/[\s.]+$/, '')
    return nothing ? `Экспорт прерван. ${reason}` : `Экспорт прерван. ${reason}. Записано: ${written}`
  }
  if (report.failed.length === 0) return `Готово: ${written}`
  return nothing ? 'Ничего не записано' : `Готово с ошибками: ${written}`
}

async function exportEach<T>(
  dir: string,
  sources: readonly T[],
  toDoc: (source: T) => ExportDoc | Promise<ExportDoc>,
  sourcePath: (source: T) => string,
  options: ExportDirOptions,
): Promise<ExportDirReport> {
  const target = dir.trim()
  if (!target) throw new Error(NO_DIR_MESSAGE)
  if (!options.write && !isTauri()) throw new Error(DESKTOP_ONLY_MESSAGE)
  const { signal } = options
  const write = options.write ?? writeExportFile
  const loadFile = options.loadFile ?? (async (fileId: string) => (await getFile(fileId))?.blob)
  const report: ExportDirReport = { dir: target, docs: 0, attachments: 0, bytes: 0, failed: [] }

  const ensureActive = (): void => {
    if (signal?.aborted) throw new Error(CANCELLED_MESSAGE)
  }

  /** Отказов записи «на всю папку» подряд; удачная запись сбрасывает счёт, сбой чтения вложения — нет. */
  let folderFailures = 0

  /** true — файл записан; false — ошибка ушла в отчёт. */
  async function put(path: string, load: () => Promise<Blob | string | undefined>): Promise<boolean> {
    ensureActive()
    let data: Blob | string | undefined
    try {
      data = await load()
      if (data === undefined) throw new Error('Файл вложения не найден')
    } catch (e) {
      ensureActive()
      report.failed.push({ path, error: describeError(e, 'Не удалось прочитать файл вложения') })
      return false
    }
    try {
      const saved = await write(target, path, data, signal)
      report.bytes += saved.size
      folderFailures = 0
      return true
    } catch (e) {
      // Отмена посреди файла приходит из записи как обычная ошибка.
      ensureActive()
      const error = describeError(e, WRITE_FALLBACK)
      if (isFatal(error)) throw e instanceof Error ? e : new Error(error)
      report.failed.push({ path, error })
      folderFailures = isFolderWide(error) ? folderFailures + 1 : 0
      if (folderFailures >= FOLDER_FAILURES_TO_STOP) report.stopped = error
      return false
    }
  }

  let done = 0
  for (const source of sources) {
    ensureActive()
    let doc: ExportDoc | undefined
    try {
      doc = await toDoc(source)
    } catch (e) {
      report.failed.push({ path: sourcePath(source), error: describeError(e, 'Не удалось подготовить документ') })
    }
    if (doc) {
      // Сначала вложения: документ не должен ссылаться на ещё не записанные файлы.
      for (const attachment of doc.attachments ?? []) {
        const { blob, fileId } = attachment
        const ok = await put(attachment.path, async () => blob ?? (fileId ? await loadFile(fileId) : undefined))
        if (ok) report.attachments += 1
        if (report.stopped) break
      }
      const { markdown } = doc
      if (!report.stopped && (await put(doc.path, async () => markdown))) report.docs += 1
    }
    if (report.stopped) break
    done += 1
    options.onProgress?.(done, sources.length)
  }
  // Не записано ничего — это не итог выгрузки, а её ошибка.
  if (report.stopped && report.docs === 0 && report.attachments === 0) throw new Error(report.stopped)
  return report
}

export function exportDocsToDir(
  dir: string,
  docs: readonly ExportDoc[],
  options: ExportDirOptions = {},
): Promise<ExportDirReport> {
  return exportEach(
    dir,
    docs,
    (doc) => doc,
    (doc) => doc.path,
    options,
  )
}

export type ItemToDoc = (item: Item) => ExportDoc | Promise<ExportDoc>

/** dir по умолчанию — settings.mdExportDir. */
export async function exportMarkdownToDir(
  items: readonly Item[],
  toDoc: ItemToDoc,
  options: ExportDirOptions & { dir?: string } = {},
): Promise<ExportDirReport> {
  const dir = options.dir ?? (await getSettings()).mdExportDir
  return exportEach(dir, items, toDoc, (item) => item.id, options)
}
