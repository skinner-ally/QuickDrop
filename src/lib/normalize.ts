/**
 * Общие чистые правила нормализации — единый источник для репозитория, поиска, импорта и AI.
 * Модуль ни от чего не зависит, поэтому его можно импортировать откуда угодно без циклов.
 */

import type { GraphPoint, LinkMeta } from '@/types'

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

// ───────────────────────── файлы ─────────────────────────

const OCTET_STREAM = 'application/octet-stream'
const INERT_MEDIA = /^(?:image|audio|video)\/[a-z0-9][a-z0-9.+-]*$/
const THUMB_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

function baseMime(raw: unknown): string {
  return typeof raw === 'string' ? raw.split(';')[0].trim().toLowerCase() : ''
}

/**
 * Тип, с которым Blob хранится в базе. Blob, открытый по blob:-адресу, исполнился бы в origin
 * приложения (text/html, XML и т.п.), поэтому всё, кроме картинок, аудио, видео, PDF и простого
 * текста, хранится как application/octet-stream; объявленный тип остаётся в поле mimeType.
 * SVG сохраняет свой тип: UI показывает его только растеризованным (components/items/safeFileUrl.ts),
 * а с octet-stream картинка не отрисовалась бы совсем.
 */
export function safeBlobType(raw: unknown): string {
  const t = baseMime(raw)
  if (INERT_MEDIA.test(t) || t === 'application/pdf' || t === 'text/plain') return t
  return OCTET_STREAM
}

/** Тип превью: только растры, которые строит репозиторий (png/jpeg/webp); иное → undefined. */
export function safeThumbType(raw: unknown): string | undefined {
  const t = baseMime(raw)
  return THUMB_TYPES.has(t) ? t : undefined
}

// ───────────────────────── метаданные ссылки ─────────────────────────

/** Есть ли в метаданных что показать: заголовок, описание, сайт, картинка или иконка. */
export function hasLinkContent(meta: LinkMeta | undefined): boolean {
  return !!meta && !!(meta.title || meta.description || meta.siteName || meta.image || meta.favicon)
}

/**
 * 'pending' осмыслен только в сессии, которая ждёт ответа. Сохранённый в копии, переживший
 * перезапуск или вернувшийся отменой удаления, он означал бы вечную «загрузку» —
 * превращаем его в итог по тем данным, что уже есть.
 */
export function settleLinkMeta(meta: LinkMeta): LinkMeta {
  if (meta.status !== 'pending') return meta
  return { ...meta, status: hasLinkContent(meta) ? 'ok' : 'failed' }
}

// ───────────────────────── распознанный текст, граф, сохранённые поиски ─────────────────────────

/** Предел распознанного текста одной записи, символов. */
export const MAX_OCR_TEXT = 200_000

/** \r\n → \n, без управляющих символов (кроме \n и \t), 3+ пустых строк → 2, trim, обрезка до MAX_OCR_TEXT. */
export function cleanOcrText(raw: string): string {
  let text = raw
    .replace(/\r\n?/g, '\n')
    // \p{Cc} — управляющие C0, DEL и C1; двойное отрицание оставляет из них только \n и \t.
    .replace(/[^\P{Cc}\n\t]/gu, '')
    // Строка из одних пробелов и табуляций тоже пустая.
    .replace(/\n(?:[ \t]*\n){3,}/g, '\n\n\n')
    .trim()
  if (text.length > MAX_OCR_TEXT) {
    text = text.slice(0, MAX_OCR_TEXT)
    // Обрезка могла разорвать суррогатную пару: половина символа в базе и в JSON копии — мусор.
    const last = text.charCodeAt(text.length - 1)
    if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1)
    // Иначе повторная очистка (импорт копии) дала бы другой текст.
    text = text.trimEnd()
  }
  return text
}

/** Предел координаты ноды графа, px. */
export const MAX_GRAPH_COORD = 1_000_000

function sanitizeCoord(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  // + 0 превращает −0 в 0: в IndexedDB и JSON они неразличимы, а при сравнении — разные.
  const v = Math.round(raw) + 0
  return Math.abs(v) <= MAX_GRAPH_COORD ? v : null
}

/** Точка графа из произвольного значения: конечные числа, округление до целого, |v| ≤ MAX_GRAPH_COORD; иначе null. */
export function sanitizePoint(raw: unknown): GraphPoint | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { x, y } = raw as { x?: unknown; y?: unknown }
  const sx = sanitizeCoord(x)
  const sy = sanitizeCoord(y)
  return sx === null || sy === null ? null : { x: sx, y: sy }
}

/** Ключ уникальности имени сохранённого поиска: foldText, пробелы схлопнуты, trim. */
export function searchNameKey(name: string): string {
  return foldText(name).replace(/\s+/g, ' ').trim()
}
