import fs from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Tauri CLI задаёт TAURI_ENV_PLATFORM: в desktop service worker не нужен
const isTauriBuild = !!process.env.TAURI_ENV_PLATFORM

/**
 * Каталог размещения веб-версии: VITE_BASE=/quickdrop/ для GitHub Pages project site и т.п.
 * Tauri всегда грузит фронтенд из корня.
 */
function resolveBase(raw: string | undefined): string {
  const v = raw?.trim()
  if (isTauriBuild || !v || v === '/') return '/'
  return `/${v.replace(/^\/+|\/+$/g, '')}/`
}
const base = resolveBase(process.env.VITE_BASE)

/**
 * CSP веб-сборки. Для Tauri политика задаётся в tauri.conf.json: две политики пересекаются,
 * и meta-тег отрезал бы IPC (ipc:, http://ipc.localhost). frame-ancestors через meta не работает —
 * его можно выдать только заголовком хостинга.
 */
const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "img-src 'self' data: blob: https: http:",
  "media-src 'self' blob:",
  // ссылки (метаданные), прокси и AI — на адреса пользователя
  "connect-src 'self' https: http:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "worker-src 'self'",
  "manifest-src 'self'",
].join('; ')

/** Только сборка: в dev плагин React вставляет inline-преамбулу, которую script-src 'self' запретит. */
function webCsp(): Plugin {
  return {
    name: 'quickdrop:web-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () =>
        isTauriBuild
          ? []
          : [
              {
                tag: 'meta',
                attrs: { 'http-equiv': 'Content-Security-Policy', content: WEB_CSP },
                injectTo: 'head-prepend',
              },
            ],
    },
  }
}

/** JS-декодеры сканов pdf.js (JBIG2, CCITT, JPX): worker подгружает их из `{base}pdfjs/` (wasmUrl). */
const PDF_DECODERS = ['jbig2_nowasm_fallback.js', 'openjpeg_nowasm_fallback.js']
const PDF_DECODER_LICENSES = ['LICENSE_JBIG2', 'LICENSE_PDFJS_JBIG2', 'LICENSE_OPENJPEG', 'LICENSE_PDFJS_OPENJPEG']
const pdfjsWasmDir = path.resolve(import.meta.dirname, 'node_modules/pdfjs-dist/wasm')

/**
 * Кладёт декодеры в dist/pdfjs/ и их лицензии одним файлом в dist/licenses/, в dev отдаёт декодеры
 * сам (только по белому списку имён). WebAssembly не нужен (useWasm: false), CSP не меняется:
 * модуль подгружается worker'ом с того же origin.
 */
function pdfDecoders(): Plugin {
  return {
    name: 'quickdrop:pdf-decoders',
    configureServer(server) {
      const prefixes = [...new Set([`${base}pdfjs/`, '/pdfjs/'])]
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split(/[?#]/)[0]
        const prefix = prefixes.find((p) => url.startsWith(p))
        const name = prefix ? url.slice(prefix.length) : ''
        if (!PDF_DECODERS.includes(name)) {
          next()
          return
        }
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
        res.end(fs.readFileSync(path.join(pdfjsWasmDir, name)))
      })
    },
    generateBundle() {
      for (const name of PDF_DECODERS) {
        this.emitFile({
          type: 'asset',
          fileName: `pdfjs/${name}`,
          source: fs.readFileSync(path.join(pdfjsWasmDir, name)),
        })
      }
      const licenses = PDF_DECODER_LICENSES.map(
        (name) => `===== ${name} (pdfjs-dist/wasm) =====\n\n${fs.readFileSync(path.join(pdfjsWasmDir, name), 'utf8').trim()}\n`,
      )
      this.emitFile({
        type: 'asset',
        fileName: 'licenses/pdfjs-decoders-LICENSE.txt',
        source:
          'Декодеры сканов PDF (pdfjs/jbig2_nowasm_fallback.js, pdfjs/openjpeg_nowasm_fallback.js) из пакета pdfjs-dist.\n\n' +
          licenses.join('\n'),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    webCsp(),
    pdfDecoders(),
    // autoUpdate: данные лежат в IndexedDB и SW их не трогает. Перезагрузку после обновления
    // src/pwa.ts откладывает, пока пользователь что-то вводит.
    VitePWA({
      disable: isTauriBuild,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon.svg', 'apple-touch-icon.png'],
      devOptions: { enabled: false },
      manifest: {
        name: 'QuickDrop',
        short_name: 'QuickDrop',
        description: 'Одно место для заметок, ссылок, кода, идей и файлов. Работает офлайн.',
        lang: 'ru',
        dir: 'ltr',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        id: base,
        background_color: '#FBFAF8',
        theme_color: '#FBFAF8',
        categories: ['productivity', 'utilities'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
        shortcuts: [
          {
            name: 'Быстрая запись',
            short_name: 'Запись',
            description: 'Открыть быструю запись',
            url: `${base}?capture=1`,
            icons: [{ src: 'pwa-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
        share_target: {
          action: base,
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
      },
      workbox: {
        // txt — уведомление лицензии pixelfx (public/licenses): в кэше для офлайна и открывается сам, а не оболочкой.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,txt}'],
        // Декодеры сканов PDF нужны только распознаванию, а оно без сети невозможно: в precache не кладутся.
        globIgnores: ['**/node_modules/**/*', 'pdfjs/**'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/licenses\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  // Сборка для Tauri: вторая страница — мини-окно быстрой записи. В веб-сборку и precache PWA capture.html не попадает.
  ...(isTauriBuild
    ? {
        build: {
          rolldownOptions: {
            input: {
              main: path.resolve(import.meta.dirname, 'index.html'),
              capture: path.resolve(import.meta.dirname, 'capture.html'),
            },
          },
        },
      }
    : {}),
  // Tauri: фиксированный порт и не затирать вывод cargo
  clearScreen: false,
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
})
