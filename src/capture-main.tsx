// Точка входа мини-окна быстрой записи (capture.html). Оболочка, списки, граф, фон, pwa, initDesktop и
// applyInitialHash сюда не попадают: окно только создаёт запись в общей IndexedDB.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/capture-window.css'
import { CaptureWindowApp } from './components/capture/CaptureWindowApp'

createRoot(document.getElementById('root')!, {
  onUncaughtError: (error) => console.error('QuickDrop: необработанная ошибка', error),
}).render(
  <StrictMode>
    <CaptureWindowApp />
  </StrictMode>,
)
