# spec-stage5-review

- Задача: сверка `.progress/spec-stage5.md` с кодом (файлы, экспорты, сигнатуры, контракты CLAUDE.md, docs/DESIGN.md,
  покрытие «Этапа 5» плана, долгов HANDOFF и решений пользователя), проверка раскладки на устойчивость, разбивка на пакеты.
- Статус: готово
- Код не менялся, git не трогался. Временные скрипты — только в scratchpad (вне репозитория).

## Что проверено

- Существуют и совпадают с текстом спецификации: `graphLayout.ts` (`computeLayout`, `findFreeSpot`, `snapToGrid`,
  `toLayoutNodes`, константы; вне графа берётся только `snapToGrid` в `exportImport.ts`), `store/graph.ts` (никто не
  импортирует; `graph.test.ts` берёт `GRAPH_NONE_ZONE`), `repo` (`setPositions`, `getPositions`, `removePositions`,
  `clearPositions`, `setCategory` сбрасывает место ноды, `deleteItems` не трогает место, `purgeItems` удаляет),
  `useItems` (`useItemsWithTrash`, `usePositions`, `useCategories`, `useDayKey`), `computeVisible`, `search`
  (`searchItems(..., { within, trash, now })` — без `trash: 'any'` `is:trash` даёт пусто, как в §2.5;
  `matchesFilterIgnoringTrash`), `store/ui` (`View` уже содержит `'graph'`, `NO_LIST_VIEWS`, `applyQuery(q, view)`,
  `UiFilter`), `savedSearch` (`isNarrowed`, `isSavedSearchActive`, `sectionFilter('graph') = {}`), `actions`
  (`safe`, `actApplySearch`, `openItemInSection`, `actArchive/actUnarchive/actDelete/actToggleFavorite`), значки
  `graph link minus plus maximize layout eye eye-off`, `EmptyState`, `Kbd`, `lazyRetry`, `matchKey`, `itemActionList`,
  `NavButton.count?`, `VIEW_BY_DIGIT`, `go-archive`, `ShortcutsSection`, CSS-переменные сцен (`--rope-a/b/edge`,
  `--gold`, `--wood-dark`, `--shadow`, `--label(-edge)`, `--paper`, `--ink`, `--cat-none`), примитивы `px-pop/chip/sw/btn`,
  нумерация разделов `pixel.css` (1–6, «Телефон» — 6) и `DESIGN.md` (1–12).
- Покрытие: все пункты «Этап 5» плана, оба долга HANDOFF (ров `GRAPH_MOAT`, разведение `displaced`), решения
  пользователя (без грядок; квадрат цвета категории; без отметки избранного — в draw/tooltip/a11y её нет).
- Раскладка — модель алгоритма (порт кода + изменения §2.2) в scratchpad, `layout-sim.mjs` / `run-sim.mjs`:
  нод с чужой нодой в квадрате 5×5 — прежний алгоритм 353 / 414 (перекос) / 278 (новая категория), с рвом — 0 во всех
  прогонах, включая 12 зон × 1500 шагов. На каждом шаге `placed` = только новая нода, прежние точки не меняются,
  клетки уникальны; коллизия разводится в ближайшую клетку. 2000 нод с нуля ~10 мс, 2000 + 1 ~5 мс.
  Цена рва — острова и «тропки» по середине коридоров у зажатой зоны (58 + 5 + 4 + 3 + 2). Вариант «отдельный
  участок только при пустом от чужих квадрате 9×9» (`layout-sim2.mjs`) даёт 58 + 14 — вынесен в вопросы.

## Исправлено в спецификации (пометка «(уточнено при сверке)»)

1. Разбивка (§1.3, §4.0, §4.2–§4.5, §7): волна 1 больше не импортирует друг друга. `graph-screen` (`GraphView`,
   `GraphCanvas`, жесты, клавиши, `AppShell`) — волна 2: `GraphView` собирает экран из `draw.ts`, `GraphOverlay`,
   `GraphHeader/Toolbar/Hint`. Правило «каркасы первым действием» и «typecheck может падать на чужих» убрано.
   `graph-dom` и `graph-chrome` — без браузера, их сценарии проходит `graph-screen` (замечания — в его отчёт).
2. `FilterBar.tsx` (общий компонент) перенесён из `graph-chrome` в волну 0 (§3.9).
3. `graph-base` разделён: `graph-base` (стор, действия, repo, сохранённый поиск, hotkeyGuards) и `graph-look`
   (theme, ambient, CSS, DESIGN, FilterBar). Волна 0: core → base → look.
4. `GRAPH_COLOR_KEYS` перенесён в `lib/graph/types.ts` (его использует `scene.ts` пакета graph-core, а `theme.ts`
   пишется позже); `theme.ts` реэкспортирует.
5. Новое `repo.addPositions` (§3.2а): места раскладки пишутся без затирания. Иначе поздняя запись `placed` по
   отставшему снимку затирала «Отменить» у «Разложить» и у `actSetCategory`. `GraphView`: `addPositions` для
   `placed − displaced`, `setPositions` для `displaced`. Сценарий проверки №10 в §4.2.
6. `GraphView`: мемо раскладки по подписи (`id`, `categoryId`, `createdAt`, `links`, `deletedAt`, порядок категорий,
   `fixed`), а не по массиву записей — правка текста в деталях не пересчитывает раскладку.
7. §2.2: кандидаты (б) у связанной ноды чужой зоны — квадрат `NEIGHBOR_REACH + GRAPH_MOAT` (при 2 = 2 прежний
   квадрат целиком во рву, правило было бы мёртвым); тест «связанная нода» переписан проверяемо (не дальше, чем без
   связи); обоснование монотонности указателя; итоги модели. §8 п. 13 — вопрос про «тропки».

## Вопросы основной сессии

- «Тропки» зажатой зоны (§8 п. 13): принять как есть (лечится «Разложить») или добавить правило квадрата 9×9 для
  начала отдельного участка (в модели: меньше обрывков, сложность — указатель зоны перестаёт пропускать такие клетки
  навсегда, их надо перебирать заново).
- Волна 2 удлиняет путь: `graph-screen` (opus, самый крупный) идёт один после волны 1. Альтернатива — разрешить
  нарушение «один файл — один пакет» (каркасы в волне 0, наполнение в волне 1); сверка выбрала волну 2.
- Боковая панель в «Графе»: счётчики категорий и список тегов считаются только по «Базе знаний» (так задумано для
  списков); как легенда графа они неполны. Не в спецификации — оставить или считать по всем записям графа в разделе «Граф».
- Палитра в «Графе»: «Искать «…» в базе знаний» уводит из графа (текст это прямо говорит) — оставить или добавить
  «…на графе».

## Изменённые файлы

- `.progress/spec-stage5.md`
- `.progress/agents/spec-stage5-review.md` (этот файл)
