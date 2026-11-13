import { toast } from 'sonner'
import { db } from '@/db/db'
import { getFile, getItem, markVisionAutoSkip, markVisionTried, setOcrText, setVisionText } from '@/db/repo'
import { getSettings } from '@/db/settings'
import { VisionError, recognizeImage, visionAvailability } from '@/lib/ai'
import type { VisionReply } from '@/lib/ai'
import { describeError } from '@/lib/errors'
import { MAX_OCR_TEXT, cleanOcrText } from '@/lib/normalize'
import {
  VISION_AUTO_COOLDOWN_MS,
  VISION_AUTO_FAIL_STREAK,
  VISION_AUTO_INTERVAL_MS,
  VISION_AUTO_SESSION_LIMIT,
  VISION_BACKLOG_BATCH,
  VISION_BACKLOG_MIN_GAP_MS,
  VISION_RATE_PAUSE_MS,
  isScanPdf,
  isVisionBacklog,
  setOcrJob,
} from '@/lib/ocrState'
import type { OcrKind, OcrOutcome } from '@/lib/ocrState'
import { openPdfPages } from '@/lib/pdfRender'
import { extractPdfText, isPdf } from '@/lib/pdfText'
import { isCaptureWindow } from '@/lib/platform'
import { prepareVisionImage } from '@/lib/visionImage'
import { useUi } from '@/store/ui'
import type { Item, Settings } from '@/types'

export type TextSource = 'pdf' | 'image'

/** Итог извлечения текста — то же, что OcrOutcome (поля этапа 8 необязательны). */
export type ExtractOutcome = OcrOutcome

export const BACKFILL_PDF_LIMIT = 10
/** Пауза между порциями фонового обхода. */
export const BACKFILL_PAUSE_MS = 3_000
/** Через сколько после старта главного окна разбирается задел автораспознавания. */
export const VISION_AUTO_START_DELAY_MS = 20_000

/** Откуда у записи можно извлечь текст: PDF — из текстового слоя, картинка — распознаванием. */
export function textSourceOf(item: Pick<Item, 'type' | 'mimeType' | 'fileName' | 'fileId'>): TextSource | null {
  if (!item.fileId) return null
  if (isPdf(item)) return 'pdf'
  return item.type === 'image' ? 'image' : null
}

const SKIPPED: OcrOutcome = { status: 'skipped' }
const skipped = (): OcrOutcome => ({ ...SKIPPED })
const failed = (error: string): OcrOutcome => ({ status: 'failed', error })

// ───────────────────────── задачи ─────────────────────────

/**
 * Одна запись в работе: текстовый слой PDF и/или распознавание зрением. Пока задача ждёт или идёт,
 * повторный вызов для той же записи получает тот же промис.
 */
interface Pipeline {
  id: string
  /** Ручной запуск (кнопка): вне очереди авто, без интервала и предела сеанса. */
  manual: boolean
  /** Можно ли распознавать зрением (скан PDF после пустого слоя). */
  vision: boolean
  ctrl: AbortController
  cancel: () => void
  phase: 'queued' | 'running'
  page?: number
  pages?: number
  /** Место в очереди зрения, пока задача её ждёт. */
  waiter?: Waiter
  /** Запись отметки «авто не брать» после отмены пользователем: задача завершается после неё. */
  declined?: Promise<unknown>
  promise: Promise<OcrOutcome>
}

const pipelines = new Map<string, Pipeline>()

function publish(p: Pipeline): void {
  if (pipelines.get(p.id) !== p) return
  setOcrJob(p.id, {
    phase: p.phase,
    manual: p.manual,
    ...(p.page !== undefined && p.pages !== undefined ? { page: p.page, pages: p.pages } : {}),
    cancel: p.cancel,
  })
}

/** Ручной вызов для записи, которая ждёт как фоновая: задача переходит в ручную очередь. */
function promote(p: Pipeline): void {
  if (p.manual) return
  p.manual = true
  const w = p.waiter
  if (w) {
    const at = autoQueue.indexOf(w)
    if (at >= 0) {
      autoQueue.splice(at, 1)
      manualQueue.push(w)
    }
  }
  publish(p)
  scheduleVision()
}

/**
 * Извлекает текст вложения и записывает его в запись. Не бросает.
 * - PDF: текстовый слой (очередь по одному); слой пуст или запись уже скан и `vision` — распознавание
 *   зрением. PDF, уже распознанный зрением, при `force && vision` идёт сразу в зрение.
 * - Картинка: только при `vision` — распознавание зрением.
 * `force` — ручной запуск (кнопка): вне очереди авто и без проверки «уже обработано».
 * skipped — извлекать нечего, уже обработано (без force), запись в корзине или работа прервана;
 * failed — не получилось (текст в `error`). Прежний ocrText не стирается до нового результата.
 * При неустранимой причине у слоя PDF ставится ocrAt без текста, у зрения — ocrVisionAt.
 */
export function extractItemText(
  item: Item,
  options: { vision?: boolean; force?: boolean; signal?: AbortSignal } = {},
): Promise<ExtractOutcome> {
  const kind = textSourceOf(item)
  if (!kind || item.deletedAt !== undefined) return Promise.resolve(skipped())
  const force = options.force === true
  // Мини-окно прячется сразу после сохранения: запрос на десятки секунд в нём ненадёжен (Р10).
  const vision = options.vision === true && !isCaptureWindow()

  const current = pipelines.get(item.id)
  if (current) {
    if (force) {
      if (vision) current.vision = true
      promote(current)
    }
    return current.promise
  }

  if (kind === 'image') {
    if (!vision) return Promise.resolve(skipped())
    if (!force && (item.ocrVisionAt !== undefined || item.ocrText || autoSkip.has(item.id))) {
      return Promise.resolve(skipped())
    }
    return start(item.id, 'image', force, true, options.signal)
  }

  if (item.ocrVisionAt !== undefined) {
    if (!force) return Promise.resolve(skipped())
    // Скан уже распознавали зрением: слой заново не разбирается; без ИИ текста не получить.
    if (!vision) return Promise.resolve({ status: 'empty' })
    return start(item.id, 'pdf-vision', true, true, options.signal)
  }
  if (vision && isScanPdf(item)) {
    if (!force && autoSkip.has(item.id)) return Promise.resolve(skipped())
    return start(item.id, 'pdf-vision', force, true, options.signal)
  }
  if (item.ocrAt !== undefined && !force) return Promise.resolve(skipped())
  return start(item.id, 'pdf', force, vision, options.signal)
}

type Stage = 'image' | 'pdf' | 'pdf-vision'

function start(id: string, stage: Stage, manual: boolean, vision: boolean, signal?: AbortSignal): Promise<OcrOutcome> {
  const ctrl = new AbortController()
  const p: Pipeline = {
    id,
    manual,
    vision,
    ctrl,
    cancel: () => {},
    phase: 'queued',
    promise: Promise.resolve(SKIPPED),
  }
  // «Отменить» пользователем — решение «не отправлять сам»: авто запись больше не берёт ни в этом сеансе,
  // ни после перезапуска (кнопка «Распознать» работает). Прерывание сигналом или сбросом сеанса — не решение.
  p.cancel = () => {
    if (ctrl.signal.aborted || pipelines.get(id) !== p) return
    autoSkip.add(id)
    p.declined = markVisionAutoSkip(id).catch(() => false)
    ctrl.abort()
  }
  if (signal) {
    if (signal.aborted) ctrl.abort()
    else signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  }
  pipelines.set(id, p)
  publish(p)
  p.promise = run(p, stage)
  return p.promise
}

async function run(p: Pipeline, stage: Stage): Promise<OcrOutcome> {
  try {
    if (stage === 'image') return await runVision(p, 'image')
    if (stage === 'pdf-vision') return await runVision(p, 'pdf')
    // Ожидание очереди слоя прерывается отменой (как у очереди зрения): иначе отменённая задача висела бы
    // «В очереди…» до своей очереди, а повторный запуск возвращал бы её промис. Работа в очереди отработает
    // вхолостую — runLayer сразу видит signal.aborted; publish не тронет новую задачу той же записи.
    const aborted = untilAborted(p.ctrl.signal)
    let layer: LayerResult
    try {
      layer = await Promise.race([enqueue(() => runLayer(p)), aborted.promise])
    } finally {
      aborted.dispose()
    }
    if (!layer.scan || !p.vision || p.ctrl.signal.aborted) return layer.outcome
    return await runVision(p, 'pdf')
  } catch (e) {
    return failed(describeError(e, 'Не удалось распознать текст'))
  } finally {
    if (p.declined) await p.declined
    if (pipelines.get(p.id) === p) {
      pipelines.delete(p.id)
      setOcrJob(p.id, null)
    }
  }
}

// ───────────────────────── текстовый слой PDF ─────────────────────────

// Разборы идут по одному: каждый держит файл целиком в памяти и свой worker pdf.js, а предел времени
// на файл при параллельном разборе пачки срабатывал бы от нехватки процессора.
let queueTail: Promise<unknown> = Promise.resolve()

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = queueTail.then(work, work)
  queueTail = next.catch(() => {})
  return next
}

interface LayerResult {
  outcome: OcrOutcome
  /** Текста в слое нет: дальше — зрение, если оно разрешено. */
  scan: boolean
}

/** Промис, который при отмене даёт skipped; dispose снимает слушателя. */
function untilAborted(signal: AbortSignal): { promise: Promise<LayerResult>; dispose: () => void } {
  let onAbort = () => {}
  const promise = new Promise<LayerResult>((resolve) => {
    onAbort = () => resolve({ outcome: skipped(), scan: false })
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
  })
  return { promise, dispose: () => signal.removeEventListener('abort', onAbort) }
}

async function runLayer(p: Pipeline): Promise<LayerResult> {
  const done = (outcome: OcrOutcome, scan = false): LayerResult => ({ outcome, scan })
  try {
    const signal = p.ctrl.signal
    if (signal.aborted) return done(skipped())
    p.phase = 'running'
    publish(p)
    // Пока задача ждала очереди, запись могли удалить, убрать в корзину или уже обработать.
    const item = await getItem(p.id)
    if (!item || item.deletedAt !== undefined || textSourceOf(item) !== 'pdf') return done(skipped())
    if (item.ocrAt !== undefined && !p.manual) return done(skipped())

    const file = await getFile(item.fileId!)
    if (!file) {
      await markUnreadable(item)
      return done(failed('Файл не найден'))
    }

    const result = await extractPdfText(file.blob, { signal })
    if (result.status === 'aborted') return done(skipped())
    if (result.status === 'failed') {
      if (result.permanent) await markUnreadable(item)
      return done(failed(result.error ?? 'Не удалось прочитать PDF'))
    }

    if (result.status === 'empty') {
      // Отметка «пробовали, текста нет» не даёт фоновому обходу разбирать скан снова. Прежний текст
      // не затирается, если дальше пойдёт распознавание: новый результат ещё не получен.
      const keep = p.vision && !!item.ocrText
      if (!keep && !(await setOcrText(item.id, ''))) return done(skipped())
      return done({ status: 'empty', via: 'text-layer' }, true)
    }

    if (!(await setOcrText(item.id, result.text))) return done(skipped())
    const outcome: OcrOutcome = { status: 'ok', via: 'text-layer' }
    if (result.readPages < result.pages) outcome.pages = { read: result.readPages, total: result.pages }
    else if (result.truncated) outcome.truncated = true
    return done(outcome)
  } catch (e) {
    return done(failed(describeError(e, 'Не удалось извлечь текст')))
  }
}

/** Отметка «пробовали, текста нет». Уже извлечённый текст (повтор с force) не затирается. */
async function markUnreadable(item: Item): Promise<void> {
  if (item.ocrAt === undefined && !item.ocrText) await setOcrText(item.id, '')
}

// ───────────────────────── очередь зрения ─────────────────────────

const ABORTED = Symbol('aborted')
/** Фоновая задача снята при остановке авто. */
const DROPPED = Symbol('dropped')

interface Waiter {
  p: Pipeline
  resolve: () => void
  reject: (reason: symbol) => void
}

// Параллельность 1: ручные впереди фоновых. Очередь текстового слоя PDF — отдельная.
const manualQueue: Waiter[] = []
const autoQueue: Waiter[] = []
let visionBusy = false
let slotTimer: ReturnType<typeof setTimeout> | undefined
/** Меняется только resetOcrSession: задача прежнего поколения не освобождает исполнителя нового. */
let generation = 0

function removeWaiter(w: Waiter): void {
  for (const queue of [manualQueue, autoQueue]) {
    const at = queue.indexOf(w)
    if (at >= 0) queue.splice(at, 1)
  }
  if (w.p.waiter === w) w.p.waiter = undefined
}

function acquireVision(p: Pipeline): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const signal = p.ctrl.signal
    if (signal.aborted) {
      reject(ABORTED)
      return
    }
    const onAbort = () => {
      removeWaiter(w)
      w.reject(ABORTED)
    }
    const w: Waiter = {
      p,
      resolve: () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      reject: (reason) => {
        signal.removeEventListener('abort', onAbort)
        reject(reason)
      },
    }
    signal.addEventListener('abort', onAbort, { once: true })
    p.waiter = w
    ;(p.manual ? manualQueue : autoQueue).push(w)
    scheduleVision()
  })
}

/**
 * Отдаёт исполнителя следующей задаче. Фоновая начинается не раньше, чем через интервал после
 * предыдущего фонового запроса; ручная, пришедшая за это время, идёт первой.
 */
function scheduleVision(): void {
  if (visionBusy) return
  let next = manualQueue.shift()
  if (!next && autoQueue.length > 0) {
    const wait = lastAutoRequestAt + VISION_AUTO_INTERVAL_MS - Date.now()
    if (wait > 0) {
      slotTimer ??= setTimeout(() => {
        slotTimer = undefined
        scheduleVision()
      }, wait)
      return
    }
    next = autoQueue.shift()
  }
  if (!next) return
  visionBusy = true
  next.p.waiter = undefined
  next.resolve()
}

function releaseVision(): void {
  visionBusy = false
  scheduleVision()
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(ABORTED)
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(ABORTED)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

// ───────────────────────── автораспознавание: пределы и остановка ─────────────────────────

type AutoHalt =
  | { kind: 'config'; fingerprint: string }
  | { kind: 'pause'; until: number }
  | { kind: 'limit' }

let autoHalt: AutoHalt | null = null
let lastAutoRequestAt = Number.NEGATIVE_INFINITY
let autoRequests = 0
let failStreak = 0
/** Записи, у которых фоновая попытка кончилась временной ошибкой: авто их в этом сеансе больше не берёт. */
const autoSkip = new Set<string>()

/** Отпечаток настроек ИИ: остановка по ошибке настройки снимается, когда он меняется. Только в памяти. */
function fingerprint(s: Settings): string {
  return JSON.stringify([s.aiEnabled, s.aiBaseUrl, s.aiApiKey, s.aiModel, s.aiVisionModel, s.aiAutoOcr])
}

/** Остановлено ли авто; истёкшая пауза и сменившиеся настройки снимают остановку. */
function autoHalted(settings: Settings): boolean {
  const halt = autoHalt
  if (!halt) return false
  if (halt.kind === 'limit') return true
  if (halt.kind === 'pause' ? Date.now() < halt.until : fingerprint(settings) === halt.fingerprint) return true
  autoHalt = null
  failStreak = 0
  return false
}

let resumeTimer: ReturnType<typeof setTimeout> | undefined

/**
 * После паузы (429, серия ошибок) снятые с очереди записи ждали бы, пока окно потеряет и вернёт фокус:
 * по окончании паузы задел разбирается сам. Только в главном окне после startVisionAuto.
 */
function scheduleResume(until: number): void {
  if (!autoStarted) return
  if (resumeTimer !== undefined) clearTimeout(resumeTimer)
  resumeTimer = setTimeout(
    () => {
      resumeTimer = undefined
      void drainVisionBacklog()
    },
    Math.max(0, until - Date.now()) + 1_000,
  )
}

/** «Неверный API-ключ» → «неверный API-ключ»; аббревиатуры («ИИ вернул…») не трогаются. */
function lowerFirst(text: string): string {
  if (text.length < 2 || text[1] !== text[1].toLowerCase()) return text
  return text[0].toLowerCase() + text.slice(1)
}

function haltAuto(halt: AutoHalt, settings: Settings | undefined, reason: string): void {
  const already = settings ? autoHalted(settings) : autoHalt !== null
  autoHalt = halt
  failStreak = 0
  for (const w of autoQueue.splice(0)) {
    w.p.waiter = undefined
    w.reject(DROPPED)
  }
  if (halt.kind === 'pause') scheduleResume(halt.until)
  if (already) return
  try {
    if (halt.kind === 'limit') {
      toast(
        `Автораспознавание приостановлено: ${VISION_AUTO_SESSION_LIMIT} изображений за сеанс. ` +
          'Остальные — после перезапуска или кнопкой «Распознать»',
      )
    } else if (halt.kind === 'config') {
      toast.error(`Автораспознавание остановлено: ${lowerFirst(reason)}`, {
        action: { label: 'Настройки', onClick: () => useUi.getState().setView('settings') },
      })
    } else {
      toast.error(`Автораспознавание остановлено: ${lowerFirst(reason)}`)
    }
  } catch {
    // уведомление необязательно
  }
}

// ───────────────────────── распознавание одной записи ─────────────────────────

async function runVision(p: Pipeline, kind: OcrKind): Promise<OcrOutcome> {
  p.phase = 'queued'
  p.page = p.pages = undefined
  publish(p)
  try {
    await acquireVision(p)
  } catch {
    return skipped()
  }
  const gen = generation
  try {
    p.phase = 'running'
    publish(p)
    return await recognize(p, kind)
  } finally {
    if (gen === generation) releaseVision()
  }
}

interface Ready {
  settings: Settings
  item: Item
}

/**
 * Проверка перед работой и перед каждым запросом: настройки читаются заново, поэтому выключение ИИ
 * действует и на задачи, уже стоящие в очереди. request — сейчас уйдёт запрос: фоновая задача ждёт
 * интервал и учитывается в пределе сеанса.
 */
async function ensureAllowed(p: Pipeline, request: boolean): Promise<Ready | OcrOutcome> {
  const signal = p.ctrl.signal
  if (request && !p.manual) {
    const wait = lastAutoRequestAt + VISION_AUTO_INTERVAL_MS - Date.now()
    if (wait > 0) await sleep(wait, signal)
  }
  if (signal.aborted) throw ABORTED
  const settings = await getSettings()
  const item = await getItem(p.id)
  if (signal.aborted) throw ABORTED
  if (!item || item.deletedAt !== undefined) return skipped()
  const blocked = visionAvailability(settings)
  if (blocked !== null) return p.manual ? failed(blocked) : skipped()
  if (!p.manual) {
    if (!settings.aiAutoOcr || !isVisionBacklog(item, settings.aiAutoOcrSince)) return skipped()
    if (autoHalted(settings)) return skipped()
    if (request) {
      if (autoRequests >= VISION_AUTO_SESSION_LIMIT) {
        haltAuto({ kind: 'limit' }, settings, '')
        return skipped()
      }
      autoRequests++
      lastAutoRequestAt = Date.now()
    }
  }
  return { settings, item }
}

const isOutcome = (v: Ready | OcrOutcome): v is OcrOutcome => 'status' in v

async function recognize(p: Pipeline, kind: OcrKind): Promise<OcrOutcome> {
  const signal = p.ctrl.signal
  let settings: Settings | undefined
  const ask = async (image: Blob): Promise<VisionReply | OcrOutcome> => {
    const ready = await ensureAllowed(p, true)
    if (isOutcome(ready)) return ready
    settings = ready.settings
    const reply = await recognizeImage(image, ready.settings, signal)
    if (!p.manual) failStreak = 0
    return reply
  }

  try {
    const ready = await ensureAllowed(p, false)
    if (isOutcome(ready)) return ready
    settings = ready.settings
    const file = await getFile(ready.item.fileId!)
    if (!file) {
      await markVisionTried(p.id)
      return failed('Файл не найден')
    }

    let text = ''
    let truncated = false
    let pages: OcrOutcome['pages']
    if (kind === 'image') {
      const prepared = await prepareVisionImage(file.blob)
      if (signal.aborted) throw ABORTED
      if (prepared.status === 'failed') {
        await markVisionTried(p.id)
        return failed(prepared.error)
      }
      if (prepared.status === 'ok') {
        const reply = await ask(prepared.image)
        if (!('text' in reply)) return reply
        text = reply.text
        truncated = reply.truncated
      } else if (prepared.status === 'tiles') {
        // Длинный скриншот полосами: как страницы PDF — каждая полоса отдельный запрос, тексты склеиваются.
        if (!p.manual && autoRequests + prepared.images.length > VISION_AUTO_SESSION_LIMIT) {
          haltAuto({ kind: 'limit' }, settings, '')
          return skipped()
        }
        const parts: string[] = []
        for (const image of prepared.images) {
          const reply = await ask(image)
          if (!('text' in reply)) return reply
          if (reply.text) parts.push(reply.text)
          if (reply.truncated) truncated = true
        }
        text = parts.join('\n\n')
      }
      // too-small: распознавать нечего — итог «текста нет»
    } else {
      const opened = await openPdfPages(file.blob, { signal })
      if (opened.status === 'aborted') throw ABORTED
      if (opened.status === 'failed') {
        if (opened.permanent) await markVisionTried(p.id)
        // Временный отказ (время, worker): авто в этом сеансе документ больше не берёт, иначе каждый обход
        // задела снова читал бы файл до 50 МБ и занимал бы порцию. Это не сбой сервиса — серия не растёт.
        else if (!p.manual) autoSkip.add(p.id)
        return failed(opened.error)
      }
      const doc = opened.doc
      try {
        // Не начинать документ, который не уложится в предел сеанса: отправленные страницы пропали бы зря.
        if (!p.manual && autoRequests + doc.count > VISION_AUTO_SESSION_LIMIT) {
          haltAuto({ kind: 'limit' }, settings, '')
          return skipped()
        }
        const parts: string[] = []
        for (let n = 1; n <= doc.count; n++) {
          p.page = n
          p.pages = doc.count
          publish(p)
          let image: Blob
          try {
            image = await doc.page(n)
          } catch (e) {
            if (signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw ABORTED
            // Сбой растеризации (битая страница, тяжёлый JPX/JBIG2 не укладывается во время) повторится с тем
            // же файлом: отметка вместо повторной отправки страниц 1…n-1 в каждом сеансе.
            throw new VisionError('item', describeError(e, 'Не удалось подготовить страницу PDF'))
          }
          const reply = await ask(image)
          if (!('text' in reply)) return reply
          if (reply.text) parts.push(reply.text)
          if (reply.truncated) truncated = true
        }
        text = parts.join('\n\n')
        pages = { read: doc.count, total: doc.total }
      } finally {
        await doc.close()
      }
    }

    if (signal.aborted) throw ABORTED
    const clean = cleanOcrText(text)
    if (text.length > MAX_OCR_TEXT) truncated = true
    if (!(await setVisionText(p.id, clean))) return skipped()
    const outcome: OcrOutcome = { status: clean ? 'ok' : 'empty', via: 'vision' }
    if (pages) outcome.pages = pages
    if (clean && truncated) outcome.truncated = true
    return outcome
  } catch (e) {
    if (e === ABORTED || signal.aborted) return skipped()
    return visionFailure(p, e, settings)
  }
}

/** Ошибка распознавания: отметка и остановка авто — по виду ошибки (Р8). */
async function visionFailure(p: Pipeline, e: unknown, settings: Settings | undefined): Promise<OcrOutcome> {
  const error = describeError(e, 'Не удалось распознать текст')
  const kind = e instanceof VisionError ? e.kind : 'transient'
  if (kind === 'item') {
    // Повтор с тем же файлом даст то же: отметка, чтобы авто его больше не брало.
    try {
      await markVisionTried(p.id)
    } catch {
      // отметка — уборка, итог тот же
    }
    return failed(error)
  }
  if (!p.manual) {
    if (kind === 'config' && e instanceof VisionError && e.unknown) {
      // Непонятный 400/422: может быть и картинка, и настройка. Запись — до конца сеанса в сторону;
      // настройкой считается только серия таких ошибок на разных записях.
      autoSkip.add(p.id)
      if (++failStreak >= VISION_AUTO_FAIL_STREAK && settings) {
        haltAuto({ kind: 'config', fingerprint: fingerprint(settings) }, settings, error)
      }
    } else if (kind === 'config') {
      if (settings) haltAuto({ kind: 'config', fingerprint: fingerprint(settings) }, settings, error)
    } else {
      autoSkip.add(p.id)
      if (e instanceof VisionError && e.status === 429) {
        haltAuto({ kind: 'pause', until: Date.now() + VISION_RATE_PAUSE_MS }, settings, error)
      } else if (++failStreak >= VISION_AUTO_FAIL_STREAK) {
        haltAuto({ kind: 'pause', until: Date.now() + VISION_AUTO_COOLDOWN_MS }, settings, error)
      }
    }
  }
  return failed(error)
}

// ───────────────────────── задел автораспознавания ─────────────────────────

/**
 * Ставит в фоновую очередь записи, ждущие распознавания (isVisionBacklog): из мини-окна, сканы после
 * drainPdfBackfill, после сбоя сети в прошлом сеансе. Только при включённом автораспознавании и не
 * остановленном авто; не больше VISION_BACKLOG_BATCH. Возвращает, сколько поставлено. Не бросает.
 * Не берёт: созданное до aiAutoOcrSince (отсчёт сдвигается и при повторном включении ИИ, и при смене
 * хоста — db/settings), импортированное и отменённое пользователем (ocrAutoSkipAt).
 */
export async function drainVisionBacklog(): Promise<number> {
  if (isCaptureWindow()) return 0
  try {
    const settings = await getSettings()
    const since = settings.aiAutoOcrSince
    if (!settings.aiEnabled || !settings.aiAutoOcr || !(since > 0)) return 0
    if (visionAvailability(settings) !== null || autoHalted(settings)) return 0
    // По индексу с since: старые записи (их большинство) курсором не перебираются.
    const items = await db.items
      .where('createdAt')
      .aboveOrEqual(since)
      .filter((it) => isVisionBacklog(it, since) && !autoSkip.has(it.id) && !pipelines.has(it.id))
      .limit(VISION_BACKLOG_BATCH)
      .toArray()
    for (const item of items) void extractItemText(item, { vision: true })
    return items.length
  } catch (e) {
    console.warn('QuickDrop: не удалось разобрать задел распознавания', e)
    return 0
  }
}

let autoStarted = false

/**
 * Запускает разбор задела в главном окне: через VISION_AUTO_START_DELAY_MS после старта, затем при
 * возвращении к окну (visibilitychange → visible, focus), не чаще VISION_BACKLOG_MIN_GAP_MS.
 * Вне главного окна и повторно — ничего.
 */
export function startVisionAuto(): void {
  if (autoStarted || isCaptureWindow() || typeof window === 'undefined') return
  autoStarted = true
  let ready = false
  let lastDrainAt = Number.NEGATIVE_INFINITY
  const drain = () => {
    if (!ready) return
    const now = Date.now()
    if (now - lastDrainAt < VISION_BACKLOG_MIN_GAP_MS) return
    lastDrainAt = now
    void drainVisionBacklog()
  }
  window.setTimeout(() => {
    ready = true
    drain()
  }, VISION_AUTO_START_DELAY_MS)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') drain()
    })
  }
  window.addEventListener('focus', drain)
}

/**
 * Для тестов: прервать все задачи и забыть состояние сеанса (очереди, пределы, остановки). Задачи
 * прежнего «поколения», если ещё доработают, исполнителя у новых не отнимут.
 */
export function resetOcrSession(): void {
  generation++
  for (const p of [...pipelines.values()]) p.ctrl.abort()
  pipelines.clear()
  for (const w of [...manualQueue.splice(0), ...autoQueue.splice(0)]) w.reject(ABORTED)
  visionBusy = false
  queueTail = Promise.resolve()
  autoHalt = null
  lastAutoRequestAt = Number.NEGATIVE_INFINITY
  autoRequests = 0
  failStreak = 0
  autoSkip.clear()
  triedThisSession.clear()
  autoStarted = false
  if (slotTimer !== undefined) clearTimeout(slotTimer)
  slotTimer = undefined
  if (resumeTimer !== undefined) clearTimeout(resumeTimer)
  resumeTimer = undefined
}

// ───────────────────────── фоновый обход PDF ─────────────────────────

/** Записи, которые обход в этом сеансе уже пробовал без успеха: до перезапуска к ним не возвращается. */
const triedThisSession = new Set<string>()

async function backfillStep(limit: number): Promise<{ done: number; tried: number }> {
  if (!Number.isFinite(limit) || limit < 1) return { done: 0, tried: 0 }
  const max = Math.floor(limit)
  try {
    // Без .limit(): иначе записи, которые не удаётся разобрать, навсегда занимали бы начало выборки.
    const pending = await db.items
      .filter(
        (it) =>
          it.deletedAt === undefined &&
          it.ocrAt === undefined &&
          textSourceOf(it) === 'pdf' &&
          !triedThisSession.has(it.id),
      )
      .toArray()
    let done = 0
    let failures = 0
    let tried = 0
    for (const item of pending) {
      if (done >= max || failures >= max) break
      tried++
      const { status } = await extractItemText(item)
      if (status === 'ok' || status === 'empty') {
        done++
      } else {
        failures++
        triedThisSession.add(item.id)
      }
    }
    return { done, tried }
  } catch (e) {
    console.warn('QuickDrop: не удалось извлечь текст из PDF', e)
    return { done: 0, tried: 0 }
  }
}

/**
 * Извлекает текст у PDF-записей, с которыми этого ещё не делали (включая архив, без корзины):
 * по одной, не больше limit обработанных за вызов (и не больше limit неудач). Возвращает число
 * обработанных (текст извлечён или его нет).
 */
export async function backfillPdfText(limit: number = BACKFILL_PDF_LIMIT): Promise<number> {
  return (await backfillStep(limit)).done
}

let draining = false

/**
 * Обход порциями по BACKFILL_PDF_LIMIT с паузой, пока есть что пробовать. Завершается: каждая
 * попытка либо ставит записи ocrAt, либо исключает её до конца сеанса. Возвращает число обработанных.
 */
export async function drainPdfBackfill(pauseMs: number = BACKFILL_PAUSE_MS): Promise<number> {
  if (draining) return 0
  draining = true
  let total = 0
  try {
    for (;;) {
      const { done, tried } = await backfillStep(BACKFILL_PDF_LIMIT)
      total += done
      if (tried === 0) return total
      await new Promise((resolve) => setTimeout(resolve, pauseMs))
    }
  } finally {
    draining = false
  }
}
