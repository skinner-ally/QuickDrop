/*!
 * pixelfx (MIT) — перенесено и переписано на TypeScript из pixelfx core/math.js.
 * https://www.spritefusion.com/pixel-art-vfx
 *
 * MIT License
 *
 * Copyright (c) 2026 Patch
 * Copyright (c) 2026 Hugo Duprez
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// Числа и случайность по целым: всё чистое и детерминированное, эффект в момент t всегда выглядит одинаково.

export const TAU = Math.PI * 2

export function clamp(x: number, a = 0, b = 1): number {
  return x < a ? a : x > b ? b : x
}

/** Остаток, всегда неотрицательный при m > 0. */
export function wrap(x: number, m: number): number {
  return ((x % m) + m) % m
}

/** 32-битный целочисленный хеш любого числа целых. */
export function hash(...ns: number[]): number {
  let h = 0x9e3779b9
  for (const n of ns) {
    h = Math.imul(h ^ (n | 0), 0x85ebca6b)
    h ^= h >>> 13
    h = Math.imul(h, 0xc2b2ae35)
    h ^= h >>> 16
  }
  return h >>> 0
}

/** Детерминированное число в [0, 1) из целых (зерно, номер частицы, какое по счёту значение…). */
export function rand(...ns: number[]): number {
  return hash(...ns) / 4294967296
}
