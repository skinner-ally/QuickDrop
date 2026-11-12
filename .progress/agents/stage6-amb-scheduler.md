# stage6-amb-scheduler

Задача: пакет «amb-scheduler» этапа 6 (волна 0) — режимы и тики живого фона, спецификация `.progress/spec-stage6.md` §4.3.
Статус: готово.

## Результат
- `src/lib/ambient/scheduler.ts`: `AmbientConditions`, `AmbientMode`, `ambientMode`, `SchedulerDeps`, `AmbientScheduler`,
  `createAmbientScheduler(deps, periodMs = AMBIENT_TICK_MS)` — сигнатуры точно по §4.3, добавлений нет.
  Поведение по §4.3; сверх него: защита поколением от запоздалого обратного вызова уже снятого таймера
  (если хост-таймер «не успел» сняться, он не ставит `due` и не зовёт `request`); `dt` при нечисловом `now` — 0.
  rAF, setInterval, window/document не используются (проверяется тестом по тексту модуля).
- `src/lib/ambient/scheduler.test.ts` (19 тестов, подставные таймеры — свой список): таблица `ambientMode` на 32
  сочетания (28 off / 3 static / 1 animated), каждое условие остановки отдельно; запуск → один request без таймера;
  consume → один таймер на period; срабатывание → request, armed false; двух срабатываний без consume нет;
  инвариант «ровно одно из due/armed» на цепочке из 50 тиков; setRunning(false) в обоих состояниях → таймеров 0,
  прокрутка не зовёт request; запоздалый колбэк; пауза 10 с без скачка t; dt ≤ 0.25 и ≥ 0; dispose идемпотентен и
  глушит методы; повторный setRunning(true) не шлёт второй request.

## Проверки
- `npm run typecheck` — проходит. `npm test` — 67 файлов, 2012 тестов, все прошли.

## Изменённые файлы
- `src/lib/ambient/scheduler.ts` (новый)
- `src/lib/ambient/scheduler.test.ts` (новый)

## Не проверено
- Браузер не нужен пакету; работа с настоящими `window.setTimeout` и кадром хоста — у `amb-wire`.
