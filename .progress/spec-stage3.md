# Спецификация этапа 3 — оболочка и все существующие экраны в новом стиле

Источники: `.progress/plan-combined.md` (этап 3), `docs/DESIGN.md`, `.progress/spec-stage1.md`, `mockup/`.
Цель: все разделы и сценарии работают и выглядят верно в четырёх пиксельных сценах (день/ночь) и в «Классике»;
поведение, клавиши, `data-*`/`aria-*` не меняются.

Предусловие: этап 1 принят целиком (`theme-core`, `icons`, `icons-migrate`). Поэтому «сейчас» ниже — это нынешние
классы с уже выполненными механическими заменами этапа 1: lucide → `<Icon name>`, `text-[11|13|15px]` →
`text-2xs|2sm|md`, `fill-[var(--cat-amber)] text-[var(--cat-amber)]` → `fill-gold text-gold`.

Обозначения: «К» — «Классика», «П» — пиксельные сцены. Запись `+ …` — классы, которые ДОБАВЛЯЮТСЯ к нынешней строке
классов (нынешние не удаляются, если не сказано «убрать»). Ссылки `m:` — селектор в `mockup/style.css` / функция в `mockup/app.js`.

## 0. Порядок работ

| Шаг | Исполнитель | Что |
|---|---|---|
| P0 | основная сессия (до распараллеливания) | §5: `Icon.pixelSize`, `TypeIcon` (size/pixelSize), `items/categoryColor.ts`, заплатка `src/styles/pixel.css`, дополнение `docs/DESIGN.md` |
| P1–P8 | 8 исполнителей параллельно | §4, файлы не пересекаются |
| P9 | основная сессия | сквозная приёмка (§4.9), коммит этапа |

Этап 2 (`data-contracts`, шаг 0) правит одну строку в `ItemDetail.tsx` (`SOURCE_LABEL.extension`) и расширяет `View`
в `store/ui.ts` до `… | 'graph' | 'trash' | …`. Шаг 0 этапа 2 должен быть влит ДО запуска P1–P8 (иначе конфликт в
`ItemDetail.tsx`). Этап 3 `store/ui.ts`, `hooks/*`, `lib/*`, `db/*`, `search/*`, `types.ts` не трогает.

(уточнено при сверке) Остальные исполнители этапа 2 (волны 1–2 и `tauri-backup`) правят только `src/db/*`,
`src/search/*`, `src/hooks/*`, `src/lib/*`, `src/store/graph.ts`, `src-tauri/**` — с пакетами P1–P8 не пересекаются и
могут идти одновременно с этапом 3. Точки интеграции этапа 2 в `src/main.tsx` и `vite.config.ts` вносит основная
сессия (оба файла на этапе 3 ничьи). Имена типов сцены для действий палитры (§2.6) — `ScenePref` и список
`SCENE_PREFS` из `@/types` (или `@/lib/scene`).

## 1. Каркас

### 1.1 Решения

1. **Рама окна — на корне `AppShell`**, панели — прямые потомки, как сейчас. DOM-структура (aside · колонка · aside
   деталей · модальный лист) не меняется: на ней держатся `useInert`, возврат фокуса в `DetailPane`, `[data-detail-sheet]`.
2. **Панель деталей — четвёртая панель рамы справа** (на ПК ≥ 1100px), а не плавающая поверх сцены, как `m: .detail`.
   Причина: в мокапе она плавает над графом; для списков мокап всё равно сдвигает список (`m: .stage.has-detail #list`).
   Ширина остаётся 460px (в мокапе 308px — мало для редактора, карточки ссылки и превью файла). Граф этапа 5 использует
   ту же панель.
3. **Прокрутка — во внутреннем блоке**, а не в самой панели (`px-panel` рисует раму внутренней тенью; прокручиваемое
   содержимое наезжало бы на неё). Для `<main>` это меняет разметку в обоих стилях (вид «Классики» тот же).
4. **Отступы безопасной зоны в П** задаются на корне (`6px + env(...)`), т.к. `px-panel` перекрывает `padding` утилит.
5. **«Классика»** — все нынешние классы остаются; `px-*` и `pixel:*` в ней не действуют. Ни один базовый класс не
   удаляется ради П (кроме случаев, прямо названных ниже).

### 1.2 `AppShell.tsx` — разметка (итог)

```tsx
<div className="flex h-dvh w-full overflow-hidden bg-background pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] text-foreground
  pixel:gap-1.5 pixel:bg-wood-dark
  pixel:pt-[calc(6px+env(safe-area-inset-top))] pixel:pr-[calc(6px+env(safe-area-inset-right))]
  pixel:pb-[calc(6px+env(safe-area-inset-bottom))] pixel:pl-[calc(6px+env(safe-area-inset-left))]">

  {desktop && <aside ref={sideRef} className="w-[232px] shrink-0 border-r border-sidebar-border bg-sidebar px-panel pixel:w-[236px]"><Sidebar /></aside>}

  <div ref={columnRef} className="flex min-w-0 flex-1 flex-col pixel:gap-1.5">
    <TopBar mobile={!desktop} />
    <main className="flex min-h-0 flex-1 flex-col px-panel pixel:[--px-pad:8px]">
      <div data-scroll-root className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]
        max-md:pb-[calc(env(safe-area-inset-bottom)+5rem)] pixel:pb-0 pixel:max-md:pb-20">
        <ErrorBoundary key={view} …><ActiveView view={view} /></ErrorBoundary>
      </div>
    </main>
  </div>

  {sideDetail && detail && (
    <aside aria-label="Подробности записи" className="h-full w-[460px] shrink-0 overflow-y-auto border-l bg-background
      px-panel pixel:overflow-hidden pixel:[--px-pad:8px]">{detail}</aside>)}

  {!desktop && <MobileNav />}

  {modalDetail && detail && (<>
    {desktop && <div aria-hidden className="fixed inset-0 z-40 bg-black/20 px-scrim" onClick={() => select(null)} />}
    <div role="dialog" aria-modal="true" aria-label="Подробности записи" data-detail-sheet
      className="fixed inset-0 z-40 overflow-y-auto bg-background pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)]
        pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:left-auto md:w-[min(460px,100%)] md:border-l md:shadow-xl
        px-panel px-sheet pixel:overflow-hidden pixel:[--px-pad:8px] pixel:md:inset-y-1.5 pixel:md:right-1.5">{detail}</div>
  </>)}
  …QuickCapture, CommandPalette, оверлей перетаскивания…
</div>
```

| Узел | К (как сейчас) | П | Образец |
|---|---|---|---|
| корень | фон `--background`, без зазоров | фон `--wood-dark`, зазоры и поля 6px (+ безопасная зона) | `m: .app`, `body` |
| боковая панель | 232px, `border-r`, фон `--sidebar` | `px-panel`, 236px, отступ 14px | `m: .side.panel` |
| верхняя панель | 48px, `border-b` | `px-panel`, отступ 10×12px, высота по содержимому | `m: .top.panel` |
| сцена (`main`) | без рамки; прокрутка теперь во внутреннем `div[data-scroll-root]` | `px-panel`, отступ 8px; прокрутка внутри | `m: .stage.panel`, `#list` |
| детали, ПК ≥ 1100px | `aside` 460px, `border-l` | `px-panel`, отступ 8px, прокрутка внутри `DetailBody` | `m: .detail.panel` |
| детали, 768–1099px | модальный лист справа + затемнение `bg-black/20` | `px-panel` у правого края с зазором 6px; затемнение `px-scrim`; жёсткой тени нет (её срезал бы `clip-path`) | — |
| детали, < 768px | лист на весь экран | `px-panel px-sheet`: без среза углов, отступ `8px + env(...)` | `m: @media (max-width:767px) .detail` |

Точки, которые нельзя трогать: `useHashSync`, `viewFromHash`, `DetailPane`, `useInert([sideRef, columnRef], modalDetail)`,
порог `(min-width: 1100px)`, атрибуты `data-detail-sheet`, `role="dialog"`, `aria-modal`, ленивые чанки и их границы ошибок.

Оверлей перетаскивания файлов: внешний `div` `+ px-scrim`; рамка `+ px-pop pixel:text-foreground` (в П — сплошная рама
всплывающей поверхности вместо пунктира brand: brand не цвет текста на бумаге); значок `<Icon name="upload" size={24} pixelSize={32} />`.

`ViewErrorFallback`: без изменений (кнопки `ui/button` стилизуются сами); `+ pixel:p-2.5` на корневой `div`.

### 1.3 Места для этапов 4–5 (оставить, не реализовывать)

| Где | Что оставить |
|---|---|
| `Sidebar.tsx` | Пункты навигации — из массива `NAV_ITEMS` (§2.1). Порядок: Входящие · База знаний · Избранное · Архив · **[Граф — этап 5, клавиша 5]** · **[Корзина — этап 4, последним, без цифры]**. В коде — два комментария-заглушки на этих местах. Порядок первых четырёх совпадает с клавишами 1–4 (`useHotkeys.VIEW_BY_DIGIT`), поэтому «Граф» идёт пятым, а не как в мокапе вторым блоком |
| `Sidebar.tsx`, раздел «Категории» | Он же — легенда графа на этапе 5 (квадрат `px-sw` + имя + счётчик). Этап 5 изменит только `toggleCategory` при `view === 'graph'` |
| `AppShell.tsx` | `VIEWS` и `ActiveView` — без `graph`/`trash` (после шага 0 этапа 2 `switch` неисчерпывающий — это нормально) |
| `TopBar.tsx` | Пустой контейнер справа `<div data-topbar-slot className="ml-auto flex shrink-0 items-center gap-1 empty:hidden" />` — сюда этап 5 выведет масштаб, «Разложить», «Весь граф» (порталом) |
| `CommandPalette.tsx` | В списке `actions` после `go-archive` — комментарий-заглушка для «Перейти: Граф» и «Перейти: Корзина» |
| `ItemsView.tsx` | `variant` и `title` остаются пропсами: раздел «Корзина» этапа 4 будет ещё одним `ItemsView` |

## 2. Компоненты

Общие рецепты (используются во многих местах, писать дословно):

- **Заголовок раздела** (`h1`): `font-heading text-lg font-semibold tracking-tight pixel:text-2xl pixel:tracking-normal`.
- **Подзаголовок блока** (`h2`/`h3` внутри панели: «Теги», «Связанные записи», заголовок секции настроек):
  нынешние классы `+ pixel:text-2sm pixel:font-semibold`; класс `font-heading` у них УБРАТЬ (в К он ничего не давал,
  в П дал бы Tiny5 на некратном размере).
- **Квадратная кнопка-значок в П** (`m: .btn.sq`): к `Button variant="ghost" size="icon-xs|icon-sm|icon"` `+ px-btn pixel:size-7.5`
  (30px; на телефоне `pixel:max-md:size-9`). Включённое состояние — `aria-pressed` (золото даёт `pixel.css`).
- **Значок внутри включённой (золотой) кнопки**: `fill-gold text-gold` `+ pixel:text-inherit` — иначе золотой значок на золотом фоне.
- **Вставка** (`m: .detail .content`): `rounded-lg border border-border bg-muted/50` (или `bg-card`) `+ px-well`.
- **Список с разделителями** (`divide-y rounded-lg border`): `+ px-well pixel:divide-y-2`.
- **Скелет загрузки**: `animate-pulse … bg-muted` `+ pixel:animate-none pixel:bg-paper-line`.
- **Мелкий элемент с текстом и фиксированной высотой < 24px** (`h-5`): `+ pixel:h-auto pixel:min-h-6`.

### 2.1 Оболочка (пакет `shell`)

**`Sidebar.tsx`** — образец `m: .side`, `.logo`, `nav a`, `.cat`, `.count`, `.sw`, `.chips`, `.side-foot`.

| Узел | Сейчас | П |
|---|---|---|
| корень | `flex h-full min-h-0 flex-col bg-sidebar pt-[env(safe-area-inset-top)]` | `+ pixel:gap-2.5 pixel:bg-transparent pixel:pt-0` |
| логотип | brand-квадрат `rounded-md` со встроенным SVG + `text-md font-semibold` | строка `+ pixel:p-0`; квадрат с SVG `+ pixel:hidden`; рядом `<Icon name="sprout" pixelSize={20} className="hidden pixel:block" />`; текст `+ font-heading pixel:text-2xl pixel:tracking-normal` |
| «Добавить» | `Button h-9 w-full justify-between bg-brand …` + `Kbd tone="inherit"` | обёртка `+ pixel:p-0`; кнопка `+ pixel:h-9.5 pixel:justify-center pixel:gap-1.5` (`m: .btn.brand.big`) |
| `nav` | `min-h-0 flex-1 overflow-y-auto px-2 pb-2` | `+ pixel:px-0 pixel:pb-0` |
| `NavButton` | `h-8 rounded-md px-2 text-2sm hover:bg-sidebar-accent focus-visible:ring-2 …`, активный `bg-sidebar-accent font-medium` | `+ px-nav pixel:h-7 pixel:px-1.5 pixel:max-md:h-9.5`; `aria-current="page"` уже есть — его и ловит `px-nav` |
| счётчик входящих | `rounded-full bg-brand px-1.5 font-medium text-brand-foreground text-xs` | `+ px-count` |
| `SectionHeader` | `mt-3 … pr-1 pl-2`, кнопка `text-xs font-medium text-muted-foreground` | `+ pixel:mt-1.5 pixel:px-0`; кнопка — рецепт «подзаголовок блока» |
| точка категории | `CategoryDot className="size-2.5"` | квадрат — делает `CategoryDot` (пакет `primitives`) |
| «Без категории» | `span.size-2.5.rounded-full.border.border-muted-foreground/50` | `+ px-sw pixel:bg-(--cat-none)` |
| `NewCategory` (`input`) | `h-7 rounded-md border border-input bg-background …ring…` | `+ px-field pixel:h-7.5` |
| теги | строки `NavButton` со значком `#` и счётчиком | `const pixel = usePixel()` (из `@/components/icons`): в П — `div.flex.flex-wrap.gap-1` с кнопками `<button type="button" aria-pressed={active} title={`Записей: ${count}`} className="px-chip inline-flex min-h-6 items-center px-1.5 text-xs max-md:min-h-9 max-md:px-2">#{tag}</button>` (`m: #tags .chip`); в К — как сейчас. `toggleTag`, `TOP_TAGS`, «Показать все» — общие |
| подвал | `border-t … px-2 py-2 pb-[max(.5rem,env(...))]` | `+ pixel:gap-1.5 pixel:border-t-0 pixel:p-0` |
| `ThemeToggle` | `Button ghost icon-sm` | рецепт «квадратная кнопка» |

`NAV_ITEMS` (новая константа в файле; поведение прежнее):

```ts
const NAV_ITEMS: Array<{ view: View; label: string; icon: IconName; count: 'inbox' | 'library' | 'favorites' | 'archive' }> = [
  { view: 'inbox', label: 'Входящие', icon: 'inbox', count: 'inbox' },
  { view: 'library', label: 'База знаний', icon: 'library', count: 'library' },
  { view: 'favorites', label: 'Избранное', icon: 'star', count: 'favorites' },
  { view: 'archive', label: 'Архив', icon: 'archive', count: 'archive' },
  // этап 5: { view: 'graph', label: 'Граф', icon: 'graph' }
  // этап 4: { view: 'trash', label: 'Корзина', icon: 'trash' }
]
```
Активность: `item.view === 'library' ? plainLibrary : view === item.view`; `accent` — только у `inbox` при `counts.inbox > 0`.

**`TopBar.tsx`** — образец `m: .top`, `.search`, `#pal-btn`, `#menu-btn`.

| Узел | Сейчас | П |
|---|---|---|
| `header` | `box-content flex h-12 … border-b bg-background px-3 pt-[env(...)]` | `+ px-panel pixel:box-border pixel:h-auto pixel:gap-2.5 pixel:[--px-pad:10px_12px] pixel:max-md:[--px-pad:8px]` |
| кнопка меню (телефон) | `Button ghost icon` | `+ px-btn pixel:size-9` |
| обёртка поиска | `relative min-w-0 flex-1` | `+ pixel:md:max-w-[420px]` |
| `input[data-search-input]` | `h-8 rounded-lg border border-input bg-surface pr-16 pl-8 … focus-visible:ring-3` | `+ px-field pixel:h-7.5 pixel:max-md:h-9` |
| `Kbd` «Ctrl K» в поле | виден на ПК | `+ pixel:hidden` |
| новая кнопка «Команды» | нет | после поиска: `<Button variant="outline" size="sm" className="hidden pixel:h-7.5 pixel:min-[1000px]:inline-flex" onClick={() => setPaletteOpen(true)}>Команды<Kbd className="max-[1240px]:hidden">{modKey()} K</Kbd></Button>` |
| слот | нет | `div[data-topbar-slot]` (§1.3), в обоих стилях |

`onChange`, обработка `Escape`, `data-search-input`, `type="search"`, `aria-label` — без изменений.

**`MobileNav.tsx`** — образец `m: @media (max-width:767px) .side`, `#fab`.

- `SheetContent`: `+ pixel:w-[min(290px,86vw)]`; `<Sidebar />` обернуть:
  `<div className="h-full min-h-0 px-panel px-sheet pixel:[--px-sheet-pad:14px]"><Sidebar /></div>`.
  Раму даёт вложенная панель; кромку самого листа убирает правило из §5.3.
- Плавающая кнопка: `+ px-fab pixel:size-14 pixel:p-0`; значок `<Icon name="plus" size={20} pixelSize={24} />`;
  подпись — `<span className="pixel:sr-only">Добавить</span>`. Условие `hideFab` — без изменений.

**`ErrorBoundary.tsx`** (в мокапе нет). `usePixel`/`Icon` работают вне `ThemeProvider`; классы сцены стоят на `<html>` из `theme-init.js`.

- `StorageErrorFallback`: корень `+ pixel:bg-wood-dark`; внутренний блок `+ px-panel pixel:max-w-md`; `h1` — рецепт
  заголовка раздела (без `pixel:text-2xl`: оставить `text-lg`, текст длинный); кнопка `+ px-btn`.
- `RetryFallback`: кнопка `+ px-btn`; корень `+ pixel:p-2.5`.
- Класс `ErrorBoundary` и `lazyRetry` не трогать.

### 2.2 Список (пакет `list`)

**`ItemCard.tsx` → `ItemRow`** — образец `m: .rowi`, `.rflag`, `.rbody`, `.rmeta`, `.racts`, `rowHtml()`.

К — как сейчас: скруглённая строка, наведение `bg-muted/60`, открытая `bg-muted`, отмеченная `bg-brand-soft/60`,
курсор — `bg-accent` + brand-полоска слева (`before:`), справа время ⇄ быстрые действия, меню «…».

П — «карточка»: рамка 2px `--wood-dark`, фон `--paper-2`; слева флажок избранного, справа флажок статуса; сверху
полоса категории 4px; цветной значок типа 30px; заголовок, сниппет, под ними теги; справа категория над временем;
при наведении/фокусе вместо них — квадратные кнопки действий; курсор — золотая обводка.

Разметка (одна на оба стиля; обёртка тела в К — `display: contents`, раскладка не меняется):

```tsx
const cat = useListCategory(item.categoryId)            // §5.2
<div role="listitem" aria-current={open ? 'true' : undefined} data-cursor={cursor ? 'true' : undefined}
     data-checked={checked ? 'true' : undefined}
     data-item-id={item.id} tabIndex={tabbable ? 0 : -1} onClick={…}
     className={cn(rowBase, 'flex items-start gap-3 rounded-lg px-3 py-2 hover:bg-muted/60',
       'px-row pixel:items-stretch pixel:gap-0 pixel:p-0', …состояния open/checked/cursor — как сейчас…)}>
  {/* data-checked — новый атрибут: состояние «отмечена» для px-row */}
  <span className="hidden w-2.5 shrink-0 px-flag px-flag-l pixel:block" data-flag={item.favorite === 1 ? 'fav' : undefined}
        {...(item.favorite === 1 ? { role: 'img', 'aria-label': 'В избранном' } : { 'aria-hidden': true })} />
  <div className="contents px-catbar pixel:flex pixel:min-w-0 pixel:flex-1 pixel:items-start pixel:gap-2.5 pixel:px-2.5 pixel:pt-3 pixel:pb-2"
       style={catBarStyle(cat?.color)}>
    {/* прежние дети: LeadCell · текстовый блок · миниатюры · ячейка «время ⇄ действия» · меню */}
  </div>
  <span aria-hidden className="hidden w-2.5 shrink-0 px-flag px-flag-r pixel:block" data-flag={item.status} />
</div>
```

| Узел | Сейчас | П |
|---|---|---|
| `rowBase` | `… scroll-mt-9 scroll-mb-2 … focus-visible:ring-2 focus-visible:ring-ring/60` | `+ pixel:scroll-mb-3`. Курсор (`data-cursor`) и фокус рисует `px-row`/общий фокус; brand-полоска `before:` гасится `px-row` |
| `LeadCell` (строка) | `size-5`, значок типа 16px ⇄ чекбокс | `+ pixel:size-7.5`; `<TypeIcon type pixelSize={30} …>`; логика показа чекбокса — без изменений |
| заголовок | `truncate text-sm font-medium` | `+ pixel:font-semibold` |
| текстовый блок | `flex … flex-col gap-1 md:flex-row md:items-center md:gap-3` | `+ pixel:md:flex-col pixel:md:items-stretch pixel:md:gap-1` (теги уходят под сниппет) |
| блок меток | `flex … flex-wrap gap-1.5 md:shrink-0 md:flex-nowrap` | `+ pixel:gap-1 pixel:md:flex-wrap`; `CategoryBadge` здесь `+ className="pixel:md:hidden"` |
| `StarMark` | золотая звезда 13px | `+ pixel:hidden` (в П избранное — левый флажок) |
| миниатюры | `size-10 rounded-md border border-border` | `+ pixel:border-2 pixel:border-wood-dark` |
| ячейка справа | `hidden shrink-0 items-center md:flex` | `+ pixel:self-center` |
| слой «время» | `flex items-center gap-2 …` | `+ pixel:flex-col pixel:items-end pixel:gap-0.5`; первым ребёнком — `<CategoryBadge categoryId={item.categoryId} className="hidden pixel:inline-flex" />` |
| слой «действия» | `QuickButton` = `Button ghost icon-xs` + `Tooltip` | контейнер `+ pixel:gap-1`; кнопка — рецепт «квадратная кнопка»; активная звезда — рецепт «значок во включённой кнопке» |
| меню «…» | `ItemMenu` в `div.shrink-0` | обёртка `+ pixel:self-center` |

Набор и порядок быстрых действий, подписи, `stopPropagation`, `memo`/`propsEqual` — без изменений.
Выбор категории прямо в строке по `E` (`m: .rpick`) НЕ переносится: это новое поведение (см. openQuestions).

**`ItemCard.tsx` → `ItemCard` (сетка)** — в мокапе нет; рисуется как `px-row` без боковых флажков.

| Узел | Сейчас | П |
|---|---|---|
| корень | `flex flex-col overflow-hidden rounded-lg border border-border bg-card hover:border-foreground/20` + состояния | `+ px-row`; добавить `data-checked` как у строки |
| полоса категории | нет | первым ребёнком `<span aria-hidden className="hidden h-1 shrink-0 pixel:block" style={{ background: catColorVar(cat?.color) }} />` (элементом, а не `px-catbar`: тень закрыло бы превью) |
| `CardPreview` | `border-b border-border`, `h-32` | `+ pixel:border-b-2` на трёх блоках с `border-b` |
| подпись, метки | как в строке | заголовок `+ pixel:font-semibold`; `StarMark` остаётся видимым (флажков у карточки нет) |
| угловые накладки (`LeadCell`, действия) | `rounded-md bg-card/90 shadow-xs ring-1 ring-border` | `+ pixel:border-2 pixel:border-wood-dark pixel:bg-paper`; кнопки внутри — без `px-btn` (плотная группа) |

`StarMark` получает проп `className?: string`: в `ItemRow` оба вызова — `className="pixel:hidden"`, в `ItemCard` — без него.

**`ItemList.tsx`**

- Контейнер списка: `flex flex-col gap-px` `+ pixel:gap-2`; сетка `grid gap-3 …` `+ pixel:gap-2.5`.
- Заголовок группы дат: `sticky top-0 z-10 bg-background px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground`
  `+ pixel:px-0.5 pixel:text-2sm pixel:font-semibold` (`m: .side h4`).
- Весь код клавиатуры, курсора, выбора, дозагрузки, `OPEN_OVERLAY`, `gridCols()` — НЕ трогать. `gridCols()` считает
  колонки по `offsetTop` элементов `[data-item-id]` — атрибут обязан остаться на корне строки/карточки.

**`EmptyState.tsx`** — образец `m: .empty`.

- Кружок `size-10 rounded-full bg-muted` `+ pixel:size-auto pixel:bg-transparent`; значок-строка:
  `<Icon name={icon} size={20} pixelSize={48} />`.
- `h2`: `text-sm font-medium` `+ pixel:text-md pixel:font-semibold`; корень `+ pixel:gap-2`.

**`BulkBar.tsx`** — в мокапе нет; всплывающая поверхность.

- Плашка: `rounded-xl border border-border bg-popover p-1.5 shadow-md` `+ px-pop pixel:gap-1.5 pixel:p-1.5`.
- Разделители `h-5 w-px bg-border` `+ pixel:w-0.5`. Кнопки `Button ghost sm` — без изменений.
- Обёртка `sticky bottom-3` `+ pixel:bottom-4` (рама `px-pop` выступает на 8px).

**`ItemMenu.tsx`** — меню стилизует `pixel.css`. Правки: триггер в варианте `card` `+ pixel:size-7.5`;
`itemActionList`, `ItemAction` — без изменений (после этапа 1 `icon: IconName`).

### 2.3 Разделы и фильтры (пакет `views-filter`)

**`ItemsView.tsx`, `InboxView.tsx`** — образец `m: #list`, `.lhead`.

| Узел | Сейчас | П |
|---|---|---|
| `section` | `gap-3 px-4 pt-4 pb-[calc(6rem+…)] md:px-6` | `+ pixel:gap-2.5 pixel:px-2.5 pixel:pt-2.5 pixel:md:px-2.5` (≥ 4px нужно под золотую обводку курсора) |
| `h1` | `text-lg font-semibold tracking-tight` | рецепт заголовка раздела |
| строка заголовка | `flex items-baseline gap-2` | добавить подсказку клавиш: `<span className="ml-auto hidden min-w-0 truncate text-2sm text-muted-foreground pixel:lg:pointer-fine:inline">…</span>` (`m: .lhead .hint`). Тексты: inbox — «J/K — выбор · E — в базу знаний · F — избранное · A — архив»; library, favorites — «J/K — выбор · Enter — открыть · F — избранное · A — архив»; archive — «J/K — выбор · Enter — открыть · E — вернуть · Del — удалить» |
| счётчик входящих (`InboxView`) | `rounded-full bg-brand-soft px-2 py-px text-xs font-medium text-brand` | `+ px-count` |
| `QuickAdd` | `Input h-9 pl-8`, кнопка `outline icon-lg` | без изменений (стилизуется само); значок `zap` |
| `kbd` в пустом состоянии | `rounded border border-border px-1` | без изменений (`.pixel kbd`) |

`LibraryView`, `FavoritesView`, `ArchiveView` — только проверить вид пустых состояний; правок, скорее всего, нет.

**`FilterBar.tsx`** — в мокапе только `m: #types` (квадратные кнопки типов, включённая — золото) и `.chip`.

| Узел | Сейчас | П |
|---|---|---|
| полоса | `no-scrollbar -mx-4 flex … gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0` | `+ pixel:-mx-2.5 pixel:-my-1 pixel:px-2.5 pixel:py-1 pixel:md:mx-0 pixel:md:px-0.5` (запас под обводку фокуса: прокручиваемый блок её обрезает) |
| `TypeChips` | `h-7 rounded-lg border px-2 text-2sm`, вкл. `border-foreground/30 bg-muted` | `+ px-chip pixel:px-1.5`; `aria-pressed` уже есть → золото |
| разделитель | `h-4 w-px bg-border` | `+ pixel:w-0.5` |
| `FilterButton` | `Button outline sm`, активный `border-foreground/30 bg-muted` | `+ px-btn` и `data-on={active ? 'true' : undefined}` (кнопка — триггер меню, `aria-pressed` ей не подходит) |
| «Без тегов и категории» | `h-7 rounded-lg border px-2.5 text-2sm`, `aria-pressed` | `+ px-chip` |
| сортировка (`Select`) | `SelectTrigger size="sm" className="text-2sm"` | без изменений |
| вид списка | рамка `rounded-lg border p-0.5`, кнопки `size-6 rounded-md`, `aria-pressed` | рамка `+ pixel:gap-1 pixel:border-0 pixel:p-0`; кнопки `+ px-btn pixel:size-7.5` (`m: .seg .btn.sq.on`) |
| `ActiveChip` | `h-6 rounded-md bg-muted pr-0.5 pl-2 text-xs` | `+ px-chip` |
| строка тега в поповере | `rounded-md px-1.5 py-1 text-2sm hover:bg-muted` | `+ px-nav` |
| поле «Найти тег» | `Input h-7 text-2sm` | без изменений |

Состояние фильтров, `PERIODS`, `currentPeriod`, пункты меню — без изменений (отбор по датам — этап 4).

### 2.4 Разбор входящих (пакет `triage`) — `TriageMode.tsx`, в мокапе нет

Полноэкранный диалог остаётся плоским листом бумаги (без `px-panel`: ступенчатые углы на весь экран открыли бы фон
диалога). Рама диалога из `pixel.css` уходит за край экрана — это допустимо.

| Узел | Сейчас | П |
|---|---|---|
| шапка | `border-b border-border px-4 py-2.5 pr-12 text-2sm` | `+ pixel:border-b-2` |
| полоса прогресса | `h-1 rounded-full bg-muted` + `bg-brand transition-[width] duration-150` | дорожка `+ pixel:h-2 pixel:bg-paper-line`; заполнение `+ pixel:transition-none` |
| `TitleField` (локальный) | `Input h-10 border-transparent bg-transparent … text-lg font-medium` | без изменений (`border-transparent` исключает кожу поля); `+ pixel:font-semibold` |
| `ItemBody` | картинка ссылки `rounded-lg border border-border`; текст `text-md` | картинка `+ pixel:border-2`; остальное без изменений |
| блок организации | `border-t border-border px-2 pt-5` | `+ pixel:border-t-2` |
| `AiSuggest` (локальный) | кнопка-заголовок `h-6 rounded-md bg-muted px-2 text-2sm` | `+ px-chip pixel:h-auto pixel:min-h-6` |
| нижняя панель | `border-t border-border bg-surface px-4 pt-3 …` | `+ pixel:border-t-2` |
| `ActionButton` | `Button lg h-10`, главная `bg-brand`, «Удалить» `destructive`, «Избранное» `aria-pressed` | без изменений; значок активной звезды — рецепт «значок во включённой кнопке» |
| локальный `Kbd` | `rounded border border-current/25 px-1 text-2xs opacity-70` | без изменений (`.pixel kbd`) |
| экран «Всё разобрано» | кружок `size-12 rounded-full bg-muted`, `h2 text-lg font-medium` | кружок `+ pixel:size-auto pixel:bg-transparent`; значок `<Icon name="circle-check" size={24} pixelSize={48} strokeWidth={1.5} />`; `h2` — рецепт заголовка раздела |

Очередь, `decide`, `step`, обработчик клавиш, `isTyping`, `initialFocus` — НЕ трогать.

### 2.5 Панель деталей (пакет `detail`)

Образец `m: .detail`, `renderDetail()`. Состав панели приложения богаче мокапа и сохраняется: панель инструментов в
шапке (а не кнопки `m: .acts` внизу), редактирование на месте, карточка ссылки, связи, ИИ.

**`ItemDetail.tsx`**

| Узел | Сейчас | П |
|---|---|---|
| `DetailBody` корень | `@container flex h-full min-h-0 flex-col bg-background` | без изменений |
| шапка | `sticky top-0 z-10 … gap-1 border-b border-border bg-background px-2 py-1.5` | `+ pixel:gap-1.5 pixel:border-b-2 pixel:px-0.5 pixel:pb-2 pixel:pt-0.5` |
| «Назад», «Закрыть», звезда | `Button ghost icon-sm` | рецепт «квадратная кнопка»; звезда — `aria-pressed` уже есть, значок — рецепт «значок во включённой кнопке» |
| `TypeSwitch` (триггер) | `h-7 rounded-md px-1.5 text-sm hover:bg-muted …ring…` | `+ px-btn px-btn-ghost pixel:h-7.5`; несменяемый тип — без изменений |
| метка статуса | `h-5 rounded-md bg-muted px-1.5 text-xs` | `+ px-chip pixel:h-auto pixel:min-h-6` |
| `PrimaryAction` | `Button sm`, для входящих `bg-brand` | без изменений |
| тело | `flex flex-col gap-5 px-4 pt-4 pb-[max(1.5rem,env(...))]` | `+ pixel:gap-3.5 pixel:px-2 pixel:pt-2.5` |
| `Meta` | `border-t border-border pt-3`, `dl text-xs` | `+ pixel:border-t-2` |
| заглушка загрузки | `h-full bg-background` | без изменений |

**`detail/*`**

| Файл | Сейчас | П |
|---|---|---|
| `TitleField` | `AutoTextarea` `rounded-md border-0 bg-transparent … text-lg font-semibold shadow-none` | без изменений (`border-0` исключает кожу поля) |
| `ContentEditor` (просмотр) | `-mx-1 cursor-text rounded-md px-1 py-0.5 hover:bg-muted/40` | при `!mono`: `+ px-well pixel:mx-0 pixel:p-2` (`m: .detail .content`); при `mono` рамку даёт `CodeView`. Кнопка «Изменить» — без изменений |
| `ContentEditor` (правка) | `AutoTextarea min-h-24 resize-none` | без изменений |
| `AutoLinkText` | ссылка `underline … focus-visible:ring-2` | без изменений |
| `ItemContent` | выбор языка `SelectTrigger sm w-40` | без изменений |
| `LinkCard` | карточка `overflow-hidden rounded-lg border border-border bg-card`; скелет `animate-pulse`; картинка `border-b` | карточка — рецепт «вставка»; скелет — рецепт; картинка `+ pixel:border-b-2`; кнопки без изменений; вращение `refresh` — шагами (даёт `pixel.css`) |
| `FileBlock` | кнопка-превью `rounded-lg …ring…`; `Lightbox` — `DialogContent` на весь экран `bg-black/90 text-white ring-0` | **`DialogContent` лайтбокса: добавить `data-skin="none"`** (§5.3) — иначе кожа диалога перекрасит его в бумагу |
| `LinkedItems` | `Heading` `text-xs font-medium text-muted-foreground`; строки `rounded-md hover:bg-muted/50` | `Heading` — рецепт «подзаголовок блока»; `li` `+ px-nav` (`m: .detail .links a`) |
| `LinkPicker` | `Popover` + `Command` | без изменений |
| `AiSuggest` | `AiSummary` `rounded-lg bg-muted/50 px-3 py-2`; блок результата `rounded-lg border border-border bg-card p-3` | оба — рецепт «вставка»; `h3` — рецепт «подзаголовок блока» |

`save.ts`, `autosave.ts`, логика сохранения, `key={id}` — НЕ трогать.

### 2.6 Быстрая запись и палитра (пакет `capture-palette`)

**`QuickCapture.tsx`** — образец `m: #capture .panel.dialog`.

| Узел | Сейчас | П |
|---|---|---|
| `DialogContent` | `… gap-0 overflow-y-auto p-2.5 sm:p-3` | добавить проп `data-skin="panel"` (рама со ступенчатыми углами, отступ 14px — §5.3) и `+ pixel:flex pixel:flex-col pixel:overflow-hidden` |
| `DialogTitle` | `sr-only`, «Быстрое добавление» | текст «Быстрая запись»; `sr-only` `+ pixel:not-sr-only pixel:mb-2.5 pixel:flex pixel:items-center pixel:gap-2 font-heading pixel:text-2xl`; внутри перед текстом `<Icon name="sprout" pixelSize={20} className="hidden pixel:block" />` |
| `CaptureForm` корень | `relative flex flex-col gap-2.5` | обернуть прокруткой в П: корень `+ pixel:-m-1 pixel:min-h-0 pixel:overflow-y-auto pixel:p-1` |
| оверлей перетаскивания | `rounded-xl border-2 border-dashed border-ring bg-popover/90` | `+ pixel:bg-paper` |
| поле текста, заголовок | `Textarea`, `Input` | без изменений |
| кнопки типа | `h-7 rounded-md border border-transparent px-2 text-xs …`, вкл. `border-border bg-muted`, `aria-pressed` | `+ px-chip pixel:px-1.5` |
| `FileRow` | `rounded-lg border bg-card p-1.5 pr-1`, миниатюра `rounded-md bg-muted` | `li` — рецепт «вставка»; миниатюра `+ pixel:bg-paper-line` |
| скрепка, звезда, «+» | `Button ghost icon` | рецепт «квадратная кнопка» (звезда — `aria-pressed`, значок `fill-current`) |
| «Сохранить» | `bg-brand …` + `kbd` | без изменений |

Логика формы (черновик, `snapshotRef`, определение типа, вставка, перетаскивание, клавиши) — НЕ трогать.

**`CommandPalette.tsx`** — образец `m: #palette .pal`, `.pr`, `.pg`.

- Рама-панель приходит из `pixel.css` по `:has(> [data-slot="command"])` — `CommandDialog` и `ui/command.tsx` не трогать.
- `Command`: `+ className="pixel:p-0"`. Строка подсказок: `border-t border-border` `+ pixel:border-t-2 pixel:px-1`.
- Подсвеченная строка, поле поиска, заголовки групп — уже в `pixel.css`.
- Добавить действия сцены (как `m: palSource()`): `scene-auto`, `scene-meadow`, `scene-autumn`, `scene-paper`,
  `scene-winter`, `scene-classic` — «Сцена: по календарю / Луг / Осень / Бумага / Зима / Классика», значок `sprout`,
  выполнение: `close(); setScene(v); setSetting('scene', v).catch(toast.error(describeError))` (`setScene` из `useScene()`).
- Заглушка для этапов 4–5 (§1.3).

### 2.7 Примитивы записей (пакет `primitives`)

| Файл | Сейчас | П |
|---|---|---|
| `TagChip` | `span` `h-5 rounded-md text-xs leading-none`, `bg-muted text-muted-foreground` / активный `bg-brand-soft text-foreground` | `+ px-chip pixel:h-auto pixel:min-h-6 pixel:leading-tight` и `data-on={active ? 'true' : undefined}` (`m: .chip`, `.chip.on`). Внутренние кнопки — без изменений |
| `TagInput` (поле) | `min-h-8 rounded-lg border border-input bg-transparent px-1.5 py-1 focus-within:ring-3 …` | `+ px-field` (на обёртке) |
| `TagInput` (подсказки) | `ul` `rounded-lg bg-popover p-1 shadow-md ring-1 ring-foreground/10`, `mt-1`/`mb-1`; `li` `rounded-md px-2 py-1 text-sm`, активная `bg-muted` | `ul` `+ px-pop`, отступ `pixel:mt-2`/`pixel:mb-2` (рама выступает на 4px); `li` `+ px-nav` (ловит `aria-selected`) |
| `CategoryBadge` → `CategoryDot` | `size-2 rounded-full`, фон inline `var(--cat-x)` | `+ px-sw pixel:size-2.5` (квадрат с рамкой, `m: .sw`) |
| `CategoryBadge` → `BadgeView` | `rounded-md font-medium`, `h-5 px-1.5 text-xs` / `h-6 px-2 text-2sm`, фон inline `var(--cat-x-soft)` | фон перевести на переменную: `style={{ '--cat-bg': `var(--cat-${cat.color}-soft)` }}` + класс `bg-(--cat-bg)`; `+ pixel:h-auto pixel:min-h-5 pixel:bg-transparent pixel:px-0 pixel:font-normal` (в П — квадрат и имя чернилами, `m: .cat-tag`) |
| `CategorySelect` | `Button outline` + `Popover` + `Command` | без правок классов; проверить вид (кнопка, список, галочка, «Создать») |
| `CodeView` | корень `rounded-lg border border-border bg-muted/50`; ключевые слова `text-brand`; кнопка «Копировать» `h-6 rounded-md bg-muted px-1.5 text-xs` | корень — рецепт «вставка»; `keyword`: `text-brand pixel:text-brand-lo pixel:dark:text-brand-hi` (brand — не цвет текста на бумаге); кнопка `+ px-btn`. Проп `className` от вызывающих сохраняется |
| `FilePreview` | изображение: `rounded-lg bg-muted/50`, скелет `animate-pulse`, `transition-opacity duration-150`; файл: `rounded-lg border border-border bg-muted/50 p-3`; текст файла — `pre` с той же рамкой | контейнеры файла и `pre` — рецепт «вставка»; скелет — рецепт; картинка `+ pixel:transition-none`. Значки файлов: `<Icon name={iconFor(…)} size={24} strokeWidth={1.5} />` (миниатюра) и `size={28} pixelSize={32}` (полный вид). Сглаживание фотографий не отключать |
| `Highlighted` | `<mark>` | без изменений |

(уточнено при сверке) Пользовательские свойства в `style` (`'--cat-bg'`, `'--c'`) типом `CSSProperties` не
предусмотрены: объект приводится `as CSSProperties` (как в `catBarStyle`, §5.2), без `any` и `@ts-expect-error`.

Сигнатуры из `CLAUDE.md` («Контракты UI») не меняются; `className` у `CategoryBadge`, `CategoryDot`, `TagChip`,
`TagInput`, `CategorySelect`, `CodeView` должен по-прежнему доходить до корня через `cn` (на это опирается пакет `list`).

### 2.8 Настройки (пакет `settings`) — образец `m: #settings`, `.set.panel.thin`, `.srow`, `.seg`, `.tg`, `.field`

| Узел | Сейчас | П |
|---|---|---|
| `SettingsView` | `mx-auto max-w-2xl flex-col gap-6 px-4 pt-6 … md:px-6`; `h1 font-heading text-lg font-medium` | `+ pixel:mx-0 pixel:max-w-[720px] pixel:gap-2.5 pixel:px-2.5 pixel:pt-2.5 pixel:md:px-2.5`; `h1` — рецепт заголовка раздела |
| `Section` | `flex flex-col gap-3 border-t pt-6`; `h2 font-heading text-md font-medium` | `+ px-panel-thin pixel:gap-1.5`; `h2` — рецепт «подзаголовок блока» `+ pixel:text-muted-foreground` (`m: .set h4`); `font-heading` убрать; обёртка детей `+ pixel:gap-0` |
| `Row`, `Field` | `flex items-center justify-between gap-3` / `flex flex-col gap-1.5` | `+ px-divider pixel:py-2` (`m: .srow`); у `Row` ещё `pixel:gap-4 pixel:max-md:flex-wrap` |
| подписи | `text-2sm`, у `Field` `font-medium` | `+ pixel:font-semibold` у подписей `Field` и у `label` строк с переключателем |
| `CommitInput` | `Input` + ошибка `text-xs text-destructive` | без изменений |
| `AppearanceSection` → `Segmented` | `radiogroup` `inline-flex w-fit rounded-lg bg-muted p-[3px]`; кнопки `h-7 rounded-md px-3 text-2sm`, активная `bg-background shadow-sm` | группа `+ pixel:flex-wrap pixel:gap-1 pixel:bg-transparent pixel:p-0`; кнопки `+ px-btn pixel:h-7.5` (`aria-checked` → золото, `m: .seg .btn.on`). `radioGroupKeyDown`, `tabIndex` — без изменений |
| `CategoriesSection` | список `divide-y rounded-lg border`; кнопка цвета `size-7 rounded-md`, образец `size-3.5 rounded-full`; палитра — `radio` `size-7 rounded-full`, выбранный `ring-2 ring-foreground/60` | список — рецепт; образцы `+ px-sw`; выбранный цвет `+ px-sel` (кольца в П отключены); поле имени `border-transparent` — без изменений |
| `TagsSection` | список `divide-y rounded-lg border max-h-80` | рецепт «список с разделителями» |
| `ShortcutsSection` | список `divide-y rounded-lg border`; локальный `Kbd` | рецепт; `Kbd` без изменений |
| `DataSection` | `Stat` `rounded-lg border px-3 py-2`; кнопки; три диалога | `Stat` — рецепт «вставка»; диалоги стилизуются сами |
| `AiSection`, `LinksSection`, `AboutSection` | `Row`/`Field`/`Button`/`Switch` | через `Row`/`Field`; свои правки — только подписи (`pixel:font-semibold`) |

Проверки значений (`validateProxy`, `aiBaseUrlError`), сохранение, подтверждения удаления — НЕ трогать.

### 2.9 Toast и компоненты `ui/*`

Правок в `ui/*` на этапе 3 нет. Toast, меню, поповеры, диалоги, вкладки, подсказки стилизует `pixel.css` (этап 1 + §5.3).
Приёмку вида toast («Удалено» + «Отменить», «Сохранено» + «Открыть», ошибка) делает основная сессия на шаге P9.

## 3. Сквозные правила переноса

1. **Одна разметка на оба стиля.** Базовые классы = «Классика» (не менять). Пиксельные отличия: `px-*` (кожа) и
   `pixel:*` (раскладка, размеры, видимость). `usePixel()` в коде — только при разной СТРУКТУРЕ (в этапе 3 один случай:
   теги в `Sidebar`). Условия ради цвета/рамки запрещены.
2. **Примитив сильнее утилит.** Свойство, которое задаёт `px-*` или правило по `data-slot` (фон, цвет, рамка, тень,
   `clip-path`, у панелей — `padding`), утилитой не перебить. Отступ панели — только `pixel:[--px-pad:…]`. Модификатор
   важности `!` не использовать. Не хватает правила — запрос основной сессии (п. 12), а не обходной путь.
3. **`src/styles/*.css` и `src/components/ui/*` исполнители P1–P8 не правят.**
4. **Значки** — только `<Icon>`/`<TypeIcon>`. Импорт `lucide-react` вне `icons/registry.ts` запрещён. Размер в П — `pixelSize`
   (8×8: 16/24/32/48; значки типа: 20/30/40/60); классы `size-*` на пиксельный значок не действуют.
5. **Размеры шрифта** — только токены (`text-2xs|xs|2sm|sm|md|base|lg|2xl`). Допустимые остатки: `text-[0.8rem]` в
   `BulkBar` (совпадает с `ui/button sm`) и всё внутри `ui/*`. Фиксированная высота под текст < 24px — рецепт из §2.
6. **Шрифт заголовков** (`font-heading`) — только логотип, `h1` разделов, заголовок диалога «Быстрая запись»,
   «Всё разобрано». Нигде больше.
7. **Цвет.** Только токены. `text-brand` на бумаге в П запрещён (счётчик → `px-count`, код → `brand-lo/hi`).
   Золото: курсор, включённые кнопки/чипы, избранное. Текст поверх цвета категории не писать.
8. **Фокус и курсор.** Классы `focus-visible:ring-*` остаются (это вид «Классики»); в П кольца погашены, фокус —
   автоматическая обводка 2px brand, курсор списка — 2px gold (`px-row[data-cursor]`). Прокручиваемому контейнеру с
   фокусируемыми детьми в П нужен внутренний запас ≥ 4px (`pixel:p-1 pixel:-m-1`), иначе обводка обрезается.
9. **Состояния.** Наведение и нажатие — из примитивов (нажатая кнопка −2px, без плавности). Выключенное — `disabled` /
   `aria-disabled` (`opacity .5`). Включённое — `aria-pressed` / `aria-checked` / `data-on="true"`; отмеченная строка —
   `data-checked="true"`; открытая — `aria-current="true"`.
10. **Анимации.** Свои `duration-*`, `transition-[…]`, `animate-pulse` в П отключать (`pixel:transition-none`,
    `pixel:animate-none`); вращение значка загрузки оставить (шаги даёт `pixel.css`).
11. **Поведение неприкосновенно.** Не менять: обработчики, порядок и набор действий, `role`, `aria-*`, `tabIndex`,
    `data-item-id`, `data-cursor`, `data-detail-sheet`, `data-search-input`, `data-slot`, тексты `aria-label`, ключи React,
    `memo`-сравнения, ленивую загрузку. Новые атрибуты допустимы только перечисленные здесь: `data-checked`, `data-on`,
    `data-flag`, `data-skin`, `data-scroll-root`, `data-topbar-slot`. Пользовательские тексты не менять, кроме названных в §2.
12. **Нужно новое CSS-правило** — не писать его самому: записать в свой `.progress/agents/<пакет>.md` раздел «Нужно в
    pixel.css» (селектор, свойства, зачем) и сообщить в отчёте; правку вносит основная сессия.
13. **Тесты.** Vitest работает в окружении `node`, тестов отрисовки нет и на этапе 3 они не добавляются. Обязательно:
    `npm run typecheck` и `npm test` зелёные. Пока работают соседи, typecheck может падать на чужих файлах — отвечать
    за свои; итог сводит основная сессия.
14. **Проверка в браузере.** Свой dev-сервер на своём порту (`npm run dev -- --port <порт> --strictPort`, порты в §4):
    у каждого порта свои IndexedDB и настройки, сцены переключаются независимо (Настройки → Оформление).
    Обязательная матрица: «Осень» день и ночь · «Классика» день и ночь · ширина 1280 и 390px; бегло — «Луг», «Бумага»,
    «Зима» днём; шрифты «Мягкий пиксель» и «Пиксельный» — на одном экране пакета (ничего не обрезано и не наезжает).
    «Классика» сверяется со снимком до правок: отличий быть не должно.
15. **Файл прогресса** `.progress/agents/<пакет>.md`: задача, статус, результат, изменённые файлы, «Нужно в pixel.css»,
    что не удалось проверить. git не трогать.

## 4. Пакеты работ

Объём: «строк» — размер файлов пакета; «правок» — ожидаемое число изменённых строк.

| Пакет | Порт | Файлы (исключительное владение) | Строк / правок |
|---|---|---|---|
| `shell` | 5181 | `src/components/layout/AppShell.tsx`, `Sidebar.tsx`, `TopBar.tsx`, `MobileNav.tsx`, `ErrorBoundary.tsx` | 815 / ~160 |
| `list` | 5182 | `src/components/items/ItemList.tsx`, `ItemCard.tsx`, `EmptyState.tsx`, `BulkBar.tsx`, `ItemMenu.tsx` | 1304 / ~170 |
| `views-filter` | 5183 | `src/components/items/FilterBar.tsx`, `src/views/ItemsView.tsx`, `InboxView.tsx`, `LibraryView.tsx`, `FavoritesView.tsx`, `ArchiveView.tsx` | 792 / ~110 |
| `triage` | 5184 | `src/components/items/TriageMode.tsx` | 533 / ~60 |
| `detail` | 5185 | `src/components/items/ItemDetail.tsx`, `src/components/items/detail/*.tsx` | 1058 / ~110 |
| `capture-palette` | 5186 | `src/components/capture/QuickCapture.tsx`, `src/components/palette/CommandPalette.tsx` | 951 / ~100 |
| `primitives` | 5187 | `src/components/items/TagChip.tsx`, `TagInput.tsx`, `CategoryBadge.tsx`, `CategorySelect.tsx`, `CodeView.tsx`, `FilePreview.tsx`, `Highlighted.tsx` | 870 / ~90 |
| `settings` | 5188 | `src/views/SettingsView.tsx`, `src/views/settings/*.tsx` | ~1300 / ~130 |

Ничьи на этапе 3 (не править): `src/components/ui/*`, `src/components/icons/*`, `ThemeProvider.tsx`, `TypeIcon.tsx`,
`items/categoryColor.ts`, `items/remoteImages.ts`, `items/safeFileUrl.ts`, `detail/save.ts`, `detail/autosave.ts`,
`views/settings/radioKeys.ts`, `App.tsx`, `main.tsx`, `src/styles/*`, `src/index.css`, `hooks/*`, `store/*`, `lib/*`.

Общие критерии готовности (для каждого пакета): правки только в своих файлах; §3 соблюдён; `grep` по своим файлам
не находит `lucide-react`, `text-[` (кроме `text-[0.8rem]` в `BulkBar`), `#` + hex, `oklch(`; typecheck/test зелёные
в части своих файлов; матрица п. 3.14 пройдена; сценарии пакета ниже работают мышью и с клавиатуры.

### 4.1 `shell`
- Риски: перенос прокрутки из `main` во внутренний блок (проверить: липкие заголовки дат, дозагрузка списка при
  прокрутке, `scrollIntoView` курсора, прокрутка настроек); `inert` и фокус при модальных деталях; безопасные зоны.
- Готово, когда: в П видна рама — фон дерева, зазоры 6px, три панели (с деталями — четыре) со ступенчатыми углами;
  ни одна панель не прокручивается целиком, рама неподвижна; в К отличий нет.
- Проверить: 1280px — переходы 1–4 и кликом, счётчики, сворачивание «Категории»/«Теги», создание категории (Enter, Esc,
  blur), клик по категории и тегу (отбор и снятие), «Показать все», цикл темы, «Команды» (кнопка и `Ctrl+K`), `/` —
  фокус поиска, Esc в поиске; открыть запись — четвёртая панель, Esc, фокус возвращается на строку; сузить до 1000px —
  детали модальным листом с затемнением, клик по затемнению закрывает, Tab не уходит под лист; перетащить файл в окно —
  оверлей. 390px — кнопка меню, выезжающая панель с рамой, выбор пункта закрывает меню, плавающая кнопка 56px (скрыта при
  открытых деталях/выборе), детали на весь экран, «Назад». Сбой раздела: временно бросить ошибку в представлении —
  `ViewErrorFallback` (правку откатить).

### 4.2 `list`
- Риски: самый видимый пакет; `display: contents` у тела строки в К (сверить снимки строка-в-строку); высота строки в П
  со шрифтами `ft-soft`/`ft-pixel`; сетка: `gridCols()`; производительность (60 строк, `memo`).
- Готово, когда: строка в П — как `m: .rowi` (флажки, полоса категории, значок 30px, действия по наведению и по
  фокусу, золотой курсор, отмеченная — `--brand-soft`); карточка сетки — рамка, полоса, накладки; пустое состояние,
  панель массовых действий и меню — в стиле; К без отличий.
- Проверить: во всех четырёх разделах, список и сетка: `J/K`, стрелки (в сетке — по колонкам), `Enter`/`O`, `E`, `A`,
  `F`, `X`, `Del`/`Backspace`, `Ctrl+A`, `Esc`; клик, `Shift`+клик, `Ctrl`+клик, чекбокс при наведении; курсор следует
  за деталями; быстрые действия и подсказки; меню «…» (все пункты, клавиатура); массовые: в базу, архив/вернуть,
  категория (в т.ч. создать), теги (поповер), удалить, снять выбор; toast «Отменить» возвращает; поиск — подсветка
  `<mark>`, сниппет; запись без категории (серая полоса) и с категорией; ссылка с картинкой, изображение, код; длинный
  заголовок и 5+ тегов; 390px — строки без действий по наведению, чекбокс виден, меню 36px.

### 4.3 `views-filter`
- Риски: горизонтальная прокрутка полосы фильтров и обрезка обводки; ширина заголовка с подсказкой клавиш при открытых
  деталях (1280px → список ≈ 560px).
- Готово, когда: заголовки разделов пиксельным шрифтом 24px, счётчик входящих на brand, чипы типов и переключатели
  золотые во включённом состоянии, активные фильтры — чипы; К без отличий.
- Проверить: типы (несколько), категория, теги (поиск по тегам, отметки), «Без тегов и категории», период, сортировка,
  вид список/сетка, снятие чипов по одному и «Сбросить фильтры»; пустая выдача → «Ничего не найдено» → «Сбросить»;
  быстрая строка во входящих (Enter, вставка многострочного текста открывает панель, скрепка); «Разобрать» выключена
  при пустых входящих; пустые состояния всех четырёх разделов; Tab по полосе фильтров — обводка не обрезана; 390px —
  полоса прокручивается пальцем, кнопки 36px.

### 4.4 `triage`
- Риски: клавиши при фокусе в полях; полноэкранный диалог на 390px.
- Готово, когда: шапка с прогрессом, содержимое, нижняя панель действий и экран итогов — в стиле; К без отличий.
- Проверить: `E`, `A`, `F`, `Del`, `→`/`S`, `←`, `Ctrl+Enter` (в т.ч. из поля заголовка), правка заголовка, категория,
  теги, «Предложить теги» (если включён ИИ), все типы записей (текст, ссылка с картинкой, код, файл, изображение),
  экран «Всё разобрано» со счётчиками и «Готово», пустые входящие, закрытие крестиком и Esc; 390px — кнопки переносятся.

### 4.5 `detail`
- Риски: правка шага 0 этапа 2 в `ItemDetail.tsx` (должна быть уже влита); лайтбокс (`data-skin="none"`); автосохранение
  при размонтировании; контейнерный запрос `@sm`.
- Готово, когда: шапка — квадратные кнопки, включённая звезда золотая; содержимое во вставке; карточка ссылки, файл,
  код, связи, ИИ, метаданные — в стиле; лайтбокс тёмный в любой сцене; К без отличий.
- Проверить: каждый тип записи; правка заголовка (blur, смена записи), содержимого (клик, «Изменить», Esc — откат,
  `Ctrl+Enter`), смена типа текст/идея/код, язык кода, копирование кода; категория (в т.ч. создать), теги (подсказки,
  Backspace, запятая); связи — добавить через поиск, перейти, убрать, предложенные; ссылка — открыть, копировать,
  обновить (значок вращается шагами); файл — скачать, PDF «Открыть», изображение — лайтбокс и закрытие; звезда,
  главное действие для трёх статусов, меню «…», закрытие (крестик, Esc); ИИ — предложить, принять заголовок/описание/тег;
  390px — «Назад», прокрутка, поля не увеличивают страницу.

### 4.6 `capture-palette`
- Риски: рама-панель у диалога с прокруткой (содержимое не должно наезжать на раму); черновик и `snapshotRef`;
  палитра — кожа через `:has`.
- Готово, когда: быстрая запись — панель с рамой и заголовком «Быстрая запись» с ростком; типы — чипы, включённый
  золотой; палитра — панель с рамой, подсвеченная строка как активный пункт навигации; К без отличий.
- Проверить: `N`, `Alt+N`, `Ctrl+Shift+Space`, `Ctrl+V` вне полей (текст, картинка), перетаскивание файлов в форму;
  автоопределение типа (ссылка, код, идея) и ручной выбор; язык кода; заголовок, категория, теги; избранное,
  «Сразу в базу знаний»; `Enter`, `Ctrl+Enter`, `Ctrl+Shift+Enter` (добавить ещё); несколько файлов и удаление файла;
  Esc с черновиком и восстановление черновика; toast «Сохранено» → «Открыть». Палитра: `Ctrl+K`, ввод, стрелки (по
  кругу), Enter, Esc; записи, действия, категории, теги, «Искать … в базе знаний», смена темы и сцены. 390px — диалог не
  выходит за экран, клавиатурные подсказки скрыты.

### 4.7 `primitives`
- Риски: компоненты используются всеми пакетами — менять только вид, не пропсы; `CategoryBadge` в строке списка
  (два экземпляра с разными `className`); высота чипа при `ft-soft`.
- Готово, когда: тег — чип с рамкой; категория — квадрат + имя; поле тегов — пиксельное поле с выпадающим списком в
  раме; код и файлы — во вставках; К без отличий.
- Проверить (в деталях записи, быстрой записи, массовых действиях, списке): `TagInput` — ввод, Enter, запятая, пробел,
  Tab, Backspace, стрелки по подсказкам, «Создать», раскрытие вверх у нижнего края, клик по подсказке;
  `CategorySelect` — поиск, выбор, «Без категории», «Создать»; `CodeView` — подсветка днём и ночью (ключевые слова
  читаемы), «Копировать» по наведению и по фокусу; `FilePreview` — изображение (миниатюра и полный вид), PDF, текстовый
  файл, архив, неизвестный тип; `TagChip` — обычный, кликабельный, активный, с удалением.

### 4.8 `settings`
- Риски: много разнородных блоков; `AppearanceSection` уже менялся на этапе 1 (сегменты) — не сломать переключение;
  длинные подсказки в узкой панели.
- Готово, когда: каждая секция — тонкая панель (`px-panel-thin`) с приглушённым заголовком, строки разделены линией
  2px, сегменты — кнопки с золотой активной; списки категорий/тегов/клавиш — вставки; К без отличий.
- Проверить: сцена (6 вариантов), тема, шрифт (4; выключен в «Классике»), «Живой фон»; категории — создать,
  переименовать, цвет (палитра, стрелки), порядок, удалить с подтверждением; теги — поиск, переименовать (слияние),
  удалить; ссылки — переключатель, прокси (ошибка проверки); ИИ — включить, пресеты, ключ (показать/скрыть), «Проверить»;
  клавиши — список, глобальное сочетание (Tauri: поле видно только там); данные — счётчики, экспорт, импорт (диалог
  «Объединить/Заменить»), демоданные, очистка с вводом подтверждения; 390px — строки переносятся, сегменты переносятся.

### 4.9 Приёмка основной сессией (P9)
1. `npm run typecheck`, `npm test`, `npm run build`; `grep -rn "lucide-react" src` → только `icons/registry.ts`.
2. Сквозной проход в «Осени» (день, ночь) и «Классике» (день, ночь), 1280 и 390px: добавить запись → входящие →
   курсор → `E` → база знаний → детали → связь → архив → удалить → «Отменить»; разбор входящих; палитра; настройки.
3. Toast: «Удалено»/«Отменить», «Сохранено»/«Открыть», ошибка — рама, кнопка, значок.
4. Запросы «Нужно в pixel.css» из отчётов пакетов — внести, перепроверить затронутые экраны.
5. «Луг», «Бумага», «Зима» — бегло день/ночь; шрифты `ft-soft`, `ft-pixel` — список, детали, настройки.
6. Tauri (`npm run tauri dev`): рама у краёв окна, шрифты, быстрая запись по глобальной клавише.

## 5. Сделать ДО распараллеливания (P0, основная сессия)

### 5.1 `Icon`: размер только для пиксельных сцен

`src/components/icons/Icon.tsx` — добавить в `IconProps`:
```ts
/** Размер только в пиксельных сценах (px, привязка к сетке). Не задан — берётся `size`. В «Классике» игнорируется. */
pixelSize?: number
```
Поведение: П — `<PixelIcon size={pixelSize ?? size} …/>`; К — как сейчас. `PixelIcon` не меняется.

`src/components/items/TypeIcon.tsx`:
```ts
export function TypeIcon(props: { type: ItemType; className?: string; size?: number; pixelSize?: number }): JSX.Element
// <Icon name={TYPE_ICON_NAME[type]} size={size ?? 16} pixelSize={pixelSize} className={cn('shrink-0', className)} />
```
Нужно, потому что в мокапе значок типа в строке — 30px, а в «Классике» он обязан остаться 16px.
(уточнено при сверке) `JSX.Element` здесь — условная запись: в `@types/react` 19 глобального `JSX` нет; в коде —
`import type { JSX } from 'react'` или без явного типа возврата (как сейчас в `TypeIcon.tsx`). Новые пропсы `TypeIcon`
необязательные — контракт `TypeIcon({ type, className? })` из `CLAUDE.md` сохраняется.

### 5.2 `src/components/items/categoryColor.ts` (новый) + `categoryColor.test.ts`

```ts
import type { CSSProperties } from 'react'
import type { Category, CategoryColor } from '@/types'

/** 'var(--cat-blue)'; для записи без категории — 'var(--cat-none)'. */
export function catColorVar(color: CategoryColor | null | undefined): string
/** Стиль для px-catbar: { '--c': catColorVar(color) }. */
export function catBarStyle(color: CategoryColor | null | undefined): CSSProperties
/** Категория из CategoriesContext (внутри ItemList). Вне провайдера и для null/undefined — undefined. Подписок на БД не создаёт. */
export function useListCategory(categoryId: string | null | undefined): Category | undefined
```
Тест: `catColorVar('blue') === 'var(--cat-blue)'`, `catColorVar(null) === 'var(--cat-none)'`, `catBarStyle(undefined)`.
Пользуются: `list` (строка, карточка). `CategoriesContext` остаётся в `CategoryBadge.tsx`.

### 5.3 Заплатка `src/styles/pixel.css`

(а) В правиле «всплывающие поверхности» (блок 3) заменить `[data-slot="dialog-content"]` на
`[data-slot="dialog-content"]:not([data-skin])` и сразу после правила добавить:
```css
/* диалог-панель (быстрая запись, палитра команд): рама со ступенчатыми углами, как .panel.dialog мокапа */
.pixel [data-slot="dialog-content"]:is([data-skin="panel"], :has(> [data-slot="command"])) {
  background-color: var(--paper); color: var(--ink); border: 2px solid var(--wood-dark);
  box-shadow: inset 0 0 0 2px var(--wood-hi), inset 0 0 0 6px var(--wood), inset 0 0 0 8px var(--wood-lo);
  padding: var(--px-pad, 14px); clip-path: var(--px-corners); animation-timing-function: steps(3, end);
}
```
`data-skin="none"` — диалог без кожи (лайтбокс изображения: сейчас правило этапа 1 перекрасило бы его чёрный фон в бумагу).
Специфичность обоих правил (0,3,0), второе стоит ниже — для палитры побеждает оно.

(б) В блок 5 (примитивы), после `.px-btn*`:
```css
/* плавающая кнопка «Добавить»: скос brand + жёсткая тень (m: #fab) */
.pixel [data-slot="button"].px-fab {
  box-shadow: inset 2px 2px 0 var(--brand-hi), inset -2px -2px 0 var(--brand-lo), 4px 4px 0 var(--shadow);
}
```

(в) Блок 6 (телефон) заменить целиком:
```css
@media (max-width: 767px) {
  /* лист на весь экран: без среза углов, отступ с учётом безопасной зоны */
  .pixel .px-sheet {
    clip-path: none;
    --px-pad: calc(var(--px-sheet-pad, 8px) + env(safe-area-inset-top)) calc(var(--px-sheet-pad, 8px) + env(safe-area-inset-right))
      calc(var(--px-sheet-pad, 8px) + env(safe-area-inset-bottom)) calc(var(--px-sheet-pad, 8px) + env(safe-area-inset-left));
  }
  /* выезжающее меню: раму рисует вложенная панель, собственная кромка листа не нужна */
  .pixel [data-slot="sheet-content"]:has(> .px-panel) { border-width: 0; background-color: transparent; }
}
```

(г) Проверить после заплатки (в «Осени»): подтверждение удаления категории (обычный диалог — рама наружу, как раньше);
палитра и быстрая запись — рама-панель; лайтбокс — тёмный.

### 5.4 `docs/DESIGN.md` — дополнить

- §5: `px-fab`; `data-skin="panel" | "none"` у `DialogContent`; `--px-pad`, `--px-sheet-pad`.
- §7: проп `pixelSize`.
- §2: запрет модификатора `!`; правило про внутренний запас 4px у прокручиваемых блоков.

### 5.5 Чего в P0 нет намеренно

Общих компонентов-обёрток («заголовок раздела», «секция панели») не заводим: это 1–2 строки классов, рецепты даны в §2;
лишний общий файл создал бы зависимость между параллельными пакетами.

## 6. Риски этапа

- **Кожа вне слоёв** — исполнитель не может «подправить» примитив утилитой и не правит CSS. Узкое место — основная
  сессия (правило 3.12). Ожидаемые запросы: отступы `px-nav` в меню, вид чипа-кнопки при наведении, toast на телефоне.
- **`display: contents` + `pixel:flex`** у тела строки и **`h-7.5`/`size-7.5`/`bg-(--var)`** — синтаксис Tailwind v4;
  если установленная версия не выпустит класс, заменить на `pixel:h-[30px]` и т.п. (проверяется первым же запуском).
- **`:has()`** в `pixel.css` — нужен Chromium ≥ 105 / Safari ≥ 15.4; WebView2 и актуальные браузеры подходят.
- **Tiny5 как шрифт текста** (`ft-pixel`): строка списка и шапка деталей шире обычного; критерий — «не ломается».
- **Плотность.** Панель деталей 460px + рамы оставляют списку ≈ 560px при 1280px; если тесно — уменьшить панель до
  420px в П одной правкой в `AppShell` (`pixel:w-[420px]`).
