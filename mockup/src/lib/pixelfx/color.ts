/*! pixelfx (MIT) — Copyright (c) 2026 Patch, Copyright (c) 2026 Hugo Duprez. Лицензия: src/lib/pixelfx/LICENSE */

// Цвета pixelfx поверх растра живого фона: числа в раскладке ImageData (packRgba), как у core/color.js.

import { hexColor, mixColor } from '@/lib/ambient/raster'
import { clamp } from './math'

/** '#rgb' | '#rrggbb' → число цвета (непрозрачное). */
export function hex(h: string): number {
  return hexColor(h)
}

/** Линейное смешение двух цветов (t ограничен 0..1). */
export function mix(a: number, b: number, t: number): number {
  return mixColor(a, b, clamp(t))
}

/**
 * Рампу из hex-строк — ровно в n ступеней, концы остаются на месте: эффект берёт ступени по номеру (C[5]), какой бы
 * длины рампу ни передали.
 */
export function fit(list: readonly string[], n: number): number[] {
  const r = list.map(hex)
  if (r.length === n) return r
  return Array.from({ length: n }, (_, i) => r[Math.round((i * (r.length - 1)) / Math.max(1, n - 1))])
}
