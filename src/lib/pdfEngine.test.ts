import { afterEach, describe, expect, it, vi } from 'vitest'
import { PDF_DESTROY_WAIT_MS, createPdfEngine } from './pdfEngine'
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
