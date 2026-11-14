import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/db'
import {
  createCategory,
  createItem,
  createSavedSearch,
  deleteItems,
  getItem,
  getPositions,
  linkItems,
  listSavedSearches,
  purgeItems,
  restoreFromTrash,
  restoreItems,
  setOcrText,
  setPositions,
  updateItem,
} from '@/db/repo'
import { setSettings } from '@/db/settings'
import { relativeRange } from '@/lib/dates'
import type { extractItemText } from '@/lib/ocr'
import { getOcrNote, resetOcrState, setOcrJob, setOcrNote, type OcrOutcome } from '@/lib/ocrState'
import type { PdfTextResult } from '@/lib/pdfText'
import type { ConfirmOptions } from '@/store/confirm'
import { useGraph } from '@/store/graph'
import { useUi, type View } from '@/store/ui'
import type { Item, LinkMeta, SavedSearch } from '@/types'
import {
  NOTHING_TO_SAVE,
  actApplySearch,
  actApplyWikiLinks,
  actCancelRecognize,
  actClearOcrText,
  actDelete,
  actDeleteSearch,
  actDownloadMarkdown,
  actEmptyTrash,
  actEmptyTrashAsk,
  actLinkItems,
  actMoveGroup,
  actMoveNode,
  actMoveSearch,
  actPurge,
  actPurgeAsk,
  actRecognize,
  actRelayoutGraph,
  actRenameSearch,
  actRestoreFromTrash,
  actSaveCurrentSearch,
  actSaveOcrText,
  actSaveSearch,
  actSetCategory,
  actUnlinkItems,
  applyWikiLinks,
  createAndEnrich,
  findDuplicateLinkNow,
  openLink,
  isLinkMetaLoading,
  openItemInSection,
  refreshLinkMeta,
} from './actions'

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  fetchLinkMeta: vi.fn(),
  extractPdfText: vi.fn(),
  // OcrOutcome: исход с полями этапа 8 (via, pages, truncated), ExtractOutcome в ocr.ts — его подмножество.
  extractItemText: vi.fn<(...args: Parameters<typeof extractItemText>) => Promise<OcrOutcome>>(),
  realExtractItemText: undefined as typeof extractItemText | undefined,
  confirm: vi.fn<(options: ConfirmOptions) => Promise<boolean>>(),
  openExternal: vi.fn<(u: string) => Promise<boolean>>(),
  allSnapshot: vi.fn<() => Item[] | undefined>(),
  trashSnapshot: vi.fn<() => Item[] | undefined>(),
}))

vi.mock('sonner', () => ({
  toast: Object.assign(mocks.toast, { error: mocks.toastError, success: mocks.toastSuccess }),
}))
// Вопрос рисует ConfirmHost; в тестах ответ задаётся подменой.
vi.mock('@/lib/desktop', () => ({ openExternal: mocks.openExternal }))
vi.mock('@/store/confirm', () => ({ confirmDialog: mocks.confirm }))
// Общий снимок записей наполняет liveQuery в приложении; здесь его задаёт тест.
vi.mock('@/hooks/useItems', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/useItems')>()),
  getAllItemsSnapshot: mocks.allSnapshot,
  getTrashedItemsSnapshot: mocks.trashSnapshot,
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

// Распознавание: по умолчанию — настоящий extractItemText (с подменённым разбором PDF), тесты задают исход сами.
vi.mock('@/lib/ocr', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ocr')>()
  mocks.realExtractItemText = real.extractItemText
  return { ...real, extractItemText: mocks.extractItemText }
})

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

const initialUi = useUi.getState()
const initialGraph = useGraph.getState()

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
  mocks.extractItemText.mockReset()
  mocks.extractItemText.mockImplementation((...args) => mocks.realExtractItemText!(...args))
  resetOcrState()
  mocks.toast.mockReset()
  mocks.toastError.mockReset()
  mocks.toastSuccess.mockReset()
  mocks.confirm.mockReset()
  mocks.allSnapshot.mockReset()
  mocks.trashSnapshot.mockReset()
  useUi.setState(initialUi, true)
  useGraph.setState(initialGraph, true)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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

const AI_ON = { aiEnabled: true, aiApiKey: 'sk-test' } as const
const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'Скриншот.png', { type: 'image/png' })
const pdfFile = () => new File(['%PDF-1.7'], 'Скан.pdf', { type: 'application/pdf' })

describe('распознавание при создании записи', () => {
  /** Опции последнего вызова extractItemText (ждёт, пока фоновая задача его сделает). */
  async function extractOptions(): Promise<Parameters<typeof extractItemText>[1]> {
    await until(async () => mocks.extractItemText.mock.calls.length > 0)
    return mocks.extractItemText.mock.calls.at(-1)![1]
  }

  beforeEach(() => {
    mocks.extractItemText.mockResolvedValue({ status: 'skipped' })
  })

  it('картинка при выключенном ИИ не идёт в распознавание', async () => {
    await createAndEnrich({ type: 'image', file: png() })
    await settle()
    expect(mocks.extractItemText).not.toHaveBeenCalled()
  })

  it('картинка: ИИ включён, но автораспознавание нет — не идёт', async () => {
    await setSettings(AI_ON)
    await createAndEnrich({ type: 'image', file: png() })
    await settle()
    expect(mocks.extractItemText).not.toHaveBeenCalled()
  })

  it('картинка: ИИ и автораспознавание включены — vision', async () => {
    await setSettings({ ...AI_ON, aiAutoOcr: true })
    const item = await createAndEnrich({ type: 'image', file: png() })
    expect(await extractOptions()).toEqual({ vision: true })
    expect((mocks.extractItemText.mock.calls[0][0] as Item).id).toBe(item.id)
  })

  it('автораспознавание без включённого ИИ — без vision', async () => {
    await setSettings({ aiAutoOcr: true })
    await createAndEnrich({ type: 'file', file: pdfFile() })
    expect(await extractOptions()).toEqual({ vision: false })
  })

  it('PDF извлекается всегда; vision — по настройкам', async () => {
    await createAndEnrich({ type: 'file', file: pdfFile() })
    expect(await extractOptions()).toEqual({ vision: false })

    mocks.extractItemText.mockClear()
    await setSettings({ ...AI_ON, aiAutoOcr: true })
    await createAndEnrich({ type: 'file', file: pdfFile() })
    expect(await extractOptions()).toEqual({ vision: true })
  })

  it('настройки не прочитались — авто выключено: PDF без vision, картинка не идёт', async () => {
    await setSettings({ ...AI_ON, aiAutoOcr: true })
    vi.spyOn(db.meta, 'bulkGet').mockRejectedValue(new Error('база недоступна'))
    await createAndEnrich({ type: 'image', file: png() })
    await createAndEnrich({ type: 'file', file: pdfFile() })
    expect(await extractOptions()).toEqual({ vision: false })
    await settle()
    expect(mocks.extractItemText).toHaveBeenCalledTimes(1)
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('возврат записи не ждёт распознавания; записи без вложения не трогаются', async () => {
    await setSettings({ ...AI_ON, aiAutoOcr: true })
    const slow = deferred<OcrOutcome>()
    mocks.extractItemText.mockReturnValue(slow.promise)
    const item = await createAndEnrich({ type: 'image', file: png() })
    expect(item.ocrAt).toBeUndefined()
    await createAndEnrich({ type: 'text', content: 'просто текст' })
    await settle()
    expect(mocks.extractItemText).toHaveBeenCalledTimes(1)
    slow.resolve({ status: 'skipped' })
  })
})

describe('actRecognize', () => {
  const image = () => createItem({ type: 'image', file: png() })
  const pdf = () => createItem({ type: 'file', file: pdfFile() })

  it('картинка при выключенном ИИ — причина в toast, до extractItemText не доходит', async () => {
    const item = await image()
    await actRecognize(item)
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('Включите ИИ-помощника в настройках')
    expect(mocks.extractItemText).not.toHaveBeenCalled()
  })

  it('картинка без ключа — своя причина', async () => {
    await setSettings({ aiEnabled: true })
    await actRecognize(await image())
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('Укажите API-ключ в «Настройки → ИИ-помощник»')
    expect(mocks.extractItemText).not.toHaveBeenCalled()
  })

  it('PDF при выключенном ИИ — локальное извлечение без vision', async () => {
    mocks.extractItemText.mockResolvedValue({ status: 'ok', via: 'text-layer' })
    const item = await pdf()
    await actRecognize(item)
    expect(mocks.extractItemText).toHaveBeenCalledExactlyOnceWith(item, { vision: false, force: true })
    expect(mocks.toastSuccess).toHaveBeenCalledExactlyOnceWith('Текст извлечён из PDF')
  })

  it('запись в корзине и запись без вложения — ничего', async () => {
    await setSettings(AI_ON)
    const trashed = { ...(await image()), deletedAt: Date.now() }
    await actRecognize(trashed)
    await actRecognize(await note('текст'))
    expect(mocks.extractItemText).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('ok зрением — «Текст распознан», ручной запуск с vision', async () => {
    await setSettings(AI_ON)
    mocks.extractItemText.mockResolvedValue({ status: 'ok', via: 'vision' })
    const item = await image()
    await actRecognize(item)
    expect(mocks.extractItemText).toHaveBeenCalledExactlyOnceWith(item, { vision: true, force: true })
    expect(mocks.toastSuccess).toHaveBeenCalledExactlyOnceWith('Текст распознан')
    expect(getOcrNote(item.id)).toBeUndefined()
  })

  it('ok: не все страницы и оборванный ответ — в описании', async () => {
    await setSettings(AI_ON)
    mocks.extractItemText.mockResolvedValue({
      status: 'ok',
      via: 'vision',
      pages: { read: 5, total: 12 },
      truncated: true,
    })
    await actRecognize(await pdf())
    expect(mocks.toastSuccess).toHaveBeenCalledExactlyOnceWith('Текст распознан', {
      description: 'Распознаны первые 5 из 12 страниц. Ответ модели оборван, текст неполный',
    })
  })

  it('ok: все страницы прочитаны — без описания', async () => {
    await setSettings(AI_ON)
    mocks.extractItemText.mockResolvedValue({ status: 'ok', via: 'vision', pages: { read: 3, total: 3 } })
    await actRecognize(await pdf())
    expect(mocks.toastSuccess).toHaveBeenCalledExactlyOnceWith('Текст распознан')
  })

  it('empty — примечание и «Текст не найден»', async () => {
    await setSettings(AI_ON)
    mocks.extractItemText.mockResolvedValue({ status: 'empty', via: 'vision' })
    const item = await image()
    await actRecognize(item)
    expect(getOcrNote(item.id)).toMatchObject({ status: 'empty' })
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith('Текст не найден')
  })

  it('failed — примечание с ошибкой и toast.error', async () => {
    await setSettings(AI_ON)
    mocks.extractItemText.mockResolvedValue({ status: 'failed', error: 'Неверный API-ключ (401)' })
    const item = await image()
    await actRecognize(item)
    expect(getOcrNote(item.id)).toMatchObject({ status: 'failed', error: 'Неверный API-ключ (401)' })
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('Неверный API-ключ (401)')
  })

  it('skipped (отмена) — без сообщений; прежнее примечание снято', async () => {
    await setSettings(AI_ON)
    mocks.extractItemText.mockResolvedValue({ status: 'skipped' })
    const item = await image()
    setOcrNote(item.id, { status: 'failed', error: 'было', at: 1 })
    await actRecognize(item)
    expect(getOcrNote(item.id)).toBeUndefined()
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('настройки не прочитались — ошибка в toast, без распознавания', async () => {
    const item = await image()
    vi.spyOn(db.meta, 'bulkGet').mockRejectedValue(new Error('база недоступна'))
    await actRecognize(item)
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('база недоступна')
    expect(mocks.extractItemText).not.toHaveBeenCalled()
  })
})

describe('actCancelRecognize', () => {
  it('вызывает cancel задачи; задачи нет — ничего', () => {
    const cancel = vi.fn()
    setOcrJob('a', { phase: 'running', manual: true, cancel })
    actCancelRecognize('a')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(() => actCancelRecognize('нет')).not.toThrow()
    setOcrJob('b', { phase: 'queued', manual: false })
    expect(() => actCancelRecognize('b')).not.toThrow()
  })
})

describe('правка и очистка распознанного текста', () => {
  it('actSaveOcrText записывает текст, updatedAt прежний', async () => {
    const item = await note('с картинкой')
    await actSaveOcrText(item.id, '  Исправленный текст  ')
    const after = (await getItem(item.id))!
    expect(after.ocrText).toBe('Исправленный текст')
    expect(after.ocrAt).toBeDefined()
    expect(after.updatedAt).toBe(item.updatedAt)
  })

  it('actSaveOcrText: записи нет — toast.error', async () => {
    await actSaveOcrText('нет-такой', 'текст')
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('Запись не найдена')
  })

  it('actClearOcrText очищает и «Отменить» возвращает прежний текст', async () => {
    const item = await note('скан')
    await setOcrText(item.id, 'Распознанное')
    await actClearOcrText(item)
    expect((await getItem(item.id))!.ocrText).toBeUndefined()
    const { text, options } = lastToast()
    expect(text).toBe('Распознанный текст очищен')
    expect(options?.action?.label).toBe('Отменить')
    options!.action!.onClick()
    await until(async () => (await getItem(item.id))?.ocrText === 'Распознанное')
  })

  it('очистка ставит отметку «текст убрал пользователь», «Отменить» её снимает; правка до пустого — то же', async () => {
    const item = await note('договор')
    await setOcrText(item.id, 'Текст слоя')
    await actClearOcrText(item)
    const cleared = (await getItem(item.id))!
    expect(cleared.ocrClearedAt).toBeTypeOf('number')
    expect(cleared.ocrAt).toBe(cleared.ocrClearedAt)
    lastToast().options!.action!.onClick()
    await until(async () => (await getItem(item.id))?.ocrText === 'Текст слоя')
    expect((await getItem(item.id))!.ocrClearedAt).toBeUndefined()

    await actSaveOcrText(item.id, ' \n\t ')
    const emptied = (await getItem(item.id))!
    expect(emptied.ocrText).toBeUndefined()
    expect(emptied.ocrClearedAt).toBeTypeOf('number')
    expect(emptied.updatedAt).toBe(item.updatedAt)
    expect(mocks.toastError).not.toHaveBeenCalled()

    await actSaveOcrText('нет-такой', '')
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('Запись не найдена')
  })

  it('actClearOcrText: текста нет — ничего', async () => {
    const item = await note('пусто')
    await actClearOcrText(item)
    expect(mocks.toast).not.toHaveBeenCalled()
    expect((await getItem(item.id))!.ocrAt).toBeUndefined()
  })
})

describe('подтверждения окончательного удаления', () => {
  it('actPurgeAsk: одна запись — заголовок в вопросе; «Отмена» — запись на месте, «Удалить навсегда» — удалена', async () => {
    const item = await createItem({ type: 'text', content: '# План **на год**\nдетали' })
    await deleteItems([item.id])

    mocks.confirm.mockResolvedValueOnce(false)
    await actPurgeAsk(item.id)
    expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith({
      title: 'Удалить навсегда?',
      description: 'Запись «План на год» будет удалена без возможности восстановления.',
      confirmLabel: 'Удалить навсегда',
      destructive: true,
    })
    expect(await getItem(item.id)).toBeDefined()
    expect(mocks.toast).not.toHaveBeenCalled()

    mocks.confirm.mockResolvedValueOnce(true)
    await actPurgeAsk([item.id])
    expect(await getItem(item.id)).toBeUndefined()
    expect(lastToast()).toEqual({ text: 'Удалено навсегда', options: undefined })
  })

  it('actPurgeAsk: несколько записей — число без повторов', async () => {
    const a = await note('A')
    const b = await note('B')
    await deleteItems([a.id, b.id])
    mocks.confirm.mockResolvedValueOnce(true)
    await actPurgeAsk([a.id, b.id, a.id])
    expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        title: 'Удалить навсегда?',
        description: 'Записей: 2. Они будут удалены без возможности восстановления.',
      }),
    )
    expect(await db.items.count()).toBe(0)
    expect(lastToast().text).toBe('Удалено навсегда: 2')
  })

  it('actPurgeAsk: пусто или записи нет — без вопроса', async () => {
    await actPurgeAsk([])
    await actPurgeAsk('нет-такой')
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('actPurgeAsk: запись вне корзины (устаревший список) — без вопроса, запись на месте', async () => {
    const live = await note('Живая')
    mocks.confirm.mockResolvedValue(true)
    await actPurgeAsk(live.id)
    await actPurgeAsk([live.id, 'нет-такой'])
    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(await getItem(live.id)).toEqual(live)
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('actPurgeAsk: смешанный список — вопрос и удаление только про корзину', async () => {
    const a = await note('A')
    const b = await note('B')
    await deleteItems([a.id])
    mocks.confirm.mockResolvedValueOnce(true)
    await actPurgeAsk([a.id, b.id])
    expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ description: 'Запись «A» будет удалена без возможности восстановления.' }),
    )
    expect(await getItem(a.id)).toBeUndefined()
    expect(await getItem(b.id)).toEqual(b)
    expect(lastToast()).toEqual({ text: 'Удалено навсегда', options: undefined })
  })

  it('actPurgeAsk: восстановленное, пока висел вопрос, не удаляется', async () => {
    const a = await note('A')
    const b = await note('B')
    const c = await note('C')
    await deleteItems([a.id, b.id, c.id])
    mocks.confirm.mockImplementationOnce(async () => {
      await restoreFromTrash([a.id])
      return true
    })
    await actPurgeAsk([a.id, b.id, c.id])
    expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ description: 'Записей: 3. Они будут удалены без возможности восстановления.' }),
    )
    const restored = await getItem(a.id)
    expect(restored).toBeDefined()
    expect(restored?.deletedAt).toBeUndefined()
    expect(await getItem(b.id)).toBeUndefined()
    expect(await getItem(c.id)).toBeUndefined()
    expect(lastToast().text).toBe('Удалено навсегда: 2')
  })

  it('actPurgeAsk: всё восстановили, пока висел вопрос, — ничего не удаляется и не сообщается', async () => {
    const a = await note('A')
    await deleteItems([a.id])
    mocks.confirm.mockImplementationOnce(async () => {
      await restoreFromTrash([a.id])
      return true
    })
    await actPurgeAsk(a.id)
    expect((await getItem(a.id))?.deletedAt).toBeUndefined()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('actPurgeAsk: ошибка чтения базы — toast.error, без вопроса', async () => {
    const a = await note('A')
    await deleteItems([a.id])
    vi.spyOn(db.items, 'get').mockRejectedValue(new Error('база недоступна'))
    await expect(actPurgeAsk(a.id)).resolves.toBeUndefined()
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('база недоступна')
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('actEmptyTrashAsk: число из снимка корзины; «Отмена» — корзина цела', async () => {
    const a = await note('A')
    const b = await note('B')
    const keep = await note('Остаётся')
    await deleteItems([a.id, b.id])
    mocks.trashSnapshot.mockReturnValue([(await getItem(a.id))!, (await getItem(b.id))!])

    mocks.confirm.mockResolvedValueOnce(false)
    await actEmptyTrashAsk()
    expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith({
      title: 'Очистить корзину?',
      description: 'Все записи в корзине (2) будут удалены без возможности восстановления.',
      confirmLabel: 'Очистить',
      destructive: true,
    })
    expect(await db.items.count()).toBe(3)

    mocks.confirm.mockResolvedValueOnce(true)
    await actEmptyTrashAsk()
    expect(await db.items.toArray()).toEqual([keep])
    expect(lastToast().text).toBe('Корзина очищена: 2')
  })

  it('actEmptyTrashAsk: восстановленное, пока висел вопрос, остаётся; toast — фактическое число', async () => {
    const a = await note('A')
    const b = await note('B')
    await deleteItems([a.id, b.id])
    mocks.trashSnapshot.mockReturnValue([(await getItem(a.id))!, (await getItem(b.id))!])
    mocks.confirm.mockImplementationOnce(async () => {
      await restoreFromTrash([a.id])
      return true
    })
    await actEmptyTrashAsk()
    expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ description: 'Все записи в корзине (2) будут удалены без возможности восстановления.' }),
    )
    expect((await getItem(a.id))?.deletedAt).toBeUndefined()
    expect(await getItem(b.id)).toBeUndefined()
    expect(lastToast().text).toBe('Корзина очищена: 1')
  })

  it('actEmptyTrashAsk: пустая корзина — без вопроса; снимка нет — вопрос без числа', async () => {
    mocks.trashSnapshot.mockReturnValue([])
    await actEmptyTrashAsk()
    expect(mocks.confirm).not.toHaveBeenCalled()

    mocks.trashSnapshot.mockReturnValue(undefined)
    mocks.confirm.mockResolvedValueOnce(false)
    await actEmptyTrashAsk()
    expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ description: 'Все записи в корзине будут удалены без возможности восстановления.' }),
    )
  })
})

describe('findDuplicateLinkNow', () => {
  it('снимок есть — проверка по нему', async () => {
    const old = await createItem({ type: 'link', url: 'https://example.com/a' })
    mocks.allSnapshot.mockReturnValue([old])
    expect((await findDuplicateLinkNow('https://www.example.com/a/'))?.id).toBe(old.id)
    mocks.allSnapshot.mockReturnValue([])
    expect(await findDuplicateLinkNow('https://example.com/a')).toBeUndefined()
  })

  it('снимка нет — дубль находится запросом к базе, а не по пустому списку', async () => {
    const old = await createItem({ type: 'link', url: 'https://example.com/a' })
    mocks.allSnapshot.mockReturnValue(undefined)
    expect((await findDuplicateLinkNow('https://example.com/a?utm_source=x'))?.id).toBe(old.id)
    expect(await findDuplicateLinkNow('https://example.com/b')).toBeUndefined()
    await deleteItems([old.id])
    expect(await findDuplicateLinkNow('https://example.com/a')).toBeUndefined()
  })
})

describe('actApplyWikiLinks', () => {
  const all = () => db.items.toArray()

  it('связи по снимку; одна связь — toast с заголовком, несколько — с числом', async () => {
    const self = await createItem({ type: 'text', title: 'Заметка', content: '' })
    const alpha = await note('Альфа')
    const beta = await note('Бета')
    const gamma = await note('Гамма')
    mocks.allSnapshot.mockReturnValue(await all())

    expect(await actApplyWikiLinks(self.id, 'см. [[альфа]]')).toEqual([alpha.id])
    expect(lastToast()).toEqual({ text: 'Добавлена связь: «Альфа»', options: undefined })

    mocks.allSnapshot.mockReturnValue(await all())
    expect(await actApplyWikiLinks(self.id, '[[Альфа]] [[Бета]] [[Гамма|г]]')).toEqual([beta.id, gamma.id])
    expect(lastToast().text).toBe('Добавлено связей: 2')
    expect((await getItem(self.id))!.links).toEqual([alpha.id, beta.id, gamma.id])

    // нового нет — toast не показывается
    mocks.toast.mockClear()
    mocks.allSnapshot.mockReturnValue(await all())
    expect(await actApplyWikiLinks(self.id, '[[Альфа]]')).toEqual([])
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('silent — без toast', async () => {
    const self = await createItem({ type: 'text', title: 'Заметка', content: '' })
    const alpha = await note('Альфа')
    mocks.allSnapshot.mockReturnValue(await all())
    expect(await actApplyWikiLinks(self.id, '[[Альфа]]', { silent: true })).toEqual([alpha.id])
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('снимка нет (мини-окно сразу после показа) — записи читаются из базы, корзина не в счёт', async () => {
    const self = await createItem({ type: 'text', title: 'Заметка', content: '' })
    const alpha = await note('Альфа')
    const trashed = await note('Бета')
    await deleteItems([trashed.id])
    mocks.allSnapshot.mockReturnValue(undefined)
    expect(await actApplyWikiLinks(self.id, '[[Альфа]] [[Бета]]', { silent: true })).toEqual([alpha.id])
    expect((await getItem(self.id))!.links).toEqual([alpha.id])
  })

  it('в тексте нет «[[» — ничего', async () => {
    const self = await createItem({ type: 'text', title: 'Заметка', content: '' })
    await note('Альфа')
    mocks.allSnapshot.mockReturnValue(await all())
    mocks.allSnapshot.mockClear()
    expect(await actApplyWikiLinks(self.id, 'Альфа без скобок')).toEqual([])
    expect(mocks.allSnapshot).not.toHaveBeenCalled()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('createAndEnrich создаёт связи по [[…]] молча; у кода — нет', async () => {
    const alpha = await note('Альфа')
    mocks.allSnapshot.mockReturnValue(await all())
    const created = await createAndEnrich({ type: 'idea', content: 'Связать с [[Альфа]]' })
    await until(async () => (await getItem(created.id))!.links.includes(alpha.id))
    expect((await getItem(alpha.id))!.links).toEqual([created.id])

    const code = await createAndEnrich({ type: 'code', content: 'x = "[[Альфа]]"' })
    await settle()
    expect((await getItem(code.id))!.links).toEqual([])
    expect(mocks.toast).not.toHaveBeenCalled()
  })
})

describe('openLink', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('в Tauri отказ openExternal даёт сообщение, а не window.open', async () => {
    const open = vi.fn()
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, open })
    mocks.openExternal.mockResolvedValue(false)
    await openLink('ftp://example.org/f')
    expect(open).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('Не удалось открыть ссылку')
  })

  it('в Tauri успех — без window.open и сообщений', async () => {
    const open = vi.fn()
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, open })
    mocks.openExternal.mockResolvedValue(true)
    await openLink('https://e.com')
    expect(open).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('в вебе — window.open', async () => {
    const open = vi.fn()
    vi.stubGlobal('window', { open })
    await openLink('https://e.com')
    expect(open).toHaveBeenCalledWith('https://e.com', '_blank', 'noopener,noreferrer')
    expect(mocks.openExternal).not.toHaveBeenCalled()
  })
})

describe('openItemInSection', () => {
  const item = (over: Partial<Item>) =>
    ({ id: 'x', status: 'library', favorite: 0, ...over }) as Pick<Item, 'id' | 'status' | 'deletedAt' | 'favorite'>

  it('раздел по статусу записи; выбор — после смены раздела', () => {
    useUi.getState().setView('inbox')
    openItemInSection(item({ id: 'a', status: 'library' }))
    expect(useUi.getState()).toMatchObject({ view: 'library', selectedId: 'a' })

    openItemInSection(item({ id: 'b', status: 'archive' }))
    expect(useUi.getState()).toMatchObject({ view: 'archive', selectedId: 'b' })
  })

  it('запись в корзине — раздел «Корзина»', () => {
    openItemInSection(item({ id: 't', status: 'inbox', deletedAt: 5 }))
    expect(useUi.getState()).toMatchObject({ view: 'trash', selectedId: 't' })
  })

  it('тот же раздел не меняется: фильтры сохраняются', () => {
    useUi.getState().setView('library')
    useUi.getState().setFilter({ tags: ['js'] })
    openItemInSection(item({ id: 'a', status: 'library' }))
    expect(useUi.getState()).toMatchObject({ view: 'library', selectedId: 'a', filter: { tags: ['js'] } })
  })

  it('«Избранное» остаётся для своей записи; архив, корзина и не избранное — в свой раздел', () => {
    useUi.getState().setView('favorites')
    openItemInSection(item({ id: 'f', status: 'inbox', favorite: 1 }))
    expect(useUi.getState()).toMatchObject({ view: 'favorites', selectedId: 'f' })

    openItemInSection(item({ id: 'fa', status: 'archive', favorite: 1 }))
    expect(useUi.getState().view).toBe('archive')

    useUi.getState().setView('favorites')
    openItemInSection(item({ id: 'ft', status: 'library', favorite: 1, deletedAt: 7 }))
    expect(useUi.getState().view).toBe('trash')

    useUi.getState().setView('favorites')
    openItemInSection(item({ id: 'n', status: 'library', favorite: 0 }))
    expect(useUi.getState()).toMatchObject({ view: 'library', selectedId: 'n' })
  })
})

describe('граф: openItemInSection и actApplySearch', () => {
  const item = (over: Partial<Item>) =>
    ({ id: 'x', status: 'library', favorite: 0, ...over }) as Pick<Item, 'id' | 'status' | 'deletedAt' | 'favorite'>
  const search = (query: string): SavedSearch => ({ id: 's', name: 'Поиск', query, order: 0, createdAt: 0 })

  it('обычная запись: раздел остаётся «Граф», запись выбрана', () => {
    useUi.getState().setView('graph')
    openItemInSection(item({ id: 'a', status: 'library' }))
    expect(useUi.getState()).toMatchObject({ view: 'graph', selectedId: 'a' })
    openItemInSection(item({ id: 'i', status: 'inbox' }))
    expect(useUi.getState()).toMatchObject({ view: 'graph', selectedId: 'i' })
    expect(useGraph.getState().showArchive).toBe(true)
  })

  it('архивная запись: показ архива включается', () => {
    useUi.getState().setView('graph')
    useGraph.getState().setShowArchive(false)
    openItemInSection(item({ id: 'b', status: 'archive' }))
    expect(useUi.getState()).toMatchObject({ view: 'graph', selectedId: 'b' })
    expect(useGraph.getState().showArchive).toBe(true)
  })

  it('запись из корзины: «Корзина»; показ архива не трогается', () => {
    useUi.getState().setView('graph')
    useGraph.getState().setShowArchive(false)
    openItemInSection(item({ id: 't', status: 'archive', deletedAt: 5 }))
    expect(useUi.getState()).toMatchObject({ view: 'trash', selectedId: 't' })
    expect(useGraph.getState().showArchive).toBe(false)
  })

  it('actApplySearch из «Графа»: раздел остаётся, запрос — в строке, фильтры сброшены', () => {
    useUi.getState().setView('graph')
    useUi.getState().setFilter({ tags: ['old'] })
    actApplySearch(search('react'))
    expect(useUi.getState()).toMatchObject({ view: 'graph', query: 'react', filter: {} })

    // Свой раздел в запросе в «Графе» не уводит в список.
    actApplySearch(search('is:archive react'))
    expect(useUi.getState()).toMatchObject({ view: 'graph', query: 'is:archive react' })
    actApplySearch(search('is:trash'))
    expect(useUi.getState().view).toBe('graph')
  })

  it('actApplySearch из «Графа»: поиск со своим разделом не стирается при переходе в этот раздел', () => {
    useUi.getState().setView('graph')
    actApplySearch(search('is:archive react'))
    useUi.getState().setView('archive')
    expect(useUi.getState()).toMatchObject({ view: 'archive', query: 'is:archive react' })

    // Без раздела в запросе — прежнее правило: в любом списке нетронутый поиск снимается.
    useUi.getState().setView('graph')
    actApplySearch(search('react'))
    useUi.getState().setView('library')
    expect(useUi.getState()).toMatchObject({ view: 'library', query: '' })
  })
})

describe('граф: действия', () => {
  async function pair() {
    return [await note('A'), await note('B')] as const
  }

  it('actMoveNode: пишет положение, не меняет запись и молчит', async () => {
    const a = await note('A')
    const before = await getItem(a.id)
    await actMoveNode(a.id, { x: 64, y: -32 })
    expect((await getPositions())[a.id]).toEqual({ x: 64, y: -32 })
    expect(await getItem(a.id)).toEqual(before)
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()

    // Негодная точка и неизвестный запись пропускаются без ошибки.
    await actMoveNode(a.id, { x: Number.NaN, y: 0 })
    await actMoveNode('нет-такой', { x: 1, y: 1 })
    expect(await getPositions()).toEqual({ [a.id]: { x: 64, y: -32 } })
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('actMoveGroup: положения группы одной пачкой, toast со склонением; «Отменить» возвращает прежние', async () => {
    const [a, b] = await pair()
    const c = await note('C')
    await setPositions({ [a.id]: { x: 0, y: 0 }, [b.id]: { x: 48, y: 0 }, [c.id]: { x: 480, y: 480 } })
    const before = await getItem(a.id)
    await actMoveGroup(
      { [a.id]: { x: 96, y: 96 }, [b.id]: { x: 144, y: 96 } },
      { [a.id]: { x: 0, y: 0 }, [b.id]: { x: 48, y: 0 } },
    )
    expect(await getPositions()).toEqual({
      [a.id]: { x: 96, y: 96 }, [b.id]: { x: 144, y: 96 }, [c.id]: { x: 480, y: 480 },
    })
    // положения — не правка записи
    expect(await getItem(a.id)).toEqual(before)
    const { text, options } = lastToast()
    expect(text).toBe('Перемещено 2 записи')
    expect(options?.action?.label).toBe('Отменить')

    options!.action!.onClick()
    await until(async () => (await getPositions())[a.id]?.x === 0)
    expect(await getPositions()).toEqual({
      [a.id]: { x: 0, y: 0 }, [b.id]: { x: 48, y: 0 }, [c.id]: { x: 480, y: 480 },
    })

    // пустая группа — ничего и без toast
    mocks.toast.mockClear()
    await actMoveGroup({}, {})
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('actLinkItems: связывает, toast с «Отменить»; отмена снимает связь', async () => {
    const [a, b] = await pair()
    await actLinkItems(a.id, b.id)
    expect((await getItem(a.id))!.links).toEqual([b.id])
    expect((await getItem(b.id))!.links).toEqual([a.id])
    const { text, options } = lastToast()
    expect(text).toBe('Записи связаны')
    expect(options?.action?.label).toBe('Отменить')

    options!.action!.onClick()
    await until(async () => (await getItem(a.id))!.links.length === 0)
    expect((await getItem(b.id))!.links).toEqual([])
  })

  it('actLinkItems: те же записи и уже связанные', async () => {
    const [a, b] = await pair()
    await actLinkItems(a.id, a.id)
    expect(mocks.toast).not.toHaveBeenCalled()

    await linkItems(a.id, b.id)
    await actLinkItems(b.id, a.id)
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith('Записи уже связаны')
    expect((await getItem(a.id))!.links).toEqual([b.id])
  })

  it('actLinkItems: запись в корзине или неизвестная — toast.error, связи нет', async () => {
    const [a, b] = await pair()
    await deleteItems([b.id])
    await actLinkItems(a.id, b.id)
    await actLinkItems(a.id, 'нет-такой')
    expect(mocks.toastError).toHaveBeenCalledTimes(2)
    expect(mocks.toast).not.toHaveBeenCalled()
    expect((await getItem(a.id))!.links).toEqual([])
  })

  it('actUnlinkItems: снимает связь, отмена возвращает; связи не было — ничего', async () => {
    const [a, b] = await pair()
    await actUnlinkItems(a.id, b.id)
    expect(mocks.toast).not.toHaveBeenCalled()

    await linkItems(a.id, b.id)
    await actUnlinkItems(b.id, a.id)
    expect((await getItem(a.id))!.links).toEqual([])
    expect((await getItem(b.id))!.links).toEqual([])
    const { text, options } = lastToast()
    expect(text).toBe('Связь убрана')

    options!.action!.onClick()
    await until(async () => (await getItem(a.id))!.links.length === 1)
    expect((await getItem(b.id))!.links).toEqual([a.id])
  })

  it('actSetCategory: меняет категорию и сбрасывает место; отмена возвращает категорию и место', async () => {
    const work = await createCategory('Работа')
    const home = await createCategory('Дом')
    const a = await createItem({ type: 'text', content: 'a', categoryId: home.id })
    const b = await createItem({ type: 'text', content: 'b' })
    await setPositions({ [a.id]: { x: 32, y: 64 }, [b.id]: { x: -64, y: 0 } })

    await actSetCategory(a.id, work.id)
    expect((await getItem(a.id))!.categoryId).toBe(work.id)
    expect(await getPositions()).toEqual({ [b.id]: { x: -64, y: 0 } })
    const { text, options } = lastToast()
    expect(text).toBe('Категория: Работа')
    expect(options?.action?.label).toBe('Отменить')

    // Граф успел выдать ноде место в новой зоне: «Отменить» его перекрывает.
    await setPositions({ [a.id]: { x: 999, y: 999 } })
    options!.action!.onClick()
    await until(async () => (await getItem(a.id))!.categoryId === home.id)
    await until(async () => (await getPositions())[a.id]?.x === 32)
    expect(await getPositions()).toEqual({ [a.id]: { x: 32, y: 64 }, [b.id]: { x: -64, y: 0 } })
  })

  it('actSetCategory: несколько записей — число в toast, отмена по группам прежних категорий', async () => {
    const work = await createCategory('Работа')
    const home = await createCategory('Дом')
    const a = await createItem({ type: 'text', content: 'a', categoryId: home.id })
    const b = await createItem({ type: 'text', content: 'b' })
    const c = await createItem({ type: 'text', content: 'c', categoryId: work.id })
    await setPositions({ [a.id]: { x: 1, y: 2 }, [b.id]: { x: 3, y: 4 }, [c.id]: { x: 5, y: 6 } })

    // c уже в «Работе»: не меняется, место не трогается.
    await actSetCategory([a.id, b.id, c.id, a.id], work.id)
    expect(lastToast().text).toBe('Категория: Работа (2)')
    expect(await getPositions()).toEqual({ [c.id]: { x: 5, y: 6 } })

    lastToast().options!.action!.onClick()
    await until(async () => (await getItem(b.id))!.categoryId === null)
    await until(async () => Object.keys(await getPositions()).length === 3)
    expect((await getItem(a.id))!.categoryId).toBe(home.id)
    expect((await getItem(c.id))!.categoryId).toBe(work.id)
    expect(await getPositions()).toEqual({ [a.id]: { x: 1, y: 2 }, [b.id]: { x: 3, y: 4 }, [c.id]: { x: 5, y: 6 } })
  })

  it('actSetCategory: «Без категории»; ничего не изменилось — без toast', async () => {
    const work = await createCategory('Работа')
    const a = await createItem({ type: 'text', content: 'a', categoryId: work.id })
    const b = await createItem({ type: 'text', content: 'b' })

    await actSetCategory(b.id, null)
    await actSetCategory('нет-такой', work.id)
    await actSetCategory([], work.id)
    expect(mocks.toast).not.toHaveBeenCalled()

    await actSetCategory(a.id, null)
    expect((await getItem(a.id))!.categoryId).toBeNull()
    expect(lastToast().text).toBe('Без категории')
  })

  it('actRelayoutGraph: стирает положения, toast на 10 с, отмена возвращает прежние', async () => {
    const a = await note('A')
    const b = await note('B')
    const all = { [a.id]: { x: 32, y: 32 }, [b.id]: { x: -32, y: 0 } }
    await setPositions(all)

    await actRelayoutGraph()
    expect(await getPositions()).toEqual({})
    const { text, options } = lastToast()
    expect(text).toBe('Граф разложен заново')
    expect(options).toMatchObject({ duration: 10_000, action: { label: 'Отменить' } })

    // Граф успел выдать новое место одной ноде: прежнее побеждает.
    await setPositions({ [a.id]: { x: 500, y: 500 } })
    options!.action!.onClick()
    await until(async () => (await getPositions())[a.id]?.x === 32)
    expect(await getPositions()).toEqual(all)
  })

  it('actRelayoutGraph: положений не было — toast без отмены', async () => {
    await note('A')
    await actRelayoutGraph()
    const { text, options } = lastToast()
    expect(text).toBe('Граф разложен заново')
    expect(options?.action).toBeUndefined()
  })
})

describe('сохранённые поиски: экран', () => {
  const search = (query: string): SavedSearch => ({ id: 's', name: 'Поиск', query, order: 0, createdAt: 0 })

  it('actApplySearch: раздел из запроса', () => {
    useUi.getState().setView('inbox')
    useUi.getState().setFilter({ tags: ['old'] })
    actApplySearch(search('is:archive react'))
    expect(useUi.getState()).toMatchObject({ view: 'archive', query: 'is:archive react', filter: {} })

    actApplySearch(search('is:trash is:inbox'))
    expect(useUi.getState().view).toBe('trash')
    actApplySearch(search('is:fav'))
    expect(useUi.getState().view).toBe('favorites')
  })

  it('actApplySearch: без раздела в запросе — текущий; из настроек и корзины — «База знаний»', () => {
    const cases: Array<[View, View]> = [
      ['inbox', 'inbox'],
      ['favorites', 'favorites'],
      ['archive', 'archive'],
      ['settings', 'library'],
      ['trash', 'library'],
    ]
    for (const [from, to] of cases) {
      useUi.getState().setView(from)
      actApplySearch(search('react'))
      expect(useUi.getState().view, from).toBe(to)
      expect(useUi.getState().query).toBe('react')
    }
  })

  it('применённый поиск со своим разделом снимается при переходе в другой раздел (боковая панель, категория)', () => {
    actApplySearch(search('is:library date:week'))
    expect(useUi.getState()).toMatchObject({ view: 'library', query: 'is:library date:week' })
    useUi.getState().setView('inbox')
    expect(useUi.getState()).toMatchObject({ view: 'inbox', query: '' })

    // Как toggleCategory в боковой панели: раздел, затем фильтр.
    actApplySearch(search('is:inbox react'))
    useUi.getState().setView('library')
    useUi.getState().setFilter({ categoryId: 'c' })
    expect(useUi.getState()).toMatchObject({ view: 'library', query: '', filter: { categoryId: 'c' } })

    // openItemInSection в другой раздел — тоже переход: запись видна в списке своего раздела.
    actApplySearch(search('is:archive'))
    openItemInSection({ id: 'x', status: 'inbox' })
    expect(useUi.getState()).toMatchObject({ view: 'inbox', query: '', selectedId: 'x' })
  })

  it('actMoveSearch: сдвиг на одну позицию, края списка и неизвестный id — без изменений', async () => {
    const a = await createSavedSearch('A', 'tag:a')
    const b = await createSavedSearch('B', 'tag:b')
    const c = await createSavedSearch('C', 'tag:c')
    const order = async () => (await listSavedSearches()).map((s) => s.name)

    await actMoveSearch(a.id, -1)
    await actMoveSearch(c.id, 1)
    await actMoveSearch('нет-такого', 1)
    expect(await order()).toEqual(['A', 'B', 'C'])

    await actMoveSearch(a.id, 1)
    expect(await order()).toEqual(['B', 'A', 'C'])
    await actMoveSearch(c.id, -1)
    expect(await order()).toEqual(['B', 'C', 'A'])
    await actMoveSearch(b.id, 1)
    expect(await order()).toEqual(['C', 'B', 'A'])
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('actRenameSearch: успех — true; дубль имени — toast.error и false', async () => {
    const a = await createSavedSearch('A', 'tag:a')
    await createSavedSearch('B', 'tag:b')
    expect(await actRenameSearch(a.id, '  Новое  ')).toBe(true)
    expect((await listSavedSearches()).map((s) => s.name)).toEqual(['Новое', 'B'])

    expect(await actRenameSearch(a.id, 'b')).toBe(false)
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('Поиск «B» уже есть')
    expect(await actRenameSearch(a.id, '   ')).toBe(false)
    expect(mocks.toastError).toHaveBeenLastCalledWith('Название не может быть пустым')
  })

  it('actSaveCurrentSearch: нечего сохранять — toast.error', async () => {
    useUi.getState().setView('library')
    expect(await actSaveCurrentSearch()).toBeUndefined()
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(NOTHING_TO_SAVE)
    expect(NOTHING_TO_SAVE).toBe('Нечего сохранять: задайте поиск или фильтры')
    expect(await listSavedSearches()).toEqual([])
  })

  it('actSaveCurrentSearch: раздел, фильтры и категория; имя по умолчанию — запрос, занятое — с номером', async () => {
    const work = await createCategory('Работа')
    useUi.getState().setView('library')
    useUi.getState().setFilter({ types: ['link'], categoryId: work.id })
    useUi.getState().setQuery('react')

    const first = await actSaveCurrentSearch()
    expect(first).toMatchObject({
      name: 'is:library type:link cat:Работа react',
      query: 'is:library type:link cat:Работа react',
    })
    expect(mocks.toastSuccess).toHaveBeenCalledExactlyOnceWith('Поиск сохранён')

    // Другой запрос, а имя по умолчанию занято (поиск переименован в строку запроса) — с номером.
    await createSavedSearch('is:library type:link cat:Работа react x', 'tag:other')
    useUi.getState().setQuery('react x')
    const second = await actSaveCurrentSearch()
    expect(second?.name).toBe('is:library type:link cat:Работа react x (2)')

    useUi.getState().setQuery('vue')
    const named = await actSaveCurrentSearch('Ссылки по работе')
    expect(named).toMatchObject({ name: 'Ссылки по работе', query: 'is:library type:link cat:Работа vue' })
  })

  it('actSaveCurrentSearch: тот же запрос уже сохранён — сообщение и без второго поиска (с именем и без)', async () => {
    useUi.getState().setView('inbox')
    useUi.getState().setQuery('react')
    const first = await actSaveCurrentSearch()
    expect(first?.query).toBe('is:inbox react')
    mocks.toast.mockClear()
    expect(await actRenameSearch(first!.id, 'Мой React')).toBe(true)

    expect(await actSaveCurrentSearch()).toBeUndefined()
    expect(lastToast()).toEqual({ text: 'Уже сохранён как «Мой React»', options: undefined })
    expect(await actSaveCurrentSearch('Другое имя')).toBeUndefined()
    expect(mocks.toast).toHaveBeenCalledTimes(2)
    expect(mocks.toastSuccess).toHaveBeenCalledTimes(1)
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect((await listSavedSearches()).map((s) => s.query)).toEqual(['is:inbox react'])

    // После применения сохранённого поиска (палитра: «Сохранить текущий поиск») — то же.
    actApplySearch(first!)
    expect(await actSaveCurrentSearch()).toBeUndefined()
    expect(await listSavedSearches()).toHaveLength(1)
  })

  it('actSaveCurrentSearch: быстрый период — относительным оператором, свой — датами', async () => {
    const week = relativeRange('week', Date.now())
    useUi.getState().setView('inbox')
    useUi.getState().setDateRange(week)
    expect((await actSaveCurrentSearch('Быстрый'))?.query).toBe('is:inbox date:week')

    useUi.getState().setDateRange(week, true)
    expect((await actSaveCurrentSearch('Свой'))?.query).toMatch(
      /^is:inbox date:\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/,
    )
  })

  it('actSaveCurrentSearch: в корзине is:trash сохраняется и при своём статусе', async () => {
    useUi.getState().setView('trash')
    useUi.getState().setQuery('is:inbox')
    expect((await actSaveCurrentSearch())?.query).toBe('is:trash is:inbox')
  })
})

describe('actDownloadMarkdown', () => {
  type FakeAnchor = { href: string; download: string; rel: string; click: () => void; remove: () => void }

  /** saveBlob создаёт <a download> и щёлкает по нему: в node подменяются document и URL. */
  function captureDownloads() {
    const anchors: FakeAnchor[] = []
    vi.stubGlobal('document', {
      createElement: () => {
        const a: FakeAnchor = { href: '', download: '', rel: '', click: vi.fn(), remove: vi.fn() }
        anchors.push(a)
        return a
      },
      body: { appendChild: vi.fn() },
    })
    const blobs: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob)
      return `blob:test-${blobs.length}`
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    return { anchors, blobs }
  }

  it('одна запись файлом .md: имя по заголовку, категория, вики-ссылки на имена плана', async () => {
    const work = await createCategory('Работа')
    const alpha = await note('Альфа')
    const item = await createItem({ type: 'text', content: '# Мой план\nсм. [[альфа|первая]]', categoryId: work.id })
    mocks.allSnapshot.mockReturnValue([alpha, item])
    const { anchors, blobs } = captureDownloads()

    await actDownloadMarkdown(item)
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect(anchors).toHaveLength(1)
    expect(anchors[0].download).toBe('Мой план.md')
    expect(anchors[0].click).toHaveBeenCalledTimes(1)
    expect(blobs[0].type).toBe('text/markdown;charset=utf-8')
    const text = await blobs[0].text()
    expect(text).toContain('category: "Работа"')
    expect(text).toContain('см. [[Альфа|первая]]')
  })

  it('без снимка и вне снимка запись всё равно выгружается', async () => {
    const item = await createItem({ type: 'idea', content: 'Идея' })
    const { anchors } = captureDownloads()
    await actDownloadMarkdown(item)
    expect(anchors[0]?.download).toBe('Идея.md')

    mocks.allSnapshot.mockReturnValue([await note('Другое')])
    await actDownloadMarkdown(item)
    expect(anchors[1]?.download).toBe('Идея.md')
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('ошибка — toast.error, наружу не бросает', async () => {
    const item = await createItem({ type: 'text', content: 'x' })
    vi.spyOn(db.categories, 'orderBy').mockImplementation(() => {
      throw new Error('база недоступна')
    })
    const { anchors } = captureDownloads()
    await expect(actDownloadMarkdown(item)).resolves.toBeUndefined()
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('база недоступна')
    expect(anchors).toHaveLength(0)
  })
})
