# Спецификация этапа 6: Живой фон

Статус: к исполнению. Автор: `spec-stage6` (архитектор). Дата: 2026-11-13. Сверка: `spec-stage6-review` (2026-11-13),
правки помечены «(уточнено при сверке)», итог — §11.
Основание: `.progress/plan-combined.md` («Этап 6. Живой фон», риск этапа 5 про читаемость), `docs/DESIGN.md` §11, §13,
`.progress/spec-stage5.md` §3.5, `src/lib/graph/ambient.ts`, образец — `mockup/forest.js`, `mockup/weather.js`,
`mockup/app.js` (`SCENES`, `sceneTile`, `drawFx`, `drawWeather`), `mockup/pixelfx/`.

Правила `CLAUDE.md` в силе: сигнатуры не менять (только добавлять), тексты по-русски, `verbatimModuleSyntax`,
`erasableSyntaxOnly` (без enum, namespace, parameter properties), `noUnusedLocals/Parameters`. Зависимости не добавляются.
Субагенты не коммитят и не трогают git; каждый ведёт `.progress/agents/stage6-<ключ>.md`.

---

## 0. Что есть сейчас (сверено по коду)

- `GraphCanvas.tsx` держит три canvas: `back` (фон), `main` (связи и ноды), `front` (фон поверх нод). `main` **уже
  прозрачный** (`clearRect` каждый кадр); землю рисует не canvas, а CSS: `.pixel .px-graph-stage { background-color:
  var(--graph-bg) }`, `--graph-bg: var(--ground)`. В `lib/graph/draw.ts` на этапе 6 **ничего не меняется**.
- `back` и `front` имеют размер 0, пока `getAmbientLayer() === null`; слой никто не ставит.
- Хост перерисовывается по запросу (`invalidate` → один `requestAnimationFrame`), постоянного цикла нет.
  `subscribeAmbient(invalidate)` — сейчас и смена слоя, и `requestAmbientFrame()` перерисовывают **весь граф**.
- Настройка «Живой фон»: `Settings.ambient` (`src/types.ts`, по умолчанию `true`), переключатель —
  `src/views/settings/AppearanceSection.tsx`, значение отдаёт `useScene().ambient`. **Никем не читается** — эффекта нет.
- `GraphView` монтируется только в разделе «Граф» (`AppShell`, `lazyRetry`); при пустом графе сцены (`stageEl`) нет.
- `mockup/pixelfx/LICENSE` есть: MIT, Copyright (c) 2026 Patch, Copyright (c) 2026 Hugo Duprez. В каталоге только код
  (графических файлов нет) — переносить можно всё при сохранении текста лицензии.

## 1. Решения

| № | Вопрос | Решение |
|---|---|---|
| Р1 | Где живёт фон | Слой `AmbientLayer` (контракт этапа 5) — движок `src/lib/ambient/engine.ts`. Хост по-прежнему один: `GraphCanvas`. Новых canvas в DOM нет. |
| Р2 | Земля | Остаётся CSS-фоном сцены. Плитки фона прозрачные: на них только мелочь земли, пруды и лес. «Поляна» = ничего не нарисовано = ровная `--ground`, поэтому проверки контраста этапа 5 остаются верными. |
| Р3 | Резкость | Фон рисуется в **решётке устройства**: пиксель графики = `u` пикселей устройства, `u` целое (§2.2). Положения объектов идут от мира, размер спрайта — от `u`. Плитки — блоки решётки, поэтому швов и дробного масштаба нет при любом dpr. |
| Р4 | Мелкий масштаб | Уровни уменьшения графики `lod` 0/1/2 (спрайты ½ и ¼) и «смягчение» цветов к земле от масштаба (`softenFor`): на обзоре фон бледнеет и не спорит с нодами. |
| Р5 | Поляны | Чистая структура `Clearing` из точек нод. Объект леса скрыт, если нода попадает в его рамку поляны (спрайт с запасом); пруд рядом с нодой скрыт целиком; мелочь земли под нодами не рисуется. Перенос ноды сцену не меняет до броска — поляна меняется один раз, плитки сменяются растворением в 3 шага (≈250 мс), в неподвижном режиме — сразу. |
| Р6 | Эффекты | Низкое разрешение (арт-пиксель экрана `e` пикселей устройства), растры `Uint32Array`, ≈12 кадров/с, целочисленное увеличение. Под нодами — листопад; над нодами — лучи с пылинками, снег, бабочки, светлячки (порядок мокапа: `#forest → #wx → ноды → #rays → #fx`). |
| Р7 | Планировщик | Отдельный чистый модуль с внедрёнными таймерами. Цепочка «таймер → `requestAmbientFrame()` → кадр хоста → `consume()` → новый таймер»: если кадр не нарисован (окно не рисуется), следующий таймер не взводится. Собственного `requestAnimationFrame` у фона нет. |
| Р8 | Кадр фона ≠ кадр графа | `subscribeAmbient` получает причину (`'layer' | 'frame'`); по `'frame'` хост вызывает только `layer.draw`, граф не перерисовывает. |
| Р9 | Режимы | `off` — слоя нет, ровная земля: раздел не «Граф» / сцены графа нет, «Живой фон» выключен, «Классика». `static` — лес и пруды нарисованы, эффектов и таймеров нет: `prefers-reduced-motion` или окно скрыто. `animated` — всё. |
| Р10 | pixelfx | Ядро **не переносится**. В `src/lib/pixelfx/` — малая часть на TypeScript (хеш/случайность, цвет, `trips`, листопад, лучи) с `LICENSE` и `README.md`. Снег, светлячки, бабочки — свои рисовальщики в `src/lib/ambient/effects/`. Обоснование — §5.2. |
| Р11 | «Бумага» | Без леса и прудов: точечная сетка с шагом сетки графа (точки между нодами), волокна бумаги, редкие кляксы. Эффектов нет. |
| Р12 | Настройка | Один переключатель «Живой фон»; выключен — ровная земля, как сейчас (леса тоже нет). Подпунктов нет. Меняется только подпись. |

## 2. Устройство

### 2.1 Слои (снизу вверх)

```
CSS-фон сцены (--graph-bg)                         земля
canvas[data-graph-ambient="back"]                  плитки (мелочь земли, пруды, лес) → эффекты под нодами (листопад)
canvas[data-graph-canvas]                          связи и ноды (без изменений)
canvas[data-graph-ambient="front"]                 лучи/снег → бабочки/светлячки
div[data-graph-overlay]                            DOM: подписи, подсказка, меню
```

### 2.2 Решётка устройства (`lattice.ts`)

`k = zoom · dpr` (как у `deviceTransform`). `q0 = 2k` — пикселей устройства в номинальном арт-пикселе (1 арт-пиксель
мокапа = 2 px мира).

- `lod = q0 >= 0.75 ? 0 : q0 >= 0.375 ? 1 : 2`; `q = q0 · 2^lod`; `u = max(1, Math.round(q))`.
- `worldPerPx = u / k` — мировых px в пикселе решётки. Мир → решётка: `lx = Math.round(wx / worldPerPx) + 0`.
  Решётка → устройство: `X = device.ox + lx · u`. Расхождение с нодами (`ox + round(wx·k)`) не больше `u/2`.
- Относительный размер спрайта `u/q` лежит в `[0.8, 1.34]` на всех ступенях × dpr 1/1.25/1.5/2 (проверяется тестом).
- Плитка: `size = clamp(Math.round(512 / u), 64, 512)` пикселей решётки; на экране `size · u` (≈512 px устройства).
  Плитка `(ti, tj)` занимает решётку `[ti·size, (ti+1)·size)`, угол на экране `ox + ti·size·u` — всегда целое.
- Смягчение: `softenFor(zoom)`: `>= 1 → 0`, `0.75 → 0.12`, `0.5 → 0.25`, `0.25 → 0.4`, `<= 0.125 → 0.5` (между ступенями —
  значение ближайшей меньшей).
- Арт-пиксель эффектов: `e = max(1, Math.round(2 · dpr))`, растр `w = ceil(W/e)`, `h = ceil(H/e)`; пока
  `w·h > AMBIENT_FX_MAX_PX` — `e += 1` (на 4K эффекты крупнее, зато цена кадра ограничена).

### 2.3 Поток кадра

```
GraphView ── useAmbient(stageEl) ── controller.update(условия, сцена)
                                        │  off      → setAmbientLayer(null), engine.dispose()
                                        │  static   → engine.configure({scene, animate:false}); setAmbientLayer(engine)
                                        └  animated → engine.configure({scene, animate:true});  setAmbientLayer(engine)

GraphCanvas.frame():  [граф, если graphDirty]  →  layer.draw({back, front}, AmbientFrame{…, sceneRev, points})
engine.draw():  поляны → плитки (кэш, бюджет 10 мс, запас-кольцо) → tick = scheduler.consume(time) → растры эффектов → сведение
scheduler:      таймер 83 мс → due → requestAmbientFrame() → (кадр хоста) → consume() → таймер …
```

### 2.4 Модули и владение (один файл — один пакет)

| Файл | Пакет | Волна |
|---|---|---|
| `src/lib/ambient/types.ts` | `amb-contracts` | 0 |
| `src/lib/ambient/lattice.ts`, `lattice.test.ts` | `amb-contracts` | 0 |
| `src/lib/ambient/raster.ts`, `raster.test.ts` | `amb-contracts` | 0 |
| `src/lib/graph/ambient.ts` (дополнение), `src/lib/graph/ambient.test.ts` (новый) | `amb-contracts` | 0 |
| `src/test/sceneVars.ts`, `src/test/sceneVars.test.ts` | `amb-contracts` | 0 |
| `src/lib/ambient/world.ts`, `world.test.ts` | `amb-world` | 0 |
| `src/lib/ambient/clearing.ts`, `clearing.test.ts` | `amb-world` | 0 |
| `src/lib/ambient/scheduler.ts`, `scheduler.test.ts` | `amb-scheduler` | 0 |
| `src/lib/ambient/tileRender.ts`, `tileRender.test.ts` | `amb-tiles` | 0 |
| `src/lib/ambient/tileStore.ts`, `tileStore.test.ts` | `amb-tiles` | 0 |
| `src/lib/ambient/engine.ts`, `engine.test.ts` | `amb-engine` | 0 |
| `src/lib/ambient/sprites/{build,palette,forest,ground,index}.ts`, `sprites/sprites.test.ts` | `amb-sprites` | 1 |
| `src/lib/pixelfx/{LICENSE,README.md,math.ts,color.ts,trips.ts,leaves.ts,rays.ts,pixelfx.test.ts}` | `amb-effects` | 1 |
| `src/lib/ambient/effects/{snow,fireflies,butterflies,index}.ts`, `effects/effects.test.ts` | `amb-effects` | 1 |
| `src/styles/scenes.css`, `src/styles/pixel.css`, `docs/DESIGN.md`, `README.md`, `src/views/settings/AppearanceSection.tsx`, `src/lib/ambient/contrast.test.ts` | `amb-style` | 1 |
| `src/lib/ambient/surface.ts`, `src/lib/ambient/controller.ts`, `controller.test.ts` | `amb-wire` | 2 |
| `src/components/graph/useAmbient.ts`, `src/components/graph/GraphCanvas.tsx`, `src/views/GraphView.tsx` | `amb-wire` | 2 |

Не трогаются: `lib/graph/{draw,geometry,scene,theme,types}.ts` и их тесты, `src/types.ts`, `db/*`, `store/*`,
`ThemeProvider.tsx`, `CLAUDE.md`, `mockup/`. Волна 0 идёт по очереди в порядке таблицы
(`amb-contracts → amb-world → amb-scheduler → amb-tiles → amb-engine`); волна 1 параллельно и зависит только от волны 0.
После каждого пакета: `npm run typecheck` и `npm test` проходят.

---

## 3. Волна 0 — контракты

### 3.1 `src/lib/ambient/types.ts` (`amb-contracts`)

Модуль без логики (кроме констант).

```ts
import type { Bounds } from '@/lib/graph/types'

export type AmbientScene = 'meadow' | 'autumn' | 'paper' | 'winter'
export const AMBIENT_SCENES: readonly AmbientScene[] = ['meadow', 'autumn', 'paper', 'winter']
export type Lod = 0 | 1 | 2

/** Растр w×h. data — Uint32Array в раскладке ImageData (байты r, g, b, a; packRgba), альфа прямая. 0 — пусто. */
export interface Raster { w: number; h: number; data: Uint32Array }
/** Спрайт: растр и точка опоры — пиксель спрайта, который ставится в точку объекта (низ ствола). */
export interface Sprite extends Raster { ax: number; ay: number }

export type ObjectKind = 'tree' | 'pine' | 'bush' | 'stone' | 'small' | 'reed' | 'lily'
/** Наибольший размер спрайта (lod 0) и число гамм и видов. Радиусы полян (world.ts) рассчитаны на эти размеры. */
export const SPRITE_LIMITS: Record<ObjectKind, { w: number; h: number; pals: number; variants: number }> = {
  tree: { w: 30, h: 40, pals: 4, variants: 3 },  pine: { w: 20, h: 38, pals: 1, variants: 2 },
  bush: { w: 20, h: 15, pals: 4, variants: 2 },  stone: { w: 13, h: 10, pals: 1, variants: 2 },
  small: { w: 15, h: 11, pals: 1, variants: 3 }, reed: { w: 12, h: 18, pals: 1, variants: 3 },
  lily: { w: 9, h: 6, pals: 1, variants: 2 },
}
// Точка опоры спрайта объекта: по центру ширины (|ax − w/2| <= 1) и у нижнего края (h − 4 <= ay <= h − 1).
// Точка опоры мелочи земли и узора сетки — центр спрайта (|ax − w/2| <= 1, |ay − h/2| <= 1). (уточнено при сверке)
/** Наибольшая сторона спрайта мелочи земли и узора сетки, арт-пикселей. */
export const DETAIL_LIMIT = 7

export interface WaterColors { deep: number; mid: number; lit: number; bank: number; dash: number; shore: number }

/** Графика сцены для одного уровня lod и смягчения. Строит пакет amb-sprites (buildSceneArt). */
export interface SceneArt {
  scene: AmbientScene
  dark: boolean
  lod: Lod
  /** Доля смешения цветов с землёй, 0..0.5 (softenFor). */
  soft: number
  /** Цвет земли сцены (= --ground в scenes.css); не рисуется, нужен смягчению и тестам. */
  ground: number
  /** Спрайт объекта мира; null — в сцене такого нет (объект пропускается). */
  object: (kind: ObjectKind, pal: number, variant: number) => Sprite | null
  /** Мелочь земли по двум случайным числам места (0..1): r1 выбирает вид, r2 — вариант; null — пусто. */
  detail: (r1: number, r2: number) => Sprite | null
  /** Узор по сетке графа (точка в центре клетки между нодами); null — нет. Только «Бумага». */
  grid: Sprite | null
  /** Цвета пруда; null — прудов в сцене нет. */
  water: WaterColors | null
}

export interface EffectFrame {
  /** Часы эффектов, с: растут только пока фон анимируется. */
  t: number
  /** Размер растра в арт-пикселях экрана и размер арт-пикселя в пикселях устройства. */
  w: number
  h: number
  e: number
  dark: boolean
  zoom: number
  /** Мир → арт-пиксель растра (дробный). */
  ax: (wx: number) => number
  ay: (wy: number) => number
  /** Центр арт-пикселя → мир. */
  wx: (ax: number) => number
  wy: (ay: number) => number
  /** Видимая часть мира с запасом 64 px экрана. */
  bounds: Bounds
  /** Есть ли нода ближе r (мир) к точке. */
  near: (wx: number, wy: number, r: number) => boolean
}

export interface AmbientEffect {
  id: string
  /** under — под связями и нодами (canvas back), over — поверх (canvas front). */
  plane: 'under' | 'over'
  /** screen — привязан к экрану (перерисовывается только по тику); world — к миру (между тиками едет вместе с камерой). */
  anchor: 'screen' | 'world'
  /** Рисует в очищенный (или общий для своей пары plane+anchor) растр. Чистая функция от f: без состояния между кадрами. */
  draw: (out: Raster, f: EffectFrame) => void
}

/** Период тика эффектов, мс (≈12 кадров/с). */
export const AMBIENT_TICK_MS = 83
/** Самая сильная сплошная заливка поверх нод (лучи): белый с этой альфой. Проверка контраста — amb-style. */
export const AMBIENT_OVERLAY_MAX = { r: 255, g: 255, b: 255, alpha: 0.2 } as const
/** Предел площади растра эффектов, арт-пикселей. */
export const AMBIENT_FX_MAX_PX = 640_000
/** Предел кэша плиток, пикселей решётки (×4 байта = 64 МБ). */
export const AMBIENT_TILE_MAX_PX = 16_000_000
/** Бюджет отрисовки новых плиток за один кадр, мс. Следующая плитка не начинается, если с ценой прошлой выйдет за бюджет. */
export const AMBIENT_TILE_BUDGET_MS = 10   // (уточнено при сверке: было 8 без учёта цены следующей плитки)
/** Растворение плитки при смене поляны, мс (3 шага). */
export const AMBIENT_FADE_MS = 250
```

### 3.2 `src/lib/ambient/lattice.ts` (`amb-contracts`)

Чистый модуль, формулы — §2.2.

```ts
export interface LatticeStep {
  u: number            // пикселей устройства в пикселе решётки, целое >= 1
  lod: Lod
  worldPerPx: number   // u / k
  size: number         // сторона плитки, пикселей решётки
  key: string          // `${u}:${lod}:${k}` — часть ключа кэша
}
export function latticeStep(k: number): LatticeStep            // k не число или <= 0 → как k = 1
export function softenFor(zoom: number): number
export function effectUnit(W: number, H: number, dpr: number): { e: number; w: number; h: number }  // W или H <= 0 → w = h = 0
export function toLattice(step: LatticeStep, w: number): number                 // Math.round(w / worldPerPx) + 0
export function tileRange(step: LatticeStep, device: DeviceTransform, W: number, H: number):
  { ti0: number; tj0: number; ti1: number; tj1: number }                          // включительно; покрывает [0,W)×[0,H)
export function tileBounds(step: LatticeStep, ti: number, tj: number): Bounds   // мир
export function tileOrigin(step: LatticeStep, device: DeviceTransform, ti: number, tj: number): { x: number; y: number } // пиксели устройства
```

Тесты: все 7 ступеней × dpr {1, 1.25, 1.5, 2}: `u` целое, `u/q ∈ [0.8, 1.34]`, `size ∈ [64, 512]`, `size·u ∈ [384, 640]`;
соседние плитки стыкуются без зазора (`origin(ti+1).x − origin(ti).x === size·u`); `tileRange` покрывает экран при
отрицательных и больших `ox`; `effectUnit` при 1600×1000/1.5 → `e = 3`, при 3840×2160/1 → `e = 4`.

### 3.3 `src/lib/ambient/raster.ts` (`amb-contracts`)

Операции над `Raster`; цвета — через `packRgba` из `@/lib/graph/theme` (порядок байтов учтён там).

```ts
export function createRaster(w: number, h: number): Raster
export function clearRaster(r: Raster): void
export function rgba(r: number, g: number, b: number, a?: number): number          // a 0..255, по умолчанию 255
export function hexColor(hex: string, alpha?: number): number                      // '#rgb' | '#rrggbb', alpha 0..1
export function chR(c: number): number; chG; chB; chA                               // каналы 0..255
export function mixColor(a: number, b: number, t: number): number                  // по каналам r, g, b; альфа от a
export function withAlpha(c: number, alpha: number): number                        // alpha 0..1
export function setPx(r: Raster, x: number, y: number, c: number): void            // целые после floor; вне растра и c = 0 — ничего
export function blendPx(r: Raster, x: number, y: number, c: number, k?: number): void // «поверх», прямая альфа; k умножает альфу c
export function ditherPx(r: Raster, x: number, y: number, c: number, a: number): void // упорядоченное смешение 4×4 (Байер): пиксель либо есть, либо нет
export function fillRectPx(r: Raster, x: number, y: number, w: number, h: number, c: number): void
export function blitSprite(r: Raster, s: Raster, x: number, y: number): void       // непрозрачные пиксели — запись, полупрозрачные — blendPx, 0 — пропуск
export function glow(r: Raster, cx: number, cy: number, radius: number, c: number, k: number): void // альфа (1 − d)² · k, blendPx
export function shadeBox(r: Raster, x0: number, y0: number, x1: number, y1: number,
  fn: (px: number, py: number) => number): void  // fn по центрам пикселей (x+0.5); 0 — оставить; иначе blendPx
```

Тесты: границы (ничего не пишется вне растра), `blendPx` на пустом пикселе даёт цвет с альфой `a·k`, на непрозрачном —
смесь с альфой 255, `ditherPx` при `a = 0.5` закрашивает ровно 8 из 16 клеток, `blitSprite` обрезается по краям.

### 3.4 `src/lib/graph/ambient.ts` — дополнение (`amb-contracts`)

Только добавления; существующие тесты в `theme.test.ts` остаются зелёными (файл `theme.test.ts` не трогать, новые
тесты — в `src/lib/graph/ambient.test.ts`).

```ts
/** Причина пробуждения хоста: сменился слой (перерисовать всё) или нужен только кадр фона. */
export type AmbientWake = 'layer' | 'frame'

export interface AmbientStats {
  tiles: number; tilePixels: number   // сейчас в кэше
  rendered: number                    // плиток отрисовано с создания слоя
  ticks: number                       // тиков эффектов с создания слоя
}

export interface AmbientFrame {
  // …прежние поля без изменений…
  /** Растёт, когда хост получил другую сцену графа (набор и положения нод). Нет — считать, что сцена новая каждый кадр. */
  sceneRev?: number
  /** Центры нод сцены (мир). Нет — пустой набор. */
  points?: ReadonlyArray<{ x: number; y: number }>
}

export interface AmbientLayer {
  draw: /* без изменений */
  /** Отладка и приёмка: хост пишет значения в data-атрибуты сцены. */
  stats?: () => AmbientStats
}

export function subscribeAmbient(cb: (kind: AmbientWake) => void): () => void   // было () => void: прежние подписчики совместимы
```

`setAmbientLayer` зовёт подписчиков с `'layer'`, `requestAmbientFrame()` — с `'frame'`. Шапку-комментарий файла обновить
(слой ставит этап 6; правила остановки — `lib/ambient/scheduler.ts`). Тесты: причина приходит верная; подписчик без
параметра работает; `requestAmbientFrame` без подписчиков не бросает.

### 3.5 `src/test/sceneVars.ts` (`amb-contracts`)

Вынос разбора `scenes.css` для тестов пакетов волны 1 (копия логики из `theme.test.ts`, сам `theme.test.ts` не менять):

```ts
export function parseRootBlocks(css: string): RootBlock[]
export function sceneVars(blocks: RootBlock[], classes: string[]): (name: string) => string   // каскад, var() раскрыт
export function readSceneCss(): RootBlock[]                       // читает src/styles/scenes.css (node:fs)
export const SCENE_VARIANTS: ReadonlyArray<{ scene: AmbientScene; dark: boolean; name: string; classes: string[] }> // 8 штук
export function luminance(hex: string): number
export function contrast(a: string, b: string): number
export function overlay(hex: string, over: { r: number; g: number; b: number; alpha: number }): string // цвет под заливкой
```

Тест: `--ground` всех восьми вариантов читается и равен значениям из `scenes.css`; `overlay('#000000', белый 0.2)` = `#333333`.

(уточнено при сверке) `sceneVars.ts` — не тестовый файл, но читает `node:fs`: первой строкой
`/// <reference types="node" />` (как в `theme.test.ts`), иначе `npm run typecheck` не увидит типы node. Из кода
приложения модуль не импортируется (иначе `node:fs` попадёт в сборку).

**Готово (`amb-contracts`):** файлы §3.1–3.5, typecheck и тесты проходят, `GraphCanvas.tsx` не тронут и компилируется.

---

## 4. Волна 0 — мир, планировщик, плитки, движок

### 4.1 `src/lib/ambient/world.ts` (`amb-world`) — мир по координатам

Перенос расстановки из `mockup/forest.js` один к одному (те же формулы и «соли» хеша), на TypeScript, без DOM и без
спрайтов: объект несёт вид, а не картинку. Внутри счёт идёт в арт-пикселях мокапа, наружу — **px мира** (арт × 2).

```ts
export const ART_PX = 2                // px мира в номинальном арт-пикселе
export const WORLD_CHUNK = 512         // сторона ячейки генерации, px мира (CH·PX мокапа)
export const WORLD_SLOT = 64           // место под один объект (G·PX): 8×8 мест в ячейке
export const POND_CELL = 1536          // не больше одного пруда на ячейку
export const POND_CHANCE = 0.42
export const GROUND_CELL = 32          // = GRAPH_CELL
export const GROUND_SLOTS = 5          // мест под мелочь земли в клетке

export function hash2(x: number, y: number, s?: number): number            // h2 мокапа, [0, 1)
export function valueNoise(x: number, y: number, s?: number): number       // vn мокапа
export function forestDensity(wx: number, wy: number): number              // density мокапа от (wx/2, wy/2)

export interface WorldObject {
  id: number                  // хеш места: стабилен, не зависит от порядка запросов
  x: number; y: number        // мир, точка опоры
  kind: ObjectKind; pal: number; variant: number
  /** Поляна: объект скрыт, если центр ноды лежит в рамке [x − clearX, x + clearX] × [y − clearUp, y + clearDown]. 0 — не скрывается сам. */
  clearX: number; clearUp: number; clearDown: number
}
export interface Pond {
  id: number; x: number; y: number; r: number   // мир; r — радиус по x до искажения
  a1: number; a2: number
  reach: number               // пруд скрыт целиком, если нода ближе reach к (x, y)
  objects: readonly WorldObject[]   // камыши и кувшинки (clearX = 0: прячутся только вместе с прудом)
}
export function chunkObjects(cx: number, cy: number): readonly WorldObject[]   // лес ячейки, без объектов пруда
export function pondOfCell(sx: number, sy: number): Pond | null
export function pondDistance(p: Pond, wx: number, wy: number): number        // pondD мокапа: <= 1 — вода
export function objectsIn(b: Bounds): WorldObject[]                           // лес в границах (по ячейкам), порядок (y, x, id)
export function pondsIn(b: Bounds): Pond[]                                    // пруды, чья рамка пересекает b
export function eachGroundDetail(b: Bounds, visit: (x: number, y: number, r1: number, r2: number) => void): void
export function resetWorldCache(): void                                       // для тестов
```

Правила:
- Выбор объекта места — как в `objectsOf` мокапа: `wood = step(0.5, 0.64, density)`; `r < wood·0.82` → роща (сосна
  `kind < 0.16`, куст `< 0.27`, иначе дерево; гамма `floor(vn(x/260+7, y/260+3, 8)·4 + v·1.7) % 4`); `r > 0.93` → на
  поляне куст / камень / мелочь. Виды: `tree[pal][floor(v·3)]`, `pine[v<0.5?0:1]`, `bush[pal][0|1]`, `stone[0|1]`,
  `small[floor(v·3)]` (0 — пень, 1 — «особое» сцены, 2 — гриб/сугроб).
- Объект не ставится у пруда своей ячейки `POND_CELL`: `pondDistance(pond, x, y − 20 для дерева и сосны) < 1.75`
  (высокие) или `< 1.25` (остальные) — как в мокапе. Пруд отстоит от краёв своей ячейки (запас `r·1.3 + 14` арт).
- Рамки полян (мир) — прямоугольник, как `hidden()` мокапа: наибольший спрайт из `SPRITE_LIMITS` × 2 px × 1.34
  (наибольший относительный размер, §2.2) + полноды 8 px + запас 24 px. `clearX / clearUp / clearDown`:
  дерево `74 / 140 / 44`; сосна `60 / 134 / 44`; куст `60 / 72 / 44`; камень и мелочь `54 / 62 / 44`.
  Рамка не зависит от ступени масштаба: лес у зон один и тот же на любом масштабе.
  Пруд: `reach = r·1.45 + 56` (круг: вода, берег и камыши с запасом).
- Мелочь земли: для клетки `(gx, gy)` и места `j ∈ [0, GROUND_SLOTS)`: `x = gx·32 + floor(hash2(gx, gy, 100+4j)·32)`,
  `y` — соль `101+4j`, `r1` — `102+4j`, `r2` — `103+4j`. Что рисовать по `r1`, решает графика сцены (`SceneArt.detail`).
- Память: кэш ячеек `Map` не больше 600 записей (при переполнении очищается целиком, как в мокапе); прудов — так же.
  Кэш — только ускорение: результат от него не зависит.

Тесты (`world.test.ts`): детерминизм — два обхода одной области в разном порядке ячеек и после `resetWorldCache()` дают
равные списки; отрицательные координаты; ни один объект леса не стоит в воде своего пруда; в ячейке не больше 64
объектов; доля ячеек `POND_CELL` с прудом на выборке 2000 — `0.42 ± 0.05`; пруд целиком внутри своей ячейки;
`objectsIn` отсортирован и не теряет объекты на стыках ячеек; `eachGroundDetail` даёт ровно `GROUND_SLOTS` мест на
клетку и одинаков при разбиении области на части; виды и номера гамм/вариантов в пределах `SPRITE_LIMITS`.

### 4.2 `src/lib/ambient/clearing.ts` (`amb-world`) — правило полян

```ts
export interface Clearing {
  /** Есть ли нода не дальше r (евклидово, мир) от точки. r <= 0 → false. */
  near: (wx: number, wy: number, r: number) => boolean
  /** Есть ли нода внутри рамки (включая границу). */
  inBox: (b: Bounds) => boolean
  /** Подпись набора нод внутри b: не зависит от порядка точек; пустой набор — 0. */
  signature: (b: Bounds) => number
  /** Подпись всего набора. */
  key: number
  size: number
}
export const CLEAR_GROUND_R = 56                      // мелочь земли ближе этого к ноде не рисуется (уточнено при сверке: было 44)
export const EMPTY_CLEARING: Clearing
export function buildClearing(points: ReadonlyArray<{ x: number; y: number }>): Clearing   // негодные точки пропускаются
export function objectCleared(o: WorldObject, c: Clearing): boolean    // o.clearX > 0 && c.inBox(рамка поляны объекта)
export function pondCleared(p: Pond, c: Clearing): boolean             // c.near(p.x, p.y, p.reach)
```

(уточнено при сверке) Почему 56: мелочь до 7 арт с опорой в центре — до (3.5 + 1)·2·1.34 ≈ 12 px мира по каждой оси;
по диагонали точка на расстоянии R от центра ноды даёт до квадрата ноды `R − √2·(12 + 8)`; нужно ≥ 24 → R ≥ 52.4.
При 44 и опоре в углу спрайта тест «24 px от квадрата ноды» (§4.4) не проходил бы по диагонали.

Реализация: корзины 128 px мира (`Map<number, number[]>`, ключ как в `geometry.ts`); `signature` — сумма хешей `(x, y)`
по модулю 2³² плюс число точек (сложение коммутативно — порядок не важен). Сборка 2000 точек — доли миллисекунды.

Тесты: `near` на границе радиуса (включительно), через границу корзины, отрицательные координаты; `inBox` на границе
рамки и для рамки больше корзины; `signature` не зависит от перестановки точек, меняется при сдвиге одной точки внутри
`b` и не меняется при сдвиге точки вне `b`; `key` двух наборов с одинаковыми точками равны; `objectCleared` для дерева:
нода в 100 px выше опоры — скрыто, в 200 px выше — нет, в 60 px ниже — нет, в 80 px сбоку — нет; `pondCleared`.

### 4.3 `src/lib/ambient/scheduler.ts` (`amb-scheduler`) — режимы и тики

```ts
export interface AmbientConditions {
  stage: boolean          // раздел «Граф» открыт и сцена графа есть в DOM
  visible: boolean        // document.visibilityState === 'visible'
  reducedMotion: boolean  // prefers-reduced-motion: reduce
  enabled: boolean        // settings.ambient
  pixel: boolean          // сцена не «Классика»
}
export type AmbientMode = 'off' | 'static' | 'animated'
export function ambientMode(c: AmbientConditions): AmbientMode
//  !stage || !enabled || !pixel → 'off';  reducedMotion || !visible → 'static';  иначе 'animated'

export interface SchedulerDeps {
  setTimer: (cb: () => void, ms: number) => unknown
  clearTimer: (id: unknown) => void
  /** Попросить хост о кадре фона (requestAmbientFrame). */
  request: () => void
}
export interface AmbientScheduler {
  /** Запустить или остановить тики. Повтор того же значения — ничего. */
  setRunning: (on: boolean) => void
  readonly running: boolean
  /** Взведён ли таймер (тесты, отладка). */
  readonly armed: boolean
  /** Слой зовёт в начале каждого draw. null — тик не наступил; иначе часы эффектов t (с) и шаг dt (с). */
  consume: (now: number) => { t: number; dt: number } | null
  dispose: () => void
}
export function createAmbientScheduler(deps: SchedulerDeps, periodMs?: number): AmbientScheduler  // по умолчанию AMBIENT_TICK_MS
```

Поведение (инвариант: пока `running`, истинно ровно одно из «тик ждёт кадра» (`due`) и «таймер взведён»; пока не
`running` — ни то, ни другое):
- `setRunning(true)` из остановленного: `due = true`, `deps.request()`. Таймер не взводится.
- `consume(now)`: не `running` или не `due` → `null`. Иначе `due = false`; `dt = первый тик после запуска ? 0 :
  clamp((now − lastNow)/1000, 0, 0.25)`; `t += dt`; `lastNow = now`; взвести таймер на `periodMs`; вернуть `{ t, dt }`.
- Таймер сработал: `armed = false`; если `running` — `due = true`, `deps.request()`.
- `setRunning(false)`: `clearTimer`, `due = false`, «первый тик» снова (пауза не входит в часы; `t` сохраняется).
- `dispose()`: как `setRunning(false)`, после него все методы — пустые, `consume` → `null`.
- Никаких `requestAnimationFrame`, `setInterval`, обращений к `window`/`document` внутри модуля.

Тесты (подставные таймеры — свой список, не `vi.useFakeTimers`): таблица `ambientMode` на все 32 сочетания; каждое
условие остановки по отдельности даёт не `animated`; запуск → один `request`, таймеров нет; `consume` → таймер один;
срабатывание → `request`, `armed === false`; два срабатывания подряд без `consume` невозможны (таймер один);
`setRunning(false)` в каждом из двух состояний → таймеров 0, дальнейшая «прокрутка времени» не вызывает `request`;
пауза 10 с не даёт скачка `t`; `dt` ограничен 0.25; `dispose` идемпотентен; повторный `setRunning(true)` не шлёт
второй `request`.

### 4.4 `src/lib/ambient/tileRender.ts` (`amb-tiles`) — плитка в растр

```ts
export const TILE_MARGIN_PX = 40       // запас в пикселях решётки: наибольший спрайт
export const CLEAR_REACH = 360         // мир: дальше этого от края плитки нода на её содержимое не влияет
/** Рисует плитку (ti, tj) в out (size×size, предварительно обнуляется здесь же). Возвращает число нарисованных объектов. */
export function renderTile(out: Raster, ti: number, tj: number, step: LatticeStep, art: SceneArt, clearing: Clearing): number
/** Подпись полян, от которых зависит плитка: clearing.signature(границы плитки + TILE_MARGIN_PX·worldPerPx + CLEAR_REACH). */
export function tileSignature(ti: number, tj: number, step: LatticeStep, clearing: Clearing): number
```

Порядок рисования в плитке (границы мира `B` = `tileBounds` + `TILE_MARGIN_PX·worldPerPx`):
1. Узор сетки (`art.grid`, только если `lod === 0` и `GROUND_CELL / worldPerPx >= 8`): точка в `(gx·32 + 16, gy·32 + 16)`
   каждой клетки. Полянами не убирается.
2. Мелочь земли (только `lod === 0`): `eachGroundDetail(B, …)`; пропуск, если `clearing.near(x, y, CLEAR_GROUND_R)` или
   `art.detail(r1, r2) === null`.
3. Пруды (`art.water !== null`): `pondsIn(B)`, не скрытые `pondCleared`. Рамка пруда — как в мокапе: `x ± r·1.45`,
   `y ± r·1.1` (мир; уточнено при сверке). По пикселям решётки в рамке пруда ∩ плитка:
   мир центра пикселя → `q = pondDistance`; `q > 1.12` — пусто; `> 1` — `shore`; `> 0.9` — `bank` (выше центра) или
   `lit`; иначе `mid` (`q > 0.55`) или `deep`; блики `dash` — правило мокапа по номинальным арт-координатам
   (`ax = floor(wx/2)`: `(ax & 7) < 5 && hash2(ax >> 3, ay, 5) < 0.04`, только `q < 0.84` и `lod === 0`).
4. Объекты: `objectsIn(B)` без `objectCleared` плюс `pond.objects` нескрытых прудов; сортировка `(y, x, id)`;
   `sprite = art.object(kind, pal, variant)`, `null` — пропуск; левый верхний угол в плитке:
   `toLattice(step, x) − sprite.ax − ti·size`, так же по y; `blitSprite`. Мелочь земли и узор сетки ставятся по тому
   же правилу (их опора — центр спрайта, §3.1).

Плитка зависит только от `(ti, tj, step, art, набор нод в радиусе влияния)` — не от соседних плиток и порядка
отрисовки: объект на стыке рисуется в обеих плитках в одни и те же пиксели решётки.

Тесты (подставная `SceneArt` со сплошными спрайтами наибольшего размера и своей мелочью): две соседние плитки,
сведённые в общий растр, побайтно равны одной области, нарисованной «большой» плиткой (сравнить полосу шва);
повторный вызов даёт тот же растр; с нодой в центре плитки ни один непрозрачный пиксель объекта или мелочи не лежит
ближе 24 px мира к квадрату ноды 16×16 (допуск — один пиксель решётки; ступени k = 0.125, 0.5, 1, 1.25, 2 — правило
полян при всех `u/q` и `lod`), а узор сетки остаётся; пруд рядом с нодой не рисуется вместе с камышами; `art.water === null` и `object → null` дают пустую плитку
без ошибок; `tileSignature` меняется при переносе ноды внутри радиуса влияния и не меняется при переносе далёкой.

(уточнено при сверке) «Ближе 24 px мира к квадрату ноды» — евклидово расстояние от центра пикселя решётки (в мире) до
квадрата 16×16; подставные спрайты наибольшего размера ставят опору по краю допуска (`ax = ⌊w/2⌋ + 1`, `ay = h − 4`),
мелочь — `DETAIL_LIMIT`×`DETAIL_LIMIT` с опорой в центре. Грубая защита скорости (как у лучей): плитка `u = 1`, `lod 0`
(k = 0.5) и `lod 2` (k = 0.125) с лесом, прудом и мелочью рисуется в node не дольше 30 мс (без пиксельных циклов по
всей плитке, кроме рамок прудов). Ориентир в браузере — 3–5 мс на плитку 512²: от этого зависит бюджет §4.6.

### 4.5 `src/lib/ambient/tileStore.ts` (`amb-tiles`) — кэш плиток

```ts
export interface TileEntry<S> {
  key: string
  surface: S
  pixels: number      // size·size
  sig: number         // tileSignature на момент отрисовки
  rev: number         // ревизия полян, на которой sig проверена
  used: number        // номер кадра последнего использования
}
export interface TileStore<S> {
  get: (key: string, frame: number) => TileEntry<S> | undefined   // помечает used
  /** Кладёт запись. Если ключ уже был — прежняя поверхность возвращается вызывающему (он решает: растворение или release). */
  put: (entry: Omit<TileEntry<S>, 'used'>, frame: number) => S | undefined
  /** Вытесняет давно не использованные, пока pixels > maxPixels. Записи с used === frame не трогает. */
  trim: (frame: number) => void
  clear: () => void                                               // release всех
  readonly size: number
  readonly pixels: number
}
export function createTileStore<S>(opts: { maxPixels: number; release: (s: S) => void }): TileStore<S>
```

Тесты: вытеснение — самые старые по `used`; записи текущего кадра не вытесняются, даже если сумма больше предела;
`release` вызывается ровно один раз на вытесненную; `put` на существующий ключ не вызывает `release` и возвращает старую
поверхность; `pixels` и `size` согласованы после любых операций; `clear`.

### 4.6 `src/lib/ambient/engine.ts` (`amb-engine`) — слой

```ts
export interface Surface {
  readonly source: CanvasImageSource
  readonly w: number
  readonly h: number
  /** Выгрузить растр w×h (putImageData). */
  put: (data: Uint32Array) => void
  release: () => void
}
export interface EngineDeps {
  createSurface: (w: number, h: number) => Surface
  art: (scene: AmbientScene, dark: boolean, lod: Lod, soft: number) => SceneArt
  effects: (scene: AmbientScene, dark: boolean, zoom: number) => readonly AmbientEffect[]
  scheduler: AmbientScheduler
  /** requestAmbientFrame: дорисовать плитки, не уложившиеся в бюджет. */
  requestFrame: () => void
  now?: () => number                    // по умолчанию performance.now
}
export interface AmbientEngine extends AmbientLayer {
  configure: (cfg: { scene: AmbientScene; animate: boolean }) => void
  dispose: () => void                   // release всех поверхностей, scheduler.setRunning(false)
  stats: () => AmbientStats
}
export function createAmbientEngine(deps: EngineDeps): AmbientEngine
```

Из контекста canvas движок использует только: `canvas.width/height`, `clearRect`, `drawImage` (9 аргументов),
`globalAlpha`, `globalCompositeOperation`, `imageSmoothingEnabled` (ставит `false` сам) — тестам хватает
записывающей подделки.

`draw(target, frame)`:
1. `W, H` — из `target.back.canvas`. `!frame.pixel` или размер 0 → очистить оба canvas (если на них рисовали), выйти.
2. `step = latticeStep(frame.device.k)`, `soft = softenFor(zoom)`, `art` — из своего кэша по ключу
   `scene:dark:lod:soft` (вызов `deps.art` один раз на ключ).
3. Поляны: если `frame.sceneRev === undefined` или отличается от прошлого — `buildClearing(frame.points ?? [])`; новый
   `key` ≠ прежнего → `clearRev += 1`. Смена только приглушения нод (те же точки) плитки не трогает.
4. Тик: `tick = scheduler.consume(frame.time)` (в неподвижном режиме планировщик не запущен → `null`).
5. Плитки: `tileRange`; порядок — от центра экрана. Для каждой: ключ `artKey|step.key|ti,tj`.
   - нет в кэше → отрисовать (общий рабочий растр `size×size` → `createSurface` → `put`), `sig = tileSignature`;
   - есть, `entry.rev !== clearRev` → `sig = tileSignature`; равна `entry.sig` → `entry.rev = clearRev`; иначе
     отрисовать заново: прежняя поверхность при `animate` уходит в растворение `{ key, ti, tj, step, old, t0: frame.time }`
     (место плитки нужно сведению; уточнено при сверке), иначе `release`; растворение плитки, ушедшей с экрана или
     с другой ступенью, завершается сразу (`release`);
   - бюджет (уточнено при сверке): первая плитка кадра рисуется всегда; перед каждой следующей — если
     `now() − начало + цена прошлой плитки > AMBIENT_TILE_BUDGET_MS`, остальные новые откладываются (устаревшая
     рисуется как есть), в конце кадра `deps.requestFrame()`. Так кадр не уходит за бюджет на целую плитку (≈3–5 мс).
   - запас (уточнено при сверке): если все видимые готовы, бюджет не исчерпан и `store.pixels + пиксели недостающих
     плиток кольца ≤ AMBIENT_TILE_MAX_PX`, дорисовываются плитки кольца шириной в одну плитку вокруг `tileRange` (от
     ближних к центру, по тому же бюджету); остались недостающие — `deps.requestFrame()`. Кольцо не сводится в `back`
     (его нет на экране), но берётся через `store.get(key, frame)`. Без запаса при сдвиге мышью новый ряд (4–5 плиток
     по 3–5 мс) проявлялся бы 2–3 кадра (С2).
   - `store.trim(номер кадра)` после прохода.
6. Эффекты: `list = cfg.animate ? deps.effects(scene, dark, zoom) : []`. Четыре пары `plane × anchor`; пара с эффектами
   имеет растр и поверхность размера `effectUnit(W, H, dpr)` (создаются лениво, пересоздаются при смене размера,
   освобождаются, когда пара опустела). По тику (или при смене размера/набора эффектов — с прежним `t`) растр пары
   очищается, эффекты рисуют в него по порядку списка, `surface.put`. Для пары `world` запоминаются `ox, oy` кадра.
7. Сведение `back` (только если что-то изменилось: размер, камера, шаг, графика, отрисованы плитки, идут растворения,
   был тик у `under`, набор `under` сменился): `clearRect`; плитки `drawImage(surface, 0, 0, size, size, x, y, size·u,
   size·u)`; растворяющаяся плитка: `globalAlpha = 1 − p` — старая, затем `globalCompositeOperation = 'lighter'`,
   `globalAlpha = p` — новая, вернуть `source-over` и `1` (линейное смешение без провала прозрачности общих объектов;
   `p = ceil(3·(time − t0)/AMBIENT_FADE_MS)/3`, при `p >= 1` старая освобождается); затем `under`: `screen` в `(0, 0)`
   с увеличением `e`, `world` — со сдвигом `(ox − ox0, oy − oy0)`.
8. Сведение `front` (если: размер, тик у `over`, камера сдвинулась и есть `over/world`, набор `over` сменился):
   `clearRect`; `screen`, затем `world` со сдвигом. Смена `k` при живой паре `world` — немедленная перерисовка её растра.
9. В конце: `scheduler.setRunning(cfg.animate && (list.length > 0 || идут растворения))`.

`configure`: смена сцены помечает всё к перерисовке; `animate: false` — остановить планировщик, освободить растры
эффектов и завершить растворения (старые поверхности — `release`), очистить `front` и слой `under` при следующем `draw`.

Тесты (`engine.test.ts`, подделки контекста, поверхностей, графики и эффектов): плитки ложатся в целые координаты
`ox + ti·size·u`, размер `size·u`; повторный `draw` без изменений (после того как дорисованы видимые плитки и кольцо)
не вызывает `clearRect`/`drawImage` и не создаёт поверхностей; сдвиг камеры на полплитки создаёт только плитки
нового ряда кольца (видимые уже готовы из запаса); кольцо не рисуется, если не помещается в предел памяти; при
подставных `now` с ценой плитки 5 мс в кадре ровно две новые плитки, третья отложена и вызван `requestFrame`
(уточнено при сверке); смена `sceneRev` с теми же точками — ноль
отрисовок; перенос точки — заново рисуются только плитки в радиусе влияния; `animate: false` → `setRunning(true)` не
вызывается ни разу, эффекты не рисуются, растворений нет; `animate: true` и пустой список эффектов → планировщик не
запущен; тик перерисовывает `front`, не трогая плитки; пара `world` между тиками рисуется со сдвигом камеры;
превышение бюджета (подставные `now`) → часть плиток отложена и вызван `requestFrame`; предел памяти — после 300
прыжков камеры `stats().tilePixels <= AMBIENT_TILE_MAX_PX`, поверхности освобождены; `dispose` освобождает всё;
`frame.pixel === false` — canvas очищены, ничего не создано.

---

## 5. Волна 1 — графика, эффекты, стили

### 5.1 Пакет `amb-sprites` (sonnet) — графика сцен

Своя процедурная графика: карты пикселей и построители в коде, **без canvas и без файлов**. Образец —
`mockup/forest.js` (`sprite`, `ell`, `crown`, `THEMES`, `CROWNS`, `makeSprites`) и `sceneTile` из `mockup/app.js`.
Чужие спрайты не добавлять.

- `sprites/build.ts`: `makeSprite(w, h, opts: { ax?, ay?, line?, shadow? }, paint)` (контур в 1 px и овальная тень — как
  `sprite()` мокапа, но в `Uint32Array`), `ellipse`, `crown`, `downscale(s: Sprite, factor: 2 | 4): Sprite` (блок
  `factor×factor` → самый частый непрозрачный цвет, если закрашено не меньше половины блока; точка опоры делится),
  `nightColor(c)` (яркость ×0.5, насыщенность ×0.85 — фильтр мокапа), `soften(c, ground, t)` (`mixColor`, альфа сохраняется).
- `sprites/palette.ts`: `GROUND: Record<AmbientScene, { day: string; night: string }>` (равны `--ground`), гаммы листвы,
  хвои, воды, тени по сценам (`THEMES` мокапа) и цвета мелочи земли (`SCENES[*].day/night` мокапа).
- `sprites/forest.ts`: деревья 4 гаммы × 3 кроны, сосны × 2, кусты 4 × 2, камни × 2, мелочь × 3 (пень; тыква / ромашка /
  сугроб; гриб / сугроб), камыш × 3, кувшинка × 2 (в «Зиме» кувшинок нет → `null`).
- `sprites/ground.ts`: мелочь земли по сценам (плотности — доли `r1`; ориентир — счёт на плитку 128² мокапа, делённый
  на 64 клетки и на `GROUND_SLOTS`): «Луг» — пучки травы 0.50, светлые штрихи 0.32, ромашки 0.04; «Осень» — пучки 0.14,
  зелёные пучки 0.08, штрихи 0.32, листья трёх форм 0.09, грибы 0.01; «Зима» — пучки 0.06, светлые штрихи 0.32, тёмные
  0.20, искры 0.09; «Бумага» — волокна 0.17, кляксы 0.004 (2 формы, 5–7 px, цвет — приглушённые чернила), `grid` —
  точка 1×1 цвета `dot` мокапа.
- `sprites/index.ts`:

```ts
export function buildSceneArt(scene: AmbientScene, dark: boolean, lod: Lod, soft: number): SceneArt
```

  Ночь: лес, вода, тени — `nightColor` от дневных; мелочь земли — ночные цвета мокапа. `lod` 1/2 — `downscale` от
  lod 0 (мелочь и узор на lod ≥ 1 не нужны: `detail → null`, `grid → null`). Смягчение — `soften` к `ground`.
  «Бумага»: `object → null`, `water → null`.

Тесты (`sprites.test.ts`): `GROUND` равны `--ground` всех восьми вариантов (`readSceneCss`); размеры в пределах
`SPRITE_LIMITS`, точки опоры по правилу из `types.ts` (объекты — центр ширины, нижние 4 строки; мелочь и узор — центр
спрайта, уточнено при сверке), мелочь и узор — не больше `DETAIL_LIMIT`, для всех видов, гамм, вариантов и сцен (тень входит в размер спрайта); два вызова дают побайтно равные спрайты; в лесных
сценах у каждого вида есть спрайт (кроме кувшинки зимой), в «Бумаге» — ни одного, зато есть `grid` и `detail`;
доли `detail` по сценам на 10 000 случайных `r1` — в пределах ±0.02 от заданных; ночью средняя яркость спрайта ниже
дневной; `soft = 0.5` уменьшает наибольший контраст цвета спрайта к земле по сравнению с `soft = 0`; `lod 1` — размеры
`ceil(w/2) × ceil(h/2)`, нет пустых спрайтов; у спрайтов нет пикселей с альфой 0 и ненулевым цветом.

Сценарии (проходит `amb-wire` в браузере): четыре сцены днём и ночью на 100 % и 25 %; деревья четырёх гамм, сосны,
пруд с камышами и кувшинками (зимой — лёд без кувшинок), «Бумага» — точки между нодами.

### 5.2 Пакет `amb-effects` (sonnet) — pixelfx и эффекты

**Обоснование отказа от переноса ядра.** Ядро pixelfx (`mockup/pixelfx/core`, ≈2700 строк) — движок на 244 эффекта:
два буфера (цвет и свет), экземпляры эффектов, актёры и скелеты, аргументы «число или функция». Нам из него нужны
`hash/rand`, `wrap`, `mix`, `fit`, `trips` и два рецепта (листопад, лучи), уже переписанные в `mockup/weather.js` под вид
сверху. Перенос ядра на строгий TypeScript — тысячи строк без применения; свои операции над растром (`raster.ts`,
≈150 строк) проверяются в node без DOM. Бабочка pixelfx — 44×40 арт-пикселей со свечением (≈88×80 px экрана при ноде
16 px): на графе без грядок она закрывала бы ноды, поэтому бабочка своя, маленькая. Лицензия всё равно обязательна:
листопад и лучи — производные от эффектов pixelfx, помощники скопированы.

`src/lib/pixelfx/` (каждый `.ts` начинается с `/*! pixelfx (MIT) — Copyright (c) 2026 Patch, Copyright (c) 2026 Hugo
Duprez. Лицензия: src/lib/pixelfx/LICENSE */`):
- `LICENSE` — дословная копия `mockup/pixelfx/LICENSE`.
- `README.md` — что перенесено и откуда (`core/math.js`, `core/color.js`, `fx/weather/_lib.js: trips`; листопад и лучи —
  из `mockup/weather.js`, который сам переработан из рецептов pixelfx `weather/falling-leaves` и `weather/god-rays`;
  в копии `mockup/pixelfx` этих рецептов нет — уточнено при сверке), что изменено (TypeScript, один растр вместо
  двух буферов, вид сверху, таблица лучей), ссылка https://www.spritefusion.com/pixel-art-vfx.
- (уточнено при сверке) Условие MIT — в копиях должны быть уведомление об авторском праве **и** текст разрешения.
  В собранный чанк уходит только код, файл `LICENSE` — нет; ссылка на путь `src/lib/pixelfx/LICENSE` в сборке никуда не
  ведёт. Поэтому шапка `math.ts` (его импортируют `trips`, `leaves`, `rays`, `color`) — `/*!` с **полным** текстом
  `LICENSE` (оба Copyright и абзацы разрешения и отказа от гарантий); в остальных файлах — короткая шапка выше.
- `math.ts`: `TAU`, `clamp`, `wrap`, `hash(...ns)`, `rand(...ns)`.
- `color.ts`: `fit(list: string[], n): number[]`, `mix` — поверх `hexColor`/`mixColor` из `raster.ts`.
- `trips.ts`: `trips(t, D, n, seed, m0, m1, fn)`.
- `leaves.ts`: `export const leaves: AmbientEffect` (`plane: 'under'`, `anchor: 'screen'`) — перенос `drawLeaves`/`leaf`:
  число листьев `max(8, round(w·h/11000))`; ночная гамма — смесь с `#2c2132` 0.5; блик только днём (`glow`).
  Добавлено: если `f.near(мир точки приземления, 36)` — лежащий лист не рисуется, летящий — с альфой ×0.35 (листья не
  ложатся на ноды и вплотную к ним).
- `rays.ts`: `export const rays: AmbientEffect` (`over`, `screen`) — перенос `drawRays`. Обязательная оптимизация: на
  размер растра один раз считаются `Uint16Array` номера угла (0..1023) и `Float32Array` затухания по расстоянию; на
  тик — таблица света по углу на 1024 значения (шесть лучей и «дыхание»), затем один проход по пикселям.
  Ступени света — как `LV` мокапа, альфа не больше `AMBIENT_OVERLAY_MAX.alpha`. Пылинки — как в мокапе (`w·h/2600`).
  (уточнено при сверке) Проверка контраста (`amb-style`) считает заливку белой; ступени `LV` обязаны быть светлыми
  (относительная яркость цвета ≥ 0.6) — тогда они меняют контраст кромки к земле не сильнее белого той же альфы.

`src/lib/ambient/effects/` (свой код):
- `snow.ts` (`over`, `screen`): снежинки `round(w·h/5600)`, падение и покачивание — формулы `drawFx` мокапа, точки через
  `ditherPx` (альфа 0.9 / 0.55), каждая пятая — в два пикселя.
- `fireflies.ts` (`over`, `world`): по ячейкам мира 512 px: `floor(hash2(cx, cy, 300)·3)` светлячков (0–2), опора внутри
  ячейки, блуждание `±46 × ±30` px мира и мерцание — формулы мокапа; ядро 1 пиксель + два `glow` (радиусы 8 и 3 арт,
  цвета `#9ad02a`, `#d6ff5a`, `#f4ffb8`). Не рисуется, если `f.near(x, y, 28)`.
- `butterflies.ts` (`over`, `world`): по ячейкам 512 px с вероятностью 0.25 одна бабочка; путь — `опора + (160·sin(0.07t +
  ph), 90·sin(0.05t + 2ph))`; спрайт — карта пикселей ≈9×7 арт, 3 кадра взмаха, 3 расцветки, зеркалится по направлению.
  (уточнено при сверке) Размер бабочки — в арт-пикселях растра (`e` px устройства), а не мира: на пороге 75 % она
  крупнее ноды (≈18×14 CSS px против 12). Поэтому над нодой, как у листьев: если `f.near(x, y, 24)` — бабочка рисуется
  с альфой ×0.35 (через `ditherPx`), ноду не закрывает.
- `index.ts`:

```ts
export function effectsFor(scene: AmbientScene, dark: boolean, zoom: number): readonly AmbientEffect[]
```

| Сцена | День | Ночь |
|---|---|---|
| Луг | лучи; бабочки (масштаб ≥ 0.75) | светлячки (масштаб ≥ 0.5) |
| Осень | листопад (масштаб ≥ 0.5); лучи | листопад (масштаб ≥ 0.5) |
| Зима | снег | снег |
| Бумага | — | — |

  Для одинаковых аргументов возвращается **тот же массив** (движок сравнивает по ссылке). Эффекты без состояния:
  картинка — функция `f.t` и камеры.

Тесты: `hash`/`rand` совпадают с эталонными значениями, снятыми с `mockup/pixelfx/core/math.js` (вписать 6–8 чисел);
`trips` — число вызовов и границы `u`; каждый эффект: одинаковый `f` → побайтно равный растр, разные `t` → разный;
ничего не пишет вне растра (растр с «каймой»); `rays`: альфа всех пикселей сплошной заливки ≤
`round(AMBIENT_OVERLAY_MAX.alpha·255)`, таблица пересчитывается при смене размера; `leaves` при `near → true` всюду не
оставляет лежащих листьев; число снежинок и листьев растёт с площадью; `fireflies`/`butterflies` рисуют одно и то же
место мира при сдвиге камеры (сдвиг растра = сдвиг камеры / `e`); таблица `effectsFor` целиком, пороги масштаба,
стабильность ссылки; `rays` на 800×500 укладывается в 50 мс на тик в node (грубая защита от пиксельного цикла с лучами).
(уточнено при сверке) Ещё: ступени лучей светлые (яркость ≥ 0.6) и с альфой ≤ 0.2; лучи есть только в дневных «Луге»
и «Осени» (на этом держится объём проверки контраста `amb-style`); бабочка при `near → true` всюду закрашивает не
больше 40 % пикселей своего спрайта; в шапке `math.ts` есть строка
`Permission is hereby granted` (проверка чтением файла через `node:fs`).

Сценарии (`amb-wire`): «Осень» день — листья падают и лежат вне полян, лучи поверх нод, ноды читаются; «Луг» день —
лучи и бабочки на 100 %, на 50 % бабочек нет; «Луг» ночь — светлячки, при сдвиге едут вместе с лесом; «Зима» — снег.

### 5.3 Пакет `amb-style` (sonnet) — стили, тексты, документы

- `src/lib/ambient/contrast.test.ts` (уточнено при сверке — объём): сплошная заливка поверх нод есть только у лучей,
  а лучи — только в дневных «Луге» и «Осени» (§5.2, проверяет `effects.test.ts`). Для этих двух вариантов (через
  `src/test/sceneVars.ts`) под заливкой `AMBIENT_OVERLAY_MAX` (`overlay` и на элемент, и на землю) контраст к земле:
  `--graph-node-edge`, `--graph-link-edge`, `--graph-sel-edge` ≥ 3 (расчёт при сверке: «Луг» 3.16, «Осень» 3.39–3.69);
  `--graph-label` к `--graph-label-edge` ≥ 4.5 — для всех восьми (наименьшее ≈ 5.7). Строгое «кромка ≥ 3» для
  остальных шести **не** проверять: ночью кромки к земле ≈ 1.2–1.4 по замыслу этапа 5 (читаемость даёт заливка
  ноды и сердцевина связи, это проверяет `theme.test.ts`); тест на восемь вариантов упал бы и потянул бы правку
  ночных цветов, которой этап 6 не требует.
- `src/styles/scenes.css`: значения `--graph-*` менять **только если** тест выше не проходит (по расчёту архитектора
  проходит: «Луг» день ≈ 3.15, «Осень» день ≈ 3.7); в любом случае дополнить комментарий блока «Граф»: земля под
  нодами остаётся ровной (поляны фона), поверх нод — заливка не сильнее `AMBIENT_OVERLAY_MAX`.
- `src/styles/pixel.css`: раздел «6. Граф» — комментарий о слоях фона; правило для подписи на лесу не требуется (контур
  2 px уже есть). Новых примитивов нет.
- `src/views/settings/AppearanceSection.tsx`: подпись переключателя — «Лес и пруды, листопад, лучи, снег, бабочки и
  светлячки на графе. В «Классике» фона нет.» Больше ничего не менять (один переключатель).
- `docs/DESIGN.md`: §11 переписать (слои и порядок; режимы `off / static / animated` и условия; решётка устройства и
  целый масштаб; поляны; пороги масштаба эффектов; «Бумага»; графика только своя; pixelfx — `src/lib/pixelfx`, MIT);
  в §13 обновить пункты «Слои сцены» и «Живой фон».
- `README.md`: раздел «Сторонний код» — pixelfx, MIT, что именно использовано, путь к `LICENSE`.

Готово: тест контраста зелёный, тексты на месте, typecheck и тесты проходят. Сценарий (`amb-wire`): настройки →
«Живой фон» — подпись; `docs/DESIGN.md` §11 соответствует поведению.

---

## 6. Волна 2 — пакет `amb-wire` (opus, браузер)

### 6.1 `src/lib/ambient/surface.ts`

```ts
export function createCanvasSurface(w: number, h: number): Surface
```
`document.createElement('canvas')`, контекст `2d`; `put` — `putImageData(new ImageData(new Uint8ClampedArray(data.buffer,
data.byteOffset, w·h·4), w, h), 0, 0)`; `release` — `canvas.width = canvas.height = 0`.

### 6.2 `src/lib/ambient/controller.ts` (+ `controller.test.ts`)

```ts
export interface AmbientControllerDeps {             // всё по умолчанию — боевое; тесты подставляют своё
  createEngine?: (scheduler: AmbientScheduler) => AmbientEngine
  createScheduler?: () => AmbientScheduler
}
export interface AmbientController {
  update: (c: AmbientConditions & { scene: Scene }) => void     // Scene из '@/lib/scene'
  readonly mode: AmbientMode
  dispose: () => void
}
export function createAmbientController(deps?: AmbientControllerDeps): AmbientController
```

- Боевая сборка: планировщик на `window.setTimeout/clearTimeout` и `requestAmbientFrame`; движок с
  `createCanvasSurface`, `buildSceneArt`, `effectsFor`, `requestAmbientFrame`.
- `update`: `mode = ambientMode(c)` (при `scene === 'classic'` — всегда `off`). `off` → `setAmbientLayer(null)`,
  `engine.dispose()`, движок и планировщик выбрасываются (память кэша свободна). Иначе — создать при необходимости,
  `engine.configure({ scene, animate: mode === 'animated' })`, `setAmbientLayer(engine)`, `requestAmbientFrame()`.
- `dispose` — как `off`.

Тесты: по каждому условию остановки `getAmbientLayer() === null` либо планировщик не запущен (подставной планировщик
считает `setRunning(true)`); `static` из-за `reducedMotion` и из-за скрытого окна; возврат в `animated`; `classic`;
`dispose` снимает слой; повторный `update` с теми же условиями ничего не пересоздаёт.

### 6.3 `src/components/graph/useAmbient.ts`

```ts
export function useAmbient(stage: HTMLElement | null): void
```
Условия: `stage !== null`; `useScene()` → `resolvedScene`, `pixel`, `ambient`; `useMediaQuery('(prefers-reduced-motion:
reduce)')`; видимость — `useSyncExternalStore` на `visibilitychange` (`document.visibilityState === 'visible'`).
Контроллер — один на компонент (`useState(createAmbientController)`), `update` в эффекте, `dispose` при размонтировании.
Пишет `stage.dataset.ambientMode` (при размонтировании убирает).

### 6.4 `src/components/graph/GraphCanvas.tsx`

- Два повода кадра: `invalidate()` (граф и фон) ставит `graphDirty = true`; `invalidateAmbient()` — только кадр.
  Оба ведут к одному `requestAnimationFrame(frame)`. `subscribeAmbient((kind) => (kind === 'frame' ? invalidateAmbient() :
  invalidate()))`. Путь `ResizeObserver` перед прямым `frame()` ставит `graphDirty = true`.
- `frame()`: граф рисуется только при `graphDirty` (код рисования не меняется; ранний выход «нет темы / размер 0»
  оставляет `graphDirty`); `stage.dataset.drawMs` обновляется только когда граф рисовался. Затем слой — на каждом кадре.
  (уточнено при сверке) `drawMs` — время **только графа** (замер до `layer.draw`; сейчас он включает и слой), время
  слоя — отдельно в `ambientMs`. Иначе критерий §6.6 п. 2 («drawMs не вырос больше 10 %») не проверить.
- `AmbientFrame`: добавить `sceneRev` (счётчик, растёт при смене `sceneRef.current` по ссылке) и `points: sc.nodes`.
- После `layer.draw`: `stage.dataset.ambientMs`; если есть `layer.stats` — `dataset.ambientTiles`, `ambientTicks`,
  `ambientRendered`. При снятии слоя и размонтировании атрибуты убрать.
- Комментарий-шапку компонента обновить. Разметка трёх canvas не меняется.

### 6.5 `src/views/GraphView.tsx`

Одна строка: `useAmbient(loaded ? stageEl : null)` рядом с `useGraphGestures`. Больше ничего.

(уточнено при сверке) Сцена графа (`stageEl`) появляется ещё до загрузки данных (`loaded === false`, `aria-busy`), со
сценой без нод. С `useAmbient(stageEl)` лес нарисовался бы без полян, а через кадр-другой деревья под всеми нодами
растворялись бы — мигание при каждом входе в раздел (С1). Пока данные не загружены, условие `stage` ложно.

### 6.6 Критерии готовности

1. `npm run typecheck`, `npm test`, `npm run build` проходят; граф остаётся отдельным чанком; в собранном чанке графа
   есть строки `Copyright (c) 2026 Patch` и `Permission is hereby granted` (уточнено при сверке). Минимизатор Vite 8
   (rolldown/oxc) сохраняет `/*!`-комментарии по `output.comments.legal`; если строк нет — не править `vite.config.ts`,
   а сообщить в отчёте: нужен иной способ сохранить уведомление MIT (решает основная сессия).
2. Нагрузка §6 `spec-stage5.md` (2000 записей, 3000 связей), 1280×800: при сдвиге медиана `drawMs` не выросла больше
   чем на 10 % к значению с выключенным фоном; `ambientMs` — медиана ≤ 3 мс, кадры с отрисовкой плиток ≤ 12 мс;
   кадр тика («Осень», день) ≤ 6 мс. При неподвижной камере граф не перерисовывается (`drawMs` не меняется), идёт
   только `ambientTicks` (≈10–12 в секунду).
3. `ambientTiles`·пиксели ≤ `AMBIENT_TILE_MAX_PX` после 200 программных прыжков камеры.
4. Все сценарии §6.7 пройдены, что не удалось проверить — перечислено в отчёте.

### 6.7 Сценарии в браузере (свой порт, отдельная база; `amb-wire` проходит и сценарии §5.1–5.3)

Подготовка: dev-сервер, демоданные; из консоли доступны `await import('/src/store/graph.ts')`,
`await import('/src/lib/ambient/world.ts')`, `await import('/src/lib/graph/ambient.ts')`.

| № | Сценарий | Ожидание |
|---|---|---|
| С1 | «Осень», день, раздел «Граф», 100 % | лес вокруг зон, под нодами и рядом ровная земля, листья падают под нодами, лучи поверх; связи, идущие через лес, и подписи нод читаются; при входе в раздел деревья под нодами не мелькают; `ambientMode = animated` |
| С2 | Сдвиг мышью на несколько экранов | новые плитки без швов; при обычном сдвиге пустых полос нет (запас-кольцо), при резком броске — не дольше 2–3 кадров (уточнено при сверке); лес неподвижен относительно нод |
| С3 | Все 7 ступеней масштаба | нет швов и размытия; на 25 % и 12,5 % лес бледнее и мельче, ноды читаются; листья и бабочки исчезают по порогам |
| С4 | Камера на пруд (`pondOfCell` → `setCamera`) | пруд с берегом, камышами, кувшинками; в «Зиме» — лёд |
| С5 | Перенос ноды в лес и бросок | во время переноса лес не меняется; после броска деревья под нодой растворяются за ≈¼ с, на старом месте появляются; мерцания и пустых плиток нет |
| С6 | «Разложить заново», затем «Отменить» | фон перестраивается один раз на каждое действие |
| С7 | «Луг», «Зима», «Бумага» × день и ночь | графика и эффекты по таблице §5.2; «Бумага» — точки, волокна, без леса и эффектов, `ambientTicks` не растёт |
| С8 | Ввод в поиске (приглушение нод) | `ambientRendered` не растёт |
| С9 | Переход во «Входящие» | `getAmbientLayer() === null`; возврат в «Граф» — фон на месте |
| С10 | Скрытое окно (в консоли подменить `document.visibilityState` на `hidden` и послать `visibilitychange`) | `ambientMode = static`, `ambientTicks` стоит; обратно — растёт |
| С11 | Настройки → «Живой фон» выкл. | в «Графе» ровная земля, `back.width === 0`; вкл. — фон вернулся |
| С12 | «Классика» | фона нет, `back.width === 0`, граф как на этапе 5 |
| С13 | Пустой граф / «Все записи в архиве» | слоя нет, ошибок в консоли нет |
| С14 | Ширина 390 px | граф и фон работают, горизонтальной прокрутки нет |
| С15 | Нагрузка 2000 записей | критерии §6.6 п. 2–3 |
| С16 | Консоль | ошибок и предупреждений от фона нет |

`prefers-reduced-motion` и dpr 1.25/1.5/2 в панели браузера не переключаются: покрыты тестами (`scheduler`,
`controller`, `lattice`); вживую — основная сессия на приёмке (масштаб Windows 125 % и 150 %).

Чужие файлы `amb-wire` не правит. Исключение — дефект, без исправления которого сценарий не проходит (падение, пустой
кадр): минимальная правка с записью в отчёте «файл, строки, причина». Вкусовые замечания (цвета, плотность, скорость) —
списком в отчёт для доводки основной сессией.

---

## 7. Тесты — сводка требований плана

| Требование | Где |
|---|---|
| Мир детерминирован и не зависит от порядка запросов | `world.test.ts`, `tileRender.test.ts` (шов, повтор) |
| Правило полян | `clearing.test.ts`, `tileRender.test.ts` (нода в плитке на пяти ступенях), `pixelfx.test.ts` (листья) |
| Планировщик, все условия остановки | `scheduler.test.ts` (режимы, таймеры), `controller.test.ts`, `engine.test.ts` (`animate: false`) |
| Кэш плиток: LRU, границы | `tileStore.test.ts`, `engine.test.ts` (предел памяти, только новые плитки) |
| Частицы с подставным буфером | `pixelfx.test.ts`, `effects.test.ts`, `raster.test.ts` |
| Резкость при dpr 1/1.25/1.5/2 | `lattice.test.ts`, `engine.test.ts` (целые координаты и масштаб) |
| Читаемость `--graph-*` | `contrast.test.ts`, прежний `theme.test.ts` |

## 8. Риски

1. «Осень»: `back` пересобирается на каждом тике (плитки + листья, ≈20 `drawImage`). Если кадр тика выйдет за 6 мс —
   запасной путь: отдельный canvas под листопад в `GraphCanvas` (тогда `back` рисуется только при сдвиге). Решает
   основная сессия по замерам `amb-wire`.
2. Относительный размер спрайтов гуляет на 0.8–1.34 между ступенями и dpr (плата за целые пиксели): лес чуть гуще
   или реже. Если заметно — править формулу `u` нельзя (резкость), можно добавить промежуточный `lod`.
3. Автоуменьшение спрайтов (`downscale`) на lod 1–2 может дать «кашу»; тогда `amb-sprites` рисует отдельные мелкие
   карты для деревьев (2–3 штуки) — доводка.
4. Минимизатор сборки может срезать уведомление лицензии — проверка в §6.6 п. 1.
5. `visibilitychange` в свёрнутом окне Tauri/WebView2 не проверен; цепочка тиков через кадр хоста сама встаёт, если
   окно не рисуется, — но проверить вживую на этапе 8.
6. Первый показ после смены масштаба: до 35–54 плиток, бюджет 10 мс на кадр. (уточнено при сверке) При цене плитки
   3–5 мс (512² пикселей решётки, сотни спрайтов, пиксельные рамки прудов) это 2–3 плитки за кадр, то есть лес
   проявляется за 7–20 кадров (≈0.1–0.3 с), а не за 2–4. Если заметно — доводка: на время дорисовки сводить плитки
   прежней ступени с целым увеличением/уменьшением (или ImageBitmap); решает основная сессия по замерам `amb-wire`.
7. (уточнено при сверке) Поверхности плиток — отдельные canvas. В Chromium/WebView2 малые canvas (≈ < 128² px)
   не ускоряются, и `drawImage` из них в ускоренный `back` может стоить выгрузки текстуры на каждом сведении (при сдвиге —
   каждый кадр). `amb-wire` меряет `ambientMs` при сдвиге на ступенях `u ≥ 4` (плитки 128² и меньше); если медиана
   > 3 мс — запасной путь `createImageBitmap` в `surface.ts` (интерфейс `Surface` не меняется).

## 9. Не входит

Блики на воде (CSS-анимация мокапа), эффекты действий (росток при добавлении, вспышка при выборе), звук, живность и
постройки, фон вне раздела «Граф», правка `CLAUDE.md` и `docs/ИНСТРУКЦИЯ.md` (этап 8).

## 10. Открытые вопросы (исполнение идёт по умолчаниям)

1. Светлячки ночью — только в «Луге» (как в мокапе) или во всех лесных сценах? По умолчанию — только «Луг».
2. `prefers-reduced-motion`: лес и пруды остаются неподвижной картинкой, эффектов нет. По умолчанию — так.
3. Скрытое окно: слой остаётся (режим `static`), память кэша не освобождается. По умолчанию — так.
4. «Бумага»: точечная сетка между нодами, волокна, редкие кляксы; без линовки. По умолчанию — так.
5. Пороги: листопад и светлячки — от 50 %, бабочки — от 75 %; снег и лучи — всегда. По умолчанию — так.
6. Смена поляны растворением в 3 шага (≈250 мс); при неподвижном режиме — мгновенно. По умолчанию — так.
7. На экранах крупнее ≈1600×1000 арт-пикселей эффекты укрупняются (предел 640 тыс. пикселей). По умолчанию — так.
8. «Живой фон» выключен — пропадает и лес (ровная земля), а не только движение. По умолчанию — так (требование плана).
9. Блики на прудах и эффекты действий из мокапа не переносятся. По умолчанию — не переносить.

## 11. Сверка (`spec-stage6-review`, 2026-11-13)

Проверено по коду: `lib/graph/ambient.ts` (контракт этапа 5, добавления §3.4 совместимы — `GraphCanvas` передаёт
`invalidate` без параметров, `theme.test.ts` проверяет только число вызовов), `GraphCanvas.tsx` (три canvas, `main`
прозрачный, ранний выход без темы, `drawMs` сейчас включает слой), `GraphView.tsx` (`stageEl`, `loaded`,
`useGraphGestures`), `geometry.ts` (`deviceTransform`: целые `ox/oy`, `k = zoom·dpr`, ступени
`0.125 … 2`), `theme.ts` (`packRgba`), `types.ts` (`Bounds`, `DeviceTransform`, `GraphScene.nodes`), `graphLayout.ts`
(`GRAPH_CELL = 32`, ноды в узлах `cx·32`, точки «Бумаги» в `+16` — между нодами), `ThemeProvider.useScene`
(`resolvedScene`, `pixel`, `ambient`), `hooks/useMediaQuery`, `mockup/forest.js` (формулы прудов и рощ совпадают с
§4.1), `mockup/weather.js`, `mockup/pixelfx/LICENSE` (MIT), `vitest.config.ts` (среда node, `src/**/*.test.ts`).

Расчёты: таблица решётки на 7 ступеней × dpr 1/1.25/1.5/2 — `u/q ∈ [0.8, 1.333]`, `size·u ∈ [510, 513]`, `u ≤ 8`;
рамки полян объектов покрывают спрайты с учётом `u/q = 1.34` и смещения опоры в пределах допуска теста; `reach` пруда
покрывает воду и камыши (наибольший `r` — 104 px мира); `CLEAR_REACH = 360` ≥ 358 (пруд у края рамки). Память кэша:
видимые плитки при `u = 1` — ≈20 × 1 МБ (1280×800 @1.5), 4K @1 на 12.5 % — 54 × 1 МБ ≈ 14 млн пикселей < предела.

Исправлено (помечено в тексте):
1. §5.3 — объём теста контраста: строгое «кромка ≥ 3 под заливкой» только для дневных «Луга» и «Осени» (где есть
   лучи); ночью кромки к земле ≈ 1.2–1.4 по замыслу этапа 5 — тест на восемь вариантов упал бы.
2. §4.2, §3.1 — `CLEAR_GROUND_R` 44 → 56 и опора мелочи земли — центр спрайта: иначе тест «24 px от квадрата ноды»
   не проходил по диагонали.
3. §6.5 — `useAmbient(loaded ? stageEl : null)`: сцена есть до загрузки данных без нод → лес без полян и растворение
   при каждом входе в раздел.
4. §6.4 — `drawMs` только граф (замер до `layer.draw`), иначе критерий §6.6 п. 2 непроверяем.
5. §4.6, §3.1 — бюджет плиток с учётом цены следующей (10 мс), запас-кольцо плиток в пределах памяти, место плитки в
   растворении; тесты движка поправлены под кольцо. §8 риск 6 пересчитан (3–5 мс на плитку 512²), добавлен риск 7
   (малые canvas без ускорения).
6. §5.2 — полный текст MIT в шапке `pixelfx/math.ts` (в сборке файла `LICENSE` нет), README — источник листопада и
   лучей; §6.6 п. 1 — проверка `Permission is hereby granted` в чанке.
7. §5.2 — бабочка у ноды полупрозрачна (крупнее ноды на пороге 75 %); ступени лучей — светлые (на этом держится
   проверка контраста белой заливкой).
8. §4.4 — рамка пруда, мера расстояния в тесте полян, грубая защита скорости `renderTile`; §3.5 — `/// <reference
   types="node" />` в `sceneVars.ts`; §3.1 — висячий JSDoc о точке опоры стал обычным комментарием.

Разбивка на пакеты не менялась: каждый файл у одного пакета, волна 1 зависит только от волны 0 (типы, `raster`,
`world.hash2`, `sceneVars`), подключение и браузер — только `amb-wire`. Изменились лишь условия «Готово» пакетов
`amb-world`, `amb-tiles`, `amb-engine`, `amb-sprites`, `amb-effects`, `amb-style`, `amb-wire` (по пунктам выше).
