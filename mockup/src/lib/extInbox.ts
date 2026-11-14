import { toast } from 'sonner'
import { describeError } from '@/lib/errors'
import { extensionMessageToInput, parseExtensionMessage } from '@/lib/extensionCapture'
import { displayTitle } from '@/lib/itemTitle'
import { isCaptureWindow, isTauri } from '@/lib/platform'
import type { Item, NewItemInput } from '@/types'

/**
 * Приём записей от расширения браузера в главном окне. Rust кладёт сообщение в слот ожидания и шлёт
 * окну «будильник» ext-capture без данных; окно само забирает сообщения (ext_take_pending) и подтверждает
 * итог (ext_capture_done). Канал только принимает: наружу уходят лишь ok, duplicate и текст ошибки.
 */

export const EVENT_EXT_CAPTURE = 'ext-capture'
export const SAVE_ERROR = 'Не удалось сохранить'
/** Ответ расширению, если приём выключен в настройках, а сообщение всё же дошло. */
export const RECEIVING_OFF = 'Приём выключен'
/** Текст ошибки, который уходит расширению, — не длиннее этого. */
const ERROR_MAX = 500

export interface ExtResult {
  ok: boolean
  duplicate: boolean
  error?: string
}

export interface ExtInboxDeps {
  findDuplicateLink(url: string): Promise<Item | undefined>
  createAndEnrich(input: NewItemInput): Promise<Item>
  onSaved?(item: Item): void
}

/** Сообщение из слота ожидания Rust (ExtPending, camelCase). */
interface PendingMessage {
  requestId: number
  message: unknown
}

/** Toast о сохранении — только если страница главного окна видна (окно в трее молчит). */
export function notifySaved(item: Item): void {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
  toast.success('Сохранено из браузера', {
    description: displayTitle(item),
    action: {
      label: 'Открыть',
      onClick: () => {
        // Динамически: actions.ts тянет базу и состояние интерфейса.
        void import('./actions')
          .then((m) => m.openItemInSection(item))
          .catch((err) => console.warn('[ext] не удалось открыть запись', err))
      },
    },
  })
}

async function resolveDeps(deps: Partial<ExtInboxDeps>): Promise<ExtInboxDeps> {
  let { findDuplicateLink, createAndEnrich } = deps
  if (!findDuplicateLink) {
    const repo = await import('@/db/repo')
    findDuplicateLink = (url) => repo.findDuplicateLink(url)
  }
  if (!createAndEnrich) createAndEnrich = (await import('./actions')).createAndEnrich
  return { findDuplicateLink, createAndEnrich, onSaved: deps.onSaved ?? notifySaved }
}

function errorText(e: unknown): string {
  const text = describeError(e, SAVE_ERROR)
  return text.length > ERROR_MAX ? `${text.slice(0, ERROR_MAX - 1)}…` : text
}

/** Разбор, проверка дубля ссылки, создание записи. Не бросает: ошибка → { ok: false, error }. */
export async function handleExtCapture(message: unknown, deps: Partial<ExtInboxDeps> = {}): Promise<ExtResult> {
  let item: Item
  let onSaved: ExtInboxDeps['onSaved']
  try {
    const input = extensionMessageToInput(parseExtensionMessage(message))
    const d = await resolveDeps(deps)
    onSaved = d.onSaved
    if (input.type === 'link' && input.url && (await d.findDuplicateLink(input.url))) {
      return { ok: true, duplicate: true }
    }
    // Запись в БД — только так: createAndEnrich → repo.createItem (проверка адреса и размеров там).
    item = await d.createAndEnrich(input)
  } catch (e) {
    return { ok: false, duplicate: false, error: errorText(e) }
  }
  try {
    onSaved?.(item)
  } catch (err) {
    console.warn('[ext] уведомление о сохранении не показано', err)
  }
  return { ok: true, duplicate: false }
}

function toPending(raw: unknown): PendingMessage[] {
  if (!Array.isArray(raw)) return []
  const out: PendingMessage[] = []
  for (const p of raw) {
    if (typeof p !== 'object' || p === null) continue
    const { requestId, message } = p as { requestId?: unknown; message?: unknown }
    if (typeof requestId === 'number' && Number.isSafeInteger(requestId) && requestId >= 0) {
      out.push({ requestId, message })
    }
  }
  return out
}

async function receivingEnabled(): Promise<boolean> {
  try {
    const { getSettings } = await import('@/db/settings')
    return (await getSettings()).extEnabled === true
  } catch (err) {
    console.warn('[ext] настройки не прочитаны, приём отклонён', err)
    return false
  }
}

/** Один проход: забрать накопленное и обработать строго по одному. */
async function drainOnce(): Promise<number> {
  const { invoke } = await import('@tauri-apps/api/core')
  let pending: PendingMessage[]
  try {
    pending = toPending(await invoke('ext_take_pending'))
  } catch (err) {
    console.warn('[ext] не удалось забрать сообщения расширения', err)
    return 0
  }
  if (pending.length === 0) return 0
  // Второй рубеж: приём выключен в настройках (переключатель, «Удалить все данные»), а Rust ещё слушает —
  // записи не создаются. Настройки не прочитались — тоже отказ.
  const enabled = await receivingEnabled()
  let done = 0
  for (const { requestId, message } of pending) {
    const result: ExtResult = enabled ? await handleExtCapture(message) : { ok: false, duplicate: false, error: RECEIVING_OFF }
    try {
      await invoke('ext_capture_done', {
        requestId,
        ok: result.ok,
        duplicate: result.duplicate,
        error: result.error ?? null,
      })
    } catch (err) {
      console.warn('[ext] не удалось подтвердить сохранение', err)
    }
    done++
  }
  return done
}

let draining: Promise<number> | null = null
let again = false

/**
 * ext_take_pending → handleExtCapture → ext_capture_done, строго по одному. Возвращает число обработанных.
 * Вызов во время работы не запускает второй проход параллельно, а ставит «повторить»: будильник,
 * пришедший, пока шла обработка, не теряется. Не бросает.
 */
export function drainExtInbox(): Promise<number> {
  if (!isTauri()) return Promise.resolve(0)
  if (draining) {
    again = true
    return draining
  }
  const run = async (): Promise<number> => {
    let total = 0
    try {
      do {
        again = false
        total += await drainOnce()
      } while (again)
    } catch (err) {
      console.warn('[ext] ошибка приёма от расширения', err)
    } finally {
      draining = null
    }
    return total
  }
  draining = run()
  return draining
}

let started: Promise<void> | null = null

/**
 * Подписка окна на ext-capture (getCurrentWebviewWindow().listen — не глобальный listen, чтобы не получать
 * события чужих окон) и первый drain: сообщение, пришедшее до подписки, забирается сразу. Идемпотентна.
 * Вне Tauri и в мини-окне ничего не делает. Не бросает.
 */
export function startExtInbox(): Promise<void> {
  if (!isTauri() || isCaptureWindow()) return Promise.resolve()
  if (started) return started
  started = (async () => {
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
      await getCurrentWebviewWindow().listen(EVENT_EXT_CAPTURE, () => {
        void drainExtInbox()
      })
    } catch (err) {
      console.warn('[ext] не удалось подписаться на сообщения расширения', err)
      // Подписки нет — следующий вызов попробует снова.
      started = null
    }
    await drainExtInbox()
  })()
  return started
}
