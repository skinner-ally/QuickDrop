# Спецификация этапа 1 — основа темы

Источник: `.progress/plan-combined.md` (этап 1), `mockup/style.css`, `mockup/app.js`. Правила дизайна — `docs/DESIGN.md`.
Цель этапа: приложение в прежней вёрстке, сцены и шрифты переключаются, «Классика» выглядит как сейчас.
Вёрстку экранов (рамы, строки с флажками и т.п.) этот этап **не** меняет — это этап 3.

## 0. Порядок работ

| Волна | Исполнитель | Что делает |
|---|---|---|
| 0 | основная сессия | `npm i @fontsource-variable/nunito@^5.3.0 @fontsource-variable/handjet@^5.3.1 @fontsource/tiny5@^5.3.0`; заменить раздел «Дизайн» в `CLAUDE.md` ссылкой на `docs/DESIGN.md` (этап 0 плана); дождаться шага контрактов этапа 2 (`data-contracts`, `.progress/spec-stage2.md` §1) — он один правит `src/types.ts` и `src/db/settings.ts` для обоих этапов |
| 1 (параллельно) | `theme-core` | CSS сцен и примитивов, шрифты, `lib/scene.ts`, ThemeProvider, theme-init.js, раздел «Оформление» |
| 1 (параллельно) | `icons` | `src/components/icons/**`: Icon, PixelIcon, реестр, все карты пикселей |
| 2 | `icons-migrate` | замена lucide → `Icon` и `text-[Npx]` → токены по всему `src/` |

Исполнители волны 1 не зависят друг от друга по файлам и по типам (иконки узнают сцену по классу на `<html>`).

**Стык с этапом 2 (уточнено при сверке).** Этапы 1 и 2 идут одновременно, общие файлы — только `src/types.ts` и
`src/db/settings.ts`. Оба файла правит ОДИН исполнитель — `data-contracts` (шаг 0 этапа 2), он выполняется первым и
добавляет в том числе `scene` / `font` / `ambient` (§6.1). `theme-core` эти два файла не трогает и стартует после
приёмки шага 0; `icons` от шага 0 не зависит и может стартовать сразу. Остальные исполнители этапа 2 (`data-*`,
`tauri-backup`) с файлами этапа 1 не пересекаются; `icons-migrate` правит `ItemDetail.tsx` уже после строки
`SOURCE_LABEL.extension`, внесённой шагом 0.

## 1. Ключевые решения (и почему)

1. **Кожа — вне слоёв.** Все правила `pixel.css` и `scenes.css` пишутся вне `@layer`, под `.pixel`. Невложенный в слой
   CSS сильнее утилит Tailwind (`@layer utilities`) независимо от специфичности — поэтому правила по `data-slot`
   перекрывают классы внутри `ui/*`, не трогая сами файлы. Следствие: утилитой (даже `pixel:`) нельзя перебить
   свойство, которое задаёт примитив. Поэтому примитивы задают только «кожу» (фон, рамка, тень, clip-path, цвет)
   и состояния по атрибутам; раскладка остаётся утилитам. Исключения — `--px-pad` у панелей и размеры переключателя.
2. **Скругления и тени.** `--radius: 0px` (обязательно с единицей: `calc(0 * 0.6)` — число, а не длина) + глобальное
   `border-radius: 0` под `.pixel *`. Важные утилиты из `ui/command.tsx` (`rounded-xl!`) считаются от `--radius` и тоже дают 0.
   Мягкие тени и кольца гасятся обнулением `--tw-shadow`, `--tw-ring-shadow` и т.д. под `.pixel *`.
3. **Варианты кнопки.** У `ui/button.tsx` нет `data-variant`, менять файл нельзя → вариант определяется по токену
   класса фона: `[class~="bg-primary"]` (default), `bg-background` (outline), `bg-secondary`, `bg-destructive/10`,
   `bg-brand` (главное действие — так оно задаётся по всему приложению). Без такого класса кнопка считается ghost.
   `cn()` убирает перекрытый класс фона, поэтому `className="bg-brand …"` у default-кнопки определяется как brand.
4. **Имена размеров шрифта** обязаны быть «размерными» для `cn()` (иначе он принимает их за цвет и выбрасывает рядом
   с `text-muted-foreground` — проверено): `text-2xs`, `text-2sm`, `text-md`. Имена вроде `text-ui`, `text-13` запрещены.
5. **Всплывающие поверхности** получают раму наружными тенями и прямые углы: `clip-path` обрезал бы тень, а внутренняя
   рама требует отступа, которого у чужих компонентов (`p-0`, `p-1`) нет. Ступенчатые углы — только у `px-panel*`.
6. **`--ink-dim` затемнён относительно мокапа** в дневных палитрах до контраста ≥ 4.5 на `--paper-2` (в мокапе 3.1–3.5):
   им набран вторичный текст каждой строки. Исходное значение мокапа сохранено как `--ink-faint` (не для текста).
7. **Пиксельные иконки задают размер inline-стилем** — он сильнее и `size-*`, и правил `ui/button` (`[&_svg]:size-3`),
   поэтому значок всегда на сетке и CSS-связи между исполнителями нет.

## 2. Токены сцен

### 2.1 Файл `src/styles/scenes.css` (новый, целиком)

Специфичность: все селекторы начинаются с `:root` (`:root.pixel` = 0,2,0), чтобы побеждать `.dark` из `index.css`.

```css
/* Сцены: палитры (день и ночь) и соответствие токенам shadcn. «Классика» — токены :root/.dark в index.css. */

/* ── Луг ── */
:root.sc-meadow {
  --wood-dark: #4a2e1a; --wood: #a8703c; --wood-hi: #d39c5c; --wood-lo: #7a4e2a;
  --paper: #f8e5b4; --paper-2: #efd49b; --paper-line: #c9a565;
  --ink: #4a2f1b; --ink-dim: #765739; --ink-faint: #8c6b49;
  --brand: #d2603a; --brand-hi: #ee8f63; --brand-lo: #9a3d20; --brand-foreground: #fff3da;
  --gold: #f2c14e; --leaf: #5fa052; --danger: #a8261d; --shadow: rgb(40 24 10 / .28);
  --label: #fff6dc; --label-edge: #3a2414; --rope-a: #f4e2b0; --rope-b: #c39a5e; --rope-edge: #4a2e1a;
}
:root.sc-meadow.dark {
  --wood-dark: #14111d; --wood: #3d3554; --wood-hi: #5a4f76; --wood-lo: #29233a;
  --paper: #2c2b40; --paper-2: #23223a; --paper-line: #4b4766;
  --ink: #f1e5c6; --ink-dim: #a69d90; --ink-faint: #a69d90;
  --brand: #e2764e; --brand-hi: #f3a07c; --brand-lo: #a84a2a; --brand-foreground: #24160f;
  --gold: #f6cf62; --leaf: #6fb565; --danger: #ff8f7d; --shadow: rgb(0 0 0 / .4);
  --label: #f5ecd0; --label-edge: #0e0c16; --rope-a: #cfc3e6; --rope-b: #7f76a3; --rope-edge: #14111d;
}
/* ── Осень ── */
:root.sc-autumn {
  --wood-dark: #4a2416; --wood: #a05a30; --wood-hi: #cf8a4e; --wood-lo: #743c1e;
  --paper: #f7e0ac; --paper-2: #eecb8c; --paper-line: #c9985a;
  --ink: #4a2f1b; --ink-dim: #725337; --ink-faint: #8c6b49;
  --brand: #c2452d; --brand-hi: #e2714f; --brand-lo: #8c2c1a; --brand-foreground: #fff3da;
  --gold: #f2c14e; --leaf: #7d9a3c; --danger: #a8261d; --shadow: rgb(40 24 10 / .28);
  --label: #fff6dc; --label-edge: #3a2414; --rope-a: #f4e2b0; --rope-b: #c39a5e; --rope-edge: #4a2e1a;
}
:root.sc-autumn.dark {
  --wood-dark: #170f18; --wood: #4a3040; --wood-hi: #6b4658; --wood-lo: #33202c;
  --paper: #32263a; --paper-2: #291f30; --paper-line: #56405c;
  --ink: #f1e5c6; --ink-dim: #a69d90; --ink-faint: #a69d90;
  --brand: #e2764e; --brand-hi: #f3a07c; --brand-lo: #a84a2a; --brand-foreground: #24160f;
  --gold: #f6cf62; --leaf: #6fb565; --danger: #ff8f7d; --shadow: rgb(0 0 0 / .4);
  --label: #f5ecd0; --label-edge: #0e0c16; --rope-a: #cfc3e6; --rope-b: #7f76a3; --rope-edge: #14111d;
}
/* ── Бумага ── */
:root.sc-paper {
  --wood-dark: #5a4630; --wood: #b79a6c; --wood-hi: #d8c092; --wood-lo: #927650;
  --paper: #f6eeda; --paper-2: #ebdfc2; --paper-line: #cdb98e;
  --ink: #3d3226; --ink-dim: #726147; --ink-faint: #857253;
  --brand: #d2603a; --brand-hi: #ee8f63; --brand-lo: #9a3d20; --brand-foreground: #fff3da;
  --gold: #f2c14e; --leaf: #5fa052; --danger: #a8261d; --shadow: rgb(60 40 10 / .18);
  --label: #8a7048; --label-edge: #3a2414; --rope-a: #d8c092; --rope-b: #a98a5c; --rope-edge: #5a4630;
}
:root.sc-paper.dark {
  --wood-dark: #0f0f16; --wood: #34344a; --wood-hi: #4d4d68; --wood-lo: #242434;
  --paper: #2a2a3a; --paper-2: #222230; --paper-line: #45455c;
  --ink: #f1e5c6; --ink-dim: #a69d90; --ink-faint: #a69d90;
  --brand: #e2764e; --brand-hi: #f3a07c; --brand-lo: #a84a2a; --brand-foreground: #24160f;
  --gold: #f6cf62; --leaf: #6fb565; --danger: #ff8f7d; --shadow: rgb(0 0 0 / .4);
  --label: #6a6a88; --label-edge: #0e0c16; --rope-a: #c9c3e0; --rope-b: #8a84a8; --rope-edge: #0f0f16;
}
/* ── Зима ── */
:root.sc-winter {
  --wood-dark: #3a3440; --wood: #8a7470; --wood-hi: #b39c94; --wood-lo: #665450;
  --paper: #f1f1ec; --paper-2: #e2e4e0; --paper-line: #b9bcc0;
  --ink: #34384a; --ink-dim: #5f6577; --ink-faint: #737a8c;
  --brand: #d2603a; --brand-hi: #ee8f63; --brand-lo: #9a3d20; --brand-foreground: #fff3da;
  --gold: #f2c14e; --leaf: #4f9a78; --danger: #a8261d; --shadow: rgb(40 50 80 / .25);
  --label: #5b6f96; --label-edge: #3a2414; --rope-a: #f4e2b0; --rope-b: #c39a5e; --rope-edge: #4a2e1a;
}
:root.sc-winter.dark {
  --wood-dark: #0e1220; --wood: #33405e; --wood-hi: #4c5c80; --wood-lo: #222c44;
  --paper: #263049; --paper-2: #1f283e; --paper-line: #43507a;
  --ink: #f1e5c6; --ink-dim: #a69d90; --ink-faint: #a69d90;
  --brand: #e2764e; --brand-hi: #f3a07c; --brand-lo: #a84a2a; --brand-foreground: #24160f;
  --gold: #f6cf62; --leaf: #6fb565; --danger: #ff8f7d; --shadow: rgb(0 0 0 / .4);
  --label: #8fa3cc; --label-edge: #0e0c16; --rope-a: #d6e0f4; --rope-b: #8496bc; --rope-edge: #0e1220;
}

/* ── Общее для пиксельных сцен: соответствие токенам shadcn, категории, палитра значков ── */
:root.pixel {
  --radius: 0px;
  --background: var(--paper);            --foreground: var(--ink);
  --surface: var(--paper-2);
  --card: var(--paper-2);                --card-foreground: var(--ink);
  --popover: var(--paper);               --popover-foreground: var(--ink);
  --primary: var(--ink);                 --primary-foreground: var(--paper);
  --secondary: var(--paper-2);           --secondary-foreground: var(--ink);
  --muted: var(--paper-2);               --muted-foreground: var(--ink-dim);
  --accent: var(--paper-2);              --accent-foreground: var(--ink);
  --destructive: var(--danger);
  --border: var(--paper-line);           --input: var(--paper-line);          --ring: var(--brand);
  --brand-soft: color-mix(in srgb, var(--brand) 22%, var(--paper));
  --sidebar: var(--paper);               --sidebar-foreground: var(--ink);
  --sidebar-primary: var(--ink);         --sidebar-primary-foreground: var(--paper);
  --sidebar-accent: var(--paper-2);      --sidebar-accent-foreground: var(--ink);
  --sidebar-border: var(--paper-line);   --sidebar-ring: var(--brand);

  --gold-ink: #4a2f1b;  --gold-lo: #c08f25;  --scrim: rgb(30 18 8 / .5);

  /* Категории: палитра мокапа (work/ideas/read/home = blue/amber/green/pink), остальные подобраны к ней. День = ночь. */
  --cat-none: #a7a294;
  --cat-slate: #7f8a9c;  --cat-red: #cf5a4a;   --cat-orange: #e0823a;
  --cat-amber: #e2a83a;  --cat-green: #63a35c; --cat-teal: #4fa7a0;
  --cat-blue: #5b8bd0;   --cat-violet: #9a7bd0; --cat-pink: #d9739a;
  --cat-slate-soft: color-mix(in srgb, var(--cat-slate) 28%, var(--paper));
  --cat-red-soft: color-mix(in srgb, var(--cat-red) 28%, var(--paper));
  --cat-orange-soft: color-mix(in srgb, var(--cat-orange) 28%, var(--paper));
  --cat-amber-soft: color-mix(in srgb, var(--cat-amber) 28%, var(--paper));
  --cat-green-soft: color-mix(in srgb, var(--cat-green) 28%, var(--paper));
  --cat-teal-soft: color-mix(in srgb, var(--cat-teal) 28%, var(--paper));
  --cat-blue-soft: color-mix(in srgb, var(--cat-blue) 28%, var(--paper));
  --cat-violet-soft: color-mix(in srgb, var(--cat-violet) 28%, var(--paper));
  --cat-pink-soft: color-mix(in srgb, var(--cat-pink) 28%, var(--paper));

  /* Палитра цветных значков типа (PAL из mockup/app.js:14). G → g2, N → n2. */
  --pi-k: #3b2616; --pi-w: #fff4d6; --pi-y: #f2c14e; --pi-g: #3f7a3a; --pi-g2: #86c84e; --pi-b: #7fb2e0;
  --pi-r: #d2603a; --pi-n: #8a5a30; --pi-n2: #c08a4e; --pi-s: #b9b3a6; --pi-d: #2b2f3a;
}
```

`--chart-*` не переопределяются. Цвета земли сцены (`SCENES` в `mockup/app.js:625`) и `--soil*` в этап 1 не входят
(фон графа — этапы 5–6); `--label*`, `--rope*` заведены сразу, чтобы палитра сцены лежала в одном месте.
(уточнено при сверке) В мокапе `--label` / `--label-edge` — цвет табличек грядок. Грядок в приложении нет: на этапе 5
эти два токена используются для подписей нод поверх фона сцены (текст и его контур); `--rope*` — цвета связей.
До этапа 5 в коде на них никто не ссылается.

### 2.2 Соответствие токенов shadcn (для справки)

| Токен shadcn / проекта | Переменная сцены | Где виден |
|---|---|---|
| `--background`, `--popover`, `--sidebar` | `--paper` | плоскость окна, меню, боковая панель |
| `--card`, `--muted`, `--secondary`, `--accent`, `--surface`, `--sidebar-accent` | `--paper-2` | карточка, наведение, активный пункт, поле поиска |
| `--foreground`, `--*-foreground` (кроме primary/brand), `--primary`, `--sidebar-primary` | `--ink` | текст; тёмная кнопка |
| `--primary-foreground`, `--sidebar-primary-foreground` | `--paper` | текст на тёмной кнопке |
| `--muted-foreground` | `--ink-dim` | вторичный текст |
| `--border`, `--input`, `--sidebar-border` | `--paper-line` | волосяные линии, фон выключенного переключателя |
| `--ring`, `--sidebar-ring` | `--brand` | цвет фокуса |
| `--destructive` | `--danger` | удаление, ошибки |
| `--brand`, `--brand-foreground` | заданы сценой напрямую | главное действие |
| `--brand-soft` | смесь brand 22 % + paper | отмеченная строка |
| `--radius` | `0px` | — |
| рамки контролов и панелей | `--wood-dark` (через `pixel.css`, не через токен shadcn) | — |

### 2.3 Контраст (WCAG, относительная яркость; посчитано скриптом)

| Сцена | ink / paper | ink / paper-2 | ink-dim / paper-2 | brand-fg / brand | danger / paper-2 |
|---|---|---|---|---|---|
| Луг день | 9.84 | 8.50 | 4.56 (мокап 3.37) | 3.49 | 4.92 |
| Луг ночь | 10.98 | 12.31 | 5.76 | 5.80 | 6.96 |
| Осень день | 9.46 | 7.91 | 4.51 (мокап 3.14) | 4.56 | 4.58 |
| Осень ночь | 11.37 | 12.58 | 5.89 | 5.80 | 7.11 |
| Бумага день | 10.79 | 9.43 | 4.51 (мокап 3.50) | 3.49 | 5.36 |
| Бумага ночь | 11.25 | 12.51 | 5.86 | 5.80 | 7.08 |
| Зима день | 10.24 | 9.06 | 4.54 (мокап 3.35) | 3.49 | 5.54 |
| Зима ночь | 10.47 | 11.71 | 5.48 | 5.80 | 6.62 |

- `--gold-ink` на `--gold`: 7.30 (день) / 8.18 (ночь). Текст на «сильной» кнопке (`--paper` на `--ink`) = столбец 1.
- brand-fg на brand днём 3.49 (Луг, Бумага, Зима) — ниже 4.5, но равно нынешней «Классике» (~3.4); оставлено как в
  мокапе. Допустимо только для подписи главной кнопки (≥ 14px, насыщенность ≥ 700) и значков.
- `--brand` как текст на бумаге — 3.1–3.9 днём: не использовать (правило в DESIGN.md §3).
- `--leaf`, `--cat-*`, `--paper-line` на бумаге — 1.7–3.9: только заливки и линии, не текст.
- Ночью `--wood-dark` темнее бумаги (1.3–1.4): рамки читаются как тёмный контур — так в мокапе, не «исправлять».

## 3. Структура CSS

```
src/index.css            импорты, варианты, @theme, токены «Классики» (:root/.dark — без изменений значений), @layer base
src/styles/fonts.css     подключение шрифтов, --font-body/--font-head, веса и размеры по классам ft-*
src/styles/scenes.css    §2.1
src/styles/pixel.css     общие правила .pixel, правила по data-slot, sonner, примитивы px-*
```

### 3.1 Правки `src/index.css`

1. Импорты (все `@import` — первыми, в этом порядке):
```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "./styles/fonts.css";
@import "./styles/scenes.css";
@import "./styles/pixel.css";
```
   Строка `@import "@fontsource-variable/geist";` переезжает в `fonts.css`.
2. После `@custom-variant dark …` добавить: `@custom-variant pixel (&:is(.pixel *));`
3. В `@theme inline` заменить две строки и добавить цвета:
```css
    --font-heading: var(--font-head);
    --font-sans: var(--font-body);
    --color-wood-dark: var(--wood-dark);   --color-wood: var(--wood);
    --color-wood-hi: var(--wood-hi);       --color-wood-lo: var(--wood-lo);
    --color-paper: var(--paper);           --color-paper-2: var(--paper-2);     --color-paper-line: var(--paper-line);
    --color-ink: var(--ink);               --color-ink-dim: var(--ink-dim);     --color-ink-faint: var(--ink-faint);
    --color-gold: var(--gold);             --color-gold-ink: var(--gold-ink);
    --color-leaf: var(--leaf);             --color-danger: var(--danger);
    --color-brand-hi: var(--brand-hi);     --color-brand-lo: var(--brand-lo);
```
4. Новый блок сразу после `@theme inline { … }` (без `--line-height`: `text-[13px]` его не задавал — «Классика» не сдвинется):
```css
@theme static {
    --text-2xs: 11px;
    --text-2sm: 13px;
    --text-md: 15px;
}
```
5. В `:root` (после `--cat-*`) — запасные значения пиксельных токенов для «Классики», чтобы утилита без `pixel:` не
   давала пустоту; `.dark` не трогать (ссылки пересчитываются сами):
```css
    --font-body: 'Geist Variable', ui-sans-serif, system-ui, sans-serif;
    --font-head: var(--font-body);
    --paper: var(--background);  --paper-2: var(--muted);  --paper-line: var(--border);
    --ink: var(--foreground);    --ink-dim: var(--muted-foreground);  --ink-faint: var(--muted-foreground);
    --wood-dark: var(--border);  --wood: var(--border);  --wood-hi: var(--border);  --wood-lo: var(--border);
    --gold: var(--cat-amber);    --gold-ink: var(--foreground);  --gold-lo: var(--cat-amber);
    --leaf: var(--cat-green);    --danger: var(--destructive);
    --brand-hi: color-mix(in oklch, var(--brand), white 22%);
    --brand-lo: color-mix(in oklch, var(--brand), black 22%);
    --shadow: rgb(0 0 0 / .12);  --scrim: rgb(0 0 0 / .2);
    --cat-none: var(--muted-foreground);
```
6. `@layer base`, медиа-правила и значения токенов `:root`/`.dark` — без изменений.

### 3.2 Файл `src/styles/fonts.css` (новый, целиком)

```css
@import "@fontsource-variable/geist";
@import "@fontsource-variable/nunito/wght.css";
@import "@fontsource-variable/handjet/wght.css";
@import "@fontsource/tiny5/latin-400.css";
@import "@fontsource/tiny5/cyrillic-400.css";

/* Шрифт текста действует только в пиксельных сценах. По умолчанию — «Округлый» (Nunito). */
:root.pixel {
  --font-body: 'Nunito Variable', ui-sans-serif, system-ui, sans-serif;
  --font-head: 'Tiny5', ui-monospace, monospace;
  --fw: 600; --fw-m: 700; --fw-b: 800; --fw-head: 400;
  --font-weight-normal: var(--fw);  --font-weight-medium: var(--fw-m);
  --font-weight-semibold: var(--fw-b);  --font-weight-bold: var(--fw-b);
  --text-2sm: 14px;
}
:root.pixel.ft-plain {
  --font-body: 'Geist Variable', ui-sans-serif, system-ui, sans-serif;
  --fw: 450; --fw-m: 550; --fw-b: 650;
}
/* Handjet узкий: крупнее, жирнее и с разрядкой (значения мокапа) */
:root.pixel.ft-soft {
  --font-body: 'Handjet Variable', 'Tiny5', ui-monospace, monospace;
  --font-head: 'Handjet Variable', 'Tiny5', ui-monospace, monospace;
  --fw: 600; --fw-m: 600; --fw-b: 700; --fw-head: 700;
  --text-2xs: 15px; --text-xs: 15px; --text-2sm: 17px; --text-sm: 17px; --text-md: 18px; --text-base: 18px;
  --text-lg: 22px; --text-xl: 22px; --text-2xl: 26px; --text-3xl: 30px;
  --text-xs--line-height: 1.25; --text-sm--line-height: 1.25; --text-base--line-height: 1.25;
  --text-lg--line-height: 1.2; --text-xl--line-height: 1.2; --text-2xl--line-height: 1.1; --text-3xl--line-height: 1.1;
}
/* Tiny5 чёткий только на 8/16/24/32px и только в одном весе */
:root.pixel.ft-pixel {
  --font-body: 'Tiny5', ui-monospace, monospace;
  --fw: 400; --fw-m: 400; --fw-b: 400;
  --text-2xs: 16px; --text-xs: 16px; --text-2sm: 16px; --text-sm: 16px; --text-md: 16px; --text-base: 16px;
  --text-lg: 24px; --text-xl: 24px; --text-2xl: 24px; --text-3xl: 32px;
  --text-xs--line-height: 1.25; --text-sm--line-height: 1.25; --text-base--line-height: 1.25;
  --text-lg--line-height: 1.17; --text-xl--line-height: 1.17; --text-2xl--line-height: 1.17; --text-3xl--line-height: 1.125;
}
```

Сводка размеров (px):

| Токен | «Классика» | pixel + round / plain | ft-soft | ft-pixel |
|---|---|---|---|---|
| `text-2xs` | 11 | 11 | 15 | 16 |
| `text-xs` | 12 | 12 | 15 | 16 |
| `text-2sm` | 13 | 14 | 17 | 16 |
| `text-sm` | 14 | 14 | 17 | 16 |
| `text-md` | 15 | 15 | 18 | 16 |
| `text-base` | 16 | 16 | 18 | 16 |
| `text-lg` (заголовок записи) | 18 | 18 | 22 | 24 |
| `text-2xl` (заголовок раздела) | 24 | 24 | 26 | 24 |

Веса (`font-normal / medium / semibold`): Классика 400/500/600 · round 600/700/800 · plain 450/550/650 · soft 600/600/700 · pixel 400.

### 3.3 Шрифты: пакеты и CSP

| Пакет | Версия (npm view) | Семейство в CSS | Кириллица | Что импортируется |
|---|---|---|---|---|
| `@fontsource-variable/geist` | 5.3.0 (уже есть) | `'Geist Variable'` | да | как сейчас |
| `@fontsource-variable/nunito` | 5.3.0 | `'Nunito Variable'` | cyrillic, cyrillic-ext | `wght.css` (ось wght 200–1000, прямое начертание) |
| `@fontsource-variable/handjet` | 5.3.1 | `'Handjet Variable'` | cyrillic, cyrillic-ext | `wght.css` (только ось wght 100–900; ELGR/ELSH не нужны) |
| `@fontsource/tiny5` | 5.3.0 | `'Tiny5'` | cyrillic, cyrillic-ext | `latin-400.css`, `cyrillic-400.css` (один вес 400) |

Подмножества проверены по `metadata.json` пакетов. Все лицензии OFL-1.1.
CSP **не меняется**: Vite кладёт woff2 в `assets/` того же origin, а `font-src 'self' data:` уже есть и в
`vite.config.ts` (`WEB_CSP`), и в `src-tauri/tauri.conf.json`. `globPatterns` workbox уже включает `woff2`.
Прирост сборки ≈ 250 КБ woff2 (браузер грузит только нужные подмножества по `unicode-range`).

### 3.4 Файл `src/styles/pixel.css` (новый, целиком)

Порядок блоков важен (поздние побеждают ранние при равной специфичности): общие → фокус → `data-slot` → sonner → примитивы.

```css
/* Пиксельные сцены. Всё под .pixel и вне @layer: сильнее утилит Tailwind. В «Классике» файл не действует. */

/* ───────── 1. Общие правила ───────── */
:root.pixel {
  --px-hi: rgb(255 255 255 / .35);   /* светлая грань скоса */
  --px-lo: var(--paper-line);        /* тёмная грань скоса */
  --px-corners: polygon(0 4px, 2px 4px, 2px 2px, 4px 2px, 4px 0, calc(100% - 4px) 0, calc(100% - 4px) 2px,
    calc(100% - 2px) 2px, calc(100% - 2px) 4px, 100% 4px, 100% calc(100% - 4px), calc(100% - 2px) calc(100% - 4px),
    calc(100% - 2px) calc(100% - 2px), calc(100% - 4px) calc(100% - 2px), calc(100% - 4px) 100%, 4px 100%,
    4px calc(100% - 2px), 2px calc(100% - 2px), 2px calc(100% - 4px), 0 calc(100% - 4px));
  --default-transition-duration: 0ms;
  --default-transition-timing-function: steps(3, end);
  scrollbar-color: var(--paper-line) transparent;
}
.pixel *, .pixel *::before, .pixel *::after {
  border-radius: 0;
  --tw-shadow: 0 0 #0000; --tw-inset-shadow: 0 0 #0000;
  --tw-ring-shadow: 0 0 #0000; --tw-inset-ring-shadow: 0 0 #0000; --tw-ring-offset-shadow: 0 0 #0000;
  --tw-enter-scale: 1; --tw-exit-scale: 1;
}
.pixel body { font-weight: var(--fw); }
.pixel:not(.ft-plain) body { font-feature-settings: normal; }
.pixel.ft-soft body { letter-spacing: .07em; line-height: 1.25; }
.pixel.ft-pixel body { line-height: 1.25; -webkit-font-smoothing: none; font-smooth: never; font-synthesis: none; }
.pixel .font-heading { font-weight: var(--fw-head); letter-spacing: 0; font-synthesis: none; }
.pixel .font-mono { letter-spacing: 0; }
.pixel .px-icon.animate-spin { animation-timing-function: steps(4, end); animation-duration: .6s; }

/* ───────── 2. Фокус: обводка brand вместо колец ───────── */
.pixel :is(a, button, input, textarea, select, summary, [role="button"], [role="radio"], [role="switch"],
    [role="checkbox"], [role="tab"], [role="listitem"], [tabindex="0"]):focus-visible {
  outline: 2px solid var(--brand); outline-offset: 2px;
}

/* ───────── 3. Компоненты shadcn по data-slot ───────── */
/* button: вариант определяется по классу фона (см. §1.3) */
.pixel [data-slot="button"] { border-width: 2px; font-size: var(--text-2sm); }
.pixel [data-slot="button"]:active:not([aria-haspopup]) { translate: 0 2px; }
.pixel [data-slot="button"]:is([class~="bg-primary"], [class~="bg-background"], [class~="bg-secondary"],
    [class~="bg-destructive/10"], [class~="bg-brand"], [aria-pressed="true"]) {
  border-color: var(--wood-dark);
  box-shadow: inset 2px 2px 0 var(--px-hi), inset -2px -2px 0 var(--px-lo);
}
.pixel [data-slot="button"]:is([class~="bg-primary"], [class~="bg-background"], [class~="bg-secondary"],
    [class~="bg-destructive/10"], [class~="bg-brand"]):hover { filter: brightness(1.06); }
.pixel [data-slot="button"]:is([class~="bg-background"], [class~="bg-secondary"], [class~="bg-destructive/10"]) {
  background-color: var(--paper-2);
}
.pixel [data-slot="button"][class~="bg-primary"] {
  background-color: var(--primary); --px-hi: rgb(255 255 255 / .22); --px-lo: rgb(0 0 0 / .3);
}
.pixel [data-slot="button"][class~="bg-brand"] {
  background-color: var(--brand); --px-hi: var(--brand-hi); --px-lo: var(--brand-lo);
}
.pixel [data-slot="button"][aria-pressed="true"] {
  background-color: var(--gold); color: var(--gold-ink); --px-hi: rgb(255 255 255 / .5); --px-lo: var(--gold-lo);
}

/* поля (кроме намеренно безрамочных). Между :is() и :not() пробела быть не должно — иначе это потомок */
.pixel :is([data-slot="input"], [data-slot="textarea"], [data-slot="select-trigger"], [data-slot="input-group"]):not([class~="border-0"], [class~="border-transparent"]) {
  background-color: var(--paper-2); border: 2px solid var(--wood-dark); box-shadow: inset 2px 2px 0 var(--paper-line);
}
.pixel [data-slot="input-group-control"]:focus-visible { outline: none; }
.pixel [data-slot="input-group"]:has([data-slot="input-group-control"]:focus-visible) {
  outline: 2px solid var(--brand); outline-offset: 2px;
}

/* switch: 40×22, бегунок 14×14 (мокап .tg) */
.pixel [data-slot="switch"] { width: 40px; height: 22px; background-color: var(--paper-line); border: 2px solid var(--wood-dark); }
.pixel [data-slot="switch"][data-checked] { background-color: var(--leaf); }
.pixel [data-slot="switch-thumb"] {
  width: 14px; height: 14px; background-color: var(--paper); border: 2px solid var(--wood-dark); translate: 2px 0;
}
.pixel [data-slot="switch-thumb"][data-checked] { translate: 20px 0; }

/* checkbox */
.pixel [data-slot="checkbox"] { border: 2px solid var(--wood-dark); background-color: var(--paper-2); }
.pixel [data-slot="checkbox"][data-checked] { background-color: var(--primary); color: var(--primary-foreground); }

/* затемнение под диалогом и листом */
.pixel :is([data-slot="dialog-overlay"], [data-slot="sheet-overlay"]) { background-color: var(--scrim); backdrop-filter: none; }

/* всплывающие поверхности: рама наружу, жёсткая тень, прямые углы (= .px-pop) */
.pixel :is([data-slot="dialog-content"], [data-slot="popover-content"], [data-slot="dropdown-menu-content"],
    [data-slot="dropdown-menu-sub-content"], [data-slot="select-content"]) {
  background-color: var(--paper); color: var(--ink); border: 2px solid var(--wood-lo);
  box-shadow: 0 0 0 2px var(--wood-hi), 0 0 0 4px var(--wood-dark), 4px 4px 0 4px var(--shadow);
  animation-timing-function: steps(3, end);
}
.pixel [data-slot="sheet-content"] {
  background-color: var(--paper); border: 0 solid var(--wood-dark); box-shadow: none;
  transition-duration: 160ms; transition-timing-function: steps(4, end);
}
.pixel [data-slot="sheet-content"][data-side="left"] { border-right-width: 2px; box-shadow: 4px 0 0 var(--shadow); }
.pixel [data-slot="sheet-content"][data-side="right"] { border-left-width: 2px; box-shadow: -4px 0 0 var(--shadow); }
.pixel [data-slot="sheet-content"][data-side="top"] { border-bottom-width: 2px; box-shadow: 0 4px 0 var(--shadow); }
.pixel [data-slot="sheet-content"][data-side="bottom"] { border-top-width: 2px; box-shadow: 0 -4px 0 var(--shadow); }

/* пункты меню, списка выбора и палитры: подсвеченный — как активный пункт навигации мокапа */
.pixel :is([data-slot="dropdown-menu-item"], [data-slot="dropdown-menu-checkbox-item"], [data-slot="dropdown-menu-radio-item"],
    [data-slot="dropdown-menu-sub-trigger"], [data-slot="select-item"]):is([data-highlighted], [data-popup-open]),
.pixel [data-slot="command-item"][data-selected="true"] {
  background-color: var(--paper-2);
  outline: 2px solid var(--wood-dark); outline-offset: -2px;
  box-shadow: inset -4px -4px 0 var(--paper-line);
}
.pixel :is([data-slot="dropdown-menu-separator"], [data-slot="select-separator"], [data-slot="command-separator"]) { height: 2px; }
.pixel [data-slot="separator"][data-orientation="horizontal"] { height: 2px; }
.pixel [data-slot="separator"][data-orientation="vertical"] { width: 2px; }

/* tabs: кнопки-сегменты, активная — золото */
.pixel [data-slot="tabs-list"] { background-color: transparent; padding: 0; gap: 4px; }
.pixel [data-slot="tabs-trigger"] {
  background-color: var(--paper-2); color: var(--ink); border: 2px solid var(--wood-dark);
  box-shadow: inset 2px 2px 0 var(--px-hi), inset -2px -2px 0 var(--px-lo);
}
.pixel [data-slot="tabs-trigger"]:is([data-active], [aria-selected="true"]) {
  background-color: var(--gold); color: var(--gold-ink); --px-hi: rgb(255 255 255 / .5); --px-lo: var(--gold-lo);
}
.pixel [data-slot="tabs-trigger"]::after { content: none; }

/* tooltip: чернильная плашка, без стрелки */
.pixel [data-slot="tooltip-content"] {
  background-color: var(--ink); color: var(--paper); box-shadow: 2px 2px 0 var(--shadow); animation-timing-function: steps(3, end);
}
.pixel [data-slot="tooltip-content"] > [class*="rotate-45"] { display: none; }

/* kbd (и ui/kbd, и «сырые» <kbd> в компонентах) */
.pixel kbd { background-color: var(--paper-line); color: var(--ink); border-color: transparent; font-family: inherit; font-size: var(--text-2xs); opacity: 1; }
.pixel :is([data-slot="button"][class~="bg-brand"], .px-btn-brand) kbd { background-color: var(--brand-lo); color: var(--brand-foreground); }

/* прочее */
.pixel [data-slot="badge"] { background-color: var(--paper-2); color: var(--ink); border: 2px solid var(--paper-line); }
.pixel [data-slot="scroll-area-thumb"] { background-color: var(--paper-line); }

/* ───────── 4. sonner ───────── */
.pixel [data-sonner-toast][data-styled="true"] {
  background: var(--paper); color: var(--ink); border: 2px solid var(--wood-lo); border-radius: 0;
  box-shadow: 0 0 0 2px var(--wood-hi), 0 0 0 4px var(--wood-dark), 4px 4px 0 4px var(--shadow);
  font-family: var(--font-body); font-size: var(--text-sm); font-weight: var(--fw);
}
.pixel [data-sonner-toast][data-styled="true"] [data-description] { color: var(--ink-dim); }
.pixel [data-sonner-toast][data-styled="true"] :is([data-button], [data-close-button]) {
  background: var(--paper-2); color: var(--ink); border: 2px solid var(--wood-dark); border-radius: 0;
  box-shadow: inset 2px 2px 0 var(--px-hi), inset -2px -2px 0 var(--px-lo); font-weight: var(--fw-m);
}

/* ───────── 5. Примитивы px-* ───────── */
.pixel .px-panel {
  background: var(--paper); color: var(--ink); border: 2px solid var(--wood-dark);
  box-shadow: inset 0 0 0 2px var(--wood-hi), inset 0 0 0 6px var(--wood), inset 0 0 0 8px var(--wood-lo);
  padding: var(--px-pad, 14px); clip-path: var(--px-corners);
}
.pixel .px-panel-thin {
  background: var(--paper); color: var(--ink); border: 2px solid var(--wood-dark);
  box-shadow: inset 0 0 0 2px var(--wood-hi), inset 0 0 0 4px var(--wood-lo);
  padding: var(--px-pad, 10px); clip-path: var(--px-corners);
}
.pixel .px-pop {
  background: var(--paper); color: var(--ink); border: 2px solid var(--wood-lo);
  box-shadow: 0 0 0 2px var(--wood-hi), 0 0 0 4px var(--wood-dark), 4px 4px 0 4px var(--shadow);
}

.pixel .px-btn {
  background: var(--paper-2); color: var(--ink); border: 2px solid var(--wood-dark);
  box-shadow: inset 2px 2px 0 var(--px-hi), inset -2px -2px 0 var(--px-lo);
}
.pixel .px-btn:hover { filter: brightness(1.06); }
.pixel .px-btn:active { translate: 0 2px; box-shadow: inset 2px 2px 0 var(--px-lo); }
.pixel .px-btn:is(:disabled, [aria-disabled="true"]) { opacity: .5; filter: none; translate: none; }
.pixel .px-btn-brand { background: var(--brand); color: var(--brand-foreground); --px-hi: var(--brand-hi); --px-lo: var(--brand-lo); }
.pixel .px-btn:is([aria-pressed="true"], [aria-checked="true"], [data-on="true"]) {
  background: var(--gold); color: var(--gold-ink); --px-hi: rgb(255 255 255 / .5); --px-lo: var(--gold-lo);
}
.pixel .px-btn-ghost { background: transparent; border-color: transparent; box-shadow: none; }
.pixel .px-btn-ghost:hover { background: var(--paper-2); border-color: var(--wood-dark); filter: none; }

.pixel .px-chip { background: var(--paper-2); color: var(--ink); border: 2px solid var(--paper-line); }
.pixel :is(button, a, [role="button"]).px-chip:hover { border-color: var(--wood-dark); }
.pixel .px-chip:is([aria-pressed="true"], [data-on="true"]) { background: var(--gold); color: var(--gold-ink); border-color: var(--wood-dark); }

.pixel .px-field { background: var(--paper-2); color: var(--ink); border: 2px solid var(--wood-dark); box-shadow: inset 2px 2px 0 var(--paper-line); }
.pixel .px-field::placeholder, .pixel .px-field ::placeholder { color: var(--ink-dim); }
.pixel .px-field:has(:focus-visible) { outline: 2px solid var(--brand); outline-offset: 2px; }
.pixel .px-field :focus-visible { outline: none; }

.pixel .px-toggle { position: relative; width: 40px; height: 22px; background: var(--paper-line); border: 2px solid var(--wood-dark); }
.pixel .px-toggle::after { content: ''; position: absolute; left: 2px; top: 2px; width: 14px; height: 14px; background: var(--paper); border: 2px solid var(--wood-dark); }
.pixel .px-toggle[aria-checked="true"] { background: var(--leaf); }
.pixel .px-toggle[aria-checked="true"]::after { left: 20px; }

.pixel .px-row { background: var(--paper-2); color: var(--ink); border: 2px solid var(--wood-dark); }
.pixel .px-row::before { content: none; }
.pixel .px-row:hover, .pixel .px-row[aria-current="true"] { background: var(--paper); }
.pixel .px-row[data-checked="true"] { background: var(--brand-soft); }
.pixel .px-row[data-cursor="true"] { background: var(--paper); outline: 2px solid var(--gold); outline-offset: 2px; }

.pixel .px-flag { background: var(--paper-line); }
.pixel .px-flag-l { border-right: 2px solid var(--wood-dark); }
.pixel .px-flag-r { border-left: 2px solid var(--wood-dark); }
.pixel .px-flag[data-flag="fav"] { background: var(--gold); }
.pixel .px-flag[data-flag="inbox"] { background: var(--brand); }
.pixel .px-flag[data-flag="library"] { background: var(--leaf); }
.pixel .px-flag[data-flag="archive"] { background: var(--ink-faint); }
.pixel .px-catbar { box-shadow: inset 0 4px 0 var(--c, var(--cat-none)); }

.pixel .px-nav { border: 2px solid transparent; color: var(--ink); }
.pixel .px-nav:hover { background: var(--paper-2); }
.pixel .px-nav:is([aria-current="page"], [aria-current="true"], [aria-selected="true"], [data-on="true"]) {
  background: var(--paper-2); border-color: var(--wood-dark); box-shadow: inset -2px -2px 0 var(--paper-line);
}

.pixel .px-sw { border: 2px solid var(--wood-dark); }
.pixel .px-count { background: var(--brand); color: var(--brand-foreground); }
.pixel .px-well { background: var(--paper-2); border: 2px solid var(--paper-line); }
.pixel .px-divider { border-top: 2px solid var(--paper-line); }
.pixel .px-scrim { background: var(--scrim); backdrop-filter: none; }
.pixel .px-shadow { box-shadow: 4px 4px 0 var(--shadow); }
.pixel .px-corners { clip-path: var(--px-corners); }
.pixel .px-sel { outline: 2px solid var(--gold); outline-offset: 2px; }
.pixel .px-pop-in { animation: px-pop-in .18s steps(3, end); }
@keyframes px-pop-in { from { transform: scale(.4); } }

/* ───────── 6. Телефон ───────── */
@media (max-width: 767px) {
  /* clip-path рамы обрезал бы лист на весь экран */
  .pixel .px-sheet { clip-path: none; }
}
```

Замечания к `pixel.css`:
- `prefers-reduced-motion` покрыт существующим правилом в `index.css` (`animation-duration: .01ms !important`).
- Простые `<input>` без `data-slot` (поиск в TopBar, новая категория в Sidebar и др.) в этапе 1 получают только
  цвета токенов; класс `px-field` им добавит этап 3.
- Проверить после сборки: в `dist/assets/*.css` есть `--text-2sm` в `:root` (иначе `@theme static` не сработал).

## 4. Иконки

### 4.1 Файлы (все новые, владелец — `icons`)

```
src/components/icons/
  names.ts          ICON_NAMES (as const), type IconName
  registry.ts       LUCIDE: Record<IconName, LucideIcon> — ЕДИНСТВЕННЫЙ импорт lucide-react в src/ после этапа 1
  compile.ts        чистые функции: карта → слои path; привязка размера к сетке
  usePixel.ts       подписка на класс pixel у <html>
  PixelIcon.tsx     SVG из квадратов
  Icon.tsx          выбор набора по сцене
  index.ts          export { Icon, PixelIcon, usePixel, ICON_NAMES }; export type { IconName }
  pixel/palette.ts  PALETTE
  pixel/type.ts     6 цветных значков типа 10×10 (+ sprout)
  pixel/ui.ts       служебные значки 8×8
  pixel/files.ts    значки файлов 8×8
  pixel/index.ts    PIXEL_ICONS: Record<IconName, PixelMap>
  icons.test.ts     проверки карт и compile
  gallery.html, gallery.tsx   страница-витрина только для dev (в сборку не попадает: точка входа одна — index.html)
```

### 4.2 API

```ts
// names.ts
export const ICON_NAMES = [/* §4.5 */] as const
export type IconName = (typeof ICON_NAMES)[number]

// compile.ts
/** Строки одинаковой длины; '.' — пусто; '#' — currentColor; буква — цвет из PALETTE. Сетка 8×8 или 10×10. */
export type PixelMap = readonly string[]
export interface CompiledIcon { grid: 8 | 10; layers: ReadonlyArray<{ fill: string; d: string }> }
export function compileIcon(map: PixelMap, palette: Readonly<Record<string, string>>): CompiledIcon
export function snapIconSize(grid: 8 | 10, size?: number): number

// usePixel.ts
export function usePixel(): boolean

// PixelIcon.tsx
export function PixelIcon(props: { name: IconName; size?: number; className?: string; 'aria-label'?: string }): JSX.Element

// Icon.tsx
export interface IconProps {
  name: IconName
  /** px. «Классика»: передаётся lucide только если задан (иначе размер, как сейчас, задаёт CSS). Пиксели: привязка к сетке, по умолчанию 16/20. */
  size?: number
  className?: string
  /** Только «Классика». По умолчанию 1.75. */
  strokeWidth?: number
  /** Есть — role="img" и подпись; нет — aria-hidden. */
  'aria-label'?: string
}
export const Icon: React.MemoExoticComponent<(props: IconProps) => JSX.Element>
```

(уточнено при сверке) `JSX.Element` в сигнатурах — условная запись. В проекте `@types/react` 19: глобального
пространства имён `JSX` нет, `React` как глобальное имя не импортируется. В коде — `import type { JSX, MemoExoticComponent } from 'react'`
либо не указывать тип возврата вовсе.

Поведение:
- `compileIcon`: для каждого символа ≠ `'.'` собирает горизонтальные отрезки в один `d` на цвет:
  `M{x} {y}h{w}v1h-{w}z`. Порядок слоёв — порядок первого появления цвета. Бросает `Error`, если строки разной
  длины, сетка не квадрат 8 или 10, либо символа нет в палитре.
- `snapIconSize(grid, size)`: `Math.max(2, Math.floor((size ?? 16) / grid)) * grid` → сетка 8: 16 (до 23), 24, 32, 40, 48;
  сетка 10: 20 (до 29), 30, 40, 50, 60.
- `PixelIcon`: `<svg className={cn('px-icon shrink-0', className)} viewBox="0 0 g g" shapeRendering="crispEdges"
  style={{ width: px, height: px }} focusable="false" …>` + по `<path d style={{ fill }}/>` на слой (`fill` через
  `style`, не атрибутом: в атрибуте `var()` ненадёжен). Скомпилированные значки кэшируются в `Map` на уровне модуля.
- `usePixel`: `useSyncExternalStore` поверх ОДНОГО общего `MutationObserver` на `document.documentElement`
  (`attributeFilter: ['class']`) и набора подписчиков; снимок — `classList.contains('pixel')`; серверный снимок — `false`.
  Контекст React не используется: значок работает и вне `ThemeProvider` (ErrorBoundary), и не зависит от `theme-core`.
- `Icon`: `usePixel() ? <PixelIcon …/> : <Lucide size={size} strokeWidth={strokeWidth ?? 1.75} className={className} …/>`,
  где `Lucide = LUCIDE[name]`. Без `aria-label` — `aria-hidden`. Обёрнут в `memo`.
- `PALETTE` (`pixel/palette.ts`), с запасными значениями — значки не зависят от `scenes.css`:
  `'#': 'currentColor'`, `k: 'var(--pi-k, #3b2616)'`, `w: 'var(--pi-w, #fff4d6)'`, `y: 'var(--pi-y, #f2c14e)'`,
  `g: 'var(--pi-g, #3f7a3a)'`, `G: 'var(--pi-g2, #86c84e)'`, `b: 'var(--pi-b, #7fb2e0)'`, `r: 'var(--pi-r, #d2603a)'`,
  `n: 'var(--pi-n, #8a5a30)'`, `N: 'var(--pi-n2, #c08a4e)'`, `s: 'var(--pi-s, #b9b3a6)'`, `d: 'var(--pi-d, #2b2f3a)'`.

### 4.3 Требования к рисунку

- Служебные — 8×8, один цвет (`#`), рассчитаны на 16px (клетка 2px) и 24px. Значки типа — 10×10 цветные, на 20 и 30px.
- Образец плотности и манеры — 12 значков `UI_IC` мокапа: линия 1 клетка, сплошные формы допустимы, поле используется
  целиком (без обязательных полей), диагонали — ступенькой 1×1. Заполнено 16–40 клеток из 64.
- `check` и `x` вписываются в центральные 6×6 (поле 1 клетка): они стоят внутри чекбокса 16px с рамкой 2px.
- `loader` — незамкнутое кольцо (три четверти): вращается шагами по 90°, рисунок обязан отличаться при повороте.
- Пары, которые обязаны различаться с первого взгляда на 16px: archive / archive-restore, star / star-off,
  eye / eye-off, search / search-x, download / upload, chevron-* / arrow-*, copy / file, link / paperclip,
  tag / bookmark, circle-check / info / error / alert, grid / list / menu, значки file-* между собой
  (общая основа: лист 6×8 с загнутым углом, знак вида внутри).
- Чужую графику не копировать (lucide — только как смысловой ориентир).
- Проверка глазами: `npm run dev` → `http://localhost:5173/src/components/icons/gallery.html` — все значки в 16/24/32
  (служебные) и 20/30/40 (типа) на `--paper-2` дня и ночи «Осени», рядом вариант lucide и имя.

### 4.4 Тест `icons.test.ts` (окружение node, без DOM)

- каждое имя из `ICON_NAMES` есть в `PIXEL_ICONS` и в `LUCIDE`; лишних ключей нет;
- каждая карта: квадрат 8 или 10, символы из `PALETTE`, не пустая; `type-*` и `sprout` — 10×10, остальные — 8×8 и только `.`/`#`;
- `compileIcon` на эталонной карте даёт ожидаемый `d`; ошибки на кривых картах;
- `snapIconSize`: (8, undefined)=16, (8, 13)=16, (8, 20)=16, (8, 24)=24, (10, undefined)=20, (10, 16)=20, (10, 30)=30, (10, 64)=60;
- разные имена имеют разные карты; исключения — три объявленных псевдонима: `sprout` (= `type-idea`),
  `book-marked` (= `library`), `folder-open` (= `folder`).

### 4.5 Реестр: имя `Icon` ← lucide ← источник рисунка

Значки типа (10×10, цветные) — перенести дословно из `mockup/app.js:30–37` (`TYPE_IC`):

| IconName | lucide | Пиксели |
|---|---|---|
| `type-text` | AlignLeft | `TYPE_IC.text` |
| `type-link` | Link2 | `TYPE_IC.link` |
| `type-code` | Code2 | `TYPE_IC.code` |
| `type-idea` | Lightbulb | `TYPE_IC.idea` |
| `type-file` | Paperclip | `TYPE_IC.file` |
| `type-image` | Image | `TYPE_IC.image` |
| `sprout` | Sprout | та же карта, что `type-idea` (логотип и пустые состояния — этап 3) |

Служебные из мокапа (8×8) — дословно из `mockup/app.js:40–51` (`UI_IC`):

| IconName | lucide | `UI_IC` |
|---|---|---|
| `inbox` | Inbox (= InboxIcon) | inbox |
| `library` | Library | book |
| `star` | Star | star |
| `graph` | Waypoints | graph (пункт «Граф» — этап 5) |
| `sun` | Sun | sun |
| `moon` | Moon | moon |
| `settings` | Settings | gear |
| `search` | Search (= SearchIcon) | search |
| `archive` | Archive | archive |
| `trash` | Trash2 | trash |
| `menu` | Menu | menu |
| `plus` | Plus | plus |

Нарисовать (8×8), 48 шт.:

| IconName | lucide | | IconName | lucide |
|---|---|---|---|---|
| `archive-restore` | ArchiveRestore | | `file-text` | FileText |
| `arrow-down` | ArrowDown | | `file-video` | FileVideo |
| `arrow-up` | ArrowUp | | `folder` | Folder |
| `arrow-left` | ArrowLeft | | `globe` | Globe |
| `arrow-right` | ArrowRight | | `hash` | Hash |
| `calendar` | CalendarDays | | `info` | Info (= InfoIcon) |
| `check` | Check (= CheckIcon) | | `grid` | LayoutGrid |
| `chevron-down` | ChevronDown (= ChevronDownIcon) | | `link` | Link2 (вне TypeIcon) |
| `chevron-right` | ChevronRight (= ChevronRightIcon) | | `list` | List |
| `chevron-up` | ChevronUp (= ChevronUpIcon) | | `loader` | Loader2 (= Loader2Icon) |
| `chevrons-up-down` | ChevronsUpDown | | `monitor` | Monitor |
| `circle-check` | CircleCheck (= CircleCheckIcon) | | `more` | MoreHorizontal |
| `copy` | Copy | | `error` | OctagonX (= OctagonXIcon) |
| `download` | Download | | `paperclip` | Paperclip (вне TypeIcon) |
| `upload` | Upload | | `pencil` | Pencil |
| `external-link` | ExternalLink | | `refresh` | RefreshCw |
| `eye` | Eye | | `search-x` | SearchX |
| `eye-off` | EyeOff | | `shield-check` | ShieldCheck |
| `file` | File | | `sparkles` | Sparkles |
| `file-archive` | FileArchive | | `star-off` | StarOff |
| `file-audio` | FileAudio | | `tag` | Tag |
| `file-code` | FileCode | | `alert` | TriangleAlert (= TriangleAlertIcon) |
| `file-image` | FileImage | | `x` | X (= XIcon) |
| `file-spreadsheet` | FileSpreadsheet | | `zap` | Zap |

Псевдонимы (своя запись в `LUCIDE`, общая карта пикселей): `book-marked` ← BookMarked, карта `library`;
`folder-open` ← FolderOpen, карта `folder`.

Задел для этапов 4–7 (нарисовать сейчас, чтобы позже не делить файлы реестра), 10 шт.: `minus` ← Minus,
`undo` ← Undo2, `bookmark` ← Bookmark, `clock` ← Clock, `maximize` ← Maximize, `scan-text` ← ScanText,
`filter` ← Funnel, `unlink` ← Unlink, `layout` ← LayoutDashboard, `code` ← Code2 (одноцветный, 8×8).

Итого 79 имён: 7 цветных (6 карт) + 12 из мокапа + 48 + 2 псевдонима + 10. Все перечисленные экспорты lucide
проверены в установленной `lucide-react@1.71.0`.

### 4.6 Где сейчас используется lucide (для `icons-migrate`)

41 файл с импортом из `lucide-react` (73 имени, считая дубли вида `Check`/`CheckIcon`; тип `LucideIcon` — в 7 файлах)
и `items/EmptyState.tsx`, который принимает компонент значка пропом. Пути в таблице — от `src/components/`
(`views/…` — от `src/`).

| lucide | Файлы |
|---|---|
| AlignLeft, Code2, Image, Lightbulb | components/items/TypeIcon |
| Archive | items/BulkBar, ItemCard, ItemMenu, TriageMode; layout/Sidebar; palette/CommandPalette; views/ArchiveView |
| ArchiveRestore | items/BulkBar, ItemCard, ItemMenu |
| ArrowDown, ArrowUp | views/settings/CategoriesSection |
| ArrowLeft | items/ItemDetail, TriageMode |
| ArrowRight | items/TriageMode |
| BookMarked | items/BulkBar, ItemMenu, TriageMode |
| CalendarDays, LayoutGrid, List | items/FilterBar |
| Check | items/CategorySelect, FilterBar, ItemCard; views/settings/TagsSection |
| CheckIcon | ui/checkbox, command, dropdown-menu, select |
| ChevronDown | items/ItemDetail; layout/Sidebar |
| ChevronRight | layout/Sidebar |
| ChevronDownIcon, ChevronUpIcon | ui/select |
| ChevronRightIcon | ui/dropdown-menu |
| ChevronsUpDown | items/CategorySelect |
| CircleCheck | items/TriageMode |
| CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon | ui/sonner |
| Copy | items/CodeView, ItemMenu, detail/LinkCard |
| Download | items/FilePreview, ItemMenu, detail/FileBlock; views/settings/DataSection |
| ExternalLink | items/FilePreview, ItemMenu, TriageMode, detail/LinkCard |
| Eye, EyeOff | views/settings/AiSection |
| File, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, FileVideo | items/FilePreview |
| Folder | items/FilterBar; palette/CommandPalette |
| FolderOpen | items/ItemList |
| Globe | items/detail/LinkCard |
| Hash | palette/CommandPalette |
| Inbox | items/ItemMenu; layout/Sidebar; palette/CommandPalette |
| InboxIcon, Zap | views/InboxView |
| Library | layout/Sidebar; palette/CommandPalette; views/LibraryView |
| Link2 | items/ItemCard, TriageMode, TypeIcon, detail/LinkPicker |
| Loader2 | capture/QuickCapture; items/detail/AiSuggest; views/settings/AiSection |
| Menu | layout/TopBar |
| Monitor, Moon, Sun | layout/Sidebar; palette/CommandPalette; views/settings/AppearanceSection |
| MoreHorizontal, StarOff | items/ItemMenu |
| Paperclip | capture/QuickCapture; items/TypeIcon; views/InboxView |
| Pencil | items/detail/ContentEditor; views/settings/TagsSection |
| Plus | capture/QuickCapture; items/CategorySelect, detail/LinkedItems; layout/MobileNav, Sidebar; palette/CommandPalette; views/settings/CategoriesSection |
| RefreshCw | items/detail/LinkCard; views/settings/DataSection |
| Search | layout/TopBar; palette/CommandPalette; views/settings/TagsSection |
| SearchIcon | ui/command |
| SearchX | views/InboxView, ItemsView |
| Settings | layout/Sidebar; palette/CommandPalette |
| ShieldCheck | views/settings/DataSection |
| Sparkles | items/TriageMode, detail/AiSuggest |
| Star | capture/QuickCapture; items/ItemCard, ItemDetail, ItemMenu, TriageMode; layout/Sidebar; palette/CommandPalette; views/FavoritesView |
| Tag | items/BulkBar, FilterBar |
| Trash2 | items/BulkBar, ItemCard, ItemMenu, TriageMode; views/settings/CategoriesSection, DataSection, TagsSection |
| Upload | layout/AppShell; views/settings/DataSection |
| X | capture/QuickCapture; items/BulkBar, FilterBar, ItemDetail, TagChip, detail/LinkedItems; layout/TopBar; views/settings/TagsSection |
| XIcon | ui/dialog, sheet |
| `type LucideIcon` | items/FilePreview, FilterBar, ItemCard, ItemMenu, TriageMode, TypeIcon; palette/CommandPalette |

### 4.7 Правила замены (`icons-migrate`)

1. `<Foo className=… strokeWidth={1.75} aria-hidden />` → `<Icon name="foo" className=… />` (`strokeWidth={1.75}` и
   `aria-hidden` убрать — это умолчания). Другой `strokeWidth` — оставить пропом.
2. В `ui/*` у значков не было `strokeWidth` (lucide = 2) → передавать `strokeWidth={2}`: «Классика» не меняется.
   В `ui/*` правится только JSX значков и импорт; классы и разметка — нет.
3. `size={N}` у lucide переносится как есть. Если размер задан только классом: при `size-5` и больше добавить
   `size={20|24|…}` (чтобы пиксельный вариант тоже вырос); при `size-4` и меньше проп не нужен. Классы `size-*` не удалять.
4. Компонент значка в переменной/пропе (`icon: LucideIcon`, `const Icon = cond ? Moon : Sun`, `OPTIONS[].Icon`) →
   имя: `icon: IconName`, рендер `<Icon name={icon} />`. Локальную переменную `Icon` переименовать, чтобы не затенять импорт.
5. `TypeIcon`: сигнатура `TypeIcon({ type, className? })` сохраняется; внутри —
   `<Icon name={TYPE_ICON_NAME[type]} size={16} className={cn('shrink-0', className)} />`. Экспорт `TYPE_ICONS`
   заменить на `TYPE_ICON_NAME: Record<ItemType, IconName>` (`text → 'type-text'` …). Вне `TypeIcon` значки `Link2` и
   `Paperclip` — это `link` и `paperclip`.
6. `EmptyState`: `icon?: IconName | ReactNode`; строка → `<Icon name={icon} size={20} />`, элемент — как есть.
   Вызовы: `icon={SearchX}` → `icon="search-x"` и т.п.
7. Избранное: `fill-[var(--cat-amber)] text-[var(--cat-amber)]` → `fill-gold text-gold` (в «Классике» `--gold` = `--cat-amber`,
   вид тот же; в пиксельных сценах — золото).
8. Значок с `aria-label` — передать `aria-label` в `Icon`.
9. Логотип в `Sidebar` (встроенный SVG) не трогать — это этап 3.
10. Размеры шрифта (в тех же файлах, вне `ui/*`): `text-[11px]` → `text-2xs`, `text-[13px]` → `text-2sm`,
    `text-[15px]` → `text-md` (с любыми префиксами: `md:text-[13px]` → `md:text-2sm`). `text-[0.8rem]` в `ui/button`
    и `text-[11px]` в `ui/kbd` остаются: в пиксельных сценах их перекрывает `pixel.css`.

## 5. Сцена в React

### 5.1 `src/lib/scene.ts` (новый, чистый) + `scene.test.ts`

```ts
import type { FontPref, ScenePref } from '@/types'

export type Scene = Exclude<ScenePref, 'auto'>
// (уточнено при сверке) списки значений объявлены один раз — в src/types.ts (шаг 0 этапа 2); здесь только реэкспорт:
export { SCENE_PREFS, FONT_PREFS } from '@/types'
export const SCENE_LABEL: Record<ScenePref, string>   // Авто, Луг, Осень, Бумага, Зима, Классика
export const FONT_LABEL: Record<FontPref, string>     // Округлый, Строгий, Мягкий пиксель, Пиксельный
export function isScenePref(v: unknown): v is ScenePref
export function isFontPref(v: unknown): v is FontPref
/** Декабрь–февраль — winter, сентябрь–ноябрь — autumn, иначе meadow (по локальной дате). */
export function seasonScene(d?: Date): 'meadow' | 'autumn' | 'winter'
export function resolveScene(pref: ScenePref, d?: Date): Scene        // 'auto' → seasonScene(d)
export function isPixelScene(scene: Scene): boolean                   // всё, кроме 'classic'
/** Классы для <html>: ['sc-autumn', 'pixel', 'ft-round'] / ['sc-classic', 'ft-round']. */
export function sceneClasses(scene: Scene, font: FontPref): string[]
/** Цвет панели браузера/заголовка PWA: рама окна сцены. */
export const THEME_COLOR: Record<Scene, { light: string; dark: string }>
```

`THEME_COLOR`: classic `#FBFAF8` / `#1a1816` (как сейчас) · meadow `#4a2e1a` / `#14111d` · autumn `#4a2416` / `#170f18` ·
paper `#5a4630` / `#0f0f16` · winter `#3a3440` / `#0e1220` (= `--wood-dark` сцены).

Тесты: границы месяцев (30 ноя → autumn, 1 дек → winter, 28 фев → winter, 1 мар → meadow, 31 авг → meadow, 1 сен → autumn);
`resolveScene` для всех шести значений; охранные функции на мусоре (`'neon'`, `null`, `1`); `sceneClasses`.

### 5.2 `src/components/layout/ThemeProvider.tsx`

Сохраняются без изменений: `Theme`, `ResolvedTheme`, `useTheme()` и его значение, ключ `qd-theme`. Добавляется:

```ts
export interface SceneContextValue {
  scene: ScenePref          // выбор пользователя
  resolvedScene: Scene      // фактическая сцена
  pixel: boolean            // resolvedScene !== 'classic'
  font: FontPref
  ambient: boolean          // settings.ambient; пока настройки читаются — true
  setScene: (scene: ScenePref) => void
  setFont: (font: FontPref) => void
}
export function useScene(): SceneContextValue   // вне провайдера бросает, как useTheme
```

- Ключи localStorage: `qd-scene` (значение `ScenePref`, включая `auto`), `qd-font` (`FontPref`). Чтение через
  `isScenePref`/`isFontPref`, по умолчанию `auto` / `round`; запись в `try/catch`, как у темы.
- `applyToDocument(resolvedTheme, resolvedScene, font)`: `dark` и `colorScheme` — как сейчас; с `<html>` снимаются все
  классы `sc-*`, `ft-*` и `pixel`, ставятся `sceneClasses(...)`. Вызывается синхронно при загрузке модуля
  (как сейчас для темы) и в эффекте при изменении любого из трёх значений.
- Источник истины — настройки БД (как у `theme`): эффект в `ThemeSync` при изменении `settings.scene` / `settings.font`
  вызывает `setScene` / `setFont`, если значение валидно и отличается. `setScene`/`setFont` меняют состояние и localStorage;
  в БД пишет вызывающий (`setSetting`), см. §6.
- `auto`: дата берётся из состояния `now`, которое обновляется по `visibilitychange` (страница стала видимой) и `focus`
  окна — смена сезона подхватывается без перезапуска.
- `theme-color`: существующий эффект, значение — `THEME_COLOR[resolvedScene][resolvedTheme]`.
- `ui/sonner.tsx` продолжает брать `theme` из `useTheme()` — не трогать.

### 5.3 `public/theme-init.js` (заменить целиком)

```js
// Тема, сцена и шрифт до загрузки бандла: иначе холодный старт рисуется в чужом оформлении.
// Логика совпадает с src/lib/scene.ts и ThemeProvider (ключи qd-theme, qd-scene, qd-font).
// Отдельный файл, а не inline-скрипт: CSP веб-сборки и Tauri (script-src 'self') inline запрещает.
;(function () {
  function read(key) {
    try {
      return localStorage.getItem(key)
    } catch (e) {
      return null // хранилище недоступно (приватный режим) — значения по умолчанию
    }
  }
  var theme = read('qd-theme')
  var scene = read('qd-scene')
  var font = read('qd-font')
  var dark =
    theme === 'dark' ||
    (theme !== 'light' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
  if (['meadow', 'autumn', 'paper', 'winter', 'classic'].indexOf(scene) < 0) {
    var m = new Date().getMonth() // 'auto', пусто или мусор — по календарю
    scene = m === 11 || m < 2 ? 'winter' : m >= 8 ? 'autumn' : 'meadow'
  }
  if (['round', 'plain', 'soft', 'pixel'].indexOf(font) < 0) font = 'round'
  var root = document.documentElement
  root.classList.add('sc-' + scene, 'ft-' + font)
  if (scene !== 'classic') root.classList.add('pixel')
  if (dark) root.classList.add('dark')
  root.style.colorScheme = dark ? 'dark' : 'light'
})()
```

`index.html` не меняется.

## 6. Настройки

### 6.1 `src/types.ts`

**(уточнено при сверке)** Этот файл правит НЕ `theme-core`, а `data-contracts` (шаг 0 этапа 2,
`.progress/spec-stage2.md` §1.1) — там же готовый код. Ниже — то, что этап 1 от него получает; имена общие для обеих
спецификаций: списки `SCENE_PREFS`, `FONT_PREFS` (и `THEMES`) и типы `ScenePref`, `FontPref` объявлены в `types.ts`.

```ts
export const SCENE_PREFS = ['auto', 'meadow', 'autumn', 'paper', 'winter', 'classic'] as const
export type ScenePref = (typeof SCENE_PREFS)[number]
export const FONT_PREFS = ['round', 'plain', 'soft', 'pixel'] as const
export type FontPref = (typeof FONT_PREFS)[number]

// interface Settings (место полей — как в spec-stage2 §1.1):
  /** Сцена оформления. 'auto' — по времени года; 'classic' — прежний вид. */
  scene: ScenePref
  /** Шрифт текста в пиксельных сценах. */
  font: FontPref
  /** Живой фон графа (листопад, лучи, снег, бабочки, светлячки). */
  ambient: boolean

// DEFAULT_SETTINGS:
  scene: 'auto',
  font: 'round',
  ambient: true,
```

Миграция БД не нужна: отсутствующие ключи `meta` дают значения по умолчанию. У существующих установок оформление
сменится на пиксельное (сцена по календарю) — это ожидаемо; вернуться — «Классика» в настройках.
Резервная копия: `sanitizeSettings` перебирает ключи `DEFAULT_SETTINGS`, новые поля экспортируются и импортируются
сами; `src/lib/exportImport.ts` не трогать.

### 6.2 `src/db/settings.ts`

**(уточнено при сверке)** `theme-core` этот файл НЕ правит. Проверку перечислимых значений (иначе строка-мусор из
чужой копии станет «сценой») делает шаг 0 этапа 2: `mergeSettings` вызывает `isValidSetting(key, value)` из нового
`src/lib/settingsSchema.ts` (`.progress/spec-stage2.md` §1.5: `theme ∈ THEMES`, `scene ∈ SCENE_PREFS`,
`font ∈ FONT_PREFS`). Таблица `ENUM_VALUES` из первой редакции этого раздела отменена — она дублировала бы эту
проверку в том же файле. Сигнатуры `getSettings`, `setSetting`, `useSettings`, `setSettings` не меняются.

### 6.3 `src/views/settings/AppearanceSection.tsx` (минимум этапа 1)

Раздел «Оформление», четыре строки (вёрстка строк — как в `LinksSection.tsx`; сегменты — нынешняя разметка
`role="radiogroup"` с `radioGroupKeyDown`, вынесенная в локальный компонент `Segmented<T extends string>`):

| Строка | Контрол | Действие | Подсказка |
|---|---|---|---|
| Сцена | сегменты по `SCENE_PREFS`, подписи `SCENE_LABEL` | `setScene(v)` + `setSetting('scene', v)` | при `auto`: «По времени года: сейчас „Осень“» (из `resolvedScene`) |
| Тема | как сейчас (Системная / Светлая / Тёмная) | как сейчас | — |
| Шрифт текста | сегменты по `FONT_PREFS`, подписи `FONT_LABEL`; при `!pixel` — `aria-disabled`, не реагирует, `opacity-50` | `setFont(v)` + `setSetting('font', v)` | «Действует в пиксельных сценах. Логотип и заголовки разделов остаются пиксельными.» |
| Живой фон | `Switch` из `ui/switch` | `setSetting('ambient', v)` | «Листопад, лучи, снег, бабочки и светлячки на графе.» |

Ошибки записи — `toast.error(describeError(e))`, как сейчас. Сегменты должны переноситься на узком экране (`flex-wrap`).
Значки lucide в этом файле `theme-core` не трогает (их заменит `icons-migrate`). Пиксельный вид раздела — этап 3.

## 7. Исполнители и владение файлами

### 7.1 `theme-core` (волна 1)

Файлы (только эти):
`src/index.css` · `src/styles/fonts.css` · `src/styles/scenes.css` · `src/styles/pixel.css` · `src/lib/scene.ts` ·
`src/lib/scene.test.ts` · `src/components/layout/ThemeProvider.tsx` · `public/theme-init.js` ·
`src/views/settings/AppearanceSection.tsx` · `.progress/agents/theme-core.md`.

(уточнено при сверке) `src/types.ts` и `src/db/settings.ts` из списка убраны: их правит `data-contracts` (шаг 0
этапа 2). Предусловие старта: в `src/types.ts` уже есть `ScenePref`, `FontPref`, `SCENE_PREFS`, `FONT_PREFS` и поля
`Settings.scene / font / ambient`. Если их нет — остановиться со статусом «ошибка», самому не добавлять.

Готово, когда:
1. `npm run typecheck`, `npm test`, `npm run build` проходят; в `dist/assets` есть woff2 Nunito, Handjet, Tiny5.
2. «Классика» день и ночь попиксельно совпадает с состоянием до правок на экранах: входящие, база знаний (список и
   сетка), детали записи, быстрая запись, палитра, настройки, 375px. (Сверка скриншотами «до/после» при `qd-scene=classic`.)
3. В настройках переключаются шесть вариантов сцены, тема, четыре шрифта, «Живой фон»; выбор переживает перезагрузку
   и применяется до первого кадра (нет вспышки чужой сцены; проверить с очищенным кэшем модулей и при `qd-scene=winter`).
4. `document.documentElement.className` при каждом выборе: ровно один `sc-*`, ровно один `ft-*`, `pixel` ⇔ сцена не
   classic, `dark` ⇔ ночь. При `auto` в ноябре — `sc-autumn`.
5. В пиксельных сценах: нет ни одного скругления и мягкой тени; кнопки (default, outline, ghost, destructive, brand),
   поля, `Switch`, `Checkbox`, диалог, поповер, выпадающее меню, `Select`, палитра команд, подсказка и toast с кнопкой
   «Отменить» выглядят по §3.4 в «Осени» день/ночь; фокус с клавиатуры — обводка brand 2px.
6. `ft-soft` и `ft-pixel` меняют размер текста, набранного утилитами `text-xs/sm/base/lg` (места с `text-[13px]`
   подтянутся после `icons-migrate`); у Tiny5 нет синтетического полужирного.
7. Приложение работоспособно во всех сценах (вёрстка прежняя, допускаются сдвиги на 1–4px из-за рамок 2px).
8. Вне списка файлов ничего не изменено; git не тронут.

### 7.2 `icons` (волна 1)

Файлы: всё в `src/components/icons/**` (§4.1) · `.progress/agents/icons.md`. Больше ничего.

Готово, когда:
1. `npm run typecheck` и `npm test` проходят, включая `icons.test.ts` (§4.4).
2. В `ICON_NAMES` ровно 79 имён из §4.5; `LUCIDE` и `PIXEL_ICONS` полны (это проверяет и тип `Record<IconName, …>`).
3. 18 карт мокапа перенесены без изменений (сверка с `mockup/app.js:30–51`).
4. Витрина `gallery.html` открывается в dev; все значки просмотрены на 16 и 24px (типа — 20 и 30px), день и ночь,
   пары из §4.3 различимы; в отчёте перечислены значки, в которых исполнитель не уверен.
5. `Icon` в «Классике» отдаёт lucide с теми же `size`/`strokeWidth`/`className`, что сейчас пишутся вручную; при смене
   класса `pixel` на `<html>` (в консоли) все значки на странице переключаются без перезагрузки.
6. `lucide-react` импортируется только в `registry.ts` (внутри папки).

### 7.3 `icons-migrate` (волна 2, после приёмки 7.1 и 7.2)

Файлы: все `*.tsx` в `src/components/**` (кроме `src/components/icons/**`) и `src/views/**`, в части значков и размеров
шрифта (§4.7) · `.progress/agents/icons-migrate.md`. В `src/components/ui/*` — только значки. Логику, раскладку, цвета не менять.

Если делить на двоих (файлы не пересекаются):
- `migrate-shell`: `src/components/layout/**`, `capture/**`, `palette/**`, `ui/**`, `src/views/**`;
- `migrate-items`: `src/components/items/**` (включая `detail/`, `TypeIcon`, `EmptyState`).
  Общий контракт — п. 5 и 6 из §4.7; `typecheck` целиком сойдётся только после обоих, приёмку делает основная сессия.

Готово, когда:
1. `grep -rn "lucide-react" src` находит только `src/components/icons/registry.ts`.
2. `grep -rnE "text-\[(11|13|15)px\]" src` находит только `src/components/ui/kbd.tsx`.
3. `npm run typecheck`, `npm test`, `npm run build` проходят.
4. «Классика» день/ночь — без видимых отличий от состояния до миграции (те же экраны, что в 7.1 п. 2, плюс
   меню записи «…», разбор входящих, фильтры, массовые действия, все разделы настроек).
5. В «Осени» все значки пиксельные, включая значки внутри `ui/*` (галочки чекбокса и меню, крестик диалога, шевроны
   `Select`, значки toast); вращение индикатора загрузки — шагами.
6. Клавиатура и сценарии не сломаны: добавление (N, Ctrl+Enter), J/K/Enter/E/A/F/Del, Ctrl+K, Esc.

## 8. Риски и что проверить основной сессии

- **`src/types.ts` и `src/db/settings.ts` делят этапы 1 и 2** — решено (уточнено при сверке): оба файла правит только
  `data-contracts` (шаг 0 этапа 2), `theme-core` стартует после него (см. §0, §6.1, §6.2, §7.1).
- **Определение варианта кнопки по классу** (§1.3) зависит от строк в `ui/button.tsx`. Если файл обновят через
  `shadcn add`, сверить классы фона. Надёжнее — разрешить добавить в `button.tsx` `data-variant={variant}`
  (так сделано в новых версиях shadcn) и переписать шесть селекторов.
- **Диалоги без рамы-панели.** Быстрая запись и палитра в этапе 1 получают тонкую раму с прямыми углами. Ступенчатая
  рама, как в мокапе (`px-panel` + отступ 14px), — этап 3, вместе с перевёрсткой содержимого.
- **Цветные значки типа ночью**: контур `#3b2616` на тёмной бумаге держится за счёт светлой заливки (как в мокапе);
  если в витрине значок теряется — переопределить `--pi-k` в `:root.pixel.dark` (одна строка в `scenes.css`).
- **Tiny5 как шрифт текста** (`ft-pixel`): всё по 16px, строки заметно шире — возможны переполнения в плотных
  местах до этапа 3. Это необязательный шрифт; критерий этапа 1 — «не ломается», а не «красиво».
- **`@theme static`**: если установленная версия Tailwind не выпустит переменные (см. проверку в §3.4) — заменить
  блок на объявление тех же трёх переменных в `:root` и `@theme inline { --text-2xs: var(--fs-2xs) … }`.
