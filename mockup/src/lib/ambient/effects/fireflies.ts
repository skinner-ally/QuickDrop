/**
 * Светлячки («Луг», ночь): по ячейкам мира 512 px, в каждой 1–5 штук (в среднем 3, на экране 1280×800 горит около
 * шести). Привязаны к миру (world): между тиками едут вместе с камерой. Блуждание ±46 × ±30 px мира и мерцание — формулы `drawFx` мокапа; места и фазы — от хеша ячейки, поэтому
 * картина не зависит от того, какие ячейки сейчас видны. Над нодой светлячок не рисуется.
 */

import { glow, hexColor, setPx } from '@/lib/ambient/raster'
import type { AmbientEffect, EffectFrame, Raster } from '@/lib/ambient/types'
import { WORLD_CHUNK, hash2 } from '@/lib/ambient/world'
import { TAU } from '@/lib/pixelfx/math'

const FLY0 = hexColor('#9ad02a')
const FLY1 = hexColor('#d6ff5a')
const FLY2 = hexColor('#f4ffb8')
/** Не рисуется ближе этого расстояния (мир, px) до ноды. */
export const FIREFLY_NEAR_R = 28
const WANDER_X = 46
const WANDER_Y = 30

export interface Firefly {
  /** Мир, с блужданием на момент t. */
  x: number
  y: number
  /** Яркость мерцания 0..1. */
  g: number
}

/** Светлячки ячейки мира (cx, cy) на момент t (включая невидимых, g < 0.06). */
export function firefliesOfCell(cx: number, cy: number, t: number): Firefly[] {
  const n = 1 + Math.floor(hash2(cx, cy, 300) * 5)
  const out: Firefly[] = []
  for (let j = 0; j < n; j++) {
    const s = 310 + j * 8
    const bx = cx * WORLD_CHUNK + hash2(cx, cy, s) * WORLD_CHUNK
    const by = cy * WORLD_CHUNK + hash2(cx, cy, s + 1) * WORLD_CHUNK
    const p1 = hash2(cx, cy, s + 2) * TAU
    const p2 = hash2(cx, cy, s + 3) * TAU
    const period = 3 + Math.floor(hash2(cx, cy, s + 4) * 4)
    const off = hash2(cx, cy, s + 5)
    const u = (((t / period + off) % 1) + 1) % 1
    const g = u < 0.08 ? u / 0.08 : u < 0.2 ? 1 : u < 0.5 ? 1 - (u - 0.2) / 0.3 : 0
    out.push({ x: bx + WANDER_X * Math.sin(t * 0.31 + p1), y: by + WANDER_Y * Math.sin(t * 0.43 + p2), g })
  }
  return out
}

function paint(out: Raster, f: EffectFrame): void {
  if (out.w === 0 || out.h === 0) return
  const perArt = Math.abs(f.wx(1) - f.wx(0)) || 1
  const pad = WANDER_X + 12 * perArt
  const b = f.bounds
  const cx0 = Math.floor((b.minX - pad) / WORLD_CHUNK)
  const cx1 = Math.floor((b.maxX + pad) / WORLD_CHUNK)
  const cy0 = Math.floor((b.minY - pad) / WORLD_CHUNK)
  const cy1 = Math.floor((b.maxY + pad) / WORLD_CHUNK)
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      for (const ff of firefliesOfCell(cx, cy, f.t)) {
        if (ff.g < 0.06) continue
        if (f.near(ff.x, ff.y, FIREFLY_NEAR_R)) continue
        const px = Math.floor(f.ax(ff.x))
        const py = Math.floor(f.ay(ff.y))
        if (px < -9 || py < -9 || px > out.w + 9 || py > out.h + 9) continue
        // Сначала свечение, поверх него ядро: в мокапе свет — отдельный слой над цветом.
        glow(out, px + 0.5, py + 0.5, 8, FLY0, 0.7 * ff.g)
        glow(out, px + 0.5, py + 0.5, 3, FLY2, 0.7 * ff.g)
        setPx(out, px, py, ff.g > 0.6 ? FLY2 : FLY1)
      }
    }
  }
}

export const fireflies: AmbientEffect = { id: 'fireflies', plane: 'over', anchor: 'world', draw: paint }
