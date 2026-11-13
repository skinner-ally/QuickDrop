# fix-review7-rust

Задача: исправления по ревью этапа 7, группа «rust» (только src-tauri/**). 7 находок.

Статус: готово

## Сделано

1. **Утечка mem::forget / tiny_http (ext_server.rs).** tiny_http убран (Cargo.toml), свой сервер на `std::net`:
   - поток `qd-ext-http`: неблокирующий `TcpListener`, `accept` раз в 50 мс (`ACCEPT_POLL`) с проверкой `stop`;
     ошибка `accept` — пауза и продолжение (без break);
   - принятому сокету: блокирующий режим, `nodelay`, срок записи; предел `MAX_CONN = 8` (`Shared::active`,
     `ConnGuard` с Drop); сверх предела сокет сразу закрывается;
   - на соединение свой поток `qd-ext-conn`: заголовки до `\r\n\r\n` не больше `MAX_HEAD = 8 КБ` (иначе 431),
     срок `IO_TIMEOUT = 5 с` на заголовки целиком (не на один read; молчание/обрыв — закрыть без ответа);
     разбор вручную (`parse_head`: token-имена, без obs-fold и управляющих символов, только HTTP/1.0–1.1 → иначе 400);
     повтор Host/Origin/Authorization/Content-Type/Content-Length — отказ, как раньше;
   - шаги 1–11 те же; шаг 9: `Transfer-Encoding` → 411, нет длины → 411, негодная/повторённая длина → 400,
     > `MAX_BODY` → 413 до чтения тела; тело читается только на шаге 10 (`read_exact` по сроку 5 с, `Expect:
     100-continue` получает `100 Continue`);
   - каждый ответ с `Connection: close`, затем `shutdown(Write)` и ограниченный «linger»: непрочитанный остаток
     выбрасывается в буфер на стеке (не больше 2 МБ и не дольше 1 с), чтобы закрытие с данными в приёмном буфере
     не дало RST до чтения ответа клиентом. Память под заявленную длину не выделяется никогда.
   - удалены `DRAIN_LIMIT`, `INLINE_BODY`, `MAX_DRAINERS`, `Shared::drainers`, `send()`; `Worker` → `Ctx` (общий
     для потоков поколения, `rate` под Mutex). Соединения обслуживаются параллельно (deliver тоже) — фронтенд
     (`extInbox.drainOnce`) и так разбирает список.
   - Тесты: `no_leak_on_huge_length`, `slow_clients_bounded` (`with_io_timeout`), `header_too_large`,
     `malformed_requests_are_400`, `expect_continue_is_answered`, `head_parsing`, `content_length_parsing`,
     `response_format`; `huge_declared_length_does_not_crash` теперь ждёт 413 и проверяет `active_connections() → 0`.
2. **Частота до токена.** Шаг частоты перенесён после токена: считаются только запросы с верным токеном.
   Отдельный `fail_rate` для неверного токена **не делал**: перебор 43 символов base64url невозможен, а
   отдельное окно дало бы расширению с устаревшим токеном 429 «Слишком часто» вместо понятного 401, если окно
   забила чужая страница. Тест `unauth_does_not_consume_rate` (40 запросов без Origin и токена → все 401, затем
   ping 200 и capture 200); `row5_rate_limit` дополнен (31-й → 429, неверный токен при полном окне → 401).
   Часть «узнать, что QuickDrop запущен» — не дефект кода (см. проверяющего), не исправлялась.
3. **Фокус скрытого мини-окна.** `tauri.conf.json`: `"focus": false`; `shell.rs::create_capture` —
   `.visible(false).focused(false)`, пояснение в doc-комментарии. Тест `capture_window_config_does_not_take_focus`
   (читает tauri.conf.json). Попутно: главное окно при запуске с `--autostart` тоже создаётся `focused(false)`
   (lib.rs, `create_main_window`) — тот же механизм.
4. **Автозапуск Dynamic → HKLM.** `tauri-plugin-autostart` убран (Cargo.toml, lib.rs), вместо него прямая
   зависимость `auto-launch = "0.6"` (та же 0.6.0 из Cargo.lock): `shell::Autostart`, собирается в `shell::init`
   (`autostart_launcher`: имя = `package_info().name`, как у плагина; Windows — `WindowsEnableMode::CurrentUser`
   и путь в кавычках `quoted_exe_path`; macOS — LaunchAgent и канонический путь exe, как у плагина; Linux —
   AppImage/exe). `set_autostart(false)`: после `disable()` перепроверка `is_enabled()`; если запись осталась
   (HKLM) — `Err(AUTOSTART_STUCK)` с подсказкой, а не тихий Ok. Тесты: `autostart_path_is_quoted`,
   `autostart_disable_reports_stuck_entry`, `autostart_writes_current_user_only` (`#[ignore]`, пишет в HKCU —
   **не запускался**). JS-пакет и права `autostart:*` и раньше не использовались.
5. **accept упал → приём умер молча.** Закрыто п. 1: цикл accept больше не завершается на ошибке (пауза и
   продолжение), поток жив — `status()` правдив. Отдельного теста нет: ошибку `accept` в тесте не вызвать;
   покрыто структурно (нет `break`), живость после всплеска проверяет `no_leak_on_huge_length`.
6. **Трей «Быстрая запись» молчит.** `tray_capture` → `capture_or_main`: при ошибке мини-окна — главное окно
   и `open-capture`. Тест `tray_capture_falls_back_to_main`.
7. **macOS Reopen.** lib.rs: `.build(…).expect(…).run(|app, e| shell::on_run_event(app, &e))`;
   `shell::on_run_event` на macOS по `RunEvent::Reopen` показывает главное окно, если оно скрыто или свёрнуто
   (не только при `has_visible_windows: false`: видимое мини-окно не должно мешать). Вне macOS — ничего.
   Тест не писал: чистой логики нет, macOS здесь не собрать (код под `cfg(target_os = "macos")` не проверен
   компилятором — проверить на этапе 8).

## Проверки
- `cargo check --offline --all-targets` — без предупреждений; `cargo test --offline` — 115 + 42 + 13 ok,
  ignored 2 + 1 (сетевой и реестровый); тесты ext_server прогнаны 5 раз подряд — стабильно (~2.3 с).
- `npm run typecheck`, `npm test` (82 файла, 2381 тест) — ok.

## Не сделано (чужие файлы) — нужные правки `.progress/spec-tauri.md`
- стр. 779: «Сервер: `tiny_http = "0.12"`» → «Сервер: свой на `std::net::TcpListener` (без зависимостей)».
- стр. 806 и 1352–1353: строки «Частота» и «Authorization» поменять местами; текст частоты: «Частота: не больше
  30 запросов с верным токеном за 10 с (неверный токен — 401 раньше и в счёт не идёт)».
- стр. 912: «Обработка запросов последовательная (один поток)…» → «Соединения обслуживаются параллельно,
  не больше `MAX_CONN = 8`; лишние закрываются сразу».
- стр. 949/1605/1078/1615/1700 и 605/734: `tauri-plugin-autostart` → `auto-launch = "0.6"` напрямую
  (`WindowsEnableMode::CurrentUser`, путь в кавычках; при оставшейся записи HKLM `set_autostart(false)` → Err);
  стр. 950/956/1078/1604/1615/1618/1700 — упоминания `tiny_http` убрать.
- стр. 618: `"focus": true` → `"focus": false` (мини-окно создаётся без фокуса, фокус ставит `show_capture`).
- стр. 1027–1028 заменить: «**Пределы приёма**: `MAX_CONN = 8` соединений, заголовки ≤ 8 КБ (иначе 431), срок
  5 с на заголовки, отдельно на тело и на запись ответа; тело читается только после шагов 1–9, огромный
  `Content-Length` получает 413 без чтения; после ответа остаток запроса выбрасывается не больше 2 МБ / 1 с.
  Программа на этом компьютере может занять все 8 мест молчащими соединениями — приём расширения
  недоступен, пока она это делает (ресурсы не копятся). Принято».
- стр. 1336: «Один поток обработки (`qd-ext-http`): `recv_timeout`…» → «Поток приёма `qd-ext-http`
  (неблокирующий accept раз в 50 мс, проверка флага остановки) и поток на каждое соединение».

## Изменённые файлы
- src-tauri/src/ext_server.rs, src-tauri/src/shell.rs, src-tauri/src/lib.rs
- src-tauri/Cargo.toml, src-tauri/Cargo.lock (ушли tiny_http, tauri-plugin-autostart и их зависимости)
- src-tauri/tauri.conf.json
