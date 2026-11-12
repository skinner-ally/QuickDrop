# stage5-graph-base

- Задача: пакет «graph-base» этапа 5 (волна 0, после graph-core) — стор графа, действия графа в `lib/actions.ts`,
  `repo.addPositions`, `isSavedSearchActive` для «Графа», `lib/hotkeyGuards.ts`. Спецификация —
  `.progress/spec-stage5.md` §3.1, §3.2, §3.2а, §3.3, §3.6.
- Статус: готово

## Результат

- `store/graph.ts`: ступени масштаба (`snapZoom` при любой записи камеры и чтении из хранилища; `GRAPH_ZOOM_MIN = 0.125`,
  `GRAPH_ZOOM_MAX = 2`), `cameraRestored`, `viewSize`, `bounds`, `cursorId`, `drag`, `linkFrom`, `selectedLink`, `menu`,
  `pickerFor`, `showArchive` и `hintSeen` (ключи `qd-graph-archive` / `qd-graph-hint`, пишутся сразу, try/catch),
  `zoomStep`, `panBy`, `fitAll`, `centerOn`, `resetTransient`; открытие одного из всплывающих (`openMenu`,
  `openPicker`, `selectLink`) закрывает остальные; то же значение не будит подписчиков. `focusZone` и
  `setFocusZone` удалены. `GraphCamera` определён в `lib/graph/types`, из стора реэкспортируется.
- `lib/actions.ts`: `actMoveNode`, `actLinkItems`, `actUnlinkItems`, `actSetCategory`, `actRelayoutGraph` (toast на
  10 000 мс); `actApplySearch` из «Графа» остаётся в «Графе» (`applyQuery(query, 'graph')`); `openItemInSection` из
  «Графа» для записи не из корзины раздел не меняет, архивной включает `showArchive`.
- `db/repo.ts`: `addPositions(map)` — одна транзакция, пишет только id без положения (`bulkGet` + `bulkAdd`), негодные
  точки и неизвестные id пропускает, `updatedAt` не меняет.
- `lib/savedSearch.ts`: `isSavedSearchActive` при `view === 'graph'` раздел запроса не сверяет.
- `lib/hotkeyGuards.ts`: `isEditableTarget`, `overlayOpen`, `detailSheetOpen` (копия проверок `useHotkeys.ts`;
  `useHotkeys.ts` не тронут).
- Тесты: `store/graph.test.ts` (переписан, 38 тестов), `actions.test.ts` (+14, один прежний кейс «граф → library»
  убран из таблицы), `savedSearch.test.ts` (+1), `repo.test.ts` (+1). `npm run typecheck` чист, `npm test` —
  53 файла / 1722 теста, зелёные.

## Решения на месте

- `actLinkItems`: после `linkItems` связь перепроверяется; запись в корзине или неизвестная → `toast.error('Не удалось
  связать записи')` (иначе `linkItems` молча ничего не делает и toast «Записи связаны» был бы ложным).
- `actSetCategory`: toast для нескольких записей — «Категория: Работа (2)»; считаются только записи, у которых
  категория действительно меняется; отмена: `setCategory` по группам прежних категорий → `setPositions` по снимку
  мест, сделанному до изменения.
- `cameraRestored` ставится только при создании стора (по спецификации). После первого `fitAll` он остаётся
  `false`: повторный показ графа в той же сессии должен отличать «первый раз» сам (ref или флаг в `GraphView`).
- `setViewSize` приводит негодные и отрицательные значения к 0; `panBy` с негодными дельтами игнорируется.
- `NO_LIST_VIEWS` в `actions.ts` теперь `settings`, `trash` (граф обрабатывается раньше).
- `hotkeyGuards.ts` страхуется от окружения без DOM (`typeof document/HTMLElement`), чтобы импорт был безопасен в тестах.

## Изменённые файлы

- `src/store/graph.ts`, `src/store/graph.test.ts`
- `src/lib/actions.ts`, `src/lib/actions.test.ts`
- `src/lib/savedSearch.ts`, `src/lib/savedSearch.test.ts`
- `src/db/repo.ts`, `src/db/repo.test.ts`
- `src/lib/hotkeyGuards.ts` (новый)
- `.progress/agents/stage5-graph-base.md`

## Запросы CSS

Нет.

## Не проверено

- Браузер не нужен пакету и не запускался. `hotkeyGuards.ts` тестами не покрыт (нужен DOM; vitest в среде node).
