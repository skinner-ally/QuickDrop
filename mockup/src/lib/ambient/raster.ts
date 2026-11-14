/**
 * Операции над растром живого фона (Raster: Uint32Array в раскладке ImageData, альфа прямая, 0 — пусто).
 * Цвета упаковывает packRgba из lib/graph/theme — порядок байтов учтён там; разбор каналов ниже — зеркально.
 * Координаты пикселей — после Math.floor; всё, что вне растра, молча пропускается.
 */

import { packRgba } from '@/lib/graph/theme'
import type { Raster } from '@/lib/ambient/types'

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1

export function createRaster(w: number, h: number): Raster {
  const W = Math.max(0, Math.floor(w) || 0)
  const H = Math.max(0, Math.floor(h) || 0)
  return { w: W, h: H, data: new Uint32Array(W * H) }
}

export function clearRaster(r: Raster): void {
  r.data.fill(0)
}

/** Цвет из каналов 0..255; a по умолчанию 255. */
export function rgba(r: number, g: number, b: number, a = 255): number {
  return packRgba(r, g, b, a)
}

/** '#rgb' | '#rrggbb' (решётка необязательна); alpha 0..1. Негодная строка — 0 (пусто). */
export function hexColor(hex: string, alpha = 1): number {
  let s = hex.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.replace(/./g, (ch) => ch + ch)
  if (!/^[0-9a-f]{6}$/i.test(s)) return 0
  const n = parseInt(s, 16)
  return packRgba((n >> 16) & 255, (n >> 8) & 255, n & 255, Math.round(clamp01(alpha) * 255))
}

export function chR(c: number): number {
  return LITTLE_ENDIAN ? c & 255 : c >>> 24
}
export function chG(c: number): number {
  return LITTLE_ENDIAN ? (c >>> 8) & 255 : (c >>> 16) & 255
}
export function chB(c: number): number {
  return LITTLE_ENDIAN ? (c >>> 16) & 255 : (c >>> 8) & 255
}
export function chA(c: number): number {
  return LITTLE_ENDIAN ? c >>> 24 : c & 255
}

/** Смешение по каналам r, g, b: t = 0 — a, 1 — b (t ограничен 0..1); альфа берётся от a. */
export function mixColor(a: number, b: number, t: number): number {
  const k = clamp01(t)
  return packRgba(
    Math.round(chR(a) + (chR(b) - chR(a)) * k),
    Math.round(chG(a) + (chG(b) - chG(a)) * k),
    Math.round(chB(a) + (chB(b) - chB(a)) * k),
    chA(a),
  )
}

/** Тот же цвет с альфой alpha (0..1). */
export function withAlpha(c: number, alpha: number): number {
  return packRgba(chR(c), chG(c), chB(c), Math.round(clamp01(alpha) * 255))
}

/** Цвет пикселя; вне растра — 0. */
export function getPx(r: Raster, x: number, y: number): number {
  const X = Math.floor(x)
  const Y = Math.floor(y)
  if (X < 0 || Y < 0 || X >= r.w || Y >= r.h) return 0
  return r.data[Y * r.w + X]
}

/** Запись цвета как есть. Вне растра и прозрачный цвет (альфа 0, в т.ч. c = 0) — ничего. */
export function setPx(r: Raster, x: number, y: number, c: number): void {
  const X = Math.floor(x)
  const Y = Math.floor(y)
  if (X < 0 || Y < 0 || X >= r.w || Y >= r.h || chA(c) === 0) return
  r.data[Y * r.w + X] = c >>> 0
}

/** «Поверх» с прямой альфой; k (по умолчанию 1) умножает альфу c. */
export function blendPx(r: Raster, x: number, y: number, c: number, k = 1): void {
  const X = Math.floor(x)
  const Y = Math.floor(y)
  if (X < 0 || Y < 0 || X >= r.w || Y >= r.h) return
  blendAt(r.data, Y * r.w + X, c, k)
}

function blendAt(data: Uint32Array, i: number, c: number, k: number): void {
  const ca = chA(c)
  if (ca === 0 || !(k > 0)) return
  if (ca === 255 && k >= 1) {
    data[i] = c >>> 0
    return
  }
  const sa = Math.min(1, (ca / 255) * k)
  const dst = data[i]
  const da = chA(dst) / 255
  if (da === 0) {
    data[i] = packRgba(chR(c), chG(c), chB(c), Math.round(sa * 255))
    return
  }
  const oa = sa + da * (1 - sa)
  const wd = (da * (1 - sa)) / oa
  const ws = sa / oa
  data[i] = packRgba(
    Math.round(chR(c) * ws + chR(dst) * wd),
    Math.round(chG(c) * ws + chG(dst) * wd),
    Math.round(chB(c) * ws + chB(dst) * wd),
    Math.round(oa * 255),
  )
}

/** Матрица Байера 4×4 (порядок порогов). */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

/**
 * Упорядоченное смешение: пиксель либо рисуется цветом c (как blendPx с k = 1), либо нет. Доля закрашенных клеток
 * в любом блоке 4×4 — a (порог клетки (n + 0.5) / 16).
 */
export function ditherPx(r: Raster, x: number, y: number, c: number, a: number): void {
  const X = Math.floor(x)
  const Y = Math.floor(y)
  if (!(a > (BAYER4[((Y & 3) << 2) | (X & 3)] + 0.5) / 16)) return
  blendPx(r, X, Y, c)
}

/** Прямоугольник: непрозрачный цвет — запись, полупрозрачный — blendPx. Обрезается по растру. */
export function fillRectPx(r: Raster, x: number, y: number, w: number, h: number, c: number): void {
  if (chA(c) === 0) return
  const x0 = Math.max(0, Math.floor(x))
  const y0 = Math.max(0, Math.floor(y))
  const x1 = Math.min(r.w, Math.floor(x) + Math.floor(w))
  const y1 = Math.min(r.h, Math.floor(y) + Math.floor(h))
  for (let py = y0; py < y1; py++) {
    const row = py * r.w
    for (let px = x0; px < x1; px++) blendAt(r.data, row + px, c, 1)
  }
}

/** Спрайт s левым верхним углом в (x, y): непрозрачные пиксели — запись, полупрозрачные — blendPx, 0 — пропуск. */
export function blitSprite(r: Raster, s: Raster, x: number, y: number): void {
  const X = Math.floor(x)
  const Y = Math.floor(y)
  const sx0 = Math.max(0, -X)
  const sy0 = Math.max(0, -Y)
  const sx1 = Math.min(s.w, r.w - X)
  const sy1 = Math.min(s.h, r.h - Y)
  if (sx0 >= sx1 || sy0 >= sy1) return
  const src = s.data
  const dst = r.data
  for (let sy = sy0; sy < sy1; sy++) {
    const srow = sy * s.w
    const drow = (Y + sy) * r.w + X
    for (let sx = sx0; sx < sx1; sx++) {
      const c = src[srow + sx]
      if (c === 0) continue
      blendAt(dst, drow + sx, c, 1)
    }
  }
}

/**
 * Свечение: круг радиуса radius с центром (cx, cy) (непрерывные координаты растра); пиксель с центром на
 * относительном расстоянии d < 1 получает c с альфой, умноженной на (1 − d)² · k.
 */
export function glow(r: Raster, cx: number, cy: number, radius: number, c: number, k: number): void {
  if (!(radius > 0) || !(k > 0) || chA(c) === 0) return
  const x0 = Math.max(0, Math.floor(cx - radius))
  const y0 = Math.max(0, Math.floor(cy - radius))
  const x1 = Math.min(r.w, Math.ceil(cx + radius))
  const y1 = Math.min(r.h, Math.ceil(cy + radius))
  for (let py = y0; py < y1; py++) {
    const dy = py + 0.5 - cy
    for (let px = x0; px < x1; px++) {
      const dx = px + 0.5 - cx
      const d = Math.sqrt(dx * dx + dy * dy) / radius
      if (d >= 1) continue
      const f = 1 - d
      blendAt(r.data, py * r.w + px, c, f * f * k)
    }
  }
}

/**
 * Заливка функцией по рамке пикселей [floor(x0), ceil(x1)) × [floor(y0), ceil(y1)) ∩ растр: fn получает центр
 * пикселя (px + 0.5, py + 0.5); 0 — пиксель не трогается, иначе blendPx.
 */
export function shadeBox(
  r: Raster,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  fn: (px: number, py: number) => number,
): void {
  const ax = Math.max(0, Math.floor(x0))
  const ay = Math.max(0, Math.floor(y0))
  const bx = Math.min(r.w, Math.ceil(x1))
  const by = Math.min(r.h, Math.ceil(y1))
  for (let py = ay; py < by; py++) {
    const row = py * r.w
    for (let px = ax; px < bx; px++) {
      const c = fn(px + 0.5, py + 0.5)
      if (c !== 0) blendAt(r.data, row + px, c, 1)
    }
  }
}

function clamp01(v: number): number {
  return v > 0 ? (v < 1 ? v : 1) : 0
}
