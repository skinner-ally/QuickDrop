# stage5-graph-core

- Задача: пакет «graph-core» этапа 5 (волна 0) — чистые модули графа с тестами: переработка `graphLayout.ts`
  (ров `GRAPH_MOAT`, разведение коллизий `displaced`, проверка центра новой зоны по фактическим нодам,
  `toLayoutNodes(items, fixed)`), новые `lib/graph/{types,geometry,scene,match,labels}.ts`. Спецификация —
  `.progress/spec-stage5.md` §2.
- Статус: готово

## Результат

- `graphLayout.ts`: шапка с четырьмя гарантиями; `GRAPH_MOAT = 2`; `LayoutResult.displaced`, `bounds: Bounds | null`;
  шаги 2а (сохранённые по (createdAt, id), коллизии — на разведение) → 2б (скрытые: только occupied) → 2в (разведение
  в ближайшую свободную клетку, общий помощник `nearestFreeCell` с `findFreeSpot`); `occupied` + `claim`
  (`mark`/`blocked`, MIXED); центр новой зоны дополнительно проверяется по нодам с местом и клеткам скрытых записей
  (корзины 8 клеток, запас `r + GRAPH_MOAT·GRAPH_CELL`); размещение везде через `blocked`; кандидаты (б) у соседа
  чужой зоны — квадрат 9×9 (`NEIGHBOR_REACH + GRAPH_MOAT`), своей — 5×5. `toLayoutNodes(items, fixed?)` — архив
  входит, корзина — только с годным положением в `fixed`.
- `lib/graph/types.ts` — по §2.1 (включая `GRAPH_COLOR_KEYS`, `GRAPH_ALPHA_DIM`, `GRAPH_ALPHA_ARCHIVED`).
- `lib/graph/geometry.ts` — по §2.3. `scene.ts` — §2.4. `match.ts` — §2.5. `labels.ts` — §2.6.
- Тесты: `graphLayout.test.ts` 64 (общая проверка уникальности клеток обёрткой над каждым вызовом `computeLayout`;
  коллизии, скрытые записи, ров, постепенный рост 7×8 + 500 / перекос 70 % / новая категория на шаге 150,
  `toLayoutNodes`, 2000 + 1 < 300 мс), `geometry` 27, `scene` 10, `match` 9, `labels` 12.
  Проверено, что тесты рва и роста падают при отключённом рве (временная правка, снята).
- Время (vitest, эта машина): 500 шагов роста ~0.9 с; 2000 нод с нуля + дополнения — 21 мс на весь тест.
- `npm run typecheck` чист; `npm test` — 53 файла / 1692 теста, все зелёные.

## Решения на месте (в отчёт)

- `snapZoom`: ничья — меньшая ступень; ±Infinity — края. `stepZoom` от масштаба не со ступени — ближайшая в ту сторону.
- `worldToScreen`/`screenToWorld` идут через целые `ox, oy` (`deviceTransform`), `zoomAt` — без округления
  (приближение и отдаление в одной точке возвращают камеру точно); `zoomAt` приводит масштаб к ступени.
- `fitCamera`: «размер 0» понят как размер сцены ≤ 0; отступ `padPx` — с каждой стороны.
- `ensureVisible`: запас ограничен половиной стороны сцены; камера уже в p → null.
- `wheelSteps`: после шага накопленное сбрасывается в 0, смена направления начинает заново.
- `pickLabels`: приоритетные (`priority`) подписываются и при `dim` — Р6 «всегда»; фильтр приглушённых — во втором
  проходе, как в тексте §2.6. Нужен другой выбор — `GraphView` может не класть приглушённые в `priority`.
- Центр новой зоны проверяется по клеткам (узлам сетки) скрытых записей и фактическим точкам нод с местом.

## Изменённые файлы

- `src/lib/graphLayout.ts`, `src/lib/graphLayout.test.ts`
- `src/lib/graph/types.ts`, `geometry.ts`, `geometry.test.ts`, `scene.ts`, `scene.test.ts`, `match.ts`,
  `match.test.ts`, `labels.ts`, `labels.test.ts` (новые)
- `.progress/agents/stage5-graph-core.md`

## Запросы CSS

Нет.

## Не проверено

- Браузер не нужен пакету и не запускался.
- `src/store/graph.ts` не тронут: он по-прежнему объявляет свой `GraphCamera` (переезд — пакет graph-base).
