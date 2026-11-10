// PWA: регистрация service worker, обработка ярлыка/«Поделиться», тихий persist().
// В Tauri (TAURI_ENV_PLATFORM) плагин отключён, SW не регистрируется.
import { toast } from 'sonner'
import { useUi } from '@/store/ui'

const UPDATED_FLAG = 'qd-sw-updated'

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

/** Параметры запуска: ярлык «Быстрая запись» и share_target (Android). */
function handleLaunchParams() {
  const params = new URLSearchParams(location.search)
  const capture = params.has('capture')
  const shared = ['title', 'text', 'url']
    .map((k) => params.get(k)?.trim())
    .filter((v): v is string => !!v)
  if (!capture && shared.length === 0) return

  // text часто содержит и ссылку; не дублируем url, если она уже в тексте
  const uniq = shared.filter((v, i) => shared.indexOf(v) === i && !shared.some((o, j) => j !== i && o.includes(v) && o.length > v.length))
  const text = uniq.join('\n')

  for (const k of ['capture', 'title', 'text', 'url']) params.delete(k)
  const rest = params.toString()
  history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash)

  if (text) useUi.getState().openCapture({ text })
  else useUi.getState().openCapture()
}

function registerServiceWorker() {
  if (isTauri() || !('serviceWorker' in navigator)) return
  // Обновление SW перезагружает страницу (autoUpdate): флаг переживёт перезагрузку
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      try {
        localStorage.setItem(UPDATED_FLAG, '1')
      } catch {
        /* ignore */
      }
    })
  }
  void import('virtual:pwa-register')
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => {})
}

function announceUpdate() {
  try {
    if (localStorage.getItem(UPDATED_FLAG)) {
      localStorage.removeItem(UPDATED_FLAG)
      toast('Приложение обновлено')
    }
  } catch {
    /* ignore */
  }
}

function persistQuietly() {
  if (!isStandalone() || !navigator.storage?.persist) return
  navigator.storage.persist().catch(() => {})
}

try {
  handleLaunchParams()
} catch {
  /* ignore */
}
registerServiceWorker()
announceUpdate()
persistQuietly()
