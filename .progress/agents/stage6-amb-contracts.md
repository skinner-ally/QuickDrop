# stage6-amb-contracts

Задача: пакет «amb-contracts» этапа 6 (волна 0) — типы живого фона, решётка устройства, операции над растром,
дополнение контракта `lib/graph/ambient.ts`, помощник тестов `src/test/sceneVars.ts` (spec-stage6 §3.1–3.5).

Статус: готово

## Результат
- `src/lib/ambient/types.ts` — типы и константы §3.1 дословно (AMBIENT_TILE_BUDGET_MS = 10; правило опор — комментарий).
- `src/lib/ambient/lattice.ts` — latticeStep, softenFor, effectUnit, toLattice, tileRange, tileBounds, tileOrigin (§2.2).
  Решения на свободе спецификации: tileRange при W или H <= 0 — пустой диапазон (ti1 < ti0); softenFor(негодный/<=0) → 0
  (как zoom 1); effectUnit при негодном dpr — как 1.
- `src/lib/ambient/raster.ts` — §3.3 плюс добавочный `getPx` (чтение пикселя, вне растра 0). setPx пропускает любой цвет
  с альфой 0 (не только c = 0); ditherPx: порог клетки Байера (n + 0.5)/16, рисует через blendPx; glow умножает альфу c
  на (1 − d)²·k; shadeBox — рамка [floor(x0), ceil(x1)) × [floor(y0), ceil(y1)), fn по центрам пикселей.
- `src/lib/graph/ambient.ts` — только добавления: AmbientWake, AmbientStats, AmbientFrame.sceneRev/points,
  AmbientLayer.stats, subscribeAmbient(cb: (kind) => void); 'layer' из setAmbientLayer, 'frame' из requestAmbientFrame.
  Шапка обновлена. theme.test.ts и GraphCanvas.tsx не тронуты (GraphCanvas компилируется).
- `src/test/sceneVars.ts` — parseRootBlocks/RootBlock, sceneVars, readSceneCss, SCENE_VARIANTS (8), luminance, contrast,
  overlay; `/// <reference types="node" />` первой строкой; из кода приложения не импортируется.

## Тесты
lattice.test.ts (7 ступеней × dpr 1/1.25/1.5/2, стыки, tileRange при отрицательных/больших ox, effectUnit),
raster.test.ts, graph/ambient.test.ts, test/sceneVars.test.ts. `npm run typecheck` — ок; `npm test` — 64 файла,
1960 тестов, все прошли.

## Изменённые файлы
src/lib/ambient/{types,lattice,lattice.test,raster,raster.test}.ts, src/lib/graph/ambient.ts,
src/lib/graph/ambient.test.ts, src/test/sceneVars.ts, src/test/sceneVars.test.ts.

## Не проверено
Браузер не нужен по заданию; поведение на big-endian платформе (каналы chR..chA) проверено только логически.
