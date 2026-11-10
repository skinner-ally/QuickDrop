import type { LinkMeta } from '@/types'
import { normalizeUrl } from '@/lib/detect'
import { isTauri } from '@/lib/platform'

export interface FetchLinkMetaOptions {
  /** Шаблон CORS-прокси с {url} (подставляется encodeURIComponent(адрес)); без {url} адрес дописывается в конец. */
  proxyUrl?: string
  signal?: AbortSignal
}

export const LINK_FETCH_TIMEOUT_MS = 8000
/** Больше ~512 КБ не читаем: метаданные лежат в <head>. */
export const LINK_FETCH_MAX_BYTES = 512 * 1024
const TITLE_MAX = 300
const DESCRIPTION_MAX = 500

// ───────────────────────────── HTML-сущности ─────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '',
  ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’',
  sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', lsaquo: '‹', rsaquo: '›',
  copy: '©', reg: '®', trade: '™', bull: '•', middot: '·', times: '×', divide: '÷',
  euro: '€', pound: '£', yen: '¥', cent: '¢', deg: '°', plusmn: '±', para: '¶', sect: '§',
  numero: '№', frac12: '½', frac14: '¼', frac34: '¾', iexcl: '¡', iquest: '¿',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', hearts: '♥', check: '✓',
  thinsp: ' ', ensp: ' ', emsp: ' ', zwnj: '‌', zwj: '‍',
}

/** &#128;–&#159; в HTML означают символы windows-1252 (старые сайты пишут &#151; вместо тире). */
const CP1252_C1: Record<number, string> = {
  128: '€', 130: '‚', 131: 'ƒ', 132: '„', 133: '…', 134: '†', 135: '‡', 136: 'ˆ', 137: '‰',
  138: 'Š', 139: '‹', 140: 'Œ', 142: 'Ž', 145: '‘', 146: '’', 147: '“', 148: '”', 149: '•',
  150: '–', 151: '—', 152: '˜', 153: '™', 154: 'š', 155: '›', 156: 'œ', 158: 'ž', 159: 'Ÿ',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#\d{1,7}|#x[\da-f]{1,6}|[a-z][a-z\d]{1,31});/gi, (match, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
      if (Object.hasOwn(CP1252_C1, code)) return CP1252_C1[code]
      if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return match
      return String.fromCodePoint(code)
    }
    if (Object.hasOwn(NAMED_ENTITIES, body)) return NAMED_ENTITIES[body]
    const lower = body.toLowerCase()
    return Object.hasOwn(NAMED_ENTITIES, lower) ? NAMED_ENTITIES[lower] : match
  })
}

function clean(raw: string | undefined, max: number): string | undefined {
  if (raw == null) return undefined
  const s = decodeEntities(raw).replace(/\s+/g, ' ').trim()
  if (!s) return undefined
  if (s.length <= max) return s
  return `${s.slice(0, max - 1).trimEnd()}…`
}

// ───────────────────────────── Разбор HTML ─────────────────────────────

// Разбор — только линейными проходами (indexOf / поиск фиксированной строки). Регэкспы вида
// `<meta\b(...)*>` и `<title\b[^>]*>…</title>` на странице из тысяч незакрытых тегов сканировали
// документ до конца от КАЖДОГО тега: 512 КБ таких тегов блокировали UI на 5–30 секунд.

/** Значение атрибута в кавычках длиннее этого считаем битым (так же, как и раньше в регэкспе). */
const MAX_QUOTED = 4096
/** Сколько <head> разбираем: метаданные — в начале документа, дальше только раздутые инлайны. */
const MAX_HEAD = 256 * 1024
const ATTR_RE = /([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

function parseAttrs(s: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of s.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase()
    if (!out.has(name)) out.set(name, m[2] ?? m[3] ?? m[4] ?? '')
  }
  return out
}

/** Регэксп начала тега: только фиксированная строка — поиск линейный. */
const tagStartRe = (name: string) => new RegExp(`<${name}\\b`, 'gi')

/**
 * Конец тега, начатого перед `from`: позиция «>» вне кавычек; -1 — тег битый (встретился «<»
 * вне кавычек, кавычка не закрыта или слишком длинная, документ кончился).
 */
function tagEnd(html: string, from: number): number {
  for (let j = from; j < html.length; j++) {
    const c = html.charCodeAt(j)
    if (c === 62 /* > */) return j
    // Незакрытый тег: следующий начинается здесь, дальше этот не ищем — так проход линейный.
    if (c === 60 /* < */) return -1
    if (c === 34 /* " */ || c === 39 /* ' */) {
      const close = html.indexOf(html[j], j + 1)
      if (close < 0 || close - j - 1 > MAX_QUOTED) return -1
      j = close
    }
  }
  return -1
}

/** Строки атрибутов всех полных тегов `<name …>` по порядку. */
function* scanTags(html: string, name: string): Generator<string> {
  const re = tagStartRe(name)
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const start = m.index + m[0].length
    const end = tagEnd(html, start)
    if (end < 0) continue // lastIndex уже за «<name»: следующий тег ищем дальше
    yield html.slice(start, end)
    re.lastIndex = end + 1
  }
}

const firstTag = (html: string, name: string): string | undefined => scanTags(html, name).next().value ?? undefined

/** Содержимое первого <title>…</title>; undefined — тега нет или он не закрыт. */
function findTitle(html: string): string | undefined {
  const open = tagStartRe('title')
  let m: RegExpExecArray | null
  while ((m = open.exec(html))) {
    const gt = html.indexOf('>', m.index + m[0].length)
    // Нет «>» — нет и полного <title> дальше.
    if (gt < 0) return undefined
    const close = /<\/title\s*>/gi
    close.lastIndex = gt + 1
    const c = close.exec(html)
    // Нет закрывающего — у последующих <title> его тоже нет.
    return c ? html.slice(gt + 1, c.index) : undefined
  }
  return undefined
}

/** Убирает комментарии и содержимое script/style/noscript/template. */
function stripNoise(html: string): string {
  const out: string[] = []
  let pos = 0
  const re = /<!--|<(script|style|noscript|template)\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    out.push(html.slice(pos, m.index))
    let next: number
    if (!m[1]) {
      const close = html.indexOf('-->', m.index + 4)
      next = close < 0 ? html.length : close + 3
    } else {
      const gt = html.indexOf('>', m.index + m[0].length)
      if (gt < 0) {
        // Нет «>» до конца документа: тег не закрыт, оставляем хвост как есть.
        pos = m.index
        break
      }
      const closeRe = new RegExp(`</${m[1]}\\s*>`, 'gi')
      closeRe.lastIndex = gt + 1
      const close = closeRe.exec(html)
      next = close ? close.index + close[0].length : html.length
    }
    pos = next
    re.lastIndex = next
  }
  out.push(html.slice(pos))
  return out.join('')
}

function collectMeta(html: string, into: Map<string, string>, onlyOpenGraph = false): void {
  for (const raw of scanTags(html, 'meta')) {
    const attrs = parseAttrs(raw)
    const content = attrs.get('content')
    if (content == null || !content.trim()) continue
    for (const keyAttr of ['property', 'name', 'itemprop']) {
      const key = attrs.get(keyAttr)?.trim().toLowerCase()
      if (!key || into.has(key)) continue
      if (onlyOpenGraph && !/^(?:og|twitter):/.test(key)) continue
      into.set(key, content)
    }
  }
}

function absolutize(raw: string | undefined, base: string): string | undefined {
  if (!raw) return undefined
  try {
    const u = new URL(decodeEntities(raw).trim(), base)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined
  } catch {
    return undefined
  }
}

/**
 * Заголовок, описание, картинка и favicon из HTML. Без DOMParser — работает и в node-тестах.
 * Смотрит в <head>; og:/twitter:-теги, вынесенные в <body>, — запасной вариант.
 */
export function parseHtmlMeta(html: string, baseUrl: string): Omit<LinkMeta, 'status'> {
  const doc = stripNoise(html)
  let headEnd = doc.search(/<\/head\s*>/i)
  if (headEnd < 0) headEnd = doc.search(/<body[\s>]/i)
  const head = (headEnd >= 0 ? doc.slice(0, headEnd) : doc).slice(0, MAX_HEAD)

  const meta = new Map<string, string>()
  collectMeta(head, meta)
  const titleTag = findTitle(head)
  if (headEnd >= 0 && !titleTag && !meta.has('og:title') && !meta.has('twitter:title')) {
    collectMeta(doc.slice(headEnd), meta, true)
  }

  let base = baseUrl
  const baseHref = firstTag(head, 'base')
  if (baseHref) {
    const href = parseAttrs(baseHref).get('href')
    const resolved = href ? absolutize(href, baseUrl) : undefined
    if (resolved) base = resolved
  }

  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = meta.get(k)
      if (v?.trim()) return v
    }
    return undefined
  }

  const title = clean(pick('og:title', 'twitter:title') ?? titleTag, TITLE_MAX)
  const description = clean(pick('og:description', 'description', 'twitter:description'), DESCRIPTION_MAX)
  const siteName = clean(pick('og:site_name', 'application-name'), TITLE_MAX)
  const image = absolutize(
    pick('og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'),
    base,
  )

  let icon: string | undefined
  let shortcut: string | undefined
  let touch: string | undefined
  for (const raw of scanTags(head, 'link')) {
    const attrs = parseAttrs(raw)
    const href = attrs.get('href')
    if (!href?.trim()) continue
    const rel = (attrs.get('rel') ?? '').toLowerCase().split(/\s+/)
    if (rel.includes('icon')) {
      if (rel.includes('shortcut')) shortcut ??= href
      else icon ??= href
    } else if (rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) {
      touch ??= href
    }
  }
  const favicon =
    absolutize(icon ?? shortcut ?? touch, base) ??
    (/^https?:\/\//i.test(baseUrl) ? absolutize('/favicon.ico', baseUrl) : undefined)

  const out: Omit<LinkMeta, 'status'> = {}
  if (title) out.title = title
  if (description) out.description = description
  if (siteName) out.siteName = siteName
  if (image) out.image = image
  if (favicon) out.favicon = favicon
  return out
}

// ───────────────────────────── Запасной заголовок ─────────────────────────────

/** RFC 3492: «xn--e1afmkfd» → «пример». */
function punycodeDecode(input: string): string {
  const base = 36
  const tMin = 1
  const tMax = 26
  const adapt = (delta: number, numPoints: number, first: boolean): number => {
    let d = first ? Math.floor(delta / 700) : delta >> 1
    d += Math.floor(d / numPoints)
    let k = 0
    while (d > ((base - tMin) * tMax) >> 1) {
      d = Math.floor(d / (base - tMin))
      k += base
    }
    return Math.floor(k + ((base - tMin + 1) * d) / (d + 38))
  }
  const digit = (cp: number): number =>
    cp >= 0x30 && cp < 0x3a ? cp - 22 : cp >= 0x41 && cp < 0x5b ? cp - 0x41 : cp >= 0x61 && cp < 0x7b ? cp - 0x61 : base

  const output: number[] = []
  const basic = Math.max(0, input.lastIndexOf('-'))
  for (let j = 0; j < basic; j++) output.push(input.charCodeAt(j))
  let n = 128
  let i = 0
  let bias = 72
  for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length; ) {
    const oldI = i
    for (let w = 1, k = base; ; k += base) {
      if (idx >= input.length) throw new RangeError('punycode')
      const d = digit(input.charCodeAt(idx++))
      if (d >= base) throw new RangeError('punycode')
      i += d * w
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias
      if (d < t) break
      w *= base - t
    }
    const len = output.length + 1
    bias = adapt(i - oldI, len, oldI === 0)
    n += Math.floor(i / len)
    i %= len
    output.splice(i++, 0, n)
  }
  return String.fromCodePoint(...output)
}

/** Хост для показа людям: IDN из punycode обратно в Unicode. */
export function hostToUnicode(host: string): string {
  return host
    .split('.')
    .map((label) => {
      if (!/^xn--/i.test(label)) return label
      try {
        return punycodeDecode(label.slice(4).toLowerCase())
      } catch {
        return label
      }
    })
    .join('.')
}

const CODE_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org', 'gitee.com'])
const NOISE_SEGMENTS = new Set([
  'index', 'default', 'home', 'watch', 'amp', 'article', 'articles', 'post', 'posts', 'p', 'wiki',
  'view', 'item', 'read', 'id', 'status', 's', 'r', 'u', 'ru', 'en', 'de', 'fr', 'es', 'it', 'uk',
  'pl', 'pt', 'zh', 'ja', 'ko', 'tr', 'nl', 'en-us', 'en-gb', 'ru-ru', 'de-de', 'fr-fr', 'es-es',
  'pt-br', 'zh-cn', 'zh-tw', 'ja-jp',
])

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function readableSegment(raw: string): string | undefined {
  const decoded = safeDecode(raw).trim()
  if (!decoded || decoded.startsWith('@') || NOISE_SEGMENTS.has(decoded.toLowerCase())) return undefined
  if (!/\p{L}{2,}/u.test(decoded)) return undefined // только цифры и знаки: id
  if (/^[\da-f]{8}-[\da-f]{4}-/i.test(decoded)) return undefined // uuid
  // id вроде dQw4w9WgXcQ: буквы и цифры вперемешку, без разделителей
  if (/^[A-Za-z\d]{8,}$/.test(decoded) && /\d/.test(decoded) && /[A-Za-z]/.test(decoded)) return undefined
  const s = decoded
    .replace(/\.(?:html?|php\d?|aspx?|jsp|shtml|cgi)$/i, '')
    .replace(/[-_](?:[\da-f]{8,}|\d{5,})$/i, '')
    .replace(/[-_+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s || NOISE_SEGMENTS.has(s.toLowerCase())) return undefined
  return s.length > 80 ? `${s.slice(0, 79).trimEnd()}…` : s
}

/** Читаемый запасной заголовок: «github.com — tauri-apps/tauri», «ru.wikipedia.org — Москва». */
export function titleFromUrl(url: string): string {
  const raw = url.trim()
  let u: URL
  try {
    u = new URL(normalizeUrl(raw))
  } catch {
    return raw.slice(0, TITLE_MAX)
  }
  if (!u.hostname) return raw.slice(0, TITLE_MAX)

  const hostname = hostToUnicode(u.hostname.toLowerCase()).replace(/^www\./, '')
  const host = u.port ? `${hostname}:${u.port}` : hostname
  const segments = u.pathname.split('/').filter(Boolean)

  let tail: string | undefined
  if (CODE_HOSTS.has(hostname) && segments.length >= 2) {
    tail = `${safeDecode(segments[0])}/${safeDecode(segments[1])}`
    const kind = segments[2]
    if ((kind === 'issues' || kind === 'pull' || kind === 'pulls' || kind === 'merge_requests') && /^\d+$/.test(segments[3] ?? '')) {
      tail += ` #${segments[3]}`
    } else if ((kind === 'blob' || kind === 'tree') && segments.length > 4) {
      tail += ` · ${safeDecode(segments[segments.length - 1])}`
    }
  } else {
    // страница поиска лучше описывается запросом, чем путём «/search»
    const q = u.searchParams.get('q') ?? u.searchParams.get('query') ?? u.searchParams.get('text')
    if (q?.trim()) tail = q.trim().replace(/\s+/g, ' ').slice(0, 80)
    for (let i = segments.length - 1; i >= 0 && !tail; i--) tail = readableSegment(segments[i])
  }
  return (tail ? `${host} — ${tail}` : host).slice(0, TITLE_MAX)
}

// ───────────────────────────── Загрузка ─────────────────────────────

interface FetchedPage {
  html: string
  finalUrl: string
}

/** Подставляет адрес в шаблон прокси. */
export function buildProxyUrl(template: string, target: string): string {
  const encoded = encodeURIComponent(target)
  return template.includes('{url}') ? template.replaceAll('{url}', encoded) : template + encoded
}

function charsetFromContentType(contentType: string): string | undefined {
  return /charset\s*=\s*["']?([\w:.-]+)/i.exec(contentType)?.[1]
}

/** Кодировка из <meta charset> / http-equiv в первых байтах документа. */
function sniffCharset(bytes: Uint8Array): string | undefined {
  let head = ''
  // разметка — ASCII, поэтому для поиска charset годится любая однобайтовая кодировка
  for (const b of bytes.subarray(0, 4096)) head += String.fromCharCode(b)
  return /<meta\b[^>]*?charset\s*=\s*["']?\s*([\w:.-]+)/i.exec(head)?.[1]
}

function decodeHtml(bytes: Uint8Array, contentType: string): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes)
  const charset = charsetFromContentType(contentType) ?? sniffCharset(bytes) ?? 'utf-8'
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

function hasHeadEnd(b: Uint8Array): boolean {
  for (let i = 0; i + 5 < b.length; i++) {
    if (
      b[i] === 0x3c && b[i + 1] === 0x2f &&
      (b[i + 2] | 0x20) === 0x68 && (b[i + 3] | 0x20) === 0x65 &&
      (b[i + 4] | 0x20) === 0x61 && (b[i + 5] | 0x20) === 0x64
    ) return true
  }
  return false
}

async function readLimited(res: Response, max: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer()).subarray(0, max)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < max) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.byteLength
      // всё нужное лежит в <head>: дальше не качаем
      if (hasHeadEnd(value)) break
    }
  } finally {
    reader.cancel().catch(() => {})
  }
  const out = new Uint8Array(Math.min(total, max))
  let offset = 0
  for (const chunk of chunks) {
    const n = Math.min(chunk.byteLength, out.length - offset)
    out.set(chunk.subarray(0, n), offset)
    offset += n
    if (offset >= out.length) break
  }
  return out
}

async function fetchPage(url: string, outer?: AbortSignal): Promise<FetchedPage | null> {
  if (outer?.aborted) return null
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  outer?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => ctrl.abort(), LINK_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
    })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') ?? ''
    if (contentType && !/html|xml|text\/plain/i.test(contentType)) return null
    const bytes = await readLimited(res, LINK_FETCH_MAX_BYTES)
    return { html: decodeHtml(bytes, contentType), finalUrl: res.url || url }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onAbort)
  }
}

/** Ждёт промис, но не дольше таймаута и не после отмены (invoke в Tauri отменить нельзя). */
function settleWithin<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(null)
    const finish = (v: T | null) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve(v)
    }
    const onAbort = () => finish(null)
    const timer = setTimeout(() => finish(null), ms)
    signal?.addEventListener('abort', onAbort, { once: true })
    promise.then(finish, () => finish(null))
  })
}

async function fetchViaTauri(url: string, signal?: AbortSignal): Promise<FetchedPage | null> {
  const { invoke } = await import('@tauri-apps/api/core')
  const res = await settleWithin(
    invoke<{ html: string; finalUrl: string }>('fetch_link_meta', { url }),
    LINK_FETCH_TIMEOUT_MS,
    signal,
  )
  if (!res || typeof res.html !== 'string') return null
  return { html: res.html, finalUrl: res.finalUrl || url }
}

/**
 * Метаданные страницы по ссылке. Никогда не бросает.
 * Порядок: Tauri-команда fetch_link_meta → прямой fetch (CORS) → прокси из настроек (если задан).
 * Сторонние сервисы без явно настроенного прокси не используются.
 */
export async function fetchLinkMeta(url: string, opts: FetchLinkMetaOptions = {}): Promise<LinkMeta> {
  const { signal } = opts
  const failed = (): LinkMeta => ({ status: 'failed', fetchedAt: Date.now() })
  try {
    const parsed = new URL(normalizeUrl(url))
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return failed()
    const target = parsed.href

    const attempts: Array<() => Promise<FetchedPage | null>> = []
    if (isTauri()) attempts.push(() => fetchViaTauri(target, signal))
    attempts.push(() => fetchPage(target, signal))
    const proxyTemplate = opts.proxyUrl?.trim()
    if (proxyTemplate) {
      const proxied = buildProxyUrl(proxyTemplate, target)
      if (/^https?:\/\//i.test(proxied)) {
        // адрес прокси — не адрес страницы: относительные ссылки разрешаем от target
        attempts.push(async () => {
          const page = await fetchPage(proxied, signal)
          return page && { html: page.html, finalUrl: target }
        })
      }
    }

    for (const attempt of attempts) {
      if (signal?.aborted) return failed()
      let page: FetchedPage | null = null
      try {
        page = await attempt()
      } catch {
        page = null
      }
      if (signal?.aborted) return failed()
      if (!page) continue
      // страница получена: если в ней нет метаданных, другой способ загрузки их не добавит
      const meta = parseHtmlMeta(page.html, page.finalUrl || target)
      if (meta.title || meta.description || meta.siteName || meta.image) {
        return { ...meta, status: 'ok', fetchedAt: Date.now() }
      }
      return failed()
    }
    return failed()
  } catch {
    return failed()
  }
}
