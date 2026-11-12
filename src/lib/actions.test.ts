import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/db'
import {
  createItem,
  createSavedSearch,
  deleteItems,
  getItem,
  linkItems,
  listSavedSearches,
  purgeItems,
  restoreItems,
  updateItem,
} from '@/db/repo'
import type { PdfTextResult } from '@/lib/pdfText'
import type { LinkMeta } from '@/types'
import {
  actDelete,
  actDeleteSearch,
  actEmptyTrash,
  actPurge,
  actRestoreFromTrash,
  actSaveSearch,
  applyWikiLinks,
  createAndEnrich,
  isLinkMetaLoading,
  refreshLinkMeta,
} from './actions'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  fetchLinkMeta: vi.fn(),
  extractPdfText: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: Object.assign(mocks.toast, { error: mocks.toastError, success: mocks.toastSuccess }),
}))
vi.mock('@/lib/linkMeta', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/linkMeta')>()),
  fetchLinkMeta: mocks.fetchLinkMeta,
}))
// Настоящий разбор PDF (pdfjs-dist, worker) в тестах не загружается.
vi.mock('@/lib/pdfText', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pdfText')>()),
  extractPdfText: mocks.extractPdfText,
}))

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

async function until(cond: () => Promise<boolean>, ms = 2000): Promise<void> {
  const start = Date.now()
  while (!(await cond())) {
    if (Date.now() - start > ms) throw new Error('timeout')
    await new Promise((r) => setTimeout(r, 5))
  }
}

const settle = () => new Promise((r) => setTimeout(r, 20))
const metaOf = async (id: string) => (await getItem(id))?.linkMeta

type ToastOptions = { action?: { label: string; onClick: () => void } }

/** Текст и параметры последнего обычного toast. */
function lastToast(): { text: string; options?: ToastOptions } {
  const call = mocks.toast.mock.calls.at(-1)
  if (!call) throw new Error('toast не показан')
  return { text: call[0] as string, options: call[1] as ToastOptions | undefined }
}

const pdfResult = (status: PdfTextResult['status'], text = ''): PdfTextResult => ({
  status,
  text,
  pages: 1,
  readPages: 1,
  truncated: false,
})

const note = (title: string) => createItem({ type: 'text', title, content: title })

beforeEach(async () => {
  await Promise.all([
    db.items.clear(),
    db.files.clear(),
    db.categories.clear(),
    db.meta.clear(),
    db.positions.clear(),
    db.searches.clear(),
  ])
  mocks.fetchLinkMeta.mockReset()
  mocks.extractPdfText.mockReset()
  mocks.toast.mockReset()
  mocks.toastError.mockReset()
  mocks.toastSuccess.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('метаданные ссылки', () => {
  it('поздний ответ по прежнему адресу не затирает метаданные нового', async () => {
    const slowA = deferred<LinkMeta>()
    mocks.fetchLinkMeta.mockImplementation((url: string) =>
      url.includes('a.example') ? slowA.promise : Promise.resolve({ status: 'ok', title: 'Страница B', fetchedAt: 2 }),
    )
    const item = await createAndEnrich({ type: 'link', url: 'https://a.example' })
    expect(await metaOf(item.id)).toEqual({ status: 'pending' })
    expect(isLinkMetaLoading(item.id)).toBe(true)

    // Как LinkCard: сохраняет введённый адрес и перезапрашивает с ещё не нормализованным значением.
    await updateItem(item.id, { url: 'b.example' })
    await refreshLinkMeta({ ...item, url: 'b.example' })
    expect(mocks.fetchLinkMeta).toHaveBeenLastCalledWith('https://b.example', expect.anything())
    expect(await metaOf(item.id)).toMatchObject({ status: 'ok', title: 'Страница B' })
    // прежний запрос отменён
    expect((mocks.fetchLinkMeta.mock.calls[0][1] as { signal: AbortSignal }).signal.aborted).toBe(true)

    slowA.resolve({ status: 'ok', title: 'Страница A', fetchedAt: 1 })
    await settle()
    const after = (await getItem(item.id))!
    expect(after.url).toBe('https://b.example')
    expect(after.linkMeta).toMatchObject({ status: 'ok', title: 'Страница B' })
    expect(isLinkMetaLoading(item.id)).toBe(false)
  })

  it('неудачное «Обновить данные» оставляет прежние заголовок, описание и картинку', async () => {
    const slow = deferred<LinkMeta>()
    mocks.fetchLinkMeta.mockReturnValue(slow.promise)
    const item = await createItem({ type: 'link', url: 'https://c.example' })
    const prev: LinkMeta = {
      status: 'ok',
      title: 'Старый заголовок',
      description: 'Описание',
      siteName: 'C',
      image: 'https://c.example/i.png',
      favicon: 'https://c.example/f.ico',
      fetchedAt: 5,
    }
    await updateItem(item.id, { linkMeta: prev })

    const run = refreshLinkMeta(item)
    // пока идёт запрос, заголовок в списке не пропадает
    await until(async () => (await metaOf(item.id))?.status === 'pending')
    expect(await metaOf(item.id)).toEqual({ ...prev, status: 'pending' })

    slow.resolve({ status: 'failed', fetchedAt: 99 })
    await run
    expect(await metaOf(item.id)).toEqual(prev)
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    expect(isLinkMetaLoading(item.id)).toBe(false)
  })

  it('успешное обновление заменяет метаданные целиком; без прежних данных неудача — failed без toast', async () => {
    const item = await createItem({ type: 'link', url: 'https://d.example' })
    await updateItem(item.id, { linkMeta: { status: 'ok', title: 'Старый', image: 'https://d.example/i.png' } })
    mocks.fetchLinkMeta.mockResolvedValueOnce({ status: 'ok', title: 'Новый', fetchedAt: 7 })
    await refreshLinkMeta(item)
    expect(await metaOf(item.id)).toEqual({ status: 'ok', title: 'Новый', fetchedAt: 7 })

    // Новый адрес: метаданные прежней страницы не «прилипают» к нему при неудаче.
    mocks.fetchLinkMeta.mockResolvedValueOnce({ status: 'failed', fetchedAt: 8 })
    await updateItem(item.id, { url: 'https://other.example' })
    await refreshLinkMeta(item)
    expect(await metaOf(item.id)).toEqual({ status: 'failed', fetchedAt: 8 })
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('исключение при загрузке не оставляет pending', async () => {
    mocks.fetchLinkMeta.mockRejectedValue(new Error('boom'))
    const item = await createAndEnrich({ type: 'link', url: 'https://e.example' })
    await until(async () => (await metaOf(item.id))?.status === 'failed')
    expect(isLinkMetaLoading(item.id)).toBe(false)
  })

  it('удаление и отмена во время загрузки не оставляют вечную «загрузку»', async () => {
    const slow = deferred<LinkMeta>()
    mocks.fetchLinkMeta.mockReturnValue(slow.promise)
    const item = await createAndEnrich({ type: 'link', url: 'https://f.example' })
    const snaps = await deleteItems([item.id])
    slow.resolve({ status: 'ok', title: 'F' })
    await settle()
    // запись лежит в корзине, а не исчезла: поздний ответ записывается
    expect((await getItem(item.id))?.deletedAt).toBeTypeOf('number')
    expect(await metaOf(item.id)).toEqual({ status: 'ok', title: 'F' })
    await restoreItems(snaps)
    expect(await metaOf(item.id)).toEqual({ status: 'ok', title: 'F' })
    expect((await getItem(item.id))?.deletedAt).toBeUndefined()
    expect(isLinkMetaLoading(item.id)).toBe(false)
  })

  it('отмена удаления до ответа снимает «загрузку», а пришедший позже ответ записывается', async () => {
    const slow = deferred<LinkMeta>()
    mocks.fetchLinkMeta.mockReturnValue(slow.promise)
    const item = await createAndEnrich({ type: 'link', url: 'https://f2.example' })
    const snaps = await deleteItems([item.id])
    await restoreItems(snaps)
    expect(await metaOf(item.id)).toEqual({ status: 'failed' })
    slow.resolve({ status: 'ok', title: 'F2' })
    await until(async () => (await metaOf(item.id))?.status === 'ok')
    expect(await metaOf(item.id)).toEqual({ status: 'ok', title: 'F2' })
  })

  it('окончательное удаление до ответа: писать некуда, отмена возвращает запись без «загрузки»', async () => {
    const slow = deferred<LinkMeta>()
    mocks.fetchLinkMeta.mockReturnValue(slow.promise)
    const item = await createAndEnrich({ type: 'link', url: 'https://p.example' })
    const snaps = await deleteItems([item.id])
    expect(await purgeItems([item.id])).toBe(1)
    slow.resolve({ status: 'ok', title: 'P' })
    await settle()
    expect(await getItem(item.id)).toBeUndefined()
    await restoreItems(snaps)
    expect(await metaOf(item.id)).toEqual({ status: 'failed' })
    expect((await getItem(item.id))?.deletedAt).toBeUndefined()
  })

  it('без автозагрузки заголовков ссылка создаётся без запроса', async () => {
    await db.meta.put({ key: 'autoFetchLinkTitle', value: false })
    const item = await createAndEnrich({ type: 'link', url: 'https://g.example' })
    expect(mocks.fetchLinkMeta).not.toHaveBeenCalled()
    expect(await metaOf(item.id)).toBeUndefined()
  })
})

describe('корзина', () => {
  it('actDelete переносит в корзину, «Отменить» возвращает запись как была', async () => {
    const item = await note('Одна')
    await actDelete(item.id)
    expect((await getItem(item.id))?.deletedAt).toBeTypeOf('number')
    const shown = lastToast()
    expect(shown.text).toBe('В корзине')
    expect(shown.options?.action?.label).toBe('Отменить')

    shown.options!.action!.onClick()
    await until(async () => (await getItem(item.id))?.deletedAt === undefined)
    expect(await getItem(item.id)).toEqual(item)
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('actDelete: пакет — со счётчиком; нечего удалять — без toast', async () => {
    const a = await note('A')
    const b = await note('B')
    await actDelete([a.id, b.id, 'нет-такой'])
    expect(lastToast().text).toBe('В корзине: 2')

    mocks.toast.mockClear()
    await actDelete([a.id, b.id])
    await actDelete([])
    await actDelete('нет-такой')
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('actRestoreFromTrash возвращает из корзины и считает только то, что там лежало', async () => {
    const a = await note('A')
    const b = await note('B')
    const c = await note('C')
    await deleteItems([a.id, b.id])

    await actRestoreFromTrash(a.id)
    expect(lastToast()).toEqual({ text: 'Восстановлено', options: undefined })
    expect(await getItem(a.id)).toEqual(a)

    await deleteItems([a.id])
    await actRestoreFromTrash([a.id, b.id, c.id, 'нет-такой'])
    expect(lastToast().text).toBe('Восстановлено: 2')
    expect((await getItem(b.id))?.deletedAt).toBeUndefined()

    mocks.toast.mockClear()
    await actRestoreFromTrash([a.id, c.id])
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(await getItem(c.id)).toEqual(c)
  })

  it('actPurge удаляет навсегда и не предлагает отмену', async () => {
    const a = await note('A')
    const b = await note('B')
    const c = await note('C')
    await deleteItems([a.id])

    await actPurge(a.id)
    expect(lastToast()).toEqual({ text: 'Удалено навсегда', options: undefined })
    expect(await getItem(a.id)).toBeUndefined()

    // запись вне корзины удаляется так же
    await actPurge([b.id, c.id, 'нет-такой'])
    expect(lastToast()).toEqual({ text: 'Удалено навсегда: 2', options: undefined })
    expect(await db.items.count()).toBe(0)

    mocks.toast.mockClear()
    await actPurge('нет-такой')
    await actPurge([])
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('actEmptyTrash очищает только корзину; пустая корзина — без toast', async () => {
    const a = await note('A')
    const b = await note('B')
    const keep = await note('Остаётся')

    await actEmptyTrash()
    expect(mocks.toast).not.toHaveBeenCalled()

    await deleteItems([a.id])
    await actEmptyTrash()
    expect(lastToast()).toEqual({ text: 'Корзина очищена: 1', options: undefined })

    const c = await note('C')
    await deleteItems([b.id, c.id])
    await actEmptyTrash()
    expect(lastToast().text).toBe('Корзина очищена: 2')
    expect(await db.items.toArray()).toEqual([keep])
  })

  it('ошибка базы уходит в toast.error и наружу не бросается', async () => {
    const item = await note('A')
    vi.spyOn(db.items, 'bulkGet').mockRejectedValue(new Error('база недоступна'))
    await expect(actDelete(item.id)).resolves.toBeUndefined()
    await expect(actPurge(item.id)).resolves.toBeUndefined()
    expect(mocks.toastError).toHaveBeenCalledTimes(2)
    expect(mocks.toastError).toHaveBeenLastCalledWith('база недоступна')
    expect(mocks.toast).not.toHaveBeenCalled()
  })
})

describe('сохранённые поиски', () => {
  it('actSaveSearch сохраняет и сообщает; дубль имени уходит в toast.error', async () => {
    const saved = await actSaveSearch('  Работа  ', ' tag:work ')
    expect(saved).toMatchObject({ name: 'Работа', query: 'tag:work' })
    expect(mocks.toastSuccess).toHaveBeenCalledExactlyOnceWith('Поиск сохранён')
    expect(await listSavedSearches()).toEqual([saved])

    expect(await actSaveSearch('работа', 'is:fav')).toBeUndefined()
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('Поиск «Работа» уже есть')
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1)
    expect(await listSavedSearches()).toEqual([saved])

    expect(await actSaveSearch('Пустой', '   ')).toBeUndefined()
    expect(mocks.toastError).toHaveBeenLastCalledWith('Запрос пуст — сохранять нечего')
  })

  it('actDeleteSearch удаляет, «Отменить» возвращает поиск на место', async () => {
    const first = await createSavedSearch('Первый', 'tag:a')
    const second = await createSavedSearch('Второй', 'tag:b')
    await actDeleteSearch(first)
    expect(await listSavedSearches()).toEqual([second])
    const shown = lastToast()
    expect(shown.text).toBe('Поиск удалён')
    expect(shown.options?.action?.label).toBe('Отменить')

    shown.options!.action!.onClick()
    await until(async () => (await listSavedSearches()).length === 2)
    expect(await listSavedSearches()).toEqual([first, second])
  })
})

describe('applyWikiLinks', () => {
  const all = () => db.items.toArray()

  it('создаёт только недостающие связи и возвращает их id', async () => {
    const self = await createItem({ type: 'text', title: 'Заметка', content: '' })
    const alpha = await note('Альфа')
    const beta = await note('Бета')
    const gamma = await note('Гамма')
    await linkItems(self.id, alpha.id)
    const alphaBefore = (await getItem(alpha.id))!

    const content = 'См. [[Альфа]], [[бета|вторая]] и [[Нет такой]]; ещё раз [[Бета]], себя [[Заметка]]. `[[Гамма]]`'
    expect(await applyWikiLinks(self.id, content, await all())).toEqual([beta.id])
    expect((await getItem(self.id))!.links).toEqual([alpha.id, beta.id])
    expect((await getItem(beta.id))!.links).toEqual([self.id])
    expect((await getItem(gamma.id))!.links).toEqual([])
    // уже существующая связь не пересоздаётся
    expect(await getItem(alpha.id)).toEqual(alphaBefore)

    // повтор ничего не добавляет, удаление [[…]] из текста связь не рвёт
    expect(await applyWikiLinks(self.id, content, await all())).toEqual([])
    expect(await applyWikiLinks(self.id, 'без ссылок', await all())).toEqual([])
    expect((await getItem(self.id))!.links).toEqual([alpha.id, beta.id])
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('устаревший снимок: цель уже в корзине или записи нет — связи нет, ошибки нет', async () => {
    const self = await createItem({ type: 'text', title: 'Заметка', content: '' })
    const gone = await note('Удалённая')
    const stale = await all()
    await deleteItems([gone.id])
    expect(await applyWikiLinks(self.id, '[[Удалённая]]', stale)).toEqual([])
    expect((await getItem(self.id))!.links).toEqual([])
    // свежий снимок корзину не предлагает вовсе
    expect(await applyWikiLinks(self.id, '[[Удалённая]]', await all())).toEqual([])

    expect(await applyWikiLinks('нет-такой', '[[Заметка]]', await all())).toEqual([])
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('не бросает при ошибке базы: сообщает в toast.error', async () => {
    const self = await createItem({ type: 'text', title: 'Заметка', content: '' })
    await note('Альфа')
    const items = await all()
    vi.spyOn(db.items, 'bulkGet').mockRejectedValue(new Error('база недоступна'))
    expect(await applyWikiLinks(self.id, '[[Альфа]]', items)).toEqual([])
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('база недоступна')
  })
})

describe('текст PDF при создании записи', () => {
  const pdf = () => new File(['%PDF-1.7'], 'Договор.pdf', { type: 'application/pdf' })

  it('для PDF текст извлекается в фоне и попадает в запись', async () => {
    const slow = deferred<PdfTextResult>()
    mocks.extractPdfText.mockReturnValue(slow.promise)
    const item = await createAndEnrich({ type: 'file', file: pdf() })
    // возврат не ждёт разбора файла
    expect(item.ocrAt).toBeUndefined()
    expect((await getItem(item.id))!.ocrAt).toBeUndefined()

    slow.resolve(pdfResult('ok', 'Текст договора'))
    await until(async () => (await getItem(item.id))?.ocrAt !== undefined)
    const after = (await getItem(item.id))!
    expect(after.ocrText).toBe('Текст договора')
    expect(after.updatedAt).toBe(item.updatedAt)
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(1)
    expect((mocks.extractPdfText.mock.calls[0][0] as Blob).size).toBe(8)
  })

  it('сбой разбора не мешает созданию записи; не-PDF не разбирается', async () => {
    mocks.extractPdfText.mockResolvedValue({ ...pdfResult('failed'), error: 'Не удалось прочитать PDF' })
    const item = await createAndEnrich({ type: 'file', file: pdf() })
    await until(async () => mocks.extractPdfText.mock.calls.length === 1)
    await settle()
    expect((await getItem(item.id))!.ocrAt).toBeUndefined()

    await createAndEnrich({ type: 'file', file: new File(['x'], 'notes.txt', { type: 'text/plain' }) })
    await createAndEnrich({ type: 'text', content: 'просто текст' })
    await settle()
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(1)
    expect(mocks.toastError).not.toHaveBeenCalled()
  })
})
