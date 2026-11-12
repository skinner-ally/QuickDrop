import {
  MAX_DATE_YEAR,
  MIN_DATE_YEAR,
  RELATIVE_PERIODS,
  formatDateToken,
  relativeRange,
} from '@/lib/dates'
import { categoryNameKey, normalizeTag } from '@/lib/normalize'
import { ITEM_STATUSES, ITEM_TYPES } from '@/types'
import type { Category, ItemFilter } from '@/types'
import { OPERATOR_KEYS, QUOTES, lex, parseQuery, withoutTypeOperators } from './query'
import { fold } from './normalize'

export interface SerializeOptions {
  /**
   * Как записать пару from/to, точно равную периоду относительно now: true (по умолчанию) —
   * периодом (date:week), false — датами. Свой диапазон из календаря, совпавший с границами
   * «сегодня» или «за неделю», нельзя отличить от быстрого периода по самим датам — вызывающий,
   * который знает, что период выбран не быстрой кнопкой, передаёт false.
   */
  relativeDates?: boolean
}

/** Пары кавычек для значений операторов, в порядке предпочтения. */
const QUOTE_PAIRS: ReadonlyArray<readonly [open: string, close: string]> = [
  ['"', '"'],
  ['«', '»'],
  ['“', '”'],
]
const ANY_QUOTE_RE = /["«»“”„]/

/** Значение в первой паре кавычек, которую оно само не закроет раньше времени; null — таких нет. */
function quote(value: string): string | null {
  for (const [open, close] of QUOTE_PAIRS) {
    const closers = QUOTES.get(open) ?? [close]
    if (!closers.some((c) => value.includes(c))) return open + value + close
  }
  return null
}

/** Псевдоимена «без категории» (те же, что понимает resolveCategoryName), в порядке предпочтения. */
const NO_CATEGORY_ALIASES = ['none', 'нет', 'без', 'без категории']

function categoryPart(categoryId: string | null | undefined, categories: readonly Category[]): string | null {
  if (categoryId === undefined) return null
  if (categoryId === null) {
    // Категория с именем «none» перехватила бы cat:none — берём первое незанятое псевдоимя.
    const taken = new Set(categories.map((c) => categoryNameKey(c.name)))
    const alias = NO_CATEGORY_ALIASES.find((a) => !taken.has(a))
    if (alias === undefined) return null
    return `cat:${alias.includes(' ') ? `"${alias}"` : alias}`
  }
  const name = categories
    .find((c) => c.id === categoryId)
    ?.name.replace(/\s+/g, ' ')
    .trim()
  if (!name) return null
  if (!/[\s,]/.test(name) && !ANY_QUOTE_RE.test(name)) return `cat:${name}`
  const quoted = quote(name)
  return quoted === null ? null : `cat:${quoted}`
}

/**
 * Граница диапазона как дата запроса. Годы вне допустимых parseQuery не разобрал бы (оператор
 * стал бы текстом), поэтому граница за пределами либо опускается, либо прижимается к краю.
 */
function boundToken(ts: number, kind: 'from' | 'to'): string | null {
  const year = new Date(ts).getFullYear()
  if (Number.isNaN(year)) return null
  if (year < MIN_DATE_YEAR) return kind === 'from' ? null : `${MIN_DATE_YEAR}-01-01`
  if (year > MAX_DATE_YEAR) return kind === 'to' ? null : `${MAX_DATE_YEAR}-12-31`
  return formatDateToken(ts)
}

function dateParts(from: number | undefined, to: number | undefined, now: number, relative: boolean): string[] {
  const hasFrom = typeof from === 'number' && Number.isFinite(from)
  const hasTo = typeof to === 'number' && Number.isFinite(to)
  const a = hasFrom ? boundToken(from, 'from') : null
  const b = hasTo ? boundToken(to, 'to') : null

  if (hasFrom && hasTo) {
    // Относительный период остаётся относительным: сохранённый поиск «за неделю» не привязан к датам.
    if (relative && Number.isFinite(now)) {
      for (const period of RELATIVE_PERIODS) {
        const r = relativeRange(period, now)
        if (r.from === from && r.to === to) return [`date:${period}`]
      }
    }
    // from > to (ничего не найдётся) диапазоном не записать: A..B с A > B — неверная дата.
    if (from <= to && a !== null && b !== null) return [a === b ? `date:${a}` : `date:${a}..${b}`]
  }

  const parts: string[] = []
  if (a !== null) parts.push(`after:${a}`)
  if (b !== null) parts.push(`before:${b}`)
  return parts
}

/**
 * Строка операторов, обратная parseQuery + resolveQueryFilter. Порядок частей: статус, избранное,
 * без тегов, корзина, типы, категория, теги, даты. Точность дат — сутки. Категория, которой нет
 * в categories, пропускается. now — «сейчас» для распознавания относительных периодов.
 */
export function serializeFilter(
  filter: ItemFilter,
  categories: readonly Category[],
  now: number = Date.now(),
  options: SerializeOptions = {},
): string {
  const parts: string[] = []

  const statuses = filter.status === undefined ? [] : Array.isArray(filter.status) ? filter.status : [filter.status]
  for (const status of new Set(statuses)) if (ITEM_STATUSES.includes(status)) parts.push(`is:${status}`)

  if (filter.favorite === true) parts.push('is:fav')
  if (filter.untagged === true) parts.push('is:untagged')
  if (filter.trashed === true) parts.push('is:trash')

  const types = [...new Set(filter.types ?? [])].filter((t) => ITEM_TYPES.includes(t))
  if (types.length > 0) parts.push(`type:${types.join(',')}`)

  const category = categoryPart(filter.categoryId, categories)
  if (category !== null) parts.push(category)

  const tags = new Set<string>()
  for (const raw of filter.tags ?? []) {
    const tag = normalizeTag(raw)
    if (!tag || tags.has(tag)) continue
    tags.add(tag)
    // Без кавычек parseQuery срезал бы хвостовую пунктуацию, а кавычку принял бы за начало фразы.
    if (/[.,;:!?)]$/.test(tag) || ANY_QUOTE_RE.test(tag)) {
      const quoted = quote(tag)
      if (quoted !== null) parts.push(`#${quoted}`)
    } else {
      parts.push(`#${tag}`)
    }
  }

  parts.push(...dateParts(filter.from, filter.to, now, options?.relativeDates !== false))
  return parts.join(' ')
}

/**
 * Запрос целиком для сохранённого поиска: операторы фильтра + строка поиска.
 * Типы на экране пересекаются (фильтр и type:/has: строки поиска), а parseQuery объединяет все
 * типы строки в «любой из», поэтому при типах с обеих сторон пишется одно пересечение. Пустое
 * пересечение (на экране — ничего) записать нечем: побеждают типы строки поиска, как и cat:.
 */
export function composeQuery(
  query: string,
  filter: ItemFilter,
  categories: readonly Category[],
  now?: number,
  options?: SerializeOptions,
): string {
  let text = (query ?? '').trim()
  let ownFilter = filter
  const own = [...new Set(filter.types ?? [])].filter((t) => ITEM_TYPES.includes(t))
  if (own.length > 0 && text) {
    const fromQuery = parseQuery(text, now).filter.types ?? []
    if (fromQuery.length > 0) {
      const both = own.filter((t) => fromQuery.includes(t))
      if (both.length > 0) {
        ownFilter = { ...filter, types: both }
        text = withoutTypeOperators(text)
      } else {
        ownFilter = { ...filter, types: undefined }
      }
    }
  }
  return [serializeFilter(ownFilter, categories, now, options), text].filter(Boolean).join(' ')
}

export interface QueryRename {
  /** Тег переименован: from — нормализованный старый, to — новый. */
  tag?: { from: string; to: string }
  /** Категория переименована: fromKey — categoryNameKey старого имени, to — новое имя. */
  category?: { fromKey: string; to: string }
}

/**
 * Переписывает в строке запроса операторы tag:/#/cat:, указывающие на переименованный тег или категорию.
 * Остальной текст (слова, фразы, прочие операторы) остаётся байт в байт. Не удалось безопасно записать
 * новое значение (кавычки) — токен не трогается.
 */
export function renameQueryOperators(raw: string, rename: QueryRename): string {
  const source = raw ?? ''
  let out = ''
  let last = 0
  const replace = (start: number, end: number, text: string) => {
    out += source.slice(last, start) + text
    last = end
  }
  const tagText = (tag: string): string | null => {
    if (/[.,;:!?)]$/.test(tag) || ANY_QUOTE_RE.test(tag)) return quote(tag)
    return tag
  }
  for (const tok of lex(source)) {
    if (tok.kind !== 'word') continue
    const { value, quoted } = tok
    if (value.startsWith('#')) {
      const tg = rename.tag
      if (!tg) continue
      const body = quoted ? value.slice(1) : value.slice(1).replace(/[.,;:!?)]+$/u, '')
      if (normalizeTag(body) !== tg.from) continue
      const text = tagText(tg.to)
      if (text !== null) replace(tok.start, tok.end, `#${text}${quoted ? '' : value.slice(1 + body.length)}`)
      continue
    }
    const m = /^(\p{L}+):(.*)$/su.exec(value)
    if (!m) continue
    const op = OPERATOR_KEYS.get(fold(m[1]))
    const arg = m[2].trim()
    if (!arg) continue
    if (op === 'cat' && rename.category) {
      if (categoryNameKey(arg.replace(/\s+/g, ' ')) !== rename.category.fromKey) continue
      const name = rename.category.to.replace(/\s+/g, ' ').trim()
      const text = !/[\s,]/.test(name) && !ANY_QUOTE_RE.test(name) ? name : quote(name)
      if (text !== null) replace(tok.start, tok.end, `${m[1]}:${text}`)
    } else if (op === 'tag' && rename.tag) {
      const tg = rename.tag
      const values = quoted ? [arg] : arg.split(',').map((v) => v.trim()).filter(Boolean)
      let changed = false
      let failed = false
      const next = values.map((v) => {
        const core = quoted ? v : v.replace(/[.,;:!?)]+$/u, '')
        if (normalizeTag(core) !== tg.from) return v
        const text = tagText(tg.to)
        if (text === null) {
          failed = true
          return v
        }
        changed = true
        return quoted ? text : text + v.slice(core.length)
      })
      if (!changed || failed) continue
      // Тег, которому нужны кавычки, нельзя оставить в списке через запятую.
      if (!quoted && next.length > 1 && next.some((v) => /["«»“”„]/.test(v))) continue
      replace(tok.start, tok.end, `${m[1]}:${next.join(',')}`)
    }
  }
  return out + source.slice(last)
}
