/** Разбор содержимого буфера обмена при вставке — общий для глобальной вставки и панели добавления. */

type ClipboardLike = Pick<DataTransfer, 'types' | 'files' | 'items' | 'getData'>

/** Файлы из буфера: files, а если их нет (часть браузеров) — элементы kind === 'file'. */
export function filesFromClipboard(dt: Pick<DataTransfer, 'files' | 'items'>): File[] {
  if (dt.files.length) return Array.from(dt.files)
  const out: File[] = []
  for (const it of Array.from(dt.items)) {
    if (it.kind === 'file') {
      const f = it.getAsFile()
      if (f) out.push(f)
    }
  }
  return out
}

/**
 * Вставка из офисного приложения (диапазон ячеек Excel и т.п.): в буфере и текст, и растровая копия.
 * Текстовой считаем её только по совокупности признаков, чтобы не сломать вставку файла из проводника
 * (там рядом с файлом тоже может лежать имя как text/plain).
 */
export function isRichTextPaste(dt: Pick<DataTransfer, 'types'>, files: readonly File[], text: string): boolean {
  if (!text.trim() || files.length === 0) return false
  if (!files.every((f) => f.type.startsWith('image/'))) return false
  const types = Array.from(dt.types)
  return types.includes('text/html') || types.includes('text/rtf')
}

/** Файлы, которые надо взять из вставки. Пусто — вставка текстовая или файлов в буфере нет. */
export function pastedFiles(dt: ClipboardLike): File[] {
  const files = filesFromClipboard(dt)
  if (files.length === 0 || isRichTextPaste(dt, files, dt.getData('text/plain'))) return []
  return files
}
