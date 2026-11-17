import type { AiMeta, Item, Settings } from '@/types'
import { blobToBase64 } from '@/lib/exportImport'
import { normalizeTag } from '@/lib/normalize'
import { VISION_MAX_IMAGE_BYTES } from '@/lib/ocrState'

const MAX_CONTENT = 6000
const MAX_TAGS = 8

const SYSTEM_PROMPT = `Ты помощник для организации личной базы знаний. По описанию записи верни ТОЛЬКО JSON вида {"title": string, "summary": string, "tags": string[]}.
- title: короткий заголовок, до 70 символов;
- summary: описание в 1–2 предложения;
- tags: от 3 до 6 тегов в нижнем регистре, без «#».
Пиши на языке записи (по умолчанию — по-русски).`

/** Теги из ответа модели: те же правила, что в репозитории, не больше MAX_TAGS. */
export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const t of raw) {
    if (typeof t !== 'string') continue
    const n = normalizeTag(t)
    if (n && !out.includes(n)) out.push(n)
    if (out.length >= MAX_TAGS) break
  }
  return out
}

type AiObject = Record<string, unknown>

const isObject = (v: unknown): v is AiObject => typeof v === 'object' && v !== null && !Array.isArray(v)

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return undefined
  }
}

/**
 * Достаёт JSON-объект из ответа модели, даже если он обёрнут в ```-блок или окружён текстом.
 * Бросает понятную ошибку, если объекта нет: валидный, но не объектный ответ (null, массив,
 * строка) иначе ронял бы разбор полей TypeError'ом.
 */
export function parseAiJson(text: string): AiObject {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const body = (fenced ? fenced[1] : text).trim()
  const whole = tryParse(body)
  if (isObject(whole)) return whole
  const a = body.indexOf('{')
  const b = body.lastIndexOf('}')
  if (a >= 0 && b > a) {
    const inner = tryParse(body.slice(a, b + 1))
    if (isObject(inner)) return inner
  }
  throw new Error('Не удалось разобрать ответ ИИ')
}

/** Поля записи, которые уходят в запрос: у ещё не сохранённой записи (форма добавления) остальных нет. */
export type SuggestSource = Pick<Item, 'type' | 'content'> &
  Partial<Pick<Item, 'url' | 'linkMeta' | 'title' | 'fileName' | 'language'>>

function buildUserPrompt(item: SuggestSource): string {
  const parts = [`Тип: ${item.type}`]
  if (item.url) parts.push(`URL: ${item.url}`)
  if (item.linkMeta?.title) parts.push(`Заголовок страницы: ${item.linkMeta.title}`)
  if (item.linkMeta?.description) parts.push(`Описание страницы: ${item.linkMeta.description}`)
  if (item.title) parts.push(`Текущий заголовок: ${item.title}`)
  if (item.fileName) parts.push(`Имя файла: ${item.fileName}`)
  if (item.language) parts.push(`Язык кода: ${item.language}`)
  // Бинарное содержимое файлов не отправляем — только текстовое поле content.
  const content = item.content ?? ''
  if (content.trim()) parts.push(`Содержимое:\n${content.slice(0, MAX_CONTENT)}`)
  return parts.join('\n')
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Ключ и текст записей уходят на этот адрес: открытый http допустим только для локальных моделей.
 * null — адрес годится, иначе текст ошибки. Хост берётся разбором URL, а не регуляркой:
 * «http://localhost:80@evil.example» ведёт на evil.example.
 */
export function aiBaseUrlError(raw: string): string | null {
  let url: URL | undefined
  try {
    url = new URL(raw.trim())
  } catch {
    url = undefined
  }
  if (url?.protocol === 'https:') return null
  if (url?.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)) return null
  return 'Адрес должен начинаться с https:// (http:// — только для localhost)'
}

function httpError(status: number, body: string): Error {
  if (status === 401 || status === 403) return new Error('Неверный API-ключ (401)')
  if (status === 429) return new Error('Превышен лимит запросов к ИИ (429), попробуйте позже')
  return new Error(`Ошибка ИИ-сервиса ${status}: ${body.slice(0, 200)}`)
}

export async function suggestForItem(
  item: SuggestSource,
  settings: Settings,
  signal?: AbortSignal,
): Promise<AiMeta> {
  if (!settings.aiEnabled || !settings.aiApiKey.trim()) {
    throw new Error('AI-помощник не настроен')
  }
  const badUrl = aiBaseUrlError(settings.aiBaseUrl)
  if (badUrl) throw new Error(badUrl)
  const url = `${settings.aiBaseUrl.trim().replace(/\/+$/, '')}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    signal,
    // Перенаправление увело бы ключ и текст записи на адрес, который пользователь не задавал.
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.aiApiKey.trim()}`,
    },
    body: JSON.stringify({
      model: settings.aiModel,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(item) },
      ],
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw httpError(res.status, text)
  }
  // Не-JSON или JSON null вместо ответа сервиса — та же понятная ошибка, а не TypeError.
  const data = (await res.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: unknown } }>
  } | null
  const text = data?.choices?.[0]?.message?.content
  if (typeof text !== 'string' || !text) throw new Error('ИИ вернул пустой ответ')
  const parsed = parseAiJson(text)
  const title = typeof parsed.title === 'string' ? parsed.title.trim().slice(0, 70) : ''
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
  return {
    suggestedTitle: title || undefined,
    summary: summary || undefined,
    suggestedTags: normalizeTags(parsed.tags),
    model: settings.aiModel,
    generatedAt: Date.now(),
  }
}

// ───────────────────────── распознавание текста на изображении ─────────────────────────

export const VISION_TIMEOUT_MS = 120_000

/**
 * config — настройки или модель не годятся (авто останавливается, отметки нет); item — дело в самом
 * изображении (ставится отметка, повторов нет); transient — сеть, лимит, сбой сервиса, время (отметки нет).
 */
export type VisionErrorKind = 'config' | 'item' | 'transient'

export class VisionError extends Error {
  kind: VisionErrorKind
  /** HTTP-статус ответа, если ошибка пришла от сервиса. */
  status?: number
  /**
   * Вид не опознан по ответу (400/422 без признаков): config, но фоновая задача останавливает авто только
   * после серии таких ошибок на разных записях — одна странная картинка не должна выключать всё.
   */
  unknown?: boolean

  constructor(kind: VisionErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'VisionError'
    this.kind = kind
    if (status !== undefined) this.status = status
  }
}

/** Модель для распознавания: aiVisionModel, пусто — aiModel. */
export function visionModelOf(settings: Pick<Settings, 'aiVisionModel' | 'aiModel'>): string {
  return settings.aiVisionModel.trim() || settings.aiModel.trim()
}

/** null — распознавать можно; иначе причина по-русски. Те же условия, что у suggestForItem, плюс модель не пуста. */
export function visionAvailability(settings: Settings): string | null {
  if (!settings.aiEnabled) return 'Включите ИИ-помощника в настройках'
  if (!settings.aiApiKey.trim()) return 'Укажите API-ключ в «Настройки → ИИ-помощник»'
  const badUrl = aiBaseUrlError(settings.aiBaseUrl)
  if (badUrl) return badUrl
  if (!visionModelOf(settings)) return 'Укажите модель в «Настройки → ИИ-помощник»'
  return null
}

const HOST_LABEL_MAX = 60

/** Хост (с портом) из адреса API — для текста «изображение отправится на …». Негодный адрес → исходная строка, до 60 символов. */
export function aiHostLabel(baseUrl: string): string {
  const raw = baseUrl.trim()
  try {
    // host — с портом и без логина/пароля из адреса.
    const host = new URL(raw).host
    if (host) return host
  } catch {
    // ниже — исходная строка
  }
  return raw.slice(0, HOST_LABEL_MAX)
}

const VISION_PROMPT =
  'Ты распознаёшь текст на изображениях. Верни ТОЛЬКО текст с изображения: без пояснений, без перевода, ' +
  'на языке оригинала, сохраняя порядок чтения, строки и абзацы. Ячейки таблиц разделяй « | ». ' +
  'Картинку не описывай. Если текста на изображении нет, ответь ровно: NO_TEXT'

const VISION_USER_TEXT = 'Распознай текст на изображении.'

const VISION_TYPES = new Set(['image/jpeg', 'image/png'])

export interface VisionReply {
  text: string
  /** Модель оборвала ответ (finish_reason length). */
  truncated: boolean
  model: string
}

const FENCED = /^```[^\n`]*\n([\s\S]*?)\n?[ \t]*```$/
/** Строка-ограда внутри: ответ — несколько блоков с текстом между ними, а не один блок в ограде. */
const INNER_FENCE = /^[ \t]*```/m
const NO_TEXT = /^[\s"'«»„“”`*._:-]*no[_ ]?text[\s"'«»„“”`*.!_:-]*$/i
/** Рассуждения локальных моделей (DeepSeek-R1, Qwen и т.п.) — не текст изображения. */
const THINK = /<think>[\s\S]*?<\/think>/gi

/**
 * Блоки <think>…</think> убираются; trim; ответ целиком в одной ограде ``` — ограда снимается;
 * NO_TEXT (в кавычках, с точкой, в ограде) → ''.
 */
export function cleanVisionAnswer(raw: string): string {
  let text = raw.replace(THINK, '').trim()
  const fenced = FENCED.exec(text)
  if (fenced && !INNER_FENCE.test(fenced[1])) text = fenced[1].trim()
  if (NO_TEXT.test(text)) return ''
  return text
}

const isAbort = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError'

/**
 * Тело ответа об ошибке — не больше 500 символов; ключ, если сервис его повторил, вычёркивается.
 * Тело не читается — пустая строка (статус важнее), но прерывание и истёкшее время идут наружу.
 */
async function errorBody(res: Response, apiKey: string, signal: AbortSignal): Promise<string> {
  let text: string
  try {
    text = (await res.text()).slice(0, 500)
  } catch (e) {
    if (signal.aborted || isAbort(e)) throw e
    return ''
  }
  return apiKey ? text.split(apiKey).join('***') : text
}

/**
 * Отказ из-за самого изображения (размер, битые данные, формат): повтор с тем же файлом даст то же.
 * Проверяется раньше VISION_REJECTED — в таких ответах почти всегда есть слово «image».
 */
const IMAGE_REJECTED =
  /too (large|big)|exceed|max(imum)? (size|dimension)|dimension|invalid (image|base64)|unsupported image|image format|image_parse|could not (process|decode|read)|unable to (process|decode|read)|corrupt|malformed image/i
/** Модель не принимает изображения вообще — ошибка настройки. */
const VISION_REJECTED =
  /(not|n't) support(s|ed)? (image|vision|multi-?modal)|image(_url)?( input)?( is)? (not |un)supported|only supported|multi-?modal|unknown variant|content.{0,40}(string|array)/i

function visionHttpError(status: number, body: string, model: string): VisionError {
  if (status === 401 || status === 403) return new VisionError('config', 'Неверный API-ключ (401)', status)
  if (status === 404) {
    return new VisionError('config', `Модель «${model}» или адрес API не найдены (404)`, status)
  }
  if (status === 400 || status === 415 || status === 422) {
    if (IMAGE_REJECTED.test(body)) {
      return new VisionError('item', `Сервис ИИ не смог обработать это изображение (${status})`, status)
    }
    if (VISION_REJECTED.test(body)) {
      return new VisionError(
        'config',
        `Модель «${model}» не принимает изображения. Укажите модель со зрением в «Настройки → ИИ-помощник»`,
        status,
      )
    }
  }
  if (status === 413) return new VisionError('item', 'Изображение слишком большое для сервиса ИИ (413)', status)
  if (status === 429) {
    return new VisionError('transient', 'Превышен лимит запросов к ИИ (429), попробуйте позже', status)
  }
  if (status >= 500) return new VisionError('transient', `Сервис ИИ временно недоступен (${status})`, status)
  if (status === 408) return new VisionError('transient', 'ИИ не ответил вовремя (408)', status)
  const other = new VisionError('config', `Ошибка ИИ-сервиса ${status}: ${body.slice(0, 200)}`, status)
  // 402 (оплата) и прочие 4xx — настройка или счёт; 400/422 без признаков — может быть и сама картинка.
  if (status === 400 || status === 422) other.unknown = true
  return other
}

type VisionData = {
  choices?: Array<{ message?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown }>
} | null

/** content ответа: строка либо массив частей ({ type: 'text', text }); части склеиваются. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const part of content) {
    if (typeof part === 'string') {
      out += part
      continue
    }
    if (typeof part !== 'object' || part === null) continue
    const { type, text } = part as { type?: unknown; text?: unknown }
    if (typeof text === 'string' && (type === undefined || type === 'text')) out += text
  }
  return out
}

/**
 * Распознаёт текст на подготовленном изображении (JPEG или PNG) моделью со зрением.
 * Единственная функция приложения, отправляющая изображение: проверка «ИИ включён и настроен» — первым делом,
 * до чтения изображения и до сети. Ошибки — VisionError; прерывание вызывающим — исходный AbortError.
 */
export async function recognizeImage(image: Blob, settings: Settings, signal?: AbortSignal): Promise<VisionReply> {
  const blocked = visionAvailability(settings)
  if (blocked) throw new VisionError('config', blocked)
  if (!VISION_TYPES.has(image.type)) throw new VisionError('item', 'Изображение не подготовлено к отправке')
  if (image.size > VISION_MAX_IMAGE_BYTES) {
    throw new VisionError('item', 'Изображение слишком большое для распознавания')
  }
  signal?.throwIfAborted()

  const model = visionModelOf(settings)
  const apiKey = settings.aiApiKey.trim()
  const dataUrl = `data:${image.type};base64,${await blobToBase64(image)}`
  signal?.throwIfAborted()

  const url = `${settings.aiBaseUrl.trim().replace(/\/+$/, '')}/chat/completions`
  const messages = [
    { role: 'system', content: VISION_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: VISION_USER_TEXT },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
  ]

  // Один предел времени на весь вызов (вместе с повтором): ожидание ответа и чтение тела.
  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, VISION_TIMEOUT_MS)
  const onAbort = () => ctrl.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })

  const send = (withTemperature: boolean) =>
    fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      // Перенаправление увело бы ключ и изображение на адрес, который пользователь не задавал (в т.ч. на http).
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      // Без response_format, max_tokens и detail: у провайдеров разные имена и допустимые значения.
      body: JSON.stringify(withTemperature ? { model, temperature: 0, messages } : { model, messages }),
    })

  try {
    let res = await send(true)
    if (res.status === 400) {
      const body = await errorBody(res, apiKey, ctrl.signal)
      // Часть моделей (рассуждающие) отвергает temperature — ровно один повтор без неё.
      if (!/temperature/i.test(body)) throw visionHttpError(res.status, body, model)
      res = await send(false)
    }
    if (!res.ok) throw visionHttpError(res.status, await errorBody(res, apiKey, ctrl.signal), model)

    let data: VisionData
    try {
      data = (await res.json()) as VisionData
    } catch (e) {
      if (timedOut || signal?.aborted || isAbort(e)) throw e
      throw new VisionError('transient', 'ИИ вернул непонятный ответ')
    }
    const choices = data?.choices
    const choice = Array.isArray(choices) ? choices[0] : undefined
    if (typeof choice !== 'object' || choice === null) {
      throw new VisionError('transient', 'ИИ вернул непонятный ответ')
    }
    if (choice.finish_reason === 'content_filter') {
      throw new VisionError('item', 'Сервис ИИ отказался обрабатывать изображение')
    }
    const content = contentText(choice.message?.content)
    const refusal = choice.message?.refusal
    // Отказ модели (поле refusal при пустом content) — не «текста нет»: распознавание не состоялось.
    if (!content.trim() && typeof refusal === 'string' && refusal.trim()) {
      throw new VisionError('item', 'Модель отказалась распознавать изображение')
    }
    return {
      text: cleanVisionAnswer(content),
      truncated: choice.finish_reason === 'length',
      model,
    }
  } catch (e) {
    if (e instanceof VisionError) throw e
    // Прерывание вызывающим важнее: задача отменена, а не «время вышло».
    if (signal?.aborted) throw e
    if (timedOut) throw new VisionError('transient', 'ИИ не ответил за 2 минуты')
    throw new VisionError('transient', 'Нет связи с сервисом ИИ: проверьте адрес API и подключение к сети')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
