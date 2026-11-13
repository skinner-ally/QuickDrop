import { DEFAULT_PORT, loadConfig, ping, portError, saveConfig, tokenError } from './shared.js'

const $ = (id) => document.getElementById(id)
const portEl = $('port')
const tokenEl = $('token')
const statusEl = $('status')

function setStatus(text, kind = '') {
  statusEl.textContent = text
  statusEl.className = kind ? `status ${kind}` : 'status'
}

function values() {
  return { port: portEl.value.trim(), token: tokenEl.value.trim() }
}

/** Показывает ошибки полей; true, если всё верно. */
function validate() {
  const { port, token } = values()
  const pe = portError(port)
  const te = tokenError(token)
  $('port-error').textContent = pe ?? ''
  $('token-error').textContent = te ?? ''
  portEl.setAttribute('aria-invalid', pe ? 'true' : 'false')
  tokenEl.setAttribute('aria-invalid', te ? 'true' : 'false')
  return !pe && !te
}

async function init() {
  const cfg = await loadConfig()
  portEl.value = String(cfg.port || DEFAULT_PORT)
  tokenEl.value = cfg.token
}

$('toggle').addEventListener('click', () => {
  const show = tokenEl.type === 'password'
  tokenEl.type = show ? 'text' : 'password'
  $('toggle').textContent = show ? 'Скрыть' : 'Показать'
  $('toggle').setAttribute('aria-pressed', String(show))
})

$('form').addEventListener('submit', async (e) => {
  e.preventDefault()
  setStatus('')
  if (!validate()) return
  try {
    await saveConfig(values())
    setStatus('Сохранено', 'ok')
  } catch {
    setStatus('Не удалось сохранить настройки', 'error')
  }
})

$('check').addEventListener('click', async () => {
  setStatus('')
  if (!validate()) return
  const btn = $('check')
  btn.disabled = true
  setStatus('Проверяю…')
  const r = await ping(values())
  btn.disabled = false
  if (r.ok) setStatus(`Соединение есть: QuickDrop ${r.version}`.trim(), 'ok')
  else setStatus(r.error, 'error')
})

void init()
