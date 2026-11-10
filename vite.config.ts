import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Tauri CLI задаёт TAURI_ENV_PLATFORM: в desktop service worker не нужен
const isTauriBuild = !!process.env.TAURI_ENV_PLATFORM

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // autoUpdate: данные лежат в IndexedDB и SW их не трогает, поэтому тихое обновление безопасно
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
        start_url: '/',
        scope: '/',
        id: '/',
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
            url: '/?capture=1',
            icons: [{ src: 'pwa-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
        share_target: {
          action: '/',
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
