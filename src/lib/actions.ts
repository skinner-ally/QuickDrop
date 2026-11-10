import { toast } from 'sonner'
import {
  applyLinkMeta,
  createItem,
  deleteItems,
  getFile,
  getItem,
  restoreItems,
  setStatus,
  toggleFavorite,
  unarchive,
} from '@/db/repo'
import { getSettings } from '@/db/settings'
import { describeError } from '@/lib/errors'
import { fetchLinkMeta } from '@/lib/linkMeta'
import { hasLinkContent, safeLinkUrl, settleLinkMeta } from '@/lib/normalize'
import { isTauri } from '@/lib/platform'
import type { Item, ItemStatus, LinkMeta, NewItemInput } from '@/types'

/** Оборачивает действие: любая ошибка становится toast.error, наружу не бросает. */
async function safe(run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch (e) {
    toast.error(describeError(e))
  }
}

const toArray = (ids: string | string[]): string[] => (Array.isArray(ids) ? ids : [ids])

// ───────────────────────── ссылки ─────────────────────────

/**
 * Последний запрос метаданных по каждой записи. Запрос идёт до 8 с на попытку, и за это время адрес
 * могут сменить или нажать «Обновить данные»: прежний запрос отменяется, а его поздний ответ
 * не записывается.
 */
type LinkJob = { ctrl: AbortController }
const linkJobs = new Map<string, LinkJob>()

/** Идёт ли в этой сессии загрузка метаданных для записи (pending из другой вкладки/сессии — нет). */
export function isLinkMetaLoading(id: string): boolean {
  return linkJobs.has(id)
}

function endLinkJob(id: string, job: LinkJob): void {
  if (linkJobs.get(id) === job) linkJobs.delete(id)
}

/**
 * Отменяет прежний запрос по записи и ставит pending для адреса url.
 * null — записи уже нет или у неё другой адрес.
 */
async function beginLinkMeta(id: string, url: string, keep?: LinkMeta): Promise<LinkJob | null> {
  linkJobs.get(id)?.ctrl.abort()
  const job: LinkJob = { ctrl: new AbortController() }
  linkJobs.set(id, job)
  try {
    // pending — поверх прежних полей: заголовок в списке не пропадает, пока идёт запрос.
    if (await applyLinkMeta(id, url, { ...keep, status: 'pending' })) return job
  } catch (e) {
    endLinkJob(id, job)
    throw e
  }
  endLinkJob(id, job)
  return null
}

/** ok/failed — записан результат; kept — обновить не удалось, оставлены прежние данные; stale — ответ устарел. */
type LinkOutcome = 'ok' | 'failed' | 'kept' | 'stale'

/**
 * Загружает метаданные и записывает итог, если запрос всё ещё последний и адрес записи не сменился.
 * keep — прежние метаданные: при неудаче они остаются как были, а не стираются.
 * Исключение при загрузке тоже даёт итог 'failed' — pending не остаётся висеть.
 */
async function finishLinkMeta(
  id: string,
  url: string,
  proxyUrl: string,
  job: LinkJob,
  keep?: LinkMeta,
): Promise<LinkOutcome> {
  try {
    let meta: LinkMeta
    try {
      meta = await fetchLinkMeta(url, { proxyUrl: proxyUrl || undefined, signal: job.ctrl.signal })
    } catch {
      meta = { status: 'failed', fetchedAt: Date.now() }
    }
    if (linkJobs.get(id) !== job) return 'stale'
    const kept = meta.status !== 'ok' && keep !== undefined
    // Заголовок страницы остаётся в linkMeta: displayTitle берёт его сам, а title не затираем.
    if (!(await applyLinkMeta(id, url, kept ? keep : meta))) return 'stale'
    if (kept) return 'kept'
    return meta.status === 'ok' ? 'ok' : 'failed'
  } finally {
    endLinkJob(id, job)
  }
}

/** Создаёт запись; для ссылки метаданные подтягиваются в фоне и не задерживают возврат. */
export async function createAndEnrich(input: NewItemInput): Promise<Item> {
  const item = await createItem(input)
  if (item.type !== 'link' || !item.url) return item
  try {
    const settings = await getSettings()
    if (!settings.autoFetchLinkTitle) return item
    const url = item.url
    const job = await beginLinkMeta(item.id, url)
    if (!job) return item
    item.linkMeta = { status: 'pending' }
    void finishLinkMeta(item.id, url, settings.linkProxyUrl, job).catch(() => {})
  } catch {
    // обогащение необязательно: запись уже создана
  }
  return item
}

/**
 * Перезапрашивает метаданные по адресу, который сейчас лежит в базе. Если запрос не удался,
 * прежние заголовок/описание/картинка остаются (при смене адреса репозиторий их уже сбросил).
 */
export async function refreshLinkMeta(item: Item): Promise<void> {
  await safe(async () => {
    // Вызывающий мог передать адрес до нормализации (LinkCard — то, что ввёл пользователь).
    const current = await getItem(item.id)
    if (!current?.url) return
    const url = current.url
    const settings = await getSettings()
    const prev = current.linkMeta ? settleLinkMeta(current.linkMeta) : undefined
    const keep = hasLinkContent(prev) ? prev : undefined
    const job = await beginLinkMeta(item.id, url, keep)
    if (!job) return
    const outcome = await finishLinkMeta(item.id, url, settings.linkProxyUrl, job, keep)
    if (outcome === 'kept') toast.error('Не удалось обновить данные ссылки — оставлены прежние')
  })
}

// ───────────────────────── статусы ─────────────────────────

async function changeStatus(
  ids: string | string[],
  apply: (list: string[]) => Promise<void>,
  message: string,
): Promise<void> {
  await safe(async () => {
    const list = toArray(ids)
    if (list.length === 0) return
    // Прежние статусы запоминаем ДО изменения: отмена возвращает каждую запись на своё место.
    const before = new Map<string, ItemStatus>()
    for (const id of list) {
      const it = await getItem(id)
      if (it) before.set(id, it.status)
    }
    await apply(list)
    const text = before.size > 1 ? `${message}: ${before.size}` : message
    toast(text, {
      action: {
        label: 'Отменить',
        onClick: () => {
          void safe(async () => {
            const groups = new Map<ItemStatus, string[]>()
            for (const [id, status] of before) groups.set(status, [...(groups.get(status) ?? []), id])
            for (const [status, group] of groups) await setStatus(group, status)
          })
        },
      },
    })
  })
}

export const actToLibrary = (ids: string | string[]) =>
  changeStatus(ids, (l) => setStatus(l, 'library'), 'В базе знаний')
export const actToInbox = (ids: string | string[]) =>
  changeStatus(ids, (l) => setStatus(l, 'inbox'), 'Во входящих')
export const actArchive = (ids: string | string[]) =>
  changeStatus(ids, (l) => setStatus(l, 'archive'), 'В архиве')
export const actUnarchive = (ids: string | string[]) =>
  changeStatus(ids, (l) => unarchive(l), 'Возвращено из архива')

export async function actDelete(ids: string | string[]): Promise<void> {
  await safe(async () => {
    const list = toArray(ids)
    if (list.length === 0) return
    const snapshots = await deleteItems(list)
    if (snapshots.length === 0) return
    toast(snapshots.length > 1 ? `Удалено: ${snapshots.length}` : 'Удалено', {
      action: {
        label: 'Отменить',
        onClick: () => {
          void safe(() => restoreItems(snapshots))
        },
      },
    })
  })
}

export async function actToggleFavorite(item: Item): Promise<void> {
  await safe(() => toggleFavorite(item.id))
}

// ───────────────────────── буфер, открытие, скачивание ─────────────────────────

/** Копирует текст в буфер; без Clipboard API (http, старый WebView) — через временный textarea. */
export async function copyText(text: string, message = 'Скопировано'): Promise<void> {
  await safe(async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      if (!ok) throw new Error('Не удалось скопировать')
    }
    toast.success(message)
  })
}

export async function actCopy(item: Item): Promise<void> {
  let text: string
  if (item.type === 'link' && item.url) text = item.url
  else if (item.type === 'text' || item.type === 'code' || item.type === 'idea') text = item.content
  else text = item.title || item.fileName || item.content
  await copyText(text)
}

/** Открывает внешнюю ссылку: в Tauri — системным браузером, в вебе — новой вкладкой. */
export async function openLink(raw: string | undefined): Promise<void> {
  const url = safeLinkUrl(raw)
  if (!url) {
    toast.error('Нельзя открыть этот адрес')
    return
  }
  try {
    if (isTauri()) {
      const { openExternal } = await import('@/lib/desktop')
      if (await openExternal(url)) return
    }
    // noopener: страница не получает window.opener.
    window.open(url, '_blank', 'noopener,noreferrer')
  } catch (e) {
    toast.error(describeError(e))
  }
}

export function actOpen(item: Item): void {
  void openLink(item.url)
}

/**
 * Сохраняет Blob файлом через `<a download>`. В Tauri такое скачивание обрабатывает оболочка:
 * WebView2 — своей панелью загрузок, macOS — обработчиком в src-tauri/src/lib.rs (без него WKWebView
 * скачивание отменяет), итог показывает src/lib/desktop.ts.
 */
export function saveBlob(blob: Blob, name: string): void {
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 10_000)
}

export async function actDownload(item: Item): Promise<void> {
  await safe(async () => {
    if (!item.fileId) throw new Error('У записи нет файла')
    const file = await getFile(item.fileId)
    if (!file) throw new Error('Файл не найден')
    saveBlob(file.blob, file.name || item.fileName || 'file')
  })
}
