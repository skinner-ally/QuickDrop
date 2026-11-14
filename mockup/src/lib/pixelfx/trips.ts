/*! pixelfx (MIT) — Copyright (c) 2026 Patch, Copyright (c) 2026 Hugo Duprez. Лицензия: src/lib/pixelfx/LICENSE */

// Помощники из pixelfx fx/weather/_lib.js (trips, bayer).

import { rand } from './math'

// Порог упорядоченного смешения 4×4 (Байер) для клетки: рисуется, если альфа выше порога.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16)

/** Порог клетки (x, y) от 0 до 1: «a > bayer(x, y)» — клетка рисуется. */
export function bayer(x: number, y: number): number {
  return BAYER[((Math.floor(y) & 3) << 2) | (Math.floor(x) & 3)]
}

/**
 * Падающие частицы для петли в D секунд: n мест, каждое падает m раз за петлю (m целое, от m0 до m1), каждый раз в новое
 * место. fn(u, k, m, i): u 0..1 — ход текущего падения, k — его номер (wrap(k, m) называет падение: свои случайные —
 * rand(seed, i, wrap(k, m), …), одинаковые каждую петлю), m, i — место. Падение длится D / m секунд.
 */
export function trips(
  t: number,
  D: number,
  n: number,
  seed: number,
  m0: number,
  m1: number,
  fn: (u: number, k: number, m: number, i: number) => void,
): void {
  for (let i = 0; i < n; i++) {
    const m = m0 + Math.floor(rand(seed, i, 72) * (m1 - m0 + 1))
    const s = (t / D) * m + rand(seed, i, 71)
    const k = Math.floor(s)
    fn(s - k, k, m, i)
  }
}
