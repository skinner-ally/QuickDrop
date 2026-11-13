import { detectInput } from '@/lib/detect'
import type { NewItemInput } from '@/types'

/**
 * Содержимое сообщений расширения браузера (канал 127.0.0.1, протокол v1).
 * Rust проверяет транспорт (адрес, origin, токен, размер), здесь — поля и пределы.
 */

export const EXT_URL_MAX = 2048
export const EXT_TITLE_MAX = 300
export const EXT_TEXT_MAX = 500_000

export type ExtensionKind = 'page' | 'link' | 'selection'

export interface ExtensionMessage {
  v: 1
  kind: ExtensionKind
  url?: string
  title?: string
  text?: string
}

const KINDS: readonly ExtensionKind[] = ['page', 'link', 'selection']

export const EXT_ERR_FORMAT = 'Неизвестный формат сообщения расширения'
export const EXT_ERR_NO_URL = 'Не указан адрес страницы'
export const EXT_ERR_BAD_URL = 'Адрес не поддерживается'
export const EXT_ERR_LONG_URL = 'Адрес слишком длинный'
export const EXT_ERR_EMPTY_TEXT = 'Выделенный текст пуст'
export const EXT_ERR_LONG_TEXT = 'Выделенный текст слишком длинный'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto: unknown = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

function own(obj: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(obj, key) ? obj[key] : undefined
}

/** Адрес http/https не длиннее EXT_URL_MAX; иначе текст ошибки. Пустой/не строка — `missing`. */
function parseUrlField(v: unknown): { url: string } | { error: string; missing?: true } {
  if (typeof v !== 'string' || !v.trim()) return { error: EXT_ERR_NO_URL, missing: true }
  const s = v.trim()
  if (s.length > EXT_URL_MAX) return { error: EXT_ERR_LONG_URL }
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return { error: EXT_ERR_BAD_URL }
  }
  if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !u.hostname) return { error: EXT_ERR_BAD_URL }
  // href без управляющих символов и с кодировкой; после кодирования предел проверяется ещё раз.
  if (u.href.length > EXT_URL_MAX) return { error: EXT_ERR_LONG_URL }
  return { url: u.href }
}

/** Обрезка без разрыва суррогатной пары. */
function cut(s: string, max: number): string {
  if (s.length <= max) return s
  let out = s.slice(0, max)
  const last = out.charCodeAt(out.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1)
  return out
}

/** Заголовок: пробельные схлопнуты, управляющие убраны, не длиннее EXT_TITLE_MAX. Пусто — undefined. */
function cleanTitle(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v
    .replace(/\s+/g, ' ')
    .replace(/\p{Cc}/gu, '')
    .trim()
  if (!t) return undefined
  const out = cut(t, EXT_TITLE_MAX).trimEnd()
  return out || undefined
}

/** Переносы → \n, символ NUL убран. */
function normalizeText(s: string): string {
  return s.replace(/\r\n?/g, '\n').replace(/\0/g, '')
}

/** Проверка и очистка сообщения расширения. Бросает Error с русским текстом. Лишние поля отбрасываются. */
export function parseExtensionMessage(raw: unknown): ExtensionMessage {
  if (!isPlainObject(raw)) throw new Error(EXT_ERR_FORMAT)
  const kind = own(raw, 'kind')
  if (own(raw, 'v') !== 1 || typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) {
    throw new Error(EXT_ERR_FORMAT)
  }
  const msg: ExtensionMessage = { v: 1, kind: kind as ExtensionKind }

  const parsedUrl = parseUrlField(own(raw, 'url'))
  if ('url' in parsedUrl) msg.url = parsedUrl.url
  // У выделения адрес источника необязателен: негодный просто отбрасывается.
  else if (msg.kind !== 'selection') throw new Error(parsedUrl.error)

  const title = cleanTitle(own(raw, 'title'))
  if (title !== undefined) msg.title = title

  if (msg.kind === 'selection') {
    const rawText = own(raw, 'text')
    if (typeof rawText !== 'string') throw new Error(EXT_ERR_EMPTY_TEXT)
    const text = normalizeText(rawText)
    if (!text.trim()) throw new Error(EXT_ERR_EMPTY_TEXT)
    if (text.length > EXT_TEXT_MAX) throw new Error(EXT_ERR_LONG_TEXT)
    msg.text = text
  }
  return msg
}

/** Ведущие пустые строки и хвостовые пробелы убираются; отступ первой строки кода сохраняется. */
function trimCode(s: string): string {
  return s.replace(/^(?:[ \t]*\n)+/, '').trimEnd()
}

/** Запись для createItem: всегда во «Входящие», источник — расширение. */
export function extensionMessageToInput(msg: ExtensionMessage): NewItemInput {
  const base = { status: 'inbox', source: 'extension' } as const
  if (msg.kind !== 'selection') {
    if (!msg.url) throw new Error(EXT_ERR_NO_URL)
    return msg.title ? { type: 'link', url: msg.url, title: msg.title, ...base } : { type: 'link', url: msg.url, ...base }
  }
  const text = msg.text ?? ''
  if (!text.trim()) throw new Error(EXT_ERR_EMPTY_TEXT)
  const det = detectInput(text)
  if (det.type === 'link' && det.url) return { type: 'link', url: det.url, ...base }
  if (det.type === 'code') {
    // Адрес источника в код не дописывается: он испортил бы исходник. Название страницы — заголовок.
    const input: NewItemInput = { type: 'code', content: trimCode(det.stripped ?? text), ...base }
    if (det.language) input.language = det.language
    if (msg.title) input.title = msg.title
    return input
  }
  const content = text.trim() + (msg.url ? `\n\nИсточник: ${msg.url}` : '')
  return { type: 'text', content, ...base }
}
