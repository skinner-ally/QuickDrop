/**
 * Markdown без тяжёлых зависимостей: плагины дерева для react-markdown, проверка адресов, переключение задач.
 * Сам react-markdown и remark-gfm подключает только MarkdownView (отдельный чанк) — сюда их не импортировать.
 */

import { safeLinkUrl } from '@/lib/normalize'
import { findWikiSyntax } from '@/lib/wikiLinks'

/** Узел mdast в той мере, в какой он нужен плагинам (свои типы: пакеты mdast/unist в зависимостях не числятся). */
export interface MdNode {
  type: string
  value?: string
  url?: string
  title?: string | null
  children?: MdNode[]
  position?: { start: { offset?: number } }
}

/** Схема адреса вики-ссылки в отрисованном Markdown; наружу такой адрес не уходит. */
export const WIKI_SCHEME = 'qd-wiki:'

/** Символов; текст длиннее показывается исходником: разбор на главном потоке не должен подвесить интерфейс. */
export const MD_RENDER_MAX = 100_000

export function wikiHref(target: string): string {
  return WIKI_SCHEME + encodeURIComponent(target)
}

/** Цель вики-ссылки из адреса; null — адрес не вики или кодировка битая. */
export function parseWikiHref(href: string | undefined): string | null {
  if (typeof href !== 'string' || !href.startsWith(WIKI_SCHEME)) return null
  try {
    const target = decodeURIComponent(href.slice(WIKI_SCHEME.length))
    return target ? target : null
  } catch {
    return null
  }
}

/** Код и сырой HTML плагины не трогают никогда. */
const CODE_NODES = ['code', 'inlineCode', 'html']
/** Вики-ссылка не создаётся ещё и внутри обычной ссылки: ссылка в ссылке недопустима. */
const WIKI_OPAQUE: ReadonlySet<string> = new Set([...CODE_NODES, 'link', 'linkReference'])
const BREAK_OPAQUE: ReadonlySet<string> = new Set(CODE_NODES)

/**
 * Обход: fn получает текстовый узел и возвращает замену (несколько узлов) или null — оставить как есть.
 * Внутрь узлов из opaque обход не заходит.
 */
function mapTextNodes(node: MdNode, opaque: ReadonlySet<string>, fn: (text: MdNode) => MdNode[] | null): void {
  const children = node.children
  if (!children || opaque.has(node.type)) return
  let next: MdNode[] | null = null
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    const replaced = child.type === 'text' ? fn(child) : null
    if (replaced) {
      next ??= children.slice(0, i)
      next.push(...replaced)
    } else {
      mapTextNodes(child, opaque, fn)
      next?.push(child)
    }
  }
  if (next) node.children = next
}

function splitWikiLinks(text: MdNode): MdNode[] | null {
  const value = text.value ?? ''
  // Разбор [[…]] — общий с parseWikiLinks (lib/wikiLinks.ts): что рисуется ссылкой, то и связывается.
  const found = findWikiSyntax(value)
  if (found.length === 0) return null
  const out: MdNode[] = []
  let last = 0
  for (const link of found) {
    if (link.start > last) out.push({ type: 'text', value: value.slice(last, link.start) })
    out.push({
      type: 'link',
      url: wikiHref(link.target),
      title: null,
      children: [{ type: 'text', value: link.label }],
    })
    last = link.end
  }
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
  return out
}

/** remark-плагин: [[цель]] и [[цель|подпись]] в текстовых узлах → узел link с url = wikiHref(цель). */
export function remarkWikiLinks(): (tree: MdNode) => void {
  return (tree) => mapTextNodes(tree, WIKI_OPAQUE, splitWikiLinks)
}

// В исходнике с CRLF текстовый узел хранит «\r\n» как есть: это один перевод строки.
const LINE_BREAK = /\r\n?|\n/

function splitSoftBreaks(text: MdNode): MdNode[] | null {
  const value = text.value ?? ''
  if (!value.includes('\n') && !value.includes('\r')) return null
  const out: MdNode[] = []
  value.split(LINE_BREAK).forEach((part, i) => {
    if (i > 0) out.push({ type: 'break' })
    if (part) out.push({ type: 'text', value: part })
  })
  return out
}

/**
 * remark-плагин: перевод строки внутри текстового узла → узел break. Обычные заметки без разметки
 * пишут строки через одиночный перевод — без плагина Markdown склеил бы их в одну.
 */
export function remarkSoftBreaks(): (tree: MdNode) => void {
  return (tree) => mapTextNodes(tree, BREAK_OPAQUE, splitSoftBreaks)
}

/**
 * Внешний адрес, который откроется по клику на любой платформе: http/https с «//». Окно Tauri открывает
 * только их (desktop.openExternal), ftp браузеры давно не открывают, а «https:host» без «//» браузер
 * считает относительным адресом. Иное — undefined: такая ссылка показывается текстом, а не мёртвой ссылкой.
 */
export function openableLinkUrl(raw: unknown): string | undefined {
  const url = safeLinkUrl(raw)
  return url && /^https?:\/\//i.test(url) ? url : undefined
}

/** urlTransform для react-markdown: наружу — только http/https, внутри — вики-адреса и якоря сносок. */
export function mdUrlTransform(url: string, key: string): string {
  if (key === 'href') {
    if (url.startsWith(WIKI_SCHEME) || url.startsWith('#')) return url
    return openableLinkUrl(url) ?? ''
  }
  if (key === 'src') return openableLinkUrl(url) ?? ''
  return ''
}

// Маркер пункта списка и флажок задачи; липкое — сопоставляется ровно с позиции offset. GFM считает
// задачей и пункт, где после маркера сразу перевод строки, а «[ ] текст» — на следующей строке
// (в цитате — после её «>»).
const TASK_AT = /[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|[ \t]*(?:\r\n?|\n)(?:[ \t]*>)*[ \t]*)\[([ xX])\]/y

/** Исходник с переключённой задачей, пункт которой начинается в offset; null — задачи там нет. */
export function toggleTaskAt(source: string, offset: number): string | null {
  if (!Number.isInteger(offset) || offset < 0) return null
  // Разбор Markdown отбрасывает BOM в начале и считает позиции без него.
  if (source.charCodeAt(0) === 0xfeff) offset += 1
  if (offset >= source.length) return null
  TASK_AT.lastIndex = offset
  const m = TASK_AT.exec(source)
  if (!m) return null
  // Флажок — предпоследний символ совпадения: «[ ]» → позиция пробела.
  const at = m.index + m[0].length - 2
  const next = m[1] === ' ' ? 'x' : ' '
  return source.slice(0, at) + next + source.slice(at + 1)
}

const MD_EXT = /\.(?:md|markdown|mdown)$/i
const MD_MIME = new Set(['text/markdown', 'text/x-markdown'])

/** Файл с разметкой Markdown: по расширению имени или по объявленному типу. */
export function isMarkdownFile(file: { fileName?: string; mimeType?: string }): boolean {
  if (typeof file.fileName === 'string' && MD_EXT.test(file.fileName.trim())) return true
  const mime = typeof file.mimeType === 'string' ? file.mimeType.split(';')[0].trim().toLowerCase() : ''
  return MD_MIME.has(mime)
}
