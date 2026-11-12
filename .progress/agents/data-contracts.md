# data-contracts

Задача: шаг 0 обновления (`.progress/spec-stage2.md` §1) — контракты данных: типы, схема БД v2, проверка настроек,
фильтр корзины, чистые функции нормализации, состояние интерфейса.

Статус: готово

## Результат

- `npm run typecheck` — чисто.
- `npm test` — 20 файлов, 509 тестов, все зелёные (было 18 файлов / 475; +34 новых: 1 в `db.test.ts`,
  остальные в двух новых файлах). Существующие тесты и остальной код не правились.
- `npx oxlint` по изменённым файлам — без замечаний.

Имена сверены с `spec-stage2.md` §1, `spec-stage1.md` §6.1–6.2, `spec-tauri.md` §1.9 и §2.9.

### Что добавлено (экспорты)

- `src/types.ts`: `ITEM_SOURCES` (+ `'extension'`), `ItemSource` от него; `Item.ocrText`, `Item.ocrAt`, `Item.deletedAt`;
  `GraphPoint`, `NodePosition`, `SavedSearch`, `SAVED_SEARCH_NAME_MAX = 60`, `SAVED_SEARCH_QUERY_MAX = 2000`;
  `THEMES`, `SCENE_PREFS`/`ScenePref`, `FONT_PREFS`/`FontPref`, `BACKUP_PERIODS`/`BackupPeriod`;
  в `Settings` и `DEFAULT_SETTINGS`: `scene, font, ambient, trashDays, backupDir, backupEvery, backupKeep, backupLastAt,
  mdExportDir, aiAutoOcr, aiVisionModel, closeToTray, extEnabled, extPort, extToken`; `ItemFilter.trashed`.
  `ItemPatch`, `NewItemInput`, `Settings['theme']` не менялись.
- `src/db/db.ts`: `version(2)` — индекс `deletedAt` у `items`, таблицы `positions` (`id`) и `searches` (`id, order`);
  поля класса `positions`, `searches`. `version(1)` не тронута.
- `src/lib/filter.ts`: `matchesFilterIgnoringTrash` (прежнее тело), `matchesFilter` сначала проверяет корзину.
- `src/lib/normalize.ts`: `MAX_OCR_TEXT`, `cleanOcrText`, `MAX_GRAPH_COORD`, `sanitizePoint`, `searchNameKey`.
- `src/lib/settingsSchema.ts` (новый): `isValidSetting`, `MAX_SETTING_STRING = 4096`.
- `src/db/settings.ts`: `mergeSettings` проверяет через `isValidSetting`.
- `src/store/ui.ts`: `View` + `'graph' | 'trash'`, `UiFilter`, действие `applyQuery(query, view?)`.
- `src/components/items/ItemDetail.tsx`: `SOURCE_LABEL.extension = 'Из браузера'`.

## Изменённые файлы

`src/types.ts`, `src/db/db.ts`, `src/db/db.test.ts`, `src/db/settings.ts`, `src/lib/settingsSchema.ts` (новый),
`src/lib/settingsSchema.test.ts` (новый), `src/lib/filter.ts`, `src/lib/normalize.ts`, `src/lib/normalize.test.ts` (новый),
`src/store/ui.ts`, `src/components/items/ItemDetail.tsx` (одна строка), этот файл.

## Уточнения сверх буквы спецификации (поведение в её рамках)

- `cleanOcrText`: одиночный `\r` тоже → `\n`; убираются и управляющие C1 (U+0080–U+009F); строка из одних
  пробелов/табуляций считается пустой; обрезка не оставляет половину суррогатной пары и хвостовые пробелы
  (функция идемпотентна — важно для импорта копии).
- `sanitizePoint`: предел проверяется после округления; `-0` → `0`; возвращается новый объект только с `x`, `y`.
- `isValidSetting`: `NaN`/`Infinity` не годятся ни для одной числовой настройки; ключ проверяется через `Object.hasOwn`.
- Дополнительный экспорт `MAX_SETTING_STRING`.
- Служебная пометка «(уточнено при сверке)» из листинга §1.1 в код не перенесена.

## Не проверено

- В браузере не проверялось: видимых изменений шаг не даёт (новых разделов и настроек в интерфейсе ещё нет).
- Обновление настоящей (не fake-indexeddb) базы v1 → v2 в браузере/WebView — только тестом на fake-indexeddb.
- `npm run build` не запускался (по правилам задачи).

## Для основной сессии

- `View` получил `'graph'` и `'trash'`, но экранов для них ещё нет: `switch (view)` в `AppShell` не исчерпывающий,
  до этапов 3–5 такие значения дадут пустую область. Сейчас их никто не выставляет.
- `matchesFilter` теперь прячет записи с `deletedAt` везде; пока `deleteItems` в repo не переведён на корзину
  (волна 1), поведение для пользователя прежнее.
