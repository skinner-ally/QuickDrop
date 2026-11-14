/*! pixelfx (MIT) — Copyright (c) 2026 Patch, Copyright (c) 2026 Hugo Duprez. Лицензия: src/lib/pixelfx/LICENSE */

// Солнечные лучи и пылинки. Переработка эффекта pixelfx weather/god-rays (через mockup/weather.js): тёплая
// полупрозрачная заливка без затемнения сцены. Ускорение: свет зависит от угла пикселя к источнику, поэтому на размер
// растра один раз считаются номер угла и затухание по расстоянию, а на тик — таблица света по углу и один проход.

import { blendPx, hexColor } from '@/lib/ambient/raster'
import { AMBIENT_OVERLAY_MAX } from '@/lib/ambient/types'
import type { AmbientEffect, EffectFrame, Raster } from '@/lib/ambient/types'
import { TAU, rand } from './math'

/** Длина петли, с. */
const RD = 10
/**
 * Масштаб веера лучей, арт-пиксели: источник и затухание заданы абсолютно, а не от размера растра, поэтому при
 * сужении сцены (панель деталей) лучи остаются на месте. 2.5 ≈ прежний вид на растре 835×445.
 */
const RAY_SCALE = 2.5
/** Период поля пылинок, арт-пиксели: положения считаются по ячейкам P×P от левого верхнего угла растра. */
const P = 512
/** Ось веера (вниз и вправо) и нормаль к ней; место пикселя в веере — его угол от оси. */
const AX = Math.cos(0.94)
const AY = Math.sin(0.94)
const NX = -AY
const NY = AX
/** Лучи: угол от оси, полуширина, сила, «дыхание» (циклов за петлю), покачивание. */
const SHAFTS = [
  { c: -0.27, h: 0.03, k: 0.65, b: 1, sw: 0.006 },
  { c: -0.17, h: 0.022, k: 0.55, b: 2, sw: 0.005 },
  { c: -0.07, h: 0.05, k: 1, b: 1, sw: 0.008 },
  { c: 0.03, h: 0.018, k: 0.6, b: 3, sw: 0.004 },
  { c: 0.12, h: 0.042, k: 0.85, b: 2, sw: 0.007 },
  { c: 0.23, h: 0.026, k: 0.6, b: 1, sw: 0.005 },
]
/** Углы таблицы: от −ANG_RANGE до +ANG_RANGE, ANG_BINS значений (лучи лежат в −0.3 … 0.27). */
const ANG_RANGE = 0.4
const ANG_BINS = 1024
const STR_N = 512

const alphaMax = AMBIENT_OVERLAY_MAX.alpha
/**
 * Ступени света. Только светлые цвета: тогда они меняют контраст кромки нод к земле не сильнее белого с той же альфой,
 * на чём держится проверка контраста (amb-style). Альфа не больше AMBIENT_OVERLAY_MAX.alpha.
 */
export const RAY_LEVELS: readonly number[] = [
  0,
  0,
  hexColor('#f2d27a', Math.min(0.05, alphaMax)),
  hexColor('#f2d27a', Math.min(0.09, alphaMax)),
  hexColor('#f6dc92', Math.min(0.13, alphaMax)),
  hexColor('#fff2c4', Math.min(0.17, alphaMax)),
  hexColor('#ffffff', Math.min(0.2, alphaMax)),
]
const MOTE = [hexColor('#f2d27a', 0.75), hexColor('#fff2c4', 0.9), hexColor('#ffffff', 1)]
/** Пылинка не рисуется ближе этого расстояния (мир, px) до ноды. */
export const MOTE_NEAR_R = 14

/**
 * Радиус проверки «рядом с нодой» для пылинки при perArt px мира на арт-пиксель. Проверяется центр пылинки с хвостом
 * (2×2 арт-пикселя), поэтому к MOTE_NEAR_R прибавляется пара арт-пикселей: на мелком масштабе арт-пиксель — это
 * 8–16 px мира, то есть целая нода.
 */
export function moteNearR(perArt: number): number {
  return MOTE_NEAR_R + 2 * perArt
}

export interface RayGeometry {
  w: number
  h: number
  /** Источник веера, арт-пиксели растра. */
  sx: number
  sy: number
  /** Номер угла (0 … ANG_BINS − 1) каждого пикселя. */
  bin: Uint16Array
  /** Затухание по расстоянию 0..1. */
  fall: Float32Array
}

let cached: RayGeometry | null = null

/** Геометрия лучей для растра w×h; для того же размера возвращает тот же объект. */
export function rayGeometry(w: number, h: number): RayGeometry {
  if (cached && cached.w === w && cached.h === h) return cached
  const s = RAY_SCALE
  const sx = -70 * s
  const sy = -130 * s
  const bin = new Uint16Array(w * h)
  const fall = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const dy = y + 0.5 - sy
    let r = (0.5 - sx) * AX + dy * AY
    let nn = (0.5 - sx) * NX + dy * NY
    for (let x = 0, k = y * w; x < w; x++, k++, r += AX, nn += NX) {
      const ang = nn / r
      const b = Math.floor(((ang + ANG_RANGE) / (2 * ANG_RANGE)) * ANG_BINS)
      bin[k] = b < 0 ? 0 : b >= ANG_BINS ? ANG_BINS - 1 : b
      const fl = 1.35 - (r / s - 200) / 330
      fall[k] = fl > 1 ? 1 : fl < 0 ? 0 : fl
    }
  }
  cached = { w, h, sx, sy, bin, fall }
  return cached
}

const lut = new Float32Array(ANG_BINS)
const str = new Float32Array(STR_N)
const SC = new Float32Array(SHAFTS.length)
const SI = new Float32Array(SHAFTS.length)
const SK = new Float32Array(SHAFTS.length)

/** Таблица света по углу на момент t: сила луча × «дыхание», без затухания по расстоянию. */
let lutT = Number.NaN

function fillLut(t: number): void {
  if (t === lutT) return
  lutT = t
  for (let i = 0; i < STR_N; i++) {
    const a = i / STR_N
    str[i] = 0.5 + 0.5 * Math.sin(a * 190 + Math.sin((TAU * t) / RD) * 2 + 3) * Math.sin(a * 77 - (TAU * t) / RD + 6)
  }
  const n = SHAFTS.length
  for (let j = 0; j < n; j++) {
    const sh = SHAFTS[j]
    SC[j] = sh.c + sh.sw * Math.sin((TAU * t) / RD + j * 1.3)
    SI[j] = 1 / (sh.h * (1 + 0.15 * Math.sin((TAU * sh.b * t) / RD + j)))
    SK[j] = sh.k * (0.72 + 0.28 * Math.sin((TAU * sh.b * t) / RD + j * 2.1))
  }
  for (let b = 0; b < ANG_BINS; b++) {
    const ang = -ANG_RANGE + ((b + 0.5) / ANG_BINS) * 2 * ANG_RANGE
    let e = 0
    for (let j = 0; j < n; j++) {
      const q = (ang - SC[j]) * SI[j]
      if (q > -1 && q < 1) {
        const w = 1 - q * q
        e += SK[j] * w * Math.sqrt(w)
      }
    }
    if (e <= 0) {
      lut[b] = 0
      continue
    }
    const si = ((ang + 0.36) * 700) | 0
    lut[b] = e * (0.7 + 0.45 * str[si < 0 ? 0 : si > STR_N - 1 ? STR_N - 1 : si])
  }
}

/** Сплошная заливка светом: один проход по пикселям. Альфа каждого пикселя не больше AMBIENT_OVERLAY_MAX.alpha. */
export function drawRayLight(out: Raster, t: number): void {
  const { w, h } = out
  if (w === 0 || h === 0) return
  const g = rayGeometry(w, h)
  fillLut(t)
  const d = out.data
  const bin = g.bin
  const fall = g.fall
  const n = w * h
  for (let k = 0; k < n; k++) {
    const l = lut[bin[k]]
    if (l < 0.06) continue
    const e = l * fall[k]
    if (e < 0.06) continue
    const c = RAY_LEVELS[e > 1.05 ? 6 : e > 0.78 ? 5 : e > 0.52 ? 4 : e > 0.3 ? 3 : 2]
    if (d[k] === 0) d[k] = c
    else blendPx(out, k % w, (k / w) | 0, c)
  }
}

/** Свет в точке растра (после drawRayLight за тот же t): сила 0 … ~1.2. */
function lightAtPx(g: RayGeometry, x: number, y: number): number {
  const k = y * g.w + x
  return lut[g.bin[k]] * g.fall[k]
}

/** Пылинок на ячейку: плотность прежняя, 1 на 2600 арт-пикселей. */
const MOTE_CELL_N = Math.round((P * P) / 2600)

/** Пылинки: плавают и видны только там, где пересекают луч. Зовётся сразу после drawRayLight (таблица света общая). */
export function drawMotes(out: Raster, f: EffectFrame): void {
  const { w: W, h: H } = out
  if (W === 0 || H === 0) return
  const g = rayGeometry(W, H)
  const t = f.t
  const d = out.data
  const perArt = Math.abs(f.wx(1) - f.wx(0)) || 1
  const nearR = moteNearR(perArt)
  // Положение — от угла ячейки (cx·P, cy·P) плюс покачивание до 22 и 20: границы обхода от размера растра не зависят.
  for (let cy = 0; cy * P - 30 < H; cy++) {
    for (let cx = 0; cx * P - 32 < W; cx++) {
      for (let i = 0; i < MOTE_CELL_N; i++) {
        const R = (q: number): number => rand(3, cx, cy, i, q)
        const n1 = 1 + Math.floor(R(1) * 2)
        const n2 = 1 + Math.floor(R(2) * 2)
        const x = Math.round(cx * P - 10 + R(3) * P + (8 + R(4) * 14) * Math.sin((TAU * n1 * t) / RD + R(5) * TAU))
        const y = Math.round(
          cy * P -
            10 +
            R(6) * P +
            (6 + R(7) * 10) * Math.sin((TAU * n2 * t) / RD + R(8) * TAU) +
            4 * Math.sin((TAU * 3 * t) / RD + i),
        )
        if (x < 0 || y < 0 || x >= W - 1 || y >= H - 1) continue
        const e = lightAtPx(g, x, y)
        if (e < 0.12) continue
        // над нодой светлая точка мешала бы читать: рядом с ней пылинок нет (центр пылинки с хвостом — между x и x + 1)
        if (f.near(f.wx(x + 0.5), f.wy(y + 0.5), nearR)) continue
        const k = y * W + x
        d[k] = MOTE[e > 0.6 ? 2 : e > 0.3 ? 1 : 0]
        if (R(9) < 0.3 && e > 0.5) {
          d[k + 1] = MOTE[0]
          d[k + W] = MOTE[0]
        }
      }
    }
  }
}

export const rays: AmbientEffect = {
  id: 'rays',
  plane: 'over',
  anchor: 'screen',
  draw(out, f) {
    drawRayLight(out, f.t)
    drawMotes(out, f)
  },
}
