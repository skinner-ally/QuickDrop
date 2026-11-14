import { derivedTitleLine, displayTitle } from '@/lib/itemTitle'
import { foldText } from '@/lib/normalize'
import type { Item, ItemStatus } from '@/types'

export interface WikiLink {
  raw: string
  target: string
  label: string
  start: number
  end: number
  /** Ссылка в строке таблицы GFM: голая «|» там разрезала бы ячейку, разделитель подписи — «\|». */
  inTable?: boolean
}

const MAX_TARGET = 200

const WIKI_LINK = /\[\[([^[\]\n\r]*)\]\]/g

/**
 * Цель и подпись из содержимого [[…]]; null — не ссылка. Один разбор и для исходника (parseWikiLinks),
 * и для текста дерева Markdown (remarkWikiLinks): что рисуется ссылкой, то и связывается.
 */
export function parseWikiInner(inner: string): { target: string; label: string } | null {
  const bar = inner.indexOf('|')
  let head = bar === -1 ? inner : inner.slice(0, bar)
  // В таблице Markdown голая «|» разрезала бы ячейку, поэтому там пишут [[цель\|подпись]], как в Obsidian.
  if (bar !== -1 && head.endsWith('\\')) head = head.slice(0, -1)
  const target = head.trim()
  if (!target || target.length > MAX_TARGET) return null
  const label = (bar === -1 ? '' : inner.slice(bar + 1).trim()) || target
  return { target, label }
}

export interface WikiSyntax {
  start: number
  end: number
  target: string
  label: string
}

/** [[…]] в уже разобранном тексте (текстовый узел дерева Markdown): код, экранирование и блоки там уже учтены. */
export function findWikiSyntax(text: string): WikiSyntax[] {
  const out: WikiSyntax[] = []
  if (!text.includes('[[')) return out
  for (const m of text.matchAll(WIKI_LINK)) {
    const link = parseWikiInner(m[1])
    if (link) out.push({ start: m.index, end: m.index + m[0].length, ...link })
  }
  return out
}

// ───────────────────────── блоки исходника ─────────────────────────
// parseWikiLinks видит исходник так же, как разбор Markdown в просмотре (remark + GFM): ссылка,
// которую просмотр не рисует, не должна создавать связь, и наоборот. Полного разбора здесь нет —
// только то, что меняет судьбу [[…]]: код, HTML-блоки, определения ссылок, таблицы, обычные ссылки,
// автоссылки, экранирование и сущности.

// Открывающая ограда ищется в содержимом строки (без «>» цитаты и маркера пункта). Закрывающая
// принимается с любым отступом и «>»: лучше не разобрать ссылку в спорном месте, чем создать связь из примера кода.
const FENCE_OPEN = /^([ \t]*)(`{3,}|~{3,})([^\n]*)$/
const FENCE_CLOSE = /^[ \t]*(?:>[ \t]*)*(`{3,}|~{3,})[ \t\r]*$/
const TOP_LEVEL_PREFIX = /^ {0,3}$/

const ATX_HEADING = /^#{1,6}(?:[ \t]|$)/
const THEMATIC_BREAK = /^(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/
const SETEXT_UNDERLINE = /^(?:=+|-+)[ \t]*$/
const LIST_MARKER = /^(?:[-*+]|\d{1,9}[.)])(?=[ \t]|$)/
const FOOTNOTE_DEF = /^\[\^[^\]\s]+\]:/
const DEFINITION =
  /^\[((?:[^[\]\\]|\\.){1,999})\]:[ \t]*(?:<[^<>\n]*>|[^ \t\r\n<][^ \t\r\n]*)(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^()]*\)))?[ \t]*$/

const HTML_TAG_NAMES =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|' +
  'fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|' +
  'menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|' +
  'track|ul'
const ATTRIBUTE = `(?:[ \\t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \\t]*=[ \\t]*(?:[^ \\t"'=<>\`]+|'[^']*'|"[^"]*"))?)`
const OPEN_TAG = `<[A-Za-z][A-Za-z0-9-]*${ATTRIBUTE}*[ \\t]*\\/?>`
const CLOSE_TAG = `<\\/[A-Za-z][A-Za-z0-9-]*[ \\t]*>`

/** Начала HTML-блоков CommonMark; end — строка-конец (null — до пустой строки), para — может прервать абзац. */
const HTML_BLOCKS: ReadonlyArray<{ start: RegExp; end: RegExp | null; para: boolean }> = [
  { start: /^<(?:script|pre|style|textarea)(?:[ \t>]|$)/i, end: /<\/(?:script|pre|style|textarea)>/i, para: true },
  { start: /^<!--/, end: /-->/, para: true },
  { start: /^<\?/, end: /\?>/, para: true },
  { start: /^<![A-Za-z]/, end: />/, para: true },
  { start: /^<!\[CDATA\[/, end: /\]\]>/, para: true },
  { start: new RegExp(`^<\\/?(?:${HTML_TAG_NAMES})(?:[ \\t>]|\\/>|$)`, 'i'), end: null, para: true },
  { start: new RegExp(`^(?:${OPEN_TAG}|${CLOSE_TAG})[ \\t]*$`), end: null, para: false },
]

/** Строчные теги и автоссылки в угловых скобках: в просмотре это узлы html/link, текста внутри нет. */
const INLINE_TAG = new RegExp(
  [
    OPEN_TAG.replace(/\[ \\t\]/g, '\\s'),
    CLOSE_TAG.replace(/\[ \\t\]/g, '\\s'),
    '<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\\s<>]*>',
    "<[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*>",
  ].join('|'),
  'y',
)
/** Строчный комментарий, инструкция, объявление, CDATA: начало и конец. */
const INLINE_SPANS: ReadonlyArray<{ open: string; close: string }> = [
  { open: '<!--', close: '-->' },
  { open: '<![CDATA[', close: ']]>' },
  { open: '<?', close: '?>' },
  { open: '<!', close: '>' },
]

interface OpenFence {
  char: string
  len: number
  start: number
  topLevel: boolean
  /** Отступ открывающей строки. */
  indent: string
  /** Уровень цитаты и колонка пункта списка, в которых открыта ограда (0 — вне списка). */
  depth: number
  base: number
}

interface CodeScan {
  /** Участки, где [[…]] не бывает (код, HTML-блоки, определения ссылок), [начало, конец), по возрастанию. */
  ranges: Array<[number, number]>
  /** Ограда, не закрытая до конца текста. */
  open: OpenFence | null
  /** Отрезки строчного текста — абзацы, заголовки, строки таблиц: границы инлайн-разбора. */
  inline: Array<[number, number]>
  /** Строки таблиц GFM. */
  tableRows: Array<[number, number]>
  /** Метки определений «[метка]: адрес», нормализованные. */
  defs: Set<string>
}

/** Число обратных косых черт подряд перед позицией i. */
function slashesBefore(text: string, i: number, from = 0): number {
  let n = 0
  for (let k = i - 1; k >= from && text[k] === '\\'; k--) n++
  return n
}

/** Инлайн-код внутри одного абзаца: серию из N обратных кавычек закрывает серия ровно из N. */
function scanInlineCode(text: string, from: number, to: number, ranges: Array<[number, number]>): void {
  let i = text.indexOf('`', from)
  while (i !== -1 && i < to) {
    let runEnd = i
    while (runEnd < to && text[runEnd] === '`') runEnd++
    let start = i
    // «\`» — буквальная кавычка, серию она не открывает.
    if (slashesBefore(text, i, from) % 2 === 1) start++
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

/** Отступ строки в колонках (таб — до следующей кратной 4) и индекс первого непробельного символа. */
function indentOf(line: string, startCol = 0): { col: number; first: number } {
  let col = startCol
  let i = 0
  for (; i < line.length; i++) {
    if (line[i] === ' ') col++
    else if (line[i] === '\t') col += 4 - (col % 4)
    else break
  }
  return { col, first: i }
}

/** Метка определения ссылки так, как её сравнивает Markdown: регистр и пробелы не важны. */
function normalizeLabel(label: string): string {
  return label.replace(/[\t\n\r ]+/g, ' ').trim().toLowerCase().toUpperCase()
}

const CONTAINER_PREFIX = /^[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?/
const DELIMITER_CELL = /^[ \t]*:?-+:?[ \t]*$/

function tableCells(row: string): string[] {
  let s = row.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/)
}

function isDelimiterRow(row: string): boolean {
  return row.includes('|') && tableCells(row).every((cell) => DELIMITER_CELL.test(cell))
}

interface QuotedLine {
  depth: number
  /** Строка после последнего «>». */
  content: string
  /** Колонка, с которой начинается content (табы считаются до кратной 4). */
  col: number
  /** Колонка содержимого цитаты: после «>» и одного необязательного пробела. */
  base: number
}

/** Уровень цитаты строки и её содержимое без маркеров «>». */
function stripQuotes(line: string): QuotedLine {
  let depth = 0
  let i = 0
  let col = 0
  let base = 0
  for (;;) {
    let k = i
    let c = col
    while (k < line.length && k - i < 3 && line[k] === ' ') {
      k++
      c++
    }
    if (line[k] !== '>') break
    depth++
    i = k + 1
    col = c + 1
    base = col
    // Один пробел после «>» — часть маркера; таб отдаёт под него одну свою колонку.
    if (line[i] === ' ') {
      i++
      col++
      base = col
    } else if (line[i] === '\t') {
      base = col + 1
    }
  }
  return { depth, content: depth === 0 ? line : line.slice(i), col, base }
}

/** Строка, которая открывает свой блок и потому не продолжает абзац цитаты «лениво». */
const BLOCK_START = /^[ \t]{0,3}(?:#{1,6}(?:[ \t]|$)|`{3}|~{3}|[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|<)/

/**
 * Разбор исходника по блокам — столько, сколько нужно, чтобы найти места без вики-ссылок: ограды,
 * код с отступом (с учётом пунктов списка и цитат), HTML-блоки, определения ссылок; плюс абзацы и строки таблиц.
 */
function scanCode(text: string): CodeScan {
  const ranges: Array<[number, number]> = []
  const inline: Array<[number, number]> = []
  const tableRows: Array<[number, number]> = []
  const defs = new Set<string>()
  let fence: OpenFence | null = null
  let html: { start: number; end: RegExp | null; depth: number; base: number } | null = null
  let indented: { start: number; end: number; col: number; depth: number } | null = null
  let table = false
  /** Уровень цитаты, в котором открыты блоки. */
  let depth = 0
  /** Колонки содержимого открытых пунктов списка и сносок, от внешнего к вложенному. */
  const lists: Array<{ col: number; depth: number }> = []
  const listCol = (): number => (lists.length > 0 ? lists[lists.length - 1].col : 0)
  /** Последний пункт пуст в строке маркера: следующая пустая строка его закрывает. */
  let emptyItem = false
  let paraStart = -1
  let paraLast: { pos: number; end: number; content: string } | null = null
  let afterBlank = true

  /** Строка вышла из цитаты или из пункта списка, в котором открыт блок (ограда, HTML). */
  const leftContainer = (quote: QuotedLine, blockDepth: number, blockBase: number): boolean =>
    quote.depth < blockDepth ||
    (blockBase > 0 && quote.content.trim() !== '' && indentOf(quote.content, quote.col).col < blockBase)

  const addInline = (start: number, end: number) => {
    if (end <= start) return
    inline.push([start, end])
    scanInlineCode(text, start, end, ranges)
  }
  const flushParagraph = (end: number) => {
    if (paraStart >= 0) addInline(paraStart, end)
    paraStart = -1
    paraLast = null
  }
  const closeIndented = () => {
    if (indented) ranges.push([indented.start, indented.end])
    indented = null
  }

  // BOM в начале разбор Markdown отбрасывает: отступ первой строки считается после него.
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0
  for (;;) {
    const nl = text.indexOf('\n', pos)
    const lineEnd = nl === -1 ? text.length : nl
    // «\r» от CRLF — не часть строки: с ним ограда «```js\r» не опозналась бы.
    const line = text.slice(pos, lineEnd > pos && text[lineEnd - 1] === '\r' ? lineEnd - 1 : lineEnd)
    step: {
      const quote = stripQuotes(line)
      if (fence) {
        if (!leftContainer(quote, fence.depth, fence.base)) {
          const m = FENCE_CLOSE.exec(line)
          if (m && m[1][0] === fence.char && m[1].length >= fence.len) {
            ranges.push([fence.start, lineEnd])
            fence = null
          }
          break step
        }
        // Пункт списка или цитата кончились — кончилась и ограда внутри них.
        ranges.push([fence.start, pos])
        fence = null
        afterBlank = true
      }
      if (html) {
        if (leftContainer(quote, html.depth, html.base)) {
          ranges.push([html.start, pos])
          html = null
          afterBlank = true
        } else if (html.end) {
          if (html.end.test(line)) {
            ranges.push([html.start, lineEnd])
            html = null
          }
          break step
        } else if (quote.depth === html.depth && quote.content.trim() === '') {
          ranges.push([html.start, pos])
          html = null
        } else {
          break step
        }
      }
      if (indented && quote.depth !== indented.depth) closeIndented()
      if (quote.depth !== depth) {
        // Строка без «>» после абзаца цитаты продолжает этот абзац, если не открывает свой блок.
        const lazy =
          quote.depth < depth &&
          paraStart >= 0 &&
          quote.content.trim() !== '' &&
          !BLOCK_START.test(quote.content) &&
          !THEMATIC_BREAK.test(quote.content.trim())
        if (lazy) {
          paraLast = { pos, end: lineEnd, content: quote.content }
          break step
        }
        flushParagraph(pos)
        table = false
        while (lists.length > 0 && lists[lists.length - 1].depth > quote.depth) lists.pop()
        depth = quote.depth
        afterBlank = true
      }

      // Повтор — для содержимого строки пункта списка или сноски: в нём может открыться свой блок.
      let content = quote.content
      let startCol = quote.col
      let quoteBase = quote.base
      for (;;) {
        if (content.trim() === '') {
          flushParagraph(pos)
          table = false
          afterBlank = true
          // Пункт, пустой в строке маркера, пустая строка и закрывает.
          if (emptyItem) lists.pop()
          emptyItem = false
          break
        }
        emptyItem = false
        const { col, first } = indentOf(content, startCol)
        if (indented) {
          if (col >= indented.col) {
            indented.end = lineEnd
            break
          }
          closeIndented()
        }
        const t = content.slice(first)
        // Строка с меньшим отступом выходит из пункта списка — если только она не продолжает его абзац
        // «лениво» (без пустой строки перед ней и не открывая свой блок).
        const lazy = paraStart >= 0 && !afterBlank && !BLOCK_START.test(t) && !THEMATIC_BREAK.test(t)
        if (!lazy) while (lists.length > 0 && col < listCol()) lists.pop()
        afterBlank = false
        const base = Math.max(listCol(), quoteBase)
        const rel = col - base

        // Код с отступом не прерывает абзац: «текст\n    ещё» — продолжение абзаца.
        if (rel >= 4 && paraStart < 0 && !table) {
          indented = { start: pos, end: lineEnd, col: base + 4, depth }
          break
        }

        // Цитата в строке маркера пункта или сноски («1. > текст»): дальше — её содержимое.
        if (rel < 4 && t.startsWith('>')) {
          const inner = stripQuotes(t)
          flushParagraph(pos)
          table = false
          depth += inner.depth
          startCol = col + inner.col
          quoteBase = col + inner.base
          content = inner.content
          continue
        }

        const fm = rel < 4 && (t.startsWith('```') || t.startsWith('~~~')) ? FENCE_OPEN.exec(content) : null
        // В строке после ``` не может быть обратных кавычек — иначе это инлайн-код, а не ограда.
        if (fm && !(fm[2][0] === '`' && fm[3].includes('`'))) {
          flushParagraph(pos)
          table = false
          fence = {
            char: fm[2][0],
            len: fm[2].length,
            start: pos,
            topLevel: depth === 0 && TOP_LEVEL_PREFIX.test(fm[1]),
            indent: fm[1],
            depth,
            base: lists.length > 0 ? base : 0,
          }
          break
        }

        if (rel < 4) {
          const block = HTML_BLOCKS.find((b) => (b.para || paraStart < 0) && b.start.test(t))
          if (block) {
            flushParagraph(pos)
            table = false
            if (block.end?.test(t)) ranges.push([pos, lineEnd])
            else html = { start: pos, end: block.end, depth, base: lists.length > 0 ? base : 0 }
            break
          }
        }

        if (table) {
          if (!(rel < 4 && (ATX_HEADING.test(t) || THEMATIC_BREAK.test(t)))) {
            tableRows.push([pos, lineEnd])
            addInline(pos, lineEnd)
            break
          }
          table = false
        }

        // Строка-разделитель под строкой абзаца с тем же числом ячеек — заголовок таблицы.
        if (paraLast && rel < 4 && t.includes('-') && isDelimiterRow(t)) {
          const head = paraLast
          if (tableCells(head.content.replace(CONTAINER_PREFIX, '')).length === tableCells(t).length) {
            flushParagraph(head.pos)
            tableRows.push([head.pos, head.end], [pos, lineEnd])
            addInline(head.pos, head.end)
            table = true
            break
          }
        }

        if (rel < 4 && ATX_HEADING.test(t)) {
          flushParagraph(pos)
          addInline(pos, lineEnd)
          break
        }
        if (rel < 4 && ((paraStart >= 0 && SETEXT_UNDERLINE.test(t)) || THEMATIC_BREAK.test(t))) {
          flushParagraph(pos)
          break
        }
        // Сноска «[^1]: …» — не определение ссылки, а блок, как пункт списка: продолжение — с отступом 4.
        const footnote = rel < 4 ? FOOTNOTE_DEF.exec(t) : null
        if (footnote) {
          while (lists.length > 0 && listCol() > col) lists.pop()
          lists.push({ col: col + 4, depth })
          flushParagraph(pos)
          // micromark съедает все пробелы и табы после «[^метка]:»: первая строка сноски начинается с колонки её содержимого.
          content = content.slice(0, first) + '    ' + t.slice(footnote[0].length).replace(/^[ \t]+/, '')
          continue
        }
        if (rel < 4 && paraStart < 0) {
          const def = DEFINITION.exec(t)
          if (def && /\S/.test(def[1])) {
            defs.add(normalizeLabel(def[1]))
            ranges.push([pos, lineEnd])
            break
          }
        }
        const marker = rel < 4 ? LIST_MARKER.exec(t) : null
        const markerEnd = marker ? col + marker[0].length : 0
        const after = marker ? indentOf(t.slice(marker[0].length), markerEnd) : null
        const empty = !!marker && !!after && after.first === t.length - marker[0].length
        // Новый список прерывает абзац, только если пункт не пуст, а нумерация начинается с 1.
        const startsList = lists.length === 0 || col >= listCol()
        const interrupts = paraStart >= 0 && startsList && (empty || (/^\d/.test(t) && !/^0*1[.)]/.test(t)))
        if (marker && after && !interrupts) {
          // Пробелов после маркера больше четырёх — содержимое пункта начинается кодом с отступом.
          const contentCol = empty || after.col - markerEnd > 4 ? markerEnd + 1 : after.col
          while (lists.length > 0 && listCol() > col) lists.pop()
          lists.push({ col: contentCol, depth })
          flushParagraph(pos)
          if (empty) {
            emptyItem = true
            break
          }
          content = content.slice(0, first) + ' '.repeat(marker[0].length) + t.slice(marker[0].length)
          continue
        }

        if (paraStart < 0) paraStart = pos
        paraLast = { pos, end: lineEnd, content }
        break
      }
    }
    if (nl === -1) break
    pos = nl + 1
  }

  if (indented) ranges.push([indented.start, indented.end])
  if (html) ranges.push([html.start, text.length])
  if (fence) ranges.push([fence.start, text.length])
  else flushParagraph(text.length)
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  return { ranges, open: fence, inline, tableRows, defs }
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

// ───────────────────────── строчный текст ─────────────────────────

/** Замена участков переводами строк той же длины: позиции не сдвигаются, ссылка через участок не проходит. */
function maskRanges(text: string, ranges: ReadonlyArray<readonly [number, number]>): string {
  if (ranges.length === 0) return text
  let out = ''
  let last = 0
  for (const [start, end] of ranges) {
    if (end <= last) continue
    const from = Math.max(start, last)
    out += text.slice(last, from) + '\n'.repeat(end - from)
    last = end
  }
  return out + text.slice(last)
}

/** Строчный HTML и автоссылки <…> внутри абзацев — тоже маской. */
function maskInlineMarkup(masked: string, text: string, inline: ReadonlyArray<readonly [number, number]>): string {
  if (!masked.includes('<')) return masked
  const found: Array<[number, number]> = []
  // Найденный конец каждого вида годится, пока поиск не ушёл дальше него: без этого каждый
  // незакрытый «<!--» искал бы «-->» до конца текста заново.
  const cached = INLINE_SPANS.map(() => ({ from: -1, at: -1 }))
  const closeAfter = (kind: number, from: number): number => {
    const c = cached[kind]
    if (c.from === -1 || from < c.from || (c.at !== -1 && from > c.at)) {
      c.from = from
      c.at = masked.indexOf(INLINE_SPANS[kind].close, from)
    }
    return c.at
  }
  const markupAt = (i: number): number => {
    INLINE_TAG.lastIndex = i
    const tag = INLINE_TAG.exec(masked)
    if (tag) return tag[0].length
    const kind = INLINE_SPANS.findIndex((s) => masked.startsWith(s.open, i))
    if (kind === -1) return 0
    const { open, close } = INLINE_SPANS[kind]
    // «<!» — объявление, только если дальше буква; «<!-->» и «<!--->» — тоже комментарии.
    if (open === '<!' && !/[A-Za-z]/.test(masked[i + 2] ?? '')) return 0
    const at = closeAfter(kind, open === '<!--' ? i + 2 : i + open.length)
    return at === -1 ? 0 : at + close.length - i
  }
  for (const [start, end] of inline) {
    for (let i = masked.indexOf('<', start); i !== -1 && i < end; ) {
      const len = slashesBefore(text, i) % 2 === 0 ? markupAt(i) : 0
      if (len > 0 && i + len <= end) {
        found.push([i, i + len])
        i = masked.indexOf('<', i + len)
      } else {
        i = masked.indexOf('<', i + 1)
      }
    }
  }
  return maskRanges(masked, found)
}

// ASCII-пунктуация: её экранирует «\» (CommonMark).
const ESCAPABLE = /[!-/:-@[-`{-~]/
const CHAR_REF = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/y

/**
 * Именованные сущности, которые встречаются в заметках. Полная таблица HTML (2000+ имён) здесь не нужна:
 * редкая сущность в цели вики-ссылки останется как есть, просмотр её раскроет — расхождение принято.
 */
const NAMED_REFS: ReadonlyMap<string, string> = new Map([
  ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"], ['nbsp', '\u00a0'],
  ['hellip', '…'], ['mdash', '—'], ['ndash', '–'], ['minus', '−'], ['laquo', '«'], ['raquo', '»'],
  ['ldquo', '“'], ['rdquo', '”'], ['bdquo', '„'], ['lsquo', '‘'], ['rsquo', '’'], ['copy', '©'],
  ['reg', '®'], ['trade', '™'], ['deg', '°'], ['times', '×'], ['divide', '÷'], ['plusmn', '±'],
  ['middot', '·'], ['bull', '•'], ['sect', '§'], ['para', '¶'], ['numero', '№'], ['euro', '€'],
  ['pound', '£'], ['yen', '¥'], ['cent', '¢'], ['larr', '←'], ['rarr', '→'], ['uarr', '↑'],
  ['darr', '↓'], ['harr', '↔'], ['frac12', '½'], ['frac14', '¼'], ['frac34', '¾'], ['shy', '\u00ad'],
  ['ensp', '\u2002'], ['emsp', '\u2003'], ['thinsp', '\u2009'], ['zwnj', '\u200c'], ['zwj', '\u200d'],
])

/** Числовая сущность по правилам micromark: недопустимые коды → U+FFFD. */
function numericRef(code: number): string {
  if (
    code < 9 ||
    code === 11 ||
    (code > 13 && code < 32) ||
    (code > 126 && code < 160) ||
    (code > 55_295 && code < 57_344) ||
    (code > 64_975 && code < 65_008) ||
    (code & 65_535) === 65_535 ||
    (code & 65_535) === 65_534 ||
    code > 1_114_111
  ) {
    return '\uFFFD'
  }
  return String.fromCodePoint(code)
}

interface InlineText {
  text: string
  /** Начало символа text[i] в исходнике. */
  from(i: number): number
  /** Конец символа text[i] в исходнике (не включая). */
  to(i: number): number
}

/** Текст так, как его видит строчный разбор Markdown: «\#» → «#», «&amp;» → «&»; позиции ведут в исходник. */
function decodeInline(src: string): InlineText {
  if (!src.includes('\\') && !src.includes('&')) return { text: src, from: (i) => i, to: (i) => i + 1 }
  const parts: string[] = []
  const from: number[] = []
  const to: number[] = []
  const put = (s: string, a: number, b: number) => {
    parts.push(s)
    for (let k = 0; k < s.length; k++) {
      from.push(a)
      to.push(b)
    }
  }
  for (let i = 0; i < src.length; ) {
    const c = src[i]
    if (c === '\\' && i + 1 < src.length && ESCAPABLE.test(src[i + 1])) {
      put(src[i + 1], i, i + 2)
      i += 2
      continue
    }
    if (c === '&') {
      CHAR_REF.lastIndex = i
      const m = CHAR_REF.exec(src)
      const value = !m
        ? undefined
        : m[1]
          ? numericRef(+m[1])
          : m[2]
            ? numericRef(parseInt(m[2], 16))
            : NAMED_REFS.get(m[3])
      if (m && value !== undefined) {
        put(value, i, i + m[0].length)
        i += m[0].length
        continue
      }
    }
    put(c, i, i + 1)
    i++
  }
  return { text: parts.join(''), from: (i) => from[i], to: (i) => to[i] }
}

// ───────────────────────── что ссылкой не становится ─────────────────────────

// Адрес непустой и начинается не с пробела: иначе пробелы делили бы между собой три \s и проверка
// длинного ряда пробелов стала бы квадратичной.
const INLINE_LINK_TAIL =
  /\(\s*(?:(?:<[^<>\n]*>|(?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))+)(?:\s+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\)))?\s*)?\)/y
const REFERENCE_TAIL = /\[((?:[^[\]\\]|\\.)+)\]/y

/** После «]» начинается адрес «(…)» или метка определённой ссылки «[…]». */
function linkTailAt(masked: string, at: number, defs: ReadonlySet<string>): boolean {
  if (masked[at] === '(') {
    INLINE_LINK_TAIL.lastIndex = at
    return INLINE_LINK_TAIL.test(masked)
  }
  if (masked[at] === '[' && defs.size > 0) {
    REFERENCE_TAIL.lastIndex = at
    const m = REFERENCE_TAIL.exec(masked)
    return !!m && defs.has(normalizeLabel(m[1]))
  }
  return false
}

/**
 * Тексты обычных ссылок [текст](адрес) и [текст][метка]: [начало «[», позиция «]»], по возрастанию начала.
 * «]» закрывает ближайшую незакрытую «[» того же абзаца; скобки в коде (маска) и экранированные не считаются.
 */
function linkTextSpans(
  text: string,
  masked: string,
  inline: ReadonlyArray<readonly [number, number]>,
  defs: ReadonlySet<string>,
): { spans: Array<[number, number]>; dests: Array<[number, number, number]> } {
  const spans: Array<[number, number]> = []
  const dests: Array<[number, number, number]> = []
  for (const [start, end] of inline) {
    const open: number[] = []
    for (let k = start; k < end; k++) {
      const c = masked[k]
      if ((c !== '[' && c !== ']') || slashesBefore(text, k) % 2 === 1) continue
      if (c === '[') open.push(k)
      else {
        const from = open.pop()
        if (from !== undefined && linkTailAt(masked, k + 1, defs)) {
          spans.push([from, k])
          // Адрес «(…)» — назначение ссылки, а не текст: автоссылкой он не становится.
          if (masked[k + 1] === '(') dests.push([k + 1, INLINE_LINK_TAIL.lastIndex, from])
        }
      }
    }
  }
  spans.sort((a, b) => a[0] - b[0])
  dests.sort((a, b) => a[0] - b[0])
  return { spans, dests }
}

// Автоссылки GFM — по правилам remark-gfm (mdast-util-gfm-autolink-literal и micromark): что просмотр
// превратит в обычную ссылку, вики-ссылкой не будет.
// Только начало и домен: путь адреса считает urlEnd, а жадный путь в выражении делал бы поиск квадратичным.
const URL_LITERAL = /(?<![\da-z])(https?:\/\/|www(?=\.))([\w-]*\.[\w\-.]*)/gi
const EMAIL_LITERAL = /(?<![\w+\-.])([\w+\-.]+)@([\w-]+(?:\.[\w-]+)+)/g
const PUNCTUATION = /[\p{P}\p{S}]/u

function isCorrectDomain(domain: string): boolean {
  const parts = domain.split('.')
  const bad = (p: string | undefined) => !!p && (p.includes('_') || !/[\dA-Za-z]/.test(p))
  return parts.length >= 2 && !bad(parts[parts.length - 1]) && !bad(parts[parts.length - 2])
}

/** Адрес из URL_LITERAL годится: перед ним начало, пробел или знак; домен правильный. */
function isUrlLiteral(m: RegExpMatchArray, before: string | undefined): boolean {
  if (before !== undefined && !/\s/.test(before) && !PUNCTUATION.test(before)) return false
  const domain = /^w/i.test(m[1]) ? m[1] + m[2] : m[2]
  return !PUNCTUATION.test(domain[0]) && isCorrectDomain(domain)
}

/** Автоссылка (адрес, www., почта) внутри [[…]]: просмотр делает из неё обычную ссылку. */
function hasAutolinkLiteral(inner: string): boolean {
  // Перед содержимым стоит «[» — знак препинания, поэтому начало строки тоже подходит.
  for (const m of inner.matchAll(URL_LITERAL)) if (isUrlLiteral(m, inner[m.index - 1])) return true
  for (const m of inner.matchAll(EMAIL_LITERAL)) if (!/[\d\-_]$/.test(m[2])) return true
  return false
}

const TRAIL_CHARS = new Set('!"\')*,.:;?_~')

/** Знаки с позиции i — «хвост» адреса (в адрес не входят): дальше конец, пробел, «<» или «](» / «][». */
function isUrlTrail(s: string, i: number): boolean {
  for (let k = i; ; ) {
    const c = s[k]
    if (c === undefined || /\s/.test(c) || c === '<') return true
    if (TRAIL_CHARS.has(c)) {
      k++
    } else if (c === '&') {
      let e = k + 1
      while (/[A-Za-z]/.test(s[e] ?? '')) e++
      if (e === k + 1 || s[e] !== ';') return false
      k = e + 1
    } else if (c === ']') {
      k++
      const next = s[k]
      if (next === undefined || next === '(' || next === '[' || /\s/.test(next)) return true
    } else {
      return false
    }
  }
}

/** Конец адреса по разбору micromark: скобки, «хвостовые» знаки, «]» перед «(» или «[». */
function urlEnd(s: string, from: number): number {
  let open = 0
  let close = 0
  for (let i = from; i < s.length; i++) {
    const c = s[i]
    if (/\s/.test(c)) return i
    if (c === '(') open++
    else if (c === ')' && close < open) close++
    else if (TRAIL_CHARS.has(c) || c === '&' || c === '<' || c === ']') {
      if (isUrlTrail(s, i)) return i
      if (c === ')') close++
    }
  }
  return s.length
}

/**
 * Адреса-автоссылки строчного текста [начало, конец), по возрастанию, за один проход. Адрес тянется
 * до пробела и забирает [[…]] в себя. Конец ищет micromark («]» перед «[» или «(» адрес обрывает), но
 * после незакрытой «[» в строке он адрес не распознаёт, и тогда адрес до пробела берёт remark-gfm.
 */
function urlSpans(view: InlineText, dests: ReadonlyArray<readonly [number, number, number]>): Array<[number, number]> {
  const s = view.text
  const spans: Array<[number, number]> = []
  if (!/https?:\/\/|www\./i.test(s)) return spans
  const re = new RegExp(URL_LITERAL.source, 'gi')
  let depth = 0
  let scanned = 0
  let dest = 0
  // «[» ссылки внутри уже найденного адреса — часть адреса: такой ссылки нет, её «(…)» — обычный текст.
  const inUrl = (pos: number): boolean => {
    let i = spans.length - 1
    while (i >= 0 && view.from(spans[i][0]) > pos) i--
    return i >= 0 && (spans[i][1] >= s.length || pos < view.from(spans[i][1]))
  }
  const inLinkDest = (src: number): boolean => {
    while (dest < dests.length && dests[dest][1] <= src) dest++
    for (let d = dest; d < dests.length && dests[d][0] <= src; d++) {
      if (src < dests[d][1] && !inUrl(dests[d][2])) return true
    }
    return false
  }
  for (let m = re.exec(s); m; m = re.exec(s)) {
    const start = m.index
    if (inLinkDest(view.from(start)) || !isUrlLiteral(m, start > 0 ? s[start - 1] : undefined)) {
      re.lastIndex = start + 1
      continue
    }
    for (; scanned < start; scanned++) {
      const c = s[scanned]
      if (c === '\n') depth = 0
      // Скобка из «\[» или «&#91;» — буквальная, ссылку не открывает.
      else if ((c === '[' || c === ']') && view.to(scanned) - view.from(scanned) === 1) {
        depth = c === '[' ? depth + 1 : Math.max(0, depth - 1)
      }
    }
    let end = start
    if (depth > 0) while (end < s.length && !/[\t\n\r ]/.test(s[end])) end++
    else end = urlEnd(s, start + m[1].length)
    spans.push([start, end])
    // Скобки внутри адреса — его часть, а не начала ссылок.
    scanned = Math.max(scanned, end)
    re.lastIndex = Math.max(end, start + 1)
  }
  return spans
}

/** Голая «|» в исходнике ячейки разрезает её — ссылки в таблице нет. */
function hasBarePipe(raw: string): boolean {
  for (let i = raw.indexOf('|'); i !== -1; i = raw.indexOf('|', i + 1)) {
    if (slashesBefore(raw, i) % 2 === 0) return true
  }
  return false
}

/** Дешёвая предпроверка: в тексте может быть «[[» (в том числе экранированная или через &#91;). */
export function mayHaveWikiLinks(text: string): boolean {
  return text.includes('[[') || text.includes('\\[') || text.includes('&#')
}

export function parseWikiLinks(text: string): WikiLink[] {
  // «\[\[a]]» и «&#91;» в просмотре тоже дают «[[».
  if (!mayHaveWikiLinks(text)) return []

  const scan = scanCode(text)
  const masked = maskInlineMarkup(maskRanges(text, scan.ranges), text, scan.inline)
  const view = decodeInline(masked)
  if (!view.text.includes('[[')) return []
  const { spans, dests } = linkTextSpans(text, masked, scan.inline, scan.defs)
  const urls = urlSpans(view, dests)

  const links: WikiLink[] = []
  let row = 0
  let span = 0
  /** Наибольший конец текста ссылки среди тех, что начались до текущей [[…]]. */
  let spanClose = -1
  let url = 0
  for (const m of view.text.matchAll(WIKI_LINK)) {
    const link = parseWikiInner(m[1])
    if (!link) continue
    const viewEnd = m.index + m[0].length
    const start = view.from(m.index)
    const end = view.to(viewEnd - 1)
    const innerRaw = text.slice(view.to(m.index + 1), view.from(viewEnd - 2))

    while (row < scan.tableRows.length && scan.tableRows[row][1] < start) row++
    const inTable = row < scan.tableRows.length && scan.tableRows[row][0] <= start
    if (inTable && hasBarePipe(innerRaw)) continue
    // [[метка]] при определении «[метка]: адрес» — обычная ссылка; [[x]](адрес) — тоже.
    if (scan.defs.has(normalizeLabel(innerRaw)) || (view.to(m.index) - view.from(m.index) === 1 && linkTailAt(masked, end, scan.defs))) continue
    for (; span < spans.length && spans[span][0] < start; span++) spanClose = Math.max(spanClose, spans[span][1])
    if (end <= spanClose) continue
    while (url < urls.length && urls[url][1] <= m.index) url++
    if (url < urls.length && urls[url][0] < m.index) continue
    if (hasAutolinkLiteral(m[1])) continue

    const found: WikiLink = { raw: text.slice(start, end), target: link.target, label: link.label, start, end }
    if (inTable) found.inTable = true
    links.push(found)
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

/**
 * Заголовок взят из строки с [[…]] — это ссылка на другую запись, а не имя этой: displayTitle снимает
 * скобки, и индексная заметка «- [[Проект А]]» перехватила бы цель у самой записи «Проект А».
 */
function titleIsWikiLink(item: Item): boolean {
  if (item.title?.trim() || item.linkMeta?.title?.trim() || item.fileName?.trim()) return false
  if (item.type === 'code' || typeof item.content !== 'string' || !item.content.includes('[[')) return false
  const line = derivedTitleLine(item)
  // derivedTitleLine режет по '\n' и отбрасывает '\r' — номер строки совпадает с split('\n').
  // Синтаксис ищется без учёта кода: stripMarkdown снимает скобки и в строке кода с отступом.
  return line !== null && findWikiSyntax(item.content.split('\n')[line.index] ?? '').length > 0
}

export function buildTitleIndex(items: readonly Item[]): Map<string, Item> {
  const index = new Map<string, Item>()
  for (const item of items) {
    if (item.deletedAt !== undefined) continue
    if (titleIsWikiLink(item)) continue
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
