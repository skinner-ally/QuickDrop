// Сборка legacy: обычная (`pdfjs-dist`) без полифилов зовёт Promise.try,
// Map.prototype.getOrInsertComputed, Math.sumPrecise. В движке без них (WebView и Safari
// не последних версий, Node 22) обработчик сообщений worker падает, и документ не открывается.
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { VISION_JPEG_QUALITY } from './ocrState'
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
const ERR_RENDER = 'Не удалось подготовить страницу PDF'

/** Пределы масштаба страницы при растеризации (страницы бывают и с почтовую марку, и с плакат). */
export const PDF_RENDER_MIN_SCALE = 0.5
export const PDF_RENDER_MAX_SCALE = 4

export interface PdfEngineOptions {
  /**
   * Каталог декодеров сканов (JBIG2, CCITT, JPX) — JS-варианты `*_nowasm_fallback.js` (плагин
   * quickdrop:pdf-decoders). WebAssembly не используется: CSP приложения его не разрешает.
   */
  wasmUrl?: string
}

/** Масштаб страницы, при котором большая сторона ≈ maxSide (в пределах PDF_RENDER_MIN/MAX_SCALE). */
export function pageRenderScale(width: number, height: number, maxSide: number): number {
  const longest = Math.max(width, height)
  if (!Number.isFinite(longest) || longest <= 0 || !Number.isFinite(maxSide) || maxSide <= 0) return 1
  return Math.min(PDF_RENDER_MAX_SCALE, Math.max(PDF_RENDER_MIN_SCALE, maxSide / longest))
}

/**
 * makeWorker — свой worker на каждый документ. Тогда зависший разбор останавливается terminate(),
 * а при ошибке загрузки worker pdf.js не переходит на разбор в главном потоке, где предел времени
 * ничего бы не прервал. Без него (тесты в Node) pdf.js сам выбирает, где разбирать.
 */
export function createPdfEngine(
  pdfjs: PdfJsApi,
  makeWorker?: PdfWorkerFactory,
  options: PdfEngineOptions = {},
): PdfEngine {
  const wasmUrl = options.wasmUrl ? options.wasmUrl.replace(/\/*$/, '/') : undefined
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
      // Адреса CMap и стандартных шрифтов не задаются намеренно: сети у приложения нет, а нужны они
      // только редким файлам с невстроенными CJK-шрифтами. Декодеры сканов — JS-модули из wasmUrl
      // (useWasm: false: WebAssembly запрещён CSP), без них страницы JBIG2/CCITT/JPX не растеризуются.
      const task = pdfjs.getDocument({
        data,
        disableFontFace: true,
        useSystemFonts: false,
        disableWorkerRendering: true,
        useWasm: false,
        ...(wasmUrl ? { wasmUrl } : {}),
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
          async pageImage(pageNumber: number, maxSide: number): Promise<Blob> {
            const page = await doc.getPage(pageNumber)
            let canvas: HTMLCanvasElement | undefined
            try {
              const base = page.getViewport({ scale: 1 })
              const viewport = page.getViewport({ scale: pageRenderScale(base.width, base.height, maxSide) })
              canvas = document.createElement('canvas')
              canvas.width = Math.max(1, Math.round(viewport.width))
              canvas.height = Math.max(1, Math.round(viewport.height))
              // Белый фон: прозрачные области в JPEG иначе станут чёрными.
              await page.render({ canvas, viewport, background: 'white' }).promise
              const target = canvas
              const blob = await new Promise<Blob | null>((resolve) =>
                target.toBlob(resolve, 'image/jpeg', VISION_JPEG_QUALITY),
              )
              if (!blob) throw new Error(ERR_RENDER)
              return blob
            } finally {
              page.cleanup()
              // Память холста освобождается сразу, не дожидаясь сборщика мусора.
              if (canvas) {
                canvas.width = 0
                canvas.height = 0
              }
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
  // Абсолютный адрес: worker подгружает декодеры import()'ом, относительный путь он разрешил бы от себя.
  const wasmUrl = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.origin).href
  return createPdfEngine(pdfjs, () => new Worker(workerUrl, { type: 'module' }), { wasmUrl })
}
