import { describe, expect, it } from 'vitest'
import type { Bounds } from '@/lib/graph/types'
import { SPRITE_LIMITS } from '@/lib/ambient/types'
import type { ObjectKind } from '@/lib/ambient/types'
import {
  ART_PX,
  GROUND_CELL,
  GROUND_SLOTS,
  POND_CELL,
  WORLD_CHUNK,
  chunkObjects,
  eachGroundDetail,
  forestDensity,
  hash2,
  objectsIn,
  pondBox,
  pondDistance,
  pondOfCell,
  pondsIn,
  resetWorldCache,
  valueNoise,
} from '@/lib/ambient/world'
import type { Pond, WorldObject } from '@/lib/ambient/world'

// ───────── эталон: расстановка mockup/forest.js без DOM (спрайт заменён видом и размером) ─────────

const mh2 = (x: number, y: number, s = 0) => {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}
const msm = (t: number) => t * t * (3 - 2 * t)
const mvn = (x: number, y: number, s = 0) => {
  const xi = Math.floor(x), yi = Math.floor(y), fx = msm(x - xi), fy = msm(y - yi)
  const a = mh2(xi, yi, s), b = mh2(xi + 1, yi, s), c = mh2(xi, yi + 1, s), d = mh2(xi + 1, yi + 1, s)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}
const mstep = (a: number, b: number, v: number) => (v <= a ? 0 : v >= b ? 1 : msm((v - a) / (b - a)))
const mdensity = (gx: number, gy: number) => 0.65 * mvn(gx / 420, gy / 420, 1) + 0.35 * mvn(gx / 150 + 31, gy / 150 + 17, 2)
type MPond = { x: number; y: number; r: number; a1: number; a2: number; objs: Array<{ x: number; y: number; s: string }> }
const mpondD = (p: MPond, x: number, y: number) => {
  const dx = x - p.x, dy = (y - p.y) / 0.72, a = Math.atan2(dy, dx)
  return Math.hypot(dx, dy) / (p.r * (1 + 0.16 * Math.sin(3 * a + p.a1) + 0.09 * Math.sin(5 * a + p.a2)))
}
const CH = 256, SC = CH * 3
const H: Record<string, number> = { tree: 40, pine: 38, bush: 15, stone: 10, small: 11 }
function mpondOf(sx: number, sy: number): MPond | null {
  if (!(mh2(sx, sy, 11) < 0.42)) return null
  const r = 26 + mh2(sx, sy, 12) * 26, m = r * 1.3 + 14
  const p: MPond = {
    r, x: sx * SC + m + mh2(sx, sy, 13) * (SC - 2 * m), y: sy * SC + m + mh2(sx, sy, 14) * (SC - 2 * m),
    a1: mh2(sx, sy, 15) * 6.28, a2: mh2(sx, sy, 16) * 6.28, objs: [],
  }
  const at = (a: number, dd: number) => {
    const R = p.r * (1 + 0.16 * Math.sin(3 * a + p.a1) + 0.09 * Math.sin(5 * a + p.a2)) * dd
    return [Math.round(p.x + Math.cos(a) * R), Math.round(p.y + Math.sin(a) * R * 0.72)]
  }
  const nr = 7 + Math.floor(mh2(sx, sy, 17) * 8)
  for (let i = 0; i < nr; i++) {
    const a = mh2(sx, sy, 20 + (i >> 1)) * 6.28 + (i & 1) * 0.22, [x, y] = at(a, 0.93 + mh2(i, sx, sy + 3) * 0.14)
    p.objs.push({ x, y, s: `reed:0:${Math.floor(mh2(i, sx + 5, sy) * 3)}` })
  }
  const nl = 2 + Math.floor(mh2(sx, sy, 18) * 4)
  for (let i = 0; i < nl; i++) {
    const [x, y] = at(mh2(i, sx, sy + 40) * 6.28, 0.2 + mh2(i, sx, sy + 41) * 0.45)
    p.objs.push({ x, y, s: `lily:0:${mh2(i, sx, sy + 42) < 0.45 ? 1 : 0}` })
  }
  return p
}
function mobjectsOf(cx: number, cy: number): Array<{ x: number; y: number; s: string }> {
  const list: Array<{ x: number; y: number; s: string }> = []
  const G = 32, pond = mpondOf(Math.floor(cx / 3), Math.floor(cy / 3))
  for (let j = 0; j < CH / G; j++) for (let i = 0; i < CH / G; i++) {
    const qx = cx * (CH / G) + i, qy = cy * (CH / G) + j
    const x = qx * G + Math.floor(mh2(qx, qy, 3) * G), y = qy * G + Math.floor(mh2(qx, qy, 4) * G)
    const d = mdensity(x, y), wood = mstep(0.5, 0.64, d), r = mh2(qx, qy, 5), kind = mh2(qx, qy, 6), v = mh2(qx, qy, 7)
    let s: string | null = null
    if (r < wood * 0.82) {
      const pal = Math.floor(mvn(x / 260 + 7, y / 260 + 3, 8) * 4 + v * 1.7) % 4
      s = kind < 0.16 ? `pine:0:${v < 0.5 ? 0 : 1}` : kind < 0.27 ? `bush:${pal}:${v < 0.5 ? 0 : 1}` : `tree:${pal}:${Math.floor(v * 3)}`
    } else if (r > 0.93) {
      s = kind < 0.3 ? `bush:${Math.floor(v * 4)}:0` : kind < 0.55 ? `stone:0:${v < 0.5 ? 0 : 1}` : `small:0:${Math.floor(v * 3)}`
    }
    if (!s) continue
    const h = H[s.split(':')[0]]
    if (pond && mpondD(pond, x, y - (h > 20 ? 10 : 0)) < (h > 20 ? 1.75 : 1.25)) continue
    list.push({ x, y, s })
  }
  return list
}

const sig = (o: WorldObject) => `${o.kind}:${o.pal}:${o.variant}`
const flat = (list: readonly WorldObject[]) => list.map((o) => [o.id, o.x, o.y, sig(o), o.clearX, o.clearUp, o.clearDown].join())
const area = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({ minX, minY, maxX, maxY })

function groundList(b: Bounds): string[] {
  const out: string[] = []
  eachGroundDetail(b, (x, y, r1, r2) => out.push(`${x},${y},${r1},${r2}`))
  return out
}

describe('world: перенос мокапа один к одному', () => {
  it('hash2 и valueNoise совпадают с h2 и vn мокапа', () => {
    for (let i = 0; i < 500; i++) {
      const x = mh2(i, 1, 77) * 2000 - 1000, y = mh2(i, 2, 77) * 2000 - 1000, s = i % 13
      expect(hash2(x, y, s)).toBe(mh2(x, y, s))
      expect(valueNoise(x / 37, y / 41, s)).toBe(mvn(x / 37, y / 41, s))
      expect(hash2(x, y, s)).toBeGreaterThanOrEqual(0)
      expect(hash2(x, y, s)).toBeLessThan(1)
    }
  })

  it('forestDensity(wx, wy) = density мокапа от (wx/2, wy/2)', () => {
    for (let i = 0; i < 200; i++) {
      const wx = Math.floor(mh2(i, 3, 5) * 20000) - 10000, wy = Math.floor(mh2(i, 4, 5) * 20000) - 10000
      expect(forestDensity(wx, wy)).toBe(mdensity(wx / 2, wy / 2))
    }
  })

  it('объекты ячеек совпадают с objectsOf мокапа (координаты × 2)', () => {
    resetWorldCache()
    let total = 0
    for (let cy = -6; cy <= 6; cy++) {
      for (let cx = -6; cx <= 6; cx++) {
        const want = mobjectsOf(cx, cy).map((o) => `${o.x * ART_PX},${o.y * ART_PX},${o.s}`)
        const got = chunkObjects(cx, cy).map((o) => `${o.x},${o.y},${sig(o)}`)
        expect(got).toEqual(want)
        total += got.length
      }
    }
    expect(total).toBeGreaterThan(500)
  })

  it('пруды совпадают с pondOf мокапа (координаты × 2), камыши и кувшинки на месте', () => {
    resetWorldCache()
    let ponds = 0
    for (let sy = -5; sy <= 5; sy++) {
      for (let sx = -5; sx <= 5; sx++) {
        const m = mpondOf(sx, sy)
        const p = pondOfCell(sx, sy)
        if (!m) {
          expect(p).toBeNull()
          continue
        }
        ponds++
        expect(p).not.toBeNull()
        const q = p as Pond
        expect([q.x, q.y, q.r, q.a1, q.a2]).toEqual([m.x * 2, m.y * 2, m.r * 2, m.a1, m.a2])
        expect(q.reach).toBeCloseTo(q.r * 1.45 + 56, 9)
        expect(q.objects.map((o) => `${o.x},${o.y},${sig(o)}`)).toEqual(m.objs.map((o) => `${o.x * 2},${o.y * 2},${o.s}`))
        for (const o of q.objects) expect([o.clearX, o.clearUp, o.clearDown]).toEqual([0, 0, 0])
      }
    }
    expect(ponds).toBeGreaterThan(20)
  })

  it('pondDistance — та же мера, что pondD мокапа', () => {
    let p: Pond | null = null
    for (let sx = 0; !p && sx < 50; sx++) p = pondOfCell(sx, 0)
    expect(p).not.toBeNull()
    const q = p as Pond
    const m = mpondOf(Math.floor(q.x / POND_CELL), 0) as MPond
    for (let i = 0; i < 100; i++) {
      const wx = q.x + (mh2(i, 1, 9) - 0.5) * 400, wy = q.y + (mh2(i, 2, 9) - 0.5) * 400
      expect(pondDistance(q, wx, wy)).toBeCloseTo(mpondD(m, wx / 2, wy / 2), 12)
    }
    expect(pondDistance(q, q.x, q.y)).toBe(0)
    expect(pondDistance(q, q.x + q.r * 3, q.y)).toBeGreaterThan(1)
  })
})

describe('world: детерминизм', () => {
  const B = area(-1800, -1300, 2100, 1700)

  it('разный порядок ячеек и сброс кэша дают равные списки', () => {
    resetWorldCache()
    const a = flat(objectsIn(B))
    const pa = pondsIn(B).map((p) => p.id)
    resetWorldCache()
    // Обратный порядок прогрева ячеек и прудов.
    for (let cy = 4; cy >= -4; cy--) for (let cx = 5; cx >= -5; cx--) chunkObjects(cx, cy)
    for (let sy = 2; sy >= -2; sy--) for (let sx = 2; sx >= -2; sx--) pondOfCell(sx, sy)
    const b = flat(objectsIn(B))
    resetWorldCache()
    const c = flat(objectsIn(B))
    expect(a.length).toBeGreaterThan(50)
    expect(b).toEqual(a)
    expect(c).toEqual(a)
    expect(pondsIn(B).map((p) => p.id)).toEqual(pa)
  })

  it('переполнение кэша не меняет результат', () => {
    resetWorldCache()
    const before = flat(objectsIn(B))
    const pond = pondOfCell(3, -2)
    for (let cy = 0; cy < 30; cy++) for (let cx = 0; cx < 30; cx++) chunkObjects(cx + 100, cy + 100)
    for (let s = 0; s < 700; s++) pondOfCell(s, 500)
    expect(flat(objectsIn(B))).toEqual(before)
    expect(pondOfCell(3, -2)).toEqual(pond)
  })

  it('отрицательные координаты: объекты есть и лежат в своей ячейке', () => {
    resetWorldCache()
    let n = 0
    for (let cy = -4; cy <= -1; cy++) {
      for (let cx = -4; cx <= -1; cx++) {
        for (const o of chunkObjects(cx, cy)) {
          n++
          expect(o.x).toBeGreaterThanOrEqual(cx * WORLD_CHUNK)
          expect(o.x).toBeLessThan((cx + 1) * WORLD_CHUNK)
          expect(o.y).toBeGreaterThanOrEqual(cy * WORLD_CHUNK)
          expect(o.y).toBeLessThan((cy + 1) * WORLD_CHUNK)
        }
      }
    }
    expect(n).toBeGreaterThan(0)
    const neg = objectsIn(area(-2048, -2048, -1, -1))
    expect(neg.length).toBe(n)
  })

  it('id стабилен и уникален в области', () => {
    const list: WorldObject[] = [...objectsIn(B)]
    for (const p of pondsIn(B)) list.push(...p.objects)
    expect(new Set(list.map((o) => o.id)).size).toBe(list.length)
    for (const o of list) expect(Number.isSafeInteger(o.id)).toBe(true)
    const ponds = pondsIn(area(-20000, -20000, 20000, 20000))
    expect(new Set(ponds.map((p) => p.id)).size).toBe(ponds.length)
  })
})

describe('world: правила расстановки', () => {
  it('в ячейке не больше 64 объектов; виды, гаммы и варианты в пределах SPRITE_LIMITS', () => {
    const kinds = new Set<ObjectKind>()
    for (let cy = -10; cy <= 10; cy++) {
      for (let cx = -10; cx <= 10; cx++) {
        const list = chunkObjects(cx, cy)
        expect(list.length).toBeLessThanOrEqual(64)
        for (const o of list) {
          kinds.add(o.kind)
          const lim = SPRITE_LIMITS[o.kind]
          expect(Number.isInteger(o.pal) && o.pal >= 0 && o.pal < lim.pals).toBe(true)
          expect(Number.isInteger(o.variant) && o.variant >= 0 && o.variant < lim.variants).toBe(true)
          expect(o.kind === 'reed' || o.kind === 'lily').toBe(false)
          expect(o.clearX).toBeGreaterThan(0)
        }
      }
      for (let sx = -4; sx <= 4; sx++) {
        const p = pondOfCell(sx, cy)
        for (const o of p?.objects ?? []) {
          const lim = SPRITE_LIMITS[o.kind]
          expect(o.pal < lim.pals && o.variant < lim.variants && o.variant >= 0).toBe(true)
        }
      }
    }
    expect([...kinds].sort()).toEqual(['bush', 'pine', 'small', 'stone', 'tree'])
  })

  it('рамки полян объектов — как в спецификации', () => {
    const want: Record<string, number[]> = {
      tree: [74, 140, 44], pine: [60, 134, 44], bush: [60, 72, 44], stone: [54, 62, 44], small: [54, 62, 44],
    }
    for (const o of objectsIn(area(-3000, -3000, 3000, 3000))) {
      expect([o.clearX, o.clearUp, o.clearDown]).toEqual(want[o.kind])
    }
  })

  it('ни один объект леса не стоит в воде своего пруда', () => {
    let checked = 0
    for (let cy = -15; cy <= 15; cy++) {
      for (let cx = -15; cx <= 15; cx++) {
        const pond = pondOfCell(Math.floor(cx / 3), Math.floor(cy / 3))
        if (!pond) continue
        for (const o of chunkObjects(cx, cy)) {
          checked++
          const tall = o.kind === 'tree' || o.kind === 'pine'
          expect(pondDistance(pond, o.x, o.y)).toBeGreaterThan(1)
          expect(pondDistance(pond, o.x, o.y - (tall ? 20 : 0))).toBeGreaterThanOrEqual(tall ? 1.75 : 1.25)
        }
      }
    }
    expect(checked).toBeGreaterThan(1000)
  })

  it('доля ячеек POND_CELL с прудом на выборке 2000 — 0.42 ± 0.05', () => {
    let n = 0
    for (let sy = -20; sy < 20; sy++) for (let sx = -25; sx < 25; sx++) if (pondOfCell(sx, sy)) n++
    expect(Math.abs(n / 2000 - 0.42)).toBeLessThanOrEqual(0.05)
  })

  it('пруд целиком внутри своей ячейки: рамка, вода и опоры камышей', () => {
    let n = 0
    for (let sy = -12; sy <= 12; sy++) {
      for (let sx = -12; sx <= 12; sx++) {
        const p = pondOfCell(sx, sy)
        if (!p) continue
        n++
        const f = pondBox(p)
        expect(f.minX).toBeGreaterThanOrEqual(sx * POND_CELL)
        expect(f.maxX).toBeLessThanOrEqual((sx + 1) * POND_CELL)
        expect(f.minY).toBeGreaterThanOrEqual(sy * POND_CELL)
        expect(f.maxY).toBeLessThanOrEqual((sy + 1) * POND_CELL)
        expect(p.r).toBeGreaterThanOrEqual(52)
        expect(p.r).toBeLessThanOrEqual(104)
        for (const o of p.objects) {
          expect(o.x >= f.minX && o.x <= f.maxX && o.y >= f.minY && o.y <= f.maxY).toBe(true)
        }
        // Вода (pondDistance <= 1.12, вместе с берегом) не выходит за рамку: по краям рамки — суша.
        for (let i = 0; i <= 40; i++) {
          const t = i / 40
          const xs = f.minX + (f.maxX - f.minX) * t
          const ys = f.minY + (f.maxY - f.minY) * t
          expect(pondDistance(p, xs, f.minY)).toBeGreaterThan(1.12)
          expect(pondDistance(p, xs, f.maxY)).toBeGreaterThan(1.12)
          expect(pondDistance(p, f.minX, ys)).toBeGreaterThan(1.12)
          expect(pondDistance(p, f.maxX, ys)).toBeGreaterThan(1.12)
        }
      }
    }
    expect(n).toBeGreaterThan(100)
  })
})

describe('world: запросы по области', () => {
  it('objectsIn отсортирован по (y, x, id) и равен объектам ячеек в области', () => {
    const B = area(-700, -300, 1300, 900)
    const list = objectsIn(B)
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i]
      expect(a.y < b.y || (a.y === b.y && (a.x < b.x || (a.x === b.x && a.id < b.id)))).toBe(true)
    }
    const want: WorldObject[] = []
    for (let cy = -2; cy <= 2; cy++) for (let cx = -2; cx <= 3; cx++) {
      for (const o of chunkObjects(cx, cy)) if (o.x >= B.minX && o.x <= B.maxX && o.y >= B.minY && o.y <= B.maxY) want.push(o)
    }
    expect(new Set(list)).toEqual(new Set(want))
    expect(list.length).toBe(want.length)
  })

  it('не теряет объекты на стыках ячеек: разбиение области даёт тот же набор', () => {
    const whole = objectsIn(area(-1024, -1024, 1023, 1023))
    const parts: WorldObject[] = []
    // Стыки — нечётные полупиксели: опоры объектов лежат на чётных px мира, двойного счёта нет.
    const xs = [-1024, -512.5, -0.5, 511.5, 1023]
    const ys = [-1024, -300.5, 0.5, 700.5, 1023]
    for (let j = 0; j < ys.length - 1; j++) {
      for (let i = 0; i < xs.length - 1; i++) parts.push(...objectsIn(area(xs[i], ys[j], xs[i + 1], ys[j + 1])))
    }
    expect(flat([...parts].sort((a, b) => a.y - b.y || a.x - b.x || a.id - b.id))).toEqual(flat(whole))
    // Граница включается: объект на краю попадает в обе соседние области.
    const o = whole[Math.floor(whole.length / 2)]
    expect(objectsIn(area(o.x, o.y, o.x, o.y))).toContain(o)
  })

  it('pondsIn: пруды, чья рамка пересекает область', () => {
    const B = area(-4000, -4000, 4000, 4000)
    const got = pondsIn(B)
    const want: Pond[] = []
    for (let sy = -3; sy <= 2; sy++) for (let sx = -3; sx <= 2; sx++) {
      const p = pondOfCell(sx, sy)
      if (!p) continue
      const f = pondBox(p)
      if (f.maxX >= B.minX && f.minX <= B.maxX && f.maxY >= B.minY && f.minY <= B.maxY) want.push(p)
    }
    expect(got.length).toBeGreaterThan(5)
    expect(got).toEqual(want)
    // Узкая область внутри рамки пруда находит его, область рядом с рамкой — нет.
    const p = got[0]
    const f = pondBox(p)
    expect(pondsIn(area(p.x, p.y, p.x + 1, p.y + 1))).toContain(p)
    expect(pondsIn(area(f.maxX + 1, f.minY, f.maxX + 2, f.maxY))).not.toContain(p)
  })

  it('пустые и негодные области — пустой результат', () => {
    expect(objectsIn(area(10, 10, 0, 0))).toEqual([])
    expect(pondsIn(area(0, 0, Number.NaN, 5))).toEqual([])
    expect(groundList(area(0, 0, Number.POSITIVE_INFINITY, 5))).toEqual([])
  })
})

describe('world: мелочь земли', () => {
  it('ровно GROUND_SLOTS мест на клетку, в своей клетке, по формуле солей', () => {
    const per = new Map<string, number>()
    eachGroundDetail(area(-320, -320, 319, 319), (x, y, r1, r2) => {
      const gx = Math.floor(x / GROUND_CELL), gy = Math.floor(y / GROUND_CELL)
      per.set(`${gx},${gy}`, (per.get(`${gx},${gy}`) ?? 0) + 1)
      expect(r1 >= 0 && r1 < 1 && r2 >= 0 && r2 < 1).toBe(true)
      expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true)
    })
    expect(per.size).toBe(400)
    for (const n of per.values()) expect(n).toBe(GROUND_SLOTS)
    const one = groundList(area(-32, 64, -1, 95))
    const want: string[] = []
    for (let j = 0; j < GROUND_SLOTS; j++) {
      const x = -32 + Math.floor(mh2(-1, 2, 100 + 4 * j) * 32), y = 64 + Math.floor(mh2(-1, 2, 101 + 4 * j) * 32)
      want.push(`${x},${y},${mh2(-1, 2, 102 + 4 * j)},${mh2(-1, 2, 103 + 4 * j)}`)
    }
    expect(one).toEqual(want)
  })

  it('одинакова при разбиении области на части', () => {
    const whole = groundList(area(-200, -150, 250, 170)).sort()
    const parts = [
      ...groundList(area(-200, -150, 13.5, 170)),
      ...groundList(area(13.5, -150, 250, 40.5)),
      ...groundList(area(13.5, 40.5, 250, 170)),
    ].sort()
    expect(whole.length).toBeGreaterThan(400)
    expect(parts).toEqual(whole)
  })
})
