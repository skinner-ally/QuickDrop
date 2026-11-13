import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/db'
import { clearOcrText, createItem, deleteItems, getItem, purgeItems, setStatus, setVisionText } from '@/db/repo'
import { setSetting, setSettings } from '@/db/settings'
import { VisionError } from '@/lib/ai'
import type { VisionReply } from '@/lib/ai'
import {
  VISION_AUTO_COOLDOWN_MS,
  VISION_AUTO_FAIL_STREAK,
  VISION_AUTO_INTERVAL_MS,
  VISION_AUTO_SESSION_LIMIT,
  VISION_BACKLOG_BATCH,
  VISION_RATE_PAUSE_MS,
  getOcrJob,
  resetOcrState,
  subscribeOcr,
} from '@/lib/ocrState'
import type { OcrJob } from '@/lib/ocrState'
import type { PdfPagesResult } from '@/lib/pdfRender'
import type { PdfTextResult } from '@/lib/pdfText'
import type { PreparedImage } from '@/lib/visionImage'
import { useUi } from '@/store/ui'
import type { Item, Settings } from '@/types'
import {
  BACKFILL_PDF_LIMIT,
  VISION_AUTO_START_DELAY_MS,
  backfillPdfText,
  drainPdfBackfill,
  drainVisionBacklog,
  extractItemText,
  resetOcrSession,
  startVisionAuto,
  textSourceOf,
} from './ocr'

const mocks = vi.hoisted(() => ({
  extractPdfText: vi.fn(),
  recognizeImage: vi.fn<(image: Blob, settings: Settings, signal?: AbortSignal) => Promise<VisionReply>>(),
  prepareVisionImage: vi.fn<(blob: Blob) => Promise<PreparedImage>>(),
  openPdfPages: vi.fn<(data: Blob, options?: { signal?: AbortSignal }) => Promise<PdfPagesResult>>(),
  toast: vi.fn(),
  toastError: vi.fn(),
  capture: false,
}))

// Настоящий разбор PDF (pdfjs-dist, worker) в тестах не загружается; isPdf — настоящий.
vi.mock('@/lib/pdfText', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pdfText')>()),
  extractPdfText: mocks.extractPdfText,
}))
// Запрос к ИИ подменён; visionAvailability и VisionError — настоящие.
vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai')>()),
  recognizeImage: mocks.recognizeImage,
}))
vi.mock('@/lib/visionImage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/visionImage')>()),
  prepareVisionImage: mocks.prepareVisionImage,
}))
vi.mock('@/lib/pdfRender', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pdfRender')>()),
  openPdfPages: mocks.openPdfPages,
}))
vi.mock('sonner', () => ({ toast: Object.assign(mocks.toast, { error: mocks.toastError }) }))
vi.mock('@/lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/platform')>()),
  isCaptureWindow: () => mocks.capture,
}))

const LAYER_OK = { status: 'ok', via: 'text-layer' }
const LAYER_EMPTY = { status: 'empty', via: 'text-layer' }

const result = (status: PdfTextResult['status'], text = '', error?: string): PdfTextResult => ({
  status,
  text,
  pages: 3,
  readPages: 3,
  truncated: false,
  ...(error ? { error } : {}),
})

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

let seq = 0
const pdfItem = (name = `doc-${++seq}.pdf`) =>
  createItem({ type: 'file', file: new File([`%PDF-1.7 ${name}`], name, { type: 'application/pdf' }) })
const fresh = async (id: string) => (await getItem(id))!
/** Картинка; содержимое файла — её имя (по нему подделки различают записи). */
const imageItem = (name = `pic-${++seq}.png`) =>
  createItem({ type: 'image', file: new File([name], name, { type: 'image/png' }) })

beforeEach(async () => {
  await Promise.all([
    db.items.clear(),
    db.files.clear(),
    db.categories.clear(),
    db.meta.clear(),
    db.positions.clear(),
    db.searches.clear(),
  ])
  mocks.extractPdfText.mockReset()
  mocks.recognizeImage.mockReset()
  mocks.prepareVisionImage.mockReset()
  mocks.openPdfPages.mockReset()
  mocks.toast.mockReset()
  mocks.toastError.mockReset()
  mocks.capture = false
  resetOcrSession()
  resetOcrState()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('textSourceOf', () => {
  it('PDF — по типу или расширению файла, картинка — по типу записи; без файла — ничего', () => {
    expect(textSourceOf({ type: 'file', fileId: 'f', mimeType: 'application/pdf', fileName: 'a' })).toBe('pdf')
    expect(textSourceOf({ type: 'file', fileId: 'f', mimeType: 'application/octet-stream', fileName: 'A.PDF' })).toBe('pdf')
    expect(textSourceOf({ type: 'image', fileId: 'f', mimeType: 'image/png', fileName: 'a.png' })).toBe('image')
    expect(textSourceOf({ type: 'file', fileId: 'f', mimeType: 'text/plain', fileName: 'a.txt' })).toBeNull()
    expect(textSourceOf({ type: 'file', mimeType: 'application/pdf', fileName: 'a.pdf' })).toBeNull()
    expect(textSourceOf({ type: 'image', mimeType: 'image/png' })).toBeNull()
    expect(textSourceOf({ type: 'text' })).toBeNull()
    expect(textSourceOf({ type: 'link', fileName: 'a.pdf' })).toBeNull()
  })
})

describe('extractItemText', () => {
  it('PDF: текст записывается в запись, updatedAt не меняется', async () => {
    mocks.extractPdfText.mockResolvedValue(result('ok', 'Первая страница\n\nВторая страница'))
    const item = await pdfItem()
    const ctrl = new AbortController()
    expect(await extractItemText(item, { signal: ctrl.signal })).toEqual(LAYER_OK)

    const after = await fresh(item.id)
    expect(after.ocrText).toBe('Первая страница\n\nВторая страница')
    expect(after.ocrAt).toBeTypeOf('number')
    expect(after.updatedAt).toBe(item.updatedAt)
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(1)
    const [blob, options] = mocks.extractPdfText.mock.calls[0] as [Blob, { signal?: AbortSignal }]
    expect(blob.size).toBe(item.fileSize)
    // Сигнал вызывающего связан со своим сигналом задачи (её можно отменить и из подробностей).
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(options.signal!.aborted).toBe(false)
  })

  it('PDF: длинный файл — сколько страниц прочитано; текст обрезан пределом — truncated', async () => {
    mocks.extractPdfText.mockResolvedValueOnce({ ...result('ok', 'начало'), pages: 300, readPages: 200, truncated: true })
    const long = await pdfItem()
    expect(await extractItemText(long)).toEqual({ ...LAYER_OK, pages: { read: 200, total: 300 } })

    mocks.extractPdfText.mockResolvedValueOnce({ ...result('ok', 'начало'), truncated: true })
    const dense = await pdfItem()
    expect(await extractItemText(dense)).toEqual({ ...LAYER_OK, truncated: true })
  })

  it('повтор без force пропускается, с force — извлекает заново', async () => {
    mocks.extractPdfText.mockResolvedValue(result('ok', 'первый раз'))
    const item = await pdfItem()
    await extractItemText(item)
    const done = await fresh(item.id)

    expect(await extractItemText(done)).toEqual({ status: 'skipped' })
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(1)

    mocks.extractPdfText.mockResolvedValue(result('ok', 'второй раз'))
    expect(await extractItemText(done, { force: true })).toEqual(LAYER_OK)
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(2)
    expect((await fresh(item.id)).ocrText).toBe('второй раз')
  })

  it('PDF без текстового слоя: отметка «пробовали» ставится, текста нет', async () => {
    mocks.extractPdfText.mockResolvedValue(result('empty'))
    const item = await pdfItem()
    expect(await extractItemText(item)).toEqual(LAYER_EMPTY)
    const after = await fresh(item.id)
    expect(after.ocrAt).toBeTypeOf('number')
    expect(after.ocrText).toBeUndefined()
    expect(Object.hasOwn(after, 'ocrText')).toBe(false)
    // автоизвлечение не повторяется
    expect(await extractItemText(after)).toEqual({ status: 'skipped' })
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(1)
  })

  it('временный failed и прерывание не ставят ocrAt — можно повторить', async () => {
    const item = await pdfItem()
    const timeout = 'Не удалось прочитать PDF за отведённое время'
    mocks.extractPdfText.mockResolvedValueOnce(result('failed', '', timeout))
    expect(await extractItemText(item)).toEqual({ status: 'failed', error: timeout })
    expect((await fresh(item.id)).ocrAt).toBeUndefined()

    mocks.extractPdfText.mockResolvedValueOnce(result('aborted'))
    expect(await extractItemText(item)).toEqual({ status: 'skipped' })
    expect((await fresh(item.id)).ocrAt).toBeUndefined()

    mocks.extractPdfText.mockResolvedValueOnce(result('ok', 'со второй попытки'))
    expect(await extractItemText(await fresh(item.id))).toEqual(LAYER_OK)
    expect((await fresh(item.id)).ocrText).toBe('со второй попытки')
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(3)
  })

  it('не бросает: нет файла, сбой чтения, исключение разбора — failed с текстом', async () => {
    const item = await pdfItem()
    mocks.extractPdfText.mockRejectedValueOnce(new Error('внутренний сбой'))
    expect(await extractItemText(item)).toEqual({ status: 'failed', error: 'внутренний сбой' })

    vi.spyOn(db.files, 'get').mockRejectedValueOnce(new Error('база недоступна'))
    expect(await extractItemText(item)).toEqual({ status: 'failed', error: 'база недоступна' })

    // сбои выше временные: отметки нет
    expect((await fresh(item.id)).ocrAt).toBeUndefined()

    // файла нет — повтор ничего не даст: отметка «пробовали» без текста
    await db.files.clear()
    expect(await extractItemText(item)).toEqual({ status: 'failed', error: 'Файл не найден' })
    const after = await fresh(item.id)
    expect(after.ocrAt).toBeTypeOf('number')
    expect(after.ocrText).toBeUndefined()
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(1)
  })

  it('неустранимый failed (пароль, битый файл, больше предела): отметка без текста, повтор — только с force', async () => {
    const item = await pdfItem()
    const locked = { ...result('failed', '', 'PDF защищён паролем'), permanent: true as const }
    mocks.extractPdfText.mockResolvedValue(locked)
    expect(await extractItemText(item)).toEqual({ status: 'failed', error: 'PDF защищён паролем' })
    const after = await fresh(item.id)
    expect(after.ocrAt).toBeTypeOf('number')
    expect(after.ocrText).toBeUndefined()
    expect(after.updatedAt).toBe(item.updatedAt)

    expect(await extractItemText(after)).toEqual({ status: 'skipped' })
    expect(await backfillPdfText()).toBe(0)
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(1)

    expect(await extractItemText(after, { force: true })).toEqual({ status: 'failed', error: 'PDF защищён паролем' })
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(2)
  })

  it('неустранимый failed при повторе с force не затирает уже извлечённый текст', async () => {
    mocks.extractPdfText.mockResolvedValueOnce(result('ok', 'извлечено раньше'))
    const item = await pdfItem()
    await extractItemText(item)
    const done = await fresh(item.id)
    mocks.extractPdfText.mockResolvedValueOnce({ ...result('failed', '', 'Не удалось прочитать PDF'), permanent: true })
    expect(await extractItemText(done, { force: true })).toMatchObject({ status: 'failed' })
    const after = await fresh(item.id)
    expect(after.ocrText).toBe('извлечено раньше')
    expect(after.ocrAt).toBe(done.ocrAt)
  })

  it('записи без вложения пропускаются; картинка без vision — тоже; PDF со слоем при vision — как обычно', async () => {
    const text = await createItem({ type: 'text', content: 'заметка' })
    const image = await imageItem()
    expect(await extractItemText(text)).toEqual({ status: 'skipped' })
    expect(await extractItemText(image, { force: true })).toEqual({ status: 'skipped' })
    expect(mocks.extractPdfText).not.toHaveBeenCalled()
    expect(mocks.prepareVisionImage).not.toHaveBeenCalled()
    expect((await fresh(image.id)).ocrAt).toBeUndefined()

    // скан без зрения: «текста нет»
    mocks.extractPdfText.mockResolvedValue(result('empty'))
    const scan = await pdfItem()
    expect(await extractItemText(scan)).toEqual(LAYER_EMPTY)
    expect((await fresh(scan.id)).ocrText).toBeUndefined()

    // PDF с текстовым слоем при vision читается как обычно
    mocks.extractPdfText.mockResolvedValue(result('ok', 'есть текст'))
    const plain = await pdfItem()
    expect(await extractItemText(plain, { vision: true })).toEqual(LAYER_OK)
    expect((await fresh(plain.id)).ocrText).toBe('есть текст')
    expect(mocks.openPdfPages).not.toHaveBeenCalled()
  })

  it('запись в корзине не обрабатывается; исчезнувшая за время разбора — skipped', async () => {
    mocks.extractPdfText.mockResolvedValue(result('ok', 'текст'))
    const inTrash = await pdfItem()
    await deleteItems([inTrash.id])
    // устаревший объект без deletedAt: запись перечитывается перед работой
    expect(await extractItemText(inTrash, { force: true })).toEqual({ status: 'skipped' })
    expect(await extractItemText(await fresh(inTrash.id), { force: true })).toEqual({ status: 'skipped' })
    expect(mocks.extractPdfText).not.toHaveBeenCalled()
    expect((await fresh(inTrash.id)).ocrAt).toBeUndefined()
    mocks.extractPdfText.mockClear()

    const slow = deferred<PdfTextResult>()
    mocks.extractPdfText.mockReturnValue(slow.promise)
    const gone = await pdfItem()
    const run = extractItemText(gone)
    await vi.waitFor(() => expect(mocks.extractPdfText).toHaveBeenCalledTimes(1))
    await purgeItems(gone.id)
    slow.resolve(result('ok', 'поздно'))
    expect(await run).toEqual({ status: 'skipped' })
    expect(await getItem(gone.id)).toBeUndefined()
  })

  it('разные записи разбираются по одному, в порядке вызова; сбой не останавливает очередь', async () => {
    let active = 0
    let maxActive = 0
    const order: string[] = []
    mocks.extractPdfText.mockImplementation(async (blob: Blob) => {
      maxActive = Math.max(maxActive, ++active)
      const name = (await blob.text()).replace('%PDF-1.7 ', '')
      order.push(name)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return name.startsWith('bad') ? result('failed', '', 'Не удалось прочитать PDF') : result('ok', `текст ${name}`)
    })
    const names = ['q1.pdf', 'bad-q2.pdf', 'q3.pdf', 'q4.pdf', 'q5.pdf']
    const items: Item[] = []
    for (const name of names) items.push(await pdfItem(name))

    const outcomes = await Promise.all(items.map((it) => extractItemText(it)))
    expect(maxActive).toBe(1)
    expect(order).toEqual(names)
    expect(outcomes.map((o) => o.status)).toEqual(['ok', 'failed', 'ok', 'ok', 'ok'])
    expect((await fresh(items[4].id)).ocrText).toBe('текст q5.pdf')
  })

  it('ожидание очереди: повторный вызов по той же записи — тот же разбор; прерванная задача не запускается', async () => {
    const slow = deferred<PdfTextResult>()
    mocks.extractPdfText.mockReturnValueOnce(slow.promise)
    const first = await pdfItem()
    const second = await pdfItem()
    const third = await pdfItem()

    const busy = extractItemText(first)
    const waiting = extractItemText(second)
    expect(extractItemText(second)).toBe(waiting)
    const ctrl = new AbortController()
    const cancelled = extractItemText(third, { signal: ctrl.signal })
    await vi.waitFor(() => expect(mocks.extractPdfText).toHaveBeenCalledTimes(1))
    ctrl.abort()

    mocks.extractPdfText.mockResolvedValue(result('ok', 'текст'))
    slow.resolve(result('ok', 'первый'))
    expect(await busy).toEqual(LAYER_OK)
    expect(await waiting).toEqual(LAYER_OK)
    expect(await cancelled).toEqual({ status: 'skipped' })
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(2)
    expect((await fresh(third.id)).ocrAt).toBeUndefined()
  })

  it('одновременные вызовы для одной записи разбирают файл один раз', async () => {
    const slow = deferred<PdfTextResult>()
    mocks.extractPdfText.mockReturnValue(slow.promise)
    const item = await pdfItem()
    const first = extractItemText(item)
    const second = extractItemText(item)
    slow.resolve(result('ok', 'один раз'))
    expect(await Promise.all([first, second])).toEqual([LAYER_OK, LAYER_OK])
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(1)

    // после завершения запись снова можно разобрать по требованию
    mocks.extractPdfText.mockResolvedValue(result('ok', 'ещё раз'))
    expect(await extractItemText(item, { force: true })).toEqual(LAYER_OK)
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(2)
  })
})

describe('backfillPdfText', () => {
  const pendingIds = async () =>
    (await db.items.toArray())
      .filter((it: Item) => textSourceOf(it) === 'pdf' && it.ocrAt === undefined)
      .map((it) => it.id)

  it('соблюдает limit и обрабатывает по одной', async () => {
    let active = 0
    let maxActive = 0
    mocks.extractPdfText.mockImplementation(async () => {
      maxActive = Math.max(maxActive, ++active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return result('ok', 'текст из файла')
    })
    for (let i = 0; i < 5; i++) await pdfItem()

    expect(await backfillPdfText(2)).toBe(2)
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(2)
    expect(await pendingIds()).toHaveLength(3)

    expect(await backfillPdfText(2)).toBe(2)
    expect(await backfillPdfText(2)).toBe(1)
    expect(await backfillPdfText(2)).toBe(0)
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(5)
    expect(maxActive).toBe(1)
    expect(await pendingIds()).toEqual([])
  })

  it('по умолчанию — не больше 10 за вызов', async () => {
    expect(BACKFILL_PDF_LIMIT).toBe(10)
    mocks.extractPdfText.mockResolvedValue(result('ok', 'текст из файла'))
    for (let i = 0; i < 12; i++) await pdfItem()
    expect(await backfillPdfText()).toBe(10)
    expect(await backfillPdfText()).toBe(2)
  })

  it('пропускает корзину, не-PDF и уже обработанное; архив обрабатывает', async () => {
    mocks.extractPdfText.mockResolvedValue(result('ok', 'текст'))
    const inTrash = await pdfItem()
    await deleteItems([inTrash.id])
    const archived = await pdfItem()
    await setStatus(archived.id, 'archive')
    const done = await pdfItem()
    await extractItemText(done)
    await createItem({ type: 'text', content: 'заметка' })
    await createItem({ type: 'file', file: new File(['x'], 'notes.txt', { type: 'text/plain' }) })
    const plain = await pdfItem()
    mocks.extractPdfText.mockClear()

    expect(await backfillPdfText()).toBe(2)
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(2)
    expect((await fresh(archived.id)).ocrText).toBe('текст')
    expect((await fresh(plain.id)).ocrText).toBe('текст')
    expect((await fresh(inTrash.id)).ocrAt).toBeUndefined()
    expect(await backfillPdfText()).toBe(0)
  })

  it('считает только обработанные: сбой не засчитывается и ocrAt не ставит', async () => {
    // имена разной длины — файлы различимы по размеру
    const bad = await pdfItem('broken-file.pdf')
    const scan = await pdfItem('scan.pdf')
    expect(bad.fileSize).not.toBe(scan.fileSize)
    mocks.extractPdfText.mockImplementation(async (blob: Blob) =>
      blob.size === bad.fileSize ? result('failed', '', 'Не удалось прочитать PDF') : result('empty'),
    )
    expect(await backfillPdfText()).toBe(1)
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(2)
    expect((await fresh(bad.id)).ocrAt).toBeUndefined()
    expect((await fresh(scan.id)).ocrAt).toBeTypeOf('number')
  })

  /** Подмена разбора по имени файла: bad* — неустранимый сбой, flaky* — временный, остальное — текст. */
  const byName = () =>
    mocks.extractPdfText.mockImplementation(async (blob: Blob) => {
      const name = await blob.text()
      if (name.includes('bad')) return { ...result('failed', '', 'PDF защищён паролем'), permanent: true as const }
      if (name.includes('flaky')) return result('failed', '', 'Не удалось прочитать PDF за отведённое время')
      return result('ok', 'текст из файла')
    })
  const extractedNames = async () =>
    Promise.all(mocks.extractPdfText.mock.calls.map(([blob]) => (blob as Blob).text()))

  it('неустранимо негодные PDF не занимают очередь: годный за ними обрабатывается, негодные не разбираются снова', async () => {
    byName()
    for (let i = 0; i < 12; i++) await pdfItem(`bad-${i}.pdf`)
    const good = await pdfItem('good.pdf')

    await backfillPdfText()
    await backfillPdfText()
    expect((await fresh(good.id)).ocrText).toBe('текст из файла')
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(13)

    expect(await backfillPdfText()).toBe(0)
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(13)
    expect(await pendingIds()).toEqual([])
  })

  it('временные сбои: не больше limit за вызов, в этом сеансе не повторяются, годные доходят', async () => {
    byName()
    for (let i = 0; i < 12; i++) await pdfItem(`flaky-${i}.pdf`)
    const good: Item[] = []
    for (let i = 0; i < 3; i++) good.push(await pdfItem(`good-${i}.pdf`))

    let done = 0
    for (let call = 0; call < 3; call++) {
      const before = mocks.extractPdfText.mock.calls.length
      done += await backfillPdfText()
      const flaky = (await extractedNames()).slice(before).filter((n) => n.includes('flaky'))
      expect(flaky.length).toBeLessThanOrEqual(BACKFILL_PDF_LIMIT)
    }
    expect(done).toBe(3)
    for (const item of good) expect((await fresh(item.id)).ocrAt).toBeTypeOf('number')

    const names = await extractedNames()
    expect(names.filter((n) => n.includes('flaky'))).toHaveLength(12)
    expect(new Set(names).size).toBe(names.length)
    // ocrAt у временно негодных нет: после перезапуска их можно попробовать снова
    expect(await pendingIds()).toHaveLength(12)

    mocks.extractPdfText.mockClear()
    expect(await backfillPdfText()).toBe(0)
    expect(mocks.extractPdfText).not.toHaveBeenCalled()
  })

  it('drainPdfBackfill проходит все PDF порциями и завершается при негодных', async () => {
    byName()
    const good: Item[] = []
    for (let i = 0; i < 23; i++) good.push(await pdfItem(`good-${i}.pdf`))
    for (let i = 0; i < 3; i++) await pdfItem(`flaky-${i}.pdf`)
    await pdfItem('bad.pdf')

    expect(await drainPdfBackfill(0)).toBe(23)
    for (const item of good) expect((await fresh(item.id)).ocrAt).toBeTypeOf('number')
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(27)

    mocks.extractPdfText.mockClear()
    expect(await drainPdfBackfill(0)).toBe(0)
    expect(mocks.extractPdfText).not.toHaveBeenCalled()
  })

  it('негодный limit и ошибка базы — 0, наружу не бросает', async () => {
    mocks.extractPdfText.mockResolvedValue(result('ok', 'текст'))
    await pdfItem()
    expect(await backfillPdfText(0)).toBe(0)
    expect(await backfillPdfText(-3)).toBe(0)
    expect(await backfillPdfText(Number.NaN)).toBe(0)
    expect(mocks.extractPdfText).not.toHaveBeenCalled()

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(db.items, 'filter').mockImplementationOnce(() => {
      throw new Error('база недоступна')
    })
    await expect(backfillPdfText()).resolves.toBe(0)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

// ───────────────────────── распознавание зрением ─────────────────────────

const AI: Partial<Settings> = {
  aiEnabled: true,
  aiApiKey: 'sk-test',
  aiBaseUrl: 'https://api.example.com/v1',
  aiModel: 'vision-model',
}
const enableAi = (patch: Partial<Settings> = {}) => setSettings({ ...AI, ...patch })
/** Автораспознавание включено «давно»: все записи теста созданы после aiAutoOcrSince. */
const enableAuto = (patch: Partial<Settings> = {}) => enableAi({ aiAutoOcr: true, aiAutoOcrSince: 1, ...patch })

const reply = (text: string, truncated = false): VisionReply => ({ text, truncated, model: 'vision-model' })
const VISION_OK = { status: 'ok', via: 'vision' }
const VISION_EMPTY = { status: 'empty', via: 'vision' }
const SKIP = { status: 'skipped' }

/** Подготовка: JPEG с содержимым файла (имя записи). */
function prepareByName(): void {
  mocks.prepareVisionImage.mockImplementation(async (blob) => ({
    status: 'ok',
    image: new Blob([await blob.text()], { type: 'image/jpeg' }),
    width: 100,
    height: 100,
  }))
}

/** Распознавание: «текст <имя>»; имена отправленных картинок и время отправки — в журнале. */
function recognizeByName() {
  const log: Array<{ name: string; at: number }> = []
  mocks.recognizeImage.mockImplementation(async (image) => {
    const name = await image.text()
    log.push({ name, at: Date.now() })
    return reply(`текст ${name}`)
  })
  return log
}

/** Ответ, который ждёт команды теста и честно прерывается сигналом. */
function pendingReply() {
  let resolve!: (r: VisionReply) => void
  mocks.recognizeImage.mockImplementationOnce(
    (_image, _settings, signal) =>
      new Promise<VisionReply>((res, rej) => {
        resolve = res
        signal?.addEventListener('abort', () => rej(new DOMException('прервано', 'AbortError')), { once: true })
      }),
  )
  return { resolve: (r: VisionReply) => resolve(r) }
}

function fakePdf(total: number, count = Math.min(total, 5)) {
  const calls = { pages: [] as number[], close: 0 }
  mocks.openPdfPages.mockResolvedValue({
    status: 'ok',
    doc: {
      total,
      count,
      async page(n: number) {
        calls.pages.push(n)
        return new Blob([`page-${n}`], { type: 'image/jpeg' })
      },
      async close() {
        calls.close++
      },
    },
  })
  return calls
}

// fake-indexeddb работает на setImmediate — его время не подменяется, поэтому база отвечает и
// при подменённых setTimeout/Date; между шагами времени ей даётся отработать.
const realImmediate = globalThis.setImmediate
const macrotask = () => new Promise<void>((resolve) => realImmediate(() => resolve()))
async function flush(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await macrotask()
}
const useFakeClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
async function advance(ms: number, step = 500): Promise<void> {
  for (let t = 0; t < ms; t += step) {
    await vi.advanceTimersByTimeAsync(Math.min(step, ms - t))
    await flush(5)
  }
  await flush()
}
/** Ждёт промисы, продвигая подменённое время. */
async function settle<T>(promises: Array<Promise<T>>, maxMs = 10 * 60_000): Promise<T[]> {
  let done = false
  const all = Promise.all(promises).then((values) => {
    done = true
    return values
  })
  for (let t = 0; !done && t < maxMs; t += 500) {
    await vi.advanceTimersByTimeAsync(500)
    await flush(10)
  }
  return all
}

describe('распознавание зрением: картинка', () => {
  it('текст записывается, обе отметки ставятся, updatedAt прежний', async () => {
    await enableAi()
    prepareByName()
    const log = recognizeByName()
    const item = await imageItem('a.png')
    expect(await extractItemText(item, { vision: true, force: true })).toEqual(VISION_OK)

    const after = await fresh(item.id)
    expect(after.ocrText).toBe('текст a.png')
    expect(after.ocrAt).toBeTypeOf('number')
    expect(after.ocrVisionAt).toBe(after.ocrAt)
    expect(after.updatedAt).toBe(item.updatedAt)
    expect(log.map((e) => e.name)).toEqual(['a.png'])
    const [image, settings, signal] = mocks.recognizeImage.mock.calls[0]
    expect(image.type).toBe('image/jpeg')
    expect(settings.aiApiKey).toBe('sk-test')
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(getOcrJob(item.id)).toBeUndefined()
  })

  it('пустой ответ — empty и обе отметки; слишком маленькая картинка — так же, без запроса', async () => {
    await enableAi()
    prepareByName()
    mocks.recognizeImage.mockResolvedValue(reply(''))
    const item = await imageItem()
    expect(await extractItemText(item, { vision: true, force: true })).toEqual(VISION_EMPTY)
    const after = await fresh(item.id)
    expect(Object.hasOwn(after, 'ocrText')).toBe(false)
    expect(after.ocrAt).toBeTypeOf('number')
    expect(after.ocrVisionAt).toBeTypeOf('number')

    mocks.prepareVisionImage.mockResolvedValueOnce({ status: 'too-small' })
    const tiny = await imageItem()
    expect(await extractItemText(tiny, { vision: true, force: true })).toEqual(VISION_EMPTY)
    expect((await fresh(tiny.id)).ocrVisionAt).toBeTypeOf('number')
    expect(mocks.recognizeImage).toHaveBeenCalledTimes(1)
  })

  it('ответ оборван моделью — truncated', async () => {
    await enableAi()
    prepareByName()
    mocks.recognizeImage.mockResolvedValue(reply('начало текста', true))
    const item = await imageItem()
    expect(await extractItemText(item, { vision: true, force: true })).toEqual({ ...VISION_OK, truncated: true })
  })

  it('ИИ выключен или не настроен — ни подготовки, ни запроса', async () => {
    prepareByName()
    recognizeByName()
    const item = await imageItem()
    expect(await extractItemText(item, { vision: true, force: true })).toEqual({
      status: 'failed',
      error: 'Включите ИИ-помощника в настройках',
    })
    expect(await extractItemText(item, { vision: true })).toEqual(SKIP)

    await enableAi({ aiApiKey: '  ' })
    expect(await extractItemText(item, { vision: true, force: true })).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('API-ключ'),
    })
    await enableAi({ aiBaseUrl: 'http://example.com/v1' })
    expect(await extractItemText(item, { vision: true, force: true })).toMatchObject({ status: 'failed' })

    expect(mocks.prepareVisionImage).not.toHaveBeenCalled()
    expect(mocks.recognizeImage).not.toHaveBeenCalled()
    const after = await fresh(item.id)
    expect(after.ocrAt).toBeUndefined()
    expect(after.ocrVisionAt).toBeUndefined()
  })

  it('ИИ выключили, пока задача ждала очереди, — запроса нет', async () => {
    await enableAi()
    prepareByName()
    const first = pendingReply()
    const a = await imageItem()
    const b = await imageItem()
    const runA = extractItemText(a, { vision: true, force: true })
    const runB = extractItemText(b, { vision: true, force: true })
    await vi.waitFor(() => expect(mocks.recognizeImage).toHaveBeenCalledTimes(1))
    expect(getOcrJob(b.id)?.phase).toBe('queued')

    await setSettings({ aiEnabled: false })
    first.resolve(reply('первый'))
    expect(await runA).toEqual(VISION_OK)
    expect(await runB).toEqual({ status: 'failed', error: 'Включите ИИ-помощника в настройках' })
    expect(mocks.recognizeImage).toHaveBeenCalledTimes(1)
    expect((await fresh(b.id)).ocrVisionAt).toBeUndefined()
  })

  it('корзина: запись в корзине не распознаётся, убранная туда во время ожидания — skipped', async () => {
    await enableAi()
    prepareByName()
    recognizeByName()
    const trashed = await imageItem()
    await deleteItems([trashed.id])
    expect(await extractItemText(await fresh(trashed.id), { vision: true, force: true })).toEqual(SKIP)
    expect(await extractItemText(trashed, { vision: true, force: true })).toEqual(SKIP)
    expect(mocks.recognizeImage).not.toHaveBeenCalled()

    const first = pendingReply()
    const a = await imageItem()
    const b = await imageItem()
    const runA = extractItemText(a, { vision: true, force: true })
    const runB = extractItemText(b, { vision: true, force: true })
    await vi.waitFor(() => expect(mocks.recognizeImage).toHaveBeenCalledTimes(1))
    await deleteItems([b.id])
    first.resolve(reply('первый'))
    expect(await runA).toEqual(VISION_OK)
    expect(await runB).toEqual(SKIP)
    expect(mocks.recognizeImage).toHaveBeenCalledTimes(1)
    expect((await fresh(b.id)).ocrVisionAt).toBeUndefined()
  })

  it('мини-окно: задачи зрения не создаются', async () => {
    await enableAuto()
    prepareByName()
    recognizeByName()
    mocks.capture = true
    const item = await imageItem()
    expect(await extractItemText(item, { vision: true, force: true })).toEqual(SKIP)
    expect(await extractItemText(item, { vision: true })).toEqual(SKIP)

    // PDF: текстовый слой разбирается, скан ждёт главного окна
    mocks.extractPdfText.mockResolvedValue(result('empty'))
    const scan = await pdfItem()
    expect(await extractItemText(scan, { vision: true })).toEqual(LAYER_EMPTY)
    expect(await drainVisionBacklog()).toBe(0)
    expect(mocks.prepareVisionImage).not.toHaveBeenCalled()
    expect(mocks.openPdfPages).not.toHaveBeenCalled()
    expect(mocks.recognizeImage).not.toHaveBeenCalled()
    const after = await fresh(scan.id)
    expect(after.ocrAt).toBeTypeOf('number')
    expect(after.ocrVisionAt).toBeUndefined()
  })

  it('ошибка самого изображения (item): ставится только ocrVisionAt, авто не повторяет', async () => {
    await enableAuto()
    prepareByName()
    mocks.recognizeImage.mockRejectedValue(new VisionError('item', 'Сервис ИИ отказался обрабатывать изображение'))
    const item = await imageItem()
    expect(await extractItemText(item, { vision: true })).toEqual({
      status: 'failed',
      error: 'Сервис ИИ отказался обрабатывать изображение',
    })
    const after = await fresh(item.id)
    expect(after.ocrVisionAt).toBeTypeOf('number')
    expect(after.ocrAt).toBeUndefined()
    expect(after.ocrText).toBeUndefined()
    expect(await extractItemText(after, { vision: true })).toEqual(SKIP)
    expect(await drainVisionBacklog()).toBe(0)
    expect(mocks.recognizeImage).toHaveBeenCalledTimes(1)
    expect(mocks.toastError).not.toHaveBeenCalled()

    // файл не готовится (формат, размер) — то же
    mocks.prepareVisionImage.mockResolvedValueOnce({ status: 'failed', error: 'Формат изображения не поддерживается' })
    const odd = await imageItem()
    expect(await extractItemText(odd, { vision: true, force: true })).toEqual({
      status: 'failed',
      error: 'Формат изображения не поддерживается',
    })
    expect((await fresh(odd.id)).ocrVisionAt).toBeTypeOf('number')
    expect(mocks.recognizeImage).toHaveBeenCalledTimes(1)
  })

  it('временная ошибка: отметки нет, авто в этом сеансе запись не берёт, вручную — повторяет', async () => {
    await enableAuto()
    prepareByName()
    const offline = 'Нет связи с сервисом ИИ: проверьте адрес API и подключение к сети'
    mocks.recognizeImage.mockRejectedValueOnce(new VisionError('transient', offline))
    const item = await imageItem()
    expect(await extractItemText(item, { vision: true })).toEqual({ status: 'failed', error: offline })
    const after = await fresh(item.id)
    expect(after.ocrVisionAt).toBeUndefined()
    expect(after.ocrAt).toBeUndefined()

    expect(await extractItemText(after, { vision: true })).toEqual(SKIP)
    expect(await drainVisionBacklog()).toBe(0)
    expect(mocks.recognizeImage).toHaveBeenCalledTimes(1)

    mocks.recognizeImage.mockResolvedValueOnce(reply('со второй попытки'))
    expect(await extractItemText(after, { vision: true, force: true })).toEqual(VISION_OK)
    expect((await fresh(item.id)).ocrText).toBe('со второй попытки')
  })

  it('прежний текст цел при ошибке и отмене; новый результат его заменяет', async () => {
    await enableAi()
    prepareByName()
    const item = await imageItem()
    await setVisionText(item.id, 'старый текст', 1000)

    mocks.recognizeImage.mockRejectedValueOnce(new VisionError('transient', 'Сервис ИИ временно недоступен (503)'))
    expect(await extractItemText(await fresh(item.id), { vision: true, force: true })).toMatchObject({
      status: 'failed',
    })
    expect((await fresh(item.id)).ocrText).toBe('старый текст')

    const slow = pendingReply()
    const run = extractItemText(await fresh(item.id), { vision: true, force: true })
    await vi.waitFor(() => expect(mocks.recognizeImage).toHaveBeenCalledTimes(2))
    expect(getOcrJob(item.id)?.phase).toBe('running')
    getOcrJob(item.id)!.cancel!()
    expect(await run).toEqual(SKIP)
    slow.resolve(reply('поздно'))
    const after = await fresh(item.id)
    expect(after.ocrText).toBe('старый текст')
    expect(after.ocrVisionAt).toBe(1000)
    expect(getOcrJob(item.id)).toBeUndefined()

    mocks.recognizeImage.mockResolvedValueOnce(reply('новый текст'))
    expect(await extractItemText(after, { vision: true, force: true })).toEqual(VISION_OK)
    expect((await fresh(item.id)).ocrText).toBe('новый текст')
  })

  it('отмена ожидающей задачи: запроса нет, очередь идёт дальше', async () => {
    await enableAi()
    prepareByName()
    const first = pendingReply()
    const a = await imageItem()
    const b = await imageItem()
    const c = await imageItem()
    const runA = extractItemText(a, { vision: true, force: true })
    const runB = extractItemText(b, { vision: true, force: true })
    const ctrl = new AbortController()
    const runC = extractItemText(c, { vision: true, force: true, signal: ctrl.signal })
    await vi.waitFor(() => expect(mocks.recognizeImage).toHaveBeenCalledTimes(1))
    getOcrJob(b.id)!.cancel!()
    ctrl.abort()
    expect(await runB).toEqual(SKIP)
    expect(await runC).toEqual(SKIP)
    first.resolve(reply('первый'))
    expect(await runA).toEqual(VISION_OK)
    expect(mocks.recognizeImage).toHaveBeenCalledTimes(1)
    expect((await fresh(b.id)).ocrVisionAt).toBeUndefined()
  })

  it('повторный вызов — тот же промис; ручной переводит ожидающую фоновую задачу в ручную', async () => {
    await enableAuto()
    prepareByName()
    const first = pendingReply()
    const a = await imageItem()
    const b = await imageItem()
    const runA = extractItemText(a, { vision: true, force: true })
    const runB = extractItemText(b, { vision: true })
    expect(extractItemText(b, { vision: true })).toBe(runB)
    await vi.waitFor(() => expect(mocks.recognizeImage).toHaveBeenCalledTimes(1))
    expect(getOcrJob(b.id)).toMatchObject({ phase: 'queued', manual: false })

    expect(extractItemText(b, { vision: true, force: true })).toBe(runB)
    expect(getOcrJob(b.id)).toMatchObject({ phase: 'queued', manual: true })
    mocks.recognizeImage.mockResolvedValueOnce(reply('второй'))
    first.resolve(reply('первый'))
    expect(await runA).toEqual(VISION_OK)
    expect(await runB).toEqual(VISION_OK)
  })

  it('ручная обгоняет ожидающие фоновые, параллельность — 1', async () => {
    useFakeClock()
    await enableAuto()
    prepareByName()
    let active = 0
    let maxActive = 0
    const order: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((r) => (releaseFirst = r))
    mocks.recognizeImage.mockImplementation(async (image) => {
      const name = await image.text()
      order.push(name)
      maxActive = Math.max(maxActive, ++active)
      if (name === 'bg-1.png') await firstGate
      active--
      return reply(name)
    })
    const bg1 = await imageItem('bg-1.png')
    const bg2 = await imageItem('bg-2.png')
    const bg3 = await imageItem('bg-3.png')
    const manual = await imageItem('manual.png')
    const runs = [bg1, bg2, bg3].map((it) => extractItemText(it, { vision: true }))
    await vi.waitFor(() => expect(order).toEqual(['bg-1.png']))
    const runManual = extractItemText(manual, { vision: true, force: true })
    releaseFirst()
    await settle([...runs, runManual])
    expect(order).toEqual(['bg-1.png', 'manual.png', 'bg-2.png', 'bg-3.png'])
    expect(maxActive).toBe(1)
  })

  it('фоновые запросы — не чаще одного в 3 с; ручные не ждут', async () => {
    useFakeClock()
    await enableAuto()
    prepareByName()
    const log = recognizeByName()
    const items: Item[] = []
    for (let i = 0; i < 4; i++) items.push(await imageItem(`bg-${i}.png`))
    await settle(items.map((it) => extractItemText(it, { vision: true })))
    expect(log).toHaveLength(4)
    for (let i = 1; i < log.length; i++) {
      expect(log[i].at - log[i - 1].at).toBeGreaterThanOrEqual(VISION_AUTO_INTERVAL_MS)
    }
    const manual = await imageItem('manual.png')
    const before = Date.now()
    await settle([extractItemText(manual, { vision: true, force: true })])
    expect(log.at(-1)!.at - before).toBeLessThan(VISION_AUTO_INTERVAL_MS)
  })

  it('ошибка настройки (config): авто останавливается до смены настроек, отметки нет, один toast', async () => {
    useFakeClock()
    await enableAuto()
    prepareByName()
    const log = recognizeByName()
    mocks.recognizeImage.mockRejectedValueOnce(new VisionError('config', 'Неверный API-ключ (401)', 401))
    const a = await imageItem('a.png')
    const b = await imageItem('b.png')
    const [outA, outB] = await settle([extractItemText(a, { vision: true }), extractItemText(b, { vision: true })])
    expect(outA).toEqual({ status: 'failed', error: 'Неверный API-ключ (401)' })
    expect(outB).toEqual(SKIP)
    expect((await fresh(a.id)).ocrVisionAt).toBeUndefined()
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
    const [text, options] = mocks.toastError.mock.calls[0] as [
      string,
      { action: { label: string; onClick: () => void } },
    ]
    expect(text).toBe('Автораспознавание остановлено: неверный API-ключ (401)')
    expect(options.action.label).toBe('Настройки')
    options.action.onClick()
    expect(useUi.getState().view).toBe('settings')

    // остановка держится: новые фоновые задачи и задел не берутся
    const [outC] = await settle([extractItemText(await imageItem('c.png'), { vision: true })])
    expect(outC).toEqual(SKIP)
    expect(await drainVisionBacklog()).toBe(0)
    // ручные работают
    const [manual] = await settle([extractItemText(await imageItem('m.png'), { vision: true, force: true })])
    expect(manual).toEqual(VISION_OK)
    expect(log.map((e) => e.name)).toEqual(['m.png'])

    // смена настроек снимает остановку
    await setSettings({ aiApiKey: 'sk-new' })
    const [outD] = await settle([extractItemText(await imageItem('d.png'), { vision: true })])
    expect(outD).toEqual(VISION_OK)
    expect(mocks.toastError).toHaveBeenCalledTimes(1)
  })

  it('серия временных ошибок — пауза авто на время остывания, один toast', async () => {
    useFakeClock()
    await enableAuto()
    prepareByName()
    mocks.recognizeImage.mockRejectedValue(new VisionError('transient', 'Сервис ИИ временно недоступен (502)', 502))
    const items: Item[] = []
    for (let i = 0; i < VISION_AUTO_FAIL_STREAK + 1; i++) items.push(await imageItem(`f-${i}.png`))
    const outs = await settle(items.map((it) => extractItemText(it, { vision: true })))
    expect(outs.slice(0, VISION_AUTO_FAIL_STREAK).every((o) => o.status === 'failed')).toBe(true)
    expect(outs.at(-1)).toEqual(SKIP)
    expect(mocks.recognizeImage).toHaveBeenCalledTimes(VISION_AUTO_FAIL_STREAK)
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(
      'Автораспознавание остановлено: сервис ИИ временно недоступен (502)',
    )
    for (const it of items) expect((await fresh(it.id)).ocrVisionAt).toBeUndefined()

    // пропущенная запись осталась в заделе и после паузы берётся
    mocks.recognizeImage.mockResolvedValue(reply('после паузы'))
    await advance(VISION_AUTO_COOLDOWN_MS, 30_000)
    expect(await drainVisionBacklog()).toBe(1)
    await advance(VISION_AUTO_INTERVAL_MS)
    expect((await fresh(items.at(-1)!.id)).ocrText).toBe('после паузы')
  })

  it('ответ 429 — пауза авто на минуту', async () => {
    useFakeClock()
    await enableAuto()
    prepareByName()
    const limit = 'Превышен лимит запросов к ИИ (429), попробуйте позже'
    mocks.recognizeImage.mockRejectedValueOnce(new VisionError('transient', limit, 429))
    mocks.recognizeImage.mockResolvedValue(reply('текст'))
    const a = await imageItem()
    const b = await imageItem()
    const [outA, outB] = await settle([extractItemText(a, { vision: true }), extractItemText(b, { vision: true })])
    expect(outA).toEqual({ status: 'failed', error: limit })
    expect(outB).toEqual(SKIP)
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(
      'Автораспознавание остановлено: превышен лимит запросов к ИИ (429), попробуйте позже',
    )

    await advance(VISION_RATE_PAUSE_MS, 5_000)
    const [outB2] = await settle([extractItemText(await fresh(b.id), { vision: true })])
    expect(outB2).toEqual(VISION_OK)
  })

  it('предел сеанса: не больше 100 фоновых запросов, затем одна подсказка', async () => {
    useFakeClock()
    await enableAuto()
    prepareByName()
    recognizeByName()
    const items: Item[] = []
    for (let i = 0; i <= VISION_AUTO_SESSION_LIMIT; i++) items.push(await imageItem(`n-${i}.png`))
    const outs = await settle(items.map((it) => extractItemText(it, { vision: true })))
    expect(mocks.recognizeImage).toHaveBeenCalledTimes(VISION_AUTO_SESSION_LIMIT)
    expect(outs.filter((o) => o.status === 'ok')).toHaveLength(VISION_AUTO_SESSION_LIMIT)
    expect(outs.at(-1)).toEqual(SKIP)
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    expect(mocks.toast.mock.calls[0][0]).toContain('Автораспознавание приостановлено: 100 изображений за сеанс')
    expect(await drainVisionBacklog()).toBe(0)

    // ручные в предел не входят
    const [manual] = await settle([extractItemText(items.at(-1)!, { vision: true, force: true })])
    expect(manual).toEqual(VISION_OK)
  })
})

describe('распознавание зрением: PDF', () => {
  it('слой пуст → зрение: не больше 5 страниц по очереди, тексты склеены, pages', async () => {
    await enableAi()
    mocks.extractPdfText.mockResolvedValue(result('empty'))
    const calls = fakePdf(7)
    recognizeByName()
    const item = await pdfItem()
    expect(await extractItemText(item, { vision: true, force: true })).toEqual({
      ...VISION_OK,
      pages: { read: 5, total: 7 },
    })
    const after = await fresh(item.id)
    expect(after.ocrText).toBe(['1', '2', '3', '4', '5'].map((n) => `текст page-${n}`).join('\n\n'))
    expect(after.ocrVisionAt).toBeTypeOf('number')
    expect(calls.pages).toEqual([1, 2, 3, 4, 5])
    expect(calls.close).toBe(1)
    expect(mocks.recognizeImage).toHaveBeenCalledTimes(5)
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(1)
    expect(mocks.openPdfPages.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)

    // повтор: слой заново не разбирается
    expect(await extractItemText(after, { vision: true, force: true })).toMatchObject({ status: 'ok', via: 'vision' })
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(1)
    expect(mocks.openPdfPages).toHaveBeenCalledTimes(2)
    // без ИИ распознанный скан — «текста нет», прежний текст цел
    expect(await extractItemText(after, { force: true })).toEqual({ status: 'empty' })
    expect((await fresh(item.id)).ocrText).toContain('текст page-1')
  })

  it('ошибка на 3-й странице — текст не записан, документ закрыт', async () => {
    await enableAi()
    mocks.extractPdfText.mockResolvedValue(result('empty'))
    const calls = fakePdf(4)
    let n = 0
    mocks.recognizeImage.mockImplementation(async () => {
      if (++n === 3) throw new VisionError('transient', 'ИИ не ответил за 2 минуты')
      return reply(`стр ${n}`)
    })
    const item = await pdfItem()
    expect(await extractItemText(item, { vision: true, force: true })).toEqual({
      status: 'failed',
      error: 'ИИ не ответил за 2 минуты',
    })
    const after = await fresh(item.id)
    expect(after.ocrText).toBeUndefined()
    expect(after.ocrVisionAt).toBeUndefined()
    expect(after.ocrAt).toBeTypeOf('number')
    expect(calls.pages).toEqual([1, 2, 3])
    expect(calls.close).toBe(1)
  })

  it('PDF не открывается: неустранимо — отметка ocrVisionAt; временно — нет', async () => {
    await enableAi()
    mocks.extractPdfText.mockResolvedValue(result('empty'))
    mocks.openPdfPages.mockResolvedValueOnce({ status: 'failed', error: 'PDF защищён паролем', permanent: true })
    const locked = await pdfItem()
    expect(await extractItemText(locked, { vision: true, force: true })).toEqual({
      status: 'failed',
      error: 'PDF защищён паролем',
    })
    expect((await fresh(locked.id)).ocrVisionAt).toBeTypeOf('number')

    mocks.openPdfPages.mockResolvedValueOnce({ status: 'failed', error: 'Не удалось открыть PDF за отведённое время' })
    const slow = await pdfItem()
    expect(await extractItemText(slow, { vision: true, force: true })).toMatchObject({ status: 'failed' })
    expect((await fresh(slow.id)).ocrVisionAt).toBeUndefined()
    expect(mocks.recognizeImage).not.toHaveBeenCalled()
  })

  it('скан при выключенном ИИ — только слой; уже проверенный скан при vision идёт сразу в зрение', async () => {
    mocks.extractPdfText.mockResolvedValue(result('empty'))
    const item = await pdfItem()
    expect(await extractItemText(item, { vision: false, force: true })).toEqual(LAYER_EMPTY)
    expect(mocks.openPdfPages).not.toHaveBeenCalled()

    await enableAi()
    fakePdf(1)
    recognizeByName()
    expect(await extractItemText(await fresh(item.id), { vision: true, force: true })).toEqual({
      ...VISION_OK,
      pages: { read: 1, total: 1 },
    })
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(1)
  })

  it('автораспознавание скана новой записи: слой, затем страницы с интервалом', async () => {
    useFakeClock()
    await enableAuto()
    mocks.extractPdfText.mockResolvedValue(result('empty'))
    fakePdf(2)
    const log = recognizeByName()
    const item = await pdfItem()
    const [out] = await settle([extractItemText(item, { vision: true })])
    expect(out).toEqual({ ...VISION_OK, pages: { read: 2, total: 2 } })
    expect(log[1].at - log[0].at).toBeGreaterThanOrEqual(VISION_AUTO_INTERVAL_MS)
  })

  it('состояние задачи: в очереди → идёт → страница n из m → нет', async () => {
    await enableAi()
    mocks.extractPdfText.mockResolvedValue(result('empty'))
    fakePdf(2)
    recognizeByName()
    const item = await pdfItem()
    const show = (job: OcrJob | undefined) =>
      job ? `${job.phase}${job.page ? ` ${job.page}/${job.pages}` : ''}${job.manual ? ' ручная' : ''}` : 'нет'
    const states: string[] = []
    const unsubscribe = subscribeOcr(() => {
      const next = show(getOcrJob(item.id))
      if (states.at(-1) !== next) states.push(next)
    })
    const run = extractItemText(item, { vision: true, force: true })
    await run
    unsubscribe()
    expect(states[0]).toBe('queued ручная')
    expect(states).toContain('running ручная')
    expect(states.indexOf('running 1/2 ручная')).toBeGreaterThan(0)
    expect(states.indexOf('running 1/2 ручная')).toBeLessThan(states.indexOf('running 2/2 ручная'))
    expect(states.at(-1)).toBe('нет')
    expect(getOcrJob(item.id)).toBeUndefined()
  })
})

describe('задел автораспознавания', () => {
  it('берёт только записи после включения, без отметки, вне корзины; порция — не больше 20', async () => {
    prepareByName()
    mocks.recognizeImage.mockImplementation(() => new Promise<VisionReply>(() => {}))
    const old = await imageItem('old.png')
    await new Promise((r) => setTimeout(r, 5))
    const since = Date.now()
    await new Promise((r) => setTimeout(r, 5))
    const batch: Item[] = []
    for (let i = 0; i < VISION_BACKLOG_BATCH + 5; i++) batch.push(await imageItem(`new-${i}.png`))
    const trashed = await imageItem('trash.png')
    await deleteItems([trashed.id])
    const recognized = await imageItem('done.png')
    await setVisionText(recognized.id, 'уже есть')
    const tried = await imageItem('tried.png')
    await setVisionText(tried.id, '')

    // авто выключено, не включалось или ИИ недоступен — ничего
    expect(await drainVisionBacklog()).toBe(0)
    await enableAi({ aiAutoOcr: true, aiAutoOcrSince: 0 })
    expect(await drainVisionBacklog()).toBe(0)
    await enableAi({ aiAutoOcr: true, aiAutoOcrSince: since, aiEnabled: false })
    expect(await drainVisionBacklog()).toBe(0)

    await enableAi({ aiAutoOcr: true, aiAutoOcrSince: since })
    expect(await drainVisionBacklog()).toBe(VISION_BACKLOG_BATCH)
    // сначала старые: созданные в ту же миллисекунду идут в порядке ключа
    const queued = batch.filter((it) => getOcrJob(it.id) !== undefined)
    expect(queued).toHaveLength(VISION_BACKLOG_BATCH)
    const left = batch.filter((it) => getOcrJob(it.id) === undefined)
    expect(Math.max(...queued.map((it) => it.createdAt))).toBeLessThanOrEqual(
      Math.min(...left.map((it) => it.createdAt)),
    )
    for (const it of [old, trashed, recognized, tried]) expect(getOcrJob(it.id)).toBeUndefined()
    // те, что уже в очереди, повторно не ставятся
    expect(await drainVisionBacklog()).toBe(5)
  })

  it('startVisionAuto: через 20 с после старта, затем при возвращении к окну не чаще раза в минуту', async () => {
    useFakeClock()
    const win = Object.assign(new EventTarget(), {
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    })
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    vi.stubGlobal('window', win)
    vi.stubGlobal('document', doc)
    await enableAuto()
    prepareByName()
    const log = recognizeByName()
    await imageItem('first.png')

    startVisionAuto()
    startVisionAuto()
    win.dispatchEvent(new Event('focus'))
    await advance(VISION_AUTO_START_DELAY_MS - 1_000)
    expect(log).toHaveLength(0)
    await advance(1_500)
    await vi.waitFor(() => expect(log.map((e) => e.name)).toEqual(['first.png']))

    await imageItem('second.png')
    win.dispatchEvent(new Event('focus'))
    await advance(5_000)
    expect(log).toHaveLength(1)
    await advance(60_000, 5_000)
    doc.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(log.map((e) => e.name)).toEqual(['first.png', 'second.png']))
  })

  it('startVisionAuto в мини-окне ничего не делает', () => {
    const win = Object.assign(new EventTarget(), { setTimeout: vi.fn() })
    vi.stubGlobal('window', win)
    mocks.capture = true
    startVisionAuto()
    expect(win.setTimeout).not.toHaveBeenCalled()
  })
})

// ───────────────────────── исправления ревью этапа 8 ─────────────────────────

describe('ревью этапа 8: очистка, отмена, отсчёт задела', () => {
  it('«Очистить» у PDF с текстовым слоем: не скан, в ИИ не уходит, вручную — снова локально', async () => {
    await enableAuto()
    mocks.extractPdfText.mockResolvedValue(result('ok', 'Договор поставки'))
    fakePdf(2)
    recognizeByName()
    const item = await pdfItem()
    expect(await extractItemText(item, { vision: true })).toEqual(LAYER_OK)
    await clearOcrText(item.id)

    const cleared = await fresh(item.id)
    expect(cleared.ocrText).toBeUndefined()
    expect(await drainVisionBacklog()).toBe(0)
    expect(await extractItemText(cleared, { vision: true })).toEqual(SKIP)
    expect(mocks.recognizeImage).not.toHaveBeenCalled()
    expect(mocks.openPdfPages).not.toHaveBeenCalled()

    // кнопка «Извлечь текст»: слой, а не зрение, хотя ИИ включён
    expect(await extractItemText(cleared, { vision: true, force: true })).toEqual(LAYER_OK)
    const after = await fresh(item.id)
    expect(after.ocrText).toBe('Договор поставки')
    expect(after.ocrClearedAt).toBeUndefined()
    expect(mocks.openPdfPages).not.toHaveBeenCalled()
  })

  it('ИИ выключили и включили снова: накопленное за это время в ИИ не уходит, новое — уходит', async () => {
    await enableAuto()
    await setSetting('aiEnabled', false)
    prepareByName()
    recognizeByName()
    await imageItem('off-1.png')
    await imageItem('off-2.png')
    expect(await drainVisionBacklog()).toBe(0)

    await new Promise((r) => setTimeout(r, 5))
    await setSetting('aiEnabled', true)
    expect(await drainVisionBacklog()).toBe(0)
    expect(mocks.recognizeImage).not.toHaveBeenCalled()

    await new Promise((r) => setTimeout(r, 5))
    await imageItem('on.png')
    expect(await drainVisionBacklog()).toBe(1)
  })

  it('«Отменить» идущее распознавание: задел запись не берёт ни сейчас, ни после перезапуска; кнопка работает', async () => {
    await enableAuto()
    prepareByName()
    pendingReply()
    const item = await imageItem()
    const run = extractItemText(item, { vision: true })
    await vi.waitFor(() => expect(mocks.recognizeImage).toHaveBeenCalledTimes(1))
    getOcrJob(item.id)!.cancel!()
    expect(await run).toEqual(SKIP)

    expect(await drainVisionBacklog()).toBe(0)
    const after = await fresh(item.id)
    expect(after.ocrVisionAt).toBeUndefined()
    expect(after.ocrAutoSkipAt).toBeTypeOf('number')

    resetOcrSession()
    expect(await drainVisionBacklog()).toBe(0)
    expect(mocks.recognizeImage).toHaveBeenCalledTimes(1)

    mocks.recognizeImage.mockResolvedValueOnce(reply('вручную'))
    expect(await extractItemText(after, { vision: true, force: true })).toEqual(VISION_OK)
    expect((await fresh(item.id)).ocrText).toBe('вручную')
  })

  it('«Отменить» в очереди: запроса нет, отметка стоит; прерывание сигналом — не отказ', async () => {
    await enableAuto()
    prepareByName()
    const first = pendingReply()
    const a = await imageItem()
    const b = await imageItem()
    const c = await imageItem()
    const runA = extractItemText(a, { vision: true, force: true })
    const runB = extractItemText(b, { vision: true })
    const ctrl = new AbortController()
    const runC = extractItemText(c, { vision: true, signal: ctrl.signal })
    await vi.waitFor(() => expect(mocks.recognizeImage).toHaveBeenCalledTimes(1))
    getOcrJob(b.id)!.cancel!()
    ctrl.abort()
    expect(await runB).toEqual(SKIP)
    expect(await runC).toEqual(SKIP)
    first.resolve(reply('первый'))
    expect(await runA).toEqual(VISION_OK)
    expect(mocks.recognizeImage).toHaveBeenCalledTimes(1)
    expect((await fresh(b.id)).ocrAutoSkipAt).toBeTypeOf('number')
    expect((await fresh(c.id)).ocrAutoSkipAt).toBeUndefined()

    // c прерван не пользователем — остаётся в заделе; b — нет
    mocks.recognizeImage.mockImplementation(() => new Promise<VisionReply>(() => {}))
    expect(await drainVisionBacklog()).toBe(1)
    expect(getOcrJob(c.id)).toBeDefined()
    expect(getOcrJob(b.id)).toBeUndefined()
  })

  it('ручная отмена у записи после включения авто — тоже отказ от фоновой отправки', async () => {
    await enableAuto()
    prepareByName()
    pendingReply()
    const item = await imageItem()
    const run = extractItemText(item, { vision: true, force: true })
    await vi.waitFor(() => expect(mocks.recognizeImage).toHaveBeenCalledTimes(1))
    getOcrJob(item.id)!.cancel!()
    expect(await run).toEqual(SKIP)
    resetOcrSession()
    expect(await drainVisionBacklog()).toBe(0)
  })
})

describe('ревью этапа 8: ошибки распознавания', () => {
  it('непонятный 400 на одной записи авто не останавливает; серия на разных записях — останавливает', async () => {
    useFakeClock()
    await enableAuto()
    prepareByName()
    const odd = () =>
      Object.assign(new VisionError('config', 'Ошибка ИИ-сервиса 400: bad request', 400), { unknown: true })
    mocks.recognizeImage.mockRejectedValueOnce(odd())
    mocks.recognizeImage.mockResolvedValueOnce(reply('вторая'))
    const a = await imageItem()
    const b = await imageItem()
    const [outA, outB] = await settle([extractItemText(a, { vision: true }), extractItemText(b, { vision: true })])
    expect(outA).toMatchObject({ status: 'failed' })
    expect(outB).toEqual(VISION_OK)
    expect(mocks.toastError).not.toHaveBeenCalled()
    expect((await fresh(a.id)).ocrVisionAt).toBeUndefined()
    // a в этом сеансе авто больше не берёт
    expect(await drainVisionBacklog()).toBe(0)

    mocks.recognizeImage.mockRejectedValue(odd())
    const items: Item[] = []
    for (let i = 0; i < VISION_AUTO_FAIL_STREAK + 1; i++) items.push(await imageItem(`odd-${i}.png`))
    const outs = await settle(items.map((it) => extractItemText(it, { vision: true })))
    expect(outs.at(-1)).toEqual(SKIP)
    expect(mocks.recognizeImage).toHaveBeenCalledTimes(2 + VISION_AUTO_FAIL_STREAK)
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith(
      'Автораспознавание остановлено: ошибка ИИ-сервиса 400: bad request',
      expect.anything(),
    )
  })

  it('сбой подготовки страницы PDF — отметка: в следующем сеансе страницы заново не отправляются', async () => {
    await enableAuto()
    mocks.extractPdfText.mockResolvedValue(result('empty'))
    const calls = { close: 0 }
    mocks.openPdfPages.mockResolvedValue({
      status: 'ok',
      doc: {
        total: 4,
        count: 4,
        async page(n: number) {
          if (n === 3) throw new Error('Не удалось подготовить страницу PDF')
          return new Blob([`page-${n}`], { type: 'image/jpeg' })
        },
        async close() {
          calls.close++
        },
      },
    })
    recognizeByName()
    const item = await pdfItem()
    expect(await extractItemText(item, { vision: true, force: true })).toEqual({
      status: 'failed',
      error: 'Не удалось подготовить страницу PDF',
    })
    expect(mocks.recognizeImage).toHaveBeenCalledTimes(2)
    const after = await fresh(item.id)
    expect(after.ocrVisionAt).toBeTypeOf('number')
    expect(after.ocrText).toBeUndefined()
    expect(calls.close).toBe(1)

    resetOcrSession()
    expect(await drainVisionBacklog()).toBe(0)
    expect(mocks.recognizeImage).toHaveBeenCalledTimes(2)
  })

  it('прерванная растеризация страницы (AbortError) — skipped без отметки', async () => {
    await enableAi()
    mocks.extractPdfText.mockResolvedValue(result('empty'))
    mocks.openPdfPages.mockResolvedValue({
      status: 'ok',
      doc: {
        total: 1,
        count: 1,
        async page() {
          throw new DOMException('прервано', 'AbortError')
        },
        async close() {},
      },
    })
    const item = await pdfItem()
    expect(await extractItemText(item, { vision: true, force: true })).toEqual(SKIP)
    expect((await fresh(item.id)).ocrVisionAt).toBeUndefined()
  })

  it('PDF временно не открылся в фоне: обход задела не берёт его снова в этом сеансе', async () => {
    await enableAuto()
    mocks.extractPdfText.mockResolvedValue(result('empty'))
    mocks.openPdfPages.mockResolvedValue({ status: 'failed', error: 'Не удалось открыть PDF за отведённое время' })
    const item = await pdfItem()
    expect(await extractItemText(item, { vision: true })).toMatchObject({ status: 'failed' })
    expect((await fresh(item.id)).ocrVisionAt).toBeUndefined()
    expect(await drainVisionBacklog()).toBe(0)
    expect(await drainVisionBacklog()).toBe(0)
    expect(mocks.openPdfPages).toHaveBeenCalledTimes(1)
    // вручную — пробуется
    await extractItemText(await fresh(item.id), { vision: true, force: true })
    expect(mocks.openPdfPages).toHaveBeenCalledTimes(2)
  })

  it('длинный скриншот полосами: запрос на каждую, тексты склеены', async () => {
    await enableAi()
    mocks.prepareVisionImage.mockResolvedValue({
      status: 'tiles',
      images: [1, 2, 3].map((n) => new Blob([`strip-${n}`], { type: 'image/jpeg' })),
    })
    recognizeByName()
    const item = await imageItem()
    expect(await extractItemText(item, { vision: true, force: true })).toEqual(VISION_OK)
    expect(mocks.recognizeImage).toHaveBeenCalledTimes(3)
    expect((await fresh(item.id)).ocrText).toBe('текст strip-1\n\nтекст strip-2\n\nтекст strip-3')
  })

  it('после паузы задел разбирается сам, без возврата к окну', async () => {
    useFakeClock()
    const win = Object.assign(new EventTarget(), {
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    })
    vi.stubGlobal('window', win)
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
    await enableAuto()
    prepareByName()
    const log = recognizeByName()
    const limit = 'Превышен лимит запросов к ИИ (429), попробуйте позже'
    mocks.recognizeImage.mockRejectedValueOnce(new VisionError('transient', limit, 429))
    startVisionAuto()
    await advance(VISION_AUTO_START_DELAY_MS + 1_000)
    const a = await imageItem('a.png')
    const b = await imageItem('b.png')
    const [outA, outB] = await settle([extractItemText(a, { vision: true }), extractItemText(b, { vision: true })])
    expect(outA).toMatchObject({ status: 'failed' })
    expect(outB).toEqual(SKIP)
    expect(log).toHaveLength(0)

    await advance(VISION_RATE_PAUSE_MS + 5_000, 1_000)
    await vi.waitFor(() => expect(log.map((e) => e.name)).toEqual(['b.png']))
  })
})
