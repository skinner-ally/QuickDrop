/**
 * Графика сцен живого фона (spec-stage6 §5.1): `buildSceneArt` собирает SceneArt для сцены, яркости, уровня lod и
 * смягчения. Вся графика процедурная (карты пикселей в Uint32Array), файлов и canvas нет.
 *
 * Базовые спрайты (lod 0, без смягчения) строятся один раз на сцену и яркость и общие для всех вызовов; lod 1/2 —
 * уменьшение базовых; смягчение к земле применяется лениво, на первое обращение к спрайту. Спрайты не меняются после
 * сборки: их можно хранить и сравнивать побайтно.
 */

import { downscale, mapColors, paintedCount, soften } from '@/lib/ambient/sprites/build'
import { buildForest } from '@/lib/ambient/sprites/forest'
import type { ForestSprites } from '@/lib/ambient/sprites/forest'
import { buildGround } from '@/lib/ambient/sprites/ground'
import type { GroundSprites } from '@/lib/ambient/sprites/ground'
import { GROUND } from '@/lib/ambient/sprites/palette'
import { hexColor } from '@/lib/ambient/raster'
import type { AmbientScene, Lod, ObjectKind, SceneArt, Sprite, WaterColors } from '@/lib/ambient/types'

export { downscale, nightColor, soften } from '@/lib/ambient/sprites/build'
export { GROUND } from '@/lib/ambient/sprites/palette'
export { DETAIL_SHARE } from '@/lib/ambient/sprites/ground'
export type { ForestSprites } from '@/lib/ambient/sprites/forest'

interface Base {
  forest: ForestSprites | null
  ground: GroundSprites
}

const bases = new Map<string, Base>()
const levels = new Map<string, ForestSprites | null>()

function baseOf(scene: AmbientScene, dark: boolean): Base {
  const key = `${scene}:${dark ? 1 : 0}`
  let b = bases.get(key)
  if (!b) {
    b = {
      forest: scene === 'paper' ? null : buildForest(scene, dark),
      ground: buildGround(scene, dark),
    }
    bases.set(key, b)
  }
  return b
}

/** Уменьшение спрайта на уровень lod: lod 1 — вдвое, lod 2 — вчетверо (тонкие вещи при необходимости — двумя шагами). */
function reduce(s: Sprite, lod: 1 | 2): Sprite {
  if (lod === 1) return downscale(s, 2)
  const direct = downscale(s, 4)
  // Камыш в 1 пиксель шириной при четвертинке пропадает: если осталось меньше половины ожидаемой площади — двумя шагами.
  if (paintedCount(direct) * 16 >= paintedCount(s) * 0.5) return direct
  return downscale(downscale(s, 2), 2)
}

function reduceForest(f: ForestSprites, lod: 1 | 2): ForestSprites {
  const r = (s: Sprite) => reduce(s, lod)
  return {
    tree: f.tree.map((a) => a.map(r)),
    pine: f.pine.map(r),
    bush: f.bush.map((a) => a.map(r)),
    stone: f.stone.map(r),
    small: f.small.map(r),
    reed: f.reed.map(r),
    lily: f.lily ? f.lily.map(r) : null,
    water: f.water,
  }
}

function forestAt(scene: AmbientScene, dark: boolean, lod: Lod): ForestSprites | null {
  const base = baseOf(scene, dark).forest
  if (!base || lod === 0) return base
  const key = `${scene}:${dark ? 1 : 0}:${lod}`
  let f = levels.get(key)
  if (f === undefined) {
    f = reduceForest(base, lod)
    levels.set(key, f)
  }
  return f
}

/** Элемент списка по номеру: дробные и выходящие за предел значения не ломают выбор (по модулю). */
function at<T>(list: readonly T[], i: number): T {
  const n = list.length
  return list[((Math.floor(i) % n) + n) % n]
}

function objectOf(f: ForestSprites, kind: ObjectKind, pal: number, variant: number): Sprite | null {
  switch (kind) {
    case 'tree':
      return at(at(f.tree, pal), variant)
    case 'pine':
      return at(f.pine, variant)
    case 'bush':
      return at(at(f.bush, pal), variant)
    case 'stone':
      return at(f.stone, variant)
    case 'small':
      return at(f.small, variant)
    case 'reed':
      return at(f.reed, variant)
    case 'lily':
      return f.lily ? at(f.lily, variant) : null
    default:
      return null
  }
}

/**
 * Графика сцены. scene — сцена, dark — ночь (лес, вода и тени — `nightColor` от дневных; мелочь — ночные цвета
 * мокапа), lod — уровень уменьшения (0 — полный размер, 1 — вдвое, 2 — вчетверо; мелочь и узор есть только на lod 0),
 * soft — доля смешения цветов с землёй, 0..0.5. «Бумага»: объектов и прудов нет, есть узор сетки и мелочь.
 */
export function buildSceneArt(scene: AmbientScene, dark: boolean, lod: Lod, soft: number): SceneArt {
  const ground = hexColor(GROUND[scene][dark ? 'night' : 'day'])
  const t = Number.isFinite(soft) ? Math.min(0.5, Math.max(0, soft)) : 0
  const base = baseOf(scene, dark)
  const forest = forestAt(scene, dark, lod)

  const memo = new Map<Sprite, Sprite>()
  const tone = (s: Sprite | null): Sprite | null => {
    if (!s || t === 0) return s
    let m = memo.get(s)
    if (!m) {
      m = mapColors(s, (c) => soften(c, ground, t))
      memo.set(s, m)
    }
    return m
  }
  const toneColor = (c: number): number => soften(c, ground, t)

  let water: WaterColors | null = null
  if (forest) {
    const w = forest.water
    water =
      t === 0
        ? w
        : {
            deep: toneColor(w.deep),
            mid: toneColor(w.mid),
            lit: toneColor(w.lit),
            bank: toneColor(w.bank),
            dash: toneColor(w.dash),
            shore: toneColor(w.shore),
          }
  }

  return {
    scene,
    dark,
    lod,
    soft: t,
    ground,
    object: (kind, pal, variant) => (forest ? tone(objectOf(forest, kind, pal, variant)) : null),
    detail: (r1, r2) => (lod === 0 ? tone(base.ground.detail(r1, r2)) : null),
    grid: lod === 0 ? tone(base.ground.grid) : null,
    water,
  }
}
