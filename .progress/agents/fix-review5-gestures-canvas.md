# fix-review5-gestures-canvas

Задача: исправления ревью этапа 5, группа «gestures-canvas» (C1=C10, C2, C6, C7, C8=M1, C9, C12=C16, C15, C18,
C21, C24, M3, M5, M7, M10=M18, M19, подключение M2/M17).
Файлы: src/components/graph/useGraphGestures.ts, useGraphKeys.ts, GraphCanvas.tsx, src/views/GraphView.tsx,
src/components/graph/gestureLogic.ts (+ gestureLogic.test.ts).

Статус: готово (typecheck и npm test — 60 файлов, 1860 тестов — проходят; браузер не запускался).

## Исправлено
- C1=C10: память о клике по ноде (secondClickNode) в pointerdown и dblclick; dblclick — centerOn(нода, 1), затем
  select. Окна < 1100 px, мышь/перо: выбор откладывается на GRAPH_SELECT_DEFER_MS, dblclick/клик по фону/Esc его
  снимают. GraphCanvas передаёт в setViewSize долю keep по сдвигу краёв сцены (resizeKeep): содержимое не двигается
  ни при панели справа, ни при строке фильтров сверху; на размонтировании setViewSize(0, 0).
- C2: перенос ноды только по hitNodeStrict (Press.dragId); клик/наведение/Shift-связь — широкая зона.
- M17/M2: палец — radiusPx GRAPH_TOUCH_HIT_PX в hitNode/hitLink; колесо — wheelSteps(acc, e, wheelT).
- C6: useGraphKeys — graphKeyTarget(selectedId, cursorId, byId); GraphView — курсор следует за выбором извне.
- C7: useSaveLayout(layout, fixed, all) → addPositions(add, cats) с категорией из снимка раскладки.
- C8=M1: revealDecision/RevealMemo с cameraRev; камера идёт за переехавшей нодой.
- C9: pointermove с buttons === 0 сбрасывает нажатие и жест без записи; blur окна — то же; lostpointercapture был.
- C12=C16: ResizeObserver на основном canvas с box 'device-pixel-content-box', запасной путь — round(css·dpr)
  (bitmapSize); window.resize — только на запасном пути.
- C15: растр сбрасывается только при смене W×H; при сбросе кадр рисуется синхронно в колбэке RO; буфер связей
  создаётся лениво (в «Классике» не создаётся); фоновые canvas перемериваются в том же шаге.
- C18: грязный прямоугольник (clearRect32 прошлой buf.dirty + putImageData с dirty-параметрами).
- C21: исключение клавиш сужено до '[data-graph-ui]:not([role="toolbar"])'.
- C24: обход соседей по Tab конечный (tabRingNext): после последнего соседа фокус уходит дальше; Enter по уже
  открытой записи переводит фокус в боковую панель деталей.
- M3: useCategoryList; раскладка не считается и не пишется до загрузки категорий.
- M5: порог жеста для пальца 10 px (movePx). M7: лишний invalidate над панелью убран.
- M10=M18(1): текст пустого состояния «Архив на графе скрыт. Покажите его, чтобы увидеть записи.»
- M19 (минимум): панель графа и подсказка вынесены из role="application" в слой поверх сцены (inset по рамке).

## Не сделано
- C3 (GraphLabels.tsx), C20 (Sidebar.tsx), M18 (2)–(4), M19 перенос ноды/выбор связи с клавиатуры — см. отчёт.
