# fix-review12-ui

**Задача:** исправления по ревью этапов 1–2 в области «ui» (`src/components/**` кроме icons и ThemeProvider, `src/views/**` кроме AppearanceSection). Одна подтверждённая находка: в пиксельных сценах звезда «в избранном» внутри нажатой (золотой) кнопки сливается с фоном.

**Статус:** готово

## Что исправлено

1. Золотая звезда на золотой кнопке (пиксельные сцены). Значку активной звезды добавлен класс `pixel:text-inherit`
   (рецепт `spec-stage3.md:124`) во всех трёх местах:
   - `ItemDetail.tsx` — кнопка звезды в шапке деталей;
   - `ItemCard.tsx` — `QuickButton` (быстрое действие в строке списка);
   - `TriageMode.tsx` — `ActionButton` («Избранное» в разборе входящих).

   В пиксельной сцене значок теперь наследует цвет текста кнопки: `--gold-ink` из правила
   `.pixel [data-slot="button"][aria-pressed="true"]` (`styles/pixel.css:55`). В «Классике» вариант `pixel:` не действует,
   звезда остаётся золотой. `StarMark` (`ItemCard.tsx`) не тронут: он не внутри кнопки.

   Почему не правило в `pixel.css` (вариант 1 находки): файл вне области «ui». Оба исправления совместимы; если владелец
   `src/styles/pixel.css` добавит общее правило
   `.pixel :is([data-slot="button"], .px-btn, .px-chip):is([aria-pressed="true"], [aria-checked="true"], [data-on="true"]) .px-icon { color: inherit; }`,
   оно дополнительно застрахует будущие `px-btn`/`px-chip`, а класс в компонентах станет избыточным, но не мешающим.

## Проверка

- Каскад проверен сборкой CSS через `@tailwindcss/node` (одноразовый скрипт вне репозитория, `src/index.css` + кандидаты
  `fill-gold`, `text-gold`, `pixel:text-inherit`): генерируется `.pixel\:text-inherit:is(.pixel *) { color: inherit; }`,
  правило идёт после `.text-gold { color: var(--gold); }` и специфичнее его (0,2,0 против 0,1,0).
- `cn('size-4', 'fill-gold text-gold pixel:text-inherit')` оставляет все классы (слияния нет).
- Значок — прямой потомок `Button` во всех трёх местах, цвет кнопки до него доходит.
- Визуально не проверялось (отрисовка в среде недоступна).
- Тест не добавлен: правка только в CSS-классах; тесты проекта идут в среде node без отрисовки компонентов.
- `npm run typecheck`, `npx vitest run src/components` — см. итог в ответе исполнителя.

## Изменённые файлы

- `src/components/items/ItemDetail.tsx`
- `src/components/items/ItemCard.tsx`
- `src/components/items/TriageMode.tsx`

## Повторный запуск (находки 2-4)

- CommandPalette и LinkPicker: в `searchItems` передаётся полный снимок `useItemsWithTrash()`, выдача сужается `{ within }` — индекс не перестраивается. Теста нет: хуки React в среде node не запускаются, контракт `within` покрыт тестами search.
- EmptyState: тип `icon?: IconName | ReactElement`, в рантайме значок рисуется только для имени из `ICON_NAMES`. Тест: `EmptyState.test.ts` (падал без правки).
- select.tsx: `SelectPrimitive.Icon` оборачивает `Icon` (атрибуты состояния Base UI получает span).
- Файлы: CommandPalette.tsx, LinkPicker.tsx, EmptyState.tsx, EmptyState.test.ts, ui/select.tsx.
