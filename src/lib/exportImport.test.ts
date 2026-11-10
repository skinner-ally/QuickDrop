import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import {
  backupFileName,
  base64ToBytes,
  blobToBase64,
  estimateBackupBytes,
  exportBackup,
  importBackup,
  MAX_BACKUP_BYTES,
  type BackupData,
} from '@/lib/exportImport'
import type { Category, Item, StoredFile } from '@/types'

async function reset() {
  await db.items.clear()
  await db.files.clear()
  await db.categories.clear()
  await db.meta.clear()
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
    version: 1,
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
    expect(data.version).toBe(1)
    expect(typeof data.exportedAt).toBe('number')
    expect(data.files).toHaveLength(1)
    expect(typeof data.files[0].data).toBe('string')
    expect(data.files[0].thumbType).toBe('image/png')
    expect(data.settings).toEqual({ theme: 'dark', globalShortcut: 'Alt+Q' })

    await reset()
    const report = await importBackup(blob, 'replace')
    expect(report).toEqual({ items: 2, files: 1, categories: 1, skipped: 0 })

    expect(await db.items.get('img')).toEqual(image)
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

    expect(report).toEqual({ items: 1, files: 0, categories: 1, skipped: 0 })
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

    expect(report).toEqual({ items: 2, files: 0, categories: 0, skipped: 2 })
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

    expect(report).toEqual({ items: 3, files: 0, categories: 1, skipped: 2 })
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

    expect(report).toEqual({ items: 1, files: 2, categories: 0, skipped: 3 })
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

    expect(report).toEqual({ items: 5, files: 0, categories: 1, skipped: 6 })
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
      [backupBlob(backup({ version: 2 })), /более новой версией/],
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
    expect((await get('img')).linkMeta).toMatchObject({
      image: 'https://cdn.example.com/i.png',
      favicon: 'http://e.com/f.ico',
    })
  })

  it('пустая копия в режиме merge ничего не ломает', async () => {
    await db.items.put(makeItem('keep'))
    expect(await importBackup(backupBlob(backup()), 'merge')).toEqual({
      items: 0,
      files: 0,
      categories: 0,
      skipped: 0,
    })
    expect(await db.items.count()).toBe(1)
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
    await expect(exportBackup({ maxBytes: 100_000 })).rejects.toThrow(/слишком большой.*Удалите крупные файлы/s)
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
