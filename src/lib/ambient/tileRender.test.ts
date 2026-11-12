import { beforeEach, describe, expect, it } from 'vitest'
import type { Bounds } from '@/lib/graph/types'
import type { Lod, ObjectKind, Raster, SceneArt, Sprite } from '@/lib/ambient/types'
import { DETAIL_LIMIT, SPRITE_LIMITS } from '@/lib/ambient/types'
import type { LatticeStep } from '@/lib/ambient/lattice'
import { latticeStep, tileBounds, toLattice } from '@/lib/ambient/lattice'
import { blitSprite, createRaster, rgba } from '@/lib/ambient/raster'
import { buildClearing, EMPTY_CLEARING, objectCleared } from '@/lib/ambient/clearing'
import type { Clearing } from '@/lib/ambient/clearing'
import type { Pond } from '@/lib/ambient/world'
import { compareObjects, objectsIn, pondBox, pondOfCell, pondsIn, POND_CELL, resetWorldCache } from '@/lib/ambient/world'
import { CLEAR_REACH, TILE_MARGIN_PX, artHasObjects, renderTile, tileSignature, tilesBlank } from '@/lib/ambient/tileRender'
import { buildSceneArt } from '@/lib/ambient/sprites'

// ───────────────────────── подставная графика ─────────────────────────

const KINDS: ObjectKind[] = ['tree', 'pine', 'bush', 'stone', 'small', 'reed', 'lily']
/** Свой цвет у каждого (вида, гаммы, варианта): по цвету видно, какой объект лёг сверху. */
const objectColor = (kind: ObjectKind, pal: number, variant: number) =>
  rgba(40 + KINDS.indexOf(kind) * 30, 10 + pal * 20, 10 + variant * 20)
const DETAIL = rgba(250, 250, 10)
const GRID = rgba(5, 5, 250)
const WATER = {
  deep: rgba(0, 0, 100),
  mid: rgba(0, 0, 130),
  lit: rgba(0, 0, 160),
  bank: rgba(0, 0, 190),
  dash: rgba(0, 0, 220),
  shore: rgba(0, 60, 60),
}
const WATER_SET = new Set(Object.values(WATER))
const POND_OBJECT_SET = new Set<number>()
for (let p = 0; p < 4; p++) for (let v = 0; v < 3; v++) {
  POND_OBJECT_SET.add(objectColor('reed', p, v))
  POND_OBJECT_SET.add(objectColor('lily', p, v))
}

function solid(w: number, h: number, ax: number, ay: number, c: number): Sprite {
  const data = new Uint32Array(w * h)
  data.fill(c)
  return { w, h, ax, ay, data }
}

/**
 * Сплошные спрайты наибольшего размера. На lod 0 опора на краю допуска (ax = ⌊w/2⌋ + 1, ay = h − 4); на lod 1/2 —
 * как у уменьшения графики: размер ceil(w/f), опора делится.
 */
function fakeArt(lod: Lod, opts: { water?: boolean; objects?: boolean; detail?: boolean; grid?: boolean } = {}): SceneArt {
  const f = 2 ** lod
  const cache = new Map<string, Sprite>()
  const { water = true, objects = true, detail = true, grid = true } = opts
  const detailSprite = solid(DETAIL_LIMIT, DETAIL_LIMIT, Math.floor(DETAIL_LIMIT / 2) + 1, Math.floor(DETAIL_LIMIT / 2) + 1, DETAIL)
  return {
    scene: 'meadow',
    dark: false,
    lod,
    soft: 0,
    ground: rgba(120, 160, 80),
    object: (kind, pal, variant) => {
      if (!objects) return null
      const k = `${kind}:${pal}:${variant}`
      let s = cache.get(k)
      if (!s) {
        const L = SPRITE_LIMITS[kind]
        const ax0 = Math.floor(L.w / 2) + 1
        const ay0 = L.h - 4
        s = solid(Math.ceil(L.w / f), Math.ceil(L.h / f), Math.floor(ax0 / f), Math.floor(ay0 / f), objectColor(kind, pal, variant))
        cache.set(k, s)
      }
      return s
    },
    detail: (r1) => (detail && r1 < 0.6 ? detailSprite : null),
    grid: grid ? solid(1, 1, 0, 0, GRID) : null,
    water: water ? WATER : null,
  }
}

// ───────────────────────── помощники ─────────────────────────

function render(ti: number, tj: number, step: LatticeStep, art: SceneArt, clearing: Clearing = EMPTY_CLEARING) {
  const out = createRaster(step.size, step.size)
  const drawn = renderTile(out, ti, tj, step, art, clearing)
  return { out, drawn }
}

/** Пруд с самым густым лесом вокруг среди ячеек в диапазоне. */
function findPond(sx0: number, sx1: number, sy0: number, sy1: number): Pond {
  let best: Pond | null = null
  let bestN = -1
  for (let sy = sy0; sy <= sy1; sy++) {
    for (let sx = sx0; sx <= sx1; sx++) {
      const p = pondOfCell(sx, sy)
      if (!p) continue
      const n = objectsIn({ minX: p.x - 700, minY: p.y - 700, maxX: p.x + 700, maxY: p.y + 700 }).length
      if (n > bestN) {
        bestN = n
        best = p
      }
    }
  }
  if (!best) throw new Error('пруд не найден')
  return best
}

function tileOf(step: LatticeStep, wx: number, wy: number) {
  const s = step.size * step.worldPerPx
  return { ti: Math.floor(wx / s), tj: Math.floor(wy / s) }
}

/** Детерминированная «случайность». */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Побайтное равенство растров. */
function same(a: Raster, b: Raster): boolean {
  if (a.w !== b.w || a.h !== b.h) return false
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false
  return true
}

/** Копия растра s в r с угла (x, y), без смешения. */
function copyInto(r: Raster, s: Raster, x: number, y: number): void {
  for (let sy = 0; sy < s.h; sy++) r.data.set(s.data.subarray(sy * s.w, (sy + 1) * s.w), (y + sy) * r.w + x)
}

function distToSquare(px: number, py: number, nx: number, ny: number): number {
  const dx = Math.max(0, Math.abs(px - nx) - 8)
  const dy = Math.max(0, Math.abs(py - ny) - 8)
  return Math.hypot(dx, dy)
}

const STEPS = [0.125, 0.5, 1, 1.25, 2]

beforeEach(() => resetWorldCache())

// ───────────────────────── тесты ─────────────────────────

describe('renderTile: шов и повтор', () => {
  // Большая плитка — та же ступень с вдвое большей стороной: плитка (a, b) большой = 2×2 малых.
  const cases: Array<{ name: string; step: LatticeStep }> = [
    { name: 'k = 1 (u 2, lod 0)', step: latticeStep(1) },
    { name: 'k = 1.25 (u 3, lod 0)', step: latticeStep(1.25) },
    { name: 'k = 0.5 (u 1, lod 0), сторона 160', step: { ...latticeStep(0.5), size: 160 } },
    { name: 'k = 0.125 (lod 2), сторона 96', step: { ...latticeStep(0.125), size: 96 } },
    { name: 'k = 0.25 (lod 1), сторона 128', step: { ...latticeStep(0.25), size: 128 } },
  ]
  for (const { name, step } of cases) {
    it(`четыре соседние плитки побайтно равны одной большой: ${name}`, () => {
      const big: LatticeStep = { ...step, size: step.size * 2, key: `${step.key}:big` }
      // Пруд в отрицательных ячейках: шов и отрицательные индексы сразу.
      const pond = findPond(-4, -1, -4, -1)
      const { ti: a, tj: b } = tileOf(big, pond.x, pond.y)
      // Ноды у шва и рядом с прудом.
      const seamX = (2 * a + 1) * step.size * step.worldPerPx
      const seamY = (2 * b + 1) * step.size * step.worldPerPx
      const clearing = buildClearing([
        { x: seamX + 3, y: seamY - 40 },
        { x: seamX - 90, y: seamY + 110 },
        { x: pond.x + pond.reach + 30, y: pond.y },
      ])
      const art = fakeArt(step.lod)
      const S = step.size
      const whole = render(a, b, big, art, clearing).out
      const glued = createRaster(2 * S, 2 * S)
      let drawnSmall = 0
      for (let dj = 0; dj < 2; dj++) {
        for (let di = 0; di < 2; di++) {
          const t = render(2 * a + di, 2 * b + dj, step, art, clearing)
          drawnSmall += t.drawn
          copyInto(glued, t.out, di * S, dj * S)
        }
      }
      expect(drawnSmall).toBeGreaterThan(0)
      // Сначала полосы шва (понятнее при падении), затем вся область.
      for (let y = 0; y < 2 * S; y++) {
        for (const x of [S - 2, S - 1, S, S + 1]) expect(glued.data[y * 2 * S + x]).toBe(whole.data[y * 2 * S + x])
      }
      for (let x = 0; x < 2 * S; x++) {
        for (const y of [S - 2, S - 1, S, S + 1]) expect(glued.data[y * 2 * S + x]).toBe(whole.data[y * 2 * S + x])
      }
      expect(same(glued, whole)).toBe(true)
      // Плитки непустые.
      expect(whole.data.some((c) => c !== 0)).toBe(true)
    })
  }

  it('повторный вызов даёт тот же растр (и после чужих плиток, и после сброса кэша мира)', () => {
    const step = latticeStep(1)
    const pond = findPond(0, 4, 0, 4)
    const { ti, tj } = tileOf(step, pond.x, pond.y)
    const art = fakeArt(0)
    const clearing = buildClearing([{ x: pond.x - 300, y: pond.y - 200 }])
    const first = render(ti, tj, step, art, clearing)
    render(ti + 5, tj - 3, step, art, clearing)
    const second = render(ti, tj, step, art, clearing)
    resetWorldCache()
    const third = render(ti, tj, step, art, clearing)
    expect(second.drawn).toBe(first.drawn)
    expect(third.drawn).toBe(first.drawn)
    expect(same(second.out, first.out)).toBe(true)
    expect(same(third.out, first.out)).toBe(true)
  })

  it('out обнуляется перед отрисовкой', () => {
    const step = { ...latticeStep(1), size: 64 }
    const out = createRaster(64, 64)
    out.data.fill(rgba(1, 2, 3))
    renderTile(out, 0, 0, step, fakeArt(0, { water: false, objects: false, detail: false, grid: false }), EMPTY_CLEARING)
    expect(out.data.every((c) => c === 0)).toBe(true)
  })
})

describe('renderTile: порядок объектов', () => {
  it('объекты кладутся по (y, x, id): совпадает с эталонной раскладкой', () => {
    const step = latticeStep(1)
    const pond = findPond(0, 4, 0, 4)
    const { ti, tj } = tileOf(step, pond.x - 900, pond.y)
    const art = fakeArt(0, { water: false, detail: false, grid: false })
    const clearing = buildClearing([{ x: (ti + 0.5) * step.size * step.worldPerPx, y: (tj + 0.5) * step.size * step.worldPerPx }])
    const { out, drawn } = render(ti, tj, step, art, clearing)
    // Эталон: те же объекты, отсортированные, без прудов (water = null — камыши не участвуют).
    const tb = tileBounds(step, ti, tj)
    const m = TILE_MARGIN_PX * step.worldPerPx
    const B: Bounds = { minX: tb.minX - m, minY: tb.minY - m, maxX: tb.maxX + m, maxY: tb.maxY + m }
    const list = objectsIn(B).filter((o) => !objectCleared(o, clearing)).sort(compareObjects)
    const ref = createRaster(step.size, step.size)
    for (const o of list) {
      const s = art.object(o.kind, o.pal, o.variant)!
      blitSprite(ref, s, toLattice(step, o.x) - s.ax - ti * step.size, toLattice(step, o.y) - s.ay - tj * step.size)
    }
    expect(drawn).toBeGreaterThan(5)
    expect(same(out, ref)).toBe(true)
    // Обратный порядок дал бы другой растр — значит, проверка не пустая.
    const rev = createRaster(step.size, step.size)
    for (const o of [...list].reverse()) {
      const s = art.object(o.kind, o.pal, o.variant)!
      blitSprite(rev, s, toLattice(step, o.x) - s.ax - ti * step.size, toLattice(step, o.y) - s.ay - tj * step.size)
    }
    expect(same(rev, ref)).toBe(false)
  })
})

describe('renderTile: поляны', () => {
  for (const k of STEPS) {
    it(`k = ${k}: ничего, кроме узора сетки, ближе 24 px мира к квадрату ноды (допуск — пиксель решётки)`, () => {
      const step = latticeStep(k)
      const wpp = step.worldPerPx
      const pond = findPond(0, 5, 0, 5)
      const { ti, tj } = tileOf(step, pond.x, pond.y)
      const tb = tileBounds(step, ti, tj)
      const tw = tb.maxX - tb.minX
      // Нода в центре плитки, ещё несколько — случайно по плитке и у её краёв (в узлах сетки графа, как у раскладки).
      const r = rng(1000 + k * 64)
      const nodes = [{ x: tb.minX + tw / 2, y: tb.minY + tw / 2 }]
      const extra = Math.max(4, Math.round((tw / 256) ** 2 * 1.5))
      for (let i = 0; i < extra; i++) {
        nodes.push({
          x: Math.round((tb.minX - 40 + r() * (tw + 80)) / 32) * 32,
          y: Math.round((tb.minY - 40 + r() * (tw + 80)) / 32) * 32,
        })
      }
      const clearing = buildClearing(nodes)
      const art = fakeArt(step.lod)
      const { out } = render(ti, tj, step, art, clearing)
      const x0 = ti * step.size
      const y0 = tj * step.size
      let painted = 0
      let gridNear = 0
      let minD = Infinity
      for (let ly = 0; ly < out.h; ly++) {
        const wy = (y0 + ly + 0.5) * wpp
        for (let lx = 0; lx < out.w; lx++) {
          const c = out.data[ly * out.w + lx]
          if (c === 0) continue
          const wx = (x0 + lx + 0.5) * wpp
          let d = Infinity
          for (const n of nodes) d = Math.min(d, distToSquare(wx, wy, n.x, n.y))
          if (c === GRID) {
            if (d < 24) gridNear++
            continue
          }
          painted++
          minD = Math.min(minD, d)
        }
      }
      expect(painted).toBeGreaterThan(0)
      expect(minD).toBeGreaterThanOrEqual(24 - wpp)
      // Узор сетки полянами не убирается (только lod 0 и клетка графа >= 8 пикселей решётки).
      if (step.lod === 0) expect(gridNear).toBeGreaterThan(0)
      else expect(out.data.includes(GRID)).toBe(false)
    })
  }

  it('без нод лес подходит к тем же местам вплотную (проверка полян не пустая)', () => {
    const step = latticeStep(1)
    const pond = findPond(0, 5, 0, 5)
    const { ti, tj } = tileOf(step, pond.x, pond.y)
    const tb = tileBounds(step, ti, tj)
    const c = { x: tb.minX + (tb.maxX - tb.minX) / 2, y: tb.minY + (tb.maxY - tb.minY) / 2 }
    // Без нод у центра плитки что-то нарисовано ближе 24 px к месту, где в тесте выше стоит нода.
    const art = fakeArt(0)
    const { out } = render(ti, tj, step, art)
    const wpp = step.worldPerPx
    let close = 0
    for (let ly = 0; ly < out.h; ly++) {
      for (let lx = 0; lx < out.w; lx++) {
        const v = out.data[ly * out.w + lx]
        if (v === 0 || v === GRID) continue
        const d = distToSquare((ti * step.size + lx + 0.5) * wpp, (tj * step.size + ly + 0.5) * wpp, c.x, c.y)
        if (d < 24) close++
      }
    }
    expect(close).toBeGreaterThan(0)
  })

  it('пруд рядом с нодой не рисуется вместе с камышами и кувшинками', () => {
    const step = latticeStep(1)
    const pond = findPond(0, 5, 0, 5)
    const { ti, tj } = tileOf(step, pond.x, pond.y)
    const art = fakeArt(0, { detail: false, grid: false })
    const count = (out: Raster) => {
      let water = 0
      let reeds = 0
      for (const c of out.data) {
        if (WATER_SET.has(c)) water++
        else if (POND_OBJECT_SET.has(c)) reeds++
      }
      return { water, reeds }
    }
    const open = count(render(ti, tj, step, art).out)
    expect(open.water).toBeGreaterThan(100)
    expect(open.reeds).toBeGreaterThan(0)
    // Нода у берега (внутри reach): пруд скрыт целиком.
    const nearNode = buildClearing([{ x: pond.x + pond.r * 1.3, y: pond.y }])
    const hidden = count(render(ti, tj, step, art, nearNode).out)
    expect(hidden).toEqual({ water: 0, reeds: 0 })
    // Нода чуть дальше reach: пруд на месте.
    const farNode = buildClearing([{ x: pond.x + pond.reach + 1, y: pond.y }])
    expect(count(render(ti, tj, step, art, farNode).out).water).toBe(open.water)
  })

  it('пруд рисуется в своей рамке x ± r·1.45, y ± r·1.1 всеми цветами воды', () => {
    const step = latticeStep(1)
    const pond = findPond(0, 5, 0, 5)
    const { ti, tj } = tileOf(step, pond.x, pond.y)
    const { out } = render(ti, tj, step, fakeArt(0, { detail: false, grid: false, objects: false }))
    const box = pondBox(pond)
    const seen = new Set<number>()
    const wpp = step.worldPerPx
    for (let ly = 0; ly < out.h; ly++) {
      for (let lx = 0; lx < out.w; lx++) {
        const c = out.data[ly * out.w + lx]
        if (c === 0) continue
        const wx = (ti * step.size + lx + 0.5) * wpp
        const wy = (tj * step.size + ly + 0.5) * wpp
        // Пиксели других прудов плитки тоже допустимы: ищем, в чью рамку попал пиксель.
        const inOwn = wx >= box.minX && wx <= box.maxX && wy >= box.minY && wy <= box.maxY
        const inAny = inOwn || pondsIn(tileBounds(step, ti, tj)).some((p) => {
          const f = pondBox(p)
          return wx >= f.minX && wx <= f.maxX && wy >= f.minY && wy <= f.maxY
        })
        expect(inAny).toBe(true)
        if (inOwn) seen.add(c)
      }
    }
    for (const key of ['deep', 'mid', 'bank', 'lit', 'shore'] as const) expect(seen.has(WATER[key])).toBe(true)
  })

  it('блики на воде — только на lod 0', () => {
    const pond = findPond(0, 5, 0, 5)
    const lod0 = latticeStep(1)
    const t0 = tileOf(lod0, pond.x, pond.y)
    const a = render(t0.ti, t0.tj, lod0, fakeArt(0, { detail: false, grid: false, objects: false })).out
    expect(a.data.includes(WATER.dash)).toBe(true)
    const lod1 = latticeStep(0.25)
    const t1 = tileOf(lod1, pond.x, pond.y)
    const b = render(t1.ti, t1.tj, lod1, fakeArt(1, { detail: false, grid: false, objects: false })).out
    expect(b.data.includes(WATER.deep)).toBe(true)
    expect(b.data.includes(WATER.dash)).toBe(false)
  })

  it('мелочь земли и узор сетки — только на lod 0; узор — пока клетка графа не меньше 8 пикселей решётки', () => {
    const art = (lod: Lod) => fakeArt(lod, { water: false, objects: false })
    const s0 = { ...latticeStep(1), size: 128 }
    const a = render(3, -2, s0, art(0)).out
    expect(a.data.includes(DETAIL)).toBe(true)
    expect(a.data.includes(GRID)).toBe(true)
    for (const k of [0.25, 0.125]) {
      const s = { ...latticeStep(k), size: 128 }
      const b = render(3, -2, s, art(s.lod)).out
      expect(b.data.every((c) => c === 0)).toBe(true)
    }
    // Клетка графа 32 / 5 = 6.4 пикселя решётки: узора нет, мелочь есть.
    const coarse: LatticeStep = { ...latticeStep(1), worldPerPx: 5, size: 128, key: 'coarse' }
    const c = render(0, 0, coarse, art(0)).out
    expect(c.data.includes(GRID)).toBe(false)
    expect(c.data.includes(DETAIL)).toBe(true)
  })

  it('art.water === null и object → null дают пустую плитку без ошибок', () => {
    const pond = findPond(0, 5, 0, 5)
    for (const k of STEPS) {
      const step = latticeStep(k)
      const { ti, tj } = tileOf(step, pond.x, pond.y)
      const { out, drawn } = render(ti, tj, step, fakeArt(step.lod, { water: false, objects: false, detail: false, grid: false }))
      expect(drawn).toBe(0)
      expect(out.data.every((c) => c === 0)).toBe(true)
    }
  })

  it('растр другого размера и пустой растр — без ошибок', () => {
    const step = latticeStep(1)
    const art = fakeArt(0)
    const small = createRaster(50, 30)
    expect(() => renderTile(small, 2, 2, step, art, EMPTY_CLEARING)).not.toThrow()
    const empty = createRaster(0, 0)
    expect(renderTile(empty, 2, 2, step, art, EMPTY_CLEARING)).toBe(0)
  })
})

describe('tileSignature', () => {
  const step = latticeStep(1)
  const ti = 3
  const tj = -2
  const tb = tileBounds(step, ti, tj)
  const reach = TILE_MARGIN_PX * step.worldPerPx + CLEAR_REACH

  it('пустой набор — 0', () => {
    expect(tileSignature(ti, tj, step, EMPTY_CLEARING)).toBe(0)
  })

  it('меняется при переносе ноды внутри радиуса влияния', () => {
    const far = { x: tb.maxX + reach + 500, y: tb.minY }
    for (const inside of [
      { x: (tb.minX + tb.maxX) / 2, y: (tb.minY + tb.maxY) / 2 },
      { x: tb.minX - reach + 5, y: tb.minY + 10 },
      { x: tb.maxX + 100, y: tb.maxY + 200 },
    ]) {
      const a = tileSignature(ti, tj, step, buildClearing([inside, far]))
      const b = tileSignature(ti, tj, step, buildClearing([{ x: inside.x + 3, y: inside.y }, far]))
      expect(a).not.toBe(0)
      expect(a).not.toBe(b)
    }
  })

  it('не меняется при переносе далёкой ноды', () => {
    const near = { x: tb.minX + 50, y: tb.minY + 70 }
    const a = tileSignature(ti, tj, step, buildClearing([near, { x: tb.maxX + reach + 10, y: tb.minY }]))
    const b = tileSignature(ti, tj, step, buildClearing([near, { x: tb.maxX + reach + 300, y: tb.maxY + 900 }]))
    const c = tileSignature(ti, tj, step, buildClearing([near]))
    expect(a).toBe(b)
    expect(a).toBe(c)
  })

  it('нода за радиусом влияния не меняет растр плитки (подпись покрывает всё, от чего зависит отрисовка)', () => {
    const pond = findPond(0, 5, 0, 5)
    for (const k of [1, 0.125]) {
      const s = latticeStep(k)
      const { ti: i, tj: j } = tileOf(s, pond.x, pond.y)
      const b = tileBounds(s, i, j)
      const R = TILE_MARGIN_PX * s.worldPerPx + CLEAR_REACH
      const art = fakeArt(s.lod)
      const base = render(i, j, s, art).out
      // Ноды сразу за радиусом влияния со всех сторон.
      const ring = buildClearing([
        { x: b.minX - R - 1, y: (b.minY + b.maxY) / 2 },
        { x: b.maxX + R + 1, y: (b.minY + b.maxY) / 2 },
        { x: (b.minX + b.maxX) / 2, y: b.minY - R - 1 },
        { x: (b.minX + b.maxX) / 2, y: b.maxY + R + 1 },
        { x: b.minX - R - 1, y: b.minY - R - 1 },
      ])
      expect(tileSignature(i, j, s, ring)).toBe(0)
      const withRing = render(i, j, s, art, ring).out
      expect(same(withRing, base)).toBe(true)
    }
  })
})

describe('renderTile: скорость', () => {
  for (const k of [0.5, 0.125]) {
    it(`плитка u = 1, k = ${k} (lod ${latticeStep(k).lod}) с лесом, прудом и мелочью — не дольше 30 мс`, () => {
      const step = latticeStep(k)
      expect(step.u).toBe(1)
      const pond = findPond(0, 5, 0, 5)
      const { ti, tj } = tileOf(step, pond.x, pond.y)
      const art = fakeArt(step.lod)
      const tb = tileBounds(step, ti, tj)
      const nodes = Array.from({ length: 40 }, (_, i) => ({
        x: tb.minX + ((i * 37) % 100) / 100 * (tb.maxX - tb.minX),
        y: tb.minY + ((i * 61) % 100) / 100 * (tb.maxY - tb.minY),
      })).filter((n) => Math.hypot(n.x - pond.x, n.y - pond.y) > pond.reach + 20) // пруд должен остаться
      const clearing = buildClearing(nodes)
      const out = createRaster(step.size, step.size)
      renderTile(out, ti, tj, step, art, clearing) // прогрев JIT
      let best = Infinity
      let drawn = 0
      for (let i = 0; i < 3; i++) {
        resetWorldCache() // мир строится заново — честная цена новой плитки
        const t0 = performance.now()
        drawn = renderTile(out, ti, tj, step, art, clearing)
        best = Math.min(best, performance.now() - t0)
      }
      expect(drawn).toBeGreaterThan(10)
      expect(out.data.some((c) => WATER_SET.has(c))).toBe(true)
      if (step.lod === 0) expect(out.data.includes(DETAIL)).toBe(true)
      expect(best).toBeLessThanOrEqual(30)
    })
  }
})

// Проверка помощника теста (шов ищет пруд в отрицательных ячейках), а не world.ts.
it('findPond находит пруд в заданных ячейках', () => {
  const p = findPond(-4, -1, -4, -1)
  expect(p.x).toBeLessThan(0)
  expect(p.y).toBeLessThan(0)
  expect(Math.floor(p.x / POND_CELL)).toBeGreaterThanOrEqual(-4)
})

describe('artHasObjects / tilesBlank', () => {
  const base = (lod: Lod, object: SceneArt['object'], water: SceneArt['water'] = null): SceneArt => ({
    scene: 'autumn',
    dark: false,
    lod,
    soft: 0,
    ground: 0,
    object,
    detail: () => null,
    grid: null,
    water,
  })
  const dot: Sprite = { w: 1, h: 1, data: new Uint32Array([0xff000000]), ax: 0, ay: 0 }

  it('перебирает все виды, гаммы и варианты; ответ кэшируется на графику', () => {
    expect(artHasObjects(base(1, () => null))).toBe(false)
    // Единственный спрайт — последний вариант последней гаммы последнего вида.
    const kinds = Object.keys(SPRITE_LIMITS) as ObjectKind[]
    const last = kinds[kinds.length - 1]
    const L = SPRITE_LIMITS[last]
    let calls = 0
    const art = base(1, (k, p, v) => {
      calls++
      return k === last && p === L.pals - 1 && v === L.variants - 1 ? dot : null
    })
    expect(artHasObjects(art)).toBe(true)
    const n = calls
    expect(artHasObjects(art)).toBe(true)
    expect(calls).toBe(n)
  })

  it('пуста только ступень lod ≥ 1 без воды и спрайтов объектов', () => {
    const none = () => null
    const c = 0xff336699
    const water = { deep: c, mid: c, lit: c, bank: c, dash: c, shore: c }
    expect(tilesBlank(base(0, none), 0)).toBe(false)
    expect(tilesBlank(base(1, none), 1)).toBe(true)
    expect(tilesBlank(base(2, none), 2)).toBe(true)
    expect(tilesBlank(base(1, none, water), 1)).toBe(false)
    expect(tilesBlank(base(1, () => dot), 1)).toBe(false)
  })

  it('настоящие сцены: «Бумага» на обзоре пуста, лесные сцены — нет', () => {
    for (const dark of [false, true]) {
      for (const lod of [1, 2] as const) {
        expect(tilesBlank(buildSceneArt('paper', dark, lod, 0.4), lod)).toBe(true)
        for (const scene of ['meadow', 'autumn', 'winter'] as const) {
          expect(tilesBlank(buildSceneArt(scene, dark, lod, 0.4), lod)).toBe(false)
        }
      }
      expect(tilesBlank(buildSceneArt('paper', dark, 0, 0), 0)).toBe(false)
    }
  })
})
