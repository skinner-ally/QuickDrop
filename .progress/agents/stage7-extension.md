# stage7-extension

Задача: пакет «extension» этапа 7 (волна 1) — расширение Chrome Manifest V3 в `extension/`, скрипт значков.

Статус: **готово** (2026-11-13)

## Изменённые файлы

- extension/manifest.json, background.js, shared.js, popup.html, popup.js, options.html, options.js, ui.css, README.md
- extension/icons/icon-16.png, icon-32.png, icon-48.png, icon-128.png (сгенерированы)
- scripts/gen-extension-icons.mjs
- .progress/agents/stage7-extension.md

## Проверки

- `node --check` для всех .js — ок; manifest.json — валидный JSON, permissions = activeTab/contextMenus/storage,
  host_permissions = http://127.0.0.1/*, background type module.
- Значки: 16/32/48/128, PNG (sharp metadata).
- shared.js прогнан в node с подставными chrome и fetch: проверки до отправки, тела запросов, заголовки,
  тексты ошибок по кодам 401/403/413/429/422/500, сетевой отказ, таймаут, ping — как в спецификации.
- В Chrome расширение не загружалось (проверяет основная сессия).

## Отклонения

- `ping(config?)` принимает необязательный аргумент (добавлено): страница настроек проверяет значения из формы
  до сохранения.
- Заголовок страницы передаётся только для kind `page` (для `link` — только адрес), для `selection` — вместе с адресом
  источника, если он http/https.
- `send` дополнительно проверяет порт и формат токена до отправки (токен неверной длины → русский текст, без запроса).
