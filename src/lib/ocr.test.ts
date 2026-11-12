import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/db'
import { createItem, deleteItems, getItem, purgeItems, setStatus } from '@/db/repo'
import type { PdfTextResult } from '@/lib/pdfText'
import type { Item } from '@/types'
import { BACKFILL_PDF_LIMIT, backfillPdfText, drainPdfBackfill, extractItemText, textSourceOf } from './ocr'

const mocks = vi.hoisted(() => ({ extractPdfText: vi.fn() }))

// Настоящий разбор PDF (pdfjs-dist, worker) в тестах не загружается; isPdf — настоящий.
vi.mock('@/lib/pdfText', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pdfText')>()),
  extractPdfText: mocks.extractPdfText,
}))

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
})

afterEach(() => {
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
    expect(await extractItemText(item, { signal: ctrl.signal })).toEqual({ status: 'ok' })

    const after = await fresh(item.id)
    expect(after.ocrText).toBe('Первая страница\n\nВторая страница')
    expect(after.ocrAt).toBeTypeOf('number')
    expect(after.updatedAt).toBe(item.updatedAt)
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(1)
    const [blob, options] = mocks.extractPdfText.mock.calls[0] as [Blob, { signal?: AbortSignal }]
    expect(blob.size).toBe(item.fileSize)
    expect(options.signal).toBe(ctrl.signal)
  })

  it('повтор без force пропускается, с force — извлекает заново', async () => {
    mocks.extractPdfText.mockResolvedValue(result('ok', 'первый раз'))
    const item = await pdfItem()
    await extractItemText(item)
    const done = await fresh(item.id)

    expect(await extractItemText(done)).toEqual({ status: 'skipped' })
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(1)

    mocks.extractPdfText.mockResolvedValue(result('ok', 'второй раз'))
    expect(await extractItemText(done, { force: true })).toEqual({ status: 'ok' })
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(2)
    expect((await fresh(item.id)).ocrText).toBe('второй раз')
  })

  it('PDF без текстового слоя: отметка «пробовали» ставится, текста нет', async () => {
    mocks.extractPdfText.mockResolvedValue(result('empty'))
    const item = await pdfItem()
    expect(await extractItemText(item)).toEqual({ status: 'empty' })
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
    expect(await extractItemText(await fresh(item.id))).toEqual({ status: 'ok' })
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

  it('записи без PDF пропускаются; картинка и скан с vision — этап 8', async () => {
    const text = await createItem({ type: 'text', content: 'заметка' })
    const image = await createItem({
      type: 'image',
      file: new File([new Uint8Array([137, 80, 78, 71])], 'pic.png', { type: 'image/png' }),
    })
    expect(await extractItemText(text)).toEqual({ status: 'skipped' })
    expect(await extractItemText(image, { vision: true, force: true })).toEqual({ status: 'skipped' })
    expect(mocks.extractPdfText).not.toHaveBeenCalled()
    expect((await fresh(image.id)).ocrAt).toBeUndefined()

    mocks.extractPdfText.mockResolvedValue(result('empty'))
    const scan = await pdfItem()
    expect(await extractItemText(scan, { vision: true })).toEqual({ status: 'skipped' })
    expect((await fresh(scan.id)).ocrText).toBeUndefined()

    // PDF с текстовым слоем при vision читается как обычно
    mocks.extractPdfText.mockResolvedValue(result('ok', 'есть текст'))
    const plain = await pdfItem()
    expect(await extractItemText(plain, { vision: true })).toEqual({ status: 'ok' })
    expect((await fresh(plain.id)).ocrText).toBe('есть текст')
  })

  it('запись в корзине обрабатывается; исчезнувшая за время разбора — skipped', async () => {
    mocks.extractPdfText.mockResolvedValue(result('ok', 'текст'))
    const inTrash = await pdfItem()
    await deleteItems([inTrash.id])
    expect(await extractItemText(inTrash)).toEqual({ status: 'ok' })
    const after = await fresh(inTrash.id)
    expect(after.ocrText).toBe('текст')
    expect(after.deletedAt).toBeTypeOf('number')

    const slow = deferred<PdfTextResult>()
    mocks.extractPdfText.mockReturnValue(slow.promise)
    const gone = await pdfItem()
    const run = extractItemText(gone)
    await vi.waitFor(() => expect(mocks.extractPdfText).toHaveBeenCalledTimes(2))
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
    expect(await busy).toEqual({ status: 'ok' })
    expect(await waiting).toEqual({ status: 'ok' })
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
    expect(await Promise.all([first, second])).toEqual([{ status: 'ok' }, { status: 'ok' }])
    expect(mocks.extractPdfText).toHaveBeenCalledTimes(1)

    // после завершения запись снова можно разобрать по требованию
    mocks.extractPdfText.mockResolvedValue(result('ok', 'ещё раз'))
    expect(await extractItemText(item, { force: true })).toEqual({ status: 'ok' })
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
