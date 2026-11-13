# fix-review7-polish

Задача: доводка этапа 7 после повторной сверки — уборка (проверочные цели tests/, tiny_http, спецификация §2.6/§2.14)
и 9 замечаний (ext_server: блокировка мест, опрос accept; shell: фокус мини-окна; Section Enter; импорт сочетания;
перетаскивание в мини-окно; спецификация; оговорка о подмене при свободном порту).

Статус: готово

## Уборка
1. `src-tauri/tests/shell_module.rs`, `ext_server_module.rs` и пустой каталог `src-tauri/tests` удалены; тесты
   модулей идут в составе библиотеки (`cargo test --lib`: `ext_server::tests::*`, `shell::tests::*`). Упоминания
   проверочных целей убраны из doc-комментариев модулей.
2. `tiny_http` в Cargo.toml/Cargo.lock уже не было — проверено.
3. Спецификация §2.6 и §2.14 приведена к коду (см. п. 3 и 9 ниже), пометки «(уточнено после ревью этапа 7)».

## Замечания
1. [средне] Блокировка 8 мест — исправлено (`ext_server.rs`):
   - `HEAD_TIMEOUT = 1 с` (поле `head_timeout` в `ExtServer`/`Ctx`, `with_head_timeout` для тестов) — срок на
     заголовки; `IO_TIMEOUT = 5 с` остался для тела и записи ответа;
   - `read_head`: первый байт — заглавная буква или CR/LF, все байты до `\r\n\r\n` — печатный ASCII, `\t\r\n` или
     ≥ 0x80 (obs-text, дальше проверит UTF-8), иначе сразу `Closed`. Учтён разрез `\r\n\r` + `\n` между чтениями
     (`checked.min(limit)`, иначе паника среза);
   - очередь вместо сброса: `wait_for_slot` (Condvar `Shared::conn_cv`, сигнал из `ConnGuard::drop`, страховочный
     шаг 200 мс) до `accept`; ветка закрытия в `admit` осталась только на гонку поколений.
   - Тесты: `binary_and_silent_clients_do_not_block_ping` (8 TLS + 8 молчащих → ping 200 ≤ 1,7 с, TLS закрыты за
     300 мс), `non_http_bytes_close_at_once`, `head_split_across_reads`, `head_bytes`; `slow_clients_bounded`
     переписан (≤ MAX_CONN в обработке, ping ≤ 2 срока заголовков + 0,7 с).
2. [мелочь] Подмена при свободном порту — минимум: «Принятый риск» в §2.14.4, «подмена при свободном порту» в
   строке «Минусы» §2.6, оговорка в подсказке токена (`QuickCaptureSection.tsx`), в `extension/README.md` (плюс
   исправлено «подписан токеном» → «несёт токен») и на `extension/options.html`. Протокол v2 (HMAC) — не делал:
   отдельная задача со сменой протокола и расширения.
3. [мелочь] Спецификация и комментарий — исправлено: комментарий `Ctx::handle` (токен шаг 5, частота шаг 6), §2.6
   (сервер, порядок проверок), §2.8 (параллельно, очередь), §2.10, §2.12 «Пределы приёма», §2.14.1, §2.14.4
   (константы, потоки, подмена токена на месте, таблица шагов 5/6, тесты), §2.14.8, §2.14.10.
4. [мелочь] Опрос accept 50 мс — исправлено: слушающий сокет блокирующий, `ACCEPT_POLL` удалён
   (`ACCEPT_ERROR_PAUSE = 200 мс` только на ошибки), флаг остановки проверяется сразу после `accept`,
   `shutdown` будит поток подключением к себе (`wake_accept`, до 3 попыток по 200 мс) и сигналом места.
   Тесты: `sequential_requests_are_fast` (< 20 мс), `stop_returns_quickly_and_port_rebinds` (stop < 200 мс, bind
   сразу, apply без REBIND), `stop_while_all_slots_busy`.
5. [средне] Фокус мини-окна — исправлено (`shell.rs`): `ShellState::capture_focused` по `WindowEvent::Focused`
   окна capture; сброс при `CloseRequested`, `Destroyed`, `destroy()` в `set_shell_options`, после `hide()` в toggle;
   решение — `should_hide_capture(visible, focused)`. Тесты `capture_focus_is_tracked_by_events`,
   `second_press_hides_only_visible_focused_window`. **Проверить вживую**: фокус в поле, 2-е нажатие прячет,
   3-е показывает с текстом.
6. [мелочь] Enter после отказа — исправлено: логика `CommitInput` вынесена в `src/views/settings/commitInput.ts`
   (`createCommitter`: Enter = force, blur без force гасится, защита от параллельных попыток). DOM-окружения для
   тестов в проекте нет (jsdom/testing-library не установлены, package.json не мой) — тест на чистый модуль
   `commitInput.test.ts`.
7. [мелочь] Импорт не перерегистрирует сочетание — исправлено: `desktop.ts` — `activeShortcut` (ведёт
   `registerShortcut`) и `reapplyGlobalShortcut(next)` (совпадает — ничего; отказ — откат на действовавшее,
   `failedShortcut = next`, текст ошибки); `applyImportedShellSettings()` → `{ shellOk, shortcutError? }`;
   `DataSection.tsx` показывает оба toast. Тесты в `dataDesktop.test.ts` (а–г).
8. [мелочь] Перетаскивание в мини-окно — исправлено: команда Rust `shell::capture_pointer_down` (Windows:
   `GetAsyncKeyState` + `SM_SWAPBUTTON`, `windows-sys 0.61` в `[target.'cfg(windows)'.dependencies]` — версия уже
   была в lock; иначе false), зарегистрирована в `lib.rs`; `captureWindow.ts` — `capturePointerDown()` и третий
   параметр `createBlurHider(hide, delay, isPointerDown)` (пока зажата — перепланировать; устаревший ответ не
   действует — счётчик `seq`); `CaptureWindowApp.tsx` — передаёт его, плюс `dragenter`/`dragleave`/`drop`/`dragend`
   (фаза перехвата, счётчик глубины) → `suspend`/`resume`. Тесты в `captureWindow.test.ts`. **Проверить вживую**:
   перетащить файл из Проводника в пустое мини-окно.
9. [мелочь] Спецификация — исправлено: `"focus": false` (п. 2.2), автозапуск через `auto-launch` (пп. 2.1, 2.4,
   2.10, 2.14.3, 2.14.8, wire), tiny_http убран отовсюду, кроме исторических пометок; проверка `rg` чистая.

## Проверки
- `npm run typecheck` — ok; `npm test` — 83 файла, 2395 тестов ok.
- `cargo check --manifest-path src-tauri/Cargo.toml --all-targets` — без предупреждений.
- `cargo test --manifest-path src-tauri/Cargo.toml` — 125 ok, 2 ignored; набор прогнан 6 раз подряд — стабильно.

## Изменённые файлы
- src-tauri/src/ext_server.rs, src-tauri/src/shell.rs, src-tauri/src/lib.rs, src-tauri/Cargo.toml, src-tauri/Cargo.lock
- удалены: src-tauri/tests/shell_module.rs, src-tauri/tests/ext_server_module.rs (и каталог)
- src/lib/desktop.ts, src/lib/dataDesktop.ts, src/lib/dataDesktop.test.ts, src/lib/captureWindow.ts,
  src/lib/captureWindow.test.ts, src/components/capture/CaptureWindowApp.tsx
- src/views/settings/Section.tsx, src/views/settings/commitInput.ts (новый), src/views/settings/commitInput.test.ts (новый),
  src/views/settings/DataSection.tsx, src/views/settings/QuickCaptureSection.tsx
- extension/README.md, extension/options.html
- .progress/spec-tauri.md
