# fix-review5-layout-geometry

Задача: исправления ревью этапа 5 (группа layout-geometry): C1 (стор), C2, C3, C4, C8 (логика), M2, M17, прочие minor
в своих файлах (graphLayout.ts, src/lib/graph/* кроме draw/theme/ambient, store/graph.ts).

Статус: готово (код в своих файлах; экраны должны подключить новое API — см. ниже)

## Исправлено

- C1 (стор): `setViewSize(w, h, keep?)` подстраивает камеру (`resizeCamera` в geometry.ts) — на экране ничего не
  сдвигается, по умолчанию на месте левый верхний угол. Из 0 и в 0 камера не трогается. `cameraRev` при этом не растёт.
  Память о клике: `secondClickNode`, `GRAPH_DBL_MS`, `GRAPH_DBL_PX`, `GRAPH_SELECT_DEFER_MS` (lib/graph/interaction.ts).
- C2: `hitNodeStrict` — квадрат + 2 экранных px, но запас не больше 4 мировых px (иначе на 25 % и 12,5 % строгая зона
  тоже смыкалась бы: формула из находки там покрывает всю решётку). Тесты: посреди соседей −1 на всех ступенях.
- C3: `pickLabels(..., { core })` — ноды видимой области обходятся первыми.
- C4: запас места новой зоне `GRAPH_ZONE_RESERVE = 48` (радиус 8 клеток) только при дополнении сохранённой раскладки
  + правило «отдельный участок начинается только там, где в квадрате 9×9 нет чужих нод» (`usable`, указатель зоны по
  таким клеткам не сдвигается). Замер (рост по одной записи, 0–2 связи): до — 6–12 % нод вне основного участка
  (300…2000 записей), после — 0 % на 300/6, 500/8, 600/8, 800/8, 1000/10, 1500/12, 2000/12, 3000/20; 3000/12 — 4,6 %
  (зоны по 250 нод перерастают запас). Только правило 9×9 без запаса — 4–14 %. Ров соблюдён везде.
- C8 / M1: `revealDecision(prev, cur)` + `useGraph.cameraRev`; нода переехала — камера идёт за ней (M1 б).
- M2: колесо — строки/страницы и пиксели от 30 — шаг сразу; мелкие копятся до 90; пауза > 250 мс сбрасывает.
- M17: `hitNode`/`hitLink` принимают `{ radiusPx }`, `GRAPH_TOUCH_HIT_PX = 18`.

## Пропущено

- Подключение в GraphView, GraphCanvas, GraphLabels, useGraphGestures — чужие файлы (точные правки в отчёте).
- M5 (порог жеста для пальца) — useGraphGestures, чужой файл.
- Пометки в spec-stage5.md §2.2/§2.6/§8 п. 13 — вне границ пакета.

## Файлы

- src/lib/graphLayout.ts, src/lib/graphLayout.test.ts
- src/lib/graph/geometry.ts, src/lib/graph/geometry.test.ts
- src/lib/graph/labels.ts, src/lib/graph/labels.test.ts
- src/lib/graph/interaction.ts (новый), src/lib/graph/interaction.test.ts (новый)
- src/store/graph.ts, src/store/graph.test.ts

Проверка: `npm run typecheck` — чисто; `npm test` — всё моё проходит; падают 2 теста draw.test.ts (draw.ts в это время
правит другой исполнитель, мои изменения draw не затрагивают).
