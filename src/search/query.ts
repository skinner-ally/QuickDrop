import type { ItemFilter, ItemStatus, ItemType } from '@/types'
import { fold, normalizeTagValue } from './normalize'

export type ParsedQuery = {
  /** Свободный текст без операторов и фраз. */
  text: string
  /** «Точные фразы» из кавычек (пробелы схлопнуты, регистр исходный). */
  phrases: string[]
  filter: ItemFilter
  /** Имя категории из cat:… — в id его переводит searchItems по списку категорий. */
  categoryName?: string
}

/** Открывающая кавычка → допустимые закрывающие. */
const QUOTES = new Map<string, string[]>([
  ['"', ['"']],
  ['«', ['»']],
  ['“', ['”', '“']],
  ['„', ['“', '”']],
])

// Map, а не объект: ключи из пользовательского ввода не должны совпадать с constructor/toString.
const aliasMap = <T>(groups: Array<[T, string[]]>): Map<string, T> =>
  new Map(groups.flatMap(([value, names]) => names.map((n) => [n, value] as [string, T])))

const TYPE_ALIASES = aliasMap<ItemType>([
  ['text', ['text', 'txt', 'note', 'notes', 'текст', 'тексты', 'заметка', 'заметки']],
  ['link', ['link', 'links', 'url', 'ссылка', 'ссылки']],
  ['code', ['code', 'snippet', 'код']],
  ['idea', ['idea', 'ideas', 'идея', 'идеи']],
  ['file', ['file', 'files', 'файл', 'файлы']],
  ['image', [
    'image', 'images', 'img', 'picture', 'photo',
    'изображение', 'изображения', 'картинка', 'картинки', 'фото',
  ]],
])

type IsFlag = ItemStatus | 'favorite' | 'untagged'
const IS_ALIASES = aliasMap<IsFlag>([
  ['favorite', ['fav', 'favs', 'favorite', 'favourite', 'star', 'starred', 'избранное', 'избранные']],
  ['inbox', ['inbox', 'new', 'входящие', 'новые']],
  ['library', ['library', 'lib', 'база', 'библиотека']],
  ['archive', ['archive', 'archived', 'архив']],
  ['untagged', ['untagged', 'notags', 'без-тегов']],
])

const HAS_ALIASES = aliasMap<ItemType[]>([
  [['file', 'image'], ['file', 'files', 'attachment', 'файл', 'файлы', 'вложение']],
  [['image'], ['image', 'img', 'picture', 'photo', 'картинка', 'изображение', 'фото']],
  [['link'], ['link', 'url', 'ссылка']],
])

type OpKey = 'tag' | 'type' | 'is' | 'has' | 'cat'
const OP_KEYS = aliasMap<OpKey>([
  ['tag', ['tag', 'tags', 'тег']],
  ['type', ['type', 'тип']],
  ['is', ['is']],
  ['has', ['has']],
  ['cat', ['cat', 'category', 'кат', 'категория']],
])

type Token = { kind: 'phrase'; value: string } | { kind: 'word'; value: string; quoted: boolean }

/** Читает значение в кавычках с позиции открывающей кавычки. Незакрытая — до конца строки. */
function readQuoted(raw: string, pos: number): [value: string, next: number] {
  const closers = QUOTES.get(raw[pos]) ?? ['"']
  for (let k = pos + 1; k < raw.length; k++) {
    if (closers.includes(raw[k])) return [raw.slice(pos + 1, k), k + 1]
  }
  return [raw.slice(pos + 1), raw.length]
}

const OP_QUOTED_RE = /^(#|\p{L}+:)(?=["«“„])/u

function lex(raw: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (QUOTES.has(ch)) {
      const [value, next] = readQuoted(raw, i)
      tokens.push({ kind: 'phrase', value })
      i = next
      continue
    }
    // cat:"мои проекты", #"мой тег" — значение оператора в кавычках может содержать пробелы.
    const m = OP_QUOTED_RE.exec(raw.slice(i, i + 64))
    if (m) {
      const [value, next] = readQuoted(raw, i + m[1].length)
      tokens.push({ kind: 'word', value: m[1] + value, quoted: true })
      i = next
      continue
    }
    let j = i
    while (j < raw.length && !/\s/.test(raw[j])) j++
    tokens.push({ kind: 'word', value: raw.slice(i, j), quoted: false })
    i = j
  }
  return tokens
}

/** Хвостовая пунктуация у тега без кавычек: «#react,» → react. */
const stripTrailingPunct = (s: string) => s.replace(/[.,;:!?)]+$/u, '')

const pushUnique = <T>(arr: T[], v: T) => {
  if (!arr.includes(v)) arr.push(v)
}

/**
 * Разбор строки поиска. Операторы: tag:x, #x, type:…, is:…, has:file, cat:имя / cat:"имя с пробелами".
 * Значения можно перечислять через запятую (type:link,code). Неизвестные операторы и значения
 * остаются свободным текстом; оператор без значения («tag:» в процессе набора) игнорируется.
 */
export function parseQuery(raw: string): ParsedQuery {
  const words: string[] = []
  const phrases: string[] = []
  const tags: string[] = []
  const types: ItemType[] = []
  const statuses: ItemStatus[] = []
  let favorite = false
  let untagged = false
  let categoryName: string | undefined

  for (const tok of lex(raw ?? '')) {
    if (tok.kind === 'phrase') {
      const p = tok.value.replace(/\s+/g, ' ').trim()
      if (p) phrases.push(p)
      continue
    }

    const { value, quoted } = tok

    if (value.startsWith('#')) {
      const body = quoted ? value.slice(1) : stripTrailingPunct(value.slice(1))
      const tag = normalizeTagValue(body)
      if (tag) pushUnique(tags, tag)
      continue
    }

    const m = /^(\p{L}+):(.*)$/su.exec(value)
    const op = m ? OP_KEYS.get(fold(m[1])) : undefined
    if (!m || !op) {
      words.push(value)
      continue
    }

    const arg = m[2].trim()
    if (!arg) continue

    if (op === 'cat') {
      categoryName = arg.replace(/\s+/g, ' ')
      continue
    }

    const values = quoted ? [arg] : arg.split(',').map((v) => v.trim()).filter(Boolean)
    let known = 0
    for (const v of values) {
      const key = fold(v)
      if (op === 'tag') {
        const tag = normalizeTagValue(quoted ? v : stripTrailingPunct(v))
        if (tag) {
          pushUnique(tags, tag)
          known++
        }
      } else if (op === 'type') {
        const t = TYPE_ALIASES.get(key)
        if (t) {
          pushUnique(types, t)
          known++
        }
      } else if (op === 'has') {
        const ts = HAS_ALIASES.get(key)
        if (ts) {
          for (const t of ts) pushUnique(types, t)
          known++
        }
      } else {
        const flag = IS_ALIASES.get(key)
        if (flag === 'favorite') favorite = true
        else if (flag === 'untagged') untagged = true
        else if (flag) pushUnique(statuses, flag)
        if (flag) known++
      }
    }
    // Ни одного распознанного значения — пусть ищется как обычный текст.
    if (known === 0 && op !== 'tag') words.push(value)
  }

  const filter: ItemFilter = {}
  if (statuses.length === 1) filter.status = statuses[0]
  else if (statuses.length > 1) filter.status = statuses
  if (types.length) filter.types = types
  if (tags.length) filter.tags = tags
  if (favorite) filter.favorite = true
  if (untagged) filter.untagged = true

  const parsed: ParsedQuery = { text: words.join(' '), phrases, filter }
  if (categoryName !== undefined) parsed.categoryName = categoryName
  return parsed
}
