import { newId } from '@/lib/id'
import { db } from './db'
import {
  CATEGORY_COLORS,
  type Category,
  type CategoryColor,
  type Item,
  type ItemPatch,
  type ItemStatus,
  type LinkMeta,
  type NewItemInput,
  type SortMode,
  type StoredFile,
} from '@/types'
import { normalizeUrl } from '@/lib/detect'
import { readableError } from '@/lib/errors'
import { displayTitle } from '@/lib/itemTitle'
import {
  categoryNameKey,
  hasForeignScheme,
  normalizeTag,
  normalizeTags,
  safeBlobType,
  safeImageUrl,
  safeLinkUrl,
  settleLinkMeta,
} from '@/lib/normalize'

// Чистые правила живут в lib (единый источник для поиска, импорта и UI); репозиторий их реэкспортирует.
export { normalizeTag, normalizeTags } from '@/lib/normalize'
export { matchesFilter } from '@/lib/filter'

/**
 * Репозиторий — единственная точка записи в БД (кроме seed, импорта и настроек).
 * Держит инварианты: нормализованные теги, двунаправленные связи, каскад файлов,
 * prevStatus/processedAt, updatedAt на каждой мутации.
 */

/** Снимок удалённой записи для «Отменить». */
export type DeletedSnapshot = {
  item: Item
  file?: StoredFile
  /** Записи, которые ссылались на удалённую (обратные связи). */
  linkedIds: string[]
}

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
  try {
    if (typeof changes.url !== 'string' || Object.hasOwn(patch, 'linkMeta')) {
      await db.items.update(id, changes as Partial<Item>)
      return
    }
    await db.transaction('rw', db.items, async () => {
      const current = await db.items.get(id)
      // Метаданные описывали прежнюю страницу: с новым адресом её заголовок и картинка неверны.
      if (current && current.url !== changes.url) changes.linkMeta = undefined
      await db.items.update(id, changes as Partial<Item>)
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

/** Удаляет запись, её файл и обратные связи. Бросает, если записи нет. */
export async function deleteItem(id: string): Promise<DeletedSnapshot> {
  const [snapshot] = await deleteItems([id])
  if (!snapshot) throw new Error('Запись не найдена')
  return snapshot
}

/**
 * Пакетное удаление в одной транзакции. Несуществующие id пропускаются.
 * Обратные ссылки убираются у оставшихся записей без смены их updatedAt: это техническая правка
 * связей (как repairIntegrity при импорте), пользователь эти записи не менял.
 */
export async function deleteItems(ids: string[]): Promise<DeletedSnapshot[]> {
  const list = unique(ids)
  return db.transaction('rw', db.items, db.files, async () => {
    // Снимки строим из исходных записей ДО любых правок: иначе у связанных записей одного пакета
    // в снимок попали бы уже урезанные links, и отмена вернула бы их не такими, какими они были.
    const items = (await db.items.bulkGet(list)).filter((x): x is Item => !!x)
    if (!items.length) return []
    const gone = new Set(items.map((it) => it.id))

    const snapshots: DeletedSnapshot[] = []
    const fileIds: string[] = []
    for (const item of items) {
      // Файл ищем и по itemId, и по fileId: на случай рассинхрона удаляем оба.
      const byItem = await db.files.where('itemId').equals(item.id).toArray()
      const file = item.fileId
        ? (byItem.find((f) => f.id === item.fileId) ?? (await db.files.get(item.fileId)))
        : byItem[0]
      fileIds.push(...byItem.map((f) => f.id), ...(item.fileId ? [item.fileId] : []))

      const backRefs = await db.items.where('links').equals(item.id).primaryKeys()
      const linkedIds = unique([...item.links, ...backRefs]).filter((x) => x !== item.id)
      const snapshot: DeletedSnapshot = { item, linkedIds }
      if (file) snapshot.file = file
      snapshots.push(snapshot)
    }

    const neighbourIds = unique(snapshots.flatMap((s) => s.linkedIds)).filter((x) => !gone.has(x))
    for (const other of await db.items.bulkGet(neighbourIds)) {
      if (!other) continue
      const links = other.links.filter((l) => !gone.has(l))
      if (links.length !== other.links.length) await db.items.update(other.id, { links })
    }

    await db.files.bulkDelete(unique(fileIds))
    await db.items.bulkDelete([...gone])
    return snapshots
  })
}

/**
 * Отмена удаления: возвращает запись (с исходными датами), файл и связи —
 * только с теми записями, что ещё существуют. Исчезнувшая категория сбрасывается в null.
 * updatedAt соседей не меняется: удаление его не трогало, отмена — «как будто ничего не было».
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
    // Сначала кладём все записи, чтобы связи между восстанавливаемыми тоже вернулись.
    for (const { item, file } of snapshots) {
      const categoryId =
        item.categoryId && (await db.categories.get(item.categoryId)) ? item.categoryId : null
      const restored: Item = { ...item, categoryId, links: [] }
      // Ответ загрузки, шедшей во время удаления, мог прийти и пропасть: без этого «загрузка» висела бы
      // вечно. Если запрос ещё идёт, его результат запишется поверх.
      if (restored.linkMeta) restored.linkMeta = settleLinkMeta(restored.linkMeta)
      await db.items.put(restored)
      if (file) await db.files.put(file)
    }
    for (const { item, linkedIds } of snapshots) {
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
  await db.transaction('rw', db.items, async () => {
    const items = await db.items.bulkGet(list)
    const now = Date.now()
    for (const it of items) {
      if (!it || it.categoryId === categoryId) continue
      await db.items.update(it.id, { categoryId, updatedAt: now })
    }
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

/** Двунаправленная связь. Самоссылки и связи с несуществующими записями игнорируются. */
export async function linkItems(a: string, b: string): Promise<void> {
  if (a === b) return
  await db.transaction('rw', db.items, async () => {
    const [ia, ib] = await db.items.bulkGet([a, b])
    if (!ia || !ib) return
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

/** Удаляет категорию; её записи остаются «без категории». */
export async function deleteCategory(id: string): Promise<void> {
  await db.transaction('rw', db.categories, db.items, async () => {
    const now = Date.now()
    await db.items.where('categoryId').equals(id).modify({ categoryId: null, updatedAt: now })
    await db.categories.delete(id)
  })
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
