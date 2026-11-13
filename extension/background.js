// Service worker: контекстное меню, горячая команда и итог значком.
import { send } from './shared.js'

const DEFAULT_TITLE = 'Сохранить в QuickDrop'
const BADGE_MS = 2000
const COLOR_OK = '#2E7D4F'
const COLOR_FAIL = '#B3261E'

let badgeSeq = 0

function showResult(result) {
  const seq = ++badgeSeq
  const ok = result.ok
  const title = ok ? (result.duplicate ? 'Уже сохранено' : 'Сохранено в QuickDrop') : result.error
  chrome.action.setBadgeBackgroundColor({ color: ok ? COLOR_OK : COLOR_FAIL })
  chrome.action.setBadgeText({ text: ok ? 'OK' : '!' })
  chrome.action.setTitle({ title })
  // Новый итог не должен стираться таймером от предыдущего.
  setTimeout(() => {
    if (seq !== badgeSeq) return
    chrome.action.setBadgeText({ text: '' })
    chrome.action.setTitle({ title: DEFAULT_TITLE })
  }, BADGE_MS)
}

async function run(kind, payload) {
  try {
    showResult(await send(kind, payload))
  } catch {
    showResult({ ok: false, error: 'Не удалось сохранить' })
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'qd-page', title: 'Сохранить страницу в QuickDrop', contexts: ['page'] })
    chrome.contextMenus.create({ id: 'qd-link', title: 'Сохранить ссылку в QuickDrop', contexts: ['link'] })
    chrome.contextMenus.create({ id: 'qd-selection', title: 'Сохранить выделенное в QuickDrop', contexts: ['selection'] })
  })
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  switch (info.menuItemId) {
    case 'qd-page':
      void run('page', { url: tab?.url ?? info.pageUrl, title: tab?.title })
      break
    case 'qd-link':
      void run('link', { url: info.linkUrl })
      break
    case 'qd-selection':
      // Chrome отдаёт выделение одной строкой — переносы строк теряются.
      void run('selection', { url: info.pageUrl, title: tab?.title, text: info.selectionText })
      break
  }
})

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'save-page') return
  let target = tab
  if (!target) {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      target = tabs[0]
    } catch {
      target = undefined
    }
  }
  void run('page', { url: target?.url, title: target?.title })
})
