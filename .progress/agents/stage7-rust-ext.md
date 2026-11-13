# stage7-rust-ext

Задача: пакет «rust-ext» этапа 7 (волна 1) — `src-tauri/src/ext_server.rs` (локальный HTTP-приём от расширения
на tiny_http, п. 2.14.4) и проверочная цель `src-tauri/tests/ext_server_module.rs`.

Статус: **готово** (2026-11-13)

## Изменённые файлы

- `src-tauri/src/ext_server.rs` — новый модуль (без `crate::…`, `lib.rs` не трогался).
- `src-tauri/tests/ext_server_module.rs` — проверочная цель из двух строк (`#[path]`).

## Что сделано

- Контракт п. 2.14.4: константы `EVENT_EXT_CAPTURE`, `MAX_BODY`, `TAKE_TIMEOUT`, `DONE_TIMEOUT`, `RATE_MAX`,
  `RATE_WINDOW`; типы `ExtStatus`, `ExtPending` (camelCase), `ExtOutcome`; `ExtServer` (`Default`, `apply`,
  `status`, `take_pending`, `complete`, `stop`); чистые `is_valid_token`, `ct_eq`, `is_extension_origin`,
  `host_matches`; команды `ext_server_apply`, `ext_server_status`, `ext_take_pending`, `ext_capture_done`
  (apply/take/done — только окно `main`, иначе «Недоступно из этого окна»).
- Привязка `SocketAddr::from(([127,0,0,1], port))` через свой `TcpListener` → `Server::from_listener`
  (так ошибка bind — `io::Error`: AddrInUse → «Порт N занят другой программой», PermissionDenied (Windows,
  зарезервированный диапазон) → «Порт N недоступен: зарезервирован системой, выберите другой»).
- Один поток `qd-ext-http`, `recv_timeout(200 мс)` + флаг остановки + `unblock`. Выключено — порт не слушается.
- Смена порта: новый открывается раньше, старый закрывается после; не открылся — прежний работает, `Err`.
- Проверки строго по таблице п. 2.14.4 (1 Host → 2 Origin → 3 OPTIONS → 4 маршрут → 5 частота → 6 токен →
  7 ping → 8 Content-Type → 9 Content-Length → 10 JSON v=1 → 11 слот/ожидание). Заголовки ответа: json,
  no-store, nosniff, Vary: Origin, ACAO — только проверенный origin.
- Слот ожидания → `notify(requestId)` → ожидание take (5 с) и done (10 с) → 200 / 422 / 503 / 504.
- Защита от падения: tiny_http при удалении запроса с непрочитанным телом выделяет буфер на весь заявленный
  `Content-Length` — `Content-Length: 99999999999999` от любого локального процесса ронял процесс
  (проверено: «memory allocation of 99999999999999 bytes failed», 0xc0000409). Теперь такие запросы
  (> 16 МиБ, тело не прочитано) не удаляются (`mem::forget`, без ответа); непрочитанные тела > 1 КиБ
  дочитываются в отдельном потоке (не больше 8), чтобы молчащий клиент не останавливал приём.

## Проверки

- `cargo check --manifest-path src-tauri/Cargo.toml --test ext_server_module` — ок, без предупреждений
  (и без `allow(dead_code)` — проверено временно).
- `cargo test --manifest-path src-tauri/Cargo.toml --test ext_server_module` — 33 passed, 5 прогонов подряд, ~0,7 с.

## Отклонения от п. 2.14.4

- Смена токена (и версии, `notify`) на том же порту — подмена на месте без перезапуска (спецификация:
  остановка и новый запуск). Без окна, когда порт закрыт, и без 503 ожидающему сообщению.
- `ExtServer::default()` — ручной `impl Default` (сроки — поля для тестов), не `#[derive(Default)]`.
- Повторённые `Host`/`Origin`/`Authorization`/`Content-Type` считаются непрошедшей проверкой.
- 405 несёт `Allow`; `ExtStatus.port` = `None`, когда сервер не работает.
- В событии `ext-capture` — только номер запроса (как в коде п. 2.14.4), содержимого нет.
