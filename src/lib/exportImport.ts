import { db } from '@/db/db'
import { normalizeUrl } from '@/lib/detect'
import { readableError } from '@/lib/errors'
import {
  categoryNameKey,
  hasForeignScheme,
  normalizeTags,
  safeBlobType,
  safeLinkUrl,
  safeThumbType,
  settleLinkMeta,
} from '@/lib/normalize'
import {
  CATEGORY_COLORS,
  DEFAULT_SETTINGS,
  ITEM_STATUSES,
  ITEM_TYPES,
  type AiMeta,
  type Category,
  type Item,
  type ItemSource,
  type LinkMeta,
  type MetaRecord,
  type Settings,
  type StoredFile,
} from '@/types'

/**
 * Резервная копия QuickDrop: один JSON-файл, бинарники внутри в base64.
 * Секреты (aiApiKey), служебный флаг seeded и сетевые настройки в копию не попадают никогда
 * (см. PRIVATE_SETTINGS).
 */

export const BACKUP_APP = 'quickdrop'
export const BACKUP_VERSION = 1

/**
 * Предельный размер копии. Импорт читает файл одной строкой (file.text() + JSON.parse), а строка
 * в Chromium/WebView2 ограничена ~536 млн символов: копию крупнее нельзя было бы восстановить.
 * Берём с запасом и проверяем и при экспорте (заранее), и при импорте.
 */
export const MAX_BACKUP_BYTES = 480 * 1024 * 1024

export type ImportMode = 'merge' | 'replace'
export type ImportReport = { items: number; files: number; categories: number; skipped: number }

export interface BackupFileEntry {
  id: string
  itemId: string
  name: string
  mimeType: string
  size: number
  createdAt: number
  /** Содержимое файла в base64. */
  data: string
  /** Превью изображения в base64. */
  thumb?: string
  /** MIME превью (webp/png/jpeg — зависит от браузера, где оно сделано). */
  thumbType?: string
}

export interface BackupData {
  app: typeof BACKUP_APP
  version: number
  exportedAt: number
  settings?: Partial<Settings>
  categories: Category[]
  items: Item[]
  files: BackupFileEntry[]
}

/**
 * Настройки, которые не экспортируются и не импортируются: секрет, служебный флаг и всё, что
 * определяет, уходят ли данные в сеть и куда. Копия может быть чужой: aiBaseUrl/aiEnabled из неё
 * отправили бы локальный ключ и содержимое записей на чужой хост, linkProxyUrl — каждую новую ссылку
 * на чужой прокси, autoFetchLinkTitle — включил бы запросы, которые пользователь выключил;
 * к тому же шаблон прокси может содержать токен, которому не место в файле копии.
 */
export const PRIVATE_SETTINGS: ReadonlySet<string> = new Set<keyof Settings>([
  'aiApiKey',
  'seeded',
  'aiEnabled',
  'aiBaseUrl',
  'aiModel',
  'linkProxyUrl',
  'autoFetchLinkTitle',
])
const THEMES: readonly Settings['theme'][] = ['system', 'light', 'dark']
const ITEM_SOURCES: readonly ItemSource[] = ['manual', 'paste', 'drop', 'import', 'demo']
const LINK_META_STATUSES: readonly LinkMeta['status'][] = ['pending', 'ok', 'failed']

// ───────────────────────── имя файла ─────────────────────────

/** 'quickdrop-backup-YYYY-MM-DD.json' по локальной дате. */
export function backupFileName(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `quickdrop-backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`
}

// ───────────────────────── base64 ─────────────────────────

/**
 * String.fromCharCode.apply с огромным массивом переполняет стек, а в Safari есть лимит ~65536
 * аргументов — поэтому кодируем кусками. Размеры кратны 3 — куски base64 склеиваются без паддинга.
 */
const B64_CHUNK = 3 * 0x4000
/** Файл читается срезами, а не целиком: пик памяти не растёт с размером файла. */
const B64_READ_SLICE = 64 * B64_CHUNK

/** base64 файла по частям (каждая — до ~4 МБ); склеенные части — корректный base64 всего blob. */
async function* base64Parts(blob: Blob): AsyncGenerator<string> {
  for (let offset = 0; offset < blob.size; offset += B64_READ_SLICE) {
    const bytes = new Uint8Array(await blob.slice(offset, offset + B64_READ_SLICE).arrayBuffer())
    const parts: string[] = []
    for (let i = 0; i < bytes.length; i += B64_CHUNK) {
      const chunk = bytes.subarray(i, i + B64_CHUNK)
      parts.push(btoa(String.fromCharCode.apply(null, chunk as unknown as number[])))
    }
    yield parts.join('')
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const parts: string[] = []
  for await (const part of base64Parts(blob)) parts.push(part)
  return parts.join('')
}

const base64Length = (bytes: number) => Math.ceil(bytes / 3) * 4

/** Бросает на некорректном base64. */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64.replace(/\s+/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function isBlob(v: unknown): v is Blob {
  return typeof v === 'object' && v !== null && typeof (v as Blob).arrayBuffer === 'function'
}

// ───────────────────────── экспорт ─────────────────────────

/**
 * Запись файла копии отдельным Blob: base64 содержимого не склеивается в одну строку
 * (у крупного файла она упёрлась бы в предел длины строки), а части не копятся до конца экспорта.
 */
async function encodeFile(f: StoredFile): Promise<Blob | null> {
  if (!isBlob(f.blob)) return null
  const meta: Omit<BackupFileEntry, 'data'> = {
    id: f.id,
    itemId: f.itemId,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size,
    createdAt: f.createdAt,
  }
  if (isBlob(f.thumb)) {
    meta.thumb = await blobToBase64(f.thumb)
    if (f.thumb.type) meta.thumbType = f.thumb.type
  }
  const head = JSON.stringify(meta)
  const parts: BlobPart[] = [head.slice(0, -1), ',"data":"']
  for await (const part of base64Parts(f.blob)) parts.push(part)
  parts.push('"}')
  return new Blob(parts)
}

/** Оценка размера копии в байтах до кодирования файлов (с небольшим запасом на JSON-обвязку). */
export function estimateBackupBytes(headerBytes: number, files: readonly StoredFile[]): number {
  let total = headerBytes + 32
  for (const f of files) {
    const size = isBlob(f.blob) ? f.blob.size : 0
    const thumb = isBlob(f.thumb) ? f.thumb.size : 0
    total += base64Length(size) + base64Length(thumb) + 512 + (f.name?.length ?? 0) * 4
  }
  return total
}

const toMb = (bytes: number) => Math.ceil(bytes / 1024 / 1024)

export interface ExportOptions {
  /** Предел размера копии (по умолчанию MAX_BACKUP_BYTES); параметр — для тестов. */
  maxBytes?: number
}

/** Бросает Error с понятным текстом, если копия получилась бы невосстановимо большой. */
export async function exportBackup(options: ExportOptions = {}): Promise<Blob> {
  const maxBytes = options.maxBytes ?? MAX_BACKUP_BYTES
  const snapshot = await db.transaction('r', [db.items, db.categories, db.files, db.meta], async () => ({
    items: await db.items.toArray(),
    categories: await db.categories.orderBy('order').toArray(),
    files: await db.files.toArray(),
    meta: await db.meta.toArray(),
  }))

  const header: Omit<BackupData, 'files'> = {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    settings: settingsFromMeta(snapshot.meta),
    categories: snapshot.categories,
    // Незавершённая загрузка метаданных в копию не попадает: восстановленная, она висела бы вечно.
    items: snapshot.items.map((it) =>
      it.linkMeta?.status === 'pending' ? { ...it, linkMeta: settleLinkMeta(it.linkMeta) } : it,
    ),
  }
  const tooBig = (bytes?: number) =>
    new Error(
      `Резервная копия получилась бы слишком большой (${bytes ? `≈${toMb(bytes)} МБ при пределе` : 'предел —'} ` +
        `${toMb(maxBytes)} МБ) и её нельзя было бы восстановить. ` +
        'Удалите крупные файлы или сохраните их отдельно и повторите экспорт.',
    )
  let headerBlob: Blob
  try {
    headerBlob = new Blob([JSON.stringify(header)])
  } catch {
    // RangeError: длина строки превысила предел движка — восстановить такую копию тоже нельзя.
    throw tooBig()
  }
  // Проверяем ДО кодирования файлов: не тратим минуты на копию, которую потом не прочитать.
  const estimate = estimateBackupBytes(headerBlob.size, snapshot.files)
  if (estimate > maxBytes) throw tooBig(estimate)

  // Заголовок оканчивается на «}» (один байт ASCII) — срезаем его и дописываем раздел files.
  const parts: BlobPart[] = [headerBlob.slice(0, headerBlob.size - 1), ',"files":[']
  let first = true
  for (const f of snapshot.files) {
    const entry = await encodeFile(f)
    if (!entry) continue
    if (!first) parts.push(',')
    parts.push(entry)
    first = false
  }
  parts.push(']}')
  return new Blob(parts, { type: 'application/json' })
}

// ───────────────────────── валидация ─────────────────────────

type Rec = Record<string, unknown>

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isOneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v)
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function idStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

const DAY_MS = 86_400_000

/**
 * Отметка времени из копии: от 1970 года до «завтра». Дата за пределами диапазона Date
 * (|v| > 8.64e15) роняла бы форматирование при каждом показе записи, а дата из далёкого
 * будущего навсегда вставала бы первой в списке и выигрывала бы любое слияние.
 */
function ts(v: unknown, now: number): number | undefined {
  const n = num(v)
  return n !== undefined && n >= 0 && n <= now + DAY_MS ? n : undefined
}

// Те же правила уникальности имени, что в repo.createCategory/updateCategory и cat: в поиске.
const nameKey = categoryNameKey

/** Только допустимые ключи с правильными типами; приватные ключи отбрасываются. */
export function sanitizeSettings(raw: unknown): Partial<Settings> {
  const out: Rec = {}
  if (!isRec(raw)) return out as Partial<Settings>
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    if (PRIVATE_SETTINGS.has(key) || !Object.hasOwn(raw, key)) continue
    const value = raw[key]
    if (typeof value !== typeof DEFAULT_SETTINGS[key]) continue
    if (key === 'theme' && !isOneOf(THEMES, value)) continue
    out[key] = value
  }
  return out as Partial<Settings>
}

function settingsFromMeta(rows: readonly MetaRecord[]): Partial<Settings> {
  const raw: Rec = {}
  for (const { key, value } of rows) raw[key] = value
  return sanitizeSettings(raw)
}

function sanitizeTags(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return normalizeTags(v.filter((t): t is string => typeof t === 'string'))
}

function sanitizeLinks(v: unknown, selfId: string): string[] {
  if (!Array.isArray(v)) return []
  return [...new Set(v.filter((l): l is string => idStr(l) !== undefined && l !== selfId))]
}

function sanitizeLinkMeta(v: unknown, now: number): LinkMeta | undefined {
  if (!isRec(v)) return undefined
  const meta: LinkMeta = { status: isOneOf(LINK_META_STATUSES, v.status) ? v.status : 'failed' }
  for (const key of ['title', 'description', 'siteName'] as const) {
    const s = str(v[key])
    if (s !== undefined) meta[key] = s
  }
  // image/favicon из копии не переносим: картинка грузится с чужого адреса при каждом показе
  // карточки, а адрес в чужой копии может быть пикселем слежения. «Обновить данные» вернёт их.
  const fetchedAt = ts(v.fetchedAt, now)
  if (fetchedAt !== undefined) meta.fetchedAt = fetchedAt
  // Загрузку, начатую на другом устройстве, здесь никто не завершит.
  return settleLinkMeta(meta)
}

function sanitizeAi(v: unknown, now: number): AiMeta | undefined {
  if (!isRec(v)) return undefined
  const ai: AiMeta = {}
  for (const key of ['summary', 'suggestedTitle', 'model'] as const) {
    const s = str(v[key])
    if (s !== undefined) ai[key] = s
  }
  if (Array.isArray(v.suggestedTags)) ai.suggestedTags = sanitizeTags(v.suggestedTags)
  const generatedAt = ts(v.generatedAt, now)
  if (generatedAt !== undefined) ai.generatedAt = generatedAt
  return ai
}

/** Чинит запись из копии; null — запись не годится (нет id, неизвестный type/status). */
export function sanitizeItem(raw: unknown, now = Date.now()): Item | null {
  if (!isRec(raw)) return null
  const id = idStr(raw.id)
  if (!id || !isOneOf(ITEM_TYPES, raw.type) || !isOneOf(ITEM_STATUSES, raw.status)) return null

  const createdAt = ts(raw.createdAt, now) ?? now
  const item: Item = {
    id,
    type: raw.type,
    title: str(raw.title) ?? '',
    content: str(raw.content) ?? '',
    categoryId: idStr(raw.categoryId) ?? null,
    tags: sanitizeTags(raw.tags),
    links: sanitizeLinks(raw.links, id),
    status: raw.status,
    favorite: raw.favorite === 1 || raw.favorite === true ? 1 : 0,
    source: isOneOf(ITEM_SOURCES, raw.source) ? raw.source : 'import',
    createdAt,
    updatedAt: ts(raw.updatedAt, now) ?? createdAt,
  }

  const url = str(raw.url)?.trim()
  if (url) {
    // Открывается по клику (в Tauri — системным обработчиком): только http/https/ftp.
    const safe = hasForeignScheme(url) ? undefined : safeLinkUrl(normalizeUrl(url))
    if (safe) item.url = safe
    else {
      // javascript:, file:, кастомная схема — не ссылка. Текст адреса не теряем, запись становится заметкой.
      if (item.type === 'link') item.type = 'text'
      item.content = item.content ? `${item.content}\n\n${url}` : url
    }
  }
  const linkMeta = sanitizeLinkMeta(raw.linkMeta, now)
  if (linkMeta) item.linkMeta = linkMeta
  const language = str(raw.language)
  if (language !== undefined) item.language = language
  const fileId = idStr(raw.fileId)
  if (fileId) item.fileId = fileId
  const fileName = str(raw.fileName)
  if (fileName !== undefined) item.fileName = fileName
  const fileSize = num(raw.fileSize)
  if (fileSize !== undefined) item.fileSize = fileSize
  const mimeType = str(raw.mimeType)
  if (mimeType !== undefined) item.mimeType = mimeType
  if (raw.prevStatus === 'inbox' || raw.prevStatus === 'library') item.prevStatus = raw.prevStatus
  const processedAt = ts(raw.processedAt, now)
  if (processedAt !== undefined) item.processedAt = processedAt
  const ai = sanitizeAi(raw.ai, now)
  if (ai) item.ai = ai
  return item
}

function sanitizeCategory(raw: unknown, index: number, now: number): Category | null {
  if (!isRec(raw)) return null
  const id = idStr(raw.id)
  const name = str(raw.name)?.trim()
  if (!id || !name) return null
  return {
    id,
    name,
    color: isOneOf(CATEGORY_COLORS, raw.color) ? raw.color : 'slate',
    order: num(raw.order) ?? index,
    createdAt: ts(raw.createdAt, now) ?? now,
  }
}

/** Тип превью по сигнатуре — для копий без thumbType или с недопустимым thumbType. */
function sniffImageType(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  return 'image/webp'
}

/** Декодирует файл из копии; null — запись битая (нет id/itemId, некорректный base64). */
function decodeFile(raw: unknown, now: number): StoredFile | null {
  if (!isRec(raw)) return null
  const id = idStr(raw.id)
  const itemId = idStr(raw.itemId)
  if (!id || !itemId || typeof raw.data !== 'string') return null
  const mimeType = str(raw.mimeType) || 'application/octet-stream'
  try {
    const bytes = base64ToBytes(raw.data)
    const file: StoredFile = {
      id,
      itemId,
      // Тип Blob — из белого списка: HTML/XML из чужой копии по blob:-адресу исполнился бы в origin приложения.
      blob: new Blob([bytes], { type: safeBlobType(mimeType) }),
      name: str(raw.name) || 'file',
      mimeType,
      // реальный размер важнее заявленного
      size: bytes.length,
      createdAt: ts(raw.createdAt, now) ?? now,
    }
    // битое превью не повод терять сам файл
    if (typeof raw.thumb === 'string') {
      try {
        const thumb = base64ToBytes(raw.thumb)
        file.thumb = new Blob([thumb], { type: safeThumbType(raw.thumbType) ?? sniffImageType(thumb) })
      } catch {
        /* без превью */
      }
    }
    return file
  } catch {
    return null
  }
}

interface ParsedBackup {
  items: unknown[]
  categories: unknown[]
  files: unknown[]
  settings: unknown
}

const SECTION_LABEL = { items: 'записи', categories: 'категории', files: 'файлы' } as const

async function readBackup(file: Blob): Promise<ParsedBackup> {
  if (file.size > MAX_BACKUP_BYTES) {
    throw new Error(
      `Файл слишком большой (${toMb(file.size)} МБ): поддерживаются резервные копии до ${toMb(MAX_BACKUP_BYTES)} МБ.`,
    )
  }
  let text: string
  try {
    text = await file.text()
  } catch {
    throw new Error('Не удалось прочитать файл резервной копии.')
  }

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Файл повреждён: это не JSON. Выберите резервную копию QuickDrop (.json).')
  }

  if (!isRec(data) || data.app !== BACKUP_APP) {
    throw new Error('Это не резервная копия QuickDrop.')
  }
  const version = data.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error('Резервная копия повреждена: неизвестная версия формата.')
  }
  if (version > BACKUP_VERSION) {
    throw new Error(
      `Резервная копия создана более новой версией QuickDrop (формат ${version}). Обновите приложение и повторите импорт.`,
    )
  }
  for (const key of ['items', 'categories', 'files'] as const) {
    if (!Array.isArray(data[key])) {
      throw new Error(`Резервная копия повреждена: раздел «${SECTION_LABEL[key]}» отсутствует или имеет неверный формат.`)
    }
  }
  return {
    items: data.items as unknown[],
    categories: data.categories as unknown[],
    files: data.files as unknown[],
    settings: data.settings,
  }
}

// ───────────────────────── импорт ─────────────────────────

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * Целостность всей базы после импорта: связи только на существующие записи и в обе стороны,
 * categoryId только на существующую категорию, fileId только на существующий файл,
 * файлы, на которые не ссылается ни одна запись, удаляются.
 * updatedAt не трогаем: это техническая починка, а не правка пользователя.
 * Вызывать только внутри rw-транзакции по items/files/categories.
 */
async function repairIntegrity(): Promise<void> {
  const items = await db.items.toArray()
  const categoryIds = new Set(await db.categories.toCollection().primaryKeys())
  const fileIds = await db.files.toCollection().primaryKeys()
  const fileIdSet = new Set(fileIds)

  const byId = new Map(items.map((it) => [it.id, it]))
  const links = new Map<string, Set<string>>()
  for (const it of items) {
    const own = Array.isArray(it.links) ? it.links : []
    links.set(it.id, new Set(own.filter((l) => l !== it.id && byId.has(l))))
  }
  for (const [id, set] of links) {
    for (const other of set) links.get(other)?.add(id)
  }

  const changed: Item[] = []
  const referencedFiles = new Set<string>()
  for (const it of items) {
    const next: Item = { ...it }
    let dirty = false

    const fixedLinks = [...(links.get(it.id) ?? [])]
    if (!Array.isArray(it.links) || !sameList(fixedLinks, it.links)) {
      next.links = fixedLinks
      dirty = true
    }
    if (it.categoryId === undefined || (it.categoryId !== null && !categoryIds.has(it.categoryId))) {
      next.categoryId = null
      dirty = true
    }
    if (it.fileId !== undefined) {
      if (fileIdSet.has(it.fileId)) referencedFiles.add(it.fileId)
      else {
        delete next.fileId
        dirty = true
      }
    }
    if (dirty) changed.push(next)
  }

  if (changed.length) await db.items.bulkPut(changed)
  const orphans = fileIds.filter((id) => !referencedFiles.has(id))
  if (orphans.length) await db.files.bulkDelete(orphans)
}

export async function importBackup(file: Blob, mode: ImportMode): Promise<ImportReport> {
  if (mode !== 'merge' && mode !== 'replace') {
    throw new Error('Неизвестный режим импорта.')
  }
  const backup = await readBackup(file)
  const now = Date.now()
  let skipped = 0

  // Категории: дубли по id и по имени внутри самой копии сводим к первой.
  const categories: Category[] = []
  const catAlias = new Map<string, string>()
  const catByName = new Map<string, string>()
  backup.categories.forEach((raw, index) => {
    const cat = sanitizeCategory(raw, index, now)
    if (!cat || catAlias.has(cat.id)) {
      skipped++
      return
    }
    const sameName = catByName.get(nameKey(cat.name))
    if (sameName) {
      catAlias.set(cat.id, sameName)
      skipped++
      return
    }
    catAlias.set(cat.id, cat.id)
    catByName.set(nameKey(cat.name), cat.id)
    categories.push(cat)
  })

  const items = new Map<string, Item>()
  for (const raw of backup.items) {
    const item = sanitizeItem(raw, now)
    if (!item) {
      skipped++
      continue
    }
    if (items.has(item.id)) skipped++
    items.set(item.id, item)
  }

  // Декодирование base64 → Blob — до транзакции: IndexedDB-транзакция не переживает долгую синхронную работу.
  const files = new Map<string, StoredFile>()
  for (const raw of backup.files) {
    const f = decodeFile(raw, now)
    if (!f) {
      skipped++
      continue
    }
    if (files.has(f.id)) skipped++
    files.set(f.id, f)
  }

  const settings = sanitizeSettings(backup.settings)

  const write = db.transaction('rw', [db.items, db.files, db.categories, db.meta], async () => {
    const report: ImportReport = { items: 0, files: 0, categories: 0, skipped }

    if (mode === 'replace') {
      await db.items.clear()
      await db.files.clear()
      await db.categories.clear()
    }

    // ── категории ──
    const local = mode === 'merge' ? await db.categories.toArray() : []
    const localIds = new Set(local.map((c) => c.id))
    const localByName = new Map(local.map((c) => [nameKey(c.name), c.id]))
    let nextOrder = local.reduce((max, c) => Math.max(max, c.order), -1) + 1
    const finalCat = new Map<string, string>()
    const catsToPut: Category[] = []
    for (const cat of categories) {
      if (localIds.has(cat.id)) {
        finalCat.set(cat.id, cat.id)
        report.skipped++
        continue
      }
      const sameName = localByName.get(nameKey(cat.name))
      if (sameName) {
        finalCat.set(cat.id, sameName)
        report.skipped++
        continue
      }
      finalCat.set(cat.id, cat.id)
      // при слиянии новые категории встают после локальных
      catsToPut.push(mode === 'merge' ? { ...cat, order: nextOrder++ } : cat)
    }
    if (catsToPut.length) await db.categories.bulkPut(catsToPut)
    report.categories = catsToPut.length

    // ── записи ──
    const incoming = [...items.values()].map((item) => {
      if (item.categoryId === null) return item
      const alias = catAlias.get(item.categoryId)
      const target = alias === undefined ? item.categoryId : (finalCat.get(alias) ?? alias)
      return target === item.categoryId ? item : { ...item, categoryId: target }
    })
    const existing = mode === 'merge' ? await db.items.bulkGet(incoming.map((i) => i.id)) : []
    const itemsToPut: Item[] = []
    // fileId → итоговая запись-владелец (импортированная или оставшаяся локальная)
    const fileOwner = new Map<string, { item: Item; imported: boolean }>()
    incoming.forEach((item, i) => {
      const loc = existing[i]
      // при равном updatedAt остаётся локальная
      if (loc && item.updatedAt <= loc.updatedAt) {
        report.skipped++
        if (loc.fileId) fileOwner.set(loc.fileId, { item: loc, imported: false })
        return
      }
      itemsToPut.push(item)
      if (item.fileId) fileOwner.set(item.fileId, { item, imported: true })
    })
    if (itemsToPut.length) await db.items.bulkPut(itemsToPut)
    report.items = itemsToPut.length

    // ── файлы ──
    // Пишем только файлы, на которые ссылается итоговая запись. Если победила локальная запись —
    // файл из копии нужен, лишь когда локального файла с таким id нет.
    const candidates = [...files.values()].filter((f) => fileOwner.get(f.id)?.item.id === f.itemId)
    const keptLocal = candidates.filter((f) => !fileOwner.get(f.id)?.imported).map((f) => f.id)
    const presentLocal = new Set(
      keptLocal.length ? await db.files.where('id').anyOf(keptLocal).primaryKeys() : [],
    )
    const filesToPut = candidates.filter((f) => !presentLocal.has(f.id))
    if (filesToPut.length) await db.files.bulkPut(filesToPut)
    report.files = filesToPut.length
    report.skipped += files.size - filesToPut.length

    await repairIntegrity()

    if (mode === 'replace') {
      const rows: MetaRecord[] = Object.entries(settings).map(([key, value]) => ({ key, value }))
      if (rows.length) await db.meta.bulkPut(rows)
    }
    // иначе при следующем запуске seedDemoData подмешает демо к восстановленным данным
    await db.meta.put({ key: 'seeded', value: true })

    return report
  })
  try {
    return await write
  } catch (e) {
    // Крупная копия на почти заполненном хранилище: вместо «AbortError» — что делать.
    throw readableError(e)
  }
}
