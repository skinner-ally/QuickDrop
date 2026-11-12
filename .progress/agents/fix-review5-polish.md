# fix-review5-polish

Задача: доводка этапа 5 по 17 замечаниям повторной сверки (дубли: 1=9, 5=11, 6=16, 7=15).
Статус: готово (typecheck чист, vitest 60 файлов / 1887 тестов).

## Что сделано
- 1/9: `deferSelect(touch, sidePanel, panelOpen, underPanel)` + `underDetailPanel`; `DETAIL_ASIDE_PX` (interaction.ts) — общая ширина панели, AppShell берёт её; клик в полосе закрытой панели откладывается.
- 7/15: `GRAPH_SELECT_DEFER_MS = GRAPH_DBL_MS`; `onPointerDown` снимает отложенный выбор.
- 13: `secondClickNode(prev, p, now, view)` — память работает, только если сцена (camera/viewSize) менялась; `Press.memoView` переносит ссылки первого клика во второй.
- 8: ручка связи снаружи ноды (заход 4 px, 20 px, от масштаба 1), второй клик по ручке своей ноды = клик по ноде (`swallowHandle`), dblclick по ручке пропускается только если это не двойной клик по её ноде.
- 14: `handleVisible` (не на coarse), убраны pointer-coarse размеры.
- 2: `lastViewSize` в сторе, возврат из 0 от него; размер сцены сохраняется как `w`, `h` рядом с камерой.
- 12: первый замер — `main.getBoundingClientRect()`; `resizeKeep` держит центр при долях пикселя.
- 3: `GRAPH_ZONE_RESERVE = 24`, тесты «Весь граф не мельче 50 %».
- 4: при u = 1 у обычных связей нет кромки, сердцевина цвета кромки; тесты нагрузки (20 и 25 мс) и функциональный.
- 5/11: `revealDecision` возвращает `moved`; GraphView ведёт камеру при переезде с запасом 0.
- 6/16: `GRAPH_WHEEL_BURST_MS = 50`: крупная дельта в потоке событий копится, одиночная — шаг сразу.
- 10: `cursorByKeys` в сторе, `tooltipTarget(byKeys)`.
- 17: docs/DESIGN.md §13 (+токены), .progress/spec-stage5.md (пометки и раздел «Уточнения»).

## Изменённые файлы
src/lib/graph/{interaction,geometry,draw}.ts (+тесты), src/components/graph/{gestureLogic,useGraphGestures,useGraphKeys,overlayGeometry,GraphLinkTools,GraphTooltip,GraphCanvas}.ts(x) (+тесты), src/store/graph.ts (+тест), src/views/GraphView.tsx, src/components/layout/AppShell.tsx, src/lib/graphLayout.ts (+тест), docs/DESIGN.md, .progress/spec-stage5.md
