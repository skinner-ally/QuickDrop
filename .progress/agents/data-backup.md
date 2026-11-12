# data-backup (этап 2, волна 1)

Задача: резервная копия с новыми таблицами (positions, searches), чтение старых версий копии,
PRIVATE_SETTINGS вне экспорта/импорта; seed под новую схему. Спецификация: `.progress/spec-stage2.md` §0, §2.5, §3, §4.

Файлы: `src/lib/exportImport.ts`, `src/lib/exportImport.test.ts`, `src/db/seed.ts`, `src/db/seed.test.ts`.

Статус: готово

## Результат

Работа шла в два захода: первый заход (прерван) написал `exportImport.ts`, `exportImport.test.ts` и правки `seed.ts`;
второй сверил их со спецификацией построчно, дописал `seed.test.ts` и прогнал проверки.

### `src/lib/exportImport.ts`
- `BACKUP_VERSION = 2`; `ImportReport` получил `positions`, `searches`; `BackupData` — необязательные `positions`, `searches`.
- Экспорт: транзакция чтения включает `positions` и `searches`; оба раздела пишутся в заголовок (до `files`);
  положения — только для существующих записей, поиски — по `order`; корзина, `ocrText`, `ocrAt` идут как есть.
- Чтение: версии 1 и 2 (любая целая от 1 до текущей); `positions`/`searches` отсутствуют или не массивы — пустые списки
  в любой версии; `version > 2` — прежняя ошибка «создана более новой версией».
- `sanitizeItem`: `deletedAt`, `ocrAt` — через `ts()`; `ocrText` — `cleanOcrText`, пустой не пишется; `source` — по
  `ITEM_SOURCES` из `@/types` (локальный список удалён).
- Положения: `sanitizePoint` + непустой `id`, дубль id — первое, негодные → `skipped`.
- Поиски: непустые `id`/`name`/`query` после `trim`, пределы `SAVED_SEARCH_*_MAX`, `order` — число или индекс,
  `createdAt` — `ts() ?? now`.
- `replace`: `positions.clear()`, `searches.clear()`; пишутся положения существующих после импорта записей и все
  поиски, имена-дубли получают ` (2)`…
- `merge`: локальное положение сильнее; положение без записи не пишется; поиск с тем же id или тем же именем и
  запросом — `skipped`; то же имя, другой запрос — суффикс; новые встают после локальных.
- `repairIntegrity` удаляет положения без записей.
- `sanitizeSettings` — через `isValidSetting`; `PRIVATE_SETTINGS` дополнен: `backupDir, backupLastAt, mdExportDir,
  aiAutoOcr, aiVisionModel, extEnabled, extPort, extToken`.
- Правила безопасности импорта сохранены без изменений: `safeBlobType` для Blob, `safeThumbType` для превью,
  `linkMeta.image/favicon` не переносятся, адрес ссылки — только http/https/ftp, зависшее `pending` завершается.

### `src/db/seed.ts`
- `clearAllData` очищает `positions` и `searches`; `CLEARED_SETTINGS` += `aiVisionModel, aiAutoOcr, extEnabled,
  extToken, backupLastAt`.
- `isPristineDemo` требует `existing.deletedAt === undefined`.

### Тесты
- `exportImport.test.ts`: 41 тест. Изменены существующие (версия 2, отчёт с `positions`/`searches`, «более новой
  версией» для `version: 3`); новые блоки «версия 2…», «копия прежнего формата (версия 1)» (образец `V1_COPY` — копия
  в том виде, в каком её писал экспорт версии 1, по данным теста полного цикла), «новые настройки».
- `seed.test.ts`: 11 тестов (было 8): корзина не воскрешается `seedDemoData(true)`, засев не трогает
  положения/поиски, `clearAllData` чистит новые таблицы и новые настройки.

## Отступления от спецификации
1. `sanitizeItem`: `deletedAt === 0` отбрасывается (спецификация: «через `ts()`», а `ts()` ноль пропускает). Причина:
   корзина выбирается по индексу `deletedAt > 0` (`emptyTrash`, `purgeExpired`), запись с нулём была бы скрыта
   отовсюду и не удалялась бы «Очистить корзину».
2. Положение из копии, для которого нет записи после импорта, и (при слиянии) положение, уступившее локальному,
   считаются в `skipped` (спецификация про счётчик для этих случаев молчит).
3. Суффикс имени поиска укорачивает основу, чтобы имя осталось в пределах `SAVED_SEARCH_NAME_MAX`.

## Проверки
- `npx vitest run src/lib/exportImport.test.ts src/db/seed.test.ts` — 52 из 52 (41 + 11).
- Проверка теста корзины «от обратного»: без условия `deletedAt === undefined` тест падает (условие возвращено).
- `npm run typecheck` (три запуска с интервалом): в своих файлах ошибок нет; красный из-за чужих файлов в работе —
  `src/db/repo.test.ts` (TS6133, 21 неиспользуемый импорт — `data-repo`) и `src/lib/desktop.ts:65`
  (TS2307, нет модуля `./autoBackup` — `tauri-backup`).
- `npm test`: 715 из 724; 9 красных — все в чужих файлах: `db/repo.test.ts` (2), `lib/graphLayout.test.ts` (6),
  `lib/actions.test.ts` (1, ожидаемый по §4 спецификации).

## Не проверено
- В браузере (настоящий IndexedDB, настоящие Blob) импорт/экспорт не проверялся — только fake-indexeddb.
- Экран настроек (`views/settings/DataSection.tsx`) новые поля отчёта `positions`/`searches` не показывает — вне задачи.
