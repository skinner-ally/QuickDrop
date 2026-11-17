import { db } from '@/db/db'
import { normalizeUrl } from '@/lib/detect'
import { readableError } from '@/lib/errors'
import { snapToGrid } from '@/lib/graphLayout'
import { upgradeLegacyRawPosition } from '@/lib/legacyGrid'
import {
  categoryNameKey,
  cleanOcrText,
  freeSearchName,
  hasForeignScheme,
  normalizeTags,
  safeBlobType,
  safeLinkUrl,
  safeThumbType,
  sanitizePoint,
  searchNameKey,
  settleLinkMeta,
} from '@/lib/normalize'
import { ocrKindOf } from '@/lib/ocrState'
import { isValidSetting } from '@/lib/settingsSchema'
import {
  CATEGORY_COLORS,
  DEFAULT_SETTINGS,
  IDEA_STATUSES,
  ITEM_SOURCES,
  ITEM_STATUSES,
  ITEM_TYPES,
  SAVED_SEARCH_NAME_MAX,
  SAVED_SEARCH_QUERY_MAX,
  type AiMeta,
  type Category,
  type GraphPoint,
  type Item,
  type LinkMeta,
  type MetaRecord,
  type NodePosition,
  type SavedSearch,
  type Settings,
  type StoredFile,
} from '@/types'

/**
 * Резервная копия QuickDrop: один JSON-файл, бинарники внутри в base64.
 * Секреты (aiApiKey), служебный флаг seeded, сетевые настройки, локальные пути и состояние этого
 * компьютера в копию не попадают никогда (см. PRIVATE_SETTINGS).
 *
 * Версии формата (читаются все, от 1 до текущей):
 *  1 — настройки, категории, записи, файлы;
 *  2 — добавлены разделы positions (положения нод графа) и searches (сохранённые поиски),
 *      у записей — deletedAt (корзина), ocrText, ocrAt. Оба раздела необязательны в любой версии.
 *      У записей также ocrVisionAt и ocrClearedAt (с этапа 8, необязательные; номер версии не менялся).
 *      ocrAutoSkipAt (решение этого устройства) не выгружается и при импорте не читается.
 *  3 — положения нод на сетке графа 48 (было 32); у копий 1–2 положения при импорте переносятся на новую сетку.
 */

export const BACKUP_APP = 'quickdrop'
export const BACKUP_VERSION = 3

/**
 * Предельный размер копии. Импорт читает файл одной строкой (file.text() + JSON.parse), а строка
 * в Chromium/WebView2 ограничена ~536 млн символов: копию крупнее нельзя было бы восстановить.
 * Берём с запасом и проверяем и при экспорте (заранее), и при импорте.
 */
export const MAX_BACKUP_BYTES = 480 * 1024 * 1024

export type ImportMode = 'merge' | 'replace'
export type ImportReport = {
  items: number
  files: number
  categories: number
  skipped: number
  positions: number
  searches: number
  /** Сколько из записанных записей пришло в корзину (с deletedAt). */
  trashed: number
}

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
  /** Положения нод графа (с версии 2); только для записей из items. */
  positions?: NodePosition[]
  /** Сохранённые поиски (с версии 2), по order. */
  searches?: SavedSearch[]
  files: BackupFileEntry[]
}

/**
 * Настройки, которые не экспортируются и не импортируются: секрет, служебный флаг и всё, что
 * определяет, уходят ли данные в сеть и куда. Копия может быть чужой: aiBaseUrl/aiEnabled из неё
 * отправили бы локальный ключ и содержимое записей на чужой хост, linkProxyUrl — каждую новую ссылку
 * на чужой прокси, autoFetchLinkTitle — включил бы запросы, которые пользователь выключил;
 * к тому же шаблон прокси может содержать токен, которому не место в файле копии.
 * По той же причине: aiAutoOcr/aiAutoOcrSince/aiVisionModel включили бы отправку картинок в ИИ, extEnabled/extPort/
 * extToken — приём записей по сети с чужим секретом. backupDir/mdExportDir/backupLastAt — пути и
 * состояние этого компьютера: чужая копия направила бы автоматические копии в произвольную папку.
 * backupEvery/backupKeep действуют вместе с локальной папкой: меньшее число копий из импортированной
 * базы стёрло бы при ближайшей автокопии здешнюю историю — единственную страховку от ошибочного «Заменить».
 */
export const PRIVATE_SETTINGS: ReadonlySet<string> = new Set<keyof Settings>([
  'aiApiKey',
  'seeded',
  'aiEnabled',
  'aiBaseUrl',
  'aiModel',
  'linkProxyUrl',
  'autoFetchLinkTitle',
  'backupDir',
  'backupLastAt',
  'backupEvery',
  'backupKeep',
  'mdExportDir',
  'aiAutoOcr',
  // состояние этого компьютера, включает отправку
  'aiAutoOcrSince',
  'aiVisionModel',
  'extEnabled',
  'extPort',
  'extToken',
])
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
  const snapshot = await db.transaction(
    'r',
    [db.items, db.categories, db.files, db.meta, db.positions, db.searches],
    async () => ({
      items: await db.items.toArray(),
      categories: await db.categories.orderBy('order').toArray(),
      files: await db.files.toArray(),
      meta: await db.meta.toArray(),
      positions: await db.positions.toArray(),
      searches: await db.searches.orderBy('order').toArray(),
    }),
  )
  const itemIds = new Set(snapshot.items.map((it) => it.id))

  const header: Omit<BackupData, 'files'> = {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    settings: settingsFromMeta(snapshot.meta),
    categories: snapshot.categories,
    // Незавершённая загрузка метаданных в копию не попадает: восстановленная, она висела бы вечно.
    // Записи корзины идут как есть (с deletedAt): копия возвращает и корзину.
    // ocrAutoSkipAt — решение этого устройства («авто не брать»), в копию не идёт.
    items: snapshot.items.map((it) => {
      let out = it.linkMeta?.status === 'pending' ? { ...it, linkMeta: settleLinkMeta(it.linkMeta) } : it
      if (out.ocrAutoSkipAt !== undefined) {
        const { ocrAutoSkipAt: _local, ...rest } = out
        out = rest
      }
      return out
    }),
    positions: snapshot.positions.filter((p) => itemIds.has(p.id)),
    searches: snapshot.searches,
  }
  const tooBig = (bytes?: number) =>
    new Error(
      `Резервная копия получилась бы слишком большой (${bytes ? `≈${toMb(bytes)} МБ при пределе` : 'предел —'} ` +
        `${toMb(maxBytes)} МБ) и её нельзя было бы восстановить. ` +
        'Очистите корзину, удалите крупные файлы или сохраните их отдельно и повторите экспорт.',
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

/** Сколько суток запись корзины из копии гарантированно пролежит до автоочистки (или весь срок, если он короче). */
export const IMPORTED_TRASH_GRACE_DAYS = 7

/**
 * Самая ранняя отметка удаления, с которой запись корзины из копии ещё проживёт IMPORTED_TRASH_GRACE_DAYS.
 * Автоочистка считает срок от deletedAt: без этого запись, уже просроченная к моменту импорта, была бы
 * стёрта первым же проходом — а копию импортируют как раз затем, чтобы вернуть стёртое.
 * 0 — автоочистка выключена, отметки не трогаем.
 */
function importedTrashFloor(trashDays: number, now: number): number {
  if (!(trashDays > 0)) return 0
  return now - (trashDays - Math.min(trashDays, IMPORTED_TRASH_GRACE_DAYS)) * DAY_MS
}

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

/** Только допустимые ключи с годными значениями (isValidSetting); приватные ключи отбрасываются. */
export function sanitizeSettings(raw: unknown): Partial<Settings> {
  const out: Rec = {}
  if (!isRec(raw)) return out as Partial<Settings>
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    if (PRIVATE_SETTINGS.has(key) || !Object.hasOwn(raw, key)) continue
    const value = raw[key]
    if (!isValidSetting(key, value)) continue
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
  // «Новая» — умолчание, поле не пишется; статус хранится и у записи, ставшей другим типом (вернули тип — статус на месте).
  if (isOneOf(IDEA_STATUSES, raw.ideaStatus) && raw.ideaStatus !== 'new') item.ideaStatus = raw.ideaStatus
  const ocrText = str(raw.ocrText)
  if (ocrText !== undefined) {
    const clean = cleanOcrText(ocrText)
    if (clean) item.ocrText = clean
  }
  const ocrAt = ts(raw.ocrAt, now)
  if (ocrAt !== undefined) item.ocrAt = ocrAt
  // Отметка распознавания зрением имеет смысл только у записи с вложением.
  const ocrVisionAt = ts(raw.ocrVisionAt, now)
  if (ocrVisionAt !== undefined && item.fileId) item.ocrVisionAt = ocrVisionAt
  // «Текст убрал пользователь» — тоже только у записи с вложением и без текста. ocrAutoSkipAt из копии не
  // читается: импорт ставит его сам новым записям с вложением без текста (importBackup).
  const ocrClearedAt = ts(raw.ocrClearedAt, now)
  if (ocrClearedAt !== undefined && item.fileId && !item.ocrText) item.ocrClearedAt = ocrClearedAt
  // 0 не годится: корзину выбирают по индексу deletedAt > 0, запись с нулём выпала бы из «Очистить корзину».
  const deletedAt = ts(raw.deletedAt, now)
  if (deletedAt !== undefined && deletedAt > 0) item.deletedAt = deletedAt
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

/** Положение ноды из копии; null — негодное (нет id, координаты не числа или за пределом). */
function sanitizePosition(raw: unknown): NodePosition | null {
  if (!isRec(raw)) return null
  const id = idStr(raw.id)
  const point = sanitizePoint(raw)
  return id && point ? { id, ...point } : null
}

/** Клетка сетки графа, в которой стоит нода: та же, что автораскладка считает занятой. */
function cellOf(p: GraphPoint): string {
  const { x, y } = snapToGrid(p)
  return `${x},${y}`
}

/** Сохранённый поиск из копии; null — негодный (нет id, пустые или слишком длинные имя/запрос). */
function sanitizeSearch(raw: unknown, index: number, now: number): SavedSearch | null {
  if (!isRec(raw)) return null
  const id = idStr(raw.id)
  const name = str(raw.name)?.trim()
  const query = str(raw.query)?.trim()
  if (!id || !name || !query) return null
  if (name.length > SAVED_SEARCH_NAME_MAX || query.length > SAVED_SEARCH_QUERY_MAX) return null
  return { id, name, query, order: num(raw.order) ?? index, createdAt: ts(raw.createdAt, now) ?? now }
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
  positions: unknown[]
  searches: unknown[]
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
    // Этих разделов нет в копиях версии 1, а в чужой копии они могут быть чем угодно: не повод отказывать.
    // До формата 3 положения стояли на сетке 32.
    positions: Array.isArray(data.positions)
      ? version < 3
        ? (data.positions as unknown[]).map(upgradeLegacyRawPosition)
        : (data.positions as unknown[])
      : [],
    searches: Array.isArray(data.searches) ? (data.searches as unknown[]) : [],
    settings: data.settings,
  }
}

// ───────────────────────── импорт ─────────────────────────

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/**
 * Победившая при слиянии версия записи с распознанным текстом того же вложения из другой версии, если тот
 * свежее. setOcrText не меняет updatedAt, поэтому распознавание в выборе версии не участвует и иначе
 * терялось бы: текст пропал бы из поиска, а автораспознавание отправило бы картинку в ИИ повторно.
 * ocrVisionAt — наибольший из двух версий, чей бы текст ни победил: попытку зрением не повторяем.
 * Без изменений возвращает сам winner (вызывающий сравнивает по ссылке).
 */
function withNewerOcr(winner: Item, other: Item): Item {
  if (!winner.fileId || winner.fileId !== other.fileId) return winner
  let next = winner
  if (other.ocrAt !== undefined && (winner.ocrAt === undefined || winner.ocrAt < other.ocrAt)) {
    next = { ...winner, ocrAt: other.ocrAt }
    // ocrAt без ocrText — «пробовали, текста нет» или «текст убрал пользователь» (ocrClearedAt — вместе с текстом)
    if (other.ocrText !== undefined) next.ocrText = other.ocrText
    else delete next.ocrText
    if (other.ocrClearedAt !== undefined) next.ocrClearedAt = other.ocrClearedAt
    else delete next.ocrClearedAt
  }
  const vision =
    other.ocrVisionAt === undefined
      ? winner.ocrVisionAt
      : Math.max(other.ocrVisionAt, winner.ocrVisionAt ?? other.ocrVisionAt)
  if (vision !== next.ocrVisionAt) next = { ...next, ocrVisionAt: vision }
  return next
}

/**
 * Целостность всей базы после импорта: связи только на существующие записи и в обе стороны,
 * categoryId только на существующую категорию, fileId только на существующий файл,
 * файлы, на которые не ссылается ни одна запись, и положения нод без записи удаляются.
 * Связи с записями в корзине — корректные: корзина хранит связи до окончательного удаления.
 * updatedAt не трогаем: это техническая починка, а не правка пользователя.
 * Вызывать только внутри rw-транзакции по items/files/categories/positions.
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
  const strayPositions = (await db.positions.toCollection().primaryKeys()).filter((id) => !byId.has(id))
  if (strayPositions.length) await db.positions.bulkDelete(strayPositions)
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

  // Положения: при дублях id остаётся первое.
  const positions = new Map<string, NodePosition>()
  for (const raw of backup.positions) {
    const pos = sanitizePosition(raw)
    if (!pos || positions.has(pos.id)) {
      skipped++
      continue
    }
    positions.set(pos.id, pos)
  }

  const searches = new Map<string, SavedSearch>()
  backup.searches.forEach((raw, index) => {
    const search = sanitizeSearch(raw, index, now)
    if (!search || searches.has(search.id)) {
      skipped++
      return
    }
    searches.set(search.id, search)
  })

  const settings = sanitizeSettings(backup.settings)

  const tables = [db.items, db.files, db.categories, db.meta, db.positions, db.searches]
  const write = db.transaction('rw', tables, async () => {
    const report: ImportReport = {
      items: 0,
      files: 0,
      categories: 0,
      skipped,
      positions: 0,
      searches: 0,
      trashed: 0,
    }

    if (mode === 'replace') {
      await db.items.clear()
      await db.files.clear()
      await db.categories.clear()
      await db.positions.clear()
      await db.searches.clear()
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
    // Срок корзины, который будет действовать после импорта: replace не очищает meta, поэтому значение
    // из копии ложится поверх здешнего, а без него остаётся здешнее; merge настройки не переносит.
    const storedDays = (await db.meta.get('trashDays'))?.value
    const localDays = isValidSetting('trashDays', storedDays) ? storedDays : DEFAULT_SETTINGS.trashDays
    const trashFloor = importedTrashFloor((mode === 'replace' ? settings.trashDays : undefined) ?? localDays, now)
    const itemsToPut: Item[] = []
    // Оставшиеся локальные записи, которым из копии пришёл только более свежий распознанный текст
    // или более поздняя отметка распознавания зрением (ocrVisionAt).
    const ocrOnly: Item[] = []
    // Слияние сменило категорию: локальное положение стоит в зоне прежней категории, а перевести ноду
    // в другую зону может только смена категории со снятием положения (Р8).
    const recategorized: string[] = []
    // fileId → итоговая запись-владелец (импортированная или оставшаяся локальная)
    const fileOwner = new Map<string, { item: Item; imported: boolean }>()
    incoming.forEach((raw, i) => {
      const loc = existing[i]
      // при равном updatedAt остаётся локальная
      if (loc && raw.updatedAt <= loc.updatedAt) {
        report.skipped++
        const kept = withNewerOcr(loc, raw)
        if (kept !== loc) ocrOnly.push(kept)
        if (loc.fileId) fileOwner.set(loc.fileId, { item: loc, imported: false })
        return
      }
      let item =
        raw.deletedAt !== undefined && raw.deletedAt < trashFloor ? { ...raw, deletedAt: trashFloor } : raw
      if (loc) {
        item = withNewerOcr(item, loc)
        if ((loc.categoryId ?? null) !== item.categoryId) recategorized.push(item.id)
        // Решение «авто не брать» — здешнее (отмена здесь или прежний импорт): версия из копии его не снимает.
        if (loc.ocrAutoSkipAt !== undefined) item = { ...item, ocrAutoSkipAt: loc.ocrAutoSkipAt }
      } else if (
        ocrKindOf(item) !== null &&
        item.ocrVisionAt === undefined &&
        !item.ocrText &&
        item.ocrClearedAt === undefined
      ) {
        // Новая здесь запись из копии с вложением без текста: автораспознавание её не отправляет, хотя
        // createdAt может быть позже aiAutoOcrSince (копия с другого устройства), — ни сейчас, ни после
        // восстановления из корзины или разбора слоя PDF (ocrAt ещё нет), поэтому не needsVision.
        // Распознать — кнопкой.
        item = { ...item, ocrAutoSkipAt: now }
      }
      itemsToPut.push(item)
      if (item.fileId) fileOwner.set(item.fileId, { item, imported: true })
    })
    if (itemsToPut.length || ocrOnly.length) await db.items.bulkPut([...itemsToPut, ...ocrOnly])
    if (recategorized.length) await db.positions.bulkDelete(recategorized)
    report.items = itemsToPut.length
    report.trashed = itemsToPut.filter((item) => item.deletedAt !== undefined).length

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

    // ── сохранённые поиски ──
    const localSearches = mode === 'merge' ? await db.searches.toArray() : []
    const localSearchIds = new Set(localSearches.map((s) => s.id))
    const localQueryByName = new Map(localSearches.map((s) => [searchNameKey(s.name), s.query]))
    const takenNames = new Set(localQueryByName.keys())
    let nextSearchOrder = localSearches.reduce((max, s) => Math.max(max, s.order), -1) + 1
    const searchesToPut: SavedSearch[] = []
    // По order копии: при слиянии новые встают после локальных в том же взаимном порядке.
    for (const search of [...searches.values()].sort((a, b) => a.order - b.order)) {
      const key = searchNameKey(search.name)
      // Тот же id — остаётся локальный; то же имя и тот же запрос — это тот же поиск.
      if (localSearchIds.has(search.id) || localQueryByName.get(key) === search.query) {
        report.skipped++
        continue
      }
      const name = takenNames.has(key) ? freeSearchName(search.name, takenNames) : search.name
      takenNames.add(searchNameKey(name))
      searchesToPut.push(mode === 'merge' ? { ...search, name, order: nextSearchOrder++ } : { ...search, name })
    }
    if (searchesToPut.length) await db.searches.bulkPut(searchesToPut)
    report.searches = searchesToPut.length

    await repairIntegrity()

    // ── положения нод ──
    // После починки целостности: нужна итоговая категория записи. Положение из копии — только для записей,
    // которые есть после импорта (в т.ч. в корзине: оттуда запись возвращается на своё место), и только
    // если категория итоговой записи та же, что у записи в копии: положение — место в зоне категории (Р8).
    // При слиянии локальная раскладка сильнее: положение из копии — лишь там, где своего нет и клетка
    // свободна. Раскладка на каждом устройстве растёт от начала координат, так что положения двух устройств
    // совпадают систематически, а сохранённые положения автораскладка не разводит. Занятость считается
    // и внутри самой копии (в порядке копии); отвергнутая нода получит место автораскладкой.
    const copyCategory = new Map(incoming.map((it) => [it.id, it.categoryId]))
    const posIds = [...positions.keys()]
    const finals = posIds.length ? await db.items.bulkGet(posIds) : []
    // После replace таблица пуста. Скрытые записи (архив, корзина) тоже держат клетку: они на неё вернутся.
    const localPositions = posIds.length ? await db.positions.toArray() : []
    const withLocalPos = new Set(localPositions.map((p) => p.id))
    const takenCells = new Set(localPositions.map(cellOf))
    const positionsToPut: NodePosition[] = []
    posIds.forEach((id, i) => {
      const final = finals[i]
      if (!final || withLocalPos.has(id) || !copyCategory.has(id)) return
      if (copyCategory.get(id) !== final.categoryId) return
      const pos = positions.get(id)!
      const cell = cellOf(pos)
      if (takenCells.has(cell)) return
      takenCells.add(cell)
      positionsToPut.push(pos)
    })
    if (positionsToPut.length) await db.positions.bulkPut(positionsToPut)
    report.positions = positionsToPut.length
    report.skipped += positions.size - positionsToPut.length

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
