# data-repo

Задача: этап 2, волна 1 (`.progress/spec-stage2.md` §0, §2.1, §2.2, §3, §4) — репозиторий: корзина
(`deletedAt`), окончательное удаление, положения нод графа, сохранённые поиски, распознанный текст, дубли ссылок;
новый чистый модуль `src/lib/dedupe.ts`.

Файлы: `src/db/repo.ts`, `src/db/repo.test.ts`, `src/lib/dedupe.ts` (новый), `src/lib/dedupe.test.ts` (новый).

Статус: готово

## Результат

Работа возобновлена после прерванного запуска: `repo.ts`, `dedupe.ts`, `dedupe.test.ts` к этому моменту были
написаны — сверены со спецификацией построчно, правок не потребовалось. В `repo.test.ts` были только импорты и
очистка новых таблиц — тесты дописаны в этом запуске.

`src/db/repo.ts` (все сигнатуры из CLAUDE.md сохранены, только добавления):
- корзина: `deleteItem` / `deleteItems` ставят только `deletedAt` (одно `now` на пакет; `updatedAt`, `links`, файл,
  положение не трогаются), снимок берётся до правки; `restoreItem` / `restoreItems` — запись в БД: снять `deletedAt`
  (+ `settleLinkMeta` для `pending`), запись вне корзины не трогается; записи нет — воссоздание из снимка (прежний
  алгоритм); `restoreFromTrash`, `purgeItems` (каскад: файлы по `itemId` и `fileId`, связи соседей без смены
  `updatedAt`, `positions`), `emptyTrash`, `purgeExpired` (граница включительно, `days ≤ 0`/не конечное → 0);
- `linkItems` ничего не делает, если одна из записей в корзине;
- положения: `setPositions`, `getPositions`, `removePositions`, `clearPositions`; положение удаляется при реальной
  смене категории (`setCategory`, `updateItem({ categoryId })`, `deleteCategory`) и при `purgeItems`;
- сохранённые поиски: `listSavedSearches`, `createSavedSearch`, `updateSavedSearch`, `deleteSavedSearch`,
  `reorderSavedSearches`, `restoreSavedSearch`;
- `setOcrText`, `findDuplicateLink`.

`src/lib/dedupe.ts`: `linkKey`, `sameLink`, `findDuplicateLinkIn` — по правилам §2.2.

Тесты (`npx vitest run src/db/repo.test.ts src/lib/dedupe.test.ts`): 2 файла, 120 тестов, зелёные (3 прогона подряд).
- §3.1: переписаны «каскадно удаляет файл…» (теперь «deleteItem переносит в корзину…»), «deleteItems: снимки
  связанной пары…» (связь соседа остаётся), «deleteItem бросает…» (+ запись в корзине); добавлены варианты «после
  purgeItems» для вечной загрузки и исчезнувшей категории;
- §3.2: корзина, `purgeItems` (в т.ч. рассинхрон `fileId`/`itemId`), `emptyTrash`, `purgeExpired`, воссоздание после
  `purgeItems`, `linkItems` с корзиной, положения, сохранённые поиски, `setOcrText`, `findDuplicateLink`;
- сверх списка: откат транзакции при сбое посреди `purgeItems` и `restoreItems` (ничего не теряется и не остаётся
  наполовину), теги/категории меняются и у записей в корзине, id `__proto__` в `getPositions`.

Проверки: `npm run typecheck` — зелёный; `npx oxlint` по четырём файлам — код возврата 0.

Полный `npm test` на момент сдачи: 832 прошло, 11 упало — все в чужих файлах:
- `src/lib/actions.test.ts › удаление и отмена во время загрузки…` — ожидаемый по §4 красный тест (чинит `data-hooks`);
- `src/lib/graphLayout.test.ts` (5) — файл агента `data-graph`, `repo`/`dedupe` не импортирует;
- `src/lib/pdfText.test.ts` (5, блок «настоящий pdf.js») — файл агента `data-pdf`, `repo`/`dedupe` не импортирует.

## Изменённые файлы

- `src/db/repo.ts`
- `src/db/repo.test.ts`
- `src/lib/dedupe.ts` (новый)
- `src/lib/dedupe.test.ts` (новый)
- `.progress/agents/data-repo.md`

## Отступления от спецификации

- `linkKey`: до `normalizeUrl` стоит проверка `hasForeignScheme` — иначе `mailto:a@b.c` после дописывания `https://`
  стал бы адресом с логином `mailto` и получил ключ, а §3.2 требует `null`.
- `isBetterDuplicate`: при равных `createdAt` добивка по меньшему `id` (в спецификации порядок при равенстве не
  задан) — результат не зависит от порядка записей во входном списке.

## Не проверено

- В браузере (настоящий IndexedDB) не проверялось — только `fake-indexeddb` в vitest.
- `restoreSavedSearch` с суффиксом может дать имя длиннее `SAVED_SEARCH_NAME_MAX` (спецификация: «put как есть»,
  предел при восстановлении не оговорён) — оставлено как есть.
- `emptyTrash` находит корзину по `deletedAt > 0` (буквально по спецификации): запись с `deletedAt ≤ 0` возможна
  только при прямой записи в БД мимо репозитория, такой случай не покрыт.
