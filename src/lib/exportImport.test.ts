import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/db'
import { QUOTA_MESSAGE } from '@/lib/errors'
import { formatDateTime, formatRelative } from '@/lib/itemTitle'
import {
  BACKUP_VERSION,
  backupFileName,
  base64ToBytes,
  blobToBase64,
  estimateBackupBytes,
  exportBackup,
  IMPORTED_TRASH_GRACE_DAYS,
  importBackup,
  MAX_BACKUP_BYTES,
  PRIVATE_SETTINGS,
  sanitizeItem,
  type BackupData,
  type ImportReport,
} from '@/lib/exportImport'
import { getSettings } from '@/db/settings'
import { snapToGrid } from '@/lib/graphLayout'
import { MAX_OCR_TEXT } from '@/lib/normalize'
import { isVisionBacklog, needsVision } from '@/lib/ocrState'
import { cleanupTrash } from '@/lib/trashCleanup'
import {
  DEFAULT_SETTINGS,
  SAVED_SEARCH_NAME_MAX,
  SAVED_SEARCH_QUERY_MAX,
  type Category,
  type Item,
  type SavedSearch,
  type Settings,
  type StoredFile,
} from '@/types'

const DAY = 86_400_000

async function reset() {
  await db.items.clear()
  await db.files.clear()
  await db.categories.clear()
  await db.meta.clear()
  await db.positions.clear()
  await db.searches.clear()
}

function makeItem(id: string, patch: Partial<Item> = {}): Item {
  return {
    id,
    type: 'text',
    title: `Запись ${id}`,
    content: `Содержимое ${id}`,
    categoryId: null,
    tags: [],
    links: [],
    status: 'inbox',
    favorite: 0,
    source: 'manual',
    createdAt: 1_000,
    updatedAt: 1_000,
    ...patch,
  }
}

function makeCategory(id: string, name: string, order = 0): Category {
  return { id, name, color: 'blue', order, createdAt: 1_000 }
}

function makeSearch(id: string, name: string, query: string, order = 0): SavedSearch {
  return { id, name, query, order, createdAt: 1_000 }
}

/** Отчёт импорта: неуказанные счётчики — нули. */
function rep(patch: Partial<ImportReport> = {}): ImportReport {
  return { items: 0, files: 0, categories: 0, skipped: 0, positions: 0, searches: 0, trashed: 0, ...patch }
}

async function metaMap(): Promise<Record<string, unknown>> {
  return Object.fromEntries((await db.meta.toArray()).map((r) => [r.key, r.value]))
}

/** Детерминированные «случайные» байты, покрывающие все значения 0..255. */
function makeBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n)
  let x = 12345
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0
    out[i] = i < 256 ? i : x >>> 24
  }
  return out
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

/** Индекс первого расхождения или -1; длины сравниваются отдельно. */
function firstDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.max(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i
  return -1
}

function backupBlob(data: unknown): Blob {
  return new Blob([JSON.stringify(data)], { type: 'application/json' })
}

function backup(patch: Partial<BackupData> = {}): BackupData {
  return {
    app: 'quickdrop',
    version: BACKUP_VERSION,
    exportedAt: 1_000,
    items: [],
    categories: [],
    files: [],
    ...patch,
  }
}

async function readExport(): Promise<{ blob: Blob; text: string; data: BackupData }> {
  const blob = await exportBackup()
  const text = await blob.text()
  return { blob, text, data: JSON.parse(text) as BackupData }
}

beforeEach(reset)
afterEach(() => {
  vi.restoreAllMocks()
})

describe('base64', () => {
  it('кодирует большие данные кусками без потерь', async () => {
    // больше нескольких кусков и не кратно 3 — проверяет склейку
    const bytes = makeBytes(3 * 0x4000 * 4 + 7)
    const b64 = await blobToBase64(new Blob([bytes]))
    const back = base64ToBytes(b64)
    expect(back.length).toBe(bytes.length)
    expect(firstDiff(back, bytes)).toBe(-1)
    expect(b64).toBe(btoa(String.fromCharCode(...bytes.subarray(0, 3 * 0x4000))) + b64.slice(4 * 0x4000))
  })

  it('пустой blob → пустая строка', async () => {
    expect(await blobToBase64(new Blob([]))).toBe('')
    expect(base64ToBytes('').length).toBe(0)
  })
})

describe('backupFileName', () => {
  it('формирует имя по локальной дате', () => {
    expect(backupFileName(new Date(2026, 0, 5, 23, 59))).toBe('quickdrop-backup-2026-01-05.json')
    expect(backupFileName()).toMatch(/^quickdrop-backup-\d{4}-\d{2}-\d{2}\.json$/)
  })
})

describe('exportBackup / importBackup: полный цикл', () => {
  it('восстанавливает записи, категории, настройки и байты файлов', async () => {
    const fileBytes = makeBytes(200_000)
    const thumbBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 250, 0])
    const category = makeCategory('cat-1', 'Работа')
    const image = makeItem('img', {
      type: 'image',
      status: 'library',
      favorite: 1,
      categoryId: 'cat-1',
      tags: ['фото', 'demo'],
      links: ['note'],
      fileId: 'file-1',
      fileName: 'photo.png',
      fileSize: fileBytes.length,
      mimeType: 'image/png',
      processedAt: 2_000,
      updatedAt: 3_000,
    })
    const note = makeItem('note', {
      type: 'link',
      url: 'https://example.com/a',
      linkMeta: { status: 'ok', title: 'Пример', fetchedAt: 1_500 },
      links: ['img'],
      status: 'archive',
      prevStatus: 'library',
      ai: { summary: 'кратко', suggestedTags: ['x'], model: 'm', generatedAt: 5 },
    })
    const stored: StoredFile = {
      id: 'file-1',
      itemId: 'img',
      blob: new Blob([fileBytes], { type: 'image/png' }),
      thumb: new Blob([thumbBytes], { type: 'image/png' }),
      name: 'photo.png',
      mimeType: 'image/png',
      size: fileBytes.length,
      createdAt: 1_000,
    }
    await db.categories.put(category)
    await db.items.bulkPut([image, note])
    await db.files.put(stored)
    await db.meta.bulkPut([
      { key: 'theme', value: 'dark' },
      { key: 'aiApiKey', value: 'sk-secret-123' },
      { key: 'seeded', value: true },
      { key: 'globalShortcut', value: 'Alt+Q' },
    ])

    // fake-indexeddb должен вернуть настоящий Blob, иначе сравнение байтов ниже бессмысленно
    const roundTripped = await db.files.get('file-1')
    expect(firstDiff(await bytesOf(roundTripped!.blob), fileBytes)).toBe(-1)

    const { blob, data } = await readExport()
    expect(blob.type).toBe('application/json')
    expect(data.app).toBe('quickdrop')
    expect(data.version).toBe(2)
    expect(data.positions).toEqual([])
    expect(data.searches).toEqual([])
    expect(typeof data.exportedAt).toBe('number')
    expect(data.files).toHaveLength(1)
    expect(typeof data.files[0].data).toBe('string')
    expect(data.files[0].thumbType).toBe('image/png')
    expect(data.settings).toEqual({ theme: 'dark', globalShortcut: 'Alt+Q' })

    await reset()
    const report = await importBackup(blob, 'replace')
    expect(report).toEqual({ items: 2, files: 1, categories: 1, skipped: 0, positions: 0, searches: 0, trashed: 0 })

    // Картинка без распознанного текста пришла импортом: авто её не отправляет (ocrAutoSkipAt).
    expect(await db.items.get('img')).toEqual({ ...image, ocrAutoSkipAt: expect.any(Number) })
    expect(await db.items.get('note')).toEqual(note)
    expect(await db.categories.toArray()).toEqual([category])

    const restored = await db.files.get('file-1')
    expect(restored).toBeDefined()
    expect(restored!.blob).toBeInstanceOf(Blob)
    expect(restored!.blob.type).toBe('image/png')
    expect(restored!.size).toBe(fileBytes.length)
    const restoredBytes = await bytesOf(restored!.blob)
    expect(restoredBytes.length).toBe(fileBytes.length)
    expect(firstDiff(restoredBytes, fileBytes)).toBe(-1)
    // контроль: сравнение действительно видит расхождение
    const tampered = fileBytes.slice()
    tampered[123_456] ^= 0xff
    expect(firstDiff(restoredBytes, tampered)).toBe(123_456)

    expect(restored!.thumb!.type).toBe('image/png')
    expect(firstDiff(await bytesOf(restored!.thumb!), thumbBytes)).toBe(-1)

    const settings = Object.fromEntries((await db.meta.toArray()).map((r) => [r.key, r.value]))
    expect(settings).toEqual({ theme: 'dark', globalShortcut: 'Alt+Q', seeded: true })
  })
})

describe('секреты и сетевые настройки', () => {
  it('ключ, seeded, адреса ИИ и прокси не попадают в экспорт', async () => {
    await db.meta.bulkPut([
      { key: 'aiApiKey', value: 'sk-very-secret' },
      { key: 'seeded', value: true },
      { key: 'aiEnabled', value: true },
      { key: 'aiBaseUrl', value: 'https://my-llm.example/v1' },
      { key: 'aiModel', value: 'gpt-x' },
      { key: 'linkProxyUrl', value: 'https://proxy.example/?token=t0k&u={url}' },
      { key: 'autoFetchLinkTitle', value: false },
      { key: 'theme', value: 'light' },
    ])
    const { text, data } = await readExport()
    for (const s of ['sk-very-secret', 'aiApiKey', 'seeded', 'my-llm', 'gpt-x', 't0k', 'linkProxyUrl', 'autoFetch']) {
      expect(text).not.toContain(s)
    }
    expect(data.settings).toEqual({ theme: 'light' })
  })

  it('чужая копия не перенаправляет локальный ключ и ссылки на свой хост', async () => {
    await db.meta.bulkPut([
      { key: 'aiApiKey', value: 'local-key' },
      { key: 'aiEnabled', value: false },
      { key: 'aiBaseUrl', value: 'https://api.deepseek.com/v1' },
      { key: 'autoFetchLinkTitle', value: false },
    ])
    await importBackup(
      backupBlob(
        backup({
          settings: {
            aiEnabled: true,
            aiBaseUrl: 'https://evil.example/v1',
            aiModel: 'evil',
            linkProxyUrl: 'https://evil.example/?u={url}',
            autoFetchLinkTitle: true,
            theme: 'dark',
          },
        }),
      ),
      'replace',
    )
    const meta = Object.fromEntries((await db.meta.toArray()).map((r) => [r.key, r.value]))
    expect(meta).toEqual({
      aiApiKey: 'local-key',
      aiEnabled: false,
      aiBaseUrl: 'https://api.deepseek.com/v1',
      autoFetchLinkTitle: false,
      theme: 'dark',
      seeded: true,
    })
  })

  it('импорт не трогает локальный ключ и игнорирует чужой', async () => {
    await db.meta.put({ key: 'aiApiKey', value: 'local-key' })
    await importBackup(
      backupBlob(backup({ settings: { aiApiKey: 'foreign', seeded: false, theme: 'neon' } as never })),
      'replace',
    )
    expect((await db.meta.get('aiApiKey'))?.value).toBe('local-key')
    expect((await db.meta.get('seeded'))?.value).toBe(true)
    expect(await db.meta.get('theme')).toBeUndefined()
  })
})

describe('replace', () => {
  it('полностью заменяет записи, категории и файлы', async () => {
    await db.categories.put(makeCategory('old-cat', 'Старое'))
    await db.items.put(makeItem('old', { type: 'file', fileId: 'old-file', categoryId: 'old-cat' }))
    await db.files.put({
      id: 'old-file',
      itemId: 'old',
      blob: new Blob([new Uint8Array([1, 2, 3])]),
      name: 'a.bin',
      mimeType: 'application/octet-stream',
      size: 3,
      createdAt: 1,
    })

    const report = await importBackup(
      backupBlob(
        backup({
          categories: [makeCategory('new-cat', 'Новое')],
          items: [makeItem('new', { categoryId: 'new-cat' })],
        }),
      ),
      'replace',
    )

    expect(report).toEqual({ items: 1, files: 0, categories: 1, skipped: 0, positions: 0, searches: 0, trashed: 0 })
    expect((await db.items.toArray()).map((i) => i.id)).toEqual(['new'])
    expect((await db.categories.toArray()).map((c) => c.id)).toEqual(['new-cat'])
    expect(await db.files.count()).toBe(0)
  })
})

describe('merge', () => {
  it('побеждает более свежий updatedAt, при равенстве — локальная', async () => {
    await db.items.bulkPut([
      makeItem('a', { title: 'local-a', updatedAt: 100 }),
      makeItem('b', { title: 'local-b', updatedAt: 300 }),
      makeItem('c', { title: 'local-c', updatedAt: 100 }),
      makeItem('local-only'),
    ])

    const report = await importBackup(
      backupBlob(
        backup({
          items: [
            makeItem('a', { title: 'remote-a', updatedAt: 200 }),
            makeItem('b', { title: 'remote-b', updatedAt: 200 }),
            makeItem('c', { title: 'remote-c', updatedAt: 100 }),
            makeItem('d', { title: 'remote-d' }),
          ],
        }),
      ),
      'merge',
    )

    expect(report).toEqual({ items: 2, files: 0, categories: 0, skipped: 2, positions: 0, searches: 0, trashed: 0 })
    expect((await db.items.get('a'))?.title).toBe('remote-a')
    expect((await db.items.get('b'))?.title).toBe('local-b')
    expect((await db.items.get('c'))?.title).toBe('local-c')
    expect((await db.items.get('d'))?.title).toBe('remote-d')
    expect(await db.items.get('local-only')).toBeDefined()
  })

  it('сливает категории по id и по имени без учёта регистра', async () => {
    await db.categories.bulkPut([makeCategory('c1', 'Работа', 0), makeCategory('c2', 'Дом', 1)])

    const report = await importBackup(
      backupBlob(
        backup({
          categories: [
            { ...makeCategory('x9', '  работа '), color: 'red' },
            { ...makeCategory('c2', 'Дом (переименовано)'), color: 'red' },
            makeCategory('c3', 'Чтение', 0),
          ],
          items: [
            makeItem('i1', { categoryId: 'x9' }),
            makeItem('i2', { categoryId: 'c2' }),
            makeItem('i3', { categoryId: 'c3' }),
          ],
        }),
      ),
      'merge',
    )

    expect(report).toEqual({ items: 3, files: 0, categories: 1, skipped: 2, positions: 0, searches: 0, trashed: 0 })
    const cats = await db.categories.orderBy('order').toArray()
    expect(cats.map((c) => [c.id, c.name])).toEqual([
      ['c1', 'Работа'],
      ['c2', 'Дом'],
      ['c3', 'Чтение'],
    ])
    expect(cats[0].color).toBe('blue')
    expect(cats[2].order).toBe(2)
    expect((await db.items.get('i1'))?.categoryId).toBe('c1')
    expect((await db.items.get('i2'))?.categoryId).toBe('c2')
    expect((await db.items.get('i3'))?.categoryId).toBe('c3')
  })

  it('файлы: новее — заменяется, локальный победитель сохраняет свой файл, старый файл не остаётся сиротой', async () => {
    const enc = (bytes: number[]) => btoa(String.fromCharCode(...bytes))
    const fileRow = (id: string, itemId: string, bytes: number[]) => ({
      id,
      itemId,
      blob: new Blob([new Uint8Array(bytes)]),
      name: `${id}.bin`,
      mimeType: 'application/octet-stream',
      size: bytes.length,
      createdAt: 1,
    })
    await db.items.bulkPut([
      makeItem('old-wins', { type: 'file', fileId: 'f-local', updatedAt: 500 }),
      makeItem('new-wins', { type: 'file', fileId: 'f-old', updatedAt: 100 }),
      makeItem('lost-file', { type: 'file', fileId: 'f-lost', updatedAt: 500 }),
    ])
    await db.files.bulkPut([fileRow('f-local', 'old-wins', [1]), fileRow('f-old', 'new-wins', [2])])

    const entry = (id: string, itemId: string, bytes: number[]) => ({
      id,
      itemId,
      name: `${id}.bin`,
      mimeType: 'application/octet-stream',
      size: bytes.length,
      createdAt: 1,
      data: enc(bytes),
    })
    const report = await importBackup(
      backupBlob(
        backup({
          items: [
            makeItem('old-wins', { type: 'file', fileId: 'f-remote', updatedAt: 100 }),
            makeItem('new-wins', { type: 'file', fileId: 'f-new', updatedAt: 900 }),
            makeItem('lost-file', { type: 'file', fileId: 'f-lost', updatedAt: 100 }),
          ],
          files: [
            entry('f-remote', 'old-wins', [9]),
            entry('f-new', 'new-wins', [7, 7]),
            // локальная запись победила, но её файла в базе нет — берём из копии
            entry('f-lost', 'lost-file', [5, 5, 5]),
          ],
        }),
      ),
      'merge',
    )

    expect(report).toEqual({ items: 1, files: 2, categories: 0, skipped: 3, positions: 0, searches: 0, trashed: 0 })
    expect((await db.files.toCollection().primaryKeys()).sort()).toEqual(['f-local', 'f-lost', 'f-new'])
    expect([...(await bytesOf((await db.files.get('f-new'))!.blob))]).toEqual([7, 7])
    expect([...(await bytesOf((await db.files.get('f-lost'))!.blob))]).toEqual([5, 5, 5])
    expect((await db.items.get('old-wins'))?.fileId).toBe('f-local')
    expect((await db.items.get('new-wins'))?.fileId).toBe('f-new')
    expect((await db.items.get('lost-file'))?.fileId).toBe('f-lost')
  })
})

describe('валидация и починка', () => {
  it('чинит связи, категории, fileId, теги и пропускает негодные записи', async () => {
    await db.items.put(makeItem('local', { links: [] }))

    const report = await importBackup(
      backupBlob({
        app: 'quickdrop',
        version: 1,
        exportedAt: 1,
        categories: [makeCategory('cat', 'Есть'), { id: 'bad-cat' }],
        items: [
          makeItem('a', { links: ['b', 'ghost', 'a', 'b', 42 as never, 'local'] }),
          makeItem('b', { links: [] }),
          makeItem('orphan-cat', { categoryId: 'nope' }),
          makeItem('no-file', { type: 'image', fileId: 'missing', fileName: 'x.png' }),
          {
            ...makeItem('dirty'),
            tags: ['  #Foo Bar ', 'FOO-bar', 5, '', '##'],
            favorite: true,
            categoryId: 'cat',
            links: 'not-array',
          },
          { ...makeItem('bad-type'), type: 'video' },
          { ...makeItem('bad-status'), status: 'deleted' },
          { title: 'без id', type: 'text', status: 'inbox' },
          'мусор',
        ],
        files: [{ id: 'f', itemId: 'a', data: '%%%не base64%%%' }],
      }),
      'merge',
    )

    expect(report).toEqual({ items: 5, files: 0, categories: 1, skipped: 6, positions: 0, searches: 0, trashed: 0 })
    const a = await db.items.get('a')
    expect(a?.links).toEqual(['b', 'local'])
    expect((await db.items.get('b'))?.links).toEqual(['a'])
    // обратная связь появилась и у локальной записи
    expect((await db.items.get('local'))?.links).toEqual(['a'])
    expect((await db.items.get('orphan-cat'))?.categoryId).toBeNull()

    const noFile = await db.items.get('no-file')
    expect(noFile).toBeDefined()
    expect(noFile?.fileId).toBeUndefined()
    expect(noFile?.fileName).toBe('x.png')

    const dirty = await db.items.get('dirty')
    expect(dirty?.tags).toEqual(['foo-bar'])
    expect(dirty?.favorite).toBe(1)
    expect(dirty?.links).toEqual([])
    expect(dirty?.categoryId).toBe('cat')

    for (const id of ['bad-type', 'bad-status']) expect(await db.items.get(id)).toBeUndefined()
    expect(await db.items.count()).toBe(6)
  })

  it('битый JSON и чужой формат дают понятную ошибку и не трогают базу', async () => {
    await db.items.put(makeItem('keep'))
    const cases: Array<[Blob, RegExp]> = [
      [new Blob(['{ это не json']), /не JSON/],
      [backupBlob({ app: 'notion', version: 1, items: [], categories: [], files: [] }), /не резервная копия QuickDrop/],
      [backupBlob([1, 2, 3]), /не резервная копия QuickDrop/],
      [backupBlob(null), /не резервная копия QuickDrop/],
      [backupBlob(backup({ version: 3 })), /более новой версией/],
      [backupBlob(backup({ version: 0 })), /версия формата/],
      [backupBlob(backup({ version: 1.5 })), /версия формата/],
      [backupBlob(backup({ version: '1' as never })), /версия формата/],
      [backupBlob({ ...backup(), items: {} }), /«записи»/],
      [backupBlob({ ...backup(), files: undefined }), /«файлы»/],
    ]
    for (const [blob, message] of cases) {
      await expect(importBackup(blob, 'replace')).rejects.toThrow(message)
    }
    await expect(importBackup(backupBlob(backup()), 'wipe' as never)).rejects.toThrow(/режим/)
    expect((await db.items.toArray()).map((i) => i.id)).toEqual(['keep'])
  })

  it('адрес ссылки — только http/https/ftp, картинка и иконка — только http(s)', async () => {
    await importBackup(
      backupBlob(
        backup({
          items: [
            makeItem('calc', { type: 'link', url: 'file:///C:/Windows/System32/calc.exe', content: 'см.' }),
            makeItem('js', { type: 'link', url: 'javascript:alert(1)' }),
            makeItem('mail', { type: 'link', url: 'mailto:a@b.c' }),
            makeItem('handler', { type: 'link', url: 'ms-settings:privacy' }),
            makeItem('bare', { type: 'link', url: 'example.com/a' }),
            makeItem('ok', {
              type: 'link',
              url: 'https://example.com',
              linkMeta: {
                status: 'ok',
                image: 'javascript:alert(1)',
                favicon: 'data:image/png;base64,AAAA',
              },
            }),
            makeItem('img', {
              type: 'link',
              url: 'ftp://files.example.com/x',
              linkMeta: { status: 'ok', image: 'https://cdn.example.com/i.png', favicon: 'http://e.com/f.ico' },
            }),
          ],
        }),
      ),
      'replace',
    )
    const get = async (id: string) => (await db.items.get(id))!
    // Опасный адрес не теряется, но запись становится заметкой без url.
    expect(await get('calc')).toMatchObject({ type: 'text', content: 'см.\n\nfile:///C:/Windows/System32/calc.exe' })
    expect((await get('calc')).url).toBeUndefined()
    for (const id of ['js', 'mail', 'handler']) {
      expect((await get(id)).type).toBe('text')
      expect((await get(id)).url).toBeUndefined()
    }
    expect((await get('bare')).url).toBe('https://example.com/a')
    expect((await get('ok')).linkMeta).toEqual({ status: 'ok' })
    expect((await get('img')).url).toBe('ftp://files.example.com/x')
    // Картинка и иконка из копии не переносятся даже с http(s): их адрес мог бы следить за открытием.
    expect((await get('img')).linkMeta).toEqual({ status: 'ok' })
  })

  it('тип Blob файла и превью — из белого списка, объявленный тип остаётся в mimeType', async () => {
    const enc = (bytes: number[]) => btoa(String.fromCharCode(...bytes))
    const png = [0x89, 0x50, 0x4e, 0x47, 1, 2]
    const file = (id: string, mimeType: string, thumbType?: string) => ({
      id,
      itemId: id,
      name: `${id}.bin`,
      mimeType,
      size: 3,
      createdAt: 1,
      data: enc([1, 2, 3]),
      ...(thumbType !== undefined ? { thumb: enc(png), thumbType } : {}),
    })
    const cases: Array<[string, string, string]> = [
      ['html', 'text/html', 'application/octet-stream'],
      ['xhtml', 'application/xhtml+xml', 'application/octet-stream'],
      ['xml', 'text/xml', 'application/octet-stream'],
      ['js', 'text/javascript', 'application/octet-stream'],
      ['pdf', 'application/pdf', 'application/pdf'],
      ['txt', 'text/plain; charset=utf-8', 'text/plain'],
      ['jpg', 'IMAGE/JPEG', 'image/jpeg'],
      ['svg', 'image/svg+xml', 'image/svg+xml'],
      ['mp4', 'video/mp4', 'video/mp4'],
      ['mp3', 'audio/mpeg', 'audio/mpeg'],
      ['zip', 'application/zip', 'application/octet-stream'],
    ]
    await importBackup(
      backupBlob(
        backup({
          items: [
            ...cases.map(([id]) => makeItem(id, { type: 'file', fileId: id })),
            makeItem('thumb-html', { type: 'image', fileId: 'thumb-html' }),
            makeItem('thumb-jpeg', { type: 'image', fileId: 'thumb-jpeg' }),
          ],
          files: [
            ...cases.map(([id, mime]) => file(id, mime)),
            file('thumb-html', 'image/png', 'text/html'),
            file('thumb-jpeg', 'image/png', 'image/jpeg'),
          ],
        }),
      ),
      'replace',
    )
    for (const [id, mime, expected] of cases) {
      const f = (await db.files.get(id))!
      expect(f.blob.type, id).toBe(expected)
      expect(f.mimeType, id).toBe(mime)
    }
    // недопустимый thumbType заменяется типом по сигнатуре
    expect((await db.files.get('thumb-html'))!.thumb!.type).toBe('image/png')
    expect((await db.files.get('thumb-jpeg'))!.thumb!.type).toBe('image/jpeg')
  })

  it('даты вне допустимого диапазона заменяются, а не ломают показ записи', async () => {
    const day = 86_400_000
    const before = Date.now()
    await importBackup(
      backupBlob(
        backup({
          categories: [{ ...makeCategory('cat', 'К'), createdAt: 9e15 }],
          items: [
            makeItem('huge', {
              type: 'link',
              url: 'https://example.com',
              createdAt: 9e15,
              updatedAt: 9e15,
              processedAt: 9e15,
              linkMeta: { status: 'ok', title: 'T', fetchedAt: -9e15 },
              ai: { summary: 's', generatedAt: 9e15 },
            }),
            makeItem('neg', { createdAt: -9e15, updatedAt: -1 }),
            makeItem('future', { createdAt: before + 365 * day, updatedAt: before + 365 * day }),
            makeItem('ok', { createdAt: 5_000, updatedAt: 6_000, processedAt: 5_500 }),
            makeItem('file', { type: 'file', fileId: 'f', fileName: 'a.bin' }),
          ],
          files: [
            {
              id: 'f',
              itemId: 'file',
              name: 'a.bin',
              mimeType: 'application/octet-stream',
              size: 1,
              createdAt: -9e15,
              data: btoa('x'),
            },
          ],
        }),
      ),
      'replace',
    )
    const after = Date.now()
    const isNow = (v: number | undefined) => v !== undefined && v >= before && v <= after

    const huge = (await db.items.get('huge'))!
    expect(isNow(huge.createdAt)).toBe(true)
    expect(huge.updatedAt).toBe(huge.createdAt)
    expect(huge.processedAt).toBeUndefined()
    expect(huge.linkMeta).toEqual({ status: 'ok', title: 'T' })
    expect(huge.ai).toEqual({ summary: 's' })
    for (const id of ['neg', 'future']) {
      const row = (await db.items.get(id))!
      expect(isNow(row.createdAt)).toBe(true)
      expect(row.updatedAt).toBe(row.createdAt)
    }
    expect(await db.items.get('ok')).toMatchObject({ createdAt: 5_000, updatedAt: 6_000, processedAt: 5_500 })
    expect(isNow((await db.categories.get('cat'))!.createdAt)).toBe(true)
    expect(isNow((await db.files.get('f'))!.createdAt)).toBe(true)
    // Всё, что показывает запись, теперь форматируется без RangeError.
    for (const row of await db.items.toArray()) {
      expect(() => formatDateTime(row.createdAt)).not.toThrow()
      expect(() => formatRelative(row.updatedAt)).not.toThrow()
    }
  })

  it('незавершённая загрузка метаданных не попадает в копию и не висит после импорта', async () => {
    await db.items.bulkPut([
      makeItem('p', { type: 'link', url: 'https://a.example', linkMeta: { status: 'pending' } }),
      makeItem('q', { type: 'link', url: 'https://b.example', linkMeta: { status: 'pending', title: 'B' } }),
    ])
    const { data } = await readExport()
    const exported = new Map(data.items.map((i) => [i.id, i.linkMeta]))
    expect(exported.get('p')).toEqual({ status: 'failed' })
    expect(exported.get('q')).toEqual({ status: 'ok', title: 'B' })
    // экспорт базу не меняет
    expect((await db.items.get('p'))!.linkMeta).toEqual({ status: 'pending' })

    // Старая копия с pending внутри.
    await importBackup(
      backupBlob(
        backup({
          items: [
            makeItem('p', { type: 'link', url: 'https://a.example', linkMeta: { status: 'pending' } }),
            makeItem('q', { type: 'link', url: 'https://b.example', linkMeta: { status: 'pending', title: 'B' } }),
          ],
        }),
      ),
      'replace',
    )
    expect((await db.items.get('p'))!.linkMeta).toEqual({ status: 'failed' })
    expect((await db.items.get('q'))!.linkMeta).toEqual({ status: 'ok', title: 'B' })
  })

  it('переполнение хранилища при импорте — понятная ошибка, база не тронута', async () => {
    await db.items.put(makeItem('keep'))
    vi.spyOn(db.items, 'bulkPut').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'))
    await expect(importBackup(backupBlob(backup({ items: [makeItem('new')] })), 'replace')).rejects.toThrow(
      QUOTA_MESSAGE,
    )
    expect((await db.items.toArray()).map((i) => i.id)).toEqual(['keep'])
  })

  it('пустая копия в режиме merge ничего не ломает', async () => {
    await db.items.put(makeItem('keep'))
    expect(await importBackup(backupBlob(backup()), 'merge')).toEqual({
      items: 0,
      files: 0,
      categories: 0,
      skipped: 0,
      positions: 0,
      searches: 0,
      trashed: 0,
    })
    expect(await db.items.count()).toBe(1)
  })
})

describe('версия 2: корзина, распознанный текст, положения, поиски', () => {
  it('полный цикл возвращает корзину, ocrText/ocrAt, положения и сохранённые поиски', async () => {
    // Срок корзины не истёк: отметка удаления переносится точно.
    const deletedAt = Date.now() - 2 * DAY
    const trashed = makeItem('trashed', { status: 'library', links: ['scan'], updatedAt: 2_000, deletedAt })
    const scan = makeItem('scan', {
      type: 'image',
      links: ['trashed'],
      ocrText: 'Счёт № 42\nИтого: 1 500',
      ocrAt: 4_000,
    })
    // пробовали распознать, текста не нашлось
    const tried = makeItem('tried', { ocrAt: 4_500 })
    await db.items.bulkPut([trashed, scan, tried])
    await db.positions.bulkPut([
      { id: 'trashed', x: -120, y: 48 },
      { id: 'scan', x: 96, y: 0 },
      { id: 'ghost', x: 1, y: 2 },
    ])
    const first = makeSearch('s1', 'Счета', 'tag:счёт type:image', 0)
    const second = makeSearch('s2', 'Корзина за неделю', 'is:trash date:week', 1)
    await db.searches.bulkPut([second, first])

    const { blob, text, data } = await readExport()
    expect(data.version).toBe(2)
    // Положение без записи в копию не попадает.
    expect(data.positions).toEqual([
      { id: 'scan', x: 96, y: 0 },
      { id: 'trashed', x: -120, y: 48 },
    ])
    expect(data.searches).toEqual([first, second])
    expect(data.items.find((i) => i.id === 'trashed')).toEqual(trashed)
    expect(data.items.find((i) => i.id === 'scan')).toEqual(scan)
    // Новые разделы — в заголовке, до файлов.
    expect(text.indexOf('"positions":')).toBeGreaterThan(0)
    expect(text.indexOf('"positions":')).toBeLessThan(text.indexOf('"files":'))
    expect(text.indexOf('"searches":')).toBeLessThan(text.indexOf('"files":'))

    await reset()
    // Из трёх записанных записей одна пришла в корзину.
    expect(await importBackup(blob, 'replace')).toEqual(rep({ items: 3, positions: 2, searches: 2, trashed: 1 }))

    expect(await db.items.get('trashed')).toEqual(trashed)
    expect(await db.items.get('scan')).toEqual(scan)
    expect(await db.items.get('tried')).toEqual(tried)
    // Корзина находится по индексу, связь с записью в корзине цела в обе стороны.
    expect(await db.items.where('deletedAt').above(0).primaryKeys()).toEqual(['trashed'])
    expect(await db.positions.toArray()).toEqual([
      { id: 'scan', x: 96, y: 0 },
      { id: 'trashed', x: -120, y: 48 },
    ])
    expect(await db.searches.orderBy('order').toArray()).toEqual([first, second])
  })

  it('replace очищает положения и поиски; имена-дубли поисков из копии получают суффикс', async () => {
    await db.items.put(makeItem('old'))
    await db.positions.put({ id: 'old', x: 5, y: 5 })
    await db.searches.put(makeSearch('old-s', 'Старый', 'tag:old'))

    const report = await importBackup(
      backupBlob(
        backup({
          items: [makeItem('new'), makeItem('trashed-new', { deletedAt: 3_000 })],
          positions: [
            { id: 'new', x: 10, y: 20 },
            { id: 'trashed-new', x: -10, y: -20 },
            { id: 'ghost', x: 1, y: 1 },
            { id: 'old', x: 2, y: 2 },
          ],
          searches: [
            makeSearch('s1', 'Важное', 'is:fav', 0),
            makeSearch('s2', 'ВАЖНОЕ', 'is:fav', 1),
            makeSearch('s3', 'важное ', 'tag:x', 2),
          ],
        }),
      ),
      'replace',
    )

    // ghost и old — положения без записи
    expect(report).toEqual(rep({ items: 2, positions: 2, searches: 3, skipped: 2, trashed: 1 }))
    expect(await db.positions.toArray()).toEqual([
      { id: 'new', x: 10, y: 20 },
      { id: 'trashed-new', x: -10, y: -20 },
    ])
    expect((await db.searches.orderBy('order').toArray()).map((s) => [s.id, s.name, s.order])).toEqual([
      ['s1', 'Важное', 0],
      ['s2', 'ВАЖНОЕ (2)', 1],
      ['s3', 'важное (3)', 2],
    ])
  })

  it('merge: локальное положение сильнее, положение без записи не пишется', async () => {
    await db.items.bulkPut([
      makeItem('both', { updatedAt: 100 }),
      makeItem('local-wins', { updatedAt: 900 }),
      makeItem('untouched'),
    ])
    await db.positions.bulkPut([
      { id: 'both', x: 0, y: 0 },
      { id: 'untouched', x: 64, y: 0 },
    ])

    const report = await importBackup(
      backupBlob(
        backup({
          items: [
            makeItem('both', { title: 'из копии', updatedAt: 500 }),
            makeItem('local-wins', { updatedAt: 100 }),
            makeItem('fresh'),
          ],
          positions: [
            { id: 'both', x: 320, y: 320 },
            { id: 'local-wins', x: 128, y: 0 },
            { id: 'fresh', x: 192, y: 0 },
            { id: 'ghost', x: 256, y: 0 },
          ],
        }),
      ),
      'merge',
    )

    // пропущено: запись local-wins (локальная новее), положения both (есть локальное) и ghost (нет записи)
    expect(report).toEqual(rep({ items: 2, positions: 2, skipped: 3 }))
    expect((await db.items.get('both'))?.title).toBe('из копии')
    expect(await db.positions.toArray()).toEqual([
      { id: 'both', x: 0, y: 0 },
      { id: 'fresh', x: 192, y: 0 },
      // запись осталась локальной, но своего положения у неё не было
      { id: 'local-wins', x: 128, y: 0 },
      { id: 'untouched', x: 64, y: 0 },
    ])
  })

  it('merge: положение из копии в занятой клетке не пишется — ноды двух устройств не накладываются', async () => {
    // Раскладка на каждом устройстве растёт от (0, 0): клетки совпадают систематически.
    await db.items.bulkPut([makeItem('a1'), makeItem('a2'), makeItem('a-hidden', { status: 'archive' })])
    await db.positions.bulkPut([
      { id: 'a1', x: 0, y: 0 },
      { id: 'a2', x: 0, y: -32 },
      // скрытая запись тоже держит клетку: вернувшись из архива, она встанет на неё
      { id: 'a-hidden', x: 64, y: 64 },
    ])

    const report = await importBackup(
      backupBlob(
        backup({
          items: [makeItem('b1'), makeItem('b2'), makeItem('b3'), makeItem('b4'), makeItem('b5')],
          positions: [
            // та же клетка, что у a1 (координаты в пределах клетки)
            { id: 'b1', x: 10, y: -12 },
            { id: 'b2', x: 0, y: -32 },
            { id: 'b3', x: 64, y: 64 },
            { id: 'b4', x: 96, y: 0 },
            // клетку b4 внутри самой копии — получает первая по порядку копии
            { id: 'b5', x: 100, y: 5 },
          ],
        }),
      ),
      'merge',
    )

    expect(report).toEqual(rep({ items: 5, positions: 1, skipped: 4 }))
    const positions = await db.positions.toArray()
    expect(positions).toEqual([
      { id: 'a-hidden', x: 64, y: 64 },
      { id: 'a1', x: 0, y: 0 },
      { id: 'a2', x: 0, y: -32 },
      { id: 'b4', x: 96, y: 0 },
    ])
    const cells = positions.map((p) => JSON.stringify(snapToGrid(p)))
    expect(new Set(cells).size).toBe(cells.length)
  })

  it('merge старой копии после окончательного удаления: вернувшаяся запись не встаёт на ноду, занявшую её клетку', async () => {
    await db.items.put(makeItem('x'))
    await db.positions.put({ id: 'x', x: 0, y: 0 })
    const { blob } = await readExport()

    // x удалена окончательно (вместе с положением), её клетку заняла новая запись y.
    await db.items.delete('x')
    await db.positions.delete('x')
    await db.items.put(makeItem('y', { createdAt: 2_000 }))
    await db.positions.put({ id: 'y', x: 0, y: 0 })

    expect(await importBackup(blob, 'merge')).toEqual(rep({ items: 1, skipped: 1 }))
    expect(await db.items.get('x')).toBeDefined()
    expect(await db.positions.toArray()).toEqual([{ id: 'y', x: 0, y: 0 }])
  })

  it('replace: из положений копии в одной клетке пишется первое', async () => {
    await importBackup(
      backupBlob(
        backup({
          items: [makeItem('p'), makeItem('q')],
          positions: [
            { id: 'p', x: 32, y: 32 },
            { id: 'q', x: 40, y: 25 },
          ],
        }),
      ),
      'replace',
    )
    expect(await db.positions.toArray()).toEqual([{ id: 'p', x: 32, y: 32 }])
  })

  it('merge: смена категории версией из копии снимает локальное положение (Р8)', async () => {
    await db.categories.bulkPut([makeCategory('work', 'Работа', 0), makeCategory('ideas', 'Идеи', 1)])
    await db.items.bulkPut([
      makeItem('moved', { categoryId: 'work', updatedAt: 100 }),
      makeItem('same', { categoryId: 'work', updatedAt: 100 }),
    ])
    await db.positions.bulkPut([
      { id: 'moved', x: 64, y: 96 },
      { id: 'same', x: 128, y: 96 },
    ])

    await importBackup(
      backupBlob(
        backup({
          categories: [makeCategory('work', 'Работа', 0), makeCategory('ideas', 'Идеи', 1)],
          items: [
            makeItem('moved', { categoryId: 'ideas', updatedAt: 500 }),
            makeItem('same', { categoryId: 'work', title: 'правка', updatedAt: 500 }),
          ],
        }),
      ),
      'merge',
    )

    expect((await db.items.get('moved'))?.categoryId).toBe('ideas')
    // Прежнее место — в зоне «Работы»: нода получит место в зоне «Идей» автораскладкой.
    expect(await db.positions.get('moved')).toBeUndefined()
    expect(await db.positions.get('same')).toEqual({ id: 'same', x: 128, y: 96 })
  })

  it('merge: положение из копии не пишется, если итоговая категория записи другая', async () => {
    await db.categories.bulkPut([makeCategory('work', 'Работа', 0), makeCategory('ideas', 'Идеи', 1)])
    // Локальная версия новее: категорию сменили здесь, и смена сняла положение.
    await db.items.put(makeItem('x', { categoryId: 'ideas', updatedAt: 900 }))

    const report = await importBackup(
      backupBlob(
        backup({
          categories: [makeCategory('work', 'Работа', 0)],
          items: [
            makeItem('x', { categoryId: 'work', updatedAt: 100 }),
            // категории нет в копии: починка целостности уберёт её у записи
            makeItem('lost', { categoryId: 'nowhere' }),
            makeItem('ok', { categoryId: 'work' }),
          ],
          positions: [
            { id: 'x', x: 64, y: 0 },
            { id: 'lost', x: 128, y: 0 },
            { id: 'ok', x: 192, y: 0 },
          ],
        }),
      ),
      'merge',
    )

    expect(report.positions).toBe(1)
    expect(await db.positions.toArray()).toEqual([{ id: 'ok', x: 192, y: 0 }])
    expect((await db.items.get('lost'))?.categoryId).toBeNull()
  })

  it('merge: поиск-дубль пропущен, одноимённый с другим запросом получает суффикс, новые — после локальных', async () => {
    const l1 = makeSearch('l1', 'Работа', 'cat:работа', 0)
    const l2 = makeSearch('l2', 'Ссылки', 'type:link', 5)
    await db.searches.bulkPut([l1, l2])

    const copy = backupBlob(
      backup({
        searches: [
          // тот же id — остаётся локальный
          makeSearch('l1', 'Другое имя', 'tag:x', 0),
          // то же имя (без учёта регистра и пробелов) и тот же запрос
          makeSearch('r1', '  РАБОТА ', 'cat:работа', 1),
          makeSearch('r4', 'Новый', 'tag:other', 4),
          makeSearch('r3', 'Новый', 'tag:new', 3),
          // то же имя, другой запрос
          makeSearch('r2', 'ссылки', 'type:link is:fav', 2),
        ],
      }),
    )
    expect(await importBackup(copy, 'merge')).toEqual(rep({ searches: 3, skipped: 2 }))

    const rows = await db.searches.orderBy('order').toArray()
    expect(rows.slice(0, 2)).toEqual([l1, l2])
    expect(rows.slice(2).map((s) => [s.id, s.name, s.query, s.order])).toEqual([
      ['r2', 'ссылки (2)', 'type:link is:fav', 6],
      ['r3', 'Новый', 'tag:new', 7],
      ['r4', 'Новый (2)', 'tag:other', 8],
    ])

    // Повторный импорт той же копии ничего не плодит.
    expect(await importBackup(copy, 'merge')).toEqual(rep({ skipped: 5 }))
    expect(await db.searches.count()).toBe(5)
  })

  it('суффикс имени поиска: занятые номера пропускаются, ё = е, имя остаётся в пределах длины', async () => {
    const long = 'я'.repeat(SAVED_SEARCH_NAME_MAX)
    await db.searches.bulkPut([
      makeSearch('l1', 'Отчёты', 'tag:a', 0),
      makeSearch('l2', 'Отчёты (2)', 'tag:b', 1),
      makeSearch('l3', long, 'tag:c', 2),
    ])
    await importBackup(
      backupBlob(
        backup({
          searches: [makeSearch('r1', 'отчеты', 'tag:z', 0), makeSearch('r2', long, 'tag:y', 1)],
        }),
      ),
      'merge',
    )
    expect((await db.searches.get('r1'))?.name).toBe('отчеты (3)')
    const renamed = (await db.searches.get('r2'))!.name
    expect(renamed).toBe(`${'я'.repeat(SAVED_SEARCH_NAME_MAX - 4)} (2)`)
    expect(renamed.length).toBe(SAVED_SEARCH_NAME_MAX)
  })

  it('негодные положения и поиски пропускаются и считаются в skipped', async () => {
    const before = Date.now()
    const report = await importBackup(
      backupBlob({
        ...backup({ items: [makeItem('a'), makeItem('b')] }),
        positions: [
          { id: 'a', x: 10.4, y: -20.6 },
          // дубль id — остаётся первое
          { id: 'a', x: 99, y: 99 },
          // NaN в JSON становится null
          { id: 'b', x: Number.NaN, y: 1 },
          { id: 'b', x: '5', y: 5 },
          { id: 'b', x: 2_000_000, y: 0 },
          { id: '', x: 1, y: 1 },
          { x: 1, y: 1 },
          'мусор',
          null,
          { id: 'b', x: 3, y: 4, extra: 'лишнее поле' },
        ],
        searches: [
          { id: 's-ok', name: '  Годный  ', query: '  tag:a  ' },
          { id: 's-ok', name: 'Дубль id', query: 'tag:b' },
          { id: '', name: 'Без id', query: 'tag:c' },
          { id: 's1', name: '   ', query: 'tag:d' },
          { id: 's2', name: 'Пустой запрос', query: '  ' },
          { id: 's3', name: 'я'.repeat(SAVED_SEARCH_NAME_MAX + 1), query: 'tag:e' },
          { id: 's4', name: 'Длинный запрос', query: 'q'.repeat(SAVED_SEARCH_QUERY_MAX + 1) },
          { id: 's5', name: 5, query: 'tag:f' },
          'мусор',
          { id: 's-max', name: 'ю'.repeat(SAVED_SEARCH_NAME_MAX), query: 'q'.repeat(SAVED_SEARCH_QUERY_MAX), order: 7, createdAt: 9e15 },
        ],
      }),
      'replace',
    )
    const after = Date.now()

    expect(report).toEqual(rep({ items: 2, positions: 2, searches: 2, skipped: 16 }))
    expect(await db.positions.toArray()).toEqual([
      { id: 'a', x: 10, y: -21 },
      { id: 'b', x: 3, y: 4 },
    ])
    const ok = (await db.searches.get('s-ok'))!
    // порядок — индекс в копии, дата создания — сейчас
    expect(ok).toMatchObject({ name: 'Годный', query: 'tag:a', order: 0 })
    expect(ok.createdAt).toBeGreaterThanOrEqual(before)
    expect(ok.createdAt).toBeLessThanOrEqual(after)
    const max = (await db.searches.get('s-max'))!
    expect(max.order).toBe(7)
    // дата вне допустимого диапазона заменяется
    expect(max.createdAt).toBeLessThanOrEqual(after)
    expect(await db.searches.count()).toBe(2)
  })

  it('починка целостности удаляет положения без записей, положение записи в корзине остаётся', async () => {
    await db.items.bulkPut([makeItem('keep'), makeItem('in-trash', { deletedAt: 2_000 })])
    await db.positions.bulkPut([
      { id: 'keep', x: 1, y: 1 },
      { id: 'in-trash', x: 2, y: 2 },
      { id: 'gone', x: 3, y: 3 },
    ])
    expect(await importBackup(backupBlob(backup()), 'merge')).toEqual(rep())
    expect((await db.positions.toCollection().primaryKeys()).sort()).toEqual(['in-trash', 'keep'])
  })

  it('sanitizeItem: deletedAt, ocrText, ocrAt и source', () => {
    const now = 1_000_000_000
    const day = 86_400_000
    const clean = (patch: Record<string, unknown>) => sanitizeItem({ ...makeItem('x'), ...patch }, now)!

    expect(clean({ deletedAt: 5_000 }).deletedAt).toBe(5_000)
    for (const bad of [9e15, -1, 0, '5000', null, now + 2 * day, Number.POSITIVE_INFINITY]) {
      expect(Object.hasOwn(clean({ deletedAt: bad }), 'deletedAt'), String(bad)).toBe(false)
    }

    expect(clean({ ocrText: 'стр. 1\r\nстр.\u0000 2\u0007' }).ocrText).toBe('стр. 1\nстр. 2')
    for (const empty of ['', '  \n\t ', 5, null, ['текст']]) {
      expect(Object.hasOwn(clean({ ocrText: empty }), 'ocrText'), String(empty)).toBe(false)
    }
    expect(clean({ ocrText: 'я'.repeat(MAX_OCR_TEXT + 100) }).ocrText).toHaveLength(MAX_OCR_TEXT)

    // ocrAt без ocrText — «пробовали, текста нет»
    expect(clean({ ocrAt: 7_000 })).toMatchObject({ ocrAt: 7_000 })
    for (const bad of [9e15, -5, '7000']) {
      expect(Object.hasOwn(clean({ ocrAt: bad }), 'ocrAt'), String(bad)).toBe(false)
    }

    expect(clean({ source: 'extension' }).source).toBe('extension')
    expect(clean({ source: 'share' }).source).toBe('share')
    expect(clean({ source: 'telepathy' }).source).toBe('import')

    // Запись прежнего формата новых полей не получает.
    const old = clean({})
    for (const key of ['deletedAt', 'ocrText', 'ocrAt', 'ocrVisionAt']) expect(Object.hasOwn(old, key), key).toBe(false)
  })

  it('sanitizeItem: ocrVisionAt — только у записи с вложением и только допустимая дата', () => {
    const now = 1_000_000_000
    const clean = (patch: Record<string, unknown>) => sanitizeItem({ ...makeItem('x'), ...patch }, now)!

    expect(clean({ type: 'image', fileId: 'f1', ocrVisionAt: 7_000 }).ocrVisionAt).toBe(7_000)
    // Без ocrAt и ocrText — «пробовали зрением, неустранимая ошибка».
    const tried = clean({ type: 'file', fileId: 'f1', ocrVisionAt: 8_000 })
    expect(tried.ocrVisionAt).toBe(8_000)
    expect(Object.hasOwn(tried, 'ocrAt')).toBe(false)
    // Без fileId отметка отбрасывается.
    expect(Object.hasOwn(clean({ type: 'image', ocrVisionAt: 7_000 }), 'ocrVisionAt')).toBe(false)
    expect(Object.hasOwn(clean({ type: 'image', fileId: '', ocrVisionAt: 7_000 }), 'ocrVisionAt')).toBe(false)
    for (const bad of [9e15, -5, '7000', null, Number.NaN]) {
      expect(Object.hasOwn(clean({ fileId: 'f1', ocrVisionAt: bad }), 'ocrVisionAt'), String(bad)).toBe(false)
    }
  })

  it('полный цикл: ocrVisionAt и источник share переживают экспорт и импорт', async () => {
    const png = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    await db.files.bulkPut([
      { id: 'f1', itemId: 'seen', blob: png, name: 'a.png', mimeType: 'image/png', size: 3, createdAt: 1 },
      { id: 'f2', itemId: 'failed', blob: png, name: 'b.png', mimeType: 'image/png', size: 3, createdAt: 1 },
    ])
    const seen = makeItem('seen', {
      type: 'image',
      fileId: 'f1',
      fileName: 'a.png',
      source: 'share',
      ocrText: 'Счёт № 7',
      ocrAt: 4_000,
      ocrVisionAt: 4_000,
    })
    // Неустранимая ошибка зрения: только отметка.
    const failed = makeItem('failed', { type: 'image', fileId: 'f2', fileName: 'b.png', ocrVisionAt: 5_000 })
    const shared = makeItem('shared', { source: 'share' })
    await db.items.bulkPut([seen, failed, shared])

    const { blob, data } = await readExport()
    expect(data.items.find((i) => i.id === 'seen')).toEqual(seen)
    expect(data.items.find((i) => i.id === 'failed')).toEqual(failed)

    await reset()
    expect(await importBackup(blob, 'replace')).toEqual(rep({ items: 3, files: 2 }))
    expect(await db.items.get('seen')).toEqual(seen)
    expect(await db.items.get('failed')).toEqual(failed)
    expect(await db.items.get('shared')).toEqual(shared)
  })

  describe('импорт и автораспознавание (ревью этапа 8)', () => {
    const png = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    const fileRec = (id: string, itemId: string) => ({
      id,
      itemId,
      name: `${id}.png`,
      mimeType: 'image/png',
      size: 3,
      createdAt: 1,
      data: 'AQID',
    })
    const SINCE = 5_000
    const enableAuto = () =>
      db.meta.bulkPut([
        { key: 'aiAutoOcr', value: true },
        { key: 'aiAutoOcrSince', value: SINCE },
      ])

    it('новые записи из копии, ждущие распознавания, авто не берёт (merge и replace)', async () => {
      for (const mode of ['merge', 'replace'] as const) {
        await reset()
        await enableAuto()
        const copy = backup({
          items: [
            makeItem('pic', { type: 'image', fileId: 'f1', fileName: 'f1.png', createdAt: SINCE + 1_000 }),
            makeItem('done', {
              type: 'image',
              fileId: 'f2',
              fileName: 'f2.png',
              createdAt: SINCE + 1_000,
              ocrText: 'есть',
              ocrAt: 6_000,
              ocrVisionAt: 6_000,
            }),
          ],
          files: [fileRec('f1', 'pic'), fileRec('f2', 'done')],
        })
        await importBackup(backupBlob(copy), mode)
        const pic = (await db.items.get('pic'))!
        expect(pic.ocrAutoSkipAt, mode).toBeTypeOf('number')
        expect(isVisionBacklog(pic, (await getSettings()).aiAutoOcrSince), mode).toBe(false)
        expect(needsVision(pic), mode).toBe(true) // кнопка «Распознать» остаётся
        expect(Object.hasOwn((await db.items.get('done'))!, 'ocrAutoSkipAt'), mode).toBe(false)
      }
    })

    it('merge: своя запись из задела в нём и остаётся; отметка не экспортируется и из копии не читается', async () => {
      await enableAuto()
      await db.files.put({ id: 'f1', itemId: 'own', blob: png(), name: 'a.png', mimeType: 'image/png', size: 3, createdAt: 1 })
      const own = makeItem('own', { type: 'image', fileId: 'f1', fileName: 'a.png', createdAt: SINCE + 1, updatedAt: 100 })
      await db.items.put(own)
      // в копии — та же запись новее и чужая отметка
      const copy = backup({
        items: [{ ...own, title: 'новее', updatedAt: 200, ocrAutoSkipAt: 1 } as Item],
        files: [fileRec('f1', 'own')],
      })
      await importBackup(backupBlob(copy), 'merge')
      const after = (await db.items.get('own'))!
      expect(after.title).toBe('новее')
      expect(Object.hasOwn(after, 'ocrAutoSkipAt')).toBe(false)
      expect(isVisionBacklog(after, SINCE)).toBe(true)

      await db.items.update('own', { ocrAutoSkipAt: 7_000 })
      const { data } = await readExport()
      expect(Object.hasOwn(data.items.find((i) => i.id === 'own')!, 'ocrAutoSkipAt')).toBe(false)
      // здешняя отметка переживает победу версии из копии
      await importBackup(backupBlob(backup({ items: [{ ...own, title: 'ещё новее', updatedAt: 300 }] })), 'merge')
      expect((await db.items.get('own'))!.ocrAutoSkipAt).toBe(7_000)
    })

    it('ocrClearedAt: переносится у записи с вложением без текста и идёт вместе с победившим текстом', () => {
      const clean = (patch: Record<string, unknown>) => sanitizeItem({ ...makeItem('x'), ...patch }, 1_000_000_000)!
      expect(clean({ type: 'file', fileId: 'f1', ocrAt: 5_000, ocrClearedAt: 5_000 }).ocrClearedAt).toBe(5_000)
      expect(Object.hasOwn(clean({ type: 'file', ocrAt: 5_000, ocrClearedAt: 5_000 }), 'ocrClearedAt')).toBe(false)
      expect(
        Object.hasOwn(clean({ type: 'file', fileId: 'f1', ocrText: 'текст', ocrClearedAt: 5_000 }), 'ocrClearedAt'),
      ).toBe(false)
    })

    it('merge: очистка на другом устройстве (свежее ocrAt) приходит вместе с отметкой', async () => {
      await db.files.put({ id: 'f1', itemId: 'doc', blob: png(), name: 'a.pdf', mimeType: 'application/pdf', size: 3, createdAt: 1 })
      const local = makeItem('doc', {
        type: 'file',
        fileId: 'f1',
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
        ocrText: 'слой',
        ocrAt: 3_000,
        updatedAt: 500,
      })
      await db.items.put(local)
      const { ocrText: _text, ...rest } = local
      const copy = backup({ items: [{ ...rest, ocrAt: 4_000, ocrClearedAt: 4_000, updatedAt: 400 }] })
      await importBackup(backupBlob(copy), 'merge')
      const after = (await db.items.get('doc'))!
      expect(after.ocrText).toBeUndefined()
      expect(after.ocrClearedAt).toBe(4_000)
      expect(needsVision(after)).toBe(false)
    })
  })

  it('deletedAt вне диапазона дат отбрасывается: запись приходит не в корзину', async () => {
    const deletedAt = Date.now() - 3 * DAY
    await importBackup(
      backupBlob(
        backup({
          items: [
            makeItem('huge', { deletedAt: 9e15 }),
            makeItem('neg', { deletedAt: -1 }),
            makeItem('future', { deletedAt: Date.now() + 365 * 86_400_000 }),
            makeItem('ok', { deletedAt }),
          ],
        }),
      ),
      'replace',
    )
    for (const id of ['huge', 'neg', 'future']) {
      expect(Object.hasOwn((await db.items.get(id))!, 'deletedAt'), id).toBe(false)
    }
    expect((await db.items.get('ok'))?.deletedAt).toBe(deletedAt)
    expect(await db.items.where('deletedAt').above(0).primaryKeys()).toEqual(['ok'])
  })

  it('merge: deletedAt приходит вместе с победившей версией записи', async () => {
    const deletedAt = Date.now() - DAY
    await db.items.bulkPut([
      makeItem('a', { updatedAt: 100 }),
      makeItem('b', { updatedAt: 500 }),
      makeItem('c', { updatedAt: 100, deletedAt: 700 }),
    ])
    const report = await importBackup(
      backupBlob(
        backup({
          items: [
            makeItem('a', { updatedAt: 200, deletedAt }),
            // при равном updatedAt остаётся локальная — вне корзины
            makeItem('b', { updatedAt: 500, deletedAt }),
            makeItem('c', { updatedAt: 300 }),
          ],
        }),
      ),
      'merge',
    )
    // В корзину пришла только записанная «a»: «b» из копии не записана, «c» записана вне корзины.
    expect(report).toEqual(rep({ items: 2, skipped: 1, trashed: 1 }))
    expect((await db.items.get('a'))?.deletedAt).toBe(deletedAt)
    expect(Object.hasOwn((await db.items.get('b'))!, 'deletedAt')).toBe(false)
    expect(Object.hasOwn((await db.items.get('c'))!, 'deletedAt')).toBe(false)
  })

  describe('корзина из копии и автоочистка', () => {
    const grace = IMPORTED_TRASH_GRACE_DAYS * DAY

    for (const mode of ['merge', 'replace'] as const) {
      it(`${mode}: запись, просроченная к моменту импорта, не стирается первой же автоочисткой`, async () => {
        await db.meta.put({ key: 'trashDays', value: 30 })
        await db.items.bulkPut([makeItem('live'), makeItem('gone', { status: 'library', deletedAt: Date.now() - 31 * DAY })])
        const { blob } = await readExport()
        // Автоочистка стёрла запись — копию импортируют, чтобы её вернуть.
        expect(await cleanupTrash()).toBe(1)
        expect(await db.items.get('gone')).toBeUndefined()

        const before = Date.now()
        await importBackup(blob, mode)
        const after = Date.now()

        const back = (await db.items.get('gone'))!
        expect(back.deletedAt).toBeGreaterThanOrEqual(before - (30 * DAY - grace))
        expect(back.deletedAt).toBeLessThanOrEqual(after - (30 * DAY - grace))
        expect(await cleanupTrash()).toBe(0)
        expect(await db.items.where('deletedAt').above(0).primaryKeys()).toEqual(['gone'])
        // Отсрочка — ровно IMPORTED_TRASH_GRACE_DAYS: после неё автоочистка работает как обычно.
        expect(await cleanupTrash(after + grace - DAY)).toBe(0)
        expect(await cleanupTrash(after + grace)).toBe(1)
        expect(await db.items.get('live')).toBeDefined()
      })
    }

    it('непросроченная отметка переносится без изменений, порядок корзины не меняется', async () => {
      const recent = Date.now() - 10 * DAY
      const older = Date.now() - 20 * DAY
      await importBackup(
        backupBlob(
          backup({
            items: [makeItem('recent', { deletedAt: recent }), makeItem('older', { deletedAt: older })],
            settings: { trashDays: 30 },
          }),
        ),
        'replace',
      )
      expect((await db.items.get('recent'))?.deletedAt).toBe(recent)
      expect((await db.items.get('older'))?.deletedAt).toBe(older)
    })

    it('срок короче отсрочки: запись получает весь срок', async () => {
      const before = Date.now()
      await importBackup(
        backupBlob(backup({ items: [makeItem('t', { deletedAt: 5_000 })], settings: { trashDays: 3 } })),
        'replace',
      )
      const at = (await db.items.get('t'))!.deletedAt!
      expect(at).toBeGreaterThanOrEqual(before)
      expect(at).toBeLessThanOrEqual(Date.now())
      expect(await cleanupTrash(at + 3 * DAY - 1)).toBe(0)
    })

    it('replace берёт срок из копии, без него — здешний; merge — всегда здешний', async () => {
      const old = makeItem('t', { deletedAt: 5_000 })
      const floorFor = (days: number, now: number) => now - (days - Math.min(days, IMPORTED_TRASH_GRACE_DAYS)) * DAY

      await db.meta.put({ key: 'trashDays', value: 60 })
      let now = Date.now()
      await importBackup(backupBlob(backup({ items: [old], settings: { trashDays: 10 } })), 'replace')
      expect((await db.items.get('t'))!.deletedAt!).toBeLessThanOrEqual(floorFor(10, Date.now()))
      expect((await db.items.get('t'))!.deletedAt!).toBeGreaterThanOrEqual(floorFor(10, now))

      await db.meta.put({ key: 'trashDays', value: 60 })
      now = Date.now()
      await importBackup(backupBlob(backup({ items: [old] })), 'replace')
      expect((await db.items.get('t'))!.deletedAt!).toBeGreaterThanOrEqual(floorFor(60, now))
      expect((await db.items.get('t'))!.deletedAt!).toBeLessThanOrEqual(floorFor(60, Date.now()))

      await reset()
      await db.meta.put({ key: 'trashDays', value: 60 })
      now = Date.now()
      await importBackup(backupBlob(backup({ items: [old], settings: { trashDays: 10 } })), 'merge')
      expect((await db.items.get('t'))!.deletedAt!).toBeGreaterThanOrEqual(floorFor(60, now))
      expect((await db.items.get('t'))!.deletedAt!).toBeLessThanOrEqual(floorFor(60, Date.now()))
    })

    it('автоочистка выключена (trashDays = 0): отметки не трогаются', async () => {
      await db.meta.put({ key: 'trashDays', value: 0 })
      await importBackup(backupBlob(backup({ items: [makeItem('t', { deletedAt: 5_000 })] })), 'merge')
      expect((await db.items.get('t'))?.deletedAt).toBe(5_000)
    })

    it('merge: локальная запись в корзине, оставшаяся победителем, не трогается', async () => {
      await db.items.put(makeItem('t', { updatedAt: 900, deletedAt: 5_000 }))
      await importBackup(backupBlob(backup({ items: [makeItem('t', { updatedAt: 100, deletedAt: 6_000 })] })), 'merge')
      expect((await db.items.get('t'))?.deletedAt).toBe(5_000)
    })
  })

  describe('распознанный текст при слиянии', () => {
    const scan = (patch: Partial<Item> = {}) => makeItem('scan', { type: 'image', fileId: 'f1', ...patch })
    beforeEach(async () => {
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
      await db.files.put({ id: 'f1', itemId: 'scan', blob, name: 'scan.png', mimeType: 'image/png', size: 3, createdAt: 1 })
    })

    it('версия из копии без распознавания не стирает локальный текст того же вложения', async () => {
      await db.items.put(scan({ updatedAt: 100, ocrText: 'Счёт № 42', ocrAt: 150 }))
      await importBackup(backupBlob(backup({ items: [scan({ title: 'с телефона', updatedAt: 500 })] })), 'merge')
      expect(await db.items.get('scan')).toMatchObject({ title: 'с телефона', ocrText: 'Счёт № 42', ocrAt: 150 })
    })

    it('«пробовали, текста нет» тоже сохраняется: автораспознавание не повторится', async () => {
      await db.items.put(scan({ updatedAt: 100, ocrAt: 150 }))
      await importBackup(backupBlob(backup({ items: [scan({ updatedAt: 500, ocrText: 'старый', ocrAt: 120 })] })), 'merge')
      const merged = (await db.items.get('scan'))!
      expect(merged.ocrAt).toBe(150)
      expect(Object.hasOwn(merged, 'ocrText')).toBe(false)
    })

    it('локальная версия новее, но распознавание пришло из копии — текст переносится, updatedAt прежний', async () => {
      await db.items.put(scan({ title: 'здесь', updatedAt: 900 }))
      const report = await importBackup(
        backupBlob(backup({ items: [scan({ updatedAt: 100, ocrText: 'Итого: 1 500', ocrAt: 300 })] })),
        'merge',
      )
      expect(report).toEqual(rep({ skipped: 1 }))
      expect(await db.items.get('scan')).toMatchObject({ title: 'здесь', updatedAt: 900, ocrText: 'Итого: 1 500', ocrAt: 300 })
    })

    it('более свежее распознавание побеждающей версии остаётся; другое вложение — не переносится', async () => {
      await db.items.bulkPut([
        scan({ updatedAt: 100, ocrText: 'старое', ocrAt: 150 }),
        makeItem('other', { type: 'image', fileId: 'f-local', updatedAt: 100, ocrText: 'локальное', ocrAt: 150 }),
      ])
      await importBackup(
        backupBlob(
          backup({
            items: [
              scan({ updatedAt: 500, ocrText: 'новое', ocrAt: 400 }),
              makeItem('other', { type: 'image', fileId: 'f-copy', updatedAt: 500 }),
            ],
          }),
        ),
        'merge',
      )
      expect(await db.items.get('scan')).toMatchObject({ ocrText: 'новое', ocrAt: 400 })
      const other = (await db.items.get('other'))!
      expect(Object.hasOwn(other, 'ocrText')).toBe(false)
      expect(Object.hasOwn(other, 'ocrAt')).toBe(false)
    })

    describe('ocrVisionAt — наибольший из двух версий', () => {
      it('побеждает версия из копии, локальная отметка зрения позже — остаётся локальная', async () => {
        await db.items.put(scan({ updatedAt: 100, ocrVisionAt: 300 }))
        await importBackup(backupBlob(backup({ items: [scan({ title: 'с телефона', updatedAt: 500, ocrVisionAt: 120 })] })), 'merge')
        expect(await db.items.get('scan')).toMatchObject({ title: 'с телефона', ocrVisionAt: 300 })
      })

      it('побеждает версия из копии без отметки — локальная «пробовали зрением» не теряется', async () => {
        // Неустранимая ошибка: только ocrVisionAt, без текста и ocrAt.
        await db.items.put(scan({ updatedAt: 100, ocrVisionAt: 250 }))
        await importBackup(backupBlob(backup({ items: [scan({ updatedAt: 500 })] })), 'merge')
        const merged = (await db.items.get('scan'))!
        expect(merged.ocrVisionAt).toBe(250)
        expect(Object.hasOwn(merged, 'ocrAt')).toBe(false)
        expect(Object.hasOwn(merged, 'ocrText')).toBe(false)
      })

      it('локальная версия новее, отметка зрения пришла из копии — переносится, отчёт «пропущено»', async () => {
        await db.items.put(scan({ title: 'здесь', updatedAt: 900, ocrText: 'слой', ocrAt: 500, ocrVisionAt: 100 }))
        const report = await importBackup(
          backupBlob(backup({ items: [scan({ updatedAt: 100, ocrAt: 200, ocrVisionAt: 200 })] })),
          'merge',
        )
        expect(report).toEqual(rep({ skipped: 1 }))
        // Текст локальный (ocrAt свежее), отметка зрения — наибольшая.
        expect(await db.items.get('scan')).toMatchObject({
          title: 'здесь',
          updatedAt: 900,
          ocrText: 'слой',
          ocrAt: 500,
          ocrVisionAt: 200,
        })
      })

      it('текст победил из копии, а отметка зрения больше у локальной — берётся локальная отметка', async () => {
        await db.items.put(scan({ updatedAt: 900, ocrAt: 150, ocrVisionAt: 700 }))
        await importBackup(
          backupBlob(backup({ items: [scan({ updatedAt: 100, ocrText: 'Итого', ocrAt: 400, ocrVisionAt: 400 })] })),
          'merge',
        )
        expect(await db.items.get('scan')).toMatchObject({ ocrText: 'Итого', ocrAt: 400, ocrVisionAt: 700 })
      })

      it('нет изменений — локальная запись не перезаписывается', async () => {
        const local = scan({ updatedAt: 900, ocrText: 'x', ocrAt: 500, ocrVisionAt: 500 })
        await db.items.put(local)
        const put = vi.spyOn(db.items, 'bulkPut')
        const report = await importBackup(
          backupBlob(backup({ items: [scan({ updatedAt: 100, ocrAt: 300, ocrVisionAt: 300 })] })),
          'merge',
        )
        expect(report).toEqual(rep({ skipped: 1 }))
        expect(await db.items.get('scan')).toEqual(local)
        // Ни одна запись не записана повторно ни слиянием, ни починкой целостности.
        for (const call of put.mock.calls) expect(call[0]).toEqual([])
      })

      it('другое вложение — отметка не переносится', async () => {
        await db.items.put(makeItem('other', { type: 'image', fileId: 'f-local', updatedAt: 100, ocrVisionAt: 900 }))
        await importBackup(
          backupBlob(backup({ items: [makeItem('other', { type: 'image', fileId: 'f-copy', updatedAt: 500 })] })),
          'merge',
        )
        expect(Object.hasOwn((await db.items.get('other'))!, 'ocrVisionAt')).toBe(false)
      })
    })
  })
})

/**
 * Копия прежнего формата (версия 1) — в том виде, в каком её писал экспорт до появления корзины,
 * положений нод и сохранённых поисков: без разделов positions/searches и без новых полей записей.
 */
const V1_COPY = {
  app: 'quickdrop',
  version: 1,
  exportedAt: 1_700_000_000_000,
  settings: { theme: 'dark', globalShortcut: 'Alt+Q' },
  categories: [{ id: 'cat-1', name: 'Работа', color: 'blue', order: 0, createdAt: 1_000 }],
  items: [
    {
      id: 'img',
      type: 'image',
      title: 'Запись img',
      content: 'Содержимое img',
      categoryId: 'cat-1',
      tags: ['фото', 'demo'],
      links: ['note'],
      status: 'library',
      favorite: 1,
      source: 'drop',
      createdAt: 1_000,
      updatedAt: 3_000,
      fileId: 'file-1',
      fileName: 'photo.png',
      fileSize: 5,
      mimeType: 'image/png',
      processedAt: 2_000,
    },
    {
      id: 'note',
      type: 'link',
      title: '',
      content: 'Комментарий к ссылке',
      categoryId: null,
      tags: [],
      links: ['img'],
      status: 'archive',
      favorite: 0,
      source: 'paste',
      createdAt: 1_000,
      updatedAt: 1_000,
      url: 'https://example.com/a',
      linkMeta: { status: 'ok', title: 'Пример', fetchedAt: 1_500 },
      prevStatus: 'library',
      ai: { summary: 'кратко', suggestedTags: ['x'], model: 'm', generatedAt: 5 },
    },
  ],
  files: [
    {
      id: 'file-1',
      itemId: 'img',
      name: 'photo.png',
      mimeType: 'image/png',
      size: 5,
      createdAt: 1_000,
      thumb: 'iVBORwEC',
      thumbType: 'image/png',
      data: 'AQIDBAU=',
    },
  ],
}

describe('копия прежнего формата (версия 1)', () => {
  const v1Blob = () => new Blob([JSON.stringify(V1_COPY)], { type: 'application/json' })

  it('replace: данные восстановлены полностью, положения и поиски пусты', async () => {
    // Локальные данные новых таблиц: полная замена стирает их и при старой копии.
    await db.items.put(makeItem('old'))
    await db.positions.put({ id: 'old', x: 1, y: 1 })
    await db.searches.put(makeSearch('old-s', 'Старый', 'tag:old'))

    expect(await importBackup(v1Blob(), 'replace')).toEqual(rep({ items: 2, files: 1, categories: 1 }))

    // Картинка без распознанного текста пришла импортом: авто её не отправляет (ocrAutoSkipAt).
    expect(await db.items.toArray()).toEqual(
      V1_COPY.items.map((it) => (it.id === 'img' ? { ...it, ocrAutoSkipAt: expect.any(Number) } : it)),
    )
    expect(await db.categories.toArray()).toEqual(V1_COPY.categories)
    const file = (await db.files.get('file-1'))!
    expect(file).toMatchObject({ itemId: 'img', name: 'photo.png', mimeType: 'image/png', size: 5, createdAt: 1_000 })
    expect([...(await bytesOf(file.blob))]).toEqual([1, 2, 3, 4, 5])
    expect(file.blob.type).toBe('image/png')
    expect([...(await bytesOf(file.thumb!))]).toEqual([0x89, 0x50, 0x4e, 0x47, 1, 2])
    expect(file.thumb!.type).toBe('image/png')
    expect(await metaMap()).toEqual({ theme: 'dark', globalShortcut: 'Alt+Q', seeded: true })

    expect(await db.positions.count()).toBe(0)
    expect(await db.searches.count()).toBe(0)
    expect(await db.items.where('deletedAt').above(0).count()).toBe(0)
  })

  it('merge: записи слиты, локальные положения, поиски и корзина не тронуты', async () => {
    const localSearch = makeSearch('mine', 'Мой поиск', 'is:fav')
    // Категория та же, что у версии из копии: смена категории сняла бы положение (Р8).
    await db.categories.put(V1_COPY.categories[0] as Category)
    await db.items.bulkPut([
      makeItem('img', { title: 'локальная', categoryId: 'cat-1', updatedAt: 100 }),
      makeItem('in-trash', { deletedAt: 2_000 }),
    ])
    await db.positions.bulkPut([
      { id: 'img', x: 40, y: -40 },
      { id: 'in-trash', x: 8, y: 8 },
    ])
    await db.searches.put(localSearch)

    expect(await importBackup(v1Blob(), 'merge')).toEqual(rep({ items: 2, files: 1, skipped: 1 }))

    expect(await db.items.get('img')).toEqual(V1_COPY.items[0])
    expect(await db.items.get('note')).toEqual(V1_COPY.items[1])
    expect((await db.items.get('in-trash'))?.deletedAt).toBe(2_000)
    expect(await db.positions.toArray()).toEqual([
      { id: 'img', x: 40, y: -40 },
      { id: 'in-trash', x: 8, y: 8 },
    ])
    expect(await db.searches.toArray()).toEqual([localSearch])
  })

  it('копия версии 1 после импорта экспортируется уже в текущем формате без потерь', async () => {
    await importBackup(v1Blob(), 'replace')
    const { data } = await readExport()
    expect(data.version).toBe(BACKUP_VERSION)
    expect(data.items).toEqual(V1_COPY.items)
    expect(data.categories).toEqual(V1_COPY.categories)
    expect(data.files).toEqual(V1_COPY.files)
    expect(data.settings).toEqual(V1_COPY.settings)
    expect(data.positions).toEqual([])
    expect(data.searches).toEqual([])
  })

  it('читаются все версии формата от 1 до текущей', async () => {
    for (let version = 1; version <= BACKUP_VERSION; version++) {
      await reset()
      const report = await importBackup(backupBlob(backup({ version, items: [makeItem(`v${version}`)] })), 'replace')
      expect(report, `версия ${version}`).toEqual(rep({ items: 1 }))
      expect(await db.items.get(`v${version}`), `версия ${version}`).toBeDefined()
    }
  })

  it('разделы positions/searches: не массив — не ошибка, массив читается в любой версии', async () => {
    for (let version = 1; version <= BACKUP_VERSION; version++) {
      await reset()
      const broken = { ...backup({ version, items: [makeItem('a')] }), positions: 'x', searches: { a: 1 } }
      expect(await importBackup(backupBlob(broken), 'replace'), `версия ${version}`).toEqual(rep({ items: 1 }))

      const full = backup({
        version,
        items: [makeItem('a')],
        positions: [{ id: 'a', x: 1, y: 2 }],
        searches: [makeSearch('s', 'Поиск', 'tag:a')],
      })
      expect(await importBackup(backupBlob(full), 'replace'), `версия ${version}`).toEqual(
        rep({ items: 1, positions: 1, searches: 1 }),
      )
    }
  })
})

describe('новые настройки', () => {
  /** Всё, что копия переносит между устройствами; остальное — PRIVATE_SETTINGS. */
  const PORTABLE: Array<keyof Settings> = [
    'theme',
    'globalShortcut',
    'scene',
    'font',
    'ambient',
    'trashDays',
    'closeToTray',
    'captureWindow',
  ]

  it('каждая настройка либо переносится копией, либо приватная', () => {
    const exported = Object.keys(DEFAULT_SETTINGS).filter((key) => !PRIVATE_SETTINGS.has(key))
    expect(exported.sort()).toEqual([...PORTABLE].sort())
    for (const key of PRIVATE_SETTINGS) expect(Object.hasOwn(DEFAULT_SETTINGS, key), key).toBe(true)
  })

  it('пути, состояние копий, распознавание и расширение не попадают в экспорт; оформление и корзина — попадают', async () => {
    const portable = {
      theme: 'light',
      globalShortcut: 'Alt+Q',
      scene: 'winter',
      font: 'pixel',
      ambient: false,
      trashDays: 7,
      closeToTray: true,
      captureWindow: false,
    }
    await db.meta.bulkPut([
      ...Object.entries(portable).map(([key, value]) => ({ key, value })),
      { key: 'backupDir', value: 'C:\\Users\\me\\Backups' },
      { key: 'backupLastAt', value: 1_700_000_000_000 },
      { key: 'backupEvery', value: 'weekly' },
      { key: 'backupKeep', value: 3 },
      { key: 'mdExportDir', value: 'D:\\Vault\\Notes' },
      { key: 'aiAutoOcr', value: true },
      { key: 'aiAutoOcrSince', value: 1_762_819_200_123 },
      { key: 'aiVisionModel', value: 'vision-x' },
      { key: 'extEnabled', value: true },
      { key: 'extPort', value: 50123 },
      { key: 'extToken', value: 'tok-secret' },
    ])
    const { text, data } = await readExport()
    for (const s of [
      'Backups',
      'Vault',
      'vision-x',
      'tok-secret',
      'backupDir',
      'backupLastAt',
      'backupEvery',
      'backupKeep',
      'mdExportDir',
      'aiAutoOcr',
      'aiAutoOcrSince',
      '1762819200123',
      'aiVisionModel',
      'extEnabled',
      'extPort',
      'extToken',
    ]) {
      expect(text, s).not.toContain(s)
    }
    expect(data.settings).toEqual(portable)
  })

  it('чужая копия не меняет папки копий, их расписание и число, распознавание и приём от расширения', async () => {
    const local = {
      backupDir: 'C:\\Mine',
      backupLastAt: 111,
      // Меньшее число копий из импортированной базы стёрло бы при ближайшей автокопии здешнюю историю.
      backupEvery: 'weekly',
      backupKeep: 30,
      mdExportDir: 'C:\\MineMd',
      aiAutoOcr: false,
      aiAutoOcrSince: 222,
      aiVisionModel: 'local-vision',
      extEnabled: false,
      extPort: 47821,
      extToken: 'local-token',
      scene: 'meadow',
    }
    await db.meta.bulkPut(Object.entries(local).map(([key, value]) => ({ key, value })))
    const foreign = {
      scene: 'paper',
      font: 'soft',
      ambient: false,
      trashDays: 14,
      closeToTray: true,
      captureWindow: false,
    }
    await importBackup(
      backupBlob({
        ...backup(),
        settings: {
          ...foreign,
          backupDir: 'C:\\Evil',
          backupLastAt: 5,
          backupEvery: 'daily',
          backupKeep: 1,
          mdExportDir: 'C:\\EvilMd',
          aiAutoOcr: true,
          aiAutoOcrSince: 1,
          aiVisionModel: 'evil-vision',
          extEnabled: true,
          extPort: 2000,
          extToken: 'evil-token',
        },
      }),
      'replace',
    )
    expect(await metaMap()).toEqual({ ...local, ...foreign, seeded: true })
  })

  it('негодные значения настроек из копии игнорируются', async () => {
    await db.meta.bulkPut([
      { key: 'scene', value: 'winter' },
      { key: 'trashDays', value: 30 },
    ])
    await importBackup(
      backupBlob({
        ...backup(),
        settings: {
          scene: 'neon',
          font: 5,
          ambient: 'yes',
          trashDays: -1,
          backupEvery: 'hourly',
          backupKeep: 0,
          closeToTray: 1,
          captureWindow: 'yes',
          globalShortcut: 'x'.repeat(5000),
          theme: 'neon',
        },
      }),
      'replace',
    )
    expect(await metaMap()).toEqual({ scene: 'winter', trashDays: 30, seeded: true })
  })

  it('merge настройки не переносит', async () => {
    await db.meta.put({ key: 'scene', value: 'winter' })
    await importBackup(backupBlob(backup({ settings: { scene: 'paper', trashDays: 5 } })), 'merge')
    expect(await metaMap()).toEqual({ scene: 'winter', seeded: true })
  })
})

describe('размер копии', () => {
  const fileRow = (id: string, bytes: number): StoredFile => ({
    id,
    itemId: id,
    blob: new Blob([makeBytes(bytes)]),
    name: `${id}.bin`,
    mimeType: 'application/octet-stream',
    size: bytes,
    createdAt: 1,
  })

  it('экспорт заранее отказывает с понятной ошибкой, если копию нельзя будет восстановить', async () => {
    await db.items.bulkPut([makeItem('a', { type: 'file', fileId: 'a' }), makeItem('b', { type: 'file', fileId: 'b' })])
    await db.files.bulkPut([fileRow('a', 60_000), fileRow('b', 60_000)])
    await expect(exportBackup({ maxBytes: 100_000 })).rejects.toThrow(
      /слишком большой.*Очистите корзину, удалите крупные файлы или сохраните их отдельно и повторите экспорт\.$/s,
    )
    // С запасом по пределу — экспортируется, а оценка не меньше фактического размера.
    const blob = await exportBackup({ maxBytes: 1_000_000 })
    const files = (await db.files.toArray()) as StoredFile[]
    expect(estimateBackupBytes(0, files)).toBeGreaterThanOrEqual(blob.size - 2_000)
    const data = JSON.parse(await blob.text()) as BackupData
    expect(data.files.map((f) => f.id).sort()).toEqual(['a', 'b'])
  })

  it('импорт сразу отклоняет файл больше предела, не читая его и не трогая базу', async () => {
    await db.items.put(makeItem('keep'))
    let read = false
    const huge = {
      size: MAX_BACKUP_BYTES + 1,
      text: async () => {
        read = true
        return ''
      },
    } as unknown as Blob
    await expect(importBackup(huge, 'replace')).rejects.toThrow(/слишком большой/)
    expect(read).toBe(false)
    expect(await db.items.count()).toBe(1)
  })
})
