/**
 * Правило полян живого фона (spec-stage6 §4.2): чистая структура из центров нод. Объект леса скрыт, если нода
 * попадает в его рамку поляны; пруд рядом с нодой скрыт целиком; мелочь земли ближе CLEAR_GROUND_R не рисуется.
 * Подпись набора нод нужна кэшу плиток: плитка перерисовывается, только если сменились ноды рядом с ней.
 */

import type { Bounds } from '@/lib/graph/types'
import type { Pond, WorldObject } from '@/lib/ambient/world'

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

/**
 * Мелочь земли ближе этого к ноде не рисуется, px мира. Мелочь до DETAIL_LIMIT арт с опорой в центре выступает
 * до (3.5 + 1)·2·1.34 ≈ 12 px; по диагонали до квадрата ноды остаётся R − √2·(12 + 8) ≥ 24 при R ≥ 52.4.
 */
export const CLEAR_GROUND_R = 56

/** Сторона корзины индекса, px мира. */
const BUCKET = 128
// Корзина → одно число (как в graph/geometry.ts). Корзины в пределах ±2²¹ по каждой оси.
const KEY_OFFSET = 2 ** 21
const KEY_SPAN = 2 ** 22

function bucketKey(bx: number, by: number): number {
  return (bx + KEY_OFFSET) * KEY_SPAN + (by + KEY_OFFSET)
}

// Хеш точки по точным битам координат: любой сдвиг меняет подпись.
const f64 = new Float64Array(1)
const u32 = new Uint32Array(f64.buffer)

function fmix(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

function pointHash(x: number, y: number): number {
  f64[0] = x + 0 // −0 → 0
  let h = fmix(u32[0] ^ 0x9e3779b9)
  h = fmix(h ^ u32[1])
  f64[0] = y + 0
  h = fmix(Math.imul(h, 31) ^ u32[0])
  h = fmix(h ^ u32[1] ^ 0x7f4a7c15)
  return h
}

function validBounds(b: Bounds): boolean {
  // Сравнения с NaN ложны; бесконечные границы допустимы (обход всех корзин).
  return b.minX <= b.maxX && b.minY <= b.maxY
}

/** Набор полян из центров нод (мир). Негодные точки (не конечные числа) пропускаются. */
export function buildClearing(points: ReadonlyArray<{ x: number; y: number }>): Clearing {
  const xs: number[] = []
  const ys: number[] = []
  const hs: number[] = []
  const cells = new Map<number, number[]>()
  let sum = 0
  for (const p of points) {
    const x = p.x
    const y = p.y
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const i = xs.length
    xs.push(x)
    ys.push(y)
    const h = pointHash(x, y)
    hs.push(h)
    sum = (sum + h) >>> 0
    const key = bucketKey(Math.floor(x / BUCKET), Math.floor(y / BUCKET))
    const list = cells.get(key)
    if (list) list.push(i)
    else cells.set(key, [i])
  }
  const size = xs.length

  /** Обход точек корзин, задевающих рамку; visit → true останавливает обход. */
  const scan = (minX: number, minY: number, maxX: number, maxY: number, visit: (i: number) => boolean | void) => {
    const bx0 = Math.floor(minX / BUCKET)
    const bx1 = Math.floor(maxX / BUCKET)
    const by0 = Math.floor(minY / BUCKET)
    const by1 = Math.floor(maxY / BUCKET)
    const span = (bx1 - bx0 + 1) * (by1 - by0 + 1)
    if (!Number.isFinite(span) || span > cells.size) {
      // Рамка больше заполненных корзин — дешевле обойти сами корзины.
      for (const list of cells.values()) for (const i of list) if (visit(i)) return
      return
    }
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const list = cells.get(bucketKey(bx, by))
        if (list) for (const i of list) if (visit(i)) return
      }
    }
  }

  const near = (wx: number, wy: number, r: number): boolean => {
    if (size === 0 || !(r > 0) || !Number.isFinite(wx) || !Number.isFinite(wy)) return false
    const r2 = r * r
    let found = false
    scan(wx - r, wy - r, wx + r, wy + r, (i) => {
      const dx = xs[i] - wx
      const dy = ys[i] - wy
      if (dx * dx + dy * dy <= r2) found = true
      return found
    })
    return found
  }

  const inBox = (b: Bounds): boolean => {
    if (size === 0 || !validBounds(b)) return false
    let found = false
    scan(b.minX, b.minY, b.maxX, b.maxY, (i) => {
      if (xs[i] >= b.minX && xs[i] <= b.maxX && ys[i] >= b.minY && ys[i] <= b.maxY) found = true
      return found
    })
    return found
  }

  const signature = (b: Bounds): number => {
    if (size === 0 || !validBounds(b)) return 0
    // Сложение коммутативно — порядок точек не важен; число точек отличает набор от пустого.
    let s = 0
    let n = 0
    scan(b.minX, b.minY, b.maxX, b.maxY, (i) => {
      if (xs[i] >= b.minX && xs[i] <= b.maxX && ys[i] >= b.minY && ys[i] <= b.maxY) {
        s = (s + hs[i]) >>> 0
        n++
      }
    })
    return n === 0 ? 0 : (s + n) >>> 0
  }

  return { near, inBox, signature, key: size === 0 ? 0 : (sum + size) >>> 0, size }
}

/** Пустой набор: полян нет. */
export const EMPTY_CLEARING: Clearing = Object.freeze(buildClearing([]))

/** Объект скрыт поляной: нода в его рамке [x ± clearX] × [y − clearUp, y + clearDown]. Камыши и кувшинки — нет. */
export function objectCleared(o: WorldObject, c: Clearing): boolean {
  return (
    o.clearX > 0 &&
    c.inBox({ minX: o.x - o.clearX, minY: o.y - o.clearUp, maxX: o.x + o.clearX, maxY: o.y + o.clearDown })
  )
}

/** Пруд скрыт целиком (вместе с камышами и кувшинками): нода ближе reach к его центру. */
export function pondCleared(p: Pond, c: Clearing): boolean {
  return c.near(p.x, p.y, p.reach)
}
