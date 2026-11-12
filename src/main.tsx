import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyInitialHash } from './components/layout/AppShell'
import './pwa'
import { initDesktop } from './lib/desktop'
import { drainPdfBackfill } from './lib/ocr'
import { startTrashCleanup } from './lib/trashCleanup'

applyInitialHash()
void initDesktop()
startTrashCleanup()
// Текст из PDF, добавленных до появления извлечения или пришедших из копии: не на старте, чтобы
// не мешать первому экрану; порциями с паузами, пока не пройдены все.
window.setTimeout(() => void drainPdfBackfill(), 10_000)

createRoot(document.getElementById('root')!, {
  onUncaughtError: (error) => console.error('QuickDrop: необработанная ошибка', error),
}).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
