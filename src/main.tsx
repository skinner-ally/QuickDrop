import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { applyInitialHash } from './components/layout/AppShell'
import './pwa'
import { initDesktop } from './lib/desktop'

applyInitialHash()
void initDesktop()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
