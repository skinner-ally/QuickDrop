import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from './db'
import {
  addTags,
  applyLinkMeta,
  createCategory,
  createItem,
  deleteCategory,
  deleteItem,
  deleteItems,
  deleteTag,
  getFile,
  getItem,
  linkItems,
  listCategories,
  makeThumb,
  matchesFilter,
  MAX_FILE_SIZE,
  normalizeTag,
  normalizeTags,
  removeTag,
  renameTag,
  restoreItem,
  restoreItems,
  setCategory,
  setStatus,
  sortItems,
  toggleFavorite,
  unarchive,
  unlinkItems,
  updateCategory,
  updateItem,
} from './repo'
import { getSettings, setSetting, setSettings } from './settings'
import { QUOTA_MESSAGE } from '@/lib/errors'
import { CATEGORY_COLORS, DEFAULT_SETTINGS, type Item, type LinkMeta } from '@/types'

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.files.clear(), db.categories.clear(), db.meta.clear()])
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

  it('каскадно удаляет файл и обратные связи, restore всё возвращает', async () => {
    const a = await createItem({ type: 'file', file: new Blob(['data'], { type: 'text/plain' }), fileName: 'a.txt' })
    const b = await createItem({ type: 'text', content: 'b' })
    const c = await createItem({ type: 'text', content: 'c' })
    await linkItems(a.id, b.id)
    await linkItems(a.id, c.id)
    const aFull = (await getItem(a.id))!

    const snap = await deleteItem(a.id)
    expect(snap.item).toEqual(aFull)
    expect(snap.file?.id).toBe(a.fileId)
    expect(snap.linkedIds.sort()).toEqual([b.id, c.id].sort())

    expect(await getItem(a.id)).toBeUndefined()
    expect(await getFile(a.fileId!)).toBeUndefined()
    expect(await db.files.count()).toBe(0)
    expect((await getItem(b.id))!.links).toEqual([])
    expect((await getItem(c.id))!.links).toEqual([])

    // Пока запись была удалена, исчезла одна из связанных.
    await deleteItem(c.id)
    await restoreItem(snap)

    const restored = (await getItem(a.id))!
    expect(restored.links).toEqual([b.id])
    expect(restored.createdAt).toBe(aFull.createdAt)
    expect((await getItem(b.id))!.links).toEqual([a.id])
    const file = await getFile(a.fileId!)
    expect(await file!.blob.text()).toBe('data')
  })

  it('deleteItem бросает для несуществующей записи', async () => {
    await expect(deleteItem('nope')).rejects.toThrow()
  })

  it('restore сбрасывает удалённую за это время категорию', async () => {
    const cat = await createCategory('Работа')
    const item = await createItem({ type: 'text', content: 'x', categoryId: cat.id })
    const snap = await deleteItem(item.id)
    await deleteCategory(cat.id)
    await restoreItem(snap)
    expect((await getItem(item.id))!.categoryId).toBeNull()
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
    // У соседа связь убрана, но updatedAt не тронут: пользователь его не менял.
    const nAfter = (await getItem(n.id))!
    expect(nAfter.links).toEqual([])
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
