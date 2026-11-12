# data-hooks

Задача: этап 2, волна 2 — `src/hooks/useItems.ts`, `src/lib/actions.ts`, `src/lib/trashCleanup.ts` (нов.),
`src/lib/ocr.ts` (нов.) и их тесты. Спецификация: `.progress/spec-stage2.md` §2.9, §2.10, §3, §4, §5.

Статус: готово

## Результат

`src/hooks/useItems.ts`
- Источник прежний (один `liveQuery(() => db.items.toArray())`), срезы считаются один раз на снимок (`WeakMap`):
  `getAllItemsSnapshot` / `useAllItems` — без корзины; `getTrashedItemsSnapshot` / `useTrashedItems` — корзина по
  `deletedAt` убыв.; `getItemsWithTrashSnapshot` / `useItemsWithTrash` — всё. Корзина пуста → срез без корзины —
  тот же массив, что и полный снимок, корзина — общий пустой массив.
- Новые: `useTrashCount`, `usePositions` (liveQuery `getPositions`), `useSavedSearches` (по `order`, `[]` пока грузится),
  `useDayKey` (+ `getDayKey`, `subscribeDayKey` для тестов: один таймер до полуночи на всех подписчиков, сверка при
  возврате в окно).
- `useVisibleItems` берёт `useItemsWithTrash()`, в зависимостях `useDayKey()`; `now` в `computeVisible` не передаётся.
- `useLinkedItems` — без записей в корзине. `useItem`, `useCounts`, `useAllTags`, `computeCounts`, `computeAllTags` — без правок.

`src/lib/actions.ts`
- `actDelete` — в корзину, toast «В корзине» / «В корзине: N» + «Отменить» (`restoreItems`).
- Новые: `actRestoreFromTrash`, `actPurge`, `actEmptyTrash`, `actSaveSearch`, `actDeleteSearch`, `applyWikiLinks`.
- `createAndEnrich` для PDF в фоне запускает `extractItemText`.
- `safe()` стал обобщённым (`Promise<T | undefined>`), поведение прежних вызовов не изменилось.

`src/lib/trashCleanup.ts` — `TRASH_CLEANUP_EVERY_MS`, `cleanupTrash`, `startTrashCleanup` (+ `TRASH_CLEANUP_FIRST_MS`).

`src/lib/ocr.ts` — `TextSource`, `ExtractOutcome`, `textSourceOf`, `extractItemText`, `backfillPdfText` (+ `BACKFILL_PDF_LIMIT`).

## Изменённые файлы

- `src/hooks/useItems.ts`, `src/hooks/useItems.test.ts`
- `src/lib/actions.ts`, `src/lib/actions.test.ts`
- `src/lib/trashCleanup.ts`, `src/lib/trashCleanup.test.ts` (новые)
- `src/lib/ocr.ts`, `src/lib/ocr.test.ts` (новые)

## Проверки

- `npx vitest run` своих четырёх файлов — 51 тест, зелёные (три прогона подряд).
- Полный `npm test` — 35 файлов, 1173 теста, зелёные.
- `npm run typecheck` — чист (последний прогон). В промежуточных прогонах были 6 ошибок TS2322
  `LucideIcon → ReactNode` в `src/views/{ArchiveView,FavoritesView,InboxView,ItemsView,LibraryView}.tsx` — чужие файлы
  (параллельная миграция значков), ушли без моего участия.
- `npx oxlint` по своим файлам — одно прежнее предупреждение (`useFileUrl`, код не менялся).

## Решения там, где спецификация молчит

- `actRestoreFromTrash`: N — число записей, реально лежавших в корзине; если таких нет — toast не показывается.
  `actPurge` при 0 удалённых — тоже без toast.
- `extractItemText`: прерывание (`aborted`) → `skipped` (в `ExtractOutcome` нет `aborted`; `failed` показал бы toast на
  этапе 8); файла нет в таблице `files` → `failed` «Файл не найден»; запись исчезла за время разбора → `skipped`.
- PDF со статусом `empty` при `vision: true`: отметка `ocrAt` ставится (текстовый слой проверен), возвращается `skipped`.
- Одновременные вызовы `extractItemText` для одной записи без `force` делят один разбор (создание записи + фоновый обход).
- `backfillPdfText`: `limit` ограничивает число попыток; возвращается число записей, получивших `ocrAt` (`ok`/`empty`).
  Не бросает (ошибка → 0 + `console.warn`): вызывается как `void backfillPdfText()`.

## Не проверено

- В браузере ничего не запускалось (порт не выделен, задача без интерфейса): хуки `useTrashedItems`, `useItemsWithTrash`,
  `useTrashCount`, `usePositions`, `useSavedSearches`, `useDayKey`, изменённые `useVisibleItems` и `useLinkedItems`
  проверены только typecheck и тестами функций-снимков (окружение тестов — node, без рендера React).
- Сверка суток по `visibilitychange` (ветка с `document`) тестами не покрыта.
- Настоящий `pdfjs-dist` в связке `createAndEnrich` → `extractItemText` не запускался (в тестах подмена `@/lib/pdfText`).

## Для основной сессии

- `backfillPdfText`: PDF, которые стабильно дают `failed` (пароль, > 50 МБ, битый файл), `ocrAt` не получают (так в
  спецификации) и при каждом запуске пробуются снова; если таких в начале таблицы ≥ `limit`, до остальных очередь не
  дойдёт. Нужно решение: ставить `ocrAt` при неустранимых ошибках или не считать сбои в `limit`.
- Точки интеграции из §6 п.3 (`startTrashCleanup()`, отложенный `void backfillPdfText()` в `src/main.tsx`) — не мои файлы.
