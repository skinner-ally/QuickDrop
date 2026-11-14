/**
 * Решётка устройства живого фона (spec-stage6 §2.2). Пиксель графики фона = u пикселей устройства, u целое: спрайты
 * и плитки не масштабируются дробно ни при каком dpr, поэтому швов и мыла нет. Положения объектов идут от мира,
 * размер спрайта — от u (относительный размер u/q держится в [0.8, 1.34]).
 */

import type { Bounds, DeviceTransform } from '@/lib/graph/types'
import { AMBIENT_FX_MAX_PX } from '@/lib/ambient/types'
import type { Lod } from '@/lib/ambient/types'

export interface LatticeStep {
  /** Пикселей устройства в пикселе решётки, целое >= 1. */
  u: number
  lod: Lod
  /** Мировых px в пикселе решётки: u / k. */
  worldPerPx: number
  /** Сторона плитки, пикселей решётки. */
  size: number
  /** `${u}:${lod}:${k}` — часть ключа кэша. */
  key: string
}

/** Номинальная плитка, пикселей устройства; сторона в пикселях решётки — от неё и u. */
const TILE_DEVICE_PX = 512
const TILE_MIN = 64
const TILE_MAX = 512

/** k = zoom · dpr. Негодное k (не число, <= 0) — как k = 1. */
export function latticeStep(k: number): LatticeStep {
  const kk = Number.isFinite(k) && k > 0 ? k : 1
  // Номинальный арт-пиксель мокапа = 2 px мира.
  const q0 = 2 * kk
  const lod: Lod = q0 >= 0.75 ? 0 : q0 >= 0.375 ? 1 : 2
  const q = q0 * 2 ** lod
  const u = Math.max(1, Math.round(q))
  const size = Math.min(TILE_MAX, Math.max(TILE_MIN, Math.round(TILE_DEVICE_PX / u)))
  return { u, lod, worldPerPx: u / kk, size, key: `${u}:${lod}:${kk}` }
}

/**
 * Смягчение цветов фона к земле по масштабу: на обзоре фон бледнеет и не спорит с нодами.
 * Между ступенями — значение ближайшей меньшей; негодный zoom — как 1.
 */
export function softenFor(zoom: number): number {
  if (!(zoom > 0)) return 0
  if (zoom >= 1) return 0
  if (zoom >= 0.75) return 0.12
  if (zoom >= 0.5) return 0.25
  if (zoom >= 0.25) return 0.4
  return 0.5
}

/**
 * Арт-пиксель эффектов e (пикселей устройства) и размер растра w×h для canvas W×H. Пока площадь больше
 * AMBIENT_FX_MAX_PX, e растёт: на больших экранах эффекты крупнее, зато цена кадра ограничена.
 *
 * ref — опорный размер (окно в пикселях устройства): e выбирается по нему, растр считается по canvas. Иначе панель
 * деталей, сужая сцену, переводит её через порог, и снег с листьями на каждом выборе ноды мельчают в 1,5 раза.
 * Опора меньше canvas дополняется до canvas: площадь растра не выходит за предел ни при какой опоре.
 */
export function effectUnit(
  W: number,
  H: number,
  dpr: number,
  ref?: { W: number; H: number },
): { e: number; w: number; h: number } {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
  let e = Math.max(1, Math.round(2 * d))
  if (!(W > 0) || !(H > 0) || !Number.isFinite(W) || !Number.isFinite(H)) return { e, w: 0, h: 0 }
  const RW = ref && Number.isFinite(ref.W) && ref.W > W ? ref.W : W
  const RH = ref && Number.isFinite(ref.H) && ref.H > H ? ref.H : H
  while (Math.ceil(RW / e) * Math.ceil(RH / e) > AMBIENT_FX_MAX_PX) e += 1
  return { e, w: Math.ceil(W / e), h: Math.ceil(H / e) }
}

/** Мир → решётка. `+ 0` убирает −0. */
export function toLattice(step: LatticeStep, w: number): number {
  return Math.round(w / step.worldPerPx) + 0
}

/**
 * Плитки, покрывающие canvas [0, W) × [0, H) пикселей устройства (границы включительно).
 * W или H <= 0 — пустой диапазон (ti1 < ti0, tj1 < tj0).
 */
export function tileRange(
  step: LatticeStep,
  device: DeviceTransform,
  W: number,
  H: number,
): { ti0: number; tj0: number; ti1: number; tj1: number } {
  const T = step.size * step.u
  const ti0 = Math.floor((0 - device.ox) / T) + 0
  const tj0 = Math.floor((0 - device.oy) / T) + 0
  const ti1 = W > 0 ? Math.floor((W - 1 - device.ox) / T) + 0 : ti0 - 1
  const tj1 = H > 0 ? Math.floor((H - 1 - device.oy) / T) + 0 : tj0 - 1
  return { ti0, tj0, ti1, tj1 }
}

/** Границы плитки (ti, tj) в мире: решётка [ti·size, (ti+1)·size) × worldPerPx. */
export function tileBounds(step: LatticeStep, ti: number, tj: number): Bounds {
  const s = step.size * step.worldPerPx
  return { minX: ti * s + 0, minY: tj * s + 0, maxX: (ti + 1) * s + 0, maxY: (tj + 1) * s + 0 }
}

/** Левый верхний угол плитки на canvas, пиксели устройства (целые). */
export function tileOrigin(step: LatticeStep, device: DeviceTransform, ti: number, tj: number): { x: number; y: number } {
  const T = step.size * step.u
  return { x: device.ox + ti * T + 0, y: device.oy + tj * T + 0 }
}
