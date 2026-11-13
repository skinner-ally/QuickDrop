import { afterEach, describe, expect, it, vi } from 'vitest'
import { VISION_MAX_SIDE, VISION_PDF_MAX_PAGES } from './ocrState'
import { PDF_OPEN_TIMEOUT_MS, PDF_PAGE_TIMEOUT_MS, openPdfPages } from './pdfRender'
import { PDF_MAX_BYTES } from './pdfText'
import type { PdfDocLike, PdfEngine } from './pdfText'

interface FakeOptions {
  numPages?: number
  open?: () => Promise<void>
  pageImage?: ((page: number, maxSide: number) => Promise<Blob>) | null
}

function fakeEngine(fake: FakeOptions = {}) {
  const calls = { open: 0, close: 0, images: [] as Array<[number, number]> }
  const engine = async (): Promise<PdfEngine> => ({
    async open(): Promise<PdfDocLike> {
      calls.open++
      await fake.open?.()
      const doc: PdfDocLike = {
        numPages: fake.numPages ?? 3,
        pageText: async () => '',
        async close() {
          calls.close++
        },
      }
      if (fake.pageImage !== null) {
        doc.pageImage = async (page, maxSide) => {
          calls.images.push([page, maxSide])
          return fake.pageImage ? fake.pageImage(page, maxSide) : new Blob([`page-${page}`], { type: 'image/jpeg' })
        }
      }
      return doc
    },
  })
  return { engine, calls }
}

const pdf = () => new Blob(['%PDF-1.7 подделка'], { type: 'application/pdf' })
const never = <T>(): Promise<T> => new Promise<T>(() => {})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('openPdfPages', () => {
  it('первые 5 страниц по одной, по запросу; close один раз', async () => {
    const { engine, calls } = fakeEngine({ numPages: 12 })
    const out = await openPdfPages(pdf(), { engine })
    if (out.status !== 'ok') throw new Error(`ожидался ok: ${JSON.stringify(out)}`)
    expect(out.doc.total).toBe(12)
    expect(out.doc.count).toBe(VISION_PDF_MAX_PAGES)
    expect(calls.images).toEqual([])

    const blob = await out.doc.page(2)
    expect(await blob.text()).toBe('page-2')
    expect(calls.images).toEqual([[2, VISION_MAX_SIDE]])

    await out.doc.close()
    await out.doc.close()
    expect(calls.close).toBe(1)
    await expect(out.doc.page(1)).rejects.toThrow('Не удалось подготовить страницу PDF')
  })

  it('maxPages и короткий документ', async () => {
    const short = fakeEngine({ numPages: 2 })
    const a = await openPdfPages(pdf(), { engine: short.engine })
    expect(a).toMatchObject({ status: 'ok', doc: { total: 2, count: 2 } })

    const long = fakeEngine({ numPages: 9 })
    const b = await openPdfPages(pdf(), { engine: long.engine, maxPages: 3 })
    expect(b).toMatchObject({ status: 'ok', doc: { total: 9, count: 3 } })
    if (b.status !== 'ok') return
    await expect(b.doc.page(4)).rejects.toThrow('Не удалось подготовить страницу PDF')
    await expect(b.doc.page(0)).rejects.toThrow('Не удалось подготовить страницу PDF')
    expect(long.calls.images).toEqual([])
  })

  it('больше 50 МБ — неустранимо, движок не загружается', async () => {
    const { engine, calls } = fakeEngine()
    const big = { size: PDF_MAX_BYTES + 1, type: 'application/pdf' } as Blob
    expect(await openPdfPages(big, { engine })).toEqual({
      status: 'failed',
      error: 'PDF больше 50 МБ — текст не извлекается',
      permanent: true,
    })
    expect(calls.open).toBe(0)
  })

  it('пароль и битый файл — неустранимо; прочий сбой движка — временно', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const throwing = (e: unknown) => fakeEngine({ open: async () => Promise.reject(e) }).engine
    expect(await openPdfPages(pdf(), { engine: throwing({ name: 'PasswordException' }) })).toEqual({
      status: 'failed',
      error: 'PDF защищён паролем',
      permanent: true,
    })
    expect(await openPdfPages(pdf(), { engine: throwing({ name: 'InvalidPDFException' }) })).toEqual({
      status: 'failed',
      error: 'Не удалось прочитать PDF',
      permanent: true,
    })
    expect(await openPdfPages(pdf(), { engine: throwing(new Error('worker упал')) })).toEqual({
      status: 'failed',
      error: 'Не удалось прочитать PDF',
    })
    expect(
      await openPdfPages(pdf(), {
        engine: async () => {
          throw new Error('нет pdf.js')
        },
      }),
    ).toEqual({ status: 'failed', error: 'Не удалось прочитать PDF' })
  })

  it('движок без растеризации — временная ошибка, документ закрыт', async () => {
    const { engine, calls } = fakeEngine({ pageImage: null })
    expect(await openPdfPages(pdf(), { engine })).toEqual({
      status: 'failed',
      error: 'Не удалось подготовить страницы PDF',
    })
    expect(calls.close).toBe(1)
  })

  it('прерывание: до начала — без движка; во время открытия — aborted, поздний документ закрыт', async () => {
    const before = fakeEngine()
    const ctrl = new AbortController()
    ctrl.abort()
    expect(await openPdfPages(pdf(), { engine: before.engine, signal: ctrl.signal })).toEqual({ status: 'aborted' })
    expect(before.calls.open).toBe(0)

    let release!: () => void
    const slow = fakeEngine({ open: () => new Promise<void>((r) => (release = r)) })
    const ctrl2 = new AbortController()
    const opening = openPdfPages(pdf(), { engine: slow.engine, signal: ctrl2.signal })
    await vi.waitFor(() => expect(slow.calls.open).toBe(1))
    ctrl2.abort()
    expect(await opening).toEqual({ status: 'aborted' })
    release()
    await vi.waitFor(() => expect(slow.calls.close).toBe(1))
  })

  it('открытие дольше 30 с (как у текстового слоя) — временная ошибка', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { engine } = fakeEngine({ open: () => never() })
    const opening = openPdfPages(pdf(), { engine })
    let settled = false
    void opening.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(PDF_PAGE_TIMEOUT_MS + 1_000)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(PDF_OPEN_TIMEOUT_MS - PDF_PAGE_TIMEOUT_MS)
    expect(await opening).toEqual({ status: 'failed', error: 'Не удалось открыть PDF за отведённое время' })
  })

  it('страница дольше 20 с — отказ с текстом; прерывание страницы — AbortError', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const { engine } = fakeEngine({ pageImage: () => never() })
    const ctrl = new AbortController()
    const out = await openPdfPages(pdf(), { engine, signal: ctrl.signal })
    if (out.status !== 'ok') throw new Error('ожидался ok')

    const slow = out.doc.page(1)
    const timedOut = expect(slow).rejects.toThrow('Не удалось подготовить страницу PDF за отведённое время')
    await vi.advanceTimersByTimeAsync(PDF_PAGE_TIMEOUT_MS)
    await timedOut

    const aborted = out.doc.page(2)
    const check = expect(aborted).rejects.toMatchObject({ name: 'AbortError' })
    ctrl.abort()
    await check
    await out.doc.close()
  })

  it('сбой растеризации и пустая картинка — отказ с русским текстом', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let n = 0
    const { engine } = fakeEngine({
      pageImage: async () => {
        if (++n === 1) throw new Error('canvas')
        return new Blob([], { type: 'image/jpeg' })
      },
    })
    const out = await openPdfPages(pdf(), { engine })
    if (out.status !== 'ok') throw new Error('ожидался ok')
    await expect(out.doc.page(1)).rejects.toThrow('Не удалось подготовить страницу PDF')
    await expect(out.doc.page(2)).rejects.toThrow('Не удалось подготовить страницу PDF')
  })

  it('документ без страниц — неустранимо, закрыт', async () => {
    const { engine, calls } = fakeEngine({ numPages: 0 })
    expect(await openPdfPages(pdf(), { engine })).toEqual({ status: 'failed', error: 'В PDF нет страниц', permanent: true })
    expect(calls.close).toBe(1)
  })
})
