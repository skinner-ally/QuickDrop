import { toast } from 'sonner'
import {
  createItem,
  deleteItems,
  getFile,
  getItem,
  restoreItems,
  setStatus,
  toggleFavorite,
  unarchive,
  updateItem,
} from '@/db/repo'
import { getSettings } from '@/db/settings'
import { fetchLinkMeta } from '@/lib/linkMeta'
import { safeLinkUrl } from '@/lib/normalize'
import type { Item, ItemStatus, NewItemInput } from '@/types'

function errMsg(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Что-то пошло не так'
}

/** Оборачивает действие: любая ошибка становится toast.error, наружу не бросает. */
async function safe(run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch (e) {
    toast.error(errMsg(e))
  }
}

const toArray = (ids: string | string[]): string[] => (Array.isArray(ids) ? ids : [ids])

// ───────────────────────── ссылки ─────────────────────────

async function loadLinkMeta(id: string, url: string, proxyUrl: string): Promise<void> {
  const meta = await fetchLinkMeta(url, { proxyUrl: proxyUrl || undefined })
  // Заголовок страницы остаётся в linkMeta: displayTitle берёт его сам, а title не затираем.
  try {
    await updateItem(id, { linkMeta: meta })
  } catch {
    // запись удалили, пока шла загрузка — это нормально
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
    await updateItem(item.id, { linkMeta: { status: 'pending' } })
    item.linkMeta = { status: 'pending' }
    void loadLinkMeta(item.id, url, settings.linkProxyUrl).catch(() => {})
  } catch {
    // обогащение необязательно: запись уже создана
  }
  return item
}

export async function refreshLinkMeta(item: Item): Promise<void> {
  await safe(async () => {
    if (!item.url) return
    const settings = await getSettings()
    await updateItem(item.id, { linkMeta: { status: 'pending' } })
    await loadLinkMeta(item.id, item.url, settings.linkProxyUrl)
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

export function actOpen(item: Item): void {
  const url = safeLinkUrl(item.url)
  if (!url) {
    toast.error('Нельзя открыть этот адрес')
    return
  }
  try {
    // noopener: страница не получает window.opener; в Tauri window.open тоже открывает браузер.
    window.open(url, '_blank', 'noopener,noreferrer')
  } catch (e) {
    toast.error(errMsg(e))
  }
}

export async function actDownload(item: Item): Promise<void> {
  await safe(async () => {
    if (!item.fileId) throw new Error('У записи нет файла')
    const file = await getFile(item.fileId)
    if (!file) throw new Error('Файл не найден')
    const href = URL.createObjectURL(file.blob)
    const a = document.createElement('a')
    a.href = href
    a.download = file.name || item.fileName || 'file'
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 10_000)
  })
}
