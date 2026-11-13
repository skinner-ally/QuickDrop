# stage7-ext-inbox

Задача: приём записей от расширения в главном окне (этап 7, волна 1).
Спецификация: `.progress/spec-tauri.md` §2.14.4, §2.8.

Статус: готово

## Результат
- `src/lib/extensionCapture.ts` (чистый): `EXT_URL_MAX/EXT_TITLE_MAX/EXT_TEXT_MAX`, `ExtensionKind`, `ExtensionMessage`,
  `parseExtensionMessage`, `extensionMessageToInput`; константы текстов ошибок `EXT_ERR_*`.
- `src/lib/extInbox.ts`: `ExtResult`, `ExtInboxDeps`, `handleExtCapture`, `drainExtInbox`, `startExtInbox`,
  плюс `notifySaved` (toast «Сохранено из браузера» + «Открыть» → `openItemInSection`), `EVENT_EXT_CAPTURE`, `SAVE_ERROR`.
- Зависимости по умолчанию (`repo.findDuplicateLink`, `actions.createAndEnrich`) грузятся динамически.
- `ext_capture_done` вызывается с `{ requestId, ok, duplicate, error: string | null }`.
- Подключение в `main.tsx` — пакет `wire`: `if (isTauri()) void import('./lib/extInbox').then((m) => m.startExtInbox())`.

## Отступления
- Доп. ошибка «Адрес слишком длинный» (> 2048 до или после кодирования `new URL`); адрес отдаётся как `URL.href`.
- Код из выделения: убраны ведущие пустые строки и хвостовые пробелы; текст — `trim()`.
- Текст ошибки для расширения обрезается до 500 символов.
- Для дубля toast не показывается (спецификация говорит только об успешном сохранении).

## Проверки
- `npm run typecheck` — ок; `npm test` — 81 файл, 2364 теста, все прошли (46 — тесты пакета).
- Вживую (окно Tauri, Rust-команды `ext_take_pending`/`ext_capture_done`) не проверено.

Файлы: src/lib/extensionCapture.ts, src/lib/extensionCapture.test.ts, src/lib/extInbox.ts, src/lib/extInbox.test.ts
