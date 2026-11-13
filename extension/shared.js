// Общий модуль расширения: настройки, проверки и отправка в QuickDrop.
// Единственный адрес, к которому обращается расширение, — http://127.0.0.1:{порт}.

export const DEFAULT_PORT = 47821

const URL_MAX = 2048
const TITLE_MAX = 300
const TEXT_MAX = 500_000
const BODY_MAX = 1_048_576
const TIMEOUT_MS = 20_000
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

const MSG = {
  noToken: 'Укажите токен в настройках расширения',
  badPage: 'Эту страницу сохранить нельзя',
  tooBig: 'Слишком большой текст',
  emptySelection: 'Выделенный текст пуст',
  offline: 'QuickDrop не запущен или приём выключен',
  timeout: 'QuickDrop не ответил',
  badToken: 'Неверный токен. Скопируйте его заново из настроек QuickDrop',
  rejected: 'QuickDrop отклонил запрос',
  rate: 'Слишком часто. Повторите через несколько секунд',
  badAnswer: 'Неожиданный ответ. Проверьте, что порт указан верно',
}

/** { port, token } из chrome.storage.local (не sync: токен не должен уходить в аккаунт). */
export async function loadConfig() {
  const raw = await chrome.storage.local.get({ port: DEFAULT_PORT, token: '' })
  const port = Number(raw.port)
  return {
    port: Number.isInteger(port) ? port : DEFAULT_PORT,
    token: typeof raw.token === 'string' ? raw.token : '',
  }
}

export async function saveConfig({ port, token }) {
  await chrome.storage.local.set({ port: Number(port), token: String(token).trim() })
}

/** null или текст ошибки: целое число 1024–65535. */
export function portError(value) {
  const s = String(value ?? '').trim()
  if (!/^\d{1,5}$/.test(s)) return 'Порт должен быть целым числом от 1024 до 65535'
  const n = Number(s)
  return n >= 1024 && n <= 65535 ? null : 'Порт должен быть от 1024 до 65535'
}

/** null или текст ошибки: ровно 43 символа A–Z a–z 0–9 _ -. */
export function tokenError(value) {
  const s = String(value ?? '').trim()
  if (!s) return MSG.noToken
  return TOKEN_RE.test(s) ? null : 'Токен должен состоять из 43 символов: латинские буквы, цифры, «-» и «_»'
}

function isWebUrl(value) {
  if (typeof value !== 'string') return false
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function cleanTitle(title) {
  if (typeof title !== 'string') return undefined
  const t = title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX)
  return t || undefined
}

/** Подготовка и проверка тела до отправки: { body } или { error }. */
function buildBody(kind, { url, title, text } = {}) {
  const msg = { v: 1, kind }
  if (kind === 'page' || kind === 'link') {
    if (!isWebUrl(url)) return { error: MSG.badPage }
    if (url.length > URL_MAX) return { error: MSG.tooBig }
    msg.url = url
    // Заголовок ссылки неизвестен — приложение возьмёт его само.
    const t = cleanTitle(title)
    if (t && kind === 'page') msg.title = t
  } else if (kind === 'selection') {
    if (typeof text !== 'string' || !text.trim()) return { error: MSG.emptySelection }
    if (text.length > TEXT_MAX) return { error: MSG.tooBig }
    msg.text = text
    if (isWebUrl(url) && url.length <= URL_MAX) msg.url = url
    const t = cleanTitle(title)
    if (t) msg.title = t
  } else {
    return { error: MSG.rejected }
  }
  const body = JSON.stringify(msg)
  if (new TextEncoder().encode(body).length > BODY_MAX) return { error: MSG.tooBig }
  return { body }
}

function httpError(status, data) {
  switch (status) {
    case 401:
      return MSG.badToken
    case 403:
      return MSG.rejected
    case 413:
      return MSG.tooBig
    case 429:
      return MSG.rate
    default:
      return typeof data?.error === 'string' && data.error ? data.error.slice(0, 300) : `Ошибка ${status}`
  }
}

function networkError(e) {
  return e && (e.name === 'TimeoutError' || e.name === 'AbortError') ? MSG.timeout : MSG.offline
}

async function request(path, config, init) {
  const portErr = portError(config.port)
  if (portErr) return { error: portErr }
  const tokErr = tokenError(config.token)
  if (tokErr) return { error: tokErr }
  let res
  try {
    res = await fetch(`http://127.0.0.1:${Number(config.port)}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${String(config.token).trim()}`,
      },
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (e) {
    return { error: networkError(e) }
  }
  let data = null
  try {
    data = await res.json()
  } catch {
    // Тело не JSON — ниже сработает код ответа.
  }
  return { status: res.status, data }
}

/** Отправка записи. kind: 'page' | 'link' | 'selection'. → { ok: true, duplicate } | { ok: false, error } */
export async function send(kind, payload) {
  const built = buildBody(kind, payload)
  if (built.error) return { ok: false, error: built.error }
  const config = await loadConfig()
  const r = await request('/v1/capture', config, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: built.body,
  })
  if (r.error) return { ok: false, error: r.error }
  if (r.status === 200 && r.data?.ok === true) return { ok: true, duplicate: r.data.duplicate === true }
  return { ok: false, error: httpError(r.status, r.data) }
}

/** Проверка соединения. config — необязательно (по умолчанию сохранённые настройки). */
export async function ping(config) {
  const r = await request('/v1/ping', config ?? (await loadConfig()), { method: 'GET', headers: {} })
  if (r.error) return { ok: false, error: r.error }
  if (r.status === 200 && r.data?.ok === true && r.data.app === 'quickdrop') {
    const version = typeof r.data.version === 'string' ? r.data.version.slice(0, 32) : ''
    return { ok: true, version }
  }
  if (r.status === 200) return { ok: false, error: MSG.badAnswer }
  return { ok: false, error: httpError(r.status, r.data) }
}
