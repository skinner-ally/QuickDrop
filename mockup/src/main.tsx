import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyInitialHash } from './components/layout/AppShell'
import './pwa'
import { initDesktop } from './lib/desktop'
import { drainPdfBackfill, startVisionAuto } from './lib/ocr'
import { isTauri } from './lib/platform'
import { startTrashCleanup } from './lib/trashCleanup'

applyInitialHash()
void initDesktop()
// Приём записей от расширения браузера: нужен только оболочке, в веб-сборку отдельным чанком.
if (isTauri()) {
  void import('./lib/extInbox')
    .then((m) => m.startExtInbox())
    .catch((e: unknown) => console.warn('QuickDrop: приём от расширения не запущен', e))
}
startTrashCleanup()
// Текст из PDF, добавленных до появления извлечения или пришедших из копии: не на старте, чтобы
// не мешать первому экрану; порциями с паузами, пока не пройдены все.
window.setTimeout(() => void drainPdfBackfill(), 10_000)
// Автораспознавание записей, оставшихся без текста (из мини-окна, сканы, после сбоя сети): только при
// включённой настройке, отложенно и при возвращении к окну.
startVisionAuto()

if (import.meta.env.DEV) {
  void import('./lib/devStress').then((m) => {
    ;(window as unknown as Record<string, unknown>).__qdStress = { seed: m.seedStress, remove: m.removeStress }
  })
}

createRoot(document.getElementById('root')!, {
  onUncaughtError: (error) => console.error('QuickDrop: необработанная ошибка', error),
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
