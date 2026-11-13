# final-fix-rust — исправления финального ревью, группа «rust»

Статус: готово

## Задача
1. [мелочь] fetch_link_meta: прокси из переменных окружения обходит фильтр внутренней сети (src-tauri/src/lib.rs, link_client).
2. [мелочь] MSI не убирает запись автозапуска HKCU\...\Run\QuickDrop при удалении (src-tauri/tauri.conf.json bundle.targets).

## Результат
1. Исправлено. В `link_client` добавлен `.no_proxy()` для обоих клиентов (с allow_private и без).
   Тест `tests::link_client_ignores_proxy_env`: молчащий «прокси» на 127.0.0.1, HTTP_PROXY/HTTPS_PROXY/ALL_PROXY
   указывают на него; оба клиента идут напрямую (ожидаемые ошибки «Слишком много перенаправлений» и PRIVATE_REDIRECT),
   прокси не принял ни одного соединения. Сетевые тесты сериализованы через `NET_LOCK` (env общий для процесса),
   переменные восстанавливаются. Без правки тест падает (проверено временным откатом).
   Компромисс (записать в HANDOFF): если интернет доступен только через прокси из переменных окружения, заголовки
   ссылок не загрузятся; fetchLinkMeta не бросает, UI берёт titleFromUrl. Системный прокси WinINET не учитывался и раньше.
2. Исправлено. `bundle.targets` = `["nsis", "app", "dmg"]`: шаблон NSIS tauri-cli при удалении (не при обновлении)
   выполняет DeleteRegValue HKCU Run "${PRODUCTNAME}" (строка подтверждена в cli.win32-x64-msvc.node), WiX-шаблон — нет.
   Чужие файлы не тронуты — нужны правки документации (см. ниже).

## Нужно поправить вне группы (чужие файлы)
- README.md:99 — «в подпапках `msi/` и `nsis/`» → «в подпапке `nsis/`».
- docs/ИНСТРУКЦИЯ.md:27 — убрать «(или `.msi`)».
- .progress/CLAUDE.proposed.md:488 — «цели установщика — NSIS и MSI (Windows)» → «NSIS (Windows)».
- .progress/HANDOFF.md — записать компромисс про прокси и отказ от MSI.

## Изменённые файлы
- src-tauri/src/lib.rs
- src-tauri/tauri.conf.json

cargo test --manifest-path src-tauri/Cargo.toml: 131 passed, 0 failed, 2 ignored.
