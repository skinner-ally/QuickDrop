import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/db'
import { createItem, deleteItems, getItem, restoreItems, updateItem } from '@/db/repo'
import type { LinkMeta } from '@/types'
import { createAndEnrich, isLinkMetaLoading, refreshLinkMeta } from './actions'

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  fetchLinkMeta: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { error: mocks.toastError, success: vi.fn() }),
}))
vi.mock('@/lib/linkMeta', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/linkMeta')>()),
  fetchLinkMeta: mocks.fetchLinkMeta,
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

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.files.clear(), db.categories.clear(), db.meta.clear()])
  mocks.fetchLinkMeta.mockReset()
  mocks.toastError.mockReset()
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
    // ответ пришёл, пока записи не было, — записать его некуда
    expect(await getItem(item.id)).toBeUndefined()
    await restoreItems(snaps)
    expect(await metaOf(item.id)).toEqual({ status: 'failed' })
  })

  it('без автозагрузки заголовков ссылка создаётся без запроса', async () => {
    await db.meta.put({ key: 'autoFetchLinkTitle', value: false })
    const item = await createAndEnrich({ type: 'link', url: 'https://g.example' })
    expect(mocks.fetchLinkMeta).not.toHaveBeenCalled()
    expect(await metaOf(item.id)).toBeUndefined()
  })
})
