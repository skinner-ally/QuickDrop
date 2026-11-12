import { describe, expect, it } from 'vitest'
import { packRgba } from '@/lib/graph/theme'
import {
  blendPx,
  blitSprite,
  chA,
  chB,
  chG,
  chR,
  clearRaster,
  createRaster,
  ditherPx,
  fillRectPx,
  getPx,
  glow,
  hexColor,
  mixColor,
  rgba,
  setPx,
  shadeBox,
  withAlpha,
} from '@/lib/ambient/raster'
import type { Raster } from '@/lib/ambient/types'

const ch = (c: number) => [chR(c), chG(c), chB(c), chA(c)]
const painted = (r: Raster) => r.data.reduce((n, v) => n + (v !== 0 ? 1 : 0), 0)

describe('цвета', () => {
  it('rgba и каналы — та же раскладка, что packRgba (байты r, g, b, a)', () => {
    const c = rgba(10, 20, 30, 40)
    expect(c).toBe(packRgba(10, 20, 30, 40))
    expect(ch(c)).toEqual([10, 20, 30, 40])
    expect(chA(rgba(1, 2, 3))).toBe(255)
    const bytes = new Uint8Array(new Uint32Array([c]).buffer)
    expect([...bytes]).toEqual([10, 20, 30, 40])
  })
  it('hexColor: #rgb, #rrggbb, альфа, негодное → 0', () => {
    expect(ch(hexColor('#86ab5e'))).toEqual([0x86, 0xab, 0x5e, 255])
    expect(ch(hexColor('#fa0'))).toEqual([255, 170, 0, 255])
    expect(chA(hexColor('#000000', 0.2))).toBe(51)
    expect(hexColor('nope')).toBe(0)
    expect(hexColor('#12345')).toBe(0)
  })
  it('mixColor и withAlpha', () => {
    const a = rgba(0, 100, 200, 128)
    const b = rgba(100, 200, 0, 255)
    expect(ch(mixColor(a, b, 0))).toEqual([0, 100, 200, 128])
    expect(ch(mixColor(a, b, 1))).toEqual([100, 200, 0, 128])
    expect(ch(mixColor(a, b, 0.5))).toEqual([50, 150, 100, 128])
    expect(ch(mixColor(a, b, 7))).toEqual([100, 200, 0, 128])
    expect(ch(withAlpha(b, 0.5))).toEqual([100, 200, 0, 128])
    expect(chA(withAlpha(b, 2))).toBe(255)
  })
})

describe('запись пикселей', () => {
  it('createRaster и clearRaster', () => {
    const r = createRaster(3.7, 2)
    expect([r.w, r.h, r.data.length]).toEqual([3, 2, 6])
    setPx(r, 0, 0, rgba(1, 1, 1))
    clearRaster(r)
    expect(painted(r)).toBe(0)
    expect(createRaster(-1, 5).data.length).toBe(0)
  })

  it('ничего не пишется вне растра', () => {
    const c = rgba(200, 10, 10)
    // растр 4×4 внутри большего буфера: проверяем, что соседние ячейки не трогаются
    const r = createRaster(4, 4)
    for (const [x, y] of [[-1, 0], [0, -1], [4, 0], [0, 4], [-0.5, 2], [3.99, 4], [100, 100], [-100, -100]]) {
      setPx(r, x, y, c)
      blendPx(r, x, y, c, 0.5)
      ditherPx(r, x, y, c, 1)
    }
    expect(painted(r)).toBe(0)
    fillRectPx(r, -10, -10, 5, 5, c)
    fillRectPx(r, 4, 0, 10, 10, c)
    blitSprite(r, { w: 2, h: 2, data: new Uint32Array(4).fill(c) }, 4, 4)
    blitSprite(r, { w: 2, h: 2, data: new Uint32Array(4).fill(c) }, -2, 0)
    glow(r, -20, -20, 5, c, 1)
    shadeBox(r, -5, -5, 0, 0, () => c)
    shadeBox(r, 4, 4, 9, 9, () => c)
    expect(painted(r)).toBe(0)
  })

  it('setPx: дробные координаты — floor, c = 0 — ничего', () => {
    const r = createRaster(4, 4)
    const c = rgba(1, 2, 3)
    setPx(r, 1.9, 2.2, c)
    expect(getPx(r, 1, 2)).toBe(c)
    setPx(r, 1, 2, 0)
    expect(getPx(r, 1, 2)).toBe(c)
    expect(getPx(r, -1, 0)).toBe(0)
  })

  it('blendPx на пустом пикселе — цвет с альфой a·k', () => {
    const r = createRaster(2, 1)
    blendPx(r, 0, 0, rgba(40, 80, 120, 200), 0.5)
    expect(ch(getPx(r, 0, 0))).toEqual([40, 80, 120, 100])
    blendPx(r, 1, 0, rgba(40, 80, 120, 255))
    expect(ch(getPx(r, 1, 0))).toEqual([40, 80, 120, 255])
  })

  it('blendPx на непрозрачном — смесь с альфой 255', () => {
    const r = createRaster(1, 1)
    setPx(r, 0, 0, rgba(0, 0, 0))
    blendPx(r, 0, 0, rgba(255, 255, 255, 255), 0.2)
    expect(ch(getPx(r, 0, 0))).toEqual([51, 51, 51, 255])
    blendPx(r, 0, 0, rgba(255, 0, 0, 255), 0)
    expect(ch(getPx(r, 0, 0))).toEqual([51, 51, 51, 255])
  })

  it('blendPx на полупрозрачном — «поверх» с прямой альфой', () => {
    const r = createRaster(1, 1)
    setPx(r, 0, 0, rgba(0, 0, 255, 128))
    blendPx(r, 0, 0, rgba(255, 0, 0, 128))
    const [cr, , cb, ca] = ch(getPx(r, 0, 0))
    // альфа 0.502 + 0.502·0.498 ≈ 0.752
    expect(ca).toBeGreaterThanOrEqual(191)
    expect(ca).toBeLessThanOrEqual(192)
    expect(cr).toBeGreaterThan(cb)
  })

  it('ditherPx при a = 0.5 закрашивает ровно 8 из 16 клеток; 0 и 1 — ни одной и все', () => {
    for (const [a, n] of [[0.5, 8], [0, 0], [1, 16], [0.25, 4], [0.75, 12]] as const) {
      const r = createRaster(4, 4)
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) ditherPx(r, x, y, rgba(9, 9, 9), a)
      expect(painted(r), `a = ${a}`).toBe(n)
    }
    // смещённый блок 4×4 (в т.ч. через отрицательные координаты узора) — та же доля
    const r = createRaster(8, 8)
    for (let y = 2; y < 6; y++) for (let x = 3; x < 7; x++) ditherPx(r, x, y, rgba(9, 9, 9), 0.5)
    expect(painted(r)).toBe(8)
  })

  it('fillRectPx обрезается по краям', () => {
    const r = createRaster(4, 4)
    fillRectPx(r, -1, -1, 3, 3, rgba(5, 5, 5))
    expect(painted(r)).toBe(4)
    fillRectPx(r, 3, 3, 9, 9, rgba(5, 5, 5))
    expect(painted(r)).toBe(5)
  })
})

describe('blitSprite', () => {
  const A = rgba(255, 0, 0)
  const B = rgba(0, 0, 255, 128)
  // спрайт 3×2: A 0 B / A A A
  const sprite: Raster = { w: 3, h: 2, data: new Uint32Array([A, 0, B, A, A, A]) }

  it('непрозрачные — запись, 0 — пропуск, полупрозрачные — смешение', () => {
    const r = createRaster(5, 5)
    const under = rgba(0, 255, 0)
    fillRectPx(r, 0, 0, 5, 5, under)
    blitSprite(r, sprite, 1, 1)
    expect(getPx(r, 1, 1)).toBe(A)
    expect(getPx(r, 2, 1)).toBe(under)
    const mixed = ch(getPx(r, 3, 1))
    expect(mixed[3]).toBe(255)
    expect(mixed[1]).toBeGreaterThan(100)
    expect(mixed[2]).toBeGreaterThan(100)
    expect([getPx(r, 1, 2), getPx(r, 2, 2), getPx(r, 3, 2)]).toEqual([A, A, A])
  })

  it('обрезается по всем краям', () => {
    const left = createRaster(4, 4)
    blitSprite(left, sprite, -2, 0) // видна только правая колонка: B, A
    expect(painted(left)).toBe(2)
    expect(getPx(left, 0, 1)).toBe(A)
    const bottomRight = createRaster(4, 4)
    blitSprite(bottomRight, sprite, 3, 3) // виден только левый верхний пиксель: A
    expect(painted(bottomRight)).toBe(1)
    expect(getPx(bottomRight, 3, 3)).toBe(A)
    const top = createRaster(4, 4)
    blitSprite(top, sprite, 0, -1) // видна нижняя строка
    expect(painted(top)).toBe(3)
    const far = createRaster(4, 4)
    blitSprite(far, sprite, 10, -10)
    expect(painted(far)).toBe(0)
  })
})

describe('glow и shadeBox', () => {
  it('glow: ярче в центре, пусто за радиусом, симметрично', () => {
    const r = createRaster(9, 9)
    glow(r, 4.5, 4.5, 3.5, rgba(255, 255, 255), 1)
    const a =(x: number, y: number) => chA(getPx(r, x, y))
    expect(a(4, 4)).toBeGreaterThan(a(5, 4))
    expect(a(5, 4)).toBeGreaterThan(a(6, 4))
    expect(a(3, 4)).toBe(a(5, 4))
    expect(a(4, 3)).toBe(a(4, 5))
    expect(getPx(r, 0, 0)).toBe(0)
    expect(getPx(r, 8, 4)).toBe(0)
    // альфа (1 − d)² · k: в центре пикселя (4.5, 4.5) d = 0
    const r2 = createRaster(9, 9)
    glow(r2, 4.5, 4.5, 4, rgba(255, 255, 255), 0.5)
    expect(chA(getPx(r2, 4, 4))).toBe(128)
    expect(chA(getPx(r2, 6, 4))).toBe(Math.round(0.25 * 0.5 * 255))
  })

  it('shadeBox: fn по центрам пикселей, 0 — оставить', () => {
    const r = createRaster(4, 4)
    const seen: Array<[number, number]> = []
    shadeBox(r, 1, 1, 3, 3, (px, py) => {
      seen.push([px, py])
      return px < 2 ? rgba(7, 7, 7) : 0
    })
    expect(seen).toEqual([[1.5, 1.5], [2.5, 1.5], [1.5, 2.5], [2.5, 2.5]])
    expect(painted(r)).toBe(2)
    expect(getPx(r, 1, 1)).toBe(rgba(7, 7, 7))
  })
})
