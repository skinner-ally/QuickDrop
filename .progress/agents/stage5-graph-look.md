# stage5-graph-look

- Задача: пакет «graph-look» этапа 5 (волна 0) — цвета графа из CSS (`lib/graph/theme.ts`), контракт живого фона
  (`lib/graph/ambient.ts`), весь CSS этапа (`--ground`, `--graph-*`, раздел «6. Граф» в `pixel.css`), раздел «13. Граф»
  в `docs/DESIGN.md`, проп `mode` у `FilterBar`. Спецификация — `.progress/spec-stage5.md` §3.4, §3.5, §3.7, §3.8, §3.9.
- Статус: готово

## Результат

- `lib/graph/theme.ts`: реэкспорт `GRAPH_COLOR_KEYS` (та же константа из `types.ts`), `packRgba` (порядок байтов
  r, g, b, a в памяти на любой платформе, проверка endianness один раз, значения приводятся к байту),
  `readGraphTheme(root)` (скрытый span-пробник с `color: var(--имя)` + `getComputedStyle`; байты — заливка точки на
  служебном canvas 1×1 и `getImageData`; прозрачные `nodeEdge`, `shadow`, `selEdge` → `null`; пробник и canvas
  убираются в `finally`), `subscribeGraphTheme` (MutationObserver на атрибут `class` у `<html>`; вне браузера —
  пустая отписка). Добавлено сверх контракта: `composeGraphTheme(pixel, reader)` и тип `GraphColorReader` — чистая
  сборка темы по таблице соответствия (через неё тест без DOM проверяет, какое поле из какой переменной берётся).
- `lib/graph/ambient.ts`: `AmbientFrame`, `AmbientLayer`, `setAmbientLayer`, `getAmbientLayer`, `requestAmbientFrame`,
  `subscribeAmbient` по §3.5. Установка того же слоя подписчиков не будит; подписчик может отписаться изнутри вызова.
- `index.css`: в `:root` («Классика») `--ground`, `--label`, `--label-edge`, `--graph-*` по §3.7.
- `styles/scenes.css`: `--ground` в каждом из восьми блоков сцен (значения мокапа); в `:root.pixel` — блок «Граф»
  (`--graph-*`).
- `styles/pixel.css`: раздел «6. Граф» (`px-graph-stage`, `px-graph-label`, `data-plate`), «Телефон» стал разделом 7.
- `docs/DESIGN.md`: раздел «13. Граф»; в таблицу §3 — строка про `--ground` и `--graph-*`; в таблицу §5 — строки
  `px-graph-stage` и `px-graph-label`.
- `FilterBar`: проп `mode?: 'list' | 'graph'` (по умолчанию `'list'`). В `'graph'` блок `sortBlock` не рисуется ни на
  ПК, ни на телефоне; в `'list'` разметка прежняя.
- Проверено: `npm run typecheck` чист; `npm test` — 54 файла / 1737 тестов зелёные (в `theme.test.ts` 15: порядок
  цветов, `packRgba` — байты в памяти и запись через Uint32Array поверх ImageData, сборка темы по таблице, `null` для
  прозрачных, отписка вне DOM, контракт ambient). CSS компилируется: dev-сервер на порту 5196 отдал `index.css` со всеми
  восемью `--ground` и правилами `px-graph-*` (порт освобождён, процесс остановлен).

## Решения на месте

- Тесты ambient лежат в `theme.test.ts` отдельным `describe`: отдельного файла для них в списке пакета нет.
- В разделе «6. Граф» правила по тексту §3.7 без изменений. Обводка фокуса `.px-graph-stage:focus-visible` равна по
  специфичности правилу «2. Фокус» и идёт после него, поэтому `outline-offset: -4px` действует (цвет и ширина — из
  раздела 2).
- `readGraphTheme`: без 2D-контекста (в браузере не бывает) запасной разбор различает только `transparent` и
  непрозрачное.

## Изменённые файлы

- `src/lib/graph/theme.ts`, `src/lib/graph/theme.test.ts`, `src/lib/graph/ambient.ts` (новые)
- `src/index.css`, `src/styles/scenes.css`, `src/styles/pixel.css`
- `docs/DESIGN.md`
- `src/components/items/FilterBar.tsx`
- `.progress/agents/stage5-graph-look.md`

## Запросы CSS

Нет (весь CSS этапа — у этого пакета).

## Не проверено

- `readGraphTheme` и `subscribeGraphTheme` в настоящем DOM (тесты идут в node; проверит `graph-screen`: в частности,
  что `getComputedStyle(...).color` для oklch / `color-mix()` принимается как `fillStyle` и что байты на canvas 1×1
  совпадают с ожидаемыми, а `selEdge` в «Классике» даёт `null`).
- Вид сцены и подписей в браузере (`px-graph-stage`, `px-graph-label`): нет потребителя до волн 1–2.
- `FilterBar mode="graph"` в браузере (потребитель — `GraphView`, волна 2); режим `'list'` без пропа правился только
  условием показа `sortBlock`.
