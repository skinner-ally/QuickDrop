/**
 * Набор эффектов сцены (spec-stage6 §5.2). Эффекты без состояния: картинка — функция f.t и камеры.
 *
 *   Сцена   День                           Ночь
 *   Луг     лучи; бабочки (масштаб ≥ 75%)  светлячки (масштаб ≥ 50%)
 *   Осень   листопад (≥ 50%); лучи         листопад (≥ 50%)
 *   Зима    снег                           снег
 *   Бумага  —                              —
 */

import type { AmbientEffect, AmbientScene } from '@/lib/ambient/types'
import { leaves } from '@/lib/pixelfx/leaves'
import { rays } from '@/lib/pixelfx/rays'
import { butterflies } from './butterflies'
import { fireflies } from './fireflies'
import { snow } from './snow'

/** Наименьший масштаб графики для листопада, светлячков и бабочек. */
export const ZOOM_LEAVES = 0.5
export const ZOOM_FIREFLIES = 0.5
export const ZOOM_BUTTERFLIES = 0.75

const EMPTY: readonly AmbientEffect[] = Object.freeze([])
const CACHE = new Map<string, readonly AmbientEffect[]>()

/**
 * Эффекты сцены для времени суток и масштаба. Для одинаковых по составу аргументов возвращает тот же массив (движок
 * сравнивает списки по ссылке); пустой набор — всегда один и тот же пустой массив.
 */
export function effectsFor(scene: AmbientScene, dark: boolean, zoom: number): readonly AmbientEffect[] {
  const list: AmbientEffect[] = []
  const z = Number.isFinite(zoom) ? zoom : 0
  switch (scene) {
    case 'meadow':
      if (dark) {
        if (z >= ZOOM_FIREFLIES) list.push(fireflies)
      } else {
        list.push(rays)
        if (z >= ZOOM_BUTTERFLIES) list.push(butterflies)
      }
      break
    case 'autumn':
      if (z >= ZOOM_LEAVES) list.push(leaves)
      if (!dark) list.push(rays)
      break
    case 'winter':
      list.push(snow)
      break
    default:
      break
  }
  if (list.length === 0) return EMPTY
  const key = list.map((e) => e.id).join(',')
  let cached = CACHE.get(key)
  if (!cached) {
    cached = Object.freeze(list)
    CACHE.set(key, cached)
  }
  return cached
}
