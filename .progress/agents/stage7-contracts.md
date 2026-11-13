# stage7-contracts

Задача: пакет «contracts» этапа 7 (волна 0) — основа веб-слоя по `.progress/spec-tauri.md` п. 2.14.2.

Статус: готово

## Сделано
- `src/types.ts`: `closeToTray` по умолчанию `false`; новый `captureWindow: boolean = true` (комментарии).
- `src/lib/platform.ts`: `isCaptureWindow()` (pathname оканчивается на `/capture.html`).
- `src/db/db.ts`: `on('ready', settleStaleLinkMeta)` только при `!isCaptureWindow()`.
- `src/index.css`: `@source not "../extension";`.
- `src/lib/shellUi.ts` (+ тест): `ExtServerStatus`, `AutostartState`, `EXT_PORT_MIN/MAX`, `EXT_TOKEN_LENGTH`,
  `isExtensionToken`, `tokenFromBytes`, `validateExtPort`, `maskToken`, `extStatusText`,
  `QUICK_CAPTURE_DESKTOP_HINT`, `EXTENSION_INSTALL_STEPS`.
- `src/lib/desktop.ts`: реэкспорт типов; `generateExtensionToken`, `applyShellOptions`, `toggleCaptureWindow`,
  `showMainWindow`, `openInMain`, `quitApp`, `getAutostart`, `setAutostart`, `applyExtensionServer`,
  `getExtServerStatus`. Обработчик сочетания: `captureWindow && !document.hasFocus()` → `toggle_capture_window`,
  отказ/иначе — прежний `raiseWindow` + `openCapture`. `initDesktop`: подписки окна `open-capture`/`open-item`
  через `getCurrentWebviewWindow().listen` (repo и actions — динамически), `applyShellOptions(settings)`,
  при `extEnabled` — `applyExtensionServer` + toast «Приём от расширения не запущен» с «Настройки».
- Тесты: `desktop.test.ts` (новые обёртки, initDesktop, сочетание), `exportImport.test.ts` (PORTABLE +
  captureWindow), `settingsSchema.test.ts`, `seed.test.ts` (closeToTray теперь `true` как «не умолчание»).

## Решения сверх спецификации
- `applyExtensionServer` при `extEnabled: false` шлёт `token: ''` (секрет не передаётся без нужды) и порт по
  умолчанию, если сохранённый негоден. Rust должен останавливать сервер, не проверяя токен.
- При `extEnabled: true` и негодном порте — отказ без вызова Rust («Порт должен быть от 1024 до 65535»).
- `quitApp` вне Tauri ничего не делает, отказ команды → Error. `toggleCaptureWindow` вне Tauri бросает.
- `extStatusText(true, undefined)` → «Проверяем…» (состояние ещё не получено).

## Проверки
`npm run typecheck` — без ошибок; `npm test` — 78 файлов, 2302 теста, все прошли.
