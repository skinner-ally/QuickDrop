/*! pixelfx (MIT) — Copyright (c) 2026 Patch, Copyright (c) 2026 Hugo Duprez. Лицензия: src/lib/pixelfx/LICENSE */

// Листопад на графе. Переработка эффекта pixelfx weather/falling-leaves (через mockup/weather.js) под вид сверху и
// произвольный размер растра. Чистая функция от времени и растра: ничего не помнит между кадрами.

import { blendPx, glow, shadeBox } from '@/lib/ambient/raster'
import type { AmbientEffect, EffectFrame, Raster } from '@/lib/ambient/types'
import { fit, hex, mix } from './color'
import { TAU, hash, rand, wrap } from './math'
import { bayer, trips } from './trips'

/** Длина петли, с: вдвое спокойнее исходной. */
const LD = 16
const SEED = 8 * 19
const gust = (t: number): number => 16 * Math.sin((TAU * t) / LD - 1.2) + 5 * Math.sin((TAU * 3 * t) / LD)
// ∫|cos| от начала качания: лист ускоряется в нижней точке дуги
const Hc = (th: number): number => {
  const k = Math.floor((th + Math.PI / 2) / Math.PI)
  return 2 * k + 1 + Math.sin(th - k * Math.PI)
}

type ShapeFn = (u: number, v: number) => number
// Контур листа в его осях: u вдоль (−1 черешок … 1 кончик), v поперёк; до 1 — внутри.
const SHAPES: readonly ShapeFn[] = [
  (u, v) => (Math.abs(u) >= 1 ? 9 : (v * v) / (0.36 * (1 - u * u) * (1.15 - 0.3 * u))), // бук
  (u, v) => {
    const r = Math.hypot(u, v * 1.1)
    const a = Math.atan2(v, u)
    return r / (0.62 + 0.38 * Math.abs(Math.cos(2.5 * a)) ** 1.5) // клён
  },
  (u, v) => (Math.abs(u) >= 1 ? 9 : (v * v) / (0.16 * (1 - u * u))), // ива
]

const DAY: number[][] = [
  ['#4a1d0c', '#8a3a14', '#c8621e', '#f0982e', '#ffcf72', '#fff0c4'],
  ['#40101a', '#7c1c22', '#b8302a', '#e85a3c', '#ff9a72', '#ffd8c4'],
  ['#3e300c', '#7a5c14', '#b8901e', '#e8c23a', '#fff09a', '#fffbe0'],
].map((r) => fit(r, 6))
const DUSK = hex('#2c2132')
const NIGHT: number[][] = DAY.map((r) => r.map((c) => mix(c, DUSK, 0.5)))

const BACK_A = hex('#9c8a78')
const BACK_B = hex('#c8b49c')
const BACK_C = hex('#e0d0b8')
const BACK_VEIN = hex('#e8dcc8')

/** Во сколько раз бледнее лист, который приземляется у ноды. */
export const LEAF_NEAR_ALPHA = 0.35
/** Радиус (мир, px) от точки приземления до ближайшей ноды, при котором лист не ложится. */
export const LEAF_NEAR_R = 36

/**
 * Радиус проверки «рядом с нодой» для листа размера size (арт-пиксели) при perArt px мира на арт-пиксель. LEAF_NEAR_R —
 * нижняя граница: на мелком масштабе лист (до 1.25·size от центра вместе с черешком) длиннее 36 px мира и без запаса
 * уходил бы под ноду; 12 ≈ половина диагонали ноды (16 px).
 */
export function leafNearR(size: number, perArt: number): number {
  return Math.max(LEAF_NEAR_R, 12 + (1.25 * size + 1.5) * perArt)
}

/**
 * Лист: сжат поперёк на flip (знак — какая сторона видна), повёрнут, с контуром и жилкой; изнанка бледнее.
 * a — альфа (смешение упорядоченным шаблоном: пиксель либо есть, либо нет).
 */
export function drawLeaf(
  r: Raster,
  x: number,
  y: number,
  size: number,
  ang: number,
  flip: number,
  shape: number,
  col: readonly number[],
  a: number,
): void {
  if (!(a > 0)) return
  const back = flip < -0.25
  const fs = 0.35 + 0.65 * Math.abs(flip)
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  const L = size
  const Wd = size * 0.9
  const ext = L + 1.5
  const shapeFn = SHAPES[shape % SHAPES.length]
  const face = back
    ? [mix(col[1], BACK_A, 0.2), mix(col[2], BACK_B, 0.22), mix(col[3], BACK_C, 0.22)]
    : [col[2], col[3], col[4]]
  const rim = col[0]
  const vein = back ? mix(col[2], BACK_VEIN, 0.5) : col[1]
  shadeBox(r, x - ext, y - ext, x + ext, y + ext, (px, py) => {
    const dx = px - x
    const dy = py - y
    const lu = (dx * c + dy * s) / L
    const lv = (-dx * s + dy * c) / (Wd * fs)
    if (lu < -1.25 || lu > 1.1) return 0
    const across = Math.abs(lv * Wd * fs)
    let color: number
    if (lu < -0.92 && across < 0.5) {
      color = rim
    } else {
      const d = shapeFn(lu, lv)
      if (d > 1.32) return 0
      if (d > 1) color = rim
      else if (across < 0.45 && lu > -0.9 && lu < 0.75) color = vein
      else color = lv < -0.15 ? face[2] : lv < 0.35 ? face[1] : face[0]
    }
    return a >= 1 || a > bayer(px, py) ? color : 0
  })
}

/**
 * Период поля листьев, арт-пиксели. Положения считаются в абсолютных арт-пикселях от левого верхнего угла растра по
 * ячейкам P×P, а не в долях его размера: при сужении сцены (панель деталей) листья остаются на своих местах.
 */
const P = 512
/** Листьев на ячейку: плотность прежняя, 1 на 11000 арт-пикселей. */
const CELL_N = Math.max(1, Math.round((P * P) / 11000))

/** Листья падают «с неба» на случайные места поля, лежат и тают. Растр — w×h арт-пикселей. */
function paintLeaves(out: Raster, f: EffectFrame): void {
  const W = out.w
  const H = out.h
  if (W === 0 || H === 0) return
  const t = f.t
  const R3 = f.dark ? NIGHT : DAY
  const perArt = Math.abs(f.wx(1) - f.wx(0)) || 1
  // Ячейка даёт листья с точкой приземления в [cy·P − 10, cy·P − 10 + P), стартом до 200 выше и дрейфом по x вправо до
  // ~85 и влево до ~66: дальше этих границ ни один её лист в растр не попадает. Границы не зависят от размера растра.
  for (let cy = 0; cy * P - 230 < H; cy++) {
    for (let cx = 0; cx * P - 110 < W; cx++) {
      const seed = hash(SEED, cx, cy)
      paintCell(out, f, perArt, R3, seed, cx, cy, t)
    }
  }
}

function paintCell(
  out: Raster,
  f: EffectFrame,
  perArt: number,
  R3: number[][],
  seed: number,
  cx: number,
  cy: number,
  t: number,
): void {
  const W = out.w
  const H = out.h
  trips(t, LD, CELL_N, seed, 2, 3, (u, k, m, i) => {
    const j = wrap(k, m)
    const R = (q: number): number => rand(seed, i, j, q)
    const near = R(1) < 0.35
    const dur = LD / m
    const tf = dur * 0.72
    const a = Math.min(u * dur, tf)
    const rest = u * dur - tf
    const w = 1.7 + R(2) * 1.2
    const ph0 = R(3) * TAU
    const amp = (near ? 14 : 8) + R(4) * 10
    // вид сверху: у каждого листа своя точка приземления, а не общая линия пола
    const yLand = cy * P - 10 + R(13) * P
    const drop = 130 + R(12) * 70
    const x0 = cx * P - 30 + R(5) * P
    const y0 = yLand - drop
    const path = (aa: number): number => 0.45 * aa + (0.9 * (Hc(w * aa + ph0) - Hc(ph0))) / w
    const vy = drop / path(tf)
    const born = t - u * dur
    const xAt = (aa: number): number =>
      x0 + 7 * aa + Math.sin(w * aa + ph0) * amp + (gust(born + aa) - gust(born)) * (near ? 1 : 0.7)
    const size = (near ? 5.8 : 4.2) + R(6) * 1.6
    const shape = Math.floor(R(7) * 3)
    const col = R3[Math.floor(R(8) * 3)]
    // целиком вне растра (с запасом на лист и блик): не считаем и не рисуем
    const margin = 2 * size + 10
    const outside = (x: number, y: number): boolean => x < -margin || x > W + margin || y < -margin || y > H + margin
    const xLand = xAt(tf)
    // листья не ложатся на ноды и вплотную к ним
    const nearNode = (): boolean => f.near(f.wx(xLand), f.wy(yLand), leafNearR(size, perArt))
    if (rest > 0) {
      if (outside(xLand, yLand) || nearNode()) return
      drawLeaf(out, xLand, yLand, size, (R(9) - 0.5) * 0.5, 0.42, shape, col, 1 - rest / (dur - tf))
      return
    }
    const g = a / tf // 0 — только появился высоко над полем, 1 — у земли
    const x = xAt(a)
    const y = y0 + vy * path(a)
    if (outside(x, y)) return
    const kNear = nearNode() ? LEAF_NEAR_ALPHA : 1
    const tilt = Math.cos(w * a + ph0) * 0.75 + (near ? 0 : 0.3)
    const flip = Math.cos(R(10) * TAU + a * (R(11) < 0.3 ? 5 : 1.2))
    const sz = size * (1.3 - 0.3 * g)
    drawLeaf(out, x, y, sz, tilt, flip, shape, col, Math.min(1, a / 0.5) * kNear)
    if (flip > 0.86 && !f.dark) {
      const kk = (flip - 0.86) / 0.14
      const hx = x - Math.cos(tilt) * sz * 0.3
      const hy = y - Math.sin(tilt) * sz * 0.3 - 1
      blendPx(out, hx, hy, col[5], kNear)
      glow(out, hx, hy, 5 + sz * 0.5, col[4], 0.22 * kk * kNear)
    }
  })
}

export const leaves: AmbientEffect = { id: 'leaves', plane: 'under', anchor: 'screen', draw: paintLeaves }

