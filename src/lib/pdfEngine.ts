// Сборка legacy: обычная (`pdfjs-dist`) без полифилов зовёт Promise.try,
// Map.prototype.getOrInsertComputed, Math.sumPrecise. В движке без них (WebView и Safari
// не последних версий, Node 22) обработчик сообщений worker падает, и документ не открывается.
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import type { PdfDocLike, PdfEngine } from './pdfText'

/** Часть pdf.js, нужная движку: адаптер проверяется и без worker-файла. */
export type PdfJsApi = Pick<typeof import('pdfjs-dist'), 'getDocument' | 'VerbosityLevel' | 'PDFWorker'>

/** Поток разбора для одного документа. */
export type PdfWorkerFactory = () => Worker

/**
 * Сколько ждать штатного закрытия документа. task.destroy() ждёт ответа самого worker: занятый
 * разбором worker не ответит никогда, и тогда поток останавливается без него.
 */
export const PDF_DESTROY_WAIT_MS = 1_000

const ERR_WORKER = 'Не удалось запустить разбор PDF'

/**
 * makeWorker — свой worker на каждый документ. Тогда зависший разбор останавливается terminate(),
 * а при ошибке загрузки worker pdf.js не переходит на разбор в главном потоке, где предел времени
 * ничего бы не прервал. Без него (тесты в Node) pdf.js сам выбирает, где разбирать.
 */
export function createPdfEngine(pdfjs: PdfJsApi, makeWorker?: PdfWorkerFactory): PdfEngine {
  return {
    async open(data: Uint8Array, signal?: AbortSignal): Promise<PdfDocLike> {
      if (signal?.aborted) throw new Error('aborted')
      const port = makeWorker?.()
      let worker: InstanceType<PdfJsApi['PDFWorker']> | undefined
      try {
        worker = port ? pdfjs.PDFWorker.create({ port, verbosity: pdfjs.VerbosityLevel.ERRORS }) : undefined
      } catch (e) {
        port?.terminate()
        throw e
      }
      // Адреса CMap, стандартных шрифтов и wasm не задаются намеренно: сети у приложения нет,
      // а для текста они нужны только редким файлам с невстроенными CJK-шрифтами.
      const task = pdfjs.getDocument({
        data,
        disableFontFace: true,
        useSystemFonts: false,
        disableWorkerRendering: true,
        verbosity: pdfjs.VerbosityLevel.ERRORS,
        ...(worker ? { worker } : {}),
      })

      let killing: Promise<void> | undefined
      const kill = (): Promise<void> =>
        (killing ??= (async () => {
          let timer: ReturnType<typeof setTimeout> | undefined
          try {
            await Promise.race([
              task.destroy().catch(() => {}),
              new Promise<void>((resolve) => {
                timer = setTimeout(resolve, PDF_DESTROY_WAIT_MS)
              }),
            ])
          } finally {
            clearTimeout(timer)
            // Переданный worker pdf.js не уничтожает — это наша уборка.
            worker?.destroy()
            port?.terminate()
          }
        })())

      let stop: (reason: Error) => void = () => {}
      const stopped = new Promise<never>((_, reject) => {
        stop = reject
      })
      const onAbort = () => stop(new Error('aborted'))
      const onWorkerError = () => stop(new Error(ERR_WORKER))
      signal?.addEventListener('abort', onAbort, { once: true })
      port?.addEventListener('error', onWorkerError)
      try {
        const doc = await Promise.race([task.promise, stopped])
        return {
          numPages: doc.numPages,
          async pageText(pageNumber: number): Promise<string> {
            const page = await doc.getPage(pageNumber)
            try {
              const content = await page.getTextContent()
              let text = ''
              for (const item of content.items) {
                if (!('str' in item)) continue
                text += item.str
                if (item.hasEOL) text += '\n'
              }
              return text
            } finally {
              page.cleanup()
            }
          },
          close: kill,
        }
      } catch (e) {
        // Иначе worker несостоявшегося документа останется жить.
        await kill()
        throw e
      } finally {
        signal?.removeEventListener('abort', onAbort)
        port?.removeEventListener('error', onWorkerError)
      }
    },
  }
}

export async function loadPdfEngine(): Promise<PdfEngine> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  return createPdfEngine(pdfjs, () => new Worker(workerUrl, { type: 'module' }))
}
