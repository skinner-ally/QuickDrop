import { describe, expect, it } from 'vitest'
import { GRAPH_ZOOM_STEPS } from '@/lib/graph/geometry'
import { AMBIENT_FX_MAX_PX } from '@/lib/ambient/types'
import {
  effectUnit,
  latticeStep,
  softenFor,
  tileBounds,
  tileOrigin,
  tileRange,
  toLattice,
} from '@/lib/ambient/lattice'

const DPRS = [1, 1.25, 1.5, 2]

describe('latticeStep: 7 ступеней × dpr 1/1.25/1.5/2', () => {
  for (const zoom of GRAPH_ZOOM_STEPS) {
    for (const dpr of DPRS) {
      it(`zoom ${zoom}, dpr ${dpr}`, () => {
        const k = zoom * dpr
        const s = latticeStep(k)
        const q = 2 * k * 2 ** s.lod
        expect(Number.isInteger(s.u)).toBe(true)
        expect(s.u).toBeGreaterThanOrEqual(1)
        expect(s.u / q).toBeGreaterThanOrEqual(0.8)
        expect(s.u / q).toBeLessThanOrEqual(1.34)
        expect(s.size).toBeGreaterThanOrEqual(64)
        expect(s.size).toBeLessThanOrEqual(512)
        expect(Number.isInteger(s.size)).toBe(true)
        expect(s.size * s.u).toBeGreaterThanOrEqual(384)
        expect(s.size * s.u).toBeLessThanOrEqual(640)
        expect(s.worldPerPx).toBeCloseTo(s.u / k, 12)
        expect(s.key).toBe(`${s.u}:${s.lod}:${k}`)
      })
    }
  }

  it('уровни lod по номинальному арт-пикселю q0 = 2k', () => {
    expect(latticeStep(0.375).lod).toBe(0) // q0 = 0.75
    expect(latticeStep(0.37).lod).toBe(1)
    expect(latticeStep(0.1875).lod).toBe(1) // q0 = 0.375
    expect(latticeStep(0.18).lod).toBe(2)
    expect(latticeStep(0.125).lod).toBe(2)
  })

  it('негодное k — как k = 1', () => {
    const one = latticeStep(1)
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) expect(latticeStep(bad)).toEqual(one)
  })
})

describe('плитки', () => {
  const ks = GRAPH_ZOOM_STEPS.flatMap((z) => DPRS.map((d) => z * d))

  it('соседние плитки стыкуются без зазора, углы целые', () => {
    for (const k of ks) {
      const s = latticeStep(k)
      for (const device of [{ ox: 0, oy: 0, k }, { ox: -1234, oy: 777, k }, { ox: 98765, oy: -54321, k }]) {
        for (let ti = -3; ti <= 3; ti++) {
          const a = tileOrigin(s, device, ti, ti)
          const b = tileOrigin(s, device, ti + 1, ti + 1)
          expect(Number.isInteger(a.x) && Number.isInteger(a.y)).toBe(true)
          expect(b.x - a.x).toBe(s.size * s.u)
          expect(b.y - a.y).toBe(s.size * s.u)
        }
      }
    }
  })

  it('tileRange покрывает экран при отрицательных и больших ox, лишних плиток нет', () => {
    const W = 1920
    const H = 1201
    for (const k of ks) {
      const s = latticeStep(k)
      const T = s.size * s.u
      for (const ox of [0, 1, -1, -T, T, -100_003, 2_000_017, 513, -511]) {
        for (const oy of [0, -7, 9_999_991]) {
          const device = { ox, oy, k }
          const r = tileRange(s, device, W, H)
          const first = tileOrigin(s, device, r.ti0, r.tj0)
          const last = tileOrigin(s, device, r.ti1, r.tj1)
          // покрывает [0, W) × [0, H)
          expect(first.x).toBeLessThanOrEqual(0)
          expect(first.y).toBeLessThanOrEqual(0)
          expect(last.x + T).toBeGreaterThanOrEqual(W)
          expect(last.y + T).toBeGreaterThanOrEqual(H)
          // крайние плитки действительно видны
          expect(first.x + T).toBeGreaterThan(0)
          expect(first.y + T).toBeGreaterThan(0)
          expect(last.x).toBeLessThan(W)
          expect(last.y).toBeLessThan(H)
        }
      }
    }
  })

  it('tileRange: пустой canvas — пустой диапазон', () => {
    const s = latticeStep(1)
    const r = tileRange(s, { ox: 10, oy: 10, k: 1 }, 0, 0)
    expect(r.ti1).toBeLessThan(r.ti0)
    expect(r.tj1).toBeLessThan(r.tj0)
  })

  it('tileBounds согласован с toLattice и tileOrigin', () => {
    for (const k of ks) {
      const s = latticeStep(k)
      const device = { ox: 321, oy: -45, k }
      for (const ti of [-2, 0, 5]) {
        const b = tileBounds(s, ti, -ti)
        expect(toLattice(s, b.minX)).toBe(ti * s.size)
        expect(toLattice(s, b.maxX)).toBe((ti + 1) * s.size)
        expect(toLattice(s, b.minY)).toBe(-ti * s.size + 0)
        // угол плитки на экране — то же преобразование мир → устройство, что у нод, с точностью до u/2
        const o = tileOrigin(s, device, ti, -ti)
        expect(Math.abs(o.x - (device.ox + b.minX * k))).toBeLessThanOrEqual(s.u / 2 + 1e-6)
        expect(Math.abs(o.y - (device.oy + b.minY * k))).toBeLessThanOrEqual(s.u / 2 + 1e-6)
      }
    }
  })

  it('toLattice: расхождение с нодами не больше u/2, без −0', () => {
    for (const k of ks) {
      const s = latticeStep(k)
      for (const wx of [-1000.3, -1, 0, 0.4, 17, 333.3, 9999]) {
        const lx = toLattice(s, wx)
        expect(Number.isInteger(lx)).toBe(true)
        expect(Math.abs(lx * s.u - Math.round(wx * k))).toBeLessThanOrEqual(s.u / 2 + 1)
      }
      expect(Object.is(toLattice(s, -0.0001), -0)).toBe(false)
    }
  })
})

describe('softenFor', () => {
  it('значения ступеней и между ними — ближайшей меньшей', () => {
    expect(softenFor(2)).toBe(0)
    expect(softenFor(1.5)).toBe(0)
    expect(softenFor(1)).toBe(0)
    expect(softenFor(0.9)).toBe(0.12)
    expect(softenFor(0.75)).toBe(0.12)
    expect(softenFor(0.6)).toBe(0.25)
    expect(softenFor(0.5)).toBe(0.25)
    expect(softenFor(0.25)).toBe(0.4)
    expect(softenFor(0.2)).toBe(0.5)
    expect(softenFor(0.125)).toBe(0.5)
    expect(softenFor(0.05)).toBe(0.5)
  })
  it('негодный zoom — как 1', () => {
    expect(softenFor(Number.NaN)).toBe(0)
    expect(softenFor(0)).toBe(0)
  })
})

describe('effectUnit', () => {
  it('1600×1000 @1.5 → e = 3', () => {
    const r = effectUnit(1600, 1000, 1.5)
    expect(r).toEqual({ e: 3, w: 534, h: 334 })
  })
  it('3840×2160 @1 → e = 4 (предел площади)', () => {
    const r = effectUnit(3840, 2160, 1)
    expect(r.e).toBe(4)
    expect(r.w * r.h).toBeLessThanOrEqual(AMBIENT_FX_MAX_PX)
    expect(r).toEqual({ e: 4, w: 960, h: 540 })
  })
  it('обычные экраны: e = round(2·dpr), растр покрывает canvas', () => {
    for (const dpr of DPRS) {
      const W = Math.round(1280 * dpr)
      const H = Math.round(800 * dpr)
      const r = effectUnit(W, H, dpr)
      expect(r.e).toBe(Math.round(2 * dpr))
      expect(r.w * r.e).toBeGreaterThanOrEqual(W)
      expect(r.h * r.e).toBeGreaterThanOrEqual(H)
      expect((r.w - 1) * r.e).toBeLessThan(W)
    }
  })
  it('пустой canvas → w = h = 0', () => {
    expect(effectUnit(0, 500, 1)).toMatchObject({ w: 0, h: 0 })
    expect(effectUnit(500, -1, 1)).toMatchObject({ w: 0, h: 0 })
  })
  it('e по опоре (окну): панель деталей, сужая сцену, его не меняет; растр — по canvas и в пределе', () => {
    const cases = [
      // QHD 100 %: без панели и с панелью (−466 px).
      { dpr: 1, ref: { W: 2560, H: 1400 }, scenes: [[2290, 1250], [1824, 1250]] },
      // 4K 150 %.
      { dpr: 1.5, ref: { W: 3840, H: 2100 }, scenes: [[3435, 1875], [2736, 1875]] },
    ]
    for (const c of cases) {
      const [a, b] = c.scenes.map(([W, H]) => ({ W, H, r: effectUnit(W, H, c.dpr, c.ref) }))
      expect(a.r.e).toBe(b.r.e)
      for (const s of [a, b]) {
        expect(s.r.w * s.r.h).toBeLessThanOrEqual(AMBIENT_FX_MAX_PX)
        expect(s.r).toEqual({ e: s.r.e, w: Math.ceil(s.W / s.r.e), h: Math.ceil(s.H / s.r.e) })
      }
      // Без опоры эти пары стоят по разные стороны порога — то, от чего опора защищает.
      expect(effectUnit(a.W, a.H, c.dpr).e).not.toBe(effectUnit(b.W, b.H, c.dpr).e)
    }
  })
  it('опора меньше canvas или негодная — как без опоры', () => {
    expect(effectUnit(3840, 2160, 1, { W: 100, H: 100 })).toEqual(effectUnit(3840, 2160, 1))
    expect(effectUnit(1600, 1000, 1.5, { W: NaN, H: Infinity })).toEqual({ e: 3, w: 534, h: 334 })
  })
})
