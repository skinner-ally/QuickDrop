import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_OCR_TEXT } from './normalize'
import type { PdfDocLike, PdfEngine } from './pdfText'
import {
  PDF_MAX_BYTES,
  PDF_MAX_CHARS,
  PDF_MAX_PAGES,
  PDF_MIN_TEXT_CHARS,
  PDF_TIMEOUT_MS,
  extractPdfText,
  isPdf,
} from './pdfText'

type PageSource = string | ((page: number) => string | Promise<string>)

interface FakeOptions {
  open?: () => Promise<void>
  close?: () => Promise<void>
}

function fakeEngine(pages: PageSource[], fake: FakeOptions = {}) {
  const calls = { engine: 0, open: 0, close: 0, pages: [] as number[], bytes: 0 }
  /** Сигнал, переданный в open(). */
  const seen: { openSignal?: AbortSignal } = {}
  const engine = async (): Promise<PdfEngine> => {
    calls.engine++
    return {
      async open(data: Uint8Array, signal?: AbortSignal): Promise<PdfDocLike> {
        calls.open++
        calls.bytes = data.byteLength
        seen.openSignal = signal
        await fake.open?.()
        return {
          numPages: pages.length,
          async pageText(page: number): Promise<string> {
            calls.pages.push(page)
            const source = pages[page - 1]
            return typeof source === 'function' ? source(page) : source
          },
          async close(): Promise<void> {
            calls.close++
            await fake.close?.()
          },
        }
      },
    }
  }
  return { engine, calls, seen }
}

const never = <T>(): Promise<T> => new Promise<T>(() => {})

function deferred<T = void>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const blob = () => new Blob(['%PDF-1.4 подделка'], { type: 'application/pdf' })
const LINE = 'Строка с текстом, тридцать знаков'

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('isPdf', () => {
  it('узнаёт по типу', () => {
    expect(isPdf({ mimeType: 'application/pdf' })).toBe(true)
    expect(isPdf({ mimeType: 'Application/PDF; charset=binary', fileName: 'скан' })).toBe(true)
    expect(isPdf({ mimeType: 'application/pdf', fileName: 'doc.txt' })).toBe(true)
  })

  it('узнаёт по расширению, когда тип не объявлен или общий', () => {
    expect(isPdf({ fileName: 'Договор.PDF' })).toBe(true)
    expect(isPdf({ mimeType: 'application/octet-stream', fileName: 'отчёт.pdf ' })).toBe(true)
    expect(isPdf({ mimeType: '', fileName: 'a.b.pdf' })).toBe(true)
  })

  it('остальное — не PDF', () => {
    expect(isPdf({})).toBe(false)
    expect(isPdf({ mimeType: 'image/png', fileName: 'pdf.png' })).toBe(false)
    expect(isPdf({ fileName: 'pdf' })).toBe(false)
    expect(isPdf({ fileName: 'file.pdf.zip' })).toBe(false)
    expect(isPdf({ mimeType: 'application/pdfx' })).toBe(false)
  })
})

describe('extractPdfText: движок-подделка', () => {
  it('пределы совпадают со спецификацией', () => {
    expect(PDF_MAX_PAGES).toBe(200)
    expect(PDF_MAX_CHARS).toBe(200_000)
    expect(PDF_MAX_CHARS).toBe(MAX_OCR_TEXT)
    expect(PDF_MAX_BYTES).toBe(50 * 1024 * 1024)
    expect(PDF_TIMEOUT_MS).toBe(30_000)
  })

  it('ok: страницы склеиваются через пустую строку, документ закрывается', async () => {
    const { engine, calls } = fakeEngine([`${LINE} 1\n`, '', `  ${LINE} 2  `, '   \n '])
    const data = blob()
    const result = await extractPdfText(data, { engine })
    expect(result).toEqual({
      status: 'ok',
      text: `${LINE} 1\n\n${LINE} 2`,
      pages: 4,
      readPages: 4,
      truncated: false,
    })
    expect(calls).toEqual({ engine: 1, open: 1, close: 1, pages: [1, 2, 3, 4], bytes: data.size })
  })

  it('текст очищается: управляющие символы и \\r\\n', async () => {
    const { engine } = fakeEngine([`${LINE}\r\nвторая\u0000 строка\u0007`])
    const result = await extractPdfText(blob(), { engine })
    expect(result.status).toBe('ok')
    expect(result.text).toBe(`${LINE}\nвторая строка`)
  })

  it('предел страниц: читает только первые maxPages', async () => {
    const { engine, calls } = fakeEngine([LINE, LINE, LINE, LINE, LINE])
    const result = await extractPdfText(blob(), { engine, maxPages: 2 })
    expect(result).toMatchObject({ status: 'ok', pages: 5, readPages: 2, truncated: true })
    expect(result.text).toBe(`${LINE}\n\n${LINE}`)
    expect(calls.pages).toEqual([1, 2])
    expect(calls.close).toBe(1)
  })

  it('предел страниц по умолчанию — PDF_MAX_PAGES; неверные значения пределов не принимаются', async () => {
    const pages = Array.from({ length: PDF_MAX_PAGES + 1 }, (_, i) => `страница ${i + 1}`)
    for (const maxPages of [undefined, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { engine, calls } = fakeEngine(pages)
      const result = await extractPdfText(blob(), { engine, maxPages, maxChars: 0 })
      expect(result).toMatchObject({ status: 'ok', pages: PDF_MAX_PAGES + 1, readPages: PDF_MAX_PAGES, truncated: true })
      expect(calls.pages).toHaveLength(PDF_MAX_PAGES)
      expect(result.text.endsWith(`страница ${PDF_MAX_PAGES}`)).toBe(true)
    }
  })

  it('ровно maxPages страниц — не обрезано', async () => {
    const { engine } = fakeEngine([LINE, LINE])
    const result = await extractPdfText(blob(), { engine, maxPages: 2 })
    expect(result).toMatchObject({ status: 'ok', pages: 2, readPages: 2, truncated: false })
  })

  it('предел символов: чтение останавливается, текст обрезается', async () => {
    const page = 'я'.repeat(30)
    const { engine, calls } = fakeEngine([page, page, page, page])
    const result = await extractPdfText(blob(), { engine, maxChars: 50 })
    expect(result).toMatchObject({ status: 'ok', pages: 4, readPages: 2, truncated: true })
    expect(result.text).toBe(`${page}\n\n${'я'.repeat(18)}`)
    expect(result.text).toHaveLength(50)
    expect(calls.pages).toEqual([1, 2])
  })

  it('предел символов достигнут ровно на последней странице — не обрезано', async () => {
    const page = 'я'.repeat(24)
    const { engine } = fakeEngine([page, page])
    const result = await extractPdfText(blob(), { engine, maxChars: 50 })
    expect(result).toMatchObject({ status: 'ok', readPages: 2, truncated: false })
    expect(result.text).toHaveLength(50)
  })

  it('предел символов достигнут ровно, но страницы ещё есть — обрезано', async () => {
    const page = 'я'.repeat(24)
    const { engine, calls } = fakeEngine([page, page, page])
    const result = await extractPdfText(blob(), { engine, maxChars: 50 })
    expect(result).toMatchObject({ status: 'ok', pages: 3, readPages: 2, truncated: true })
    expect(calls.pages).toEqual([1, 2])
  })

  it('обрезка не разрывает суррогатную пару', async () => {
    const { engine } = fakeEngine([`${'я'.repeat(29)}😀😀`])
    const result = await extractPdfText(blob(), { engine, maxChars: 30 })
    expect(result.status).toBe('ok')
    expect(result.text).toBe('я'.repeat(29))
    expect(result.truncated).toBe(true)
  })

  it('maxChars больше PDF_MAX_CHARS не действует', async () => {
    const { engine } = fakeEngine(['я'.repeat(PDF_MAX_CHARS + 500)])
    const result = await extractPdfText(blob(), { engine, maxChars: PDF_MAX_CHARS * 2 })
    expect(result).toMatchObject({ status: 'ok', readPages: 1, truncated: true })
    expect(result.text).toHaveLength(PDF_MAX_CHARS)
  })

  it('empty: текста нет вовсе (скан)', async () => {
    const { engine, calls } = fakeEngine(['', '  \n\t ', ''])
    const result = await extractPdfText(blob(), { engine })
    expect(result).toEqual({ status: 'empty', text: '', pages: 3, readPages: 3, truncated: false })
    expect(calls.close).toBe(1)
  })

  it('empty: меньше 20 непробельных символов на все страницы; 20 — уже ok', async () => {
    const almost = fakeEngine(['а б в г д е ж з и к', 'л м н о п р с т у'])
    expect(await extractPdfText(blob(), { engine: almost.engine })).toMatchObject({
      status: 'empty',
      text: '',
      readPages: 2,
    })

    const enough = fakeEngine(['а б в г д е ж з и к', 'л м н о п р с т у ф'])
    const result = await extractPdfText(blob(), { engine: enough.engine })
    expect(result.status).toBe('ok')
    expect(result.text.replace(/\s+/g, '')).toHaveLength(PDF_MIN_TEXT_CHARS)
  })

  it('empty: документ без страниц', async () => {
    const { engine, calls } = fakeEngine([])
    expect(await extractPdfText(blob(), { engine })).toEqual({
      status: 'empty',
      text: '',
      pages: 0,
      readPages: 0,
      truncated: false,
    })
    expect(calls.close).toBe(1)
  })

  it('failed: исключение при открытии', async () => {
    const { engine, calls } = fakeEngine([LINE], {
      open: async () => {
        throw new Error('Invalid PDF structure.')
      },
    })
    const result = await extractPdfText(blob(), { engine })
    expect(result).toEqual({
      status: 'failed',
      text: '',
      pages: 0,
      readPages: 0,
      truncated: false,
      error: 'Не удалось прочитать PDF',
    })
    expect(calls.open).toBe(1)
    expect(calls.close).toBe(0)
  })

  it('failed: PDF с паролем', async () => {
    const { engine } = fakeEngine([LINE], {
      open: async () => {
        throw Object.assign(new Error('No password given'), { name: 'PasswordException', code: 1 })
      },
    })
    const result = await extractPdfText(blob(), { engine })
    expect(result).toMatchObject({ status: 'failed', text: '', error: 'PDF защищён паролем', permanent: true })
  })

  it('failed: битый файл или не PDF (InvalidPDFException) — неустранимо', async () => {
    const { engine } = fakeEngine([LINE], {
      open: async () => {
        throw Object.assign(new Error('Invalid PDF structure.'), { name: 'InvalidPDFException' })
      },
    })
    const result = await extractPdfText(blob(), { engine })
    expect(result).toEqual({
      status: 'failed',
      text: '',
      pages: 0,
      readPages: 0,
      truncated: false,
      error: 'Не удалось прочитать PDF',
      permanent: true,
    })
  })

  it('failed: исключение при чтении страницы, прочитанное не возвращается, close() вызван', async () => {
    const { engine, calls } = fakeEngine([
      LINE,
      () => {
        throw new Error('bad page')
      },
      LINE,
    ])
    const result = await extractPdfText(blob(), { engine })
    expect(result).toEqual({
      status: 'failed',
      text: '',
      pages: 3,
      readPages: 1,
      truncated: false,
      error: 'Не удалось прочитать PDF',
    })
    expect(calls.pages).toEqual([1, 2])
    expect(calls.close).toBe(1)
  })

  it('failed: движок не загрузился (нет чанка или worker)', async () => {
    const rejected = await extractPdfText(blob(), { engine: () => Promise.reject(new Error('chunk load failed')) })
    expect(rejected).toMatchObject({ status: 'failed', pages: 0, error: 'Не удалось прочитать PDF' })
    // Сбой движка временный: после обновления или перезапуска может пройти.
    expect(rejected).not.toHaveProperty('permanent')

    const thrown = await extractPdfText(blob(), {
      engine: () => {
        throw new TypeError('sync')
      },
    })
    expect(thrown).toMatchObject({ status: 'failed', error: 'Не удалось прочитать PDF' })
  })

  it('ошибка close() на результат не влияет', async () => {
    const { engine, calls } = fakeEngine([LINE], {
      close: async () => {
        throw new Error('worker gone')
      },
    })
    const result = await extractPdfText(blob(), { engine })
    expect(result).toMatchObject({ status: 'ok', text: LINE })
    expect(calls.close).toBe(1)
  })

  it('никогда не бросает на мусорных аргументах', async () => {
    const { engine } = fakeEngine([LINE])
    await expect(extractPdfText(null as unknown as Blob, { engine })).resolves.toMatchObject({
      status: 'failed',
      text: '',
      error: 'Не удалось прочитать PDF',
    })
    await expect(extractPdfText({} as Blob, { engine })).resolves.toMatchObject({ status: 'failed' })
    const odd = fakeEngine([42 as unknown as string, LINE])
    await expect(extractPdfText(blob(), { engine: odd.engine })).resolves.toMatchObject({ status: 'ok', text: LINE })
  })

  it('файл больше предела: failed без чтения файла и без движка', async () => {
    const { engine, calls } = fakeEngine([LINE])
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0))
    const big = { size: PDF_MAX_BYTES + 1, type: 'application/pdf', arrayBuffer } as unknown as Blob
    const result = await extractPdfText(big, { engine })
    expect(result).toEqual({
      status: 'failed',
      text: '',
      pages: 0,
      readPages: 0,
      truncated: false,
      error: 'PDF больше 50 МБ — текст не извлекается',
      permanent: true,
    })
    expect(calls.engine).toBe(0)
    expect(arrayBuffer).not.toHaveBeenCalled()
  })

  it('файл ровно в предел читается', async () => {
    const { engine, calls } = fakeEngine([LINE])
    const edge = {
      size: PDF_MAX_BYTES,
      type: 'application/pdf',
      arrayBuffer: async () => new ArrayBuffer(8),
    } as unknown as Blob
    expect(await extractPdfText(edge, { engine })).toMatchObject({ status: 'ok', text: LINE })
    expect(calls.bytes).toBe(8)
  })

  describe('движок по умолчанию', () => {
    // Настоящий pdfEngine здесь не нужен: он выставил бы общий для процесса GlobalWorkerOptions.workerSrc.
    afterEach(() => {
      vi.doUnmock('./pdfEngine')
    })

    it('подгружается лениво и только когда дошло до чтения', async () => {
      const { engine, calls } = fakeEngine([LINE])
      const factory = vi.fn(() => ({ loadPdfEngine: engine }))
      vi.doMock('./pdfEngine', factory)

      const big = { size: PDF_MAX_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Blob
      expect(await extractPdfText(big)).toMatchObject({ status: 'failed' })
      expect(await extractPdfText(blob(), { signal: AbortSignal.abort() })).toMatchObject({ status: 'aborted' })
      expect(factory).not.toHaveBeenCalled()

      expect(await extractPdfText(blob())).toMatchObject({ status: 'ok', text: LINE })
      // null вместо настроек — то же, что без них
      expect(await extractPdfText(blob(), null as unknown as undefined)).toMatchObject({ status: 'ok', text: LINE })
      expect(factory).toHaveBeenCalledTimes(1)
      expect(calls).toMatchObject({ engine: 2, open: 2, close: 2 })
    })
  })

  describe('signal', () => {
    it('уже прерван: движок не вызывается', async () => {
      const { engine, calls } = fakeEngine([LINE])
      const result = await extractPdfText(blob(), { engine, signal: AbortSignal.abort() })
      expect(result).toEqual({ status: 'aborted', text: '', pages: 0, readPages: 0, truncated: false })
      expect(calls.engine).toBe(0)
    })

    it('прерван между страницами: прочитанное не возвращается, close() вызван', async () => {
      const controller = new AbortController()
      const { engine, calls } = fakeEngine([
        LINE,
        () => {
          controller.abort()
          return LINE
        },
        LINE,
      ])
      const result = await extractPdfText(blob(), { engine, signal: controller.signal })
      expect(result).toMatchObject({ status: 'aborted', text: '', pages: 3, truncated: false })
      expect(result.error).toBeUndefined()
      expect(calls.pages).toEqual([1, 2])
      expect(calls.close).toBe(1)
    })

    it('прерван, пока страница не отвечает: ждать не продолжает', async () => {
      const controller = new AbortController()
      const reached = deferred()
      const { engine, calls } = fakeEngine([
        LINE,
        () => {
          reached.resolve()
          return never<string>()
        },
      ])
      const pending = extractPdfText(blob(), { engine, signal: controller.signal })
      await reached.promise
      controller.abort()
      expect(await pending).toEqual({ status: 'aborted', text: '', pages: 2, readPages: 1, truncated: false })
      expect(calls.close).toBe(1)
    })

    it('прерван во время открытия: открывшийся позже документ закрывается', async () => {
      const controller = new AbortController()
      const opening = deferred()
      const started = deferred()
      const { engine, calls, seen } = fakeEngine([LINE], {
        open: () => {
          started.resolve()
          return opening.promise
        },
      })
      const pending = extractPdfText(blob(), { engine, signal: controller.signal })
      await started.promise
      expect(seen.openSignal?.aborted).toBe(false)
      controller.abort()
      expect(await pending).toMatchObject({ status: 'aborted', pages: 0 })
      expect(calls.close).toBe(0)
      // Движку сказано бросить открытие: зависший worker он уничтожает сам.
      expect(seen.openSignal?.aborted).toBe(true)

      opening.resolve()
      await vi.waitFor(() => expect(calls.close).toBe(1))
      expect(calls.pages).toEqual([])
    })

    it('после завершения обработчик с сигнала снят', async () => {
      const controller = new AbortController()
      const remove = vi.spyOn(controller.signal, 'removeEventListener')
      const { engine } = fakeEngine([LINE])
      expect(await extractPdfText(blob(), { engine, signal: controller.signal })).toMatchObject({ status: 'ok' })
      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    })
  })

  describe('предел времени', () => {
    // Blob.arrayBuffer в Node идёт через настоящий цикл событий — подделываются только таймеры и часы.
    const fakeClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })

    it('страница зависла, текст уже набран: ok + truncated', async () => {
      fakeClock()
      const reached = deferred()
      const { engine, calls } = fakeEngine([
        LINE,
        () => {
          reached.resolve()
          return never<string>()
        },
        LINE,
      ])
      const pending = extractPdfText(blob(), { engine })
      await reached.promise
      await vi.advanceTimersByTimeAsync(PDF_TIMEOUT_MS - 1)
      let settled = false
      void pending.then(() => {
        settled = true
      })
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      expect(await pending).toEqual({ status: 'ok', text: LINE, pages: 3, readPages: 1, truncated: true })
      expect(calls.pages).toEqual([1, 2])
      expect(calls.close).toBe(1)
    })

    it('страница зависла, текста нет: failed', async () => {
      fakeClock()
      const reached = deferred()
      const { engine, calls } = fakeEngine([
        'мало',
        () => {
          reached.resolve()
          return never<string>()
        },
      ])
      const pending = extractPdfText(blob(), { engine })
      await reached.promise
      await vi.advanceTimersByTimeAsync(PDF_TIMEOUT_MS)
      expect(await pending).toEqual({
        status: 'failed',
        text: '',
        pages: 2,
        readPages: 1,
        truncated: true,
        error: 'Не удалось прочитать PDF за отведённое время',
      })
      expect(calls.close).toBe(1)
    })

    it('время вышло между страницами: следующая страница не читается', async () => {
      fakeClock()
      const { engine, calls } = fakeEngine([
        LINE,
        () => {
          // Часы ушли вперёд без срабатывания таймера — так выглядит долгая синхронная работа.
          vi.setSystemTime(Date.now() + PDF_TIMEOUT_MS + 1)
          return `${LINE} 2`
        },
        LINE,
      ])
      const result = await extractPdfText(blob(), { engine })
      expect(result).toEqual({
        status: 'ok',
        text: `${LINE}\n\n${LINE} 2`,
        pages: 3,
        readPages: 2,
        truncated: true,
      })
      expect(calls.pages).toEqual([1, 2])
      expect(calls.close).toBe(1)
    })

    it('документ не открывается: failed, открывшийся позже закрывается', async () => {
      fakeClock()
      const opening = deferred()
      const started = deferred()
      const { engine, calls, seen } = fakeEngine([LINE], {
        open: () => {
          started.resolve()
          return opening.promise
        },
      })
      const pending = extractPdfText(blob(), { engine })
      await started.promise
      await vi.advanceTimersByTimeAsync(PDF_TIMEOUT_MS)
      const result = await pending
      expect(result).toMatchObject({
        status: 'failed',
        pages: 0,
        error: 'Не удалось прочитать PDF за отведённое время',
      })
      // Время вышло — причина временная, повтор возможен.
      expect(result).not.toHaveProperty('permanent')
      expect(seen.openSignal?.aborted).toBe(true)

      opening.resolve()
      await vi.waitFor(() => expect(calls.close).toBe(1))
    })

    it('движок не загружается: failed', async () => {
      fakeClock()
      const pending = extractPdfText(blob(), { engine: () => never<PdfEngine>() })
      await vi.advanceTimersByTimeAsync(PDF_TIMEOUT_MS)
      expect(await pending).toMatchObject({ status: 'failed', error: 'Не удалось прочитать PDF за отведённое время' })
    })

    it('зависшее close() результат не держит', async () => {
      fakeClock()
      const { engine, calls } = fakeEngine([LINE], { close: () => never<void>() })
      const pending = extractPdfText(blob(), { engine })
      await vi.waitFor(() => expect(calls.close).toBe(1))
      await vi.advanceTimersByTimeAsync(2_000)
      expect(await pending).toMatchObject({ status: 'ok', text: LINE, truncated: false })
    })

    it('после успешного чтения таймер снят', async () => {
      fakeClock()
      const { engine } = fakeEngine([LINE])
      expect(await extractPdfText(blob(), { engine })).toMatchObject({ status: 'ok' })
      expect(vi.getTimerCount()).toBe(0)
    })
  })
})

// --- настоящий pdf.js ---------------------------------------------------------------------------

function buildPdf(objects: string[], trailerExtra = ''): string {
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  out += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${trailerExtra} >>\nstartxref\n${xref}\n%%EOF\n`
  return out
}

const stream = (body: string) => `<< /Length ${body.length} >>\nstream\n${body}\nendstream`

/** Кириллица — коды Windows-1251 в hex-строке: сам файл остаётся ASCII, смещения xref считаются по символам. */
function hexString(text: string): string {
  const codes = Array.from(text, (ch) => {
    const code = ch.codePointAt(0) ?? 0x20
    return (code >= 0x410 && code <= 0x44f ? code - 0x410 + 0xc0 : code).toString(16).padStart(2, '0')
  })
  return `<${codes.join('')}>`
}

const TO_UNICODE = [
  '/CIDInit /ProcSet findresource begin',
  '12 dict begin',
  'begincmap',
  '/CMapName /Adobe-Identity-UCS def',
  '/CMapType 2 def',
  '1 begincodespacerange',
  '<00> <FF>',
  'endcodespacerange',
  '2 beginbfrange',
  '<20> <7E> <0020>',
  '<C0> <FF> <0410>',
  'endbfrange',
  'endcmap',
  'CMapName currentdict /CMap defineresource pop',
  'end',
  'end',
].join('\n')

/** Минимальный PDF с текстовым слоем: страница — список строк. Пустой список — страница без текста. */
function textPdf(pages: string[][]): string {
  // 1 — каталог, 2 — дерево страниц, 3 — шрифт, 4 — ToUnicode, дальше пары «содержимое, страница».
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 4 0 R >>', stream(TO_UNICODE)]
  const kids: number[] = []
  for (const lines of pages) {
    const ops = ['BT', '/F1 12 Tf', '72 720 Td', '14 TL']
    for (const line of lines) ops.push(`${hexString(line)} Tj`, 'T*')
    ops.push('ET')
    objects.push(stream(ops.join('\n')))
    const content = objects.length
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${content} 0 R >>`,
    )
    kids.push(objects.length)
  }
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[1] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(' ')}] /Count ${kids.length} >>`
  return buildPdf(objects)
}

/** Стандартная защита с паролем: ключи O и U — произвольные, пустой пароль к ним не подходит. */
function lockedPdf(): string {
  const bytes = (count: number, seed: number) =>
    Array.from({ length: count }, (_, i) => ((i * 7 + seed) & 255).toString(16).padStart(2, '0')).join('')
  return buildPdf(
    [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
      `<< /Filter /Standard /V 1 /R 2 /O <${bytes(32, 3)}> /U <${bytes(32, 9)}> /P -44 >>`,
    ],
    ` /Encrypt 4 0 R /ID [<${bytes(16, 1)}> <${bytes(16, 1)}>]`,
  )
}

const pdfBlob = (source: string) => new Blob([source], { type: 'application/pdf' })

// В Node pdf.js работает без worker-потока (модуль worker подключается в основном потоке),
// поэтому здесь проверяется адаптер и разбор файла, но не загрузка worker по `?url` — она только в браузере.
describe('extractPdfText: настоящий pdf.js', () => {
  let engine: () => Promise<PdfEngine>

  beforeAll(async () => {
    const [{ createPdfEngine }, pdfjs] = await Promise.all([
      import('./pdfEngine'),
      import('pdfjs-dist/legacy/build/pdf.mjs'),
    ])
    engine = async () => createPdfEngine(pdfjs)
  })

  it('читает текстовый слой: строки, страницы, кириллица', async () => {
    const source = textPdf([
      ['Привет, QuickDrop! Это текстовый слой.', 'Вторая строка (со скобками) 2026.'],
      [],
      ['Page three, plain ASCII text layer.'],
    ])
    const result = await extractPdfText(pdfBlob(source), { engine })
    expect(result).toEqual({
      status: 'ok',
      text: [
        'Привет, QuickDrop! Это текстовый слой.\nВторая строка (со скобками) 2026.',
        'Page three, plain ASCII text layer.',
      ].join('\n\n'),
      pages: 3,
      readPages: 3,
      truncated: false,
    })
  })

  it('предел страниц на настоящем документе', async () => {
    const source = textPdf([['First page with enough text.'], ['Second page.'], ['Third page.']])
    const result = await extractPdfText(pdfBlob(source), { engine, maxPages: 1 })
    expect(result).toEqual({
      status: 'ok',
      text: 'First page with enough text.',
      pages: 3,
      readPages: 1,
      truncated: true,
    })
  })

  it('страницы без текста (скан): empty', async () => {
    const result = await extractPdfText(pdfBlob(textPdf([[], []])), { engine })
    expect(result).toEqual({ status: 'empty', text: '', pages: 2, readPages: 2, truncated: false })
  })

  it('PDF с паролем: failed с понятным текстом, неустранимо', async () => {
    const result = await extractPdfText(pdfBlob(lockedPdf()), { engine })
    expect(result).toEqual({
      status: 'failed',
      text: '',
      pages: 0,
      readPages: 0,
      truncated: false,
      error: 'PDF защищён паролем',
      permanent: true,
    })
  })

  it('не PDF и пустой файл: failed, неустранимо', async () => {
    for (const source of ['это вовсе не PDF', '']) {
      const result = await extractPdfText(pdfBlob(source), { engine })
      expect(result).toMatchObject({
        status: 'failed',
        text: '',
        pages: 0,
        error: 'Не удалось прочитать PDF',
        permanent: true,
      })
    }
  })

  it('один движок читает несколько файлов подряд', async () => {
    const shared = await engine()
    const first = await extractPdfText(pdfBlob(textPdf([['First document, first page.']])), { engine: async () => shared })
    const second = await extractPdfText(pdfBlob(textPdf([['Второй документ, первая страница.']])), {
      engine: async () => shared,
    })
    expect(first.text).toBe('First document, first page.')
    expect(second.text).toBe('Второй документ, первая страница.')
  })
})
