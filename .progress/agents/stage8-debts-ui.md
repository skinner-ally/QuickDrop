# stage8-debts-ui

Задача: пакет «debts-ui» этапа 8 (волна 1), спецификация §5.1.
Статус: готово

## Сделано
- `src/components/items/FilterBar.tsx`: при < 768 px сортировка и вид вынесены из прокручиваемого ряда и закреплены справа
  (`compactSortBlock`): кнопка сортировки — значок, `aria-label` «Сортировка: {текущая}», меню с радиопунктами;
  одна кнопка-переключатель вида (`aria-label` «Вид: список. Переключить на карточки» и наоборот); высота 36 px (`size-9`).
  От 768 px блок `sortBlock` прежний (Select + группа из двух кнопок). Левый вылет ряда сохранён, правый убран.
- `src/pwa.ts`: share_target → `openCapture({ text, source: 'share' })`.
- `src/lib/pixelfx/README.md`, `pixelfx.test.ts`: переформулированы (лицензия в сборке — файлом public/licenses).

## Проверки
typecheck проходит; vitest для pixelfx и components/items проходит; полный npm test: падает 1 тест в чужом пакете (search, resolveQueryFilter).
Визуально не проверялось.
