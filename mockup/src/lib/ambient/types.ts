/**
 * Типы и константы живого фона графа (этап 6). Модуль без логики: общая основа решётки, растров, мира, плиток,
 * графики сцен и эффектов.
 */

import type { Bounds } from '@/lib/graph/types'

export type AmbientScene = 'meadow' | 'autumn' | 'paper' | 'winter'
export const AMBIENT_SCENES: readonly AmbientScene[] = ['meadow', 'autumn', 'paper', 'winter']
export type Lod = 0 | 1 | 2

/** Растр w×h. data — Uint32Array в раскладке ImageData (байты r, g, b, a; packRgba), альфа прямая. 0 — пусто. */
export interface Raster {
  w: number
  h: number
  data: Uint32Array
}
/** Спрайт: растр и точка опоры — пиксель спрайта, который ставится в точку объекта (низ ствола). */
export interface Sprite extends Raster {
  ax: number
  ay: number
}

export type ObjectKind = 'tree' | 'pine' | 'bush' | 'stone' | 'small' | 'reed' | 'lily'
/** Наибольший размер спрайта (lod 0) и число гамм и видов. Радиусы полян (world.ts) рассчитаны на эти размеры. */
export const SPRITE_LIMITS: Record<ObjectKind, { w: number; h: number; pals: number; variants: number }> = {
  tree: { w: 30, h: 40, pals: 4, variants: 3 },
  pine: { w: 20, h: 38, pals: 1, variants: 2 },
  bush: { w: 20, h: 15, pals: 4, variants: 2 },
  stone: { w: 13, h: 10, pals: 1, variants: 2 },
  small: { w: 15, h: 11, pals: 1, variants: 3 },
  reed: { w: 12, h: 18, pals: 1, variants: 3 },
  lily: { w: 9, h: 6, pals: 1, variants: 2 },
}
// Точка опоры спрайта объекта: по центру ширины (|ax − w/2| <= 1) и у нижнего края (h − 4 <= ay <= h − 1).
// Точка опоры мелочи земли и узора сетки — центр спрайта (|ax − w/2| <= 1, |ay − h/2| <= 1): на этом держится
// радиус CLEAR_GROUND_R (clearing.ts).
/** Наибольшая сторона спрайта мелочи земли и узора сетки, арт-пикселей. */
export const DETAIL_LIMIT = 7

export interface WaterColors {
  deep: number
  mid: number
  lit: number
  bank: number
  dash: number
  shore: number
}

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
/**
 * Бюджет отрисовки новых плиток за один кадр, мс. Следующая плитка не начинается, если с ценой прошлой выйдет за
 * бюджет: так кадр не уходит за предел на целую плитку.
 */
export const AMBIENT_TILE_BUDGET_MS = 10
/** Растворение плитки при смене поляны, мс (3 шага). */
export const AMBIENT_FADE_MS = 250
