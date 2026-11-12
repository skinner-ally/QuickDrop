# stage5-graph-chrome

- Задача: пакет «graph-chrome» этапа 5 (волна 1) — `GraphHeader`, `GraphToolbar`, `GraphHint`. Спецификация —
  `.progress/spec-stage5.md` §0 (Р5, Р9, Р15), §1.1, §3.1, §3.2, §4.0, §4.4, §5.
- Статус: готово (без браузера, по §4.0 п. 2)

## Результат

- `GraphHeader({ total, matched, links, filtered })` — заголовок по образцу `ItemsView`: `h1` «Граф»; счётчик
  («подходит N из M» при `filtered`, иначе «M · связей: L»; при `total === 0` счётчика нет), `aria-live="polite"`;
  подсказка клавиш справа (только ПК с мышью в пиксельных сценах, как у списков).
- `GraphToolbar()` — `div[data-graph-ui][role=toolbar]` в левом нижнем углу сцены (на телефоне с учётом
  `env(safe-area-inset-left/bottom)`): «Уменьшить» (выключена на 12,5 %), чип масштаба (`px-chip`, постоянная ширина
  `min-w-14`, «12,5 %» / «100 %» с неразрывным пробелом), «Увеличить» (выключена на 200 %), «Весь граф» (`fitAll`,
  `title="Весь граф (0)"`), «Разложить заново» (`actRelayoutGraph`), «Показывать архив» (`eye`/`eye-off`,
  `aria-pressed`, `setShowArchive`). Кнопки — `ui/button` outline `icon-sm` + `px-btn`, 28 px на ПК, 36 px на
  телефоне и при `pointer-coarse`. Источник состояния — `useGraph`.
- `GraphHint()` — `div[data-graph-ui][role=note]`, `px-pop`, слева сверху; отдельные тексты для мыши
  (`pointer-coarse:hidden`) и касания (`hidden pointer-coarse:block`); «Понятно» → `dismissHint()`; пока
  `hintSeen === false`.
- Проверено: `npm run typecheck` чист; `npm test` — 54 файла / 1737 тестов зелёные.

## Решения на месте

- Подпись переключателя архива — «Показывать архив» (и `aria-label`, и `title`), без видимого текста: по §4.4 кнопка
  значковая; слово «Архив» в интерфейсе не выводится отдельно.
- В классическом стиле нажатое состояние архива — `aria-pressed:bg-muted` (в пиксельных сценах — золото по правилу
  `[data-slot="button"][aria-pressed="true"]` из `pixel.css`).
- У чипа масштаба вместо `aria-label` — `title="Масштаб"` (aria-label на span без роли не читается).

## Изменённые файлы

- `src/components/graph/GraphHeader.tsx`, `GraphToolbar.tsx`, `GraphHint.tsx` (новые)
- `.progress/agents/stage5-graph-chrome.md`

## Запросы CSS

Нет.

## Не проверено

- Вид и поведение в браузере (оба стиля, день/ночь, 1280 и 390 px): раздел «Граф» открывается только после волны 2 —
  сценарии §4.4 проходит `graph-screen`.
- Что панель (≈ 260 px на телефоне) не перекрывается плавающей кнопкой «Добавить» на 390 px — расчёт по размерам, не
  замер.
- Поведение `pointer-coarse:` на настоящем сенсорном устройстве.
- Отсутствие в Tailwind конфликта `max-md:left-[max(...)]` с `left-2` (порядок вариантов) — не собиралось в браузере.
