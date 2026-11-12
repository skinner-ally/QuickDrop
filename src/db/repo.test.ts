import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db'
import {
  addTags,
  applyLinkMeta,
  clearPositions,
  createCategory,
  createItem,
  createSavedSearch,
  deleteCategory,
  deleteItem,
  deleteItems,
  deleteSavedSearch,
  deleteTag,
  emptyTrash,
  findDuplicateLink,
  getFile,
  getItem,
  getPositions,
  linkItems,
  listCategories,
  listSavedSearches,
  makeThumb,
  matchesFilter,
  MAX_FILE_SIZE,
  normalizeTag,
  normalizeTags,
  purgeExpired,
  purgeItems,
  removePositions,
  removeTag,
  renameTag,
  reorderSavedSearches,
  restoreFromTrash,
  restoreItem,
  restoreItems,
  restoreSavedSearch,
  setCategory,
  setOcrText,
  setPositions,
  setStatus,
  sortItems,
  toggleFavorite,
  unarchive,
  unlinkItems,
  updateCategory,
  updateItem,
  updateSavedSearch,
} from './repo'
import { getSettings, setSetting, setSettings } from './settings'
import { QUOTA_MESSAGE } from '@/lib/errors'
import { MAX_OCR_TEXT } from '@/lib/normalize'
import {
  CATEGORY_COLORS,
  DEFAULT_SETTINGS,
  SAVED_SEARCH_NAME_MAX,
  SAVED_SEARCH_QUERY_MAX,
  type GraphPoint,
  type Item,
  type LinkMeta,
} from '@/types'

const DAY = 86_400_000

beforeEach(async () => {
  await Promise.all([
    db.items.clear(),
    db.files.clear(),
    db.categories.clear(),
    db.meta.clear(),
    db.positions.clear(),
    db.searches.clear(),
  ])
})

/** Гарантирует, что следующий Date.now() будет больше текущего. */
async function tick(): Promise<void> {
  const start = Date.now()
  while (Date.now() === start) await new Promise((r) => setTimeout(r, 1))
}

function makeItem(over: Partial<Item> = {}): Item {
  return {
    id: crypto.randomUUID(),
    type: 'text',
    title: '',
    content: '',
    categoryId: null,
    tags: [],
    links: [],
    status: 'inbox',
    favorite: 0,
    source: 'manual',
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  }
}

describe('normalizeTag', () => {
  it('trim, нижний регистр, без #, пробелы → -', () => {
    expect(normalizeTag('  #React  ')).toBe('react')
    expect(normalizeTag('##Идеи на Потом')).toBe('идеи-на-потом')
    expect(normalizeTag('# spaced')).toBe('spaced')
    expect(normalizeTag('   ')).toBe('')
  })

  it('normalizeTags убирает пустые и дубли', () => {
    expect(normalizeTags(['A', '#a', ' ', 'b', 'B '])).toEqual(['a', 'b'])
  })
})

describe('createItem', () => {
  it('заполняет значения по умолчанию', async () => {
    const before = Date.now()
    const item = await createItem({ type: 'text', content: 'Привет', tags: ['#Work', 'work', 'Big Idea'] })
    expect(item.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(item.status).toBe('inbox')
    expect(item.favorite).toBe(0)
    expect(item.categoryId).toBeNull()
    expect(item.links).toEqual([])
    expect(item.tags).toEqual(['work', 'big-idea'])
    expect(item.source).toBe('manual')
    expect(item.createdAt).toBeGreaterThanOrEqual(before)
    expect(item.updatedAt).toBe(item.createdAt)
    expect(await getItem(item.id)).toEqual(item)
  })

  it('учитывает favorite, status, url, language', async () => {
    const link = await createItem({
      type: 'link',
      url: 'https://example.com',
      favorite: true,
      status: 'library',
      source: 'paste',
    })
    expect(link.favorite).toBe(1)
    expect(link.url).toBe('https://example.com')
    expect(link.status).toBe('library')
    expect(link.processedAt).toBe(link.createdAt)
    expect(link.source).toBe('paste')

    const code = await createItem({ type: 'code', content: 'const a = 1', language: 'ts' })
    expect(code.language).toBe('ts')
    expect(code.url).toBeUndefined()
  })

  it('сохраняет файл в таблицу files', async () => {
    const blob = new Blob(['hello world'], { type: 'text/plain' })
    const item = await createItem({ type: 'file', file: blob, fileName: 'notes.txt' })
    expect(item.fileId).toBeTruthy()
    expect(item.fileName).toBe('notes.txt')
    expect(item.fileSize).toBe(11)
    expect(item.mimeType).toBe('text/plain')

    const stored = await getFile(item.fileId!)
    expect(stored).toBeDefined()
    expect(stored!.itemId).toBe(item.id)
    expect(stored!.name).toBe('notes.txt')
    expect(stored!.size).toBe(11)
    expect(stored!.thumb).toBeUndefined()
    expect(await stored!.blob.text()).toBe('hello world')
  })

  it('берёт имя из File, а изображение без canvas API сохраняет без превью', async () => {
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'pic.png', { type: 'image/png' })
    const item = await createItem({ type: 'image', file })
    expect(item.fileName).toBe('pic.png')
    expect(item.mimeType).toBe('image/png')
    const stored = await getFile(item.fileId!)
    expect(stored!.thumb).toBeUndefined()
    expect(stored!.size).toBe(4)
  })

  it('файл без типа получает application/octet-stream и имя по умолчанию', async () => {
    const item = await createItem({ type: 'file', file: new Blob(['x']) })
    expect(item.mimeType).toBe('application/octet-stream')
    expect(item.fileName).toBe('file')
  })

  it('HTML хранится как octet-stream: объявленный тип только в mimeType', async () => {
    const file = new File(['<script>alert(1)</script>'], 'page.html', { type: 'text/html' })
    const item = await createItem({ type: 'file', file })
    expect(item.mimeType).toBe('text/html')
    const stored = (await getFile(item.fileId!))!
    expect(stored.mimeType).toBe('text/html')
    expect(stored.blob.type).toBe('application/octet-stream')
    expect(await stored.blob.text()).toBe('<script>alert(1)</script>')
  })

  it('makeThumb не падает без API и для svg', async () => {
    expect(await makeThumb(new Blob(['<svg/>'], { type: 'image/svg+xml' }))).toBeUndefined()
    expect(await makeThumb(new Blob(['x'], { type: 'image/png' }))).toBeUndefined()
  })

  describe('HEIC/TIFF: картинка, только если движок её декодирует', () => {
    afterEach(() => vi.unstubAllGlobals())
    const heic = () => new File([new Uint8Array([0, 0, 0, 24])], 'IMG_0001.HEIC', { type: 'image/heic' })

    it('Chromium/WebView2 не декодирует → сохраняется как файл', async () => {
      vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('unsupported')))
      const item = await createItem({ type: 'image', file: heic() })
      expect(item.type).toBe('file')
      expect((await getItem(item.id))!.type).toBe('file')
      // и по расширению при пустом MIME
      const noMime = new File([new Uint8Array([1])], 'scan.tiff')
      expect((await createItem({ type: 'image', file: noMime })).type).toBe('file')
    })

    it('Safari декодирует → остаётся картинкой; обычные форматы не проверяются', async () => {
      const close = vi.fn()
      vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 100, close }))
      expect((await createItem({ type: 'image', file: heic() })).type).toBe('image')
      expect(close).toHaveBeenCalled()

      vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('broken')))
      const png = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })
      expect((await createItem({ type: 'image', file: png })).type).toBe('image')
    })

    it('без API (тесты, старые движки) — не понижаем', async () => {
      expect((await createItem({ type: 'image', file: heic() })).type).toBe('image')
    })
  })
})

describe('updateItem', () => {
  it('обновляет поля, нормализует теги и updatedAt', async () => {
    const item = await createItem({ type: 'text', content: 'a' })
    await tick()
    await updateItem(item.id, { title: '  Новый  ', tags: ['X', '#x', 'Y'], content: 'b' })
    const got = (await getItem(item.id))!
    expect(got.title).toBe('Новый')
    expect(got.tags).toEqual(['x', 'y'])
    expect(got.content).toBe('b')
    expect(got.updatedAt).toBeGreaterThan(item.updatedAt)
    expect(got.createdAt).toBe(item.createdAt)
  })

  it('новый адрес сбрасывает метаданные прежней страницы, тот же адрес — нет', async () => {
    const meta: LinkMeta = { status: 'ok', title: 'Страница A', image: 'https://a.example/i.png' }
    const item = await createItem({ type: 'link', url: 'https://a.example' })
    await updateItem(item.id, { linkMeta: meta })

    // тот же адрес после нормализации
    await updateItem(item.id, { url: 'a.example' })
    expect((await getItem(item.id))!.linkMeta).toEqual(meta)

    await updateItem(item.id, { url: 'b.example' })
    const got = (await getItem(item.id))!
    expect(got.url).toBe('https://b.example')
    expect('linkMeta' in got).toBe(false)

    // явные метаданные в том же патче не теряются
    await updateItem(item.id, { url: 'c.example', linkMeta: { status: 'ok', title: 'C' } })
    expect((await getItem(item.id))!.linkMeta).toEqual({ status: 'ok', title: 'C' })
  })

  it('applyLinkMeta пишет, только пока у записи тот же адрес', async () => {
    const item = await createItem({ type: 'link', url: 'https://a.example' })
    expect(await applyLinkMeta(item.id, 'https://a.example', { status: 'ok', title: 'A' })).toBe(true)
    expect((await getItem(item.id))!.linkMeta).toEqual({ status: 'ok', title: 'A' })

    await updateItem(item.id, { url: 'https://b.example' })
    expect(await applyLinkMeta(item.id, 'https://a.example', { status: 'ok', title: 'A2' })).toBe(false)
    expect((await getItem(item.id))!.linkMeta).toBeUndefined()
    expect(await applyLinkMeta('nope', 'https://a.example', { status: 'failed' })).toBe(false)
    expect(await getItem('nope')).toBeUndefined()
  })

  it('переполнение хранилища — понятная ошибка вместо AbortError', async () => {
    const quota = new DOMException('full', 'QuotaExceededError')
    vi.spyOn(db.files, 'add').mockRejectedValueOnce(quota)
    await expect(
      createItem({ type: 'file', file: new Blob(['data']), fileName: 'big.bin' }),
    ).rejects.toThrow(QUOTA_MESSAGE)
    expect(await db.items.count()).toBe(0)

    const item = await createItem({ type: 'text', content: 'a' })
    vi.spyOn(db.items, 'update').mockRejectedValueOnce(quota)
    await expect(updateItem(item.id, { content: 'b'.repeat(10) })).rejects.toThrow(QUOTA_MESSAGE)
    vi.restoreAllMocks()
  })
})

describe('deleteItem / restoreItem', () => {
  it('отмена удаления не возвращает вечную «загрузку» метаданных', async () => {
    const a = await createItem({ type: 'link', url: 'https://a.example' })
    const b = await createItem({ type: 'link', url: 'https://b.example' })
    await applyLinkMeta(a.id, 'https://a.example', { status: 'pending' })
    await applyLinkMeta(b.id, 'https://b.example', { status: 'pending', title: 'B' })
    const snaps = await deleteItems([a.id, b.id])
    await restoreItems(snaps)
    expect((await getItem(a.id))!.linkMeta).toEqual({ status: 'failed' })
    expect((await getItem(b.id))!.linkMeta).toEqual({ status: 'ok', title: 'B' })
  })

  it('отмена после окончательного удаления тоже не возвращает вечную «загрузку»', async () => {
    const a = await createItem({ type: 'link', url: 'https://a.example' })
    const b = await createItem({ type: 'link', url: 'https://b.example' })
    await applyLinkMeta(a.id, 'https://a.example', { status: 'pending' })
    await applyLinkMeta(b.id, 'https://b.example', { status: 'pending', title: 'B' })
    const snaps = await deleteItems([a.id, b.id])
    expect(await purgeItems([a.id, b.id])).toBe(2)
    await restoreItems(snaps)
    expect((await getItem(a.id))!.linkMeta).toEqual({ status: 'failed' })
    expect((await getItem(b.id))!.linkMeta).toEqual({ status: 'ok', title: 'B' })
  })

  it('deleteItem переносит в корзину: файл и связи соседей на месте, restore возвращает запись как была', async () => {
    const a = await createItem({ type: 'file', file: new Blob(['data'], { type: 'text/plain' }), fileName: 'a.txt' })
    const b = await createItem({ type: 'text', content: 'b' })
    const c = await createItem({ type: 'text', content: 'c' })
    await linkItems(a.id, b.id)
    await linkItems(a.id, c.id)
    const [aFull, bFull, cFull] = (await db.items.bulkGet([a.id, b.id, c.id])) as Item[]
    await tick()

    const before = Date.now()
    const snap = await deleteItem(a.id)
    expect(snap.item).toEqual(aFull)
    expect('deletedAt' in snap.item).toBe(false)
    expect(snap.file?.id).toBe(a.fileId)
    expect(snap.linkedIds.sort()).toEqual([b.id, c.id].sort())

    // Запись осталась в БД: изменилось только deletedAt.
    const trashed = (await getItem(a.id))!
    expect(trashed.deletedAt).toBeGreaterThanOrEqual(before)
    expect(trashed).toEqual({ ...aFull, deletedAt: trashed.deletedAt })
    expect(await (await getFile(a.fileId!))!.blob.text()).toBe('data')
    expect(await db.files.count()).toBe(1)
    expect(await getItem(b.id)).toEqual(bFull)
    expect(await getItem(c.id)).toEqual(cFull)

    await tick()
    await restoreItem(snap)
    const restored = (await getItem(a.id))!
    expect('deletedAt' in restored).toBe(false)
    expect(restored).toEqual(aFull)
    expect(await getItem(b.id)).toEqual(bFull)
    expect(await getItem(c.id)).toEqual(cFull)
    expect(await (await getFile(a.fileId!))!.blob.text()).toBe('data')
  })

  it('deleteItem бросает для несуществующей записи и для записи, уже лежащей в корзине', async () => {
    await expect(deleteItem('nope')).rejects.toThrow('Запись не найдена')
    const item = await createItem({ type: 'text', content: 'x' })
    await deleteItem(item.id)
    const trashed = await getItem(item.id)
    await expect(deleteItem(item.id)).rejects.toThrow('Запись уже в корзине')
    // Повторная попытка не сдвигает дату удаления: от неё считается срок автоочистки.
    expect(await getItem(item.id)).toEqual(trashed)
  })

  it('restore сбрасывает удалённую за это время категорию', async () => {
    const cat = await createCategory('Работа')
    const item = await createItem({ type: 'text', content: 'x', categoryId: cat.id })
    const snap = await deleteItem(item.id)
    await deleteCategory(cat.id)
    await restoreItem(snap)
    expect((await getItem(item.id))!.categoryId).toBeNull()
  })

  it('restore после окончательного удаления: исчезнувшая категория сбрасывается, существующая остаётся', async () => {
    const gone = await createCategory('Работа')
    const kept = await createCategory('Дом')
    const a = await createItem({ type: 'text', content: 'a', categoryId: gone.id })
    const b = await createItem({ type: 'text', content: 'b', categoryId: kept.id })
    const snaps = await deleteItems([a.id, b.id])
    await purgeItems([a.id, b.id])
    await deleteCategory(gone.id)
    await restoreItems(snaps)
    expect((await getItem(a.id))!.categoryId).toBeNull()
    expect((await getItem(b.id))!.categoryId).toBe(kept.id)
  })
})

describe('корзина', () => {
  it('deleteItems меняет только deletedAt: updatedAt, связи, файл и положение на графе не тронуты', async () => {
    const a = await createItem({ type: 'file', file: new Blob(['data'], { type: 'text/plain' }), fileName: 'a.txt' })
    const b = await createItem({ type: 'text', content: 'b' })
    const n = await createItem({ type: 'text', content: 'n' })
    await linkItems(a.id, b.id)
    await linkItems(b.id, n.id)
    await setPositions({ [a.id]: { x: 32, y: 64 }, [b.id]: { x: 0, y: 0 }, [n.id]: { x: -32, y: 0 } })
    const [a0, b0, n0] = (await db.items.bulkGet([a.id, b.id, n.id])) as Item[]
    const positions = await getPositions()
    await tick()

    const snaps = await deleteItems([a.id, b.id, 'missing', a.id])
    expect(snaps.map((s) => s.item.id)).toEqual([a.id, b.id])

    const [a1, b1] = (await db.items.bulkGet([a.id, b.id])) as Item[]
    // Одна отметка времени на пакет.
    expect(a1.deletedAt).toBeGreaterThan(a0.updatedAt)
    expect(b1.deletedAt).toBe(a1.deletedAt)
    expect(a1).toEqual({ ...a0, deletedAt: a1.deletedAt })
    expect(b1).toEqual({ ...b0, deletedAt: a1.deletedAt })
    expect(await getItem(n.id)).toEqual(n0)
    expect(await db.files.count()).toBe(1)
    expect(await getPositions()).toEqual(positions)

    // Записи в корзине повторно не переносятся: пустой результат, дата удаления прежняя.
    await tick()
    expect(await deleteItems([a.id, b.id])).toEqual([])
    expect((await getItem(a.id))!.deletedAt).toBe(a1.deletedAt)
    expect(await deleteItems([])).toEqual([])
  })

  it('getItem отдаёт запись из корзины, matchesFilter прячет её без trashed', async () => {
    const item = await createItem({ type: 'text', content: 'x' })
    await deleteItem(item.id)
    const trashed = (await getItem(item.id))!
    expect(trashed.deletedAt).toBeDefined()
    expect(matchesFilter(trashed, {})).toBe(false)
    expect(matchesFilter(trashed, { trashed: true })).toBe(true)
    expect(matchesFilter(item, { trashed: true })).toBe(false)
  })

  it('restoreFromTrash возвращает как было; несуществующие и не лежащие в корзине пропускает', async () => {
    const a = await createItem({ type: 'link', url: 'https://a.example' })
    const b = await createItem({ type: 'text', content: 'b' })
    const c = await createItem({ type: 'text', content: 'c' })
    const outside = await createItem({ type: 'text', content: 'd' })
    await linkItems(a.id, b.id)
    const [a0, b0] = (await db.items.bulkGet([a.id, b.id])) as Item[]
    await deleteItems([a.id, b.id, c.id])
    await tick()

    await restoreFromTrash(a.id)
    expect(await getItem(a.id)).toEqual(a0)
    expect((await getItem(b.id))!.deletedAt).toBeDefined()

    await restoreFromTrash([b.id, outside.id, 'missing', b.id])
    expect(await getItem(b.id)).toEqual(b0)
    expect(await getItem(outside.id)).toEqual(outside)
    expect(await getItem('missing')).toBeUndefined()
    expect((await getItem(c.id))!.deletedAt).toBeDefined()
    expect(await db.items.where('deletedAt').above(0).primaryKeys()).toEqual([c.id])

    // Загрузка метаданных, оборвавшаяся, пока запись лежала в корзине, не висит вечно.
    await applyLinkMeta(a.id, 'https://a.example', { status: 'pending' })
    await deleteItem(a.id)
    await restoreFromTrash(a.id)
    expect((await getItem(a.id))!.linkMeta).toEqual({ status: 'failed' })
  })

  it('restoreItems не трогает запись вне корзины и не затирает правки, сделанные в корзине', async () => {
    const a = await createItem({ type: 'text', content: 'старое', tags: ['js'] })
    const b = await createItem({ type: 'text', content: 'b', tags: ['js'] })
    const snaps = await deleteItems([a.id, b.id])

    // a вернули и отредактировали; b всё ещё в корзине, но тег переименовали по всей базе.
    await restoreFromTrash(a.id)
    await updateItem(a.id, { content: 'новое' })
    await renameTag('js', 'javascript')
    const aNow = (await getItem(a.id))!
    await tick()

    await restoreItems(snaps)
    expect(await getItem(a.id)).toEqual(aNow)
    const bNow = (await getItem(b.id))!
    expect('deletedAt' in bNow).toBe(false)
    expect(bNow.tags).toEqual(['javascript'])
    expect(await db.items.count()).toBe(2)
  })

  it('теги и категории меняются и у записей в корзине', async () => {
    const cat = await createCategory('Временная')
    const a = await createItem({ type: 'text', content: 'a', tags: ['old', 'tmp'], categoryId: cat.id })
    await deleteItem(a.id)
    await renameTag('old', 'new')
    await deleteTag('tmp')
    await deleteCategory(cat.id)
    await restoreFromTrash(a.id)
    const got = (await getItem(a.id))!
    expect(got.tags).toEqual(['new'])
    expect(got.categoryId).toBeNull()
  })

  it('purgeItems: файл и положение удалены, связи соседей убраны без смены updatedAt', async () => {
    const a = await createItem({ type: 'file', file: new Blob(['data'], { type: 'text/plain' }), fileName: 'a.txt' })
    const b = await createItem({ type: 'image', file: new Blob(['img'], { type: 'image/png' }), fileName: 'b.png' })
    const n = await createItem({ type: 'text', content: 'n' })
    const far = await createItem({ type: 'text', content: 'far' })
    await linkItems(a.id, n.id)
    await linkItems(b.id, n.id)
    await linkItems(n.id, far.id)
    // Обратная ссылка без прямой (рассинхрон): её тоже надо убрать.
    await db.items.update(far.id, { links: [n.id, a.id] })
    await setPositions({ [a.id]: { x: 1, y: 2 }, [b.id]: { x: 3, y: 4 }, [n.id]: { x: 5, y: 6 } })
    const [n0, far0] = (await db.items.bulkGet([n.id, far.id])) as Item[]
    await deleteItem(a.id)
    await tick()

    // a — в корзине, b — нет: окончательно удаляются обе; несуществующие id не считаются.
    expect(await purgeItems([a.id, b.id, 'missing', a.id])).toBe(2)
    expect(await getItem(a.id)).toBeUndefined()
    expect(await getItem(b.id)).toBeUndefined()
    expect(await getFile(a.fileId!)).toBeUndefined()
    expect(await getFile(b.fileId!)).toBeUndefined()
    expect(await db.files.count()).toBe(0)
    expect(await getPositions()).toEqual({ [n.id]: { x: 5, y: 6 } })
    expect(await getItem(n.id)).toEqual({ ...n0, links: [far.id] })
    expect(await getItem(far.id)).toEqual({ ...far0, links: [n.id] })

    expect(await purgeItems(n.id)).toBe(1)
    expect((await getItem(far.id))!.links).toEqual([])
    expect(await getPositions()).toEqual({})
    expect(await purgeItems([n.id, 'missing'])).toBe(0)
    expect(await purgeItems('missing')).toBe(0)
    expect(await purgeItems([])).toBe(0)
    expect(await db.items.count()).toBe(1)
  })

  it('purgeItems удаляет файл и при рассинхроне fileId / itemId', async () => {
    const a = await createItem({ type: 'file', file: new Blob(['1']), fileName: 'a.bin' })
    const b = await createItem({ type: 'file', file: new Blob(['2']), fileName: 'b.bin' })
    const keep = await createItem({ type: 'file', file: new Blob(['3']), fileName: 'keep.bin' })
    await db.files.update(a.fileId!, { itemId: 'someone-else' })
    await db.items.update(b.id, { fileId: undefined })
    expect(await purgeItems([a.id, b.id])).toBe(2)
    expect((await db.files.toArray()).map((f) => f.id)).toEqual([keep.fileId])
  })

  it('purgeItems: сбой посреди удаления откатывает всё — ни файл, ни связи не теряются', async () => {
    const a = await createItem({ type: 'file', file: new Blob(['data'], { type: 'text/plain' }), fileName: 'a.txt' })
    const n = await createItem({ type: 'text', content: 'n' })
    await linkItems(a.id, n.id)
    await setPositions({ [a.id]: { x: 1, y: 2 } })
    await deleteItem(a.id)
    const [a0, n0] = (await db.items.bulkGet([a.id, n.id])) as Item[]

    vi.spyOn(db.items, 'bulkDelete').mockRejectedValueOnce(new Error('сбой'))
    await expect(purgeItems(a.id)).rejects.toThrow('сбой')
    vi.restoreAllMocks()

    expect(await getItem(a.id)).toEqual(a0)
    expect(await getItem(n.id)).toEqual(n0)
    expect(await (await getFile(a.fileId!))!.blob.text()).toBe('data')
    expect(await getPositions()).toEqual({ [a.id]: { x: 1, y: 2 } })
  })

  it('emptyTrash удаляет только корзину', async () => {
    const a = await createItem({ type: 'file', file: new Blob(['data']), fileName: 'a.bin' })
    const b = await createItem({ type: 'text', content: 'b' })
    const keep = await createItem({ type: 'file', file: new Blob(['keep']), fileName: 'keep.bin' })
    const archived = await createItem({ type: 'text', content: 'arch', status: 'archive' })
    await linkItems(a.id, keep.id)
    expect(await emptyTrash()).toBe(0)

    await deleteItems([a.id, b.id])
    const keep0 = (await getItem(keep.id))!
    expect(await emptyTrash()).toBe(2)
    expect((await db.items.toCollection().primaryKeys()).sort()).toEqual([keep.id, archived.id].sort())
    expect((await db.files.toArray()).map((f) => f.id)).toEqual([keep.fileId])
    expect(await getItem(keep.id)).toEqual({ ...keep0, links: [] })
    expect(await emptyTrash()).toBe(0)
  })

  it('purgeExpired: граница включительно, выключенная автоочистка, свежие записи остаются', async () => {
    const old = await createItem({ type: 'file', file: new Blob(['old']), fileName: 'old.bin' })
    const fresh = await createItem({ type: 'text', content: 'fresh' })
    const outside = await createItem({ type: 'text', content: 'outside', status: 'archive' })
    await deleteItem(old.id)
    await deleteItem(fresh.id)
    const t = (await getItem(old.id))!.deletedAt!
    await db.items.update(fresh.id, { deletedAt: t + 10 * DAY })

    for (const days of [0, -1, NaN, Infinity, -Infinity]) {
      expect(await purgeExpired(days, t + 1000 * DAY), String(days)).toBe(0)
    }
    // «Сейчас» по умолчанию — текущее время: запись удалена только что.
    expect(await purgeExpired(30)).toBe(0)
    expect(await purgeExpired(30, t + 30 * DAY - 1)).toBe(0)
    expect(await db.items.count()).toBe(3)

    expect(await purgeExpired(30, t + 30 * DAY)).toBe(1)
    expect(await getItem(old.id)).toBeUndefined()
    expect(await db.files.count()).toBe(0)
    expect((await getItem(fresh.id))!.deletedAt).toBe(t + 10 * DAY)

    // Запись вне корзины автоочистка не трогает никогда.
    expect(await purgeExpired(1, t + 1000 * DAY)).toBe(1)
    expect(await db.items.toCollection().primaryKeys()).toEqual([outside.id])
    expect(await purgeExpired(1, t + 5000 * DAY)).toBe(0)
  })

  it('restoreItems после purgeItems воссоздаёт записи с файлом и связями — только с существующими', async () => {
    const a = await createItem({ type: 'file', file: new Blob(['data'], { type: 'text/plain' }), fileName: 'a.txt' })
    const b = await createItem({ type: 'text', content: 'b' })
    const c = await createItem({ type: 'text', content: 'c' })
    const d = await createItem({ type: 'text', content: 'd' })
    const back = await createItem({ type: 'text', content: 'back' })
    await linkItems(a.id, b.id)
    await linkItems(a.id, c.id)
    await linkItems(a.id, d.id)
    // Обратная ссылка без прямой: в снимок она попадает через linkedIds.
    await db.items.update(back.id, { links: [a.id] })
    await setPositions({ [a.id]: { x: 10, y: 20 } })
    const [a0, b0, back0] = (await db.items.bulkGet([a.id, b.id, back.id])) as Item[]
    await tick()

    const snaps = await deleteItems([a.id, d.id])
    expect(snaps[0].linkedIds.sort()).toEqual([b.id, c.id, d.id, back.id].sort())
    expect(await purgeItems([a.id, d.id])).toBe(2)
    // Пока записи не было, одну из связанных удалили окончательно, другая лежит в корзине.
    await purgeItems(c.id)
    await deleteItem(b.id)
    await tick()

    // Отмена для пары: связь a—d возвращается, хотя на момент восстановления a записи d ещё нет.
    await restoreItems(snaps)
    const a1 = (await getItem(a.id))!
    expect('deletedAt' in a1).toBe(false)
    expect(a1).toEqual({ ...a0, links: a1.links })
    expect([...a1.links].sort()).toEqual([b.id, d.id, back.id].sort())
    expect((await getItem(d.id))!.links).toEqual([a.id])
    expect(await getItem(c.id)).toBeUndefined()
    // Соседи: связь на месте, updatedAt не менялся; запись в корзине остаётся в корзине.
    const b1 = (await getItem(b.id))!
    expect(b1).toEqual({ ...b0, deletedAt: b1.deletedAt })
    expect(b1.deletedAt).toBeDefined()
    expect(await getItem(back.id)).toEqual(back0)

    const file = (await getFile(a.fileId!))!
    expect(file.itemId).toBe(a.id)
    expect(await file.blob.text()).toBe('data')
    // Положение на графе не возвращается: место подберёт раскладка.
    expect(await getPositions()).toEqual({})

    // Повторная отмена ничего не меняет и не плодит связей.
    const all = await db.items.toArray()
    await restoreItems(snaps)
    await restoreItem(snaps[0])
    expect(await db.items.toArray()).toEqual(all)
    expect(await db.files.count()).toBe(1)
  })

  it('restoreItems: сбой посреди воссоздания откатывает всё', async () => {
    const a = await createItem({ type: 'file', file: new Blob(['data']), fileName: 'a.bin' })
    const b = await createItem({ type: 'text', content: 'b' })
    const snaps = await deleteItems([a.id, b.id])
    await purgeItems([a.id, b.id])

    vi.spyOn(db.files, 'put').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'))
    await expect(restoreItems(snaps)).rejects.toThrow(QUOTA_MESSAGE)
    vi.restoreAllMocks()
    expect(await db.items.count()).toBe(0)
    expect(await db.files.count()).toBe(0)

    await restoreItems(snaps)
    expect(await db.items.count()).toBe(2)
    expect(await db.files.count()).toBe(1)
  })

  it('linkItems с записью в корзине ничего не делает, unlinkItems работает', async () => {
    const a = await createItem({ type: 'text', content: 'a' })
    const b = await createItem({ type: 'text', content: 'b' })
    const c = await createItem({ type: 'text', content: 'c' })
    await linkItems(a.id, c.id)
    await deleteItem(b.id)
    await deleteItem(c.id)
    const [a0, b0, c0] = (await db.items.bulkGet([a.id, b.id, c.id])) as Item[]
    await tick()

    await linkItems(a.id, b.id)
    await linkItems(b.id, a.id)
    await linkItems(b.id, c.id)
    expect(await db.items.bulkGet([a.id, b.id, c.id])).toEqual([a0, b0, c0])

    // Снять связь с записью из корзины можно.
    await unlinkItems(a.id, c.id)
    expect((await getItem(a.id))!.links).toEqual([])
    expect((await getItem(c.id))!.links).toEqual([])
    expect((await getItem(c.id))!.deletedAt).toBe(c0.deletedAt)
  })
})

describe('положения нод графа', () => {
  it('setPositions: округляет, пропускает неизвестные id и негодные точки, не меняет запись', async () => {
    const a = await createItem({ type: 'text', content: 'a' })
    const b = await createItem({ type: 'text', content: 'b' })
    const c = await createItem({ type: 'text', content: 'c' })
    const trashed = await createItem({ type: 'text', content: 't' })
    await deleteItem(trashed.id)
    const before = await db.items.toArray()
    await tick()

    await setPositions({
      [a.id]: { x: 10.4, y: -20.6 },
      [b.id]: { x: NaN, y: 0 },
      [c.id]: { x: 5_000_000, y: 0 },
      [trashed.id]: { x: 7, y: 8 },
      missing: { x: 1, y: 1 },
      '': { x: 2, y: 2 },
    } as Record<string, GraphPoint>)
    await setPositions({ [c.id]: 'x', [b.id]: null } as unknown as Record<string, GraphPoint>)
    await setPositions({})

    expect(await getPositions()).toEqual({ [a.id]: { x: 10, y: -21 }, [trashed.id]: { x: 7, y: 8 } })
    expect(await db.items.toArray()).toEqual(before)

    // Повторная запись заменяет прежнее положение.
    await setPositions({ [a.id]: { x: 0, y: 0 } })
    expect((await getPositions())[a.id]).toEqual({ x: 0, y: 0 })
    expect(await db.positions.count()).toBe(2)
  })

  it('getPositions: id «__proto__» — обычный ключ', async () => {
    await db.items.add(makeItem({ id: '__proto__' }))
    await setPositions(Object.fromEntries([['__proto__', { x: 1, y: 2 }]]))
    const got = await getPositions()
    expect(Object.getPrototypeOf(got)).toBe(Object.prototype)
    expect(Object.entries(got)).toEqual([['__proto__', { x: 1, y: 2 }]])
  })

  it('removePositions и clearPositions (возвращает прежние — для отмены)', async () => {
    const a = await createItem({ type: 'text', content: 'a' })
    const b = await createItem({ type: 'text', content: 'b' })
    const c = await createItem({ type: 'text', content: 'c' })
    const all = { [a.id]: { x: 1, y: 2 }, [b.id]: { x: 3, y: 4 }, [c.id]: { x: 5, y: 6 } }
    await setPositions(all)

    await removePositions(a.id)
    await removePositions([b.id, 'missing'])
    expect(await getPositions()).toEqual({ [c.id]: { x: 5, y: 6 } })

    await setPositions(all)
    const previous = await clearPositions()
    expect(previous).toEqual(all)
    expect(await getPositions()).toEqual({})
    expect(await clearPositions()).toEqual({})

    await setPositions(previous)
    expect(await getPositions()).toEqual(all)
  })

  it('смена категории удаляет положение, та же категория — нет', async () => {
    const cat = await createCategory('Работа')
    const other = await createCategory('Дом')
    const a = await createItem({ type: 'text', content: 'a' })
    const b = await createItem({ type: 'text', content: 'b', categoryId: cat.id })
    const c = await createItem({ type: 'text', content: 'c', categoryId: other.id })
    const place = () =>
      setPositions({ [a.id]: { x: 1, y: 1 }, [b.id]: { x: 2, y: 2 }, [c.id]: { x: 3, y: 3 } })
    const placed = async () => Object.keys(await getPositions()).sort()
    const ids = (...items: Item[]) => items.map((it) => it.id).sort()

    // setCategory: переезжает только a, у b категория та же.
    await place()
    await setCategory([a.id, b.id], cat.id)
    expect(await placed()).toEqual(ids(b, c))
    await place()
    await setCategory(a.id, cat.id)
    expect(await placed()).toEqual(ids(a, b, c))

    // updateItem: другая категория, та же категория, патч без категории, явный undefined.
    await updateItem(a.id, { categoryId: null })
    expect(await placed()).toEqual(ids(b, c))
    await updateItem(b.id, { categoryId: cat.id, title: 'T' })
    await updateItem(b.id, { content: 'x' })
    await updateItem(b.id, { categoryId: undefined })
    expect(await placed()).toEqual(ids(b, c))
    expect((await getItem(b.id))!.categoryId).toBe(cat.id)
    await updateItem(c.id, { categoryId: cat.id })
    expect(await placed()).toEqual(ids(b))
    // Несуществующая запись: ни ошибки, ни чужих положений.
    await updateItem('missing', { categoryId: cat.id })
    expect(await placed()).toEqual(ids(b))

    // deleteCategory: положения теряют записи удаляемой категории (в т.ч. в корзине), остальные — нет.
    await setCategory(a.id, other.id)
    await place()
    await deleteItem(c.id)
    await deleteCategory(cat.id)
    expect(await placed()).toEqual(ids(a))
    expect((await getItem(c.id))!.categoryId).toBeNull()
  })

  it('архив и корзина положение сохраняют, окончательное удаление — нет', async () => {
    const a = await createItem({ type: 'text', content: 'a' })
    const b = await createItem({ type: 'text', content: 'b' })
    const all = { [a.id]: { x: 1, y: 2 }, [b.id]: { x: 3, y: 4 } }
    await setPositions(all)

    await setStatus(a.id, 'archive')
    await unarchive(a.id)
    const snap = await deleteItem(b.id)
    expect(await getPositions()).toEqual(all)
    await restoreItem(snap)
    await deleteItem(b.id)
    await restoreFromTrash(b.id)
    expect(await getPositions()).toEqual(all)

    await purgeItems(b.id)
    expect(await getPositions()).toEqual({ [a.id]: { x: 1, y: 2 } })
  })
})

describe('сохранённые поиски', () => {
  it('createSavedSearch: trim, порядок по возрастанию, список по order', async () => {
    const before = Date.now()
    const s1 = await createSavedSearch('  Работа  ', '  tag:work is:inbox ')
    const s2 = await createSavedSearch('Почитать', 'type:link')
    const s3 = await createSavedSearch('Неделя', 'date:week')
    expect(s1.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(s1.name).toBe('Работа')
    expect(s1.query).toBe('tag:work is:inbox')
    expect(s1.createdAt).toBeGreaterThanOrEqual(before)
    expect([s1.order, s2.order, s3.order]).toEqual([0, 1, 2])
    expect(await listSavedSearches()).toEqual([s1, s2, s3])

    // order = max + 1, а не число поисков.
    await deleteSavedSearch(s2.id)
    await deleteSavedSearch('missing')
    expect((await createSavedSearch('Ещё', 'x')).order).toBe(3)
  })

  it('ошибки: пустые и слишком длинные имя и запрос, имя-дубль', async () => {
    const s = await createSavedSearch('Ёлка  игрушки', 'q')
    await expect(createSavedSearch('   ', 'q')).rejects.toThrow('Название не может быть пустым')
    await expect(createSavedSearch('Имя', '  ')).rejects.toThrow('Запрос пуст — сохранять нечего')
    await expect(createSavedSearch('я'.repeat(SAVED_SEARCH_NAME_MAX + 1), 'q')).rejects.toThrow(
      'Слишком длинное название',
    )
    await expect(createSavedSearch('Имя', 'q'.repeat(SAVED_SEARCH_QUERY_MAX + 1))).rejects.toThrow(
      'Слишком длинный запрос',
    )
    // Регистр, ё/е и лишние пробелы имени не различаются.
    await expect(createSavedSearch(' елка ИГРУШКИ ', 'другой')).rejects.toThrow('Поиск «Ёлка  игрушки» уже есть')
    expect(await listSavedSearches()).toEqual([s])

    // Ровно предельная длина (после trim) допустима.
    const edge = await createSavedSearch(` ${'я'.repeat(SAVED_SEARCH_NAME_MAX)} `, ` ${'q'.repeat(SAVED_SEARCH_QUERY_MAX)} `)
    expect(edge.name).toHaveLength(SAVED_SEARCH_NAME_MAX)
    expect(edge.query).toHaveLength(SAVED_SEARCH_QUERY_MAX)
  })

  it('updateSavedSearch: undefined — не менять, несуществующий id — ничего, те же проверки', async () => {
    const a = await createSavedSearch('Работа', 'tag:work')
    const b = await createSavedSearch('Дом', 'tag:home')

    await updateSavedSearch(a.id, { name: undefined, query: '  tag:job ' })
    await updateSavedSearch(a.id, { name: ' Дела ', query: undefined })
    await updateSavedSearch(a.id, {})
    expect(await listSavedSearches()).toEqual([{ ...a, name: 'Дела', query: 'tag:job' }, b])

    // Своё имя (в другом регистре) — не дубль.
    await updateSavedSearch(a.id, { name: 'ДЕЛА' })
    expect((await listSavedSearches())[0].name).toBe('ДЕЛА')

    await expect(updateSavedSearch(b.id, { name: 'дела' })).rejects.toThrow('Поиск «ДЕЛА» уже есть')
    await expect(updateSavedSearch(b.id, { name: '  ' })).rejects.toThrow('Название не может быть пустым')
    await expect(updateSavedSearch(b.id, { query: '' })).rejects.toThrow('Запрос пуст — сохранять нечего')
    await expect(updateSavedSearch(b.id, { name: 'я'.repeat(SAVED_SEARCH_NAME_MAX + 1) })).rejects.toThrow(
      'Слишком длинное название',
    )
    await expect(updateSavedSearch(b.id, { query: 'q'.repeat(SAVED_SEARCH_QUERY_MAX + 1) })).rejects.toThrow(
      'Слишком длинный запрос',
    )
    // Неудачная правка не применилась и наполовину.
    await expect(updateSavedSearch(b.id, { name: 'Новое', query: ' ' })).rejects.toThrow()
    expect((await listSavedSearches())[1]).toEqual(b)

    await updateSavedSearch('missing', { name: 'Призрак', query: 'x' })
    expect(await db.searches.count()).toBe(2)
  })

  it('reorderSavedSearches: частичный список, неизвестные id и повторы', async () => {
    const a = await createSavedSearch('A', 'a')
    const b = await createSavedSearch('B', 'b')
    const c = await createSavedSearch('C', 'c')
    const d = await createSavedSearch('D', 'd')
    const order = async () => (await listSavedSearches()).map((s) => s.name).join('')

    await reorderSavedSearches([d.id, b.id])
    expect(await order()).toBe('DBAC')
    expect((await listSavedSearches()).map((s) => s.order)).toEqual([0, 1, 2, 3])

    await reorderSavedSearches(['missing', c.id, c.id, a.id, 'other'])
    expect(await order()).toBe('CADB')

    await reorderSavedSearches([])
    expect(await order()).toBe('CADB')
    await reorderSavedSearches([b.id, d.id, a.id, c.id])
    expect(await order()).toBe('BDAC')
    expect(await db.searches.count()).toBe(4)
  })

  it('restoreSavedSearch: как есть, при занятом имени — с суффиксом', async () => {
    const a = await createSavedSearch('Работа', 'tag:work')
    const b = await createSavedSearch('Дом', 'tag:home')
    await deleteSavedSearch(a.id)
    await restoreSavedSearch(a)
    expect(await listSavedSearches()).toEqual([a, b])
    // Отмена для поиска, который никуда не делся, имя не меняет.
    await restoreSavedSearch(a)
    expect(await listSavedSearches()).toEqual([a, b])

    await deleteSavedSearch(a.id)
    const taken = await createSavedSearch('работа', 'другой запрос')
    await restoreSavedSearch(a)
    expect(await db.searches.get(a.id)).toEqual({ ...a, name: 'Работа (2)' })

    await deleteSavedSearch(b.id)
    await updateSavedSearch(taken.id, { name: 'Дом' })
    await createSavedSearch('Дом (2)', 'ещё один')
    await restoreSavedSearch(b)
    expect(await db.searches.get(b.id)).toEqual({ ...b, name: 'Дом (3)' })
    expect(await db.searches.count()).toBe(4)
  })
})

describe('распознанный текст и дубли ссылок', () => {
  it('setOcrText: ставит ocrAt, не меняет updatedAt, пустой текст удаляет ocrText', async () => {
    const item = await createItem({ type: 'file', file: new Blob(['%PDF']), fileName: 'a.pdf' })
    await tick()

    expect(await setOcrText(item.id, '  Первая\r\nстрока\u0000  ', 5000)).toBe(true)
    expect(await getItem(item.id)).toEqual({ ...item, ocrText: 'Первая\nстрока', ocrAt: 5000 })

    // Отметка по умолчанию — текущее время.
    const before = Date.now()
    expect(await setOcrText(item.id, 'другой текст')).toBe(true)
    const got = (await getItem(item.id))!
    expect(got.ocrText).toBe('другой текст')
    expect(got.ocrAt).toBeGreaterThanOrEqual(before)
    expect(got.updatedAt).toBe(item.updatedAt)

    // «Пробовали, текста нет»: поле удаляется, отметка остаётся.
    expect(await setOcrText(item.id, ' \r\n\t ', 7000)).toBe(true)
    const empty = (await getItem(item.id))!
    expect('ocrText' in empty).toBe(false)
    expect(empty).toEqual({ ...item, ocrAt: 7000 })
  })

  it('setOcrText: обрезка до MAX_OCR_TEXT, запись в корзине, несуществующая запись', async () => {
    const item = await createItem({ type: 'text', content: 'x' })
    await setOcrText(item.id, 'я'.repeat(MAX_OCR_TEXT + 500), 1)
    expect((await getItem(item.id))!.ocrText).toHaveLength(MAX_OCR_TEXT)

    await deleteItem(item.id)
    const trashed = (await getItem(item.id))!
    expect(await setOcrText(item.id, 'в корзине', 2)).toBe(true)
    expect(await getItem(item.id)).toEqual({ ...trashed, ocrText: 'в корзине', ocrAt: 2 })

    expect(await setOcrText('missing', 'текст')).toBe(false)
    expect(await getItem('missing')).toBeUndefined()
    expect(await db.items.count()).toBe(1)
  })

  it('findDuplicateLink: по нормализованному адресу, без корзины и excludeId', async () => {
    const link = await createItem({ type: 'link', url: 'https://www.example.com/a/?utm_source=x' })
    await createItem({ type: 'link', url: 'https://example.com/b' })
    // Адрес в тексте заметки дублем не считается.
    await createItem({ type: 'text', content: 'https://example.com/a' })

    expect((await findDuplicateLink('http://example.com/a'))?.id).toBe(link.id)
    expect((await findDuplicateLink('  EXAMPLE.com/a#top '))?.id).toBe(link.id)
    expect(await findDuplicateLink('example.com/a', link.id)).toBeUndefined()
    expect(await findDuplicateLink('example.com/c')).toBeUndefined()
    expect(await findDuplicateLink('mailto:a@b.c')).toBeUndefined()
    expect(await findDuplicateLink('')).toBeUndefined()

    // Архив учитывается, но уступает не архивной записи.
    await setStatus(link.id, 'archive')
    expect((await findDuplicateLink('example.com/a'))?.id).toBe(link.id)
    const fresh = await createItem({ type: 'link', url: 'example.com/a' })
    expect((await findDuplicateLink('example.com/a'))?.id).toBe(fresh.id)
    expect((await findDuplicateLink('example.com/a', fresh.id))?.id).toBe(link.id)

    await deleteItems([link.id, fresh.id])
    expect(await findDuplicateLink('example.com/a')).toBeUndefined()
    await restoreFromTrash(fresh.id)
    expect((await findDuplicateLink('example.com/a'))?.id).toBe(fresh.id)
  })
})

describe('статусы', () => {
  it('library из inbox ставит processedAt', async () => {
    const item = await createItem({ type: 'idea', content: 'i' })
    expect(item.processedAt).toBeUndefined()
    await tick()
    await setStatus(item.id, 'library')
    const got = (await getItem(item.id))!
    expect(got.status).toBe('library')
    expect(got.processedAt).toBeGreaterThan(item.createdAt)
    expect(got.updatedAt).toBe(got.processedAt)
  })

  it('archive запоминает prevStatus, unarchive возвращает туда же', async () => {
    const inbox = await createItem({ type: 'text', content: '1' })
    const lib = await createItem({ type: 'text', content: '2', status: 'library' })
    await setStatus([inbox.id, lib.id], 'archive')

    let gi = (await getItem(inbox.id))!
    let gl = (await getItem(lib.id))!
    expect(gi.status).toBe('archive')
    expect(gi.prevStatus).toBe('inbox')
    expect(gl.prevStatus).toBe('library')

    // Повторная архивация не затирает prevStatus.
    await setStatus(inbox.id, 'archive')
    expect((await getItem(inbox.id))!.prevStatus).toBe('inbox')

    await unarchive([inbox.id, lib.id])
    gi = (await getItem(inbox.id))!
    gl = (await getItem(lib.id))!
    expect(gi.status).toBe('inbox')
    expect(gl.status).toBe('library')
    expect('prevStatus' in gi).toBe(false)
    expect(gi.processedAt).toBeUndefined()
  })

  it('unarchive без prevStatus — в library', async () => {
    const item = await createItem({ type: 'text', content: 'x', status: 'archive' })
    await unarchive(item.id)
    const got = (await getItem(item.id))!
    expect(got.status).toBe('library')
    expect(got.processedAt).toBeDefined()
  })

  it('unarchive не трогает неархивные записи', async () => {
    const item = await createItem({ type: 'text', content: 'x' })
    await unarchive(item.id)
    expect(await getItem(item.id)).toEqual(item)
  })

  it('toggleFavorite и setCategory', async () => {
    const item = await createItem({ type: 'text', content: 'x' })
    await toggleFavorite(item.id)
    expect((await getItem(item.id))!.favorite).toBe(1)
    await toggleFavorite(item.id)
    expect((await getItem(item.id))!.favorite).toBe(0)

    const cat = await createCategory('Учёба')
    await setCategory([item.id], cat.id)
    expect((await getItem(item.id))!.categoryId).toBe(cat.id)
    await setCategory(item.id, null)
    expect((await getItem(item.id))!.categoryId).toBeNull()
  })
})

describe('теги', () => {
  it('addTags / removeTag без дублей', async () => {
    const a = await createItem({ type: 'text', content: 'a', tags: ['one'] })
    const b = await createItem({ type: 'text', content: 'b' })
    await addTags([a.id, b.id], ['#One', 'Two'])
    expect((await getItem(a.id))!.tags).toEqual(['one', 'two'])
    expect((await getItem(b.id))!.tags).toEqual(['one', 'two'])
    await removeTag([a.id, b.id], '#ONE')
    expect((await getItem(a.id))!.tags).toEqual(['two'])
  })

  it('renameTag сливает с существующим тегом', async () => {
    const a = await createItem({ type: 'text', content: 'a', tags: ['js', 'web'] })
    const b = await createItem({ type: 'text', content: 'b', tags: ['js', 'javascript', 'x'] })
    const c = await createItem({ type: 'text', content: 'c', tags: ['other'] })
    await tick()
    await renameTag('JS', 'JavaScript')
    expect((await getItem(a.id))!.tags).toEqual(['javascript', 'web'])
    expect((await getItem(b.id))!.tags).toEqual(['javascript', 'x'])
    const gc = (await getItem(c.id))!
    expect(gc.tags).toEqual(['other'])
    expect(gc.updatedAt).toBe(c.updatedAt)
    expect((await getItem(a.id))!.updatedAt).toBeGreaterThan(a.updatedAt)
  })

  it('renameTag переписывает tag:/# в сохранённых поисках, остальной текст не трогает', async () => {
    await createItem({ type: 'text', content: 'a', tags: ['работа'] })
    const s1 = await createSavedSearch('один', 'tag:работа')
    const s2 = await createSavedSearch('два', '#работа is:fav "фраза"')
    const s3 = await createSavedSearch('три', 'tag:работать')
    await renameTag('работа', 'work')
    const q = async (id: string) => (await listSavedSearches()).find((x) => x.id === id)!.query
    expect(await q(s1.id)).toBe('tag:work')
    expect(await q(s2.id)).toBe('#work is:fav "фраза"')
    expect(await q(s3.id)).toBe('tag:работать')
  })

  it('updateCategory(name) переписывает cat:Имя и cat:"мои проекты" с регистром и ё/е', async () => {
    const c = await createCategory('Мои проекты')
    const e = await createCategory('Ёлки')
    const s1 = await createSavedSearch('один', 'cat:"мои проекты" is:inbox')
    const s2 = await createSavedSearch('два', 'cat:елки')
    const s3 = await createSavedSearch('три', 'cat:Другая')
    await updateCategory(c.id, { name: 'Дела' })
    await updateCategory(e.id, { name: 'Ёж и ёлка' })
    const q = async (id: string) => (await listSavedSearches()).find((x) => x.id === id)!.query
    expect(await q(s1.id)).toBe('cat:Дела is:inbox')
    expect(await q(s2.id)).toBe('cat:"Ёж и ёлка"')
    expect(await q(s3.id)).toBe('cat:Другая')
  })

  it('deleteTag убирает тег у всех записей', async () => {
    const a = await createItem({ type: 'text', content: 'a', tags: ['tmp', 'keep'] })
    const b = await createItem({ type: 'text', content: 'b', tags: ['tmp'] })
    await deleteTag('#tmp')
    expect((await getItem(a.id))!.tags).toEqual(['keep'])
    expect((await getItem(b.id))!.tags).toEqual([])
  })
})

describe('связи', () => {
  it('двунаправленно, без самоссылок и дублей', async () => {
    const a = await createItem({ type: 'text', content: 'a' })
    const b = await createItem({ type: 'text', content: 'b' })
    await linkItems(a.id, b.id)
    await linkItems(b.id, a.id)
    await linkItems(a.id, a.id)
    await linkItems(a.id, 'missing')
    expect((await getItem(a.id))!.links).toEqual([b.id])
    expect((await getItem(b.id))!.links).toEqual([a.id])

    await unlinkItems(b.id, a.id)
    expect((await getItem(a.id))!.links).toEqual([])
    expect((await getItem(b.id))!.links).toEqual([])
  })
})

describe('категории', () => {
  it('createCategory: order = max+1, цвет по кругу, без дублей имени', async () => {
    const c1 = await createCategory('  Работа ')
    const c2 = await createCategory('Дом')
    const c3 = await createCategory('Чтение', 'pink')
    expect(c1.name).toBe('Работа')
    expect([c1.order, c2.order, c3.order]).toEqual([0, 1, 2])
    expect(c1.color).toBe(CATEGORY_COLORS[0])
    expect(c2.color).toBe(CATEGORY_COLORS[1])
    expect(c3.color).toBe('pink')
    expect((await createCategory('работа')).id).toBe(c1.id)

    await updateCategory(c1.id, { order: 10 })
    const c4 = await createCategory('Новая')
    expect(c4.order).toBe(11)
    expect((await listCategories()).map((c) => c.name)).toEqual(['Дом', 'Чтение', 'Работа', 'Новая'])
    await expect(createCategory('   ')).rejects.toThrow()
  })

  it('deleteCategory обнуляет categoryId у записей', async () => {
    const cat = await createCategory('Временная')
    const keep = await createCategory('Постоянная')
    const a = await createItem({ type: 'text', content: 'a', categoryId: cat.id })
    const b = await createItem({ type: 'text', content: 'b', categoryId: keep.id })
    await deleteCategory(cat.id)
    expect((await getItem(a.id))!.categoryId).toBeNull()
    expect((await getItem(b.id))!.categoryId).toBe(keep.id)
    expect((await listCategories()).map((c) => c.id)).toEqual([keep.id])
  })
})

describe('matchesFilter', () => {
  const item = makeItem({
    type: 'link',
    status: 'library',
    tags: ['a', 'b'],
    categoryId: 'cat1',
    favorite: 1,
    createdAt: 5000,
  })

  it('пустой фильтр пропускает всё', () => {
    expect(matchesFilter(item, {})).toBe(true)
  })

  it('status: значение и массив', () => {
    expect(matchesFilter(item, { status: 'library' })).toBe(true)
    expect(matchesFilter(item, { status: 'inbox' })).toBe(false)
    expect(matchesFilter(item, { status: ['inbox', 'library'] })).toBe(true)
    expect(matchesFilter(item, { status: ['inbox', 'archive'] })).toBe(false)
    expect(matchesFilter(item, { status: [] })).toBe(true)
  })

  it('types', () => {
    expect(matchesFilter(item, { types: ['link', 'text'] })).toBe(true)
    expect(matchesFilter(item, { types: ['code'] })).toBe(false)
  })

  it('categoryId: null — без категории, undefined — не фильтровать', () => {
    expect(matchesFilter(item, { categoryId: 'cat1' })).toBe(true)
    expect(matchesFilter(item, { categoryId: 'cat2' })).toBe(false)
    expect(matchesFilter(item, { categoryId: null })).toBe(false)
    expect(matchesFilter(item, { categoryId: undefined })).toBe(true)
    expect(matchesFilter(makeItem(), { categoryId: null })).toBe(true)
  })

  it('tags — все должны присутствовать', () => {
    expect(matchesFilter(item, { tags: ['a'] })).toBe(true)
    expect(matchesFilter(item, { tags: ['#A', 'b'] })).toBe(true)
    expect(matchesFilter(item, { tags: ['a', 'c'] })).toBe(false)
  })

  it('favorite и untagged', () => {
    expect(matchesFilter(item, { favorite: true })).toBe(true)
    expect(matchesFilter(makeItem(), { favorite: true })).toBe(false)
    expect(matchesFilter(makeItem(), { favorite: false })).toBe(true)
    expect(matchesFilter(item, { untagged: true })).toBe(false)
    expect(matchesFilter(makeItem(), { untagged: true })).toBe(true)
    expect(matchesFilter(makeItem({ categoryId: 'x' }), { untagged: true })).toBe(false)
  })

  it('from / to включительно', () => {
    expect(matchesFilter(item, { from: 5000, to: 5000 })).toBe(true)
    expect(matchesFilter(item, { from: 5001 })).toBe(false)
    expect(matchesFilter(item, { to: 4999 })).toBe(false)
  })
})

describe('sortItems', () => {
  const a = makeItem({ title: 'банан', createdAt: 1, updatedAt: 30 })
  const b = makeItem({ title: '', fileName: 'Арбуз.png', createdAt: 2, updatedAt: 10 })
  const c = makeItem({ title: '', linkMeta: { title: 'вишня', status: 'ok' }, createdAt: 3, updatedAt: 20 })
  const d = makeItem({ title: '', content: 'Ёжик', createdAt: 4, updatedAt: 5 })
  const e = makeItem({ title: '', content: '', createdAt: 5, updatedAt: 1 })
  const list = [a, b, c, d, e]
  const ids = (xs: Item[]) => xs.map((x) => x.id)

  it('newest / oldest / updated', () => {
    expect(ids(sortItems(list, 'newest'))).toEqual(ids([e, d, c, b, a]))
    expect(ids(sortItems(list, 'oldest'))).toEqual(ids([a, b, c, d, e]))
    expect(ids(sortItems(list, 'updated'))).toEqual(ids([a, c, b, d, e]))
  })

  it('title — по отображаемому заголовку, пустые в конце', () => {
    expect(ids(sortItems(list, 'title'))).toEqual(ids([b, a, c, d, e]))
  })

  it('title — ссылка без заголовка сортируется по url, как её видно в списке', () => {
    const link = makeItem({ type: 'link', url: 'https://developer.mozilla.org/x', createdAt: 6 })
    const zz = makeItem({ title: 'zzz', createdAt: 7 })
    const mango = makeItem({ title: 'mango', createdAt: 8 })
    expect(ids(sortItems([e, zz, link, mango], 'title'))).toEqual(ids([link, mango, zz, e]))
  })

  it('title — текст из одной разметки заголовка не даёт и идёт в конец, как пустой', () => {
    const rule = makeItem({ title: '', content: '---', createdAt: 9 })
    const fence = makeItem({ title: '', content: '```\n```', createdAt: 10 })
    const yo = makeItem({ title: '', content: '# Яблоко', createdAt: 11 })
    // «Без названия» встало бы между «банан» и «вишня»; теперь — после всех, по createdAt (новые раньше).
    expect(ids(sortItems([rule, a, fence, c, yo, e], 'title'))).toEqual(ids([a, c, yo, fence, rule, e]))
  })

  it('не мутирует исходный массив', () => {
    const copy = [...list]
    sortItems(list, 'newest')
    expect(list).toEqual(copy)
  })
})

describe('исправления ревью ядра', () => {
  it('deleteItems: снимки связанной пары исходные, отмена возвращает всё как было', async () => {
    const a = await createItem({ type: 'text', content: 'a' })
    const b = await createItem({ type: 'text', content: 'b' })
    const n = await createItem({ type: 'text', content: 'neighbour' })
    await linkItems(a.id, b.id)
    await linkItems(b.id, n.id)
    const [a0, b0, n0] = (await db.items.bulkGet([a.id, b.id, n.id])) as Item[]
    await tick()

    const snaps = await deleteItems([a.id, b.id])
    expect(snaps.map((s) => s.item)).toEqual([a0, b0])
    expect(snaps.map((s) => [...s.linkedIds].sort())).toEqual([[b.id], [a.id, n.id].sort()])
    // Сосед не тронут вовсе: связь с записью из корзины остаётся, updatedAt прежний.
    const nAfter = (await getItem(n.id))!
    expect(nAfter.links).toEqual([b.id])
    expect(nAfter.updatedAt).toBe(n0.updatedAt)

    await tick()
    await restoreItems(snaps)
    expect(await getItem(a.id)).toEqual(a0)
    expect(await getItem(b.id)).toEqual(b0)
    expect(await getItem(n.id)).toEqual(n0)
  })

  it('updateItem: явные undefined не удаляют обязательные поля, необязательные сбрасываются', async () => {
    const item = await createItem({ type: 'link', url: 'https://example.com', content: 'c', tags: ['t'] })
    await updateItem(item.id, { title: 'T', tags: undefined, content: undefined, categoryId: undefined, url: undefined })
    const got = (await getItem(item.id))!
    expect(got.title).toBe('T')
    expect(got.tags).toEqual(['t'])
    expect(got.content).toBe('c')
    expect(got.categoryId).toBeNull()
    expect('url' in got).toBe(false)
  })

  it('url: только http/https/ftp, адрес без схемы получает https', async () => {
    await expect(createItem({ type: 'link', url: 'javascript:alert(1)' })).rejects.toThrow(/адрес/)
    await expect(createItem({ type: 'link', url: 'file:///C:/Windows/System32/calc.exe' })).rejects.toThrow()
    // схема без «//» не превращается в https://mailto:… с логином
    await expect(createItem({ type: 'link', url: 'mailto:a@b.c' })).rejects.toThrow(/адрес/)
    expect((await createItem({ type: 'link', url: 'localhost:3000' })).url).toBe('http://localhost:3000')
    const ok = await createItem({ type: 'link', url: 'example.com/a' })
    expect(ok.url).toBe('https://example.com/a')
    await expect(updateItem(ok.id, { url: 'file:///etc/passwd' })).rejects.toThrow()
    expect((await getItem(ok.id))!.url).toBe('https://example.com/a')

    await updateItem(ok.id, {
      linkMeta: { status: 'ok', title: 'x', image: 'javascript:alert(1)', favicon: 'https://example.com/f.ico' },
    })
    const meta = (await getItem(ok.id))!.linkMeta!
    expect(meta.image).toBeUndefined()
    expect(meta.favicon).toBe('https://example.com/f.ico')
  })

  it('createItem отклоняет файл больше MAX_FILE_SIZE', async () => {
    const huge = { size: MAX_FILE_SIZE + 1, type: 'video/mp4', slice: () => new Blob() } as unknown as Blob
    await expect(createItem({ type: 'file', file: huge, fileName: 'big.mp4' })).rejects.toThrow(/МБ/)
    expect(await db.items.count()).toBe(0)
  })

  it('updateCategory: имя-дубль другой категории (регистр, ё/е, дефисы) отклоняется', async () => {
    const work = await createCategory('Работа')
    const proj = await createCategory('Проекты')
    await expect(updateCategory(proj.id, { name: 'работа' })).rejects.toThrow(/уже есть/)
    await expect(updateCategory(proj.id, { name: '  РАБОТА ' })).rejects.toThrow()
    // Своё имя менять можно, в т.ч. только регистр.
    await updateCategory(work.id, { name: 'работа' })
    expect((await listCategories()).map((c) => c.name)).toEqual(['работа', 'Проекты'])
    // undefined не стирает поля категории.
    await updateCategory(proj.id, { name: undefined, color: 'red' })
    const p = (await listCategories()).find((c) => c.id === proj.id)!
    expect(p.name).toBe('Проекты')
    expect(p.color).toBe('red')
    // createCategory тоже узнаёт дубль с ё/е и дефисами.
    const y1 = await createCategory('Ёлка-игрушки')
    expect((await createCategory('елка игрушки')).id).toBe(y1.id)
  })
})

describe('settings', () => {
  it('getSettings отдаёт значения по умолчанию', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('setSetting/setSettings сохраняют, чужие ключи и неверные типы игнорируются', async () => {
    await setSetting('theme', 'dark')
    await setSettings({ seeded: true, aiModel: 'gpt-4o-mini' })
    await db.meta.bulkPut([
      { key: 'unknown', value: 1 },
      { key: 'autoFetchLinkTitle', value: 'yes' },
    ])
    const s = await getSettings()
    expect(s.theme).toBe('dark')
    expect(s.seeded).toBe(true)
    expect(s.aiModel).toBe('gpt-4o-mini')
    expect(s.autoFetchLinkTitle).toBe(DEFAULT_SETTINGS.autoFetchLinkTitle)
    expect('unknown' in s).toBe(false)
  })
})
