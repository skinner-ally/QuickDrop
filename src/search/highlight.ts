import type { Item } from '@/types'
import { CAMEL_RE, WORD_RE, fold } from './normalize'

export type HighlightPart = { text: string; hit: boolean }

/** Буква + следующие за ней комбинируемые знаки (NFD «й», «ё» с macOS) — единица нормализации. */
const CLUSTER_RE = /\P{M}\p{M}*|\p{M}+/gu

/**
 * Нормализованная копия текста с картой позиций обратно в исходный текст:
 * сравнение идёт по fold-форме, а фрагменты режутся по оригиналу (NFKC и lower-case
 * могут менять длину строки, поэтому простое совпадение индексов не годится).
 */
function buildNormMap(text: string) {
  let norm = ''
  const origToNorm = new Array<number>(text.length + 1)
  const normEndToOrig: number[] = [0]
  for (const m of text.matchAll(CLUSTER_RE)) {
    const s = m.index
    const e = s + m[0].length
    const ns = norm.length
    norm += fold(m[0])
    for (let i = s; i < e; i++) origToNorm[i] = ns
    for (let k = ns + 1; k <= norm.length; k++) normEndToOrig[k] = e
  }
  origToNorm[text.length] = norm.length
  return { norm, origToNorm, normEndToOrig }
}

/** Позиции, с которых может начинаться совпадение: начала слов и частей camelCase. */
function boundaries(text: string): number[] {
  const out: number[] = []
  for (const w of text.matchAll(WORD_RE)) {
    for (const p of w[0].matchAll(CAMEL_RE)) out.push(w.index + p.index)
  }
  return out
}

function prepareTerms(terms: string[]): string[] {
  const set = new Set<string>()
  for (const t of terms) {
    const f = fold(t ?? '').trim()
    if (f) set.add(f)
  }
  // Длинные первыми: в одной позиции побеждает самое полное совпадение.
  return [...set].sort((a, b) => b.length - a.length)
}

/** Диапазоны [start, end) совпадений в исходном тексте, по возрастанию, без пересечений. */
function findHits(text: string, terms: string[]): Array<[number, number]> {
  const { norm, origToNorm, normEndToOrig } = buildNormMap(text)
  const hits: Array<[number, number]> = []
  let lastEnd = 0
  for (const b of boundaries(text)) {
    if (b < lastEnd) continue
    const nb = origToNorm[b]
    for (const t of terms) {
      if (norm.startsWith(t, nb)) {
        const e = normEndToOrig[nb + t.length] ?? text.length
        hits.push([b, e])
        lastEnd = e
        break
      }
    }
  }
  return hits
}

/**
 * Разбивает текст на фрагменты для подсветки. Совпадение — термин как префикс слова
 * (или части camelCase), без учёта регистра, ё=е. Склейка фрагментов даёт исходный текст.
 */
export function highlight(text: string, terms: string[]): HighlightPart[] {
  if (!text) return []
  const prepared = prepareTerms(terms)
  if (prepared.length === 0) return [{ text, hit: false }]

  const parts: HighlightPart[] = []
  const push = (s: string, hit: boolean) => {
    if (!s) return
    const last = parts[parts.length - 1]
    if (last && last.hit === hit) last.text += s
    else parts.push({ text: s, hit })
  }
  let pos = 0
  for (const [s, e] of findHits(text, prepared)) {
    push(text.slice(pos, s), false)
    push(text.slice(s, e), true)
    pos = e
  }
  push(text.slice(pos), false)
  return parts
}

const ELLIPSIS = '…'
const collapse = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

/** Начало текста, обрезанное по границе слова. */
function cutStart(src: string, maxLen: number): string {
  if (src.length <= maxLen) return src
  const budget = Math.max(1, maxLen - 1)
  let to = budget
  const space = src.lastIndexOf(' ', budget)
  if (space > budget * 0.6) to = space
  return src.slice(0, to).trimEnd() + ELLIPSIS
}

/** Окно вокруг совпадения [start, end): примерно треть свободного места — контекст до него. */
function cutAround(src: string, start: number, end: number, maxLen: number): string {
  if (src.length <= maxLen) return src
  // Резервируем место под «…» с обеих сторон, чтобы итог не превышал maxLen.
  const budget = Math.max(1, maxLen - 2)
  const hitLen = Math.min(end - start, budget)
  let from = Math.max(0, start - Math.floor((budget - hitLen) / 3))
  let to = Math.min(src.length, from + budget)
  from = Math.max(0, to - budget)

  if (from > 0) {
    const space = src.indexOf(' ', from)
    if (space !== -1 && space < start) from = space + 1
  }
  if (to < src.length) {
    const space = src.lastIndexOf(' ', to)
    if (space >= start + hitLen) to = space
  }
  return (from > 0 ? ELLIPSIS : '') + src.slice(from, to).trim() + (to < src.length ? ELLIPSIS : '')
}

/**
 * Фрагмент для карточки: кусок content (или описания ссылки) вокруг первого совпадения;
 * без совпадений — начало content. Пробельные символы схлопнуты, длина ≤ maxLen.
 */
export function makeSnippet(item: Item, terms: string[], maxLen = 160): string {
  const sources = [collapse(item.content), collapse(item.linkMeta?.description)].filter(Boolean)
  if (sources.length === 0) return ''
  const prepared = prepareTerms(terms)
  if (prepared.length > 0) {
    for (const src of sources) {
      const first = findHits(src, prepared)[0]
      if (first) return cutAround(src, first[0], first[1], maxLen)
    }
  }
  return cutStart(sources[0], maxLen)
}
