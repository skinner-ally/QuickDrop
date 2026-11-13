# stage7-wire

Задача: пакет «wire» этапа 7 (волна 2) — сведение: `src-tauri/src/lib.rs` (mod shell/ext_server, плагины,
setup, on_window_event, команды) и `src/main.tsx` (запуск приёма от расширения). Спецификация — п. 2.14.8.

Статус: **готово** (2026-11-13)

## Изменённые файлы

- `src-tauri/src/lib.rs`:
  - `mod ext_server; mod shell;` рядом с `mod backup;`.
  - `#[cfg(desktop)]`: single-instance первым — `|app, args, _cwd| shell::on_second_instance(app, &args)`
    (прежний встроенный показ окна убран: то же делает `shell::show_main`, плюс `--autostart` игнорируется);
    global-shortcut; `tauri_plugin_autostart::Builder::new().args([shell::AUTOSTART_ARG]).build()`.
  - setup: approved-dirs, own-backups (как было) → `app.manage(ext_server::ExtServer::default())` →
    `shell::init(app)?` → `create_main_window(app, shell::started_hidden())?`.
  - `create_main_window(app, hidden)`: при `hidden` — `.visible(false)`; обработчик скачиваний macOS сохранён.
  - `.on_window_event(|window, event| shell::on_window_event(window, event))`.
  - invoke_handler: 9 прежних + `shell::{set_shell_options, toggle_capture_window, show_main_window,
    open_in_main, quit_app, get_autostart, set_autostart}` + `ext_server::{ext_server_apply, ext_server_status,
    ext_take_pending, ext_capture_done}` — всего 20.
  - `fetch_link_meta`, backup и тесты lib.rs не менялись.
- `src/main.tsx`: после `void initDesktop()` — при `isTauri()` динамический `import('./lib/extInbox')` →
  `startExtInbox()`, `catch` → `console.warn`.

## Проверки

- `cargo check --manifest-path src-tauri/Cargo.toml` — ок, без предупреждений.
- `cargo test --manifest-path src-tauri/Cargo.toml` — библиотека: 102 passed, 1 ignored (60 прежних + 33
  ext_server + 9 shell); проверочные цели `ext_server_module` 33 passed, `shell_module` 9 passed.
- `npm run typecheck` — ок; `npm test` — 81 файл, 2364 теста, все прошли.
- `npm run build` (веб): `dist/index.html` есть, `dist/capture.html` нет, `dist/sw.js` есть; `extInbox` —
  отдельный чанк.
- Сборка веб-слоя с `TAURI_ENV_PLATFORM=windows`: `dist/index.html` и `dist/capture.html` есть, `sw.js` и
  `manifest.webmanifest` нет. После проверки `dist` пересобран обычной веб-сборкой.
- Имена аргументов `invoke` в `desktop.ts`/`extInbox.ts` сверены с командами Rust (camelCase ↔ snake_case).

## Не проверено вживую (окно Tauri не запускалось) — п. 2.14.11

Крестик при выключенном «Сворачивать в трей» завершает процесс (мини-окно создано и скрыто); скрытый старт с
`--autostart`; трей и его меню; запись из мини-окна появляется в главном без перезагрузки; догрузка заголовка
ссылки из мини-окна; `Esc` при открытом списке категорий; скрепка не прячет окно; расширение при главном окне в
трее; порт закрыт при выключенном приёме; смена порта/токена без перезапуска; `fetch` с обычного сайта — отказ;
экспорт без `extToken/extPort/extEnabled`; вид в «Классике» и пиксельной сцене; веб-версия — только пояснение.

## Для основной сессии

- Временные проверочные цели `src-tauri/tests/shell_module.rs` и `src-tauri/tests/ext_server_module.rs`
  теперь дублируют тесты модулей (собираются вместе с библиотекой) — удалить при коммите этапа.
