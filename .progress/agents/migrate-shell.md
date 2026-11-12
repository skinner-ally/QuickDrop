# migrate-shell

Задача: этап 1, волна 2 — замена значков lucide на `Icon` и размеров шрифта `text-[Npx]` на токены
в `src/components/layout/**`, `capture/**`, `palette/**`, `ui/**` (только значки), `src/views/**`.
Спецификация: `.progress/spec-stage1.md` §4.5–4.7, §7.3; правила — `docs/DESIGN.md`.

Статус: готово
Порт dev-сервера: 5193 (остановлен, вкладка браузера закрыта)

## Результат

- Во всех файлах владения импорт `lucide-react` заменён на `Icon` из `@/components/icons` (§4.7 п. 1–4, 8).
  `strokeWidth={1.75}` и `aria-hidden` убраны как умолчания; в `ui/*` значкам задан `strokeWidth={2}` (п. 2).
- Значок в переменной/пропе → имя: `Sidebar` (`ThemeToggle`: `themeIcon: IconName`; `SectionHeader`: имя по `open`),
  `CommandPalette` (`PaletteAction.icon: IconName`), `AppearanceSection` (`SegmentedOption.icon?: IconName`).
- `EmptyState` в views вызывается с именем: `icon="archive" | "star" | "library" | "search-x" | "inbox"` (п. 6).
- Размер классом `size-5`/`size-6` → добавлен `size={20}` (плавающая кнопка в `MobileNav`) и `size={24}`
  (значок перетаскивания в `AppShell`); классы `size-*` оставлены (п. 3). `size={15}` у `zap` перенесён как есть.
- Размеры шрифта: `text-[11px]` → `text-2xs`, `text-[13px]` → `text-2sm`, `text-[15px]` → `text-md` (п. 10),
  включая `md:text-[13px]` и `<kbd>` в `QuickCapture`, `CommandPalette`, `ShortcutsSection`.
- Логотип в `Sidebar` (встроенный SVG) не тронут (п. 9). `fill-[var(--cat-amber)]` в моих файлах не встречается.
- Окончания строк файлов сохранены (CRLF/LF как были); изменены только строки значков, импортов и размеров шрифта.

## Проверки

- `npm run typecheck` — чисто (после завершения обоих мигрантов).
- `npm test` — 36 файлов, 1179 тестов, все проходят. В моих каталогах тестов нет.
- `grep "lucide-react" src` — только `src/components/icons/registry.ts`.
- `grep -E "text-\[(11|13|15)px\]" src --include=*.tsx` — только `src/components/ui/kbd.tsx`.
- Браузер (dev, 1200×800 и 375×812), по DOM и скриншотам:
  - «Классика» день/ночь: все значки — lucide, `stroke-width` 1.75 (в `ui/*` — 2), `aria-hidden`, размеры 16/14/12 px
    как заданы классами; `text-2sm` = 13px, `text-2xs` = 11px, `text-md` = 15px. Скриншоты: входящие (день),
    настройки (день и ночь), телефон 375 (ночь) — вид обычный.
  - «Осень» день/ночь, «Луг», «Бумага», «Зима»: `svg.lucide` — 0, все значки `px-icon` (кроме логотипа).
    Пиксельные значки внутри `ui/*` подтверждены: шеврон `Select` (через `render`), галочка пункта `Select`,
    галочка чекбокса, галочка radio-пункта выпадающего меню, крестик диалога (разбор входящих), значок toast
    «успех», лупа и галочка палитры команд. `text-2sm` = 14px.
  - Клавиатура: N, Ctrl+Enter (запись сохранена), Ctrl+K, Esc, J/K, Enter, F, E, A, Del — работают.
  - Ошибок в консоли нет.

## Не проверено

- Попиксельная сверка «до/после» в «Классике» не делалась (состояния «до» под рукой нет) — только атрибуты
  DOM и несколько скриншотов.
- Панель браузера была скрыта: скриншоты проходили через раз, анимации закрытия диалогов не доигрывались
  (закрытие подтверждено по `data-closed`). Скриншотов «Луга», «Бумаги», «Зимы» и ночной «Осени» на 1200px нет —
  только счётчики значков по DOM.
- Вращение индикатора загрузки шагами глазами не наблюдалось (правило `.pixel .px-icon.animate-spin` в `pixel.css`
  есть, класс `animate-spin` в `Icon` передаётся).
- Не отрисовывались в проверке: крестик `ui/sheet` (нигде не показывается: единственный `SheetContent` —
  с `showCloseButton={false}`), стрелки прокрутки `Select`, шеврон подменю и галочка checkbox-пункта
  `dropdown-menu`, значки toast info/warning/error/loading, значок перетаскивания в `AppShell`, индикатор в `AiSection`.
- Телефон 375px проверен только в «Классике» (ночь).
- `npm run build` не запускался (по правилам задачи).

## Отступления

- `Loader2` в `QuickCapture` был без `strokeWidth` (у lucide по умолчанию 2) → `strokeWidth={2}`, чтобы «Классика»
  не изменилась (в §4.7 п. 1 этот случай прямо не описан).
- `size={20}` на плавающей кнопке: в пиксельных сценах `snapIconSize(8, 20)` = 16, значок не вырастает
  (сделано буквально по §4.7 п. 3; рост даст `pixelSize={24}` — решать этапу 3).
- Один раз выполнен `git --no-optional-locks diff --stat` по своим каталогам (только чтение) — проверить, что
  правки минимальны. Ничего в git не менялось.

## Побочное

- В базе dev-источника `localhost:5193` (IndexedDB этого порта) созданы две тестовые записи, одна демо-запись
  отправлена в архив, одна удалена; сцена и тема возвращены на «Авто» / «Системная».

## Изменённые файлы

- `src/components/layout/`: `AppShell.tsx`, `MobileNav.tsx`, `Sidebar.tsx`, `TopBar.tsx`
- `src/components/capture/QuickCapture.tsx`
- `src/components/palette/CommandPalette.tsx`
- `src/components/ui/`: `checkbox.tsx`, `command.tsx`, `dialog.tsx`, `dropdown-menu.tsx`, `select.tsx`, `sheet.tsx`, `sonner.tsx`
- `src/views/`: `ArchiveView.tsx`, `FavoritesView.tsx`, `InboxView.tsx`, `ItemsView.tsx`, `LibraryView.tsx`, `SettingsView.tsx`
- `src/views/settings/`: `AboutSection.tsx`, `AiSection.tsx`, `AppearanceSection.tsx`, `CategoriesSection.tsx`,
  `DataSection.tsx`, `LinksSection.tsx`, `Section.tsx`, `ShortcutsSection.tsx`, `TagsSection.tsx`
- `.progress/agents/migrate-shell.md`
