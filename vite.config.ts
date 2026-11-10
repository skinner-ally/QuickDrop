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

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    webCsp(),
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
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  // Tauri: фиксированный порт и не затирать вывод cargo
  clearScreen: false,
  server: { port: 5173, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
})
