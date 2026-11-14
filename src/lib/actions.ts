import { toast } from 'sonner'
import {
  applyLinkMeta,
  clearOcrText,
  clearPositions,
  createItem,
  createSavedSearch,
  deleteItems,
  deleteSavedSearch,
  emptyTrash,
  findDuplicateLink,
  getFile,
  getItem,
  getPositions,
  linkItems,
  listCategories,
  listLiveItems,
  listSavedSearches,
  purgeItems,
  reorderSavedSearches,
  restoreFromTrash,
  restoreItems,
  restoreSavedSearch,
  setCategory,
  setOcrText,
  setPositions,
  setStatus,
  toggleFavorite,
  unarchive,
  unlinkItems,
  updateSavedSearch,
} from '@/db/repo'
import { getSettings } from '@/db/settings'
import { getAllItemsSnapshot, getTrashedItemsSnapshot } from '@/hooks/useItems'
import { visionAvailability } from '@/lib/ai'
import { findDuplicateLinkIn } from '@/lib/dedupe'
import { describeError } from '@/lib/errors'
import { movedCountText } from '@/lib/graph/swarm'
import { displayTitle } from '@/lib/itemTitle'
import { fetchLinkMeta } from '@/lib/linkMeta'
import { cleanOcrText, hasLinkContent, safeLinkUrl, settleLinkMeta } from '@/lib/normalize'
import { extractItemText } from '@/lib/ocr'
import { getOcrJob, ocrKindOf, setOcrNote, type OcrKind, type OcrOutcome } from '@/lib/ocrState'
import { isTauri } from '@/lib/platform'
import {
  alreadySavedText,
  currentSearchQuery,
  findSavedByQuery,
  suggestSearchName,
  viewForQuery,
} from '@/lib/savedSearch'
import { mayHaveWikiLinks, wikiLinkTargets } from '@/lib/wikiLinks'
import { confirmDialog } from '@/store/confirm'
import { useGraph } from '@/store/graph'
import { useUi, type View } from '@/store/ui'
import type { GraphPoint, Item, ItemStatus, LinkMeta, NewItemInput, SavedSearch } from '@/types'

/** Оборачивает действие: любая ошибка становится toast.error, наружу не бросает (итог — undefined). */
async function safe<T>(run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run()
  } catch (e) {
    toast.error(describeError(e))
    return undefined
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

/**
 * Фоновое извлечение текста новой записи. PDF — всегда (текстовый слой локально; скан уходит в ИИ, только
 * если включено автораспознавание), картинка — только при автораспознавании. Настройки не прочитались —
 * авто считается выключенным. Не бросает.
 */
async function extractInBackground(item: Item, kind: OcrKind): Promise<void> {
  let vision = false
  try {
    const settings = await getSettings()
    vision = settings.aiEnabled && settings.aiAutoOcr
  } catch {
    vision = false
  }
  // extractItemText не бросает; текст попадёт в поиск, когда будет готов.
  if (kind === 'pdf' || vision) await extractItemText(item, { vision })
}

/**
 * Создаёт запись; метаданные ссылки и текст вложения подтягиваются в фоне и не задерживают возврат.
 */
export async function createAndEnrich(input: NewItemInput): Promise<Item> {
  const item = await createItem(input)
  const kind = ocrKindOf(item)
  if (kind) void extractInBackground(item, kind).catch(() => {})
  // Связи по [[вики-ссылкам]] — молча: запись только что создана, toast о связях был бы шумом.
  if (item.type !== 'code' && mayHaveWikiLinks(item.content)) {
    void actApplyWikiLinks(item.id, item.content, { silent: true })
  }
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

// ───────────────────────── распознанный текст ─────────────────────────

/** Пояснение к успешному итогу: не все страницы или оборванный текст. */
function recognizedDescription(outcome: OcrOutcome): string | undefined {
  const parts: string[] = []
  const fromLayer = outcome.via === 'text-layer'
  if (outcome.pages && outcome.pages.read < outcome.pages.total) {
    const { read, total } = outcome.pages
    parts.push(
      fromLayer ? `Текст взят из первых ${read} из ${total} страниц` : `Распознаны первые ${read} из ${total} страниц`,
    )
  }
  if (outcome.truncated) {
    parts.push(fromLayer ? 'Текст PDF слишком длинный — сохранено начало' : 'Ответ модели оборван, текст неполный')
  }
  return parts.length ? parts.join('. ') : undefined
}

/**
 * Кнопки «Распознать текст», «Распознать заново», «Повторить» в подробностях записи. Запись в корзине или без
 * вложения для распознавания — ничего. Картинка при недоступном ИИ — toast с причиной, без запроса; PDF при
 * недоступном ИИ разбирается только локально (текстовый слой). Итог — toast и примечание в состоянии сеанса.
 */
export async function actRecognize(item: Item): Promise<void> {
  if (item.deletedAt !== undefined) return
  const kind = ocrKindOf(item)
  if (!kind) return
  let blocked: string | null
  try {
    blocked = visionAvailability(await getSettings())
  } catch (e) {
    toast.error(describeError(e))
    return
  }
  if (kind === 'image' && blocked !== null) {
    toast.error(blocked)
    return
  }
  setOcrNote(item.id, null)
  let outcome: OcrOutcome
  try {
    outcome = await extractItemText(item, { vision: blocked === null, force: true })
  } catch (e) {
    // extractItemText не бросает по контракту; на всякий случай — тот же путь, что у failed.
    outcome = { status: 'failed', error: describeError(e, 'Не удалось распознать текст') }
  }
  switch (outcome.status) {
    case 'ok': {
      const title = outcome.via === 'text-layer' ? 'Текст извлечён из PDF' : 'Текст распознан'
      const description = recognizedDescription(outcome)
      if (description) toast.success(title, { description })
      else toast.success(title)
      return
    }
    case 'empty':
      setOcrNote(item.id, { status: 'empty', at: Date.now() })
      toast('Текст не найден')
      return
    case 'failed': {
      const error = outcome.error || 'Не удалось распознать текст'
      setOcrNote(item.id, { status: 'failed', error, at: Date.now() })
      toast.error(error)
      return
    }
    case 'skipped':
      // отмена или задача уже идёт — сообщать нечего
      return
  }
}

/** «Отменить» у идущего или ждущего распознавания. */
export function actCancelRecognize(id: string): void {
  getOcrJob(id)?.cancel?.()
}

/** Правка распознанного текста; пустой текст равен очистке (отметка «текст убрал пользователь»). */
export async function actSaveOcrText(id: string, text: string): Promise<void> {
  await safe(async () => {
    const saved = cleanOcrText(text) ? await setOcrText(id, text) : await clearOcrText(id)
    if (!saved) throw new Error('Запись не найдена')
  })
}

/** Очищает распознанный текст; «Отменить» возвращает прежний. Текста нет — ничего. */
export async function actClearOcrText(item: Item): Promise<void> {
  await safe(async () => {
    const previous = (await getItem(item.id))?.ocrText
    if (!previous) return
    // Не setOcrText(''): PDF со слоем без текста неотличим от скана и ушёл бы в ИИ.
    if (!(await clearOcrText(item.id))) return
    toast('Распознанный текст очищен', {
      action: {
        label: 'Отменить',
        onClick: () => {
          void safe(() => setOcrText(item.id, previous))
        },
      },
    })
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

export async function actToggleFavorite(item: Item): Promise<void> {
  await safe(() => toggleFavorite(item.id))
}

// ───────────────────────── корзина ─────────────────────────

const counted = (message: string, n: number): string => (n > 1 ? `${message}: ${n}` : message)

/** Переносит записи в корзину. */
export async function actDelete(ids: string | string[]): Promise<void> {
  await safe(async () => {
    const list = toArray(ids)
    if (list.length === 0) return
    const snapshots = await deleteItems(list)
    if (snapshots.length === 0) return
    toast(counted('В корзине', snapshots.length), {
      action: {
        label: 'Отменить',
        onClick: () => {
          void safe(() => restoreItems(snapshots))
        },
      },
    })
  })
}

export async function actRestoreFromTrash(ids: string | string[]): Promise<void> {
  await safe(async () => {
    const list = [...new Set(toArray(ids))]
    // restoreFromTrash молча пропускает то, чего в корзине нет, — считаем сами, что действительно вернётся.
    let n = 0
    for (const id of list) {
      if ((await getItem(id))?.deletedAt !== undefined) n++
    }
    if (n === 0) return
    await restoreFromTrash(list)
    toast(counted('Восстановлено', n))
  })
}

/** Окончательное удаление без отмены; подтверждение — на стороне вызывающего. */
export async function actPurge(ids: string | string[]): Promise<void> {
  await safe(async () => {
    const list = toArray(ids)
    if (list.length === 0) return
    const n = await purgeItems(list)
    if (n > 0) toast(counted('Удалено навсегда', n))
  })
}

/** Окончательно удаляет всё из корзины; подтверждение — на стороне вызывающего. */
export async function actEmptyTrash(): Promise<void> {
  await safe(async () => {
    const n = await emptyTrash()
    if (n > 0) toast(`Корзина очищена: ${n}`)
  })
}

const PURGE_TAIL = 'без возможности восстановления.'

/** Записи из списка, которые сейчас лежат в корзине (по базе, а не по снимку списка). */
async function trashedNow(ids: string[]): Promise<Item[]> {
  const items = await Promise.all(ids.map((id) => getItem(id)))
  return items.filter((it): it is Item => it?.deletedAt !== undefined)
}

/**
 * Подтверждение → actPurge. Одна запись: «Запись «<заголовок>» будет удалена без возможности восстановления.»;
 * несколько: «Записей: N. Они будут удалены без возможности восстановления.» Считаются и удаляются только записи,
 * которые лежат в корзине: прочие пропускаются; нет ни одной — ничего не спрашивает.
 */
export async function actPurgeAsk(ids: string | string[]): Promise<void> {
  const list = [...new Set(toArray(ids))]
  if (list.length === 0) return
  // Список под клавишей или кнопкой мог устареть (E перед Del, другая вкладка): спрашиваем только про корзину.
  const trashed = await safe(() => trashedNow(list))
  if (!trashed?.length) return
  const description =
    trashed.length === 1
      ? `Запись «${displayTitle(trashed[0])}» будет удалена ${PURGE_TAIL}`
      : `Записей: ${trashed.length}. Они будут удалены ${PURGE_TAIL}`
  const ok = await confirmDialog({
    title: 'Удалить навсегда?',
    description,
    confirmLabel: 'Удалить навсегда',
    destructive: true,
  })
  if (!ok) return
  // Пока висел вопрос, записи могли восстановить: удаляем только то, что ещё в корзине.
  const still = await safe(() => trashedNow(trashed.map((it) => it.id)))
  if (still?.length) await actPurge(still.map((it) => it.id))
}

/** Подтверждение с числом записей в корзине → actEmptyTrash. Корзина пуста — ничего. */
export async function actEmptyTrashAsk(): Promise<void> {
  // Новых чтений базы нет: число берётся из общего снимка; снимка ещё нет — вопрос без числа.
  const count = getTrashedItemsSnapshot()?.length
  if (count === 0) return
  const ok = await confirmDialog({
    title: 'Очистить корзину?',
    description:
      count === undefined
        ? `Все записи в корзине будут удалены ${PURGE_TAIL}`
        : `Все записи в корзине (${count}) будут удалены ${PURGE_TAIL}`,
    confirmLabel: 'Очистить',
    destructive: true,
  })
  if (ok) await actEmptyTrash()
}

// ───────────────────────── сохранённые поиски ─────────────────────────

/** undefined — сохранить не удалось (причина уже показана в toast). */
export async function actSaveSearch(name: string, query: string): Promise<SavedSearch | undefined> {
  return safe(async () => {
    const search = await createSavedSearch(name, query)
    toast.success('Поиск сохранён')
    return search
  })
}

export async function actDeleteSearch(search: SavedSearch): Promise<void> {
  await safe(async () => {
    await deleteSavedSearch(search.id)
    toast('Поиск удалён', {
      action: {
        label: 'Отменить',
        onClick: () => {
          void safe(() => restoreSavedSearch(search))
        },
      },
    })
  })
}

export const NOTHING_TO_SAVE = 'Нечего сохранять: задайте поиск или фильтры'

/**
 * Сохраняет текущий отбор экрана (useUi + listCategories) вместе с разделом. Имя по умолчанию — suggestSearchName.
 * Нечего сохранять → toast.error. Тот же запрос уже сохранён → toast «Уже сохранён как «<имя>»», второй не создаётся.
 * undefined — не сохранено (причина уже в toast).
 */
export async function actSaveCurrentSearch(name?: string): Promise<SavedSearch | undefined> {
  const { view, query, filter, customDates } = useUi.getState()
  const prepared = await safe(async () => {
    const text = currentSearchQuery({ view, query, filter, customDates }, await listCategories())
    if (!text) return null
    const searches = await listSavedSearches()
    const existing = findSavedByQuery(searches, text)
    if (existing) return { existing }
    const finalName = name ?? suggestSearchName(text, searches.map((s) => s.name))
    return { name: finalName, query: text }
  })
  if (prepared === undefined) return undefined
  if (prepared === null) {
    toast.error(NOTHING_TO_SAVE)
    return undefined
  }
  if (prepared.existing) {
    toast(alreadySavedText(prepared.existing.name))
    return undefined
  }
  return actSaveSearch(prepared.name, prepared.query)
}

/** Разделы, куда поиск без своего раздела не применяется: у настроек нет списка, а корзина ищет только удалённое. */
const NO_LIST_VIEWS: ReadonlySet<View> = new Set<View>(['settings', 'trash'])

/**
 * Применяет сохранённый поиск: раздел — из самого запроса (viewForQuery), иначе текущий; из настроек и корзины
 * без своего раздела в запросе — «База знаний». В «Графе» поиск остаётся в «Графе» и приглушает ноды: свой
 * is:<раздел> в запросе — обычный оператор отбора, а не переход.
 */
export function actApplySearch(search: SavedSearch): void {
  const ui = useUi.getState()
  if (ui.view === 'graph') {
    // Раздел запроса запоминается: переход из «Графа» в этот раздел поиск не стирает.
    ui.applyQuery(search.query, 'graph', viewForQuery(search.query) ?? 'graph')
    return
  }
  const fallback: View = NO_LIST_VIEWS.has(ui.view) ? 'library' : ui.view
  ui.applyQuery(search.query, viewForQuery(search.query) ?? fallback)
}

/** Переименование; ошибка (пустое имя, дубль) — toast.error и false. */
export async function actRenameSearch(id: string, name: string): Promise<boolean> {
  const done = await safe(async () => {
    await updateSavedSearch(id, { name })
    return true
  })
  return done === true
}

/** Сдвиг поиска на одну позицию вверх (-1) или вниз (1); на краю списка — ничего. */
export async function actMoveSearch(id: string, delta: -1 | 1): Promise<void> {
  await safe(async () => {
    const ids = (await listSavedSearches()).map((s) => s.id)
    const from = ids.indexOf(id)
    const to = from + delta
    if (from === -1 || to < 0 || to >= ids.length) return
    ;[ids[from], ids[to]] = [ids[to], ids[from]]
    await reorderSavedSearches(ids)
  })
}

// ───────────────────────── вики-ссылки ─────────────────────────

/**
 * Создаёт связи для [[вики-ссылок]] из текста записи — только недостающие. Возвращает id новых связей.
 * Связи не снимает: удаление [[…]] из текста связь не рвёт.
 */
export async function applyWikiLinks(itemId: string, content: string, items: readonly Item[]): Promise<string[]> {
  const added: string[] = []
  await safe(async () => {
    const targets = wikiLinkTargets(content, items, itemId)
    if (targets.length === 0) return
    const self = await getItem(itemId)
    if (!self) return
    for (const target of targets) {
      if (self.links.includes(target)) continue
      await linkItems(itemId, target)
      // Снимок items мог устареть: linkItems молча пропускает запись, которой уже нет или которая в корзине.
      if ((await getItem(itemId))?.links.includes(target)) added.push(target)
    }
  })
  return added
}

/**
 * Дубль ссылки перед сохранением: по общему снимку, если он есть, иначе запросом к базе. Снимка нет сразу
 * после показа мини-окна (он сбрасывается через 2 с после скрытия), а «сочетание → вставка → Enter»
 * укладывается в это время — проверка по пустому снимку пропустила бы дубль. Ошибку чтения пробрасывает.
 */
export async function findDuplicateLinkNow(url: string): Promise<Item | undefined> {
  const snapshot = getAllItemsSnapshot()
  return snapshot ? findDuplicateLinkIn(snapshot, url) : findDuplicateLink(url)
}

/**
 * applyWikiLinks по снимку записей (getAllItemsSnapshot; снимка нет — прямое чтение); в тексте нет «[[» → [].
 * Сообщает о новых связях, если не silent: «Добавлена связь: «<заголовок>»» / «Добавлено связей: N».
 */
export async function actApplyWikiLinks(
  itemId: string,
  content: string,
  options: { silent?: boolean } = {},
): Promise<string[]> {
  if (typeof content !== 'string' || !mayHaveWikiLinks(content)) return []
  // Снимка нет (мини-окно сразу после показа) — читаем записи сами, иначе связи молча не создались бы.
  const items = getAllItemsSnapshot() ?? (await safe(listLiveItems))
  if (!items) return []
  const added = await applyWikiLinks(itemId, content, items)
  if (added.length === 0 || options.silent) return added
  if (added.length === 1) {
    const target = items.find((it) => it.id === added[0]) ?? (await safe(() => getItem(added[0])))
    toast(target ? `Добавлена связь: «${displayTitle(target)}»` : 'Добавлена связь')
  } else {
    toast(`Добавлено связей: ${added.length}`)
  }
  return added
}

/**
 * Открывает запись в её разделе: корзина → «Корзина», иначе раздел статуса. Раздел меняется, только если
 * запись не видна в текущем: «Избранное» показывает свою запись (не из архива и не из корзины) само.
 * «Граф» показывает все записи вне корзины: раздел не меняется, архивная запись включает показ архива.
 */
export function openItemInSection(
  item: Pick<Item, 'id' | 'status' | 'deletedAt'> & Partial<Pick<Item, 'favorite'>>,
): void {
  const ui = useUi.getState()
  const trashed = item.deletedAt !== undefined
  if (ui.view === 'graph' && !trashed) {
    if (item.status === 'archive') useGraph.getState().setShowArchive(true)
    ui.select(item.id)
    return
  }
  const target: View = trashed ? 'trash' : item.status
  const inFavorites = ui.view === 'favorites' && item.favorite === 1 && item.status !== 'archive' && !trashed
  if (ui.view !== target && !inFavorites) ui.setView(target)
  useUi.getState().select(item.id)
}

// ───────────────────────── граф ─────────────────────────

/** Сохраняет положение ноды после перетаскивания (updatedAt записи не меняется). Успех — молча. */
export async function actMoveNode(id: string, point: GraphPoint): Promise<void> {
  await safe(() => setPositions({ [id]: point }))
}

/**
 * Сохраняет положения группы нод одной пачкой (перенос ноды вместе с её категорией). prev — прежние положения:
 * «Отменить» возвращает их так же, одной пачкой.
 */
export async function actMoveGroup(moves: Record<string, GraphPoint>, prev: Record<string, GraphPoint>): Promise<void> {
  const count = Object.keys(moves).length
  if (count === 0) return
  await safe(async () => {
    await setPositions(moves)
    toast(movedCountText(count), {
      action: {
        label: 'Отменить',
        onClick: () => {
          void safe(() => setPositions(prev))
        },
      },
    })
  })
}

const isLinked = (a: Item | undefined, b: Item | undefined): boolean =>
  !!a && !!b && a.links.includes(b.id) && b.links.includes(a.id)

/** Связывает записи; уже связаны — сообщение без изменений. Отмена снимает связь. */
export async function actLinkItems(a: string, b: string): Promise<void> {
  if (a === b) return
  await safe(async () => {
    if (isLinked(await getItem(a), await getItem(b))) {
      toast('Записи уже связаны')
      return
    }
    await linkItems(a, b)
    // linkItems молча пропускает запись, которой уже нет или которая в корзине.
    if (!isLinked(await getItem(a), await getItem(b))) {
      toast.error('Не удалось связать записи')
      return
    }
    toast('Записи связаны', {
      action: {
        label: 'Отменить',
        onClick: () => {
          void safe(() => unlinkItems(a, b))
        },
      },
    })
  })
}

/** Снимает связь; связи не было — ничего. Отмена возвращает связь. */
export async function actUnlinkItems(a: string, b: string): Promise<void> {
  if (a === b) return
  await safe(async () => {
    const [ia, ib] = [await getItem(a), await getItem(b)]
    if (!ia?.links.includes(b) && !ib?.links.includes(a)) return
    await unlinkItems(a, b)
    toast('Связь убрана', {
      action: {
        label: 'Отменить',
        onClick: () => {
          void safe(() => linkItems(a, b))
        },
      },
    })
  })
}

/**
 * Категория записей (граф: клавиша E, меню). Ничего не изменилось — без toast. Иначе toast с «Отменить»:
 * возвращает прежние категории и прежние положения нод (setCategory сбрасывает место ноды).
 */
export async function actSetCategory(ids: string | string[], categoryId: string | null): Promise<void> {
  await safe(async () => {
    const before = new Map<string, string | null>()
    for (const id of new Set(toArray(ids))) {
      const it = await getItem(id)
      if (it && it.categoryId !== categoryId) before.set(id, it.categoryId)
    }
    if (before.size === 0) return
    const changed = [...before.keys()]
    const places = await getPositions()
    await setCategory(changed, categoryId)

    const name = categoryId ? (await listCategories()).find((c) => c.id === categoryId)?.name : undefined
    const base = categoryId ? `Категория: ${name ?? 'без названия'}` : 'Без категории'
    toast(before.size > 1 ? `${base} (${before.size})` : base, {
      action: {
        label: 'Отменить',
        onClick: () => {
          void safe(async () => {
            const groups = new Map<string | null, string[]>()
            for (const [id, prev] of before) groups.set(prev, [...(groups.get(prev) ?? []), id])
            for (const [prev, group] of groups) await setCategory(group, prev)
            // setCategory стёр места; setPositions (а не addPositions): явное возвращение побеждает
            // место в новой зоне, которое граф мог успеть выдать.
            const back: Record<string, GraphPoint> = {}
            for (const id of changed) if (places[id]) back[id] = places[id]
            await setPositions(back)
          })
        },
      },
    })
  })
}

/** «Разложить»: все положения стираются, граф раскладывается заново. Отмена возвращает прежние места. */
export async function actRelayoutGraph(): Promise<void> {
  await safe(async () => {
    const previous = await clearPositions()
    if (Object.keys(previous).length === 0) {
      toast('Граф разложен заново')
      return
    }
    toast('Граф разложен заново', {
      duration: 10_000,
      action: {
        label: 'Отменить',
        onClick: () => {
          void safe(() => setPositions(previous))
        },
      },
    })
  })
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
      // window.open в окне Tauri ничего не открывает (обработчика новых окон нет) — только сообщение.
      const { openExternal } = await import('@/lib/desktop')
      if (!(await openExternal(url))) toast.error('Не удалось открыть ссылку')
      return
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

/**
 * Одна запись файлом .md без вложений. План имён строится по всем записям, чтобы [[вики-ссылки]] и «Связанные»
 * указывали на те же имена, что при выгрузке всей базы в папку.
 */
export async function actDownloadMarkdown(item: Item): Promise<void> {
  await safe(async () => {
    // Отдельный чанк: экспорт нужен редко, а основной не должен тяжелеть.
    const { itemToMarkdown, planMarkdownExport } = await import('@/lib/markdownExport')
    const snapshot = getAllItemsSnapshot()
    const items = !snapshot ? [item] : snapshot.some((it) => it.id === item.id) ? snapshot : [...snapshot, item]
    const plan = planMarkdownExport(items)
    const entry = itemToMarkdown(item, { categories: await listCategories(), items, plan })
    saveBlob(new Blob([entry.markdown], { type: 'text/markdown;charset=utf-8' }), entry.path)
  })
}
