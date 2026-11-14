import type { Item } from '@/types'
import { normalizeUrl } from '@/lib/detect'
import { hasForeignScheme } from '@/lib/normalize'

/**
 * Дубли ссылок: два адреса считаются одним, если совпадают их ключи (linkKey).
 * Осознанно НЕ склеиваются: youtu.be ↔ youtube.com/watch, m.-поддомены, index.html.
 */

/** Параметры слежения: на содержимое страницы не влияют. Имена сравниваются без учёта регистра. */
const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'ysclid', 'mc_cid', 'mc_eid',
  '_ga', '_gl', 'igshid', 'igsh', 'ref_src', 'ref_url', '_hsenc', '_hsmi', 'mkt_tok',
])

function isTrackingParam(name: string): boolean {
  const n = name.toLowerCase()
  return n.startsWith('utm_') || TRACKING_PARAMS.has(n)
}

function hostKey(hostname: string): string {
  const host = hostname.replace(/\.+$/, '')
  return host.startsWith('www.') && host.length > 4 ? host.slice(4) : host
}

function queryKey(params: URLSearchParams): string {
  const kept = [...params].filter(([name]) => !isTrackingParam(name))
  if (!kept.length) return ''
  // Сортировка устойчивая: порядок повторяющихся параметров (?a=1&a=2) значим и сохраняется.
  kept.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `?${new URLSearchParams(kept).toString()}`
}

/** Ключ сравнения адресов; null — это не http/https/ftp-адрес. */
export function linkKey(raw: string): string | null {
  const s = raw.trim()
  // «mailto:a@b.c» после дописывания https:// стал бы адресом с логином «mailto» — отсекаем заранее.
  if (!s || hasForeignScheme(s)) return null
  let u: URL
  try {
    u = new URL(normalizeUrl(s))
  } catch {
    return null
  }
  const ftp = u.protocol === 'ftp:'
  if (!ftp && u.protocol !== 'http:' && u.protocol !== 'https:') return null
  const host = hostKey(u.hostname)
  if (!host) return null

  const port = u.port ? `:${u.port}` : ''
  const path = u.pathname.replace(/\/+$/, '')
  // Фрагмент — место на странице, кроме маршрутов одностраничных приложений (#/inbox, #!/page).
  const hash = u.hash.startsWith('#/') || u.hash.startsWith('#!') ? u.hash : ''
  return `${ftp ? 'ftp://' : ''}${host}${port}${path}${queryKey(u.searchParams)}${hash}`
}

export function sameLink(a: string, b: string): boolean {
  const key = linkKey(a)
  return key !== null && key === linkKey(b)
}

/** Запись-дубль среди items: без корзины, без excludeId; сначала не архивные, затем самая новая по createdAt. */
export function findDuplicateLinkIn(items: readonly Item[], url: string, excludeId?: string): Item | undefined {
  const key = linkKey(url)
  if (key === null) return undefined
  let best: Item | undefined
  for (const item of items) {
    if (item.type !== 'link' || !item.url || item.deletedAt !== undefined || item.id === excludeId) continue
    if (linkKey(item.url) !== key) continue
    if (!best || isBetterDuplicate(item, best)) best = item
  }
  return best
}

function isBetterDuplicate(a: Item, b: Item): boolean {
  const archivedA = a.status === 'archive'
  const archivedB = b.status === 'archive'
  if (archivedA !== archivedB) return !archivedA
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt
  // Добивка по id: результат не зависит от порядка записей во входном списке.
  return a.id < b.id
}
