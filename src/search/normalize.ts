/**
 * Нормализация текста для поиска: единые правила для индекса, запроса, фраз и подсветки.
 * NFKC → нижний регистр → ё=е.
 */
import { foldText, normalizeTag } from '@/lib/normalize'

/** Сворачивает строку к поисковой форме. Идемпотентна. */
export const fold: (s: string) => string = foldText

/** fold + схлопывание пробельных символов — для сравнения подстрок (фразы, имена категорий). */
export function foldCollapse(s: string): string {
  return fold(s).replace(/\s+/g, ' ').trim()
}

/**
 * Слово — непрерывная последовательность букв/цифр (с диакритикой).
 * Всё остальное (пробелы, пунктуация, `/:.?=_-` в URL и коде) — разделители.
 */
export const WORD_RE = /[\p{L}\p{N}\p{M}]+/gu

/** Разбивает текст на слова. Работает одинаково для кириллицы, URL и кода. */
export function tokenize(text: string): string[] {
  return text.match(WORD_RE) ?? []
}

/**
 * Части идентификатора: camelCase, PascalCase, аббревиатуры (XMLHttp → XML, Http),
 * границы буква/цифра (es2023 → es, 2023). Слова без смены регистра дают одну часть.
 */
export const CAMEL_RE = /\p{Lu}+(?=\p{Lu}\p{Ll})|\p{Lu}?\p{Ll}+|\p{Lu}+|\p{N}+|[\p{L}\p{M}]+/gu

export function splitCamel(word: string): string[] {
  return word.match(CAMEL_RE) ?? []
}

/** Термин запроса: только нормализация, без разбиения camelCase (см. indexTerms). */
export function queryTerm(token: string): string | null {
  const t = fold(token)
  return t ? t : null
}

/**
 * Термины для индекса. Для составных идентификаторов, кроме целого слова, индексируем части
 * и «хвосты» (useLiveQuery → uselivequery, use, live, query, livequery), чтобы находились
 * и «query», и «LiveQuery», а запрос при этом не приходилось разбивать по регистру
 * (иначе «iPhone» в запросе не нашёл бы «iphone» в тексте).
 */
export function indexTerms(token: string): string | string[] | null {
  const n = token.normalize('NFKC')
  const whole = fold(n)
  if (!whole) return null
  const parts = splitCamel(n)
  if (parts.length <= 1) return whole
  const out = new Set<string>([whole])
  for (const p of parts) out.add(fold(p))
  for (let i = 1; i < parts.length - 1; i++) out.add(fold(parts.slice(i).join('')))
  return [...out]
}

/** Слова строки в поисковой форме (для terms в результатах). */
export function queryWords(text: string): string[] {
  const out: string[] = []
  for (const tok of tokenize(text)) {
    const t = queryTerm(tok)
    if (t) out.push(t)
  }
  return out
}

/** Та же нормализация тега, что и в репозитории (единая реализация в lib/normalize). */
export const normalizeTagValue: (raw: string) => string = normalizeTag
