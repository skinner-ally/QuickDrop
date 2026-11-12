/**
 * Текст без разметки Markdown — для сниппетов в списках. Не разбор Markdown, а снятие маркеров
 * по строкам: всё, что не похоже на разметку, остаётся как было.
 */

/** Есть ли в тексте хоть что-то похожее на разметку (быстрый выход для обычного текста). */
const MAYBE_MARKDOWN_RE = /[`*_~[\]#>]|^[ \t]*(?:[-+]|\d{1,3}\.)[ \t]/m

// После ``` в строке не может быть обратных кавычек: «```код```» — инлайн-код, а не ограда.
const FENCE_RE = /^[ \t]{0,3}(`{3,}(?=[^`]*$)|~{3,})/
const FENCE_CLOSE_RE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*\r?$/
const QUOTE_RE = /^[ \t]{0,3}(?:>[ \t]?)+/
// После решёток обязателен пробел: «#тег» в начале строки — не заголовок.
const HEADING_RE = /^[ \t]{0,3}#{1,6}[ \t]+/
const LIST_RE = /^([ \t]*)(?:[-*+]|\d{1,3}\.)[ \t]+(?:\[[ xX]\][ \t]+)?/

/** Строка длиннее — не проза (лог, минифицированный код): парные маркеры в ней не ищем. */
const MAX_INLINE_LINE = 5000

/** Символы-метки для временно убранных фрагментов; берётся первый, которого нет в тексте. */
const MARKS = ['\u0000', '\uE000', '\uF8FF']

const CODE_SPAN_RE = /(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)/g
const WIKI_RE = /\[\[([^[\]\n|]+)(?:\|([^[\]\n]*))?\]\]/g
// Адрес ссылки: без пробелов, допускается один уровень скобок и необязательный заголовок в кавычках.
const LINK_RE = /!?\[([^\]\n]*)\]\((?:[^()\s]|\([^()\s]*\))*(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'))?\)/g
// Хвостовые маркеры и пунктуация в адрес не входят: «*https://a.b*» — курсив вокруг адреса.
const URL_RE = /(?:https?|ftp):\/\/[^\s<>]*[^\s<>*_~.,;:!?'")\]]/gi

// Маркер должен прилегать к непробельному символу: «2 * 3 * 4» и одиночные * остаются.
const BOLD_STAR_RE = /\*\*(?=\S)(.*?\S)\*\*/g
const STRIKE_RE = /~~(?=\S)(.*?\S)~~/g
const ITALIC_STAR_RE = /(?<!\*)\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/g
// Подчёркивание — только на границе слова: snake_case_name и a_b не разметка.
const BOLD_US_RE = /(?<![\p{L}\p{N}_])__(?=\S)(.*?\S)__(?![\p{L}\p{N}_])/gu
const ITALIC_US_RE = /(?<![\p{L}\p{N}_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![\p{L}\p{N}_])/gu

function stripInline(line: string, mark: string | undefined): string {
  if (line.length > MAX_INLINE_LINE) return line

  // Содержимое инлайн-кода и адреса убираем на время: внутри них * и _ — не разметка.
  const kept: string[] = []
  const stash = (s: string) => (mark === undefined ? s : `${mark}${kept.push(s) - 1}${mark}`)

  let s = line.replace(CODE_SPAN_RE, (_m, _ticks: string, inner: string) => stash(inner))
  s = s.replace(WIKI_RE, (_m, target: string, label?: string) => label?.trim() || target.trim())
  // Дважды: картинка внутри ссылки — [![alt](img)](url).
  s = s.replace(LINK_RE, '$1').replace(LINK_RE, '$1')
  if (mark !== undefined) s = s.replace(URL_RE, stash)

  s = s
    .replace(BOLD_STAR_RE, '$1')
    .replace(BOLD_US_RE, '$1')
    .replace(STRIKE_RE, '$1')
    .replace(ITALIC_STAR_RE, '$1')
    .replace(ITALIC_US_RE, '$1')

  if (kept.length === 0 || mark === undefined) return s
  const restore = (text: string): string =>
    text.replace(new RegExp(`${mark}(\\d+)${mark}`, 'g'), (m, i: string) => kept[+i] ?? m)
  // Дважды: адрес мог захватить метку уже убранного инлайн-кода.
  return restore(restore(s))
}

/** Текст без разметки Markdown — для сниппетов. Обычный текст не портит. */
export function stripMarkdown(md: string): string {
  if (!md || !MAYBE_MARKDOWN_RE.test(md)) return md ?? ''

  const mark = MARKS.find((c) => !md.includes(c))
  const out: string[] = []
  /** Открытая ограда блока кода: её символ и длина. */
  let fence: { ch: string; len: number } | null = null

  for (const line of md.split('\n')) {
    if (fence) {
      const close = FENCE_CLOSE_RE.exec(line)
      if (close && close[1][0] === fence.ch && close[1].length >= fence.len) fence = null
      // Содержимое блока кода остаётся как есть.
      else out.push(line)
      continue
    }
    const open = FENCE_RE.exec(line)
    if (open) {
      fence = { ch: open[1][0], len: open[1].length }
      continue
    }
    const body = line.replace(QUOTE_RE, '')
    const heading = body.replace(HEADING_RE, '')
    out.push(stripInline(heading !== body ? heading : body.replace(LIST_RE, '$1'), mark))
  }
  return out.join('\n')
}
