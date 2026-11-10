/**
 * Общие чистые правила нормализации — единый источник для репозитория, поиска, импорта и AI.
 * Модуль ни от чего не зависит, поэтому его можно импортировать откуда угодно без циклов.
 */

/** Сворачивает строку для сравнения «как человек»: NFKC, нижний регистр, ё = е. Идемпотентна. */
export function foldText(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/ё/g, 'е')
}

/** trim, нижний регистр, без ведущих '#', пробельные последовательности → '-'. */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
}

/** Нормализует список тегов: пустые выкидываются, дубли убираются, порядок сохраняется. */
export function normalizeTags(raw: readonly string[]): string[] {
  return [...new Set(raw.map(normalizeTag).filter(Boolean))]
}

/**
 * Ключ сравнения тегов. Теги хранятся как ввёл пользователь («отчёты»), а сравниваются
 * по правилу поиска «ё = е» — иначе #отчеты не нашёл бы запись с тегом «отчёты».
 */
export function tagKey(raw: string): string {
  return foldText(normalizeTag(raw))
}

/**
 * Ключ уникальности имени категории: регистр, ё/е, дефисы/подчёркивания и лишние пробелы
 * не различаются. Те же правила, что у cat:имя в поиске, — две категории с одинаковым ключом
 * поиск и импорт не смогли бы различить.
 */
export function categoryNameKey(name: string): string {
  return foldText(name.replace(/[-_]+/g, ' ')).replace(/\s+/g, ' ').trim()
}

// ───────────────────────── адреса ─────────────────────────

const LINK_PROTOCOLS = new Set(['http:', 'https:', 'ftp:'])
const IMAGE_PROTOCOLS = new Set(['http:', 'https:'])

function withProtocol(raw: unknown, allowed: ReadonlySet<string>): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim()
  if (!s) return undefined
  try {
    return allowed.has(new URL(s).protocol) ? s : undefined
  } catch {
    return undefined
  }
}

/**
 * Адрес, который безопасно открыть по клику: только http/https/ftp.
 * javascript:, file:, data:, кастомные обработчики протоколов → undefined.
 * Это же — единственная проверка для UI перед открытием ссылки (window.open / Tauri opener).
 */
export function safeLinkUrl(raw: unknown): string | undefined {
  return withProtocol(raw, LINK_PROTOCOLS)
}

/**
 * Ввод начинается со схемы без «//» (mailto:, tel:, C:\…): это не адрес страницы. Проверять ДО
 * дописывания https:// — иначе «mailto:a@b.c» превратился бы в https-адрес с логином «mailto».
 * «localhost:3000», «example.com:8080» — порт, а не схема.
 */
export function hasForeignScheme(raw: string): boolean {
  return /^[a-z][a-z\d+.-]*:(?!\/\/|\d)/i.test(raw.trim())
}

/** Адрес картинки/иконки, которую можно загрузить в <img>: только http/https. */
export function safeImageUrl(raw: unknown): string | undefined {
  return withProtocol(raw, IMAGE_PROTOCOLS)
}
