import { loadConfig, send, tokenError } from './shared.js'

const $ = (id) => document.getElementById(id)
const saveBtn = $('save')
const statusEl = $('status')

function setStatus(text, kind = '') {
  statusEl.textContent = text
  statusEl.className = kind ? `status ${kind}` : 'status'
}

function isWeb(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url)
}

let tab

async function init() {
  $('open-options').addEventListener('click', (e) => {
    e.preventDefault()
    void chrome.runtime.openOptionsPage()
    window.close()
  })

  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    tab = tabs[0]
  } catch {
    tab = undefined
  }
  $('page-title').textContent = tab?.title || 'Без названия'
  $('page-url').textContent = tab?.url || ''

  if (!isWeb(tab?.url)) {
    saveBtn.disabled = true
    setStatus('Эту страницу сохранить нельзя', 'error')
    return
  }
  const { token } = await loadConfig()
  if (tokenError(token)) setStatus('Укажите токен в настройках расширения', 'warn')
}

saveBtn.addEventListener('click', async () => {
  if (!tab) return
  saveBtn.disabled = true
  setStatus('Сохраняю…')
  const r = await send('page', { url: tab.url, title: tab.title })
  if (r.ok) {
    setStatus(r.duplicate ? 'Уже сохранено' : 'Сохранено', 'ok')
    setTimeout(() => window.close(), 800)
  } else {
    setStatus(r.error, 'error')
    saveBtn.disabled = false
  }
})

void init()
