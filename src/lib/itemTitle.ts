import { titleFromUrl } from '@/lib/linkMeta'
import type { Item, ItemType } from '@/types'

export const TYPE_LABEL: Record<ItemType, string> = {
  text: 'Текст',
  link: 'Ссылка',
  code: 'Код',
  idea: 'Идея',
  file: 'Файл',
  image: 'Изображение',
}

export const TYPE_LABEL_PLURAL: Record<ItemType, string> = {
  text: 'Тексты',
  link: 'Ссылки',
  code: 'Код',
  idea: 'Идеи',
  file: 'Файлы',
  image: 'Изображения',
}

const MAX_TITLE = 80

type TitleSource = Pick<Item, 'title' | 'content'> &
  Partial<Pick<Item, 'linkMeta' | 'fileName' | 'url'>>

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s
}

/** Заголовок для показа: явный → из страницы → имя файла → первая строка текста → читаемый вид url. */
export function displayTitle(item: TitleSource): string {
  const own = item.title?.trim()
  if (own) return own
  const meta = item.linkMeta?.title?.trim()
  if (meta) return meta
  const file = item.fileName?.trim()
  if (file) return file
  const line = (item.content ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (line) return clip(line, MAX_TITLE)
  if (item.url?.trim()) return titleFromUrl(item.url) || item.url.trim()
  return 'Без названия'
}

function dayStart(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Короткая дата: «12 мар» (год добавляется для другого года). */
function formatShortDate(ts: number, now: number): string {
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear()
  const fmt = new Intl.DateTimeFormat('ru', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
  // В разных версиях ICU после месяца стоит точка, а после года — « г.»
  return fmt.format(ts).replace(/\s?г\.$/, '').replace('.', '')
}

export function formatRelative(ts: number, now: number = Date.now()): string {
  const diff = now - ts
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 24) return `${hours} ч назад`
  const days = Math.round((dayStart(now) - dayStart(ts)) / 86_400_000)
  if (days <= 1) return 'вчера'
  if (days <= 7) return `${days} дн назад`
  return formatShortDate(ts, now)
}

export function formatDateTime(ts: number): string {
  return new Intl.DateTimeFormat('ru', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
    .format(ts)
    .replace(/\s?г\.,?/, ',')
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б'
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']
  let i = 0
  let v = bytes
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  if (i === 0) return `${Math.round(v)} Б`
  const s = (Math.round(v * 10) / 10).toString().replace('.', ',')
  return `${s} ${units[i]}`
}
