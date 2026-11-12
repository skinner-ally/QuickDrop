import { displayTitle } from '@/lib/itemTitle'
import { foldText } from '@/lib/normalize'
import type { Item, ItemStatus } from '@/types'

export interface WikiLink {
  raw: string
  target: string
  label: string
  start: number
  end: number
}

const MAX_TARGET = 200

// Отступ и «>» допускаются любые: ограда внутри списка или цитаты — тоже код. Лучше не разобрать
// ссылку в спорном месте, чем создать связь из примера кода.
const FENCE_OPEN = /^([ \t]*(?:>[ \t]*)*)(`{3,}|~{3,})([^\n]*)$/
const FENCE_CLOSE = /^[ \t]*(?:>[ \t]*)*(`{3,}|~{3,})[ \t\r]*$/
const TOP_LEVEL_PREFIX = /^ {0,3}$/

interface OpenFence {
  char: string
  len: number
  start: number
  topLevel: boolean
  /** Отступ открывающей строки. */
  indent: string
}

interface CodeScan {
  /** Участки кода [начало, конец), по возрастанию, без пересечений. */
  ranges: Array<[number, number]>
  /** Ограда, не закрытая до конца текста. */
  open: OpenFence | null
}

/** Инлайн-код внутри одного абзаца: серию из N обратных кавычек закрывает серия ровно из N. */
function scanInlineCode(text: string, from: number, to: number, ranges: Array<[number, number]>): void {
  let i = text.indexOf('`', from)
  while (i !== -1 && i < to) {
    let runEnd = i
    while (runEnd < to && text[runEnd] === '`') runEnd++
    let start = i
    let slashes = 0
    for (let k = i - 1; k >= from && text[k] === '\\'; k--) slashes++
    // «\`» — буквальная кавычка, серию она не открывает.
    if (slashes % 2 === 1) start++
    const len = runEnd - start
    let close = -1
    if (len > 0) {
      let k = text.indexOf('`', runEnd)
      while (k !== -1 && k < to) {
        let e = k
        while (e < to && text[e] === '`') e++
        if (e - k === len) {
          close = e
          break
        }
        k = text.indexOf('`', e)
      }
    }
    if (close === -1) {
      i = text.indexOf('`', runEnd)
    } else {
      ranges.push([start, close])
      i = text.indexOf('`', close)
    }
  }
}

function scanCode(text: string): CodeScan {
  const ranges: Array<[number, number]> = []
  let fence: OpenFence | null = null
  let paraStart = -1
  const flushParagraph = (end: number) => {
    if (paraStart >= 0) scanInlineCode(text, paraStart, end, ranges)
    paraStart = -1
  }

  let pos = 0
  for (;;) {
    const nl = text.indexOf('\n', pos)
    const lineEnd = nl === -1 ? text.length : nl
    // «\r» от CRLF — не часть строки: с ним ограда «```js\r» не опозналась бы.
    const line = text.slice(pos, lineEnd > pos && text[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd)
    if (fence) {
      const m = FENCE_CLOSE.exec(line)
      if (m && m[1][0] === fence.char && m[1].length >= fence.len) {
        ranges.push([fence.start, lineEnd])
        fence = null
      }
    } else {
      const m = line.includes('```') || line.includes('~~~') ? FENCE_OPEN.exec(line) : null
      // В строке после ``` не может быть обратных кавычек — иначе это инлайн-код, а не ограда.
      if (m && !(m[2][0] === '`' && m[3].includes('`'))) {
        flushParagraph(pos)
        fence = {
          char: m[2][0],
          len: m[2].length,
          start: pos,
          topLevel: TOP_LEVEL_PREFIX.test(m[1]),
          indent: m[1],
        }
      } else if (line.trim() === '') {
        flushParagraph(pos)
      } else if (paraStart < 0) {
        paraStart = pos
      }
    }
    if (nl === -1) break
    pos = nl + 1
  }

  if (fence) ranges.push([fence.start, text.length])
  else flushParagraph(text.length)
  return { ranges, open: fence }
}

/**
 * Строка, которой нужно закрыть текст, чтобы дописанное после него не попало в блок кода;
 * null — закрывать нечего. Ограду внутри цитаты или с отступом от 4 пробелов закрывает конец
 * самого блока, лишняя строка там открыла бы новый блок — для них тоже null.
 * Отступ повторяет открывающий: ограда с отступом 1–3 после строки списка принадлежит пункту,
 * и закрыть её нужно внутри пункта — строка без отступа завершила бы список и открыла новый блок.
 */
export function unclosedFence(text: string): string | null {
  if (!text.includes('```') && !text.includes('~~~')) return null
  const { open } = scanCode(text)
  return open && open.topLevel ? open.indent + open.char.repeat(open.len) : null
}

const WIKI_LINK = /\[\[([^[\]\n\r]*)\]\]/g

export function parseWikiLinks(text: string): WikiLink[] {
  if (!text.includes('[[')) return []

  // Код заменяется переводами строк той же длины: позиции не сдвигаются, а ссылка,
  // задевающая код, перестаёт быть ссылкой.
  let masked = text
  const { ranges } = scanCode(text)
  if (ranges.length > 0) {
    let out = ''
    let last = 0
    for (const [start, end] of ranges) {
      out += text.slice(last, start) + '\n'.repeat(end - start)
      last = end
    }
    masked = out + text.slice(last)
  }

  const links: WikiLink[] = []
  WIKI_LINK.lastIndex = 0
  for (let m = WIKI_LINK.exec(masked); m; m = WIKI_LINK.exec(masked)) {
    const inner = m[1]
    const bar = inner.indexOf('|')
    const target = (bar === -1 ? inner : inner.slice(0, bar)).trim()
    if (!target || target.length > MAX_TARGET) continue
    const label = (bar === -1 ? '' : inner.slice(bar + 1).trim()) || target
    links.push({ raw: m[0], target, label, start: m.index, end: m.index + m[0].length })
  }
  return links
}

export function wikiKey(title: string): string {
  return foldText(title).replace(/\s+/g, ' ').trim()
}

const STATUS_RANK: Record<ItemStatus, number> = { library: 0, inbox: 1, archive: 2 }

function beats(a: Item, b: Item): boolean {
  const rank = (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3)
  if (rank !== 0) return rank < 0
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt
  return a.id < b.id
}

export function buildTitleIndex(items: readonly Item[]): Map<string, Item> {
  const index = new Map<string, Item>()
  for (const item of items) {
    if (item.deletedAt !== undefined) continue
    const key = wikiKey(displayTitle(item))
    if (!key) continue
    const current = index.get(key)
    if (!current || beats(item, current)) index.set(key, item)
  }
  return index
}

export function resolveWikiLink(
  target: string,
  index: ReadonlyMap<string, Item>,
  selfId?: string,
): Item | undefined {
  const item = index.get(wikiKey(target))
  return item && item.id !== selfId ? item : undefined
}

/** id записей, на которые ссылается текст: уникальные, без selfId, в порядке появления. */
export function wikiLinkTargets(text: string, items: readonly Item[], selfId?: string): string[] {
  const links = parseWikiLinks(text)
  if (links.length === 0) return []
  const index = buildTitleIndex(items)
  const ids = new Set<string>()
  for (const link of links) {
    const item = resolveWikiLink(link.target, index, selfId)
    if (item) ids.add(item.id)
  }
  return [...ids]
}
