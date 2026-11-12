import { newId } from '@/lib/id'
import { db } from './db'
import {
  CATEGORY_COLORS,
  SAVED_SEARCH_NAME_MAX,
  SAVED_SEARCH_QUERY_MAX,
  type Category,
  type CategoryColor,
  type GraphPoint,
  type Item,
  type ItemPatch,
  type ItemStatus,
  type LinkMeta,
  type NewItemInput,
  type NodePosition,
  type SavedSearch,
  type SortMode,
  type StoredFile,
} from '@/types'
import { findDuplicateLinkIn } from '@/lib/dedupe'
import { normalizeUrl } from '@/lib/detect'
import { readableError } from '@/lib/errors'
import { displayTitle } from '@/lib/itemTitle'
import {
  categoryNameKey,
  cleanOcrText,
  hasForeignScheme,
  normalizeTag,
  normalizeTags,
  safeBlobType,
  safeImageUrl,
  safeLinkUrl,
  sanitizePoint,
  searchNameKey,
  settleLinkMeta,
} from '@/lib/normalize'

// Чистые правила живут в lib (единый источник для поиска, импорта и UI); репозиторий их реэкспортирует.
export { normalizeTag, normalizeTags } from '@/lib/normalize'
export { matchesFilter } from '@/lib/filter'

/**
 * Репозиторий — единственная точка записи в БД (кроме seed, импорта и настроек).
 * Держит инварианты: нормализованные теги, двунаправленные связи, каскад файлов,
 * prevStatus/processedAt, updatedAt на каждой мутации.
 *
 * Исключения из «updatedAt на каждой мутации» — правки, которые пользователь не делал руками и которые
 * не должны переиндексировать поиск и влиять на слияние копий: корзина (deletedAt), распознанный
 * текст (ocrText/ocrAt), техническая чистка связей при окончательном удалении.
 */

/**
 * Снимок записи на момент переноса в корзину — для «Отменить». Пока запись лежит в корзине,
 * отмена просто снимает deletedAt; file и linkedIds нужны, если запись успели удалить окончательно.
 */
export type DeletedSnapshot = {
  /** Запись до переноса в корзину (без deletedAt). */
  item: Item
  file?: StoredFile
  /** Связанные записи: links самой записи и обратные ссылки на неё. */
  linkedIds: string[]
}

const DAY_MS = 86_400_000

/** Максимальный размер превью по большей стороне, px. */
export const THUMB_MAX = 480

/**
 * Предельный размер одного файла. Резервная копия — один JSON с base64 внутри, а строка в
 * Chromium/WebView2 ограничена ~512 млн символов: файлы крупнее делают копию невосстановимой.
 */
export const MAX_FILE_SIZE = 100 * 1024 * 1024

// ───────────────────────── утилиты ─────────────────────────

function uid(): string {
  return newId()
}

function unique<T>(list: Iterable<T>): T[] {
  return [...new Set(list)]
}

function toIds(ids: string | string[]): string[] {
  return Array.isArray(ids) ? unique(ids) : [ids]
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * Адрес ссылки для записи в БД: схема по умолчанию https, допустимы только http/https/ftp —
 * javascript:, file: и обработчики протоколов открылись бы по клику. Пустой → undefined.
 */
function checkedLinkUrl(raw: string): string | undefined {
  const s = raw.trim()
  if (!s) return undefined
  const url = hasForeignScheme(s) ? undefined : safeLinkUrl(normalizeUrl(s))
  if (!url) throw new Error('Недопустимый адрес ссылки: поддерживаются только http, https и ftp')
  return url
}

/** Картинка и иконка страницы грузятся в <img> без действия пользователя — только http(s). */
function cleanLinkMeta(meta: LinkMeta): LinkMeta {
  const out: LinkMeta = { ...meta }
  if (out.image !== undefined && !safeImageUrl(out.image)) delete out.image
  if (out.favicon !== undefined && !safeImageUrl(out.favicon)) delete out.favicon
  return out
}

// ───────────────────────── превью изображений ─────────────────────────

/**
 * Уменьшенная копия изображения (до `max` px по большей стороне).
 * Возвращает undefined, если превью не нужно или невозможно (нет API, SVG, битый файл,
 * картинка и так маленькая) — тогда UI показывает исходный blob.
 */
export async function makeThumb(blob: Blob, max = THUMB_MAX): Promise<Blob | undefined> {
  return (await renderThumb(blob, max)).thumb
}

/**
 * Превью + удалось ли вообще декодировать картинку: decoded undefined — не пробовали
 * (нет API, не image/*, SVG), false — движок этот формат не понимает.
 * force — пробовать декодировать и при пустом/неточном MIME (HEIC, определённый по расширению).
 */
async function renderThumb(
  blob: Blob,
  max = THUMB_MAX,
  force = false,
): Promise<{ thumb?: Blob; decoded?: boolean }> {
  if (typeof createImageBitmap !== 'function') return {}
  // SVG — вектор: растровое превью хуже оригинала, а createImageBitmap для него ненадёжен.
  if ((!force && !blob.type.startsWith('image/')) || blob.type === 'image/svg+xml') return {}

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch {
    return { decoded: false }
  }
  return { thumb: await scaleBitmap(bitmap, blob.type, max), decoded: true }
}

async function scaleBitmap(bitmap: ImageBitmap, type: string, max: number): Promise<Blob | undefined> {
  try {
    const { width, height } = bitmap
    if (!width || !height) return undefined
    const scale = max / Math.max(width, height)
    // Маленькие картинки не трогаем: оригинал лёгкий, а GIF сохранит анимацию.
    if (scale >= 1) return undefined

    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    // Если исходник может быть прозрачным, а webp не поддерживается (Safari), берём png, иначе jpeg.
    const fallbackType = /png|gif|webp|avif/.test(type) ? 'image/png' : 'image/jpeg'

    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(w, h)
      const ctx = canvas.getContext('2d')
      if (!ctx) return undefined
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bitmap, 0, 0, w, h)
      const webp = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 })
      if (webp.type === 'image/webp') return webp
      return await canvas.convertToBlob({ type: fallbackType, quality: 0.82 })
    }

    if (typeof document !== 'undefined') {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return undefined
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bitmap, 0, 0, w, h)
      const toBlob = (type: string, quality: number) =>
        new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
      const webp = await toBlob('image/webp', 0.8)
      if (webp && webp.type === 'image/webp') return webp
      return (await toBlob(fallbackType, 0.82)) ?? undefined
    }
    return undefined
  } catch {
    return undefined
  } finally {
    bitmap.close()
  }
}

/**
 * Форматы, которые одни движки показывают (Safari/WKWebView), а другие нет (Chromium/WebView2).
 * detectFileType честно называет их картинкой, а создание записи проверяет декодированием.
 */
const UNCERTAIN_IMAGE_MIME = /^image\/(?:heic|heif|heic-sequence|heif-sequence|tiff|x-tiff)$/i
const UNCERTAIN_IMAGE_EXT = /\.(?:heic|heif|tiff?)$/i

function fileNameOf(file: Blob, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim()
  const name = (file as Partial<File>).name
  if (typeof name === 'string' && name) return name
  return 'file'
}

// ───────────────────────── записи ─────────────────────────

/**
 * Бросает Error, если адрес ссылки с недопустимой схемой или файл больше MAX_FILE_SIZE.
 * Изображение, которое этот движок не может декодировать (HEIC/TIFF в Chromium), сохраняется как 'file'.
 */
export async function createItem(input: NewItemInput): Promise<Item> {
  const now = Date.now()
  const id = uid()
  const status: ItemStatus = input.status ?? 'inbox'
  const url = input.url ? checkedLinkUrl(input.url) : undefined
  const hasFile = (input.type === 'file' || input.type === 'image') && !!input.file
  if (hasFile && input.file!.size > MAX_FILE_SIZE) {
    throw new Error(`Файл больше ${MAX_FILE_SIZE / 1024 / 1024} МБ — такой файл сохранить нельзя`)
  }

  const item: Item = {
    id,
    type: input.type,
    title: input.title?.trim() ?? '',
    content: input.content ?? '',
    categoryId: input.categoryId ?? null,
    tags: normalizeTags(input.tags ?? []),
    links: [],
    status,
    favorite: input.favorite ? 1 : 0,
    source: input.source ?? 'manual',
    createdAt: now,
    updatedAt: now,
  }
  if (url) item.url = url
  if (input.language) item.language = input.language
  if (status === 'library') item.processedAt = now
  if (input.fileName) item.fileName = input.fileName

  let stored: StoredFile | undefined
  if (hasFile && input.file) {
    const src = input.file
    const name = fileNameOf(src, input.fileName)
    const mimeType = src.type || 'application/octet-stream'
    // slice() превращает File в обычный Blob без копирования данных. Тип Blob — из белого списка
    // (HTML/XML по blob:-адресу исполнился бы в origin приложения); объявленный тип остаётся в mimeType.
    const blob = src.slice(0, src.size, safeBlobType(mimeType))
    // Превью строим ДО транзакции: await не-Dexie промиса внутри транзакции её закрывает.
    const uncertain = UNCERTAIN_IMAGE_MIME.test(mimeType) || UNCERTAIN_IMAGE_EXT.test(name)
    const { thumb, decoded } =
      input.type === 'image' || mimeType.startsWith('image/')
        ? await renderThumb(blob, THUMB_MAX, input.type === 'image' && uncertain)
        : {}
    // HEIC с айфона в Chromium/WebView2 не рисуется: в ленте была бы битая картинка — пусть будет файл.
    if (input.type === 'image' && uncertain && decoded === false) item.type = 'file'

    stored = {
      id: uid(),
      itemId: id,
      blob,
      name,
      mimeType,
      size: src.size,
      createdAt: now,
    }
    if (thumb) stored.thumb = thumb

    item.fileId = stored.id
    item.fileName = name
    item.fileSize = src.size
    item.mimeType = mimeType
  }

  try {
    await db.transaction('rw', db.items, db.files, async () => {
      if (stored) await db.files.add(stored)
      await db.items.add(item)
    })
  } catch (e) {
    // Крупный файл на почти заполненном хранилище: понятный текст вместо «AbortError».
    throw readableError(e)
  }
  return item
}

/** Необязательные поля записи: undefined в патче означает «сбросить». */
const CLEARABLE_FIELDS: ReadonlySet<string> = new Set<keyof ItemPatch>(['url', 'linkMeta', 'language', 'ai'])

/** Бросает Error, если адрес ссылки с недопустимой схемой. */
export async function updateItem(id: string, patch: ItemPatch): Promise<void> {
  const changes: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    // Dexie.update удаляет свойство со значением undefined: обязательные поля (tags, content, …)
    // так пропали бы, и всё, что их читает, падало бы. Пропускаем — «не менять».
    if (value === undefined && !CLEARABLE_FIELDS.has(key)) continue
    changes[key] = value
  }
  if (patch.tags) changes.tags = normalizeTags(patch.tags)
  if (typeof patch.title === 'string') changes.title = patch.title.trim()
  if (typeof patch.url === 'string') changes.url = checkedLinkUrl(patch.url)
  if (patch.linkMeta) changes.linkMeta = cleanLinkMeta(patch.linkMeta)
  changes.updatedAt = Date.now()
  const urlChange = typeof changes.url === 'string' && !Object.hasOwn(patch, 'linkMeta')
  const categoryChange = Object.hasOwn(changes, 'categoryId')
  try {
    if (!urlChange && !categoryChange) {
      await db.items.update(id, changes as Partial<Item>)
      return
    }
    await db.transaction('rw', db.items, db.positions, async () => {
      const current = await db.items.get(id)
      // Метаданные описывали прежнюю страницу: с новым адресом её заголовок и картинка неверны.
      if (urlChange && current && current.url !== changes.url) changes.linkMeta = undefined
      await db.items.update(id, changes as Partial<Item>)
      // Нода графа стоит в зоне своей категории: с новой категорией место подберёт раскладка.
      if (categoryChange && current && current.categoryId !== changes.categoryId) await db.positions.delete(id)
    })
  } catch (e) {
    throw readableError(e)
  }
}

/**
 * Записывает метаданные, загруженные для адреса url, только если у записи всё ещё этот адрес:
 * поздний ответ по прежнему адресу не должен затирать данные нового.
 * false — записи нет (удалена) или адрес сменился.
 */
export async function applyLinkMeta(id: string, url: string, meta: LinkMeta): Promise<boolean> {
  return db.transaction('rw', db.items, async () => {
    const current = await db.items.get(id)
    if (!current || current.url !== url) return false
    await db.items.update(id, { linkMeta: cleanLinkMeta(meta), updatedAt: Date.now() })
    return true
  })
}

export function getItem(id: string): Promise<Item | undefined> {
  return db.items.get(id)
}

export function getFile(fileId: string): Promise<StoredFile | undefined> {
  return db.files.get(fileId)
}

// ───────────────────────── корзина ─────────────────────────

/**
 * Снимок записи для «Отменить». Вызывать внутри транзакции по items и files, ДО любых правок:
 * иначе у связанных записей одного пакета в снимок попало бы уже изменённое состояние.
 */
async function takeSnapshot(item: Item): Promise<DeletedSnapshot> {
  // Файл ищем и по itemId, и по fileId: при рассинхроне одного из полей он всё равно попадёт в снимок.
  const byItem = await db.files.where('itemId').equals(item.id).toArray()
  const file = item.fileId
    ? (byItem.find((f) => f.id === item.fileId) ?? (await db.files.get(item.fileId)))
    : byItem[0]
  const backRefs = await db.items.where('links').equals(item.id).primaryKeys()
  const snapshot: DeletedSnapshot = {
    item,
    linkedIds: unique([...item.links, ...backRefs]).filter((x) => x !== item.id),
  }
  if (file) snapshot.file = file
  return snapshot
}

/** Переносит запись в корзину. Бросает, если записи нет или она уже в корзине. */
export async function deleteItem(id: string): Promise<DeletedSnapshot> {
  return db.transaction('rw', db.items, db.files, async () => {
    const [snapshot] = await deleteItems([id])
    if (snapshot) return snapshot
    throw new Error((await db.items.get(id)) ? 'Запись уже в корзине' : 'Запись не найдена')
  })
}

/**
 * Пакетный перенос в корзину в одной транзакции. Несуществующие и уже лежащие в корзине id пропускаются.
 * Меняется только deletedAt: updatedAt, status, связи (свои и у соседей), файл и положение на графе
 * остаются как были — восстановление возвращает запись байт-в-байт, а поиск её не переиндексирует.
 */
export async function deleteItems(ids: string[]): Promise<DeletedSnapshot[]> {
  const list = unique(ids)
  return db.transaction('rw', db.items, db.files, async () => {
    const items = (await db.items.bulkGet(list)).filter((x): x is Item => !!x && x.deletedAt === undefined)
    if (!items.length) return []
    const snapshots: DeletedSnapshot[] = []
    for (const item of items) snapshots.push(await takeSnapshot(item))
    const deletedAt = Date.now()
    for (const item of items) await db.items.update(item.id, { deletedAt })
    return snapshots
  })
}

/**
 * Возвращает запись из корзины; false — она и не была в корзине. Вызывать внутри транзакции по items.
 * Кроме deletedAt ничего не трогается: в БД — истина, запись могли править, пока она лежала в корзине.
 */
async function takeOutOfTrash(current: Item): Promise<boolean> {
  if (current.deletedAt === undefined) return false
  const changes: Partial<Item> = { deletedAt: undefined }
  // Загрузка метаданных, шедшая во время удаления, могла оборваться: без этого «загрузка» висела бы
  // вечно. Если запрос ещё идёт, его результат запишется поверх.
  if (current.linkMeta?.status === 'pending') changes.linkMeta = settleLinkMeta(current.linkMeta)
  await db.items.update(current.id, changes)
  return true
}

/** Возвращает записи из корзины. Несуществующие и не лежащие в корзине id пропускаются. */
export async function restoreFromTrash(ids: string | string[]): Promise<void> {
  const list = toIds(ids)
  await db.transaction('rw', db.items, async () => {
    for (const it of await db.items.bulkGet(list)) {
      if (it) await takeOutOfTrash(it)
    }
  })
}

/**
 * Отмена удаления. Запись ещё в корзине — возвращается оттуда как есть. Её успели удалить
 * окончательно — воссоздаётся из снимка: исходные даты, файл, связи — только с теми записями,
 * что ещё существуют; исчезнувшая категория сбрасывается в null; положение на графе не возвращается.
 * updatedAt соседей не меняется: отмена — «как будто ничего не было».
 */
export async function restoreItem(snapshot: DeletedSnapshot): Promise<void> {
  await restoreItems([snapshot])
}

export async function restoreItems(snapshots: DeletedSnapshot[]): Promise<void> {
  try {
    await restoreItemsTx(snapshots)
  } catch (e) {
    throw readableError(e)
  }
}

async function restoreItemsTx(snapshots: DeletedSnapshot[]): Promise<void> {
  await db.transaction('rw', [db.items, db.files, db.categories], async () => {
    // Сначала кладём все записи, чтобы связи между воссоздаваемыми тоже вернулись.
    const recreated: DeletedSnapshot[] = []
    for (const snapshot of snapshots) {
      const { item, file } = snapshot
      const current = await db.items.get(item.id)
      if (current) {
        await takeOutOfTrash(current)
        continue
      }
      const categoryId =
        item.categoryId && (await db.categories.get(item.categoryId)) ? item.categoryId : null
      const restored: Item = { ...item, categoryId, links: [] }
      delete restored.deletedAt
      if (restored.linkMeta) restored.linkMeta = settleLinkMeta(restored.linkMeta)
      await db.items.put(restored)
      if (file) await db.files.put(file)
      recreated.push(snapshot)
    }
    for (const { item, linkedIds } of recreated) {
      const candidates = unique([...item.links, ...linkedIds]).filter((x) => x !== item.id)
      const existing = (await db.items.bulkGet(candidates)).filter((x): x is Item => !!x)
      const self = await db.items.get(item.id)
      if (!self) continue
      const links = unique([...self.links, ...existing.map((o) => o.id)])
      await db.items.update(item.id, { links })
      for (const other of existing) {
        if (other.links.includes(item.id)) continue
        await db.items.update(other.id, { links: [...other.links, item.id] })
      }
    }
  })
}

/**
 * Окончательное удаление любых существующих записей (в корзине или нет) в одной транзакции:
 * файлы, положения на графе и ссылки на удалённые у оставшихся записей. Возвращает число удалённых.
 * Ссылки убираются без смены updatedAt соседей: это техническая правка связей (как repairIntegrity
 * при импорте), пользователь эти записи не менял.
 */
export async function purgeItems(ids: string | string[]): Promise<number> {
  const list = toIds(ids)
  return db.transaction('rw', db.items, db.files, db.positions, async () => {
    const items = (await db.items.bulkGet(list)).filter((x): x is Item => !!x)
    if (!items.length) return 0
    const gone = new Set(items.map((it) => it.id))
    const goneIds = [...gone]

    // Файл ищем и по itemId, и по fileId: на случай рассинхрона удаляем оба.
    const fileIds = await db.files.where('itemId').anyOf(goneIds).primaryKeys()
    for (const it of items) {
      if (it.fileId) fileIds.push(it.fileId)
    }

    const backRefs = await db.items.where('links').anyOf(goneIds).primaryKeys()
    const neighbourIds = unique([...items.flatMap((it) => it.links), ...backRefs]).filter((x) => !gone.has(x))
    for (const other of await db.items.bulkGet(neighbourIds)) {
      if (!other) continue
      const links = other.links.filter((l) => !gone.has(l))
      if (links.length !== other.links.length) await db.items.update(other.id, { links })
    }

    await db.files.bulkDelete(unique(fileIds))
    await db.positions.bulkDelete(goneIds)
    await db.items.bulkDelete(goneIds)
    return items.length
  })
}

/** Окончательно удаляет всё, что лежит в корзине. Возвращает число удалённых записей. */
export async function emptyTrash(): Promise<number> {
  return db.transaction('rw', db.items, db.files, db.positions, async () =>
    purgeItems(await db.items.where('deletedAt').above(0).primaryKeys()),
  )
}

/**
 * Автоочистка: окончательно удаляет записи, пролежавшие в корзине days суток и дольше
 * (граница включительно). days не конечное или ≤ 0 — автоочистка выключена, возвращает 0.
 */
export async function purgeExpired(days: number, now: number = Date.now()): Promise<number> {
  if (!Number.isFinite(days) || days <= 0) return 0
  const limit = now - days * DAY_MS
  if (!Number.isFinite(limit)) return 0
  return db.transaction('rw', db.items, db.files, db.positions, async () =>
    purgeItems(await db.items.where('deletedAt').between(0, limit, false, true).primaryKeys()),
  )
}

// ───────────────────────── статусы ─────────────────────────

/**
 * Меняет статус. В archive — запоминает prevStatus; при выходе из архива prevStatus сбрасывается.
 * В library — ставит processedAt, если запись пришла из inbox (или ещё ни разу не обрабатывалась).
 */
export async function setStatus(ids: string | string[], status: ItemStatus): Promise<void> {
  const list = toIds(ids)
  await db.transaction('rw', db.items, async () => {
    const items = await db.items.bulkGet(list)
    const now = Date.now()
    for (const it of items) {
      if (!it || it.status === status) continue
      const changes: Partial<Item> = { status, updatedAt: now }
      if (status === 'archive') {
        changes.prevStatus = it.status as Exclude<ItemStatus, 'archive'>
      } else {
        changes.prevStatus = undefined
      }
      if (status === 'library' && (it.status === 'inbox' || it.processedAt === undefined)) {
        changes.processedAt = now
      }
      await db.items.update(it.id, changes)
    }
  })
}

/** Возвращает из архива туда, откуда запись пришла (по умолчанию — в базу знаний). */
export async function unarchive(ids: string | string[]): Promise<void> {
  const list = toIds(ids)
  await db.transaction('rw', db.items, async () => {
    const items = await db.items.bulkGet(list)
    const now = Date.now()
    for (const it of items) {
      if (!it || it.status !== 'archive') continue
      const target = it.prevStatus || 'library'
      const changes: Partial<Item> = { status: target, prevStatus: undefined, updatedAt: now }
      if (target === 'library' && it.processedAt === undefined) changes.processedAt = now
      await db.items.update(it.id, changes)
    }
  })
}

export async function toggleFavorite(id: string): Promise<void> {
  await db.transaction('rw', db.items, async () => {
    const it = await db.items.get(id)
    if (!it) return
    await db.items.update(id, { favorite: it.favorite ? 0 : 1, updatedAt: Date.now() })
  })
}

export async function setFavorite(ids: string | string[], favorite: boolean): Promise<void> {
  const list = toIds(ids)
  const value: 0 | 1 = favorite ? 1 : 0
  await db.transaction('rw', db.items, async () => {
    const items = await db.items.bulkGet(list)
    const now = Date.now()
    for (const it of items) {
      if (!it || it.favorite === value) continue
      await db.items.update(it.id, { favorite: value, updatedAt: now })
    }
  })
}

export async function setCategory(ids: string | string[], categoryId: string | null): Promise<void> {
  const list = toIds(ids)
  await db.transaction('rw', db.items, db.positions, async () => {
    const items = await db.items.bulkGet(list)
    const now = Date.now()
    const moved: string[] = []
    for (const it of items) {
      if (!it || it.categoryId === categoryId) continue
      await db.items.update(it.id, { categoryId, updatedAt: now })
      moved.push(it.id)
    }
    // Нода графа стоит в зоне своей категории: с новой категорией место подберёт раскладка.
    await db.positions.bulkDelete(moved)
  })
}

// ───────────────────────── теги ─────────────────────────

export async function addTags(ids: string | string[], tags: string[]): Promise<void> {
  const list = toIds(ids)
  const add = normalizeTags(tags)
  if (!add.length) return
  await db.transaction('rw', db.items, async () => {
    const items = await db.items.bulkGet(list)
    const now = Date.now()
    for (const it of items) {
      if (!it) continue
      const next = unique([...it.tags, ...add])
      if (sameList(next, it.tags)) continue
      await db.items.update(it.id, { tags: next, updatedAt: now })
    }
  })
}

export async function removeTag(ids: string | string[], tag: string): Promise<void> {
  const list = toIds(ids)
  const t = normalizeTag(tag)
  if (!t) return
  await db.transaction('rw', db.items, async () => {
    const items = await db.items.bulkGet(list)
    const now = Date.now()
    for (const it of items) {
      if (!it || !it.tags.includes(t)) continue
      await db.items.update(it.id, { tags: it.tags.filter((x) => x !== t), updatedAt: now })
    }
  })
}

/** Переименование тега по всей базе. Если у записи уже есть целевой тег — сливается без дубля. */
export async function renameTag(from: string, to: string): Promise<void> {
  const f = normalizeTag(from)
  const t = normalizeTag(to)
  if (!f || !t || f === t) return
  await db.transaction('rw', db.items, async () => {
    const items = await db.items.where('tags').equals(f).toArray()
    const now = Date.now()
    for (const it of items) {
      const next = unique(it.tags.map((x) => (x === f ? t : x)))
      await db.items.update(it.id, { tags: next, updatedAt: now })
    }
  })
}

export async function deleteTag(tag: string): Promise<void> {
  const t = normalizeTag(tag)
  if (!t) return
  await db.transaction('rw', db.items, async () => {
    const items = await db.items.where('tags').equals(t).toArray()
    const now = Date.now()
    for (const it of items) {
      await db.items.update(it.id, { tags: it.tags.filter((x) => x !== t), updatedAt: now })
    }
  })
}

// ───────────────────────── связи ─────────────────────────

/** Двунаправленная связь. Самоссылки, связи с несуществующими записями и с записями в корзине игнорируются. */
export async function linkItems(a: string, b: string): Promise<void> {
  if (a === b) return
  await db.transaction('rw', db.items, async () => {
    const [ia, ib] = await db.items.bulkGet([a, b])
    if (!ia || !ib || ia.deletedAt !== undefined || ib.deletedAt !== undefined) return
    const now = Date.now()
    if (!ia.links.includes(b)) await db.items.update(a, { links: [...ia.links, b], updatedAt: now })
    if (!ib.links.includes(a)) await db.items.update(b, { links: [...ib.links, a], updatedAt: now })
  })
}

export async function unlinkItems(a: string, b: string): Promise<void> {
  if (a === b) return
  await db.transaction('rw', db.items, async () => {
    const [ia, ib] = await db.items.bulkGet([a, b])
    const now = Date.now()
    if (ia?.links.includes(b)) {
      await db.items.update(a, { links: ia.links.filter((x) => x !== b), updatedAt: now })
    }
    if (ib?.links.includes(a)) {
      await db.items.update(b, { links: ib.links.filter((x) => x !== a), updatedAt: now })
    }
  })
}

// ───────────────────────── категории ─────────────────────────

export function listCategories(): Promise<Category[]> {
  return db.categories.orderBy('order').toArray()
}

/**
 * Создаёт категорию в конце списка. Если категория с таким именем (регистр, ё/е, дефисы
 * и лишние пробелы не важны — см. categoryNameKey) уже есть — возвращает её, а не плодит дубль.
 */
export async function createCategory(name: string, color?: CategoryColor): Promise<Category> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Название категории не может быть пустым')
  return db.transaction('rw', db.categories, async () => {
    const all = await db.categories.toArray()
    const key = categoryNameKey(trimmed)
    const existing = all.find((c) => categoryNameKey(c.name) === key)
    if (existing) return existing
    const category: Category = {
      id: uid(),
      name: trimmed,
      color: color ?? CATEGORY_COLORS[all.length % CATEGORY_COLORS.length],
      order: all.reduce((max, c) => Math.max(max, c.order), -1) + 1,
      createdAt: Date.now(),
    }
    await db.categories.add(category)
    return category
  })
}

/**
 * Бросает Error, если новое имя совпадает с именем другой категории (по categoryNameKey):
 * такие категории не различили бы ни cat:имя в поиске, ни импорт (склеил бы их при восстановлении).
 */
export async function updateCategory(
  id: string,
  patch: Partial<Pick<Category, 'name' | 'color' | 'order'>>,
): Promise<void> {
  // undefined не пишем: Dexie.update удалил бы обязательное поле категории.
  const changes: Partial<Pick<Category, 'name' | 'color' | 'order'>> = {}
  if (typeof patch.name === 'string' && patch.name.trim()) changes.name = patch.name.trim()
  if (patch.color !== undefined) changes.color = patch.color
  if (patch.order !== undefined) changes.order = patch.order
  if (!Object.keys(changes).length) return

  await db.transaction('rw', db.categories, async () => {
    if (changes.name !== undefined) {
      const key = categoryNameKey(changes.name)
      const clash = (await db.categories.toArray()).find((c) => c.id !== id && categoryNameKey(c.name) === key)
      if (clash) throw new Error(`Категория «${clash.name}» уже есть`)
    }
    await db.categories.update(id, changes)
  })
}

/** Удаляет категорию; её записи (в т.ч. в корзине) остаются «без категории» и теряют место на графе. */
export async function deleteCategory(id: string): Promise<void> {
  await db.transaction('rw', db.categories, db.items, db.positions, async () => {
    const now = Date.now()
    const ids = await db.items.where('categoryId').equals(id).primaryKeys()
    await db.items.where('categoryId').equals(id).modify({ categoryId: null, updatedAt: now })
    await db.positions.bulkDelete(ids)
    await db.categories.delete(id)
  })
}

// ───────────────────────── положения нод графа ─────────────────────────

/**
 * Сохраняет положения нод. Негодные точки и id, которых нет среди записей, пропускаются.
 * Таблица items только читается: updatedAt не меняется, список записей не перечитывается.
 */
export async function setPositions(map: Record<string, GraphPoint>): Promise<void> {
  const rows: NodePosition[] = []
  for (const [id, raw] of Object.entries(map)) {
    const point = sanitizePoint(raw)
    if (id && point) rows.push({ id, x: point.x, y: point.y })
  }
  if (!rows.length) return
  await db.transaction('rw', db.positions, db.items, async () => {
    const known = new Set(
      await db.items
        .where('id')
        .anyOf(rows.map((r) => r.id))
        .primaryKeys(),
    )
    await db.positions.bulkPut(rows.filter((r) => known.has(r.id)))
  })
}

export async function getPositions(): Promise<Record<string, GraphPoint>> {
  const rows = await db.positions.toArray()
  // fromEntries создаёт собственные свойства: id «__proto__» не подменит прототип объекта.
  return Object.fromEntries(rows.map((r) => [r.id, { x: r.x, y: r.y }]))
}

export async function removePositions(ids: string | string[]): Promise<void> {
  await db.positions.bulkDelete(toIds(ids))
}

/** Удаляет все положения («Разложить заново») и возвращает прежние — для «Отменить» через setPositions. */
export async function clearPositions(): Promise<Record<string, GraphPoint>> {
  return db.transaction('rw', db.positions, async () => {
    const previous = await getPositions()
    await db.positions.clear()
    return previous
  })
}

// ───────────────────────── сохранённые поиски ─────────────────────────

export function listSavedSearches(): Promise<SavedSearch[]> {
  return db.searches.orderBy('order').toArray()
}

function checkedSearchName(raw: string): string {
  const name = raw.trim()
  if (!name) throw new Error('Название не может быть пустым')
  if (name.length > SAVED_SEARCH_NAME_MAX) throw new Error('Слишком длинное название')
  return name
}

function checkedSearchQuery(raw: string): string {
  const query = raw.trim()
  if (!query) throw new Error('Запрос пуст — сохранять нечего')
  if (query.length > SAVED_SEARCH_QUERY_MAX) throw new Error('Слишком длинный запрос')
  return query
}

/** Поиск с таким же именем (по searchNameKey) среди all, кроме записи exceptId. */
function findSearchByName(all: readonly SavedSearch[], name: string, exceptId?: string): SavedSearch | undefined {
  const key = searchNameKey(name)
  return all.find((s) => s.id !== exceptId && searchNameKey(s.name) === key)
}

/** Бросает Error с русским текстом: пустое или слишком длинное имя/запрос, имя занято другим поиском. */
export async function createSavedSearch(name: string, query: string): Promise<SavedSearch> {
  const search: SavedSearch = {
    id: uid(),
    name: checkedSearchName(name),
    query: checkedSearchQuery(query),
    order: 0,
    createdAt: Date.now(),
  }
  return db.transaction('rw', db.searches, async () => {
    const all = await db.searches.toArray()
    const clash = findSearchByName(all, search.name)
    if (clash) throw new Error(`Поиск «${clash.name}» уже есть`)
    search.order = all.reduce((max, s) => Math.max(max, s.order), -1) + 1
    await db.searches.add(search)
    return search
  })
}

/** undefined в патче — «не менять»; несуществующий id — ничего. Ошибки — как у createSavedSearch. */
export async function updateSavedSearch(
  id: string,
  patch: Partial<Pick<SavedSearch, 'name' | 'query'>>,
): Promise<void> {
  await db.transaction('rw', db.searches, async () => {
    const all = await db.searches.toArray()
    if (!all.some((s) => s.id === id)) return
    const changes: Partial<Pick<SavedSearch, 'name' | 'query'>> = {}
    if (patch.name !== undefined) {
      changes.name = checkedSearchName(patch.name)
      const clash = findSearchByName(all, changes.name, id)
      if (clash) throw new Error(`Поиск «${clash.name}» уже есть`)
    }
    if (patch.query !== undefined) changes.query = checkedSearchQuery(patch.query)
    if (Object.keys(changes).length) await db.searches.update(id, changes)
  })
}

export async function deleteSavedSearch(id: string): Promise<void> {
  await db.searches.delete(id)
}

/**
 * Новый порядок: перечисленные id — в начале, в заданном порядке; не перечисленные — после них
 * в прежнем относительном порядке. Неизвестные id игнорируются.
 */
export async function reorderSavedSearches(ids: string[]): Promise<void> {
  await db.transaction('rw', db.searches, async () => {
    const all = await db.searches.orderBy('order').toArray()
    const byId = new Map(all.map((s) => [s.id, s]))
    const head = unique(ids).filter((id) => byId.has(id))
    const listed = new Set(head)
    const next = [...head, ...all.filter((s) => !listed.has(s.id)).map((s) => s.id)]
    for (const [order, id] of next.entries()) {
      if (byId.get(id)?.order !== order) await db.searches.update(id, { order })
    }
  })
}

/** Отмена удаления поиска: возвращает его как есть; если имя за это время заняли — с суффиксом « (2)», « (3)»… */
export async function restoreSavedSearch(search: SavedSearch): Promise<void> {
  await db.transaction('rw', db.searches, async () => {
    const all = await db.searches.toArray()
    let name = search.name
    for (let n = 2; findSearchByName(all, name, search.id); n++) name = `${search.name} (${n})`
    await db.searches.put({ ...search, name })
  })
}

// ───────────────────────── распознанный текст и дубли ссылок ─────────────────────────

/**
 * Записывает текст, извлечённый из вложения. Пустой (после очистки) текст удаляет ocrText, но отметка
 * ocrAt остаётся: «пробовали, текста нет» — автораспознавание не повторяется.
 * updatedAt не меняется (пользователь запись не правил); поиск узнаёт об изменении по ocrAt.
 * false — записи нет.
 */
export async function setOcrText(id: string, text: string, at?: number): Promise<boolean> {
  const ocrText = cleanOcrText(text)
  return db.transaction('rw', db.items, async () => {
    if (!(await db.items.get(id))) return false
    await db.items.update(id, { ocrText: ocrText || undefined, ocrAt: at ?? Date.now() })
    return true
  })
}

/** Запись с тем же адресом (правила — lib/dedupe): без корзины и без excludeId. */
export async function findDuplicateLink(url: string, excludeId?: string): Promise<Item | undefined> {
  return findDuplicateLinkIn(await db.items.where('type').equals('link').toArray(), url, excludeId)
}

// ───────────────────────── сортировка (чистая) ─────────────────────────
// matchesFilter — в lib/filter (реэкспорт в начале файла).

/**
 * Заголовок для сортировки — тот же, что видит пользователь (displayTitle, в т.ч. url у ссылки
 * без заголовка). Пустая строка — у записи нет ничего, кроме «Без названия»: такие идут в конец.
 */
function sortTitle(item: Item): string {
  const sources = [item.title, item.linkMeta?.title, item.fileName, item.content, item.url]
  return sources.some((s) => s?.trim()) ? displayTitle(item) : ''
}

const collator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true })

/** Возвращает новый отсортированный массив, исходный не мутирует. */
export function sortItems(items: Item[], sort: SortMode): Item[] {
  const out = [...items]
  switch (sort) {
    case 'newest':
      return out.sort((a, b) => b.createdAt - a.createdAt)
    case 'oldest':
      return out.sort((a, b) => a.createdAt - b.createdAt)
    case 'updated':
      return out.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)
    case 'title': {
      const keys = new Map(out.map((it) => [it.id, sortTitle(it)]))
      return out.sort((a, b) => {
        const ka = keys.get(a.id) ?? ''
        const kb = keys.get(b.id) ?? ''
        // Записи без заголовка — в конец.
        if (!ka !== !kb) return ka ? -1 : 1
        return collator.compare(ka, kb) || b.createdAt - a.createdAt
      })
    }
    default:
      return out
  }
}
