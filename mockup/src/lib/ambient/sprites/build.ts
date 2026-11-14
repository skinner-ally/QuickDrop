/**
 * Построители спрайтов живого фона (spec-stage6 §5.1): карта пикселей в Uint32Array без canvas. Перенос `sprite`, `ell`
 * и `crown` из mockup/forest.js, плюс уменьшение (lod), ночной фильтр мокапа и смягчение цветов к земле.
 */

import { hash2 } from '@/lib/ambient/world'
import { chA, chB, chG, chR, mixColor } from '@/lib/ambient/raster'
import { packRgba } from '@/lib/graph/theme'
import type { Sprite } from '@/lib/ambient/types'

/** Запись пикселя во время рисования спрайта: вне границ — ничего, c = 0 стирает. */
export type PixelSetter = (x: number, y: number, c: number) => void

export interface SpriteOptions {
  /** Точка опоры; по умолчанию центр ширины (округляется вверх) и нижний край. */
  ax?: number
  ay?: number
  /** Контур в 1 пиксель вокруг нарисованного (4 соседа); 0 или не задан — без контура. */
  line?: number
  /** Овальная тень [cx, cy, rx, ry] цветом shadowColor: рисуется под телом и контуром. */
  shadow?: readonly [number, number, number, number]
  shadowColor?: number
}

/** Спрайт w×h: `paint` ставит пиксели тела, затем добавляются тень и контур. */
export function makeSprite(w: number, h: number, opts: SpriteOptions, paint: (set: PixelSetter) => void): Sprite {
  const body = new Uint32Array(w * h)
  paint((x, y, c) => {
    const X = Math.floor(x)
    const Y = Math.floor(y)
    if (X >= 0 && Y >= 0 && X < w && Y < h) body[Y * w + X] = c >>> 0
  })
  const data = new Uint32Array(w * h)
  if (opts.shadow && opts.shadowColor) {
    const [cx, cy, rx, ry] = opts.shadow
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) data[y * w + x] = opts.shadowColor
      }
    }
  }
  const line = opts.line ?? 0
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      if (body[i]) data[i] = body[i]
      else if (
        line &&
        ((x > 0 && body[i - 1]) || (x < w - 1 && body[i + 1]) || (y > 0 && body[i - w]) || (y < h - 1 && body[i + w]))
      ) {
        data[i] = line
      }
    }
  }
  return { w, h, data, ax: Math.round(opts.ax ?? w / 2), ay: Math.round(opts.ay ?? h - 1) }
}

/** Закрашенный эллипс: fn получает целые x, y и относительное расстояние от центра (0..1). */
export function ellipse(
  set: PixelSetter,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fn: (x: number, y: number, d: number) => number,
): void {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2
      if (d <= 1) set(x, y, fn(x, y, d))
    }
  }
}

/** Крона из нескольких шаров: свет слева сверху, у каждого шара своя тень — крона выходит комковатой. */
export function crown(
  set: PixelSetter,
  circles: ReadonlyArray<readonly [number, number, number]>,
  tones: readonly number[],
  seed: number,
): void {
  let x0 = 99
  let y0 = 99
  let x1 = 0
  let y1 = 0
  for (const [cx, cy, r] of circles) {
    x0 = Math.min(x0, cx - r)
    y0 = Math.min(y0, cy - r)
    x1 = Math.max(x1, cx + r)
    y1 = Math.max(y1, cy + r)
  }
  for (let y = Math.floor(y0); y <= y1; y++) {
    for (let x = Math.floor(x0); x <= x1; x++) {
      let best = 0
      let l = 0
      for (const [cx, cy, r] of circles) {
        const dx = (x + 0.5 - cx) / r
        const dy = (y + 0.5 - cy) / r
        const hh = 1 - dx * dx - dy * dy
        if (hh > best) {
          best = hh
          l = 0.5 - 0.36 * (dx + dy) + 0.12 * hh
        }
      }
      if (best <= 0) continue
      l += (hash2((x + ((y >> 1) & 1)) >> 1, y >> 1, seed) - 0.5) * 0.34
      set(x, y, tones[l < 0.3 ? 0 : l < 0.52 ? 1 : l < 0.78 ? 2 : 3])
    }
  }
}

/** Число закрашенных (альфа > 0) пикселей. */
export function paintedCount(s: Sprite): number {
  let n = 0
  for (let i = 0; i < s.data.length; i++) if (chA(s.data[i]) > 0) n++
  return n
}

function brightSum(c: number): number {
  return chR(c) + chG(c) + chB(c)
}

/**
 * Уменьшение в factor раз: блок factor×factor превращается в самый частый закрашенный цвет, если закрашено не меньше
 * minShare блока (по умолчанию половина); при равенстве побеждает более тёмный (контур не теряется). Точка опоры
 * делится на factor. Размер — ceil(w / factor) × ceil(h / factor).
 */
export function downscale(s: Sprite, factor: 2 | 4, minShare = 0.5): Sprite {
  const w = Math.ceil(s.w / factor)
  const h = Math.ceil(s.h / factor)
  const data = new Uint32Array(w * h)
  const need = Math.max(1, Math.ceil(factor * factor * minShare - 1e-9))
  const colors: number[] = []
  const counts: number[] = []
  for (let by = 0; by < h; by++) {
    for (let bx = 0; bx < w; bx++) {
      colors.length = 0
      counts.length = 0
      let painted = 0
      for (let y = by * factor; y < Math.min(s.h, (by + 1) * factor); y++) {
        for (let x = bx * factor; x < Math.min(s.w, (bx + 1) * factor); x++) {
          const c = s.data[y * s.w + x]
          if (chA(c) === 0) continue
          painted++
          const k = colors.indexOf(c)
          if (k < 0) {
            colors.push(c)
            counts.push(1)
          } else counts[k]++
        }
      }
      if (painted < need) continue
      let best = 0
      for (let k = 1; k < colors.length; k++) {
        if (counts[k] > counts[best] || (counts[k] === counts[best] && brightSum(colors[k]) < brightSum(colors[best]))) best = k
      }
      data[by * w + bx] = colors[best]
    }
  }
  return {
    w,
    h,
    data,
    ax: Math.min(w - 1, Math.max(0, Math.floor(s.ax / factor))),
    ay: Math.min(h - 1, Math.max(0, Math.floor(s.ay / factor))),
  }
}

/** Ночь (фильтр мокапа `brightness(.5) saturate(.85)`): яркость ×0.5, затем насыщенность ×0.85. Альфа не меняется. */
export function nightColor(c: number): number {
  const a = chA(c)
  if (a === 0) return c
  const r = chR(c) * 0.5
  const g = chG(c) * 0.5
  const b = chB(c) * 0.5
  const s = 0.85
  return packRgba(
    (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b,
    (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b,
    (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b,
    a,
  )
}

/** Смягчение: смесь цвета с землёй на долю t (0..0.5), альфа сохраняется; пустой цвет остаётся пустым. */
export function soften(c: number, ground: number, t: number): number {
  if (chA(c) === 0 || !(t > 0)) return c
  return mixColor(c, ground, t)
}

/** Копия спрайта с цветами, пропущенными через fn (пустые пиксели не трогаются). */
export function mapColors(s: Sprite, fn: (c: number) => number): Sprite {
  const data = new Uint32Array(s.data.length)
  for (let i = 0; i < data.length; i++) {
    const c = s.data[i]
    data[i] = chA(c) === 0 ? 0 : fn(c)
  }
  return { w: s.w, h: s.h, data, ax: s.ax, ay: s.ay }
}
