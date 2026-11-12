# stage6-amb-wire

Задача: пакет «amb-wire» этапа 6 (волна 2, spec-stage6 §6) — поверхности canvas, контроллер режимов, хук
useAmbient, подключение в GraphCanvas/GraphView, проверка в браузере (сценарии §5.1–5.3, §6.7, критерии §6.6).

Статус: готово (с одним открытым вопросом: уведомление MIT не попадает в собранный чанк — см. ниже)

## Результат
- `surface.ts`: `createCanvasSurface` — canvas + putImageData, release = размер 0.
- `controller.ts`: `createAmbientController` (боевые планировщик на window.setTimeout + requestAmbientFrame и движок с
  createCanvasSurface/buildSceneArt/effectsFor). off → setAmbientLayer(null) (только свой слой), engine.dispose,
  scheduler.dispose, всё выброшено; static/animated → configure + setAmbientLayer + requestAmbientFrame (только при
  изменении сцены/режима). `dispose` = off, контроллер остаётся годным (StrictMode).
- `controller.test.ts` (18 тестов, подставные движок и планировщик).
- `useAmbient.ts`: сцена/настройка/пиксель из useScene, reduced-motion — useMediaQuery, видимость — useSyncExternalStore
  на visibilitychange; data-ambient-mode; dispose при размонтировании.
- `GraphCanvas.tsx`: graphDirty; invalidate (граф + фон) и invalidateAmbient (только кадр); subscribeAmbient по причине;
  ResizeObserver ставит graphDirty перед прямым frame(); drawMs — только граф и только когда рисовался; ambientMs,
  ambientTiles/Ticks/Rendered; sceneRev (смена sceneRef по ссылке), points = sc.nodes; атрибуты снимаются при снятии
  слоя и размонтировании. Шапка обновлена, разметка canvas прежняя.
- `GraphView.tsx`: импорт + `useAmbient(loaded ? stageEl : null)`.

## Проверки
- typecheck чист; vitest 75 файлов / 2229 тестов.
- Сборка (`npx vite build --outDir <scratchpad>`, dist проекта не трогал): проходит, GraphView — отдельный чанк 99 КБ,
  код pixelfx в нём есть (строка '#2c2132'), НО строк «Copyright (c) 2026 Patch» и «Permission is hereby granted»
  в сборке нет ни в одном чанке — /*! комментарии срезаются. vite.config.ts не правил — решает основная сессия.
- Браузер (порт 5189, 1280×800 dpr 1, своя база): см. отчёт в StructuredOutput; С1–С16 пройдены, кроме оговорок.

## Изменённые файлы
src/lib/ambient/surface.ts, src/lib/ambient/controller.ts, src/lib/ambient/controller.test.ts,
src/components/graph/useAmbient.ts, src/components/graph/GraphCanvas.tsx, src/views/GraphView.tsx

## Не проверено
- dpr 1.25/1.5/2 вживую, prefers-reduced-motion вживую, окно Tauri/WebView2.
- Растворение плиток (≈250 мс) глазами не видно в снимках — проверено только, что после броска перерисованы 6 плиток.
- 390 px: под эмуляцией панели canvas получает размер 1× при dpr 2 (поведение этапа 5, не фона) — граф и фон
  совпадают, прокрутки нет; на настоящем телефоне не проверено.
