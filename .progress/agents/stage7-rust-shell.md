# stage7-rust-shell

Задача: пакет «rust-shell» этапа 7 (волна 1) — `src-tauri/src/shell.rs` (мини-окно, трей, закрытие главного
окна, один экземпляр, автозапуск) и проверочная цель `src-tauri/tests/shell_module.rs`. Контракт — п. 2.14.3.

Статус: **готово** (2026-11-13)

## Изменённые файлы

- `src-tauri/src/shell.rs` — новый. Контракт п. 2.14.3 целиком: константы `MAIN_LABEL`, `CAPTURE_LABEL`,
  `AUTOSTART_ARG`, `EVENT_CAPTURE_SHOWN`, `EVENT_OPEN_CAPTURE`, `EVENT_OPEN_ITEM`; `ShellState` (Default, оба флага
  `false`); `init(&App)`, `started_hidden()`, `has_autostart_arg`, `on_second_instance`, `on_window_event`,
  `capture_position`; `AutostartState` (camelCase); команды `set_shell_options`, `toggle_capture_window`,
  `show_main_window`, `open_in_main` (async), `quit_app`, `get_autostart`, `set_autostart` (sync).
  Не ссылается на `crate::`, `lib.rs` не трогался.
- `src-tauri/tests/shell_module.rs` — проверочная цель из двух строк (п. 2.14.9).

## Решения внутри модуля

- `ShellState` сверх контракта: приватные `exiting: AtomicBool` (выход просится один раз — `quit_app`, «Выход»
  в трее и `Destroyed` главного окна не дублируют `exit`) и `window_lock: Mutex<()>` (два одновременных вызова не
  создают мини-окно дважды).
- Автозапуск — через `try_state::<tauri_plugin_autostart::AutoLaunchManager>()` (по совету deps: `autolaunch()`
  паникует без плагина). Без плагина: `available: false`, `reason: «Автозапуск недоступен»`.
- Позиция мини-окна: размер окна пересчитывается на масштаб целевого монитора (`scale_size`), иначе при переходе
  100 % → 150 % окно встало бы не по центру.
- Трей и автозапуск под `#[cfg(desktop)]` (крейт автозапуска есть только на настольных платформах).
- Трей: все действия с окнами — через `tauri::async_runtime::spawn`; «Выход» — сразу.

## Проверки

- `cargo check --manifest-path src-tauri/Cargo.toml --test shell_module` — ок, без предупреждений.
- `cargo test --manifest-path src-tauri/Cargo.toml --test shell_module` — 9 passed.
- Проверено, что в проверочной цели `cfg(desktop)` включён (временный `compile_error!`, затем убран).
- Общий `cargo test`, окно Tauri — не запускались (волна 1).
