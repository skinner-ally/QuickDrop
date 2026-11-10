# platform-pwa
Статус: готово
Результат: PWA на vite-plugin-pwa (autoUpdate, precache, navigateFallback), manifest (shortcut, share_target), иконки (sharp, npm run icons), meta в index.html, src/pwa.ts (SW не в Tauri, ?capture=1, share params, тихий persist, toast после обновления).
Файлы: vite.config.ts, index.html, public/{icon,favicon}.svg, public/pwa-*.png, apple-touch-icon.png, scripts/gen-icons.mjs, package.json (script icons, sharp), src/pwa.ts, src/main.tsx (import './pwa'), tsconfig.app.json, CLAUDE.md.
Проверено: vite build -> sw.js + manifest.webmanifest; TAURI_ENV_PLATFORM=windows -> сборка проходит, sw.js нет; tsc -b чист при наличии src/lib/desktop.ts (другой агент).
