// Отдельная живая копия интерфейса для опытов с дизайном: свои исходники (mockup/src), свой порт и свой origin,
// а значит и своя IndexedDB — основное приложение (порт 5173) этот макет не видит и не портит.
// Запуск: из корня проекта `npm run mockup` (или preview_start «quickdrop-mockup»).
import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const here = import.meta.dirname
const pdfjsWasmDir = path.resolve(here, '../node_modules/pdfjs-dist/wasm')
const PDF_DECODERS = ['jbig2_nowasm_fallback.js', 'openjpeg_nowasm_fallback.js']

/** JS-декодеры сканов pdf.js — как в основном приложении (нужны только распознаванию PDF). */
function pdfDecoders(): Plugin {
  return {
    name: 'mockup:pdf-decoders',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split(/[?#]/)[0]
        const name = url.startsWith('/pdfjs/') ? url.slice('/pdfjs/'.length) : ''
        if (!PDF_DECODERS.includes(name)) return next()
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        res.end(fs.readFileSync(path.join(pdfjsWasmDir, name)))
      })
    },
  }
}

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss(), pdfDecoders()],
  resolve: {
    alias: {
      '@': path.resolve(here, './src'),
      // PWA-плагина в макете нет: регистрация service worker не нужна.
      'virtual:pwa-register': path.resolve(here, './pwa-register-stub.ts'),
    },
  },
  clearScreen: false,
  server: { port: 5174, strictPort: true, fs: { allow: [path.resolve(here, '..')] } },
  envPrefix: ['VITE_'],
})
