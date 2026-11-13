import { afterEach, describe, expect, it, vi } from 'vitest'
import { VISION_JPEG_QUALITY } from './ocrState'
import {
  PDF_DESTROY_WAIT_MS,
  PDF_RENDER_MAX_SCALE,
  PDF_RENDER_MIN_SCALE,
  createPdfEngine,
  pageRenderScale,
} from './pdfEngine'
import type { PdfJsApi } from './pdfEngine'

/** Порт worker: запоминает сообщения, сам не отвечает — как worker, занятый синхронным разбором. */
class SilentWorker extends EventTarget {
  posted: unknown[] = []
  terminated = 0
  postMessage(message: unknown): void {
    this.posted.push(message)
  }
  terminate(): void {
    this.terminated++
  }
}

const asWorker = (w: SilentWorker) => w as unknown as Worker
const never = <T>(): Promise<T> => new Promise<T>(() => {})

const fakeDoc = {
  numPages: 1,
  getPage: async () => ({
    getTextContent: async () => ({ items: [{ str: 'текст', hasEOL: true }] }),
    cleanup: () => {},
  }),
}

/** pdf.js-подделка: task.promise и task.destroy() задаются тестом (по умолчанию не завершаются). */
function fakePdfjs(task: { promise?: Promise<unknown>; destroy?: () => Promise<void> } = {}) {
  const calls = {
    getDocument: [] as Array<Record<string, unknown>>,
    create: [] as Array<Record<string, unknown>>,
    workerDestroy: 0,
    taskDestroy: 0,
  }
  const api = {
    VerbosityLevel: { ERRORS: 0 },
    PDFWorker: {
      create(params: Record<string, unknown>) {
        calls.create.push(params)
        return {
          destroy() {
            calls.workerDestroy++
          },
        }
      },
    },
    getDocument(params: Record<string, unknown>) {
      calls.getDocument.push(params)
      return {
        promise: task.promise ?? never(),
        destroy() {
          calls.taskDestroy++
          return task.destroy?.() ?? never<void>()
        },
      }
    },
  }
  return { api: api as unknown as PdfJsApi, calls }
}

const data = () => new TextEncoder().encode('%PDF-1.4 подделка')

afterEach(() => {
  vi.useRealTimers()
})

describe('createPdfEngine: свой worker на документ', () => {
  it('worker создаётся на документ и передаётся в getDocument', async () => {
    const port = new SilentWorker()
    const { api, calls } = fakePdfjs({ promise: Promise.resolve(fakeDoc), destroy: async () => {} })
    const engine = createPdfEngine(api, () => asWorker(port))
    const doc = await engine.open(data())
    expect(calls.create).toEqual([{ port, verbosity: 0 }])
    expect(calls.getDocument[0].worker).toBeDefined()
    expect(await doc.pageText(1)).toBe('текст\n')
    await doc.close()
    expect(calls.taskDestroy).toBe(1)
    expect(calls.workerDestroy).toBe(1)
    expect(port.terminated).toBe(1)
    // Повторное закрытие — та же уборка, не вторая.
    await doc.close()
    expect(port.terminated).toBe(1)
  })

  it('close(): worker не отвечает на destroy — поток всё равно останавливается', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const port = new SilentWorker()
    const { api, calls } = fakePdfjs({ promise: Promise.resolve(fakeDoc) })
    const doc = await createPdfEngine(api, () => asWorker(port)).open(data())
    let closed = false
    void doc.close().then(() => {
      closed = true
    })
    await vi.advanceTimersByTimeAsync(PDF_DESTROY_WAIT_MS - 1)
    expect(port.terminated).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(closed).toBe(true)
    expect(calls.workerDestroy).toBe(1)
    expect(port.terminated).toBe(1)
  })

  it('открытие брошено по сигналу: open отклоняется, worker остановлен', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const port = new SilentWorker()
    const { api, calls } = fakePdfjs()
    const ctrl = new AbortController()
    const opening = createPdfEngine(api, () => asWorker(port)).open(data(), ctrl.signal)
    const failed = expect(opening).rejects.toThrow()
    ctrl.abort()
    await vi.advanceTimersByTimeAsync(PDF_DESTROY_WAIT_MS)
    await failed
    expect(calls.taskDestroy).toBe(1)
    expect(port.terminated).toBe(1)
  })

  it('worker не загрузился: open отклоняется сразу, без разбора в главном потоке', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const port = new SilentWorker()
    const { api } = fakePdfjs()
    const opening = createPdfEngine(api, () => asWorker(port)).open(data())
    const failed = expect(opening).rejects.toThrow('Не удалось запустить разбор PDF')
    port.dispatchEvent(new Event('error'))
    await vi.advanceTimersByTimeAsync(PDF_DESTROY_WAIT_MS)
    await failed
    expect(port.terminated).toBe(1)
  })

  it('без фабрики worker (Node) pdf.js сам выбирает, где разбирать', async () => {
    const { api, calls } = fakePdfjs({ promise: Promise.resolve(fakeDoc), destroy: async () => {} })
    const doc = await createPdfEngine(api).open(data())
    expect(calls.create).toEqual([])
    expect(calls.getDocument[0]).not.toHaveProperty('worker')
    await doc.close()
    expect(calls.taskDestroy).toBe(1)
    expect(calls.workerDestroy).toBe(0)
  })

  it('getDocument: useWasm: false всегда, wasmUrl — если задан, с завершающим «/»', async () => {
    const first = fakePdfjs({ promise: Promise.resolve(fakeDoc), destroy: async () => {} })
    await (await createPdfEngine(first.api).open(data())).close()
    expect(first.calls.getDocument[0]).toMatchObject({ useWasm: false })
    expect(first.calls.getDocument[0]).not.toHaveProperty('wasmUrl')

    const second = fakePdfjs({ promise: Promise.resolve(fakeDoc), destroy: async () => {} })
    const engine = createPdfEngine(second.api, undefined, { wasmUrl: 'http://tauri.localhost/pdfjs' })
    await (await engine.open(data())).close()
    expect(second.calls.getDocument[0]).toMatchObject({ useWasm: false, wasmUrl: 'http://tauri.localhost/pdfjs/' })

    const third = fakePdfjs({ promise: Promise.resolve(fakeDoc), destroy: async () => {} })
    await (await createPdfEngine(third.api, undefined, { wasmUrl: 'https://x.test/app/pdfjs/' }).open(data())).close()
    expect(third.calls.getDocument[0].wasmUrl).toBe('https://x.test/app/pdfjs/')
  })

  it('настоящий pdf.js, worker молчит после GetDocRequest: брошенное открытие останавливает поток', async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const port = new SilentWorker()
    const ctrl = new AbortController()
    const opening = createPdfEngine(pdfjs, () => asWorker(port)).open(data(), ctrl.signal)
    const failed = expect(opening).rejects.toThrow()
    await vi.waitFor(() =>
      expect(port.posted.map((m) => (m as { action?: string }).action)).toContain('GetDocRequest'),
    )
    ctrl.abort()
    // task.destroy() ждёт ответа worker на Terminate и не дождётся — поток останавливает terminate().
    await vi.advanceTimersByTimeAsync(PDF_DESTROY_WAIT_MS)
    await failed
    expect(port.terminated).toBe(1)
  })
})

describe('pageRenderScale', () => {
  it('большая сторона ≈ maxSide, в пределах 0.5…4', () => {
    expect(pageRenderScale(612, 792, 2000)).toBeCloseTo(2000 / 792)
    expect(pageRenderScale(792, 612, 1584)).toBe(2)
    expect(pageRenderScale(100, 50, 2000)).toBe(PDF_RENDER_MAX_SCALE)
    expect(pageRenderScale(14_400, 14_400, 2000)).toBe(PDF_RENDER_MIN_SCALE)
    expect(pageRenderScale(0, 0, 2000)).toBe(1)
    expect(pageRenderScale(Number.NaN, 10, 2000)).toBe(1)
  })
})

describe('pageImage: страница картинкой', () => {
  /** Холст-подделка: запоминает размеры и тип кодирования. */
  function fakeCanvas(result: 'blob' | 'null' = 'blob') {
    const canvas = {
      width: 0,
      height: 0,
      sizes: [] as Array<[number, number]>,
      encoded: [] as Array<[string | undefined, number | undefined]>,
      toBlob(cb: (b: Blob | null) => void, type?: string, quality?: number) {
        this.sizes.push([this.width, this.height])
        this.encoded.push([type, quality])
        cb(result === 'blob' ? new Blob(['jpeg'], { type: type ?? 'image/png' }) : null)
      },
    }
    vi.stubGlobal('document', { createElement: (tag: string) => (tag === 'canvas' ? canvas : null) })
    return canvas
  }

  function docWithPage(render?: () => Promise<void>) {
    const page = {
      cleanups: 0,
      renders: [] as Array<Record<string, unknown>>,
      getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale, scale }),
      render(params: Record<string, unknown>) {
        page.renders.push(params)
        return { promise: render ? render() : Promise.resolve() }
      },
      cleanup() {
        page.cleanups++
      },
    }
    const doc = { numPages: 2, getPage: async () => page }
    return { doc, page }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('JPEG на белом фоне, масштаб по maxSide; холст и страница освобождаются', async () => {
    const canvas = fakeCanvas()
    const { doc, page } = docWithPage()
    const { api } = fakePdfjs({ promise: Promise.resolve(doc), destroy: async () => {} })
    const opened = await createPdfEngine(api).open(data())
    const blob = await opened.pageImage!(1, 2000)
    expect(blob.type).toBe('image/jpeg')
    expect(canvas.sizes).toEqual([[Math.round(612 * (2000 / 792)), 2000]])
    expect(canvas.encoded).toEqual([['image/jpeg', VISION_JPEG_QUALITY]])
    expect(page.renders).toHaveLength(1)
    expect(page.renders[0]).toMatchObject({ canvas, background: 'white' })
    expect((page.renders[0].viewport as { scale: number }).scale).toBeCloseTo(2000 / 792)
    expect(page.cleanups).toBe(1)
    expect(canvas.width).toBe(0)
    expect(canvas.height).toBe(0)
    await opened.close()
  })

  it('сбой отрисовки или кодирования — отказ; уборка всё равно', async () => {
    const canvas = fakeCanvas('null')
    const { doc, page } = docWithPage()
    const { api } = fakePdfjs({ promise: Promise.resolve(doc), destroy: async () => {} })
    const opened = await createPdfEngine(api).open(data())
    await expect(opened.pageImage!(1, 2000)).rejects.toThrow('Не удалось подготовить страницу PDF')
    expect(page.cleanups).toBe(1)
    expect(canvas.width).toBe(0)

    const broken = docWithPage(() => Promise.reject(new Error('render')))
    const second = fakePdfjs({ promise: Promise.resolve(broken.doc), destroy: async () => {} })
    const doc2 = await createPdfEngine(second.api).open(data())
    await expect(doc2.pageImage!(1, 2000)).rejects.toThrow('render')
    expect(broken.page.cleanups).toBe(1)
  })
})
