import type { AiMeta, Item, Settings } from '@/types'
import { normalizeTag } from '@/lib/normalize'

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

function buildUserPrompt(item: Item): string {
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
  item: Item,
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
