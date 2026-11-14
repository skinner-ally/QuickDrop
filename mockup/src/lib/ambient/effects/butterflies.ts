/**
 * Бабочки («Луг», день, масштаб от 75 %): по ячейкам мира 512 px с вероятностью 0.25 одна. Привязаны к миру (world).
 * Путь — опора + (160·sin(0.07t + ph), 90·sin(0.05t + 2ph)). Спрайт маленький (9×7 арт-пикселей, 3 кадра взмаха, 3
 * расцветки, зеркалится по направлению). Размер — в арт-пикселях растра, а не мира: на масштабе 75 % бабочка крупнее
 * ноды, поэтому над нодой (`near`) рисуется через упорядоченное смешение с альфой 0.3 и ноду не закрывает.
 * Бабочка pixelfx (44×40 со свечением) не используется: закрывала бы ноды.
 */

import { hexColor, setPx } from '@/lib/ambient/raster'
import type { AmbientEffect, EffectFrame, Raster } from '@/lib/ambient/types'
import { WORLD_CHUNK, hash2 } from '@/lib/ambient/world'
import { TAU } from '@/lib/pixelfx/math'
import { bayer } from '@/lib/pixelfx/trips'

export const BUTTERFLY_W = 9
export const BUTTERFLY_H = 7
/** Вероятность бабочки в ячейке мира. */
export const BUTTERFLY_CHANCE = 0.25
/** Нижняя граница расстояния до ноды (мир, px), ближе которого бабочка бледнеет; настоящий порог — butterflyNearR. */
export const BUTTERFLY_NEAR_R = 24

/**
 * Порог «рядом с нодой» при perArt px мира на арт-пиксель. Спрайт задан в арт-пикселях растра, а не мира: чем крупнее
 * арт-пиксель (выше e, мельче масштаб), тем больше он в мире, и постоянных 24 px не хватает, чтобы непрозрачная бабочка
 * не закрыла ноду. 12 ≈ полудиагональ ноды (16 px), 7 ≈ полудиагональ спрайта 9×7 плюс пиксель на округление.
 */
export function butterflyNearR(perArt: number): number {
  return Math.max(BUTTERFLY_NEAR_R, 12 + 7 * perArt)
}
/** Альфа бабочки у ноды (упорядоченное смешение 4×4: закрашено 5 клеток из 16). */
export const BUTTERFLY_NEAR_ALPHA = 0.3
const REACH_X = 160
const REACH_Y = 90

// o — контур, w — крыло, l — светлое пятно, b — тело, «.» — пусто. Три кадра: крылья раскрыты, наполовину, сложены.
// Пятно только на левом крыле: зеркалирование по направлению полёта заметно.
const FRAMES: readonly (readonly string[])[] = [
  ['.oo.b.oo.', 'owwobowwo', 'owlwbwwwo', '.owwbwwo.', '..owbwo..', '.owobowo.', '..o.b.o..'],
  ['...o.o...', '..owbwo..', '.owwbwwo.', '.owlbwwo.', '..owbwo..', '...obo...', '....b....'],
  ['...o.o...', '....b....', '...wbw...', '...lbw...', '...wbw...', '....b....', '....b....'],
]
const COLORWAYS: readonly Record<'o' | 'w' | 'l' | 'b', string>[] = [
  { o: '#2a1206', w: '#e8862a', l: '#ffe9a8', b: '#241008' },
  { o: '#16224f', w: '#4fb4f0', l: '#e0f6ff', b: '#0b0f24' },
  { o: '#5a4a1e', w: '#f3e9b8', l: '#ffffff', b: '#3a2c12' },
]
/** Последовательность кадров взмаха (индексы FRAMES). */
const FLAP = [0, 1, 2, 1]

const SPRITES: Raster[][] = COLORWAYS.map((cw) =>
  FRAMES.map((rows) => {
    const data = new Uint32Array(BUTTERFLY_W * BUTTERFLY_H)
    rows.forEach((row, y) => {
      for (let x = 0; x < BUTTERFLY_W; x++) {
        const ch = row[x]
        if (ch === 'o' || ch === 'w' || ch === 'l' || ch === 'b') data[y * BUTTERFLY_W + x] = hexColor(cw[ch])
      }
    })
    return { w: BUTTERFLY_W, h: BUTTERFLY_H, data }
  }),
)

/** Спрайт расцветки и кадра взмаха (для тестов и рисования). */
export function butterflySprite(colorway: number, frame: number): Raster {
  return SPRITES[((colorway % 3) + 3) % 3][((frame % 3) + 3) % 3]
}

/**
 * Рисует бабочку: левый верхний угол спрайта в (x, y) растра; mirror — по горизонтали; faded — у ноды: упорядоченное
 * смешение (порог Байера, как ditherPx) с альфой BUTTERFLY_NEAR_ALPHA, но шаблон привязан к спрайту, а не к растру:
 * доля оставленных пикселей одна и та же в любом положении (у спрайта в 14 пикселей шаблон растра давал бы до 57 %).
 */
export function drawButterfly(
  out: Raster,
  x: number,
  y: number,
  colorway: number,
  frame: number,
  mirror: boolean,
  faded: boolean,
): void {
  const s = butterflySprite(colorway, frame)
  for (let sy = 0; sy < s.h; sy++) {
    for (let sx = 0; sx < s.w; sx++) {
      const c = s.data[sy * s.w + (mirror ? s.w - 1 - sx : sx)]
      if (c === 0) continue
      if (!faded || BUTTERFLY_NEAR_ALPHA > bayer(sx, sy)) setPx(out, x + sx, y + sy, c)
    }
  }
}

export interface Butterfly {
  x: number
  y: number
  /** Летит вправо (спрайт не зеркалится). */
  right: boolean
  colorway: number
  /** Сдвиг фазы взмаха, 0..1. */
  flap: number
}

/** Бабочка ячейки мира (cx, cy) на момент t; null — в ячейке бабочки нет. */
export function butterflyOfCell(cx: number, cy: number, t: number): Butterfly | null {
  if (hash2(cx, cy, 400) >= BUTTERFLY_CHANCE) return null
  const bx = cx * WORLD_CHUNK + hash2(cx, cy, 401) * WORLD_CHUNK
  const by = cy * WORLD_CHUNK + hash2(cx, cy, 402) * WORLD_CHUNK
  const ph = hash2(cx, cy, 403) * TAU
  return {
    x: bx + REACH_X * Math.sin(0.07 * t + ph),
    y: by + REACH_Y * Math.sin(0.05 * t + 2 * ph),
    right: Math.cos(0.07 * t + ph) >= 0,
    colorway: Math.floor(hash2(cx, cy, 404) * 3),
    flap: hash2(cx, cy, 405),
  }
}

function paint(out: Raster, f: EffectFrame): void {
  if (out.w === 0 || out.h === 0) return
  const perArt = Math.abs(f.wx(1) - f.wx(0)) || 1
  const nearR = butterflyNearR(perArt)
  const b = f.bounds
  const padX = REACH_X + BUTTERFLY_W * perArt
  const padY = REACH_Y + BUTTERFLY_W * perArt
  const cx0 = Math.floor((b.minX - padX) / WORLD_CHUNK)
  const cx1 = Math.floor((b.maxX + padX) / WORLD_CHUNK)
  const cy0 = Math.floor((b.minY - padY) / WORLD_CHUNK)
  const cy1 = Math.floor((b.maxY + padY) / WORLD_CHUNK)
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const bf = butterflyOfCell(cx, cy, f.t)
      if (!bf) continue
      const px = Math.floor(f.ax(bf.x)) - 4
      const py = Math.floor(f.ay(bf.y)) - 3
      if (px < -BUTTERFLY_W || py < -BUTTERFLY_H || px > out.w || py > out.h) continue
      const frame = FLAP[Math.floor(f.t * 8 + bf.flap * 4) & 3]
      drawButterfly(out, px, py, bf.colorway, frame, !bf.right, f.near(bf.x, bf.y, nearR))
    }
  }
}

export const butterflies: AmbientEffect = { id: 'butterflies', plane: 'over', anchor: 'world', draw: paint }
