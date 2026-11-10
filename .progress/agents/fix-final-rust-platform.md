# fix-final-rust-platform

Задача: исправить находки финального ревью в области «rust-platform»
(src-tauri/**, vite.config.ts, src/pwa.ts, src/lib/desktop.ts, index.html, public/**, .github/**,
package.json, .gitignore, scripts/**).

Статус: готово

Проверки: `npx tsc -b` — 0 ошибок; `npm test` — 16 файлов, 465 тестов зелёные;
`cargo check` — ок; `cargo test --lib` — 6 тестов ок (+1 сетевой #[ignore], прогнан вручную — ок).
Веб-сборка с CSP проверена в headless Chrome: приложение рендерится, нарушений CSP в логе нет,
SW (registerSW из бандла) регистрируется и берёт управление, PDF по blob-ссылке открывается во встроенном
просмотрщике (object-src 'none' не мешает). Сборка с VITE_BASE=/quickdrop: все пути в index.html,
манифест и scope SW — от /quickdrop/.

## Находки
1. MEDIUM CSP веб-сборки — ИСПРАВЛЕНО.
   vite.config.ts: плагин `quickdrop:web-csp` (apply: 'build', только не-Tauri) вставляет meta CSP первым
   тегом head (политика из fixHint + media-src, manifest-src). index.html не менялся.
   tauri.conf.json: + `media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'`.
   ТРЕБУЕТ ЧУЖИХ ФАЙЛОВ (пункт 5 fixHint): src/lib/exportImport.ts (decodeFile) и src/db/repo.ts (добавление
   файла) — не хранить Blob с активными типами (text/html, application/xhtml+xml, image/svg+xml, text/xml,
   application/xml), приводить к application/octet-stream; FilePreview/safeFileUrl, судя по коду, уже
   переделаны другим агентом (PDF через Blob type application/pdf).
   frame-ancestors через meta невозможен — только заголовком хостинга (README).
2. HIGH автообновление SW стирает ввод — ИСПРАВЛЕНО.
   Новый src/lib/swReload.ts (createReloadGate, isUserBusy, isTextEntry) + src/lib/swReload.test.ts.
   src/pwa.ts: registerSW({ onNeedReload }) — без ввода перезагрузка сразу (как раньше); если открыта панель
   добавления, фокус в поле/contenteditable или открыт модальный диалог — перезагрузка откладывается до
   visibilitychange=hidden без ввода, показывается toast «Доступна новая версия» с кнопкой «Обновить».
   registerType остаётся autoUpdate (контракт CLAUDE.md), флаг qd-sw-updated сохранён.
   ТРЕБУЕТ ЧУЖОГО ФАЙЛА: src/components/capture/QuickCapture.tsx — писать черновик в sessionStorage по мере
   ввода (debounce 300–500 мс по text/title/tags/categoryId/manualType) и на pagehide.
3–4. HIGH dragDropEnabled (две находки) — ИСПРАВЛЕНО: `"dragDropEnabled": false` в app.windows[0].
   В собранном exe не проверено (нужна ручная проверка drop из Проводника в окно и в открытую панель).
5. MEDIUM base/подкаталог — ИСПРАВЛЕНО: vite.config.ts base из VITE_BASE (нормализуется до /x/; в Tauri
   всегда '/'), start_url/scope/id/shortcut/share_target.action строятся от base. При base='/' манифест
   байт-в-байт прежний (id не меняется для установленных PWA). Ссылки /favicon.svg и /apple-touch-icon.png
   в index.html Vite переписывает сам — правка index.html не нужна.
   ТРЕБУЕТ ЧУЖОГО ФАЙЛА: README.md:75 — описать `VITE_BASE=/quickdrop/ npm run build` для подкаталога
   (в Git Bash — с MSYS_NO_PATHCONV=1, иначе путь превращается в C:/Program Files/Git/...);
   README.md:89-90 — убрать устаревший абзац про неподключённый vite-plugin-pwa.
6. MEDIUM релиз не ждёт тестов — ИСПРАВЛЕНО: `needs: web` у job desktop.
7. LOW SSRF через редирект — ИСПРАВЛЕНО (src-tauri/src/lib.rs): если исходная ссылка публичная, клиент
   получает DNS-резолвер, отбрасывающий внутренние адреса (loopback, частные, link-local, CGNAT, ULA и т.п.;
   защищает и от DNS rebinding), а политика редиректов отклоняет IP-литералы внутренних сетей. Прямые
   ссылки на локальные адреса работают как раньше. Понижение https→http не запрещено (само по себе не SSRF,
   браузеры такие редиректы выполняют). Тесты: классификация адресов, разбор хоста, локальный
   сервер-редиректор (блок по IP и по имени localhost, разрешение внутри сети).
8. LOW занятое глобальное сочетание при старте — ИСПРАВЛЕНО (src/lib/desktop.ts): toast.error с кнопкой
   «Настройки» + экспорт `globalShortcutFailure(): string | null` (сбрасывается при успешной регистрации).
   ТРЕБУЕТ ЧУЖОГО ФАЙЛА: src/views/settings/ShortcutsSection.tsx — показать у поля «Глобальное сочетание»
   пометку «не назначено», если globalShortcutFailure() === settings.globalShortcut.
9. LOW «Приложение обновлено» не показывается — ПРОПУЩЕНО: дефекта нет. Установлен sonner 2.0.8, его
   ToastState.subscribe воспроизводит активные тосты, созданные до монтирования Toaster
   (node_modules/sonner/dist/index.mjs:139-144).
10. LOW тег релиза vs версия — ИСПРАВЛЕНО: scripts/check-version.mjs (версии в package.json,
    tauri.conf.json, Cargo.toml совпадают; тег == v<версия>) + шаг «Проверка версии» в job web.
    ТРЕБУЕТ ЧУЖОГО ФАЙЛА: README — порядок выпуска (поднять версию в трёх файлах, затем тег).
11. LOW clsx/tailwind-merge — ИСПРАВЛЕНО: `npm uninstall clsx tailwind-merge` (обновлены package.json и
    package-lock.json; clsx остаётся транзитивно через class-variance-authority).

Также предложение для CLAUDE.md (раздел «Платформы → PWA»): упомянуть src/lib/swReload.ts, CSP веб-сборки в
vite.config.ts и VITE_BASE.

## Изменённые файлы
- src-tauri/tauri.conf.json, src-tauri/src/lib.rs
- vite.config.ts, src/pwa.ts, src/lib/desktop.ts
- src/lib/swReload.ts (новый), src/lib/swReload.test.ts (новый)
- .github/workflows/release.yml, scripts/check-version.mjs (новый)
- package.json, package-lock.json
