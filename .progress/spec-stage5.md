# Спецификация этапа 5: Граф

Дата: 2026-11-12. Автор: архитектор этапа (fable). Основание: `.progress/plan-combined.md` («Решения пользователя»,
«Изменение графа относительно мокапа», «Этап 5. Граф»), `docs/DESIGN.md`, `.progress/spec-stage3.md` §1.3 и §3,
`.progress/spec-stage2.md` §2.6, HANDOFF «Долги после ревью этапов 1–2» (два долга этапа 5). Истина — код.

Мокап (`mockup/app.js`, `style.css`) — образец общего вида, сдвига/масштаба и панели деталей. Грядки, нода-карточка
200×44, перетаскивание на грядку и «Без грядки» устарели и не переносятся.

Новых зависимостей нет: canvas 2D и свой код. Контракты `CLAUDE.md` не меняются, только добавления. Запись в БД —
через `db/repo.ts`, действия из интерфейса — через `lib/actions.ts`. Тексты — по-русски.

---

## 0. Решения

| № | Решение | Почему |
|---|---|---|
| Р1 | Масштаб — **ступенями**: `0.125, 0.25, 0.5, 0.75, 1, 1.5, 2`. Камера в сторе всегда на ступени | Шаг сетки 32 px × ступень × `devicePixelRatio` (кратен 0.25) — целое число: решётка нод ровная, рамки не «плывут». Плавный масштаб даёт зазоры 23/24/23 px и муар в плотной зоне |
| Р2 | Колесо — масштаб к курсору (Ctrl+колесо — то же, это щипок тачпада); Shift+колесо — сдвиг по горизонтали; сдвиг — перетаскивание фона или средней кнопкой; Shift+стрелки | Как в мокапе, Obsidian и картах; целевое устройство — мышь |
| Р3 | Нода: квадрат 16 px мира на сетке 32 px (`GRAPH_NODE_SIZE`, `GRAPH_CELL` — без изменений), целиком цвета категории. Пиксельные сцены: рамка 2 px `wood-dark` и жёсткая тень; «Классика»: только заливка | План; DESIGN §4 |
| Р4 | «Входящие» — квадратная метка 6 px в правом верхнем углу (brand с тёмной кромкой), видна от 50 % | План |
| Р5 | **Архив показывается приглушённо** (альфа 0.45), переключатель «Архив» в панели графа, по умолчанию включён; выбор хранится в `localStorage`. Архивные всегда участвуют в раскладке | Задание этапа; место ноды не зависит от переключателя. Меняет решение этапа 2 «архив не показывается» |
| Р6 | Подпись — DOM-слоем справа от ноды при масштабе ≥ 100 %, только там, где она не закрывает другие ноды и подписи; не больше 150. У выбранной ноды и её соседей — всегда, на плашке. Ниже 100 % — только подсказка при наведении | В плотной решётке 32 px подпись неизбежно закрывает соседей; подсказка и плашки дают заголовок там, где он нужен |
| Р7 | Связи: в пиксельных сценах — линия Брезенхэма толщиной в «пиксель» сцены (`max(1, round(2·zoom·dpr))` px устройства), между зонами — пунктир; «горячие» (у выбранной/наведённой ноды, выбранная связь) — золото с тёмной кромкой. Рисуются в буфер `ImageData`. В «Классике» — обычные линии `stroke` | Резкие пиксели без сглаживания; 3000 связей на минимальном масштабе — это ~10⁵ точек: `fillRect` по одной слишком медленно, запись в буфер — ~1 мс |
| Р8 | Раскладка: к алгоритму этапа 2 добавлены **ров** (новая нода не встаёт ближе 2 клеток к ноде чужой зоны), **разведение коллизий** сохранённых нод и проверка центра новой зоны по фактическим нодам. См. §2.2 | Закрывает оба долга этапа 5 |
| Р9 | «Разложить» — без вопроса: `clearPositions()` → toast «Граф разложен заново» с «Отменить» на 10 с | Ручные и автоматические положения в БД не различаются (решение этапа 2), спросить «есть ли ручные» нельзя; отмена дешевле вопроса и принята во всём приложении |
| Р10 | Клик по ноде — выбрать и открыть детали (`useUi.select`). Двойной клик — приблизить к ноде (центр, масштаб не меньше 100 %); двойной клик по фону — шаг масштаба в точку. Enter/Пробел — открыть ноду под курсором клавиатуры | Одиночный клик уже открывает запись; открывать ссылку двойным кликом опасно |
| Р11 | Связь создаётся тремя способами: (а) **ручка** у выбранной ноды — потянуть к другой ноде; (б) Shift+перетаскивание от любой ноды; (в) режим связи: клавиша `L` или клик по ручке, затем клик/Enter по второй ноде. Снятие: клик по связи → плашка «Убрать связь», `Del`; либо панель деталей | Ручка обнаруживаема, Shift быстрее, режим работает с клавиатуры и пальцем |
| Р12 | Категория: панель деталей (как есть), клавиша `E` и пункт меню — список у ноды с выбором цифрами `0–9` (0 — «Без категории») | Как в мокапе |
| Р13 | Отбор: строка поиска, `FilterBar` в режиме `graph` (без сортировки и вида), категория/тег боковой панели, сохранённый поиск — всё пишет в `useUi.query` / `useUi.filter` и **приглушает** неподходящие ноды (альфа 0.2) и связи. `focusZone` из `store/graph.ts` удаляется: единственный источник — `useUi.filter.categoryId` | Один фильтр на экран; чип в `FilterBar`, легенда и сохранённый поиск не расходятся |
| Р14 | Сохранённый поиск, применённый в «Графе», остаётся в «Графе» | Задание: отбор на графе приглушает, а не уводит в список |
| Р15 | Панель инструментов графа (масштаб, «Весь граф», «Разложить», «Архив») — плавающая в левом нижнем углу сцены, одна для ПК и телефона. Слот `data-topbar-slot` в `TopBar` не используется | На телефоне в верхней панели места нет; два варианта размещения — двойная работа. Плавающая кнопка «Добавить» — справа, не пересекаются |
| Р16 | Фон сцены графа в пиксельных сценах — ровный цвет земли сцены `--ground` (значения мокапа); в «Классике» — `--background`. Плитка, лес, осадки — этап 6 через контракт `lib/graph/ambient.ts` (§3.5) | План: живой фон — этап 6 |
| Р17 | Клавиатура: стрелки — к ближайшей ноде в направлении; Tab / Shift+Tab — по связям текущей ноды (если связей нет — Tab не перехватывается); `+`/`−` — масштаб; `0` — весь граф. Экранный диктор: сцена `role="application"` + одна «живая» строка с описанием текущей ноды; списка из тысяч скрытых элементов нет | Разумный минимум; Tab не становится ловушкой |
| Р18 | Телефон: сдвиг одним пальцем, масштаб щипком (ступени), касание — выбрать. Перенос ноды и протяжка связи пальцем не поддерживаются; связь — режимом (в) | Задание: «по минимуму» |
| Р19 | Записи корзины, у которых есть сохранённое положение, участвуют в раскладке как невидимые (держат клетку и ров); без положения — не участвуют | Восстановленная запись возвращается на своё место, а не в чужую зону |
| Р20 | Выбранная нода, пришедшая извне (палитра, связанные записи в деталях), показывается: камера сдвигается, если нода вне экрана. `openItemInSection` из «Графа» раздел не меняет | Иначе клик по связанной записи уводил бы из графа |

Константы: `GRAPH_ALPHA_DIM = 0.2`, `GRAPH_ALPHA_ARCHIVED = 0.45`, `GRAPH_LABEL_LIMIT = 150`, `GRAPH_MOAT = 2`.

---

## 1. Устройство

### 1.1 Слои сцены (снизу вверх; все `absolute inset-0` внутри `div[data-graph-stage]`)

1. `canvas[data-graph-ambient="back"]` — фон этапа 6 (на этапе 5 пуст и не измеряется, пока слой не подключён).
2. `canvas[data-graph-canvas]` — связи и ноды, размер в пикселях устройства, `imageSmoothingEnabled = false`.
3. `canvas[data-graph-ambient="front"]` — фон этапа 6 поверх нод (лучи), `pointer-events: none`.
4. `div[data-graph-overlay]` — DOM: подписи, подсказка, ручка связи, меню, выбор категории, плашка связи, строка для диктора.
   Сам слой `pointer-events-none`; интерактивные дети — `pointer-events-auto`.
5. Панель инструментов и первая подсказка (`data-graph-ui`). *(Уточнено при исправлениях ревью 5: они лежат не внутри `div[data-graph-stage]` (`role="application"`), а в соседнем слое поверх сцены, повторяющем внутренний край рамки.)*

Атрибуты-контракты (жесты узнают по ним, что делать с нажатием):
- `data-graph-ui` — любой интерактивный DOM поверх сцены (панель, меню, поповеры, подсказка): жесты и колесо внутри игнорируются;
- `data-graph-handle="<id>"` — ручка связи: перетаскивание от неё начинает протяжку связи.

### 1.2 Поток данных (`GraphView`)

```
useItemsWithTrash() ─┐
usePositions() ──────┼─ toLayoutNodes → computeLayout ─ placed ─→ addPositions / setPositions (сразу, без повторов)
useCategories() ─────┘                      │ positions (+ незаписанные броски)
useUi.query/filter ─ computeGraphMatch ─────┤
useGraph.showArchive ───────────────────────┴─ buildGraphScene ─→ scene ─→ GraphCanvas (рисование по запросу)
                                                                     └────→ GraphOverlay, GraphHeader
useGraph (камера, наведение, курсор, режимы) ─→ GraphCanvas / GraphOverlay / GraphToolbar
```

Сцена (`GraphScene`) пересобирается только при смене записей, положений, категорий, отбора и переключателя архива.
Камера, наведение, перетаскивание сцену не трогают — только перерисовка.

### 1.3 Модули и владение

| Файл | Что | Пакет |
|---|---|---|
| `src/lib/graphLayout.ts` (+test) | раскладка зон — переработка | graph-core |
| `src/lib/graph/types.ts` | типы графа | graph-core |
| `src/lib/graph/geometry.ts` (+test) | ступени масштаба, преобразования, вписывание, индекс, hit-test | graph-core |
| `src/lib/graph/scene.ts` (+test) | сборка сцены | graph-core |
| `src/lib/graph/match.ts` (+test) | «подходит ли» для всего набора | graph-core |
| `src/lib/graph/labels.ts` (+test) | выбор подписей | graph-core |
| `src/store/graph.ts` (+test) | состояние графа | graph-base |
| `src/lib/actions.ts` (+test), `src/lib/savedSearch.ts` (+test) | действия графа, сохранённый поиск в графе | graph-base |
| `src/db/repo.ts` (+test) | `addPositions` — запись мест раскладки без затирания (§3.2а) | graph-base |
| `src/lib/hotkeyGuards.ts` | общие проверки клавиш | graph-base |
| `src/lib/graph/theme.ts` (+test), `src/lib/graph/ambient.ts` | цвета из CSS, контракт фона | graph-look |
| `src/index.css`, `src/styles/scenes.css`, `src/styles/pixel.css`, `docs/DESIGN.md` | переменные и правила графа | graph-look |
| `src/components/items/FilterBar.tsx` | проп `mode` (общий компонент списков) | graph-look |
| `src/lib/graph/draw.ts` (+test) | рисование | graph-paint |
| `src/components/graph/{GraphOverlay,GraphLabels,GraphTooltip,GraphNodeMenu,GraphCategoryPicker,GraphLinkTools,GraphA11y}.tsx` | DOM-слой | graph-dom |
| `src/components/graph/{GraphHeader,GraphToolbar,GraphHint}.tsx` | заголовок, панель, подсказка | graph-chrome |
| `src/components/layout/Sidebar.tsx`, `src/hooks/useHotkeys.ts`, `src/components/palette/CommandPalette.tsx`, `src/views/settings/ShortcutsSection.tsx` | навигация, клавиша, палитра, настройки | graph-nav |
| `src/views/GraphView.tsx`, `src/components/graph/{GraphCanvas.tsx,useGraphGestures.ts,useGraphKeys.ts}`, `src/components/layout/AppShell.tsx` | экран, холст, жесты, клавиши, подключение раздела | graph-screen |

(уточнено при сверке) Волна 0 — по очереди: `graph-core` → `graph-base` → `graph-look`. После неё `npm run typecheck`
и `npm test` зелёные, раздел «Граф» по-прежнему пуст (`ActiveView` возвращает `null`). Волна 1 — четыре пакета
параллельно (`graph-paint`, `graph-dom`, `graph-chrome`, `graph-nav`): каждый импортирует только волну 0 и свои файлы.
Волна 2 — `graph-screen`: `GraphView` собирает экран из файлов волны 1 (`draw.ts`, `GraphOverlay`, `GraphHeader`,
`GraphToolbar`, `GraphHint`, `FilterBar mode`), поэтому он не может идти параллельно с ними — иначе typecheck пакета
зависел бы от соседей. Он же проверяет в браузере DOM-слой и панель (до него раздел не открывается).

---

## 2. Волна 0, пакет `graph-core` (opus) — чистые модули с тестами

Все модули чистые: без DOM, без IndexedDB, без `Math.random` и `Date.now` (кроме параметра `now`).

### 2.1 `src/lib/graph/types.ts` (новый)

```ts
import { CATEGORY_COLORS } from '@/types'
import type { CategoryColor, GraphPoint } from '@/types'

/** Камера: x, y — мировая точка в центре сцены; zoom — ступень из GRAPH_ZOOM_STEPS. */
export interface GraphCamera { x: number; y: number; zoom: number }
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
/** Вид сцены: размер в CSS-пикселях, плотность пикселей и камера. */
export interface GraphViewport { width: number; height: number; dpr: number; camera: GraphCamera }
/** Мир → пиксели устройства: X = ox + round(wx · k). ox, oy — целые; k = zoom · dpr. */
export interface DeviceTransform { ox: number; oy: number; k: number }

export type GraphColorKey = CategoryColor | 'none'
/**
 * Порядок цветов при рисовании (сцена сортирует ноды по нему). (уточнено при сверке) Константа живёт здесь, а не в
 * theme.ts: её использует scene.ts пакета graph-core, а theme.ts пишет следующий пакет волны 0; theme.ts реэкспортирует.
 */
export const GRAPH_COLOR_KEYS: readonly GraphColorKey[] = ['none', ...CATEGORY_COLORS]

export interface GraphNode {
  id: string
  x: number
  y: number
  color: GraphColorKey
  /** id категории или 'none'. */
  zone: string
  inbox: boolean
  archived: boolean
  /** Не проходит отбор. */
  dim: boolean
  title: string
  /** Индексы связанных нод сцены, по возрастанию. */
  links: number[]
}
/** a < b — индексы в scene.nodes. */
export interface GraphLink { a: number; b: number; cross: boolean; dim: boolean }

export interface SpatialIndex { bucket: number; cells: Map<number, number[]> }

export interface GraphScene {
  /** Порядок рисования: сначала dim, затем остальные; внутри — по color (порядок GRAPH_COLOR_KEYS), затем (y, x, id). */
  nodes: GraphNode[]
  byId: ReadonlyMap<string, number>
  links: GraphLink[]
  /** По центрам нод ± GRAPH_NODE_SIZE / 2; пусто — null. */
  bounds: Bounds | null
  index: SpatialIndex
  /** Число нод, проходящих отбор. */
  matched: number
}

export interface GraphTheme {
  pixel: boolean
  cat: Record<GraphColorKey, string>
  /** null — рамки нет («Классика»). */
  nodeEdge: string | null
  shadow: string | null
  inbox: string
  inboxEdge: string
  sel: string
  selEdge: string | null
  hover: string
  /** Цвета связей для буфера ImageData (packRgba). */
  link: number
  linkAlt: number
  linkEdge: number
  linkHot: number
  /** Цвета связей для stroke («Классика»). */
  linkCss: string
  linkHotCss: string
}

/** Сиюминутное состояние для рисования (не входит в сцену). */
export interface DrawState {
  selectedId: string | null
  hoveredId: string | null
  cursorId: string | null
  /** Выбранная или наведённая связь. */
  hotLink: { a: string; b: string } | null
  /** Перетаскиваемая нода: текущая точка мира и клетка, куда она встанет. */
  drag: { id: string; x: number; y: number; drop: GraphPoint | null } | null
  /** Протягиваемая связь: от ноды к точке мира; targetId — нода под указателем. */
  tempLink: { fromId: string; x: number; y: number; targetId: string | null } | null
}

export const GRAPH_ALPHA_DIM = 0.2
export const GRAPH_ALPHA_ARCHIVED = 0.45
```

### 2.2 `src/lib/graphLayout.ts` — переработка (долги этапа 5)

Экспорты и сигнатуры `computeLayout`, `findFreeSpot`, `snapToGrid`, константы — прежние. Изменения:

```ts
/** Ров между зонами, клеток: новая нода не встаёт ближе (по Чебышёву) к ноде чужой зоны. */
export const GRAPH_MOAT = 2

export interface LayoutResult {
  positions: Map<string, GraphPoint>
  /** id нод, получивших место в этом вызове: новые и разведённые (их нужно сохранить через setPositions). */
  placed: string[]
  /** Подмножество placed: ноды, чьё сохранённое место было занято другой нодой. */
  displaced: string[]
  zones: LayoutZone[]
  bounds: Bounds | null
}

/**
 * Записи раскладки: все записи вне корзины (inbox, library, archive) и записи корзины, у которых есть годное
 * положение в fixed (держат своё место). Без fixed записи корзины не берутся.
 */
export function toLayoutNodes(items: readonly Item[], fixed?: Readonly<Record<string, GraphPoint>>): LayoutNode[]
```

Гарантии (записать в шапку файла и покрыть тестами):
1. **Детерминированность** — как было.
2. **Устойчивость.** Нода с годным сохранённым положением, клетку которого не занимает нода, стоящая раньше по
   `(createdAt, id)`, возвращается как есть. Добавление записи или категории не меняет ни одного такого положения.
3. **Одна нода — одна клетка.** В `positions` нет двух нод в одной клетке, в том числе сохранённых.
4. **Зоны не перемешиваются.** Нода, получившая место в этом вызове (кроме разведённых), стоит не ближе `GRAPH_MOAT`
   клеток по Чебышёву к любой ноде другой зоны, у которой уже есть место.

Изменения алгоритма (шаги — по нумерации `spec-stage2.md` §2.6 и нынешнего кода):

- **Шаг 2 выполняется после шага 3** (зона ноды нужна сразу). Структуры: `occupied: Set<cell>`,
  `claim: Map<cell, zoneIndex | MIXED>`. `mark(cell, zi)`: для всех клеток в квадрате `(2·MOAT+1)²` вокруг `cell`:
  `claim` пуст → `zi`; равен `zi` → без изменений; иначе → `MIXED`. `blocked(cell, zi) = occupied.has(cell) ||
  (claim.has(cell) && claim.get(cell) !== zi)`.
  - 2а. Ноды с годной сохранённой точкой, в порядке `(createdAt, id)`: клетка свободна → точка остаётся как есть
    (в том числе не по сетке), `occupied.add`, `mark`; занята → нода уходит в список разведения.
  - 2б. Положения из `fixed`, чьих id нет в `nodes`, — только `occupied.add` (рва не дают, ноду не вытесняют).
  - 2в. Разведение, в том же порядке: ближайшая к сохранённой точке свободная клетка (`!occupied`, ров не
    учитывается) — тот же обход колец и то же правило ничьей, что в `findFreeSpot` (вынести общий внутренний
    помощник). Новая точка — узел сетки; `occupied.add`, `mark`; id → `placed` и `displaced`.
- **Шаг 5 (центры).** Зона с нодами, имеющими место (после 2а–2в), — нижняя медиана, как было. Новая зона — обход
  «подсолнуха», как было; `fits(x, y, r)` дополнительно требует: ни одной ноды с местом (любой зоны) и ни одной клетки
  из 2б ближе `r + GRAPH_MOAT · GRAPH_CELL` к `(x, y)`. Проверка — через крупные корзины (8 клеток) по точкам с
  местом; ускорение `searched` остаётся верным (условие монотонно по `r`).
- **Шаг 6 (размещение).** Везде, где проверялось `occupied.has(...)`, — `blocked(cell, zi)`: первая свободная клетка
  зоны (указатель), кандидаты (а), кандидаты (б). Правило «связь не выводит ноду из зоны» остаётся. После выбора —
  `occupied.add`, `mark`. Свободная клетка найдётся всегда: список смещений дорастает (`ensureOffsets`).
  (уточнено при сверке) Указатель зоны верен и с рвом: `blocked(cell, zi)` со временем только переходит из false в
  true (`occupied` растёт, `claim` от `zi` уходит только в чужую зону или `MIXED`). Кандидаты (б) у связанной ноды
  **чужой** зоны берутся в квадрате радиусом `NEIGHBOR_REACH + GRAPH_MOAT` (5×5 → 9×9): при `NEIGHBOR_REACH = GRAPH_MOAT = 2`
  все клетки прежнего квадрата лежат во рву соседа, и правило «связь тянет к чужой ноде» не действовало бы; у соседа
  своей зоны — прежний квадрат 5×5.

Следствие (сказать в комментарии): зона, окружённая соседями, растёт в обход них и может продолжиться «островом» за
ними — но не внутри чужой зоны. Порядок наводит «Разложить» (при пустом `fixed` зоны раздвинуты с запасом, как раньше).

(уточнено при сверке) Проверено моделью алгоритма вне репозитория (порт нынешнего кода + изменения этого раздела):
7 зон × 8 нод, затем 500 нод по одной (0–2 связи, в том числе с чужими зонами) — нод, у которых в квадрате 5×5 есть
нода чужой зоны: прежний алгоритм 353, с рвом 0; перекос 70 % в одну зону — 414 и 0; новая категория на шаге 200 —
278 и 0; 12 зон, 1500 шагов — 0. Во всех прогонах на каждом шаге `placed` — только новая нода, прежние точки не
сдвинулись, клетки уникальны. Время: 2000 нод с нуля — ~10 мс, 2000 сохранённых + 1 — ~5 мс (Node 22). Цена рва —
острова у зажатой зоны: при новой категории посреди роста центральная зона распалась на участки 58 + 5 + 4 + 3 + 2
нод, часть — одиночными «тропками» по середине коридоров шириной 5 клеток между соседними зонами (не ближе рва к ним).
Улучшение — вопрос основной сессии (отчёт `.progress/agents/spec-stage5-review.md`); пакет делает раздел как написан.

Тесты `graphLayout.test.ts` (существующие остаются; меняются два: «две сохранённые ноды в одной клетке…» и
`toLayoutNodes`):
- коллизия: из двух сохранённых нод в одной клетке первая по `(createdAt, id)` остаётся, вторая получает ближайшую
  свободную клетку, попадает в `placed` и `displaced`; результат не зависит от порядка входа и ключей `fixed`;
  три ноды в одной клетке; сохранённая точка не по сетке занимает свою клетку;
- скрытая запись (id нет в `nodes`) держит клетку, но видимую ноду с той же клеткой не вытесняет;
- после любого вызова из набора тестов клетки всех нод различны (общая проверка-помощник);
- ров: зона A с центром вплотную к сохранённым нодам зоны B — новые ноды A не ближе `GRAPH_MOAT` клеток к нодам B;
  связанная с B нода A не ближе рва к нодам B и (уточнено при сверке) не дальше от связанной ноды, чем встала бы та же
  нода A без связи;
- **постепенный рост**: 7 зон × 8 нод (раскладка с нуля, результат — `fixed`), затем 500 нод по одной (категория и
  0–2 связи, в том числе с чужой зоной, — из детерминированного счётчика); после каждого шага `placed` = только новая
  нода, все прежние точки не изменились; в конце: клетки уникальны, у каждой ноды в квадрате `(2·MOAT+1)²` нет нод
  чужой зоны. Время теста — до 5 с;
- новая категория посреди роста: существующие ноды не сдвинулись; ноды новой зоны не ближе рва к чужим;
- `toLayoutNodes`: архив входит; корзина — только с положением в `fixed`; без `fixed` корзина не входит;
- производительность: 2000 нод / 12 категорий / 3000 связей с нуля — < 1500 мс (как было); 2000 сохранённых + 1
  новая — < 300 мс.

### 2.3 `src/lib/graph/geometry.ts` (+ `geometry.test.ts`)

```ts
export const GRAPH_ZOOM_STEPS: readonly number[] = [0.125, 0.25, 0.5, 0.75, 1, 1.5, 2]
/** С этого масштаба показываются подписи. */
export const GRAPH_LABEL_ZOOM = 1

export function snapZoom(zoom: number): number                         // ближайшая ступень; NaN → 1
export function stepZoom(zoom: number, dir: 1 | -1): number            // соседняя ступень; на краю — та же

export function deviceTransform(v: GraphViewport): DeviceTransform     // ox = round(width·dpr/2 − camera.x·k), так же oy
export function worldToScreen(v: GraphViewport, p: GraphPoint): GraphPoint   // CSS-пиксели от левого верхнего угла сцены
export function screenToWorld(v: GraphViewport, p: GraphPoint): GraphPoint
export function visibleBounds(v: GraphViewport, marginPx?: number): Bounds   // мир; marginPx — запас в CSS-пикселях
/** Камера после смены масштаба: мировая точка под anchor (CSS-пиксели сцены) остаётся под ним. */
export function zoomAt(v: GraphViewport, zoom: number, anchor: GraphPoint): GraphCamera
/** Камера после сдвига содержимого на dx, dy CSS-пикселей (перетаскивание фона). */
export function panBy(camera: GraphCamera, dx: number, dy: number): GraphCamera
/** Вписать bounds: наибольшая ступень, при которой bounds + padPx (по умолчанию 48) помещается, но не больше 1; bounds null или размер 0 → { x: 0, y: 0, zoom: 1 }. */
export function fitCamera(bounds: Bounds | null, size: { width: number; height: number }, padPx?: number): GraphCamera
/** Камера, при которой p виден с запасом marginPx (по умолчанию 64): центр переносится на p. null — уже виден. */
export function ensureVisible(v: GraphViewport, p: GraphPoint, marginPx?: number): GraphCamera | null

export function buildSpatialIndex(points: ReadonlyArray<GraphPoint>, bucket?: number): SpatialIndex   // bucket по умолчанию 256
/** Индексы точек внутри b (включая границу), по возрастанию. */
export function queryBounds(index: SpatialIndex, points: ReadonlyArray<GraphPoint>, b: Bounds): number[]
/** Нода под мировой точкой: полуширина зоны попадания max(GRAPH_NODE_SIZE/2 + 2, 7/zoom); ближайшая по Чебышёву, при равенстве — с большим индексом. −1 — нет. */
export function hitNode(index: SpatialIndex, points: ReadonlyArray<GraphPoint>, p: GraphPoint, zoom: number): number
/** Связь под мировой точкой: расстояние до отрезка ≤ max(3, 5/zoom); ближайшая, при равенстве — с большим индексом. Перебор всех связей. −1 — нет. */
export function hitLink(points: ReadonlyArray<GraphPoint>, links: ReadonlyArray<{ a: number; b: number }>, p: GraphPoint, zoom: number): number
/** Ближайшая нода в направлении: главная дельта > 0, |поперечная| ≤ главной; минимум (главная + 2·|поперечная|), затем индекс. −1 — нет. */
export function nearestInDirection(points: ReadonlyArray<GraphPoint>, from: GraphPoint, dir: 'left' | 'right' | 'up' | 'down', skip?: number): number
/** Соседи ноды по часовой стрелке от «12 часов» (для Tab). */
export function sortByAngle(points: ReadonlyArray<GraphPoint>, center: GraphPoint, indices: readonly number[]): number[]
/** Накопление колеса: delta = deltaY · (строки ×32, страницы ×400); порог 90 (с ctrlKey — 30); за событие не больше одного шага. steps > 0 — приблизить. */
export function wheelSteps(acc: number, e: { deltaY: number; deltaMode: number; ctrlKey: boolean }): { acc: number; steps: -1 | 0 | 1 }
/** Щипок: отношение расстояний > 1.35 → 1; < 0.74 → −1; иначе 0. */
export function pinchStep(startDist: number, dist: number): -1 | 0 | 1
```

Тесты: круговые преобразования мир↔экран; `deviceTransform` — целые `ox, oy`, а `GRAPH_CELL · k` целое для всех ступеней
при `dpr` 1, 1.25, 1.5, 1.75, 2; `zoomAt` сохраняет точку под якорем; `fitCamera` (маленький граф → 1, большой → 0.125,
пустой); `ensureVisible`; индекс: `queryBounds` совпадает с полным перебором на 2000 псевдослучайных точках;
`hitNode` на мелком масштабе выбирает ближайшую; `hitLink`; `nearestInDirection` (конус 45°, ничьи); `sortByAngle`;
`wheelSteps` (мышь 100 → шаг, тачпад 4×25 → один шаг, знак); `pinchStep`.

### 2.4 `src/lib/graph/scene.ts` (+ `scene.test.ts`)

```ts
export interface SceneInput {
  /** Записи вне корзины (записи с deletedAt, если попали, пропускаются). */
  items: readonly Item[]
  positions: ReadonlyMap<string, GraphPoint>
  categories: readonly Category[]
  /** null — отбор не задан (ничего не приглушено). */
  match: ReadonlySet<string> | null
  showArchive: boolean
}
export function buildGraphScene(input: SceneInput): GraphScene
```

Правила: нода — запись без `deletedAt`, с положением в `positions`, архивная — только при `showArchive`.
`color` = цвет категории, неизвестная категория или `null` → `'none'`; `zone = categoryId ?? 'none'`;
`inbox = status === 'inbox'`; `archived = status === 'archive'`; `dim = match !== null && !match.has(id)`;
`title = displayTitle(item)`. Связь — неупорядоченная пара видимых нод (по `item.links` с любой стороны, без дублей и
самоссылок); `cross` — зоны разные; `dim` — приглушён хотя бы один конец. Порядок `nodes` и `links` детерминирован
(`links` — по `(a, b)`). `index` строится по `nodes`.

Тесты: корзина и архив; цвет и зона; приглушение нод и связей; связь, записанная с одной стороны; порядок рисования
(dim первыми); `bounds`; `matched`; 2000 записей — < 100 мс.

### 2.5 `src/lib/graph/match.ts` (+ `match.test.ts`)

```ts
export interface GraphMatch { active: boolean; ids: ReadonlySet<string> | null }
/**
 * Какие записи графа проходят отбор экрана. all — все записи базы (с корзиной, для индекса поиска),
 * nodes — записи графа. Отбор не задан (isNarrowed из lib/savedSearch) → { active: false, ids: null }.
 */
export function computeGraphMatch(
  all: readonly Item[], nodes: readonly Item[], categories: Category[], query: string, filter: UiFilter, now?: number,
): GraphMatch
```

Реализация: `pre = nodes.filter((n) => matchesFilterIgnoringTrash(n, filter))`; строка поиска непуста →
`searchItems(all, query, categories, { within: pre, now })` (операторы строки, включая `is:…`, `cat:`, даты, работают
как в списках; `is:trash` даёт пустое множество), иначе `pre`. Раздел тут не участвует — в этом отличие от
`computeVisible`.

Тесты: пустой отбор; тип, тег, категория (`null` — без категории), период; текст; `is:inbox`; `is:trash` → пусто;
`cat:имя`; сочетание фильтра и строки.

### 2.6 `src/lib/graph/labels.ts` (+ `labels.test.ts`)

```ts
export const GRAPH_LABEL_LIMIT = 150
export const GRAPH_LABEL_MAX_WIDTH = 160      // CSS-пиксели
export const GRAPH_LABEL_HEIGHT = 16
export const GRAPH_LABEL_GAP = 6              // от края ноды до подписи

export interface GraphLabel {
  index: number          // индекс ноды в сцене
  id: string
  text: string
  /** Центр ноды, мир. Подпись ставится справа: left = x·zoom + GRAPH_NODE_SIZE·zoom/2 + GAP, по вертикали — по центру. */
  x: number
  y: number
  /** На плашке (выбранная нода и её соседи). */
  plate: boolean
}
export function pickLabels(
  scene: GraphScene, area: Bounds, zoom: number, priority: readonly string[],
  opts?: { limit?: number; measure?: (text: string) => number },
): GraphLabel[]
```

Правила: `zoom < GRAPH_LABEL_ZOOM` → `[]`. Иначе: сначала `priority` (по порядку, те, что есть в сцене и в `area`) —
`plate: true`, принимаются, если не пересекают уже принятые плашки (ноды под собой закрывать могут). Затем ноды из
`area` (`queryBounds`), неприглушённые, в порядке сцены: подпись принимается, если её прямоугольник не пересекает
принятые и не накрывает квадрат ни одной другой ноды (запрос к индексу по прямоугольнику подписи, переведённому в мир).
Приглушённые ноды подписей не получают. Всего не больше `limit` (по умолчанию `GRAPH_LABEL_LIMIT`). Ширина —
`min(GRAPH_LABEL_MAX_WIDTH, measure(text))`; по умолчанию `measure = (t) => t.length * 7 + 4`.

Тесты: ниже 100 % пусто; одиночная нода; плотная решётка — подписи только у правого края; приоритетные на плашке
поверх решётки; предел; приглушённые; подпись не накрывает соседнюю подпись.

Критерии готовности пакета: `npm run typecheck`, `npm test` зелёные; в `src/` вне своих файлов правок нет;
`src/store/graph.ts` пока импортирует `GraphCamera` у себя — его не трогать (это файл `graph-base`).

---

## 3. Волна 0, пакеты `graph-base` и `graph-look` (sonnet) — состояние, действия, цвета, CSS

(уточнено при сверке) Раздел делится на два пакета волны 0, они идут по очереди после `graph-core`:
- `graph-base` — §3.1 стор, §3.2 действия, §3.2а `repo.addPositions`, §3.3 сохранённый поиск, §3.6 проверки клавиш;
- `graph-look` — §3.4 цвета из CSS, §3.5 контракт фона, §3.7 CSS, §3.8 DESIGN, §3.9 проп `mode` у `FilterBar`.
Пакеты друг от друга не зависят (`graph-look` использует только `lib/graph/types` из `graph-core`).

### 3.1 `src/store/graph.ts` (+ `graph.test.ts`)

```ts
export type { GraphCamera } from '@/lib/graph/types'      // тип переезжает в lib/graph/types, экспорт остаётся

export const GRAPH_CAMERA_KEY = 'qd-graph-camera'
export const GRAPH_ARCHIVE_KEY = 'qd-graph-archive'       // '0' — архив скрыт
export const GRAPH_HINT_KEY = 'qd-graph-hint'             // '1' — подсказка закрыта
export const GRAPH_ZOOM_MIN = 0.125                       // = первая и последняя ступени
export const GRAPH_ZOOM_MAX = 2

interface GraphState {
  camera: GraphCamera
  /** Камера прочитана из localStorage; иначе при первом показе графа делается fitAll. */
  cameraRestored: boolean
  /** Размер сцены в CSS-пикселях; 0×0 — ещё не измерена. */
  viewSize: { width: number; height: number }
  /** Границы нод сцены (ставит GraphView). */
  bounds: Bounds | null
  hoveredId: string | null
  /** Курсор клавиатуры. */
  cursorId: string | null
  /** Идущий жест — DOM-слой прячет подсказку и ручку. */
  drag: 'pan' | 'node' | 'link' | null
  /** Режим связи: от какой ноды. */
  linkFrom: string | null
  /** Выбранная связь; x, y — мировая точка клика (якорь плашки). */
  selectedLink: { a: string; b: string; x: number; y: number } | null
  /** Меню ноды; x, y — CSS-пиксели сцены. */
  menu: { id: string; x: number; y: number } | null
  /** Для какой ноды открыт выбор категории. */
  pickerFor: string | null
  showArchive: boolean
  hintSeen: boolean

  setCamera: (patch: Partial<GraphCamera>) => void          // zoom приводится к ступени (snapZoom)
  resetCamera: () => void
  setViewSize: (width: number, height: number) => void
  setBounds: (bounds: Bounds | null) => void
  /** Шаг масштаба; anchor — CSS-пиксели сцены, по умолчанию центр. */
  zoomStep: (dir: 1 | -1, anchor?: GraphPoint) => void
  panBy: (dx: number, dy: number) => void
  /** Вписать bounds в viewSize; viewSize 0×0 — ничего. */
  fitAll: () => void
  /** Центр камеры в p; minZoom — поднять масштаб до этой ступени, если он меньше. */
  centerOn: (p: GraphPoint, minZoom?: number) => void
  setHovered: (id: string | null) => void
  setCursor: (id: string | null) => void
  setDrag: (kind: 'pan' | 'node' | 'link' | null) => void
  setLinkFrom: (id: string | null) => void
  selectLink: (link: { a: string; b: string; x: number; y: number } | null) => void
  openMenu: (menu: { id: string; x: number; y: number } | null) => void
  openPicker: (id: string | null) => void
  setShowArchive: (on: boolean) => void
  dismissHint: () => void
  /** Сброс сиюминутного: hoveredId, cursorId, drag, linkFrom, selectedLink, menu, pickerFor → null. */
  resetTransient: () => void
}
```

- `focusZone` / `setFocusZone` удаляются (Р13); их тесты — тоже.
- Камера: чтение и запись как сейчас (задержка 300 мс), `zoom` — `snapZoom`; сохранённый масштаб не со ступени
  подтягивается к ближайшей. `cameraRestored = true`, только если из хранилища прочитана годная камера.
- `showArchive` по умолчанию `true`; `hintSeen` по умолчанию `false`; оба читаются при создании стора и пишутся сразу
  (try/catch, без хранилища — молча в памяти).
- `zoomStep`, `fitAll`, `centerOn`, `panBy` считают через `lib/graph/geometry` (`zoomAt` с `dpr: 1` — на камеру dpr не влияет).
- Открытие одного всплывающего закрывает остальные: `openMenu(m)` → `pickerFor = null`, `selectedLink = null`;
  `openPicker(id)` → `menu = null`, `selectedLink = null`; `selectLink(l)` → `menu = null`, `pickerFor = null`.
- Установка прежнего значения не будит подписчиков (как сейчас у `setHovered`).

Тесты: прежние (кроме `focusZone`; пределы масштаба — ступени) + ступени (`zoomStep` на краях, якорь), `fitAll` без
размера, `centerOn` с `minZoom`, `showArchive`/`hintSeen` в `localStorage`, взаимное закрытие всплывающих,
`resetTransient`, `cameraRestored`.

### 3.2 `src/lib/actions.ts` (+ `actions.test.ts`) — добавить

```ts
/** Сохраняет положение ноды после перетаскивания (updatedAt записи не меняется). Ошибка → toast.error. Успех — молча. */
export async function actMoveNode(id: string, point: GraphPoint): Promise<void>

/** Связывает записи. a === b — ничего. Уже связаны → toast «Записи уже связаны». Иначе toast «Записи связаны» с «Отменить» (unlinkItems). */
export async function actLinkItems(a: string, b: string): Promise<void>

/** Снимает связь: toast «Связь убрана» с «Отменить» (linkItems). Связи не было — ничего. */
export async function actUnlinkItems(a: string, b: string): Promise<void>

/**
 * Категория записей (граф: клавиша E, меню). Ничего не изменилось — без toast. Иначе toast «Категория: <имя>» /
 * «Без категории» (для нескольких — с числом) с «Отменить»: прежние категории (setCategory по группам) и прежние
 * положения нод (setPositions) — setCategory сбрасывает место ноды.
 */
export async function actSetCategory(ids: string | string[], categoryId: string | null): Promise<void>

/** «Разложить»: clearPositions() → toast «Граф разложен заново» (duration 10 000) с «Отменить» (setPositions(прежние)). Положений не было — toast без отмены. */
export async function actRelayoutGraph(): Promise<void>
```

Изменить (поведение вне «Графа» прежнее):
- `actApplySearch`: если `ui.view === 'graph'` → `ui.applyQuery(search.query, 'graph')` (Р14). Остальное как было.
- `openItemInSection`: если `ui.view === 'graph'` и запись не в корзине → раздел не менять; запись архивная →
  `useGraph.getState().setShowArchive(true)`; затем `select(item.id)` (Р20).

Всё — через `safe(...)`. Тесты: каждое новое действие (в том числе отмены: после отмены `actSetCategory` у записи
прежняя категория и прежнее положение; после отмены «Разложить» положения прежние), `actApplySearch` из графа,
`openItemInSection` из графа (обычная, архивная, из корзины).

### 3.2а `src/db/repo.ts` (+ `repo.test.ts`) — добавить (уточнено при сверке)

```ts
/**
 * Места, выданные раскладкой: пишутся только для id, у которых положения ещё нет (существующие не затираются).
 * Негодные точки и id, которых нет среди записей, пропускаются, как в setPositions. updatedAt не меняется.
 */
export async function addPositions(map: Record<string, GraphPoint>): Promise<void>
```

Почему: `GraphView` пишет `placed` по снимку `usePositions()`, который может отстать от базы. С `setPositions` поздняя
запись раскладки затирала бы то, что успело записаться позже снимка: «Отменить» у «Разложить» (раскладка 2000 нод
пишется уже после клика), «Отменить» у `actSetCategory` (между `setCategory` и `setPositions(прежние)` граф успевает
выдать ноде место в старой зоне), перенос ноды. С `addPositions` выигрывает явное действие при любом порядке
транзакций. Разведённые (`displaced`) ноды место уже имеют — для них `GraphView` вызывает `setPositions`.
Реализация: одна транзакция `rw` по `positions` и `items`; существующие — `db.positions.bulkGet(ids)`.
Тесты: существующее положение не меняется; новое пишется; неизвестный id и негодная точка пропускаются; `updatedAt`
записи не меняется.

### 3.3 `src/lib/savedSearch.ts` (+ тест)

`isSavedSearchActive`: при `screen.view === 'graph'` раздел запроса не сверяется — поиск активен, если его запрос стоит
в строке и фильтры панели пусты. Тест.

### 3.4 `src/lib/graph/theme.ts` (+ `theme.test.ts`)

```ts
export { GRAPH_COLOR_KEYS } from '@/lib/graph/types'              // (уточнено при сверке) определена в types.ts (graph-core)
/** RGBA → число для Uint32Array поверх ImageData (порядок байтов платформы; проверка little-endian один раз). */
export function packRgba(r: number, g: number, b: number, a: number): number
/** Читает цвета графа из вычисленных CSS-переменных элемента. Только в браузере. */
export function readGraphTheme(root: HTMLElement): GraphTheme
/** Смена сцены, темы или шрифта (класс на <html>) → cb. Возвращает отписку. */
export function subscribeGraphTheme(cb: () => void): () => void
```

`readGraphTheme`: `pixel` — класс `pixel` на `<html>`. Каждый цвет разрешается пробником: скрытый `span` внутри
`root`, `style.color = 'var(--имя)'`, `getComputedStyle(span).color` (так раскрываются `var()` и `color-mix()`);
строка идёт в `fillStyle`/`strokeStyle` как есть. Для буфера связей цвет переводится в байты: заливка точки на
служебном canvas 1×1 и `getImageData` → `packRgba`. Прозрачный цвет (альфа 0) у `nodeEdge`, `shadow`, `selEdge` →
`null`. Соответствие полей и переменных — таблица §3.7. Пробник и служебный canvas создаются на вызов и удаляются.

Тесты (без DOM): `packRgba` и порядок `GRAPH_COLOR_KEYS`. `readGraphTheme` проверяется в браузере пакетом `graph-screen`.

### 3.5 `src/lib/graph/ambient.ts` — контракт живого фона (этап 6 подключит рисовальщик)

```ts
export interface AmbientFrame {
  viewport: GraphViewport
  /** Мир → пиксели устройства canvas (то же преобразование, что у нод). */
  device: DeviceTransform
  pixel: boolean
  dark: boolean
  /** performance.now() кадра. */
  time: number
  /** Есть ли нода ближе radius (мир) к точке — «лес не растёт под нодами и рядом». */
  nodeNear: (wx: number, wy: number, radius: number) => boolean
}
export interface AmbientLayer {
  /** Хост вызывает при каждой перерисовке графа (сдвиг, масштаб, размер, сцена, набор нод) и по requestAmbientFrame(). Оба canvas уже нужного размера (пиксели устройства). */
  draw: (target: { back: CanvasRenderingContext2D; front: CanvasRenderingContext2D }, frame: AmbientFrame) => void
}
export function setAmbientLayer(layer: AmbientLayer | null): void
export function getAmbientLayer(): AmbientLayer | null
/** Этап 6: попросить хост перерисовать фон в следующем кадре (анимация). */
export function requestAmbientFrame(): void
/** Хост: подписка на setAmbientLayer и requestAmbientFrame. */
export function subscribeAmbient(cb: () => void): () => void
```

На этапе 5 слой никто не ставит. Хост (`GraphCanvas`) при `getAmbientLayer() === null` фоновые canvas не измеряет и не
рисует. Остановку анимации (скрытое окно, `prefers-reduced-motion`, выключенный «Живой фон», «Классика») решает этап 6.

### 3.6 `src/lib/hotkeyGuards.ts`

```ts
export function isEditableTarget(el: EventTarget | null): boolean   // input, textarea, select, contenteditable
/** Открыт диалог, меню, поповер, список выбора (Base UI) либо быстрая запись / палитра / мобильное меню. */
export function overlayOpen(): boolean
/** Открыт модальный лист деталей ([data-detail-sheet]). */
export function detailSheetOpen(): boolean
```

Логика — копия из `useHotkeys.ts` (`isEditable`, `overlayOpen`, селектор `OPEN_OVERLAY`). Существующие файлы на этот
модуль не переводятся (пакет `graph-nav` может перевести `useHotkeys.ts`, это необязательно).

### 3.7 CSS (весь CSS этапа — только этот пакет)

**`src/index.css`**, блок `:root` «Классики», рядом с «Запасными значениями токенов пиксельных сцен»:

```css
/* Граф («Классика»): без рамок и теней, тонкие линии. Пиксельные сцены — styles/scenes.css. */
--ground: var(--background);
--label: var(--foreground);  --label-edge: var(--background);
--graph-bg: var(--background);
--graph-node-edge: transparent;  --graph-shadow: transparent;
--graph-inbox: var(--brand);     --graph-inbox-edge: var(--background);
--graph-sel: var(--brand);       --graph-sel-edge: transparent;
--graph-hover: var(--foreground);
--graph-link: color-mix(in srgb, var(--muted-foreground) 50%, transparent);
--graph-link-alt: var(--graph-link);  --graph-link-edge: transparent;
--graph-link-hot: var(--brand);
```

**`src/styles/scenes.css`**: в каждый из восьми блоков сцен — `--ground` (значения мокапа, `SCENES` в `mockup/app.js`):
Луг `#86ab5e` / ночь `#1f3038`; Осень `#c2a55e` / `#2c2132`; Бумага `#eadbb4` / `#23232f`; Зима `#dde7ee` / `#1c2740`.
В блок `:root.pixel`:

```css
/* Граф */
--graph-bg: var(--ground);
--graph-node-edge: var(--wood-dark);  --graph-shadow: var(--shadow);
--graph-inbox: var(--brand);          --graph-inbox-edge: var(--wood-dark);
--graph-sel: var(--gold);             --graph-sel-edge: var(--wood-dark);
--graph-hover: var(--label);
--graph-link: var(--rope-b);  --graph-link-alt: var(--rope-a);  --graph-link-edge: var(--rope-edge);
--graph-link-hot: var(--gold);
```

Поля `GraphTheme` ← переменные: `cat[k]` ← `--cat-<k>` (`none` ← `--cat-none`); `nodeEdge` ← `--graph-node-edge`;
`shadow` ← `--graph-shadow`; `inbox`, `inboxEdge`, `sel`, `selEdge`, `hover` ← одноимённые `--graph-*`;
`link`/`linkCss` ← `--graph-link`; `linkAlt` ← `--graph-link-alt`; `linkEdge` ← `--graph-link-edge`;
`linkHot`/`linkHotCss` ← `--graph-link-hot`.

**`src/styles/pixel.css`** — новый раздел в конец файла, перед разделом «Телефон» (нумерацию сдвинуть):

```css
/* ───────── 6. Граф ───────── */
.pixel .px-graph-stage { background-color: var(--graph-bg); border: 2px solid var(--wood-dark); }
/* сцена обрезает содержимое: обводка фокуса — внутрь */
.pixel .px-graph-stage:focus-visible { outline-offset: -4px; }
.pixel .px-graph-stage canvas { image-rendering: pixelated; }
/* подпись ноды: светлый текст с тёмным контуром прямо на земле сцены (mockup .node .label) */
.pixel .px-graph-label {
  background: transparent; color: var(--label); font-weight: var(--fw-m);
  text-shadow: 2px 0 0 var(--label-edge), -2px 0 0 var(--label-edge), 0 2px 0 var(--label-edge), 0 -2px 0 var(--label-edge),
    2px 2px 0 var(--label-edge), -2px 2px 0 var(--label-edge), 2px -2px 0 var(--label-edge), -2px -2px 0 var(--label-edge);
}
/* подпись выбранной ноды и её соседей — на плашке */
.pixel .px-graph-label[data-plate="true"] {
  background: var(--paper); color: var(--ink); text-shadow: none; outline: 2px solid var(--wood-dark);
}
```

Остальной DOM графа собирается из существующих примитивов: всплывающие — `px-pop`, кнопки — `ui/button` и `px-btn`,
чип масштаба — `px-chip`, образец цвета — `px-sw`. Новых примитивов нет. Если исполнителю волны 1 не хватает
правила — запись в свой файл прогресса, раздел «Нужно в pixel.css» (правило `spec-stage3.md` §3.12).

### 3.8 `docs/DESIGN.md` — добавить раздел «13. Граф»

Коротко и нормативно: слои сцены (§1.1); ноды и связи рисует canvas, цвета — только из `--graph-*` и `--cat-*` через
`readGraphTheme`; в компонентах графа цветов нет; сцена — `px-graph-stage`, подпись — `px-graph-label`
(`data-plate`); выделение — золото с тёмной кромкой (правило про золото), в «Классике» — brand; приглушение — альфа
0.2, архив — 0.45; масштаб только ступенями; координаты рисования целые. В таблицу §5 — строки `px-graph-stage` и
`px-graph-label`. В §3 — строка про `--ground` и `--graph-*`.

### 3.9 `src/components/items/FilterBar.tsx` — проп `mode` (уточнено при сверке: перенесено из `graph-chrome`)

`FilterBar` — общий компонент списков, его импортирует `GraphView` (волна 2), поэтому правка — в волне 0. Проп
`mode?: 'list' | 'graph'` (по умолчанию `'list'`). В режиме `'graph'` блок сортировки и вида (`sortBlock`) не рисуется
ни на ПК, ни на телефоне; всё остальное (типы, категория, теги, «Без тегов и категории», период, активные чипы,
«Сохранить поиск», «Сбросить фильтры», перенос быстрого периода через сутки — `rollDatePreset`) — без изменений. В
режиме `'list'` поведение и разметка прежние (вызовы без пропа не меняются).

Критерии готовности: `graph-base` — `npm run typecheck`, `npm test` зелёные. `graph-look` — то же; «Классика» и
пиксельные сцены на существующих экранах не изменились (новые переменные и правила никем не используются, `FilterBar`
без пропа — прежний).

---

## 4. Волны 1 и 2 (уточнено при сверке: `graph-screen` — волна 2)

### 4.0 Общие правила

1. Действуют сквозные правила `spec-stage3.md` §3 (одна разметка на оба стиля, примитив сильнее утилит, значки только
   `<Icon>`, размеры шрифта токенами, без `!`, CSS не править, git не трогать, файл прогресса
   `.progress/agents/stage5-<пакет>.md`).
2. (уточнено при сверке) **Волны без взаимных импортов.** Пакеты волны 1 импортируют только волну 0 и свои файлы;
   `typecheck` после каждого пакета проходит целиком. `GraphView` (волна 2, `graph-screen`) импортирует экспорты волны 1
   ниже — сигнатуры обязательны, менять их нельзя. Каркасы «первым действием» не нужны.

| Файл (владелец, волна) | Обязательный экспорт | Кто импортирует |
|---|---|---|
| `src/lib/graph/draw.ts` (graph-paint, 1) | `drawNodes`, `drawLinksPixel`, `drawLinksClassic`, `linkUnit`, тип `LinkBuffer` (§4.1) | `GraphCanvas.tsx` |
| `src/components/graph/GraphOverlay.tsx` (graph-dom, 1) | `export function GraphOverlay(props: GraphOverlayProps)`; `export interface GraphOverlayProps { scene: GraphScene; items: ReadonlyMap<string, Item>; categories: readonly Category[] }` | `GraphView.tsx` |
| `src/components/graph/GraphHeader.tsx` (graph-chrome, 1) | `export function GraphHeader(props: { total: number; matched: number; links: number; filtered: boolean })` | `GraphView.tsx` |
| `src/components/graph/GraphToolbar.tsx`, `GraphHint.tsx` (graph-chrome, 1) | `export function GraphToolbar()`, `export function GraphHint()` (без пропсов) | `GraphView.tsx` |
| `src/components/items/FilterBar.tsx` (graph-look, 0) | проп `mode?: 'list' \| 'graph'` (§3.9) | `GraphView.tsx` |

   Раздел «Граф» открывается только после волны 2 (`AppShell` — у `graph-screen`). Поэтому `graph-dom` и `graph-chrome`
   сдают работу без браузера (typecheck, тесты, вычитка по образцам `ItemMenu.tsx`, `ItemsView.tsx`), а их сценарии
   §4.3 и §4.4 проходит `graph-screen` и записывает замечания по чужим файлам в свой отчёт (чужие файлы не правит).
   Состояние до волны 2 можно смотреть только для `graph-nav` (клавиша `5` и пункт ставят `view = 'graph'`, раздел пуст;
   `#/graph` после перезагрузки до волны 2 не сохраняется — `VIEWS` ещё не знает раздела).
3. Порты dev-серверов (`npm run dev -- --port <порт> --strictPort`; у каждого порта своя IndexedDB): graph-screen 5190,
   graph-nav 5193. Порт 5173 — основной сессии, не трогать.
4. Матрица проверки в браузере: «Осень» день и ночь, «Классика» день и ночь, ширина 1280 и 390 px; бегло «Луг»,
   «Бумага», «Зима». «Классика» на остальных экранах не должна измениться.
5. Состоянием графа можно управлять из консоли dev-сервера, не дожидаясь соседей:
   `const { useGraph } = await import('/src/store/graph.ts')`, затем `useGraph.getState().openMenu({ id, x: 200, y: 200 })`,
   `useGraph.setState({ hoveredId: id })`, `(await import('/src/store/ui.ts')).useUi.getState().select(id)` и т.п.

### 4.1 Пакет `graph-paint` (opus) — `src/lib/graph/draw.ts`, `draw.test.ts`

Чистые функции «сцена → вызовы canvas». Все координаты в `fillRect`/`putImageData` — целые пиксели устройства.

```ts
export interface LinkBuffer { width: number; height: number; data: Uint32Array }   // data — вид на ImageData.data.buffer
/** Сторона «пикселя» связи в пикселях устройства: max(1, round(2 · zoom · dpr)). */
export function linkUnit(zoom: number, dpr: number): number
/** Пиксельные сцены: связи в буфер (хост перед вызовом обнуляет data). Возвращает число нарисованных связей. */
export function drawLinksPixel(buf: LinkBuffer, scene: GraphScene, v: GraphViewport, theme: GraphTheme, state: DrawState): number
/** «Классика»: связи линиями. Возвращает число нарисованных связей. */
export function drawLinksClassic(ctx: CanvasRenderingContext2D, scene: GraphScene, v: GraphViewport, theme: GraphTheme, state: DrawState): number
/** Ноды, выделение, перетаскиваемая нода, цель протяжки. Возвращает число нарисованных нод. */
export function drawNodes(ctx: CanvasRenderingContext2D, scene: GraphScene, v: GraphViewport, theme: GraphTheme, state: DrawState): number
```

Общее: `t = deviceTransform(v)`, `k = t.k`. Центр ноды: `X = t.ox + round(x·k)`, `Y = t.oy + round(y·k)`.
Отсечение: ноды — `queryBounds(scene.index, scene.nodes, visibleBounds(v, 32))`, в порядке сцены; связь рисуется, если
её отрезок пересекает прямоугольник экрана (отсечение Лианга — Барски в пикселях устройства; рисуется только видимая
часть).

**Связи, пиксельные сцены.** `u = linkUnit(zoom, dpr)`. Решётка «пикселей» привязана к миру: блок с номером `(i, j)`
занимает `u×u` пикселей устройства с углом `(t.ox mod u + i·u, t.oy mod u + j·u)` — при сдвиге связи едут вместе с
нодами. Линия Брезенхэма по номерам блоков между центрами нод. Обычная связь: один блок на шаг, цвет чередуется
`theme.link` / `theme.linkAlt` через два шага (`(i >> 1) & 1`); `cross` — пунктир: шаги с `i % 8 ≥ 5` пропускаются.
Приглушённая связь: тот же цвет с альфой × `GRAPH_ALPHA_DIM` (альфа — в байте цвета; пересчитать один раз на вызов).
Порядок: приглушённые → обычные → горячие. Горячая связь (оба конца — выбранная, наведённая нода или нода под
курсором клавиатуры и её сосед; либо `state.hotLink`; либо `state.tempLink` — от ноды к точке мира): сначала кромка
`theme.linkEdge` квадратом 3×3 блока на каждом шаге, затем сердцевина `theme.linkHot`, без пунктира, без приглушения.
Запись — прямо в `buf.data` с проверкой границ.

**Связи, «Классика».** Толщина `max(1, round(dpr))`. Три прохода, каждый — один `beginPath` … `stroke`:
приглушённые (`globalAlpha = GRAPH_ALPHA_DIM`), обычные, горячие (`theme.linkHotCss`, толщина ×2). Пунктира нет.
`state.tempLink` — в горячем проходе.

**Ноды.** `s = max(2, round(GRAPH_NODE_SIZE · k))`, левый верхний угол `X0 = X − floor(s/2)`. Рамка
`b = theme.nodeEdge && k ≥ 0.5 ? max(1, round(2·k)) : 0`. Проходы (каждый — минимум смен `fillStyle`; ноды в сцене уже
упорядочены: приглушённые, затем по цвету):
1. тень (только `theme.shadow` и `k ≥ 0.5`): прямоугольник `s×s` со сдвигом `(b, b)`;
2. рамка (`b > 0`): `s×s` цветом `theme.nodeEdge`;
3. заливка: `(s − 2b)×(s − 2b)` цветом `theme.cat[node.color]`;
4. метка «Входящие» (`node.inbox`, `k ≥ 0.5`): квадрат `m = max(2, round(6·k))` в правом верхнем углу с вылетом `b`
   наружу: кромка `theme.inboxEdge` `m×m`, внутри `theme.inbox` с отступом `max(1, b)`, если остаётся ≥ 1 px, иначе
   весь квадрат `theme.inbox`.

Альфа: приглушённая — `GRAPH_ALPHA_DIM`; иначе архивная — `GRAPH_ALPHA_ARCHIVED`; иначе 1 (`globalAlpha` меняется
только на границах групп; в конце возвращается 1).

Выделение (после всех нод, альфа 1; рамка = четыре `fillRect`; `w = max(1, round(2·k))`):
- соседи выбранной ноды — рамка `w` цветом `theme.sel` вплотную снаружи квадрата;
- наведённая нода и нода под курсором клавиатуры — рамка `w` цветом `theme.hover` вплотную снаружи;
- выбранная нода — рамка `w` цветом `theme.sel` с зазором `w` от квадрата; если `theme.selEdge` — ещё рамка `w`
  этим цветом снаружи золотой (золото с тёмной кромкой, DESIGN §3);
- `state.drag`: нода рисуется на своём месте с альфой 0.3, ещё раз — в точке `(drag.x, drag.y)` с тенью, сдвинутой на
  `2b`; клетка `drag.drop` — рамка `w` цветом `theme.hover`;
- `state.tempLink.targetId` — рамка, как у выбранной ноды.

Тесты `draw.test.ts` (подставной контекст, записывающий вызовы и значения `fillStyle`/`globalAlpha`/`lineWidth`;
буфер — обычный `Uint32Array`):
- все аргументы `fillRect` целые при `dpr` 1, 1.25, 1.5 и всех ступенях;
- ноды вне экрана не рисуются; на границе — рисуются;
- пиксельная тема: тень, рамка, заливка; «Классика» (`nodeEdge: null`) — одна заливка на ноду;
- масштаб 0.25: без рамки, тени и метки;
- альфа приглушённых и архивных; после вызова `globalAlpha === 1`;
- выбранная нода: золотая рамка и кромка; соседи; наведённая;
- перетаскивание и цель протяжки;
- связи в буфере: диагональ — непрерывная цепочка блоков `u×u`; пунктир у `cross`; приглушённая — альфа в цвете;
  горячая — кромка и сердцевина; связь вне экрана не трогает буфер; запись не выходит за границы буфера;
- «Классика»: по одному `stroke` на проход;
- 2000 нод и 3000 связей на масштабе 0.125 (всё на экране 1600×1000): `drawLinksPixel` + `drawNodes` с подставным
  контекстом — < 60 мс.

Критерии: тесты и typecheck своих файлов зелёные. Браузер не нужен (вид проверит `graph-screen` и приёмка).

### 4.2 Пакет `graph-screen` (opus) — волна 2 (уточнено при сверке)

Идёт после всей волны 1: собирает экран из её файлов. Файлы: `src/views/GraphView.tsx`, `src/components/graph/GraphCanvas.tsx`, `src/components/graph/useGraphGestures.ts`,
`src/components/graph/useGraphKeys.ts`, `src/components/layout/AppShell.tsx`.

#### 4.2.1 `GraphView.tsx` — `export function GraphView()` (без пропсов)

Данные и порядок вычислений — §1.2:
- `all = useItemsWithTrash()`, `fixed = usePositions()`, `categories = useCategories()`; пока `all` или `fixed` не
  прочитаны — пустая сцена с `aria-busy`.
- `layout = computeLayout(toLayoutNodes(all, fixed), categories.map((c) => c.id), fixed)` в `useMemo`.
  (уточнено при сверке) Ключ мемо — не массив `all`, а строка-подпись того, от чего зависит раскладка: по записям
  `toLayoutNodes` — `id`, `categoryId`, `createdAt`, отсортированные `links` (и наличие `deletedAt`), плюс порядок
  категорий и `fixed`. Иначе каждая правка заголовка или текста в панели деталей (новый `updatedAt` → новый `all`)
  пересчитывала бы раскладку 2000 нод.
- **Сохранение новых мест.** Эффект: `layout.placed` непуст → `addPositions` для `placed` без `displaced` и
  `setPositions` для `displaced` (§3.2а, уточнено при сверке). Одна запись за раз
  (флаг «идёт запись»); повтор той же неудавшейся записи не делается (помнить подпись набора; ошибка — один
  `toast.error(describeError(e))`). После записи `usePositions()` отдаёт новые данные, `placed` пустеет.
- **Незаписанные броски.** `pendingMoves: Map<id, GraphPoint>` (состояние экрана): после броска ноды новая точка
  показывается сразу, запись убирается, когда `fixed[id]` совпал с ней (или через 3 с).
- `graphItems` — `all` без корзины; `match = computeGraphMatch(all, graphItems, categories, query, filter)` (пересчёт
  и при смене суток — `useDayKey()`).
- `scene = buildGraphScene({ items: graphItems, positions: layout.positions + pendingMoves, categories, match: match.ids, showArchive })`.
- Эффекты: `setBounds(scene.bounds)`; один раз, когда есть ноды и `viewSize` ненулевой, а `cameraRestored === false` —
  `fitAll()`; смена `useUi.selectedId` на ноду сцены → `ensureVisible` (камера сдвигается, если нода вне экрана);
  выбранная запись ушла в корзину → `select(null)`; `cursorId`/`hoveredId`/`linkFrom` ноды, которой нет в сцене, →
  сброс; при размонтировании — `resetTransient()`.

Разметка:

```tsx
<section aria-label="Граф" className="flex h-full min-h-0 flex-col gap-3 px-4 pt-4 pb-4 md:px-6 pixel:gap-2.5 pixel:p-2.5">
  <GraphHeader total={scene.nodes.length} matched={scene.matched} links={scene.links.length} filtered={match.active} />
  <FilterBar mode="graph" />
  {/* нет ни одной записи для графа → EmptyState; иначе сцена */}
  <div
    ref={stageRef} data-graph-stage tabIndex={0} role="application" aria-label="Граф записей" aria-describedby="graph-a11y-help"
    className="relative min-h-60 flex-1 touch-none overflow-hidden rounded-lg border border-border bg-background outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset px-graph-stage"
  >
    <GraphCanvas scene={scene} stageRef={stageRef} … />
    <GraphOverlay scene={scene} items={itemsById} categories={categories} />
    <GraphToolbar />
    <GraphHint />
  </div>
</section>
```

Пустые состояния (`EmptyState`, значок `graph`): записей для графа нет вовсе — «Граф пуст» / «Добавьте записи — они
появятся здесь квадратами цвета своей категории.» + кнопка «Добавить запись» (`openCapture()`); все записи в архиве,
а архив скрыт — «Все записи в архиве» / «Включите «Архив» на панели графа, чтобы увидеть их.» + кнопка
«Показать архив». При пустой сцене `GraphToolbar` не показывается.

#### 4.2.2 `GraphCanvas.tsx` — холст и перерисовка

- Три canvas (§1.1). Размер основного — `round(cssW · dpr) × round(cssH · dpr)`; `ResizeObserver` на сцене и
  `window.resize` (смена `devicePixelRatio`) → новый размер, `setViewSize(cssW, cssH)`, новый `LinkBuffer`
  (`ctx.createImageData(W, H)`, `new Uint32Array(image.data.buffer)`).
- Тема: `readGraphTheme(stage)` при монтировании и по `subscribeGraphTheme`; после смены — перерисовка.
- **Перерисовка только по запросу**: `invalidate()` ставит один `requestAnimationFrame`; постоянного цикла нет.
  Запрос — при смене сцены, темы, размера, камеры, `hoveredId`, `cursorId`, `selectedId`, `selectedLink`, `linkFrom`,
  состояния жеста (подписка `useGraph.subscribe` / `useUi.subscribe` без перерисовки React на каждый кадр).
- Кадр: `ctx.imageSmoothingEnabled = false`; пиксельная тема — `buf.data.fill(0)`, `drawLinksPixel`; нарисовано > 0 →
  `ctx.putImageData(image, 0, 0)`, иначе `ctx.clearRect`; «Классика» — `clearRect`, `drawLinksClassic`; затем
  `drawNodes`. `DrawState` собирается из сторов и состояния жеста. Время кадра пишется в
  `stage.dataset.drawMs` (для проверки нагрузки).
- Фон этапа 6: при `getAmbientLayer() !== null` — фоновые canvas того же размера, `layer.draw(...)` в каждом кадре и
  по `requestAmbientFrame()`; `nodeNear` — через `scene.index`. Слоя нет — canvas остаются 0×0.
- Курсор мыши: фон — `grab`, сдвиг — `grabbing`, нода и связь — `pointer`, протяжка — `crosshair` (атрибут
  `data-cursor` на сцене + утилиты `data-[cursor=…]:cursor-…`).

#### 4.2.3 `useGraphGestures.ts` — указатель и колесо

Слушатели — на элементе сцены (`pointerdown/move/up/cancel/leave`, `wheel` с `{ passive: false }`, `dblclick`,
`contextmenu`); `setPointerCapture` на время жеста. Нажатия и колесо внутри `[data-graph-ui]` игнорируются.
Точка мира — `screenToWorld`; попадание — `hitNode` (затем `hitLink`).

| Ввод | Действие |
|---|---|
| Движение без кнопок (мышь, перо) | `setHovered(id)`; над связью — «горячая» связь (локально) |
| Левая кнопка на фоне, сдвиг > 4 px | сдвиг (`panBy`), `setDrag('pan')` |
| Средняя кнопка, перетаскивание | сдвиг откуда угодно |
| Клик по фону | `select(null)`, `setCursor(null)`, `selectLink(null)`, `setLinkFrom(null)` |
| Клик по ноде | режим связи (`linkFrom` задан и это другая нода) → `actLinkItems(linkFrom, id)`, `setLinkFrom(null)`; иначе `select(id)`, `setCursor(id)`; сцена получает фокус |
| Левая кнопка на ноде, сдвиг > 4 px | перенос: нода следует за указателем, `drop = findFreeSpot(точка, все положения, id)` (пересчёт не чаще кадра); отпускание → `actMoveNode(id, drop)` + запись в `pendingMoves`; `Esc` — отмена. Выбор не меняется |
| Shift + левая кнопка на ноде, сдвиг; либо перетаскивание от `[data-graph-handle]` | протяжка связи (`setDrag('link')`, `tempLink`); отпускание над другой нодой → `actLinkItems`; мимо — отмена |
| Клик по `[data-graph-handle]` (без сдвига) | жесты не вмешиваются: сработает `onClick` ручки (режим связи) |
| Клик по связи | `selectLink({ a, b, x, y })` (точка клика в мире) |
| Двойной клик по ноде | `centerOn(нода, 1)`; по фону — `zoomStep(1, точка)` |
| Правая кнопка / долгое касание на ноде | `openMenu({ id, x, y })`, `preventDefault`; на фоне — ничего |
| Колесо | `wheelSteps` → `zoomStep(steps, точка)`; с Shift — `panBy(−deltaY, 0)`; всегда `preventDefault` |
| Касание, один палец | сдвиг; без сдвига — как клик |
| Касание, два пальца | начатый сдвиг отменяется; `pinchStep` → `zoomStep(шаг, середина)`, база щипка обновляется после шага |
| `pointercancel`, потеря захвата | отмена жеста без записи |

Перенос ноды и протяжка пальцем не делаются (Р18). После перетаскивания следующий `click` гасится.

#### 4.2.4 `useGraphKeys.ts` — клавиши раздела

Слушатель `keydown` на `document` **в фазе перехвата** (раньше `useHotkeys`), пока смонтирован `GraphView`. Не
работает, если: цель — поле ввода (`isEditableTarget`), открыт слой (`overlayOpen()`), открыт модальный лист
(`detailSheetOpen()`), цель внутри `[data-graph-ui]` *(уточнено: кроме панели инструментов, `role="toolbar"`: после клика по её кнопке клавиши графа работают)*, идёт набор IME, зажат Ctrl/⌘/Alt. Обработанная клавиша —
`preventDefault()` (тогда `useHotkeys` её пропустит). Клавиши `1–5`, `N`, `/` не трогаются. Сравнение — `matchKey` по
`e.code`. Цель действий: `target = cursorId ?? selectedId`. Для `E`, `A`, `F`, `Del` повтор (`e.repeat`) игнорируется.

Стрелки, `Tab`, `Enter`, `Пробел`, `Shift+F10` обрабатываются, только когда фокус на самой сцене
(`[data-graph-stage]`) или на `document.body`: иначе они сломали бы кнопки и поля панели деталей, боковой панели и
панели графа. Буквы, `Del`, `+`/`−`, `0`, `Esc` — при любом фокусе вне полей ввода (как клавиши списков).

| Клавиша | Действие |
|---|---|
| `←` `↑` `→` `↓` | курсор на ближайшую ноду в направлении (`nearestInDirection` от курсора; курсора нет — от выбранной; нет и её — нода, ближайшая к центру экрана); `ensureVisible`; если панель деталей открыта — `select(id)` следует за курсором |
| `Shift` + стрелки | сдвиг на 96 px |
| `Tab` / `Shift+Tab` | у ноды под курсором есть связи → курсор на следующую / предыдущую связанную ноду (`sortByAngle`); *(уточнено: обход один раз, после последнего соседа Tab отдаётся странице — не ловушка)*; иначе клавиша не перехватывается |
| `Enter`, `Пробел` | режим связи → `actLinkItems(linkFrom, cursorId)`; иначе `select(cursorId)` *(уточнено: если запись уже открыта в боковой панели, Enter переводит фокус в неё)* |
| `E` | `openPicker(target)` |
| `L` | `setLinkFrom(target)`; повторно — отмена |
| `A` | архивная → `actUnarchive(target)`, иначе `actArchive(target)` |
| `F` | `actToggleFavorite(запись)` |
| `Del`, `Backspace` | выбрана связь → `actUnlinkItems(a, b)`, `selectLink(null)`; иначе `actDelete(target)`, курсор сбрасывается, если выбрана она же — `select(null)` |
| `+` (`=`, Numpad +), `−` (Numpad −) | `zoomStep(±1)` от центра |
| `0` (Numpad 0) | `fitAll()` |
| `Esc` | по порядку: отмена идущего жеста; `setLinkFrom(null)`; `selectLink(null)`; (детали открыты — не перехватывать: закроет `useHotkeys`); `setCursor(null)` |
| `Shift+F10`, клавиша меню | `openMenu` у ноды `target` (точка — центр ноды на экране) |

#### 4.2.5 `AppShell.tsx`

- `VIEWS` — добавить `'graph'` (адрес `#/graph`).
- `graphLazy = lazyRetry(() => import('@/views/GraphView'), (m) => m.GraphView)`; в `ActiveView` — `case 'graph'` с
  `ErrorBoundary` + `Suspense`, как у настроек (текст сбоя: «Не удалось загрузить граф. Проверьте соединение.»).
  Комментарий «„Граф“ — этап 5» убрать.
- Больше ничего: панель деталей, лист, `inert`, `DetailPane` работают как есть (в графе `DetailPane` вернёт фокус на
  сцену — она была `document.activeElement`).

Критерии готовности: раздел открывается по `#/graph`; ноды и связи резкие на `dpr` 1 и 1.5 (масштаб Windows 150 %);
сдвиг, колесо, двойной клик, перенос (после перезагрузки нода на месте, `updatedAt` записи не изменился), протяжка
связи с Shift, клик по связи, клавиши таблицы; при неподвижном графе `requestAnimationFrame` не вызывается (проверить
счётчиком в консоли); typecheck и тесты зелёные.

Сценарии проверки в браузере (порт 5190, демоданные + нагрузка §6):
1. `#/graph` после перезагрузки: граф вписан; сдвинуть и приблизить, уйти во «Входящие», вернуться — вид тот же;
   перезагрузить — вид тот же.
2. «Осень» день/ночь и «Классика» день/ночь: цвета нод = цвета категорий в боковой панели; смена сцены и темы в
   настройках перекрашивает граф без перезагрузки.
3. Перенести ноду на занятую клетку — встаёт в ближайшую свободную; добавить запись быстрой записью — появляется в
   зоне своей категории, остальные ноды не сдвинулись (сравнить `getPositions()` до и после в консоли).
4. Удалить ноду (`Del`) → toast «В корзине», «Отменить» возвращает на то же место; восстановление из раздела «Корзина» — тоже.
5. Сменить категорию в панели деталей — нода переезжает в зону новой категории.
6. Поиск в верхней строке и чипы фильтров: неподходящие ноды и связи приглушены, остальное без изменений.
7. 390 px: сдвиг пальцем (эмуляция касания), лист деталей, плавающая кнопка не перекрывает панель графа.
8. Нагрузка §6: 2000 записей — `stage.dataset.drawMs` на масштабе 12.5 % и при сдвиге.
9. (уточнено при сверке) Сценарии `graph-dom` (§4.3) и `graph-chrome` (§4.4) целиком: их пакеты браузер не видели.
   Найденное в чужих файлах — в свой отчёт, раздел «Замечания к соседям» (файл, что не так, как воспроизвести).
10. (уточнено при сверке) «Разложить заново» на 2000 записях и сразу «Отменить» — расстановка прежняя; смена категории
    клавишей `E` и сразу «Отменить» — нода на прежнем месте (проверка `addPositions`).

### 4.3 Пакет `graph-dom` (sonnet) — DOM-слой

Файлы: `src/components/graph/GraphOverlay.tsx`, `GraphLabels.tsx`, `GraphTooltip.tsx`, `GraphNodeMenu.tsx`,
`GraphCategoryPicker.tsx`, `GraphLinkTools.tsx`, `GraphA11y.tsx`.

Общее: читают `useGraph` (камера, `viewSize`, `hoveredId`, `cursorId`, `drag`, `linkFrom`, `selectedLink`, `menu`,
`pickerFor`) и `useUi.selectedId`; положение на экране — `worldToScreen({ ...viewSize, dpr: 1, camera }, точка)`.
Все действия — через `lib/actions.ts`. Интерактивные элементы — `pointer-events-auto` + `data-graph-ui` (кроме
ручки связи). Ничего из этого не рисуется во время жеста сдвига/переноса, кроме подписей.

- **`GraphOverlay`** — корень: `<div data-graph-overlay className="pointer-events-none absolute inset-0 overflow-hidden">`
  и все части ниже. Пропсы — `GraphOverlayProps` (§4.0).
- **`GraphLabels`** — подписи. Контейнер с `transform: translate(tx, ty)`, где `tx = round(width/2 − camera.x·zoom)`
  (так же `ty`); дети — `position: absolute`, `left = x·zoom + GRAPH_NODE_SIZE·zoom/2 + GRAPH_LABEL_GAP`,
  `top = y·zoom`, `-translate-y-1/2`. При сдвиге меняется только `transform` контейнера — **императивно**, через
  `useGraph.subscribe`, без перерисовки React. Набор подписей — `pickLabels(scene, visibleBounds с запасом в пол-экрана, zoom, priority)`,
  где `priority = [selectedId, ...соседи выбранной (до 24)]`; пересчёт сразу при смене сцены, масштаба, выбора,
  размера; при сдвиге — с задержкой 120 мс после последнего движения. Элемент: `span`, одна строка, `truncate`,
  `max-w-40`, классы «Классики» `rounded bg-background/85 px-1 text-xs text-foreground`, плюс `px-graph-label`,
  `data-plate`. `aria-hidden`.
- **`GraphTooltip`** — подсказка наведённой ноды (появляется через 250 мс; скрыта при `drag`, открытом меню или
  выборе категории): заголовок (`font-medium`), строка «тип · статус» (`TYPE_LABEL`; «Входящие» / «База знаний» /
  «Архив»), категория с образцом `px-sw`, до четырёх тегов `#тег`, «Связей: N». Справа-снизу от ноды, не выходит за
  сцену. `role="tooltip"`, `pointer-events-none`, вид — `px-pop` + «Классика»
  `rounded-lg border bg-popover p-2 text-xs shadow-md`.
- **`GraphNodeMenu`** — меню ноды по `useGraph.menu`: `DropdownMenu` из `ui` с управляемым `open` и невидимым
  триггером-якорем 1×1 px в точке `(menu.x, menu.y)` (образец использования — `ItemMenu.tsx`). Пункты: «Открыть»
  (`select`), «Категория…» (`openPicker`, подсказка `E`), «Связать с…» (`setLinkFrom`, подсказка `L`), разделитель,
  затем `itemActionList(item)` из `ItemMenu.tsx` (файл не менять). Закрытие — `openMenu(null)`, фокус возвращается на сцену.
- **`GraphCategoryPicker`** — выбор категории по `useGraph.pickerFor`, у ноды (ниже неё): `px-pop` +
  `rounded-lg border bg-popover p-1 shadow-md`, `role="listbox"`, `aria-label="Категория записи"`. Строки: «0 Без
  категории», затем категории по порядку — первые девять с цифрами `1–9` (`Kbd`), образец `px-sw`, имя; текущая —
  `aria-selected`. Фокус при открытии — на текущей строке. Клавиши внутри (с `preventDefault` и `stopPropagation`):
  цифры — выбрать, `↑/↓` — перемещение, `Enter` — выбрать, `Esc` — закрыть. Выбор → `actSetCategory(id, categoryId)`,
  `openPicker(null)`, фокус на сцену. Клик вне списка закрывает. Не выходит за сцену; длинный список прокручивается
  (`max-h-64 overflow-y-auto`, внутренний запас 4 px под обводку фокуса).
- **`GraphLinkTools`** — три части:
  - ручка *(уточнено при исправлениях ревью 5: у правого нижнего угла выбранной ноды снаружи, заход на угол не более 4 px, 20×20 px во всех сценах, `zoom ≥ HANDLE_MIN_ZOOM` (1), только при `min-width: 1100px` и не на касании; ниже — прежний текст)*: у выбранной ноды, если она в сцене, `zoom ≥ 0.5`, `drag === null`: `button[data-graph-handle={id}]` под
    нодой (центр по горизонтали, 6 px ниже), 20×20 px (`pointer-coarse:size-9`), значок `link`, `px-btn` + «Классика»
    `rounded-full border bg-background shadow-sm`, `aria-label` и `title` — «Связать: потяните к другой записи или
    нажмите»; `onClick` → `setLinkFrom(id)` (повторно — `null`); `aria-pressed` в режиме связи;
  - строка режима связи (`linkFrom` задан): сверху по центру, `px-pop`, `role="status"`: «Связать «<заголовок>» —
    выберите вторую запись» + кнопка «Отмена» (`setLinkFrom(null)`); заголовок обрезается;
  - плашка выбранной связи (`selectedLink`): у точки клика, `px-pop`: «<заголовок A> — <заголовок B>» (обрезка) и
    кнопка «Убрать связь» (`actUnlinkItems(a, b)`, затем `selectLink(null)`); клик вне — `selectLink(null)`.
- **`GraphA11y`** — `p#graph-a11y-help.sr-only` (на него ссылается `aria-describedby` сцены): «Стрелки — переход между
  записями, Tab — по связям, Enter — открыть, E — категория, L — связать, A — в архив, F — избранное, Delete — в
  корзину, плюс и минус — масштаб, ноль — весь граф.»; и `div.sr-only[aria-live="polite"]` с описанием ноды под
  курсором (`cursorId ?? selectedId`): «<заголовок>. <тип>. Категория: <имя | без категории>. <статус>. Связей: N.»;
  в режиме связи — «Выберите запись для связи».

Критерии готовности пакета (уточнено при сверке): typecheck и тесты зелёные; в своих файлах выполнены правила этого
раздела — подписи двигаются только через `transform` контейнера из `useGraph.subscribe` (без перерисовки React на
кадр), цифры в выборе категории гасятся `preventDefault` + `stopPropagation`, все зоны нажатия на телефоне ≥ 36 px
(`pointer-coarse:`), оба стиля через примитивы. Браузер пакету недоступен (§4.0 п. 2).

Сценарии (проходит `graph-screen` в волне 2; состояние можно ставить из консоли, §4.0 п. 5): подписи на 100 % и их отсутствие на 75 %;
плашки у выбранной ноды и соседей; подсказка при наведении; правая кнопка → меню, каждый пункт; `E` → выбор
категории цифрой, отмена через toast возвращает категорию и место; ручка: потянуть к ноде, клик → режим → клик по
ноде; клик по связи → «Убрать связь» → «Отменить»; 390 px — ручка и плашки не выходят за сцену.

### 4.4 Пакет `graph-chrome` (sonnet) — заголовок, панель, подсказка

Файлы: `src/components/graph/GraphHeader.tsx`, `GraphToolbar.tsx`, `GraphHint.tsx`. (уточнено при сверке) `FilterBar.tsx`
перенесён в `graph-look` (§3.9): общий компонент — волна 0.

- **`GraphHeader`** — как заголовок `ItemsView`: `h1` «Граф» (`font-heading text-lg font-semibold tracking-tight
  pixel:text-2xl pixel:tracking-normal`); счётчик (`text-2sm text-muted-foreground tabular-nums`, `aria-live="polite"`):
  при `filtered` — «подходит {matched} из {total}», иначе «{total} · связей: {links}» (при `total === 0` счётчика
  нет); справа подсказка клавиш (`ml-auto hidden min-w-0 truncate text-2sm text-muted-foreground
  pixel:lg:pointer-fine:inline`): «Колесо — масштаб · E — категория · L — связь · 0 — весь граф».
- **`GraphToolbar`** — `div[data-graph-ui]`, `absolute bottom-2 left-2 z-10 flex items-center gap-1` (на телефоне —
  с учётом `env(safe-area-inset-left)`), `role="toolbar"`, `aria-label="Управление графом"`. Кнопки `ui/button`
  (`variant="outline"`, `size="icon-sm"`, на телефоне 36 px): «Уменьшить» (`minus`, выключена на первой ступени),
  чип масштаба («100 %», `px-chip` + `rounded-md border bg-background px-1.5 text-xs tabular-nums`, ширина постоянная),
  «Увеличить» (`plus`, выключена на последней ступени), «Весь граф» (`maximize`, `title="Весь граф (0)"`),
  «Разложить заново» (`layout`, `actRelayoutGraph()`), «Архив» (`eye` / `eye-off`, `aria-pressed={showArchive}`,
  `title` «Показывать архив»). У каждой — `aria-label` и `title`. Источник — `useGraph`.
- **`GraphHint`** — первая подсказка: показывается, пока `hintSeen === false`; `div[data-graph-ui]`,
  `absolute top-2 left-2 z-10 max-w-xs`, `px-pop` + `rounded-lg border bg-popover p-3 text-2sm shadow-md`,
  `role="note"`. Текст для мыши (`pointer-coarse:hidden`): «Двигайте граф, перетаскивая фон; колесо меняет масштаб.
  Клик по записи открывает её, перетаскивание — переносит. Чтобы связать записи, потяните значок связи у выбранной
  записи к другой.» Текст для касания (`hidden pointer-coarse:block`): «Двигайте граф пальцем, масштаб — двумя
  пальцами. Касание открывает запись. Чтобы связать записи, нажмите значок связи у выбранной записи, затем вторую
  запись.» Кнопка «Понятно» → `dismissHint()`.

Критерии (уточнено при сверке): typecheck и тесты зелёные; разметка по образцу заголовка `ItemsView.tsx`, кнопки —
`ui/button` + `px-btn`, всплывающие — `px-pop`; на телефоне кнопки 36 px. Браузер пакету недоступен (§4.0 п. 2).

Сценарии (проходит `graph-screen` в волне 2): кнопки масштаба и чип; «Весь граф»; «Разложить заново» → toast → «Отменить» возвращает
расстановку; «Архив» скрывает и возвращает архивные ноды, выбор переживает перезагрузку; подсказка закрывается и
после перезагрузки не появляется; в графе у панели фильтров нет сортировки и вида, в списках — есть.

### 4.5 Пакет `graph-nav` (sonnet) — навигация, клавиша, палитра, настройки

Файлы: `src/components/layout/Sidebar.tsx`, `src/hooks/useHotkeys.ts`, `src/components/palette/CommandPalette.tsx`,
`src/views/settings/ShortcutsSection.tsx`.

- **`Sidebar.tsx`**:
  - `NAV_ITEMS`: после «Архива», перед «Корзиной» — `{ view: 'graph', label: 'Граф', icon: 'graph' }`; поле `count`
    сделать необязательным (у «Графа» счётчика нет). Комментарий-заглушку убрать; комментарий о порядке — «клавиши 1–5».
  - В разделе «Граф» клик по категории и по тегу **раздел не меняет**: категория — `setFilter({ categoryId })`,
    повторный клик по той же — `setFilter({ categoryId: undefined })`; тег — `setFilter({ tags: [tag] })`, повторный —
    `setFilter({ tags: undefined })`. Подсветка (`active` / `aria-pressed`) — при `view === 'graph'` так же, как при
    «Базе знаний». Вне «Графа» поведение прежнее.
- **`useHotkeys.ts`**: `VIEW_BY_DIGIT` — `Digit5: 'graph'`. Больше ничего.
- **`CommandPalette.tsx`**:
  - действие `{ id: 'go-graph', label: 'Перейти: Граф', icon: 'graph', run: () => go('graph') }` после `go-archive`;
    заглушку-комментарий убрать;
  - только при `view === 'graph'`: «Граф: показать весь» (`maximize`, `useGraph.getState().fitAll()`), «Граф:
    разложить заново» (`layout`, `actRelayoutGraph()`), «Граф: показать архив» / «Граф: скрыть архив» (`eye` /
    `eye-off`, `setShowArchive`); палитра закрывается; зависимости `useMemo` дополнить;
  - выбор категории или тега из палитры при `view === 'graph'` — не уводит в «Базу знаний»: `setQuery('')`,
    `setFilter(patch)`, закрыть. Выбор записи — через `openItemInSection` (в графе остаётся в графе, §3.2).
- **`ShortcutsSection.tsx`** — строки (подписи уникальны — они же ключи):
  - `[['1'], ['2'], ['3'], ['4'], ['5']]` — «Разделы: Входящие, База знаний, Избранное, Архив, Граф»;
  - `[['←', '↑', '↓', '→']]` — «На графе: переход между записями»; `[['Tab']]` — «На графе: по связям записи»;
  - `[['Enter']]` — «На графе: открыть запись»; `[['E']]` — «На графе: категория»; `[['L']]` — «На графе: связать с
    другой записью»; `[['A']]` — «На графе: в архив»; `[['F']]` — «На графе: в избранное»; `[['Del']]` — «На графе:
    в корзину или убрать выбранную связь»;
  - `[['+'], ['−']]` — «На графе: масштаб»; `[['0']]` — «На графе: весь граф»; `[['Shift', '←↑↓→']]` — «На графе:
    сдвиг». Описание секции дополнить: «На графе колесо мыши меняет масштаб, перетаскивание фона сдвигает вид.»

Критерии: клавиша `5`, пункт боковой панели и команда палитры ставят раздел «Граф» (до волны 2 он пуст — §4.0 п. 2;
`#/graph` после перезагрузки проверяет `graph-screen`); клавиши `1–4` и остальное поведение не изменились; typecheck
зелёный.

Сценарии (порт 5193): `5` и возврат `1`; активный пункт «Граф»; в графе клик по категории и тегу подсвечивает пункт
и не меняет раздел, повторный клик снимает; вне графа категория по-прежнему открывает «Базу знаний»; палитра:
«Перейти: Граф», команды графа видны только в графе; строки в «Настройки → Горячие клавиши» в обоих стилях; 390 px —
пункт «Граф» в выезжающем меню.

---

## 5. Тексты (сводка, чтобы не разошлись)

| Где | Текст |
|---|---|
| Раздел, пункт, команда | «Граф», «Перейти: Граф» |
| Счётчик | «подходит N из M»; «M · связей: L» |
| toast | «Записи связаны», «Записи уже связаны», «Связь убрана», «Категория: <имя>», «Без категории», «Граф разложен заново», кнопка «Отменить» |
| Панель графа | «Уменьшить», «Увеличить», «Весь граф», «Разложить заново», «Показывать архив» |
| Связь | «Связать: потяните к другой записи или нажмите»; «Связать «<заголовок>» — выберите вторую запись»; «Отмена»; «Убрать связь» |
| Меню ноды | «Открыть», «Категория…», «Связать с…» + пункты `itemActionList` |
| Пустые состояния | «Граф пуст» / «Добавьте записи — они появятся здесь квадратами цвета своей категории.» / «Добавить запись»; «Все записи в архиве» / «Включите «Архив» на панели графа, чтобы увидеть их.» / «Показать архив» |

---

## 6. Проверка нагрузки (dev, без изменения контракта seed)

На своём порту (отдельная IndexedDB) открыть приложение, в консоли браузера:

```js
const repo = await import('/src/db/repo.ts')
const cats = []
for (let i = 0; i < 10; i++) cats.push(await repo.createCategory('Нагрузка ' + i))
const ids = []
for (let i = 0; i < 2000; i++) {
  const it = await repo.createItem({
    type: 'text', content: 'Запись ' + i, source: 'demo',
    categoryId: i % 11 === 0 ? null : cats[i % 10].id,
    status: i % 4 === 0 ? 'inbox' : i % 17 === 0 ? 'archive' : 'library',
  })
  ids.push(it.id)
}
for (let i = 0; i < 3000; i++) await repo.linkItems(ids[(i * 7919) % 2000], ids[(i * 104729 + 13) % 2000])
```

(1000 записей — заменить числа.) Очистка — «Настройки → Данные → Удалить все данные». Ориентиры на машине разработки:
первая раскладка 2000 записей — до 300 мс, кадр (`document.querySelector('[data-graph-stage]').dataset.drawMs`) на
масштабе 12.5 % — до 8 мс, сдвиг и масштаб без рывков, наведение не вызывает пересборку сцены; добавление одной
записи не сдвигает остальные.

---

## 7. Приёмка основной сессией и риски

Приёмка после волны 1: `npm run typecheck`, `npm test`, `npm run build` (граф — отдельный чанк через `lazyRetry`);
сценарии §4.2–§4.5 целиком в «Осени» и «Классике», 1280 и 390 px; нагрузка §6; масштаб Windows 150 % (резкость);
затем ревью этапа и коммит.

Риски:
1. (уточнено при сверке) `graph-dom` и `graph-chrome` пишут DOM без браузера (раздел открывается только после волны 2).
   Их вид и поведение впервые видит `graph-screen`; правки по его замечаниям — на шаге доводки основной сессии.
2. `putImageData` всего кадра на очень больших окнах (4K при 150 %) — ~8 млн пикселей; если кадр выйдет за 8 мс,
   запасной путь — обновлять только прямоугольник, покрывающий нарисованные связи (`dirty`-параметры `putImageData`).
3. Мелкие квадраты на живом фоне этапа 6 — риск плана; контракт `nodeNear` даёт этапу 6 «поляны» под нодами.
4. Окружённая зона при сильном росте уходит «островом» (Р8) — показать пользователю, при необходимости на этапе 8
   добавить подсказку «Разложить заново».
5. `spec-stage2.md` §2.6 и §5.3 после этапа устаревают в части графа (архив, `focusZone`, `toLayoutNodes`). Истина — код и этот файл.

---

## 8. Открытые вопросы (исполнение идёт по умолчаниям)

1. Архив на графе показывается приглушённо, переключатель «Архив» (раньше: не показывается). По умолчанию — показывать.
2. Масштаб ступенями 12.5–200 %; колесо масштабирует (прокрутка двумя пальцами на тачпаде — тоже масштаб).
3. «Разложить заново» — без вопроса, с «Отменить» на 10 с.
4. Tab ходит по связям текущей ноды; без связей Tab уходит из графа обычным образом.
5. Двойной клик по ноде приближает её (а не открывает ссылку).
6. Телефон: перенос ноды и протяжка связи пальцем не поддерживаются; связь — «значок связи → вторая запись».
7. Подписи при 100 % в плотной зоне видны только там, где не закрывают соседей; у выбранной ноды и её соседей — всегда.
8. Клик по категории и тегу в боковой панели в «Графе» — тот же фильтр, что в панели фильтров (отдельного «фокуса зоны» нет).
9. Сохранённый поиск в «Графе» остаётся в «Графе».
10. Фон графа в пиксельных сценах — ровный цвет земли; плитка и пейзаж — этап 6.
11. Панель графа — плавающая в углу сцены, слот верхней панели не используется.
12. Зона, зажатая соседями, при росте продолжается за ними отдельным участком; ноды разных категорий не смешиваются.
13. (уточнено при сверке) Часть таких участков — одиночные «тропки» по середине коридоров между чужими зонами (§2.2,
    проверка моделью). Возможное улучшение (не входит в этап): отдельный участок зоны начинать только там, где в
    квадрате 9×9 нет чужих нод; в модели мелкие обрывки 5 + 4 + 3 + 2 сменились одним участком из 14 нод.

## Уточнения при исправлениях ревью 5 (доводка)

- **§2.2 и §4.2.3, выбор ноды.** Одиночный клик мышью или пером откладывает `select` на `GRAPH_SELECT_DEFER_MS`
  (= `GRAPH_DBL_MS`, 500 мс), если выбор меняет то, что под указателем: окно уже 1100 px (модальный лист и подложка)
  или боковая панель закрыта и клик в её полосе `DETAIL_ASIDE_PX` у правого края окна (`deferSelect`,
  `underDetailPanel`). Новое нажатие, двойной клик, Esc отменяют отложенный выбор.
- **Память двойного клика.** `secondClickNode(prev, p, now, view)` отдаёт ноду первого клика, только если сцена с тех
  пор менялась (другие ссылки `camera` / `viewSize` в сторе); иначе нода — та, что под указателем (на 25 % соседняя
  нода в допуске 8 px). Нажатие на ручку связи, которая заходит на угол, во втором клике считается кликом по ноде.
- **§2.6, подписи.** `pickLabels(..., { core })`: предел подписей тратится сначала на ноды видимой части (`core` = `visibleBounds`), затем на запас вокруг. Цвета подписи — `--graph-label` и контур `--graph-label-edge`.
- **`setViewSize(width, height, keep?)`.** Камера подстраивается под сдвиг краёв сцены (`resizeKeep`, `resizeCamera`);
  из 0 возвращается от последнего ненулевого размера (хранится и в `localStorage` рядом с камерой как `w`, `h`),
  доли пикселя держат центр. `cursorByKeys` — курсор поставлен клавиатурой: только у такого курсора есть подсказка.
- **Выбранная нода и переезд.** `revealDecision` возвращает `moved`: при переезде ноды (смена категории, бросок мышью,
  откат записи) камера идёт к ней только за край сцены (запас 0), а не при запасе 64 px.
