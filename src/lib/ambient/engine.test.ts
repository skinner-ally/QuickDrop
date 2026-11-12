import { describe, expect, it } from 'vitest'
import type { AmbientFrame } from '@/lib/graph/ambient'
import type { AmbientEffect, AmbientScene, Lod, Raster, SceneArt } from '@/lib/ambient/types'
import { AMBIENT_FADE_MS, AMBIENT_TILE_BUDGET_MS, AMBIENT_TILE_MAX_PX } from '@/lib/ambient/types'
import { effectUnit, latticeStep, tileOrigin, tileRange } from '@/lib/ambient/lattice'
import { buildClearing } from '@/lib/ambient/clearing'
import { tileSignature } from '@/lib/ambient/tileRender'
import type { AmbientScheduler } from '@/lib/ambient/scheduler'
import { createAmbientEngine } from '@/lib/ambient/engine'
import type { AmbientEngine, Surface } from '@/lib/ambient/engine'

// ───────────────────────── подделки ─────────────────────────

interface Call {
  op: 'clearRect' | 'drawImage'
  args: unknown[]
  alpha: number
  comp: string
}

interface FakeCtx {
  ctx: CanvasRenderingContext2D
  raw: { canvas: { width: number; height: number }; globalAlpha: number; globalCompositeOperation: string; imageSmoothingEnabled: boolean }
  calls: Call[]
}

function fakeCtx(w: number, h: number): FakeCtx {
  const calls: Call[] = []
  const raw = {
    canvas: { width: w, height: h },
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    clearRect(...args: unknown[]) {
      calls.push({ op: 'clearRect', args, alpha: raw.globalAlpha, comp: raw.globalCompositeOperation })
    },
    drawImage(...args: unknown[]) {
      calls.push({ op: 'drawImage', args, alpha: raw.globalAlpha, comp: raw.globalCompositeOperation })
    },
  }
  return { ctx: raw as unknown as CanvasRenderingContext2D, raw, calls }
}

interface FakeSurface extends Surface {
  id: number
  puts: number
  released: number
}

interface Clock {
  t: number
}

function fakeSurfaces(clock?: Clock, cost = 0) {
  const all: FakeSurface[] = []
  const create = (w: number, h: number): Surface => {
    const s: FakeSurface = {
      id: all.length,
      source: { surface: all.length } as unknown as CanvasImageSource,
      w,
      h,
      puts: 0,
      released: 0,
      put(data: Uint32Array) {
        expect(data.length).toBe(w * h)
        s.puts += 1
        // Цена отрисовки плитки: выгрузка — последний шаг, часы двигаются здесь.
        if (clock && w === h) clock.t += cost
      },
      release() {
        s.released += 1
      },
    }
    all.push(s)
    return s
  }
  return { all, create }
}

interface FakeScheduler extends AmbientScheduler {
  starts: number
  calls: boolean[]
  queue: Array<{ t: number; dt: number }>
}

function fakeScheduler(): FakeScheduler {
  let running = false
  const s: FakeScheduler = {
    starts: 0,
    calls: [],
    queue: [],
    setRunning(on: boolean) {
      s.calls.push(on)
      if (on) s.starts += 1
      running = on
    },
    get running() {
      return running
    },
    get armed() {
      return false
    },
    consume() {
      return running ? (s.queue.shift() ?? null) : null
    },
    dispose() {
      running = false
    },
  }
  return s
}

/** Пустая графика: плитка рисуется настоящим renderTile, но без спрайтов (быстро). */
function fakeArt(scene: AmbientScene, dark: boolean, lod: Lod, soft: number): SceneArt {
  return { scene, dark, lod, soft, ground: 0, object: () => null, detail: () => null, grid: null, water: null }
}

/** Графика с прудами: на lod ≥ 1 ступень не пустая (пустую движок пропускает). */
function wetArt(scene: AmbientScene, dark: boolean, lod: Lod, soft: number): SceneArt {
  const c = 0xff336699
  return { ...fakeArt(scene, dark, lod, soft), water: { deep: c, mid: c, lit: c, bank: c, dash: c, shore: c } }
}

function fxEffect(id: string, plane: 'under' | 'over', anchor: 'screen' | 'world') {
  const log: Array<{ t: number; w: number; h: number }> = []
  const eff: AmbientEffect = {
    id,
    plane,
    anchor,
    draw: (out: Raster, f) => {
      log.push({ t: f.t, w: out.w, h: out.h })
      out.data[0] = 0xff0000ff
    },
  }
  return { eff, log }
}

interface Setup {
  W?: number
  H?: number
  cost?: number
  effects?: readonly AmbientEffect[]
  scene?: AmbientScene
  animate?: boolean
  art?: (scene: AmbientScene, dark: boolean, lod: Lod, soft: number) => SceneArt
  /** Размер окна, CSS px (deps.windowSize). */
  win?: { width: number; height: number }
}

function setup(o: Setup = {}) {
  const W = o.W ?? 1280
  const H = o.H ?? 800
  const clock: Clock = { t: 0 }
  const surfaces = fakeSurfaces(clock, o.cost ?? 0)
  const scheduler = fakeScheduler()
  const back = fakeCtx(W, H)
  const front = fakeCtx(W, H)
  let requests = 0
  let artCalls = 0
  let effectCalls = 0
  const engine: AmbientEngine = createAmbientEngine({
    createSurface: surfaces.create,
    art: (scene, dark, lod, soft) => {
      artCalls += 1
      return (o.art ?? fakeArt)(scene, dark, lod, soft)
    },
    effects: () => {
      effectCalls += 1
      return o.effects ?? []
    },
    scheduler,
    requestFrame: () => {
      requests += 1
    },
    now: () => clock.t,
    windowSize: o.win ? () => o.win ?? null : undefined,
  })
  engine.configure({ scene: o.scene ?? 'autumn', animate: o.animate ?? false })
  const draw = (f: AmbientFrame) => engine.draw({ back: back.ctx, front: front.ctx }, f)
  const reset = () => {
    back.calls.length = 0
    front.calls.length = 0
  }
  return {
    W,
    H,
    clock,
    surfaces,
    scheduler,
    back,
    front,
    engine,
    draw,
    reset,
    get requests() {
      return requests
    },
    get artCalls() {
      return artCalls
    },
    get effectCalls() {
      return effectCalls
    },
  }
}

interface FrameOpts {
  ox?: number
  oy?: number
  zoom?: number
  dpr?: number
  time?: number
  sceneRev?: number
  points?: ReadonlyArray<{ x: number; y: number }>
  pixel?: boolean
  W?: number
  H?: number
}

function frame(o: FrameOpts = {}): AmbientFrame {
  const zoom = o.zoom ?? 1
  const dpr = o.dpr ?? 1
  const W = o.W ?? 1280
  const H = o.H ?? 800
  return {
    viewport: { width: W / dpr, height: H / dpr, dpr, camera: { x: 0, y: 0, zoom } },
    device: { ox: o.ox ?? 0, oy: o.oy ?? 0, k: zoom * dpr },
    pixel: o.pixel ?? true,
    dark: false,
    time: o.time ?? 0,
    nodeNear: () => false,
    sceneRev: o.sceneRev ?? 1,
    points: o.points ?? [],
  }
}

type Tile = { ti: number; tj: number }

function tilesOf(r: { ti0: number; tj0: number; ti1: number; tj1: number }, pad = 0): Tile[] {
  const out: Tile[] = []
  for (let tj = r.tj0 - pad; tj <= r.tj1 + pad; tj++) for (let ti = r.ti0 - pad; ti <= r.ti1 + pad; ti++) out.push({ ti, tj })
  return out
}

const tileKey = (t: Tile) => `${t.ti},${t.tj}`
const draws = (c: FakeCtx) => c.calls.filter((x) => x.op === 'drawImage')
const clears = (c: FakeCtx) => c.calls.filter((x) => x.op === 'clearRect')
const live = (all: FakeSurface[]) => all.filter((s) => s.released === 0)

// ───────────────────────── плитки ─────────────────────────

describe('engine: плитки', () => {
  it('ложатся в целые координаты ox + ti·size·u с размером size·u (все ступени × dpr)', () => {
    for (const dpr of [1, 1.25, 1.5, 2]) {
      for (const zoom of [0.125, 0.25, 0.5, 0.75, 1, 1.5, 2]) {
        const W = 1000
        const H = 700
        const s = setup({ W, H, art: wetArt })
        const f = frame({ W, H, zoom, dpr, ox: -337, oy: 211 })
        s.draw(f)
        const step = latticeStep(zoom * dpr)
        const T = step.size * step.u
        const visible = tilesOf(tileRange(step, f.device, W, H))
        const d = draws(s.back)
        expect(d.length).toBe(visible.length)
        const seen = new Set<string>()
        for (const c of d) {
          const [, sx, sy, sw, sh, x, y, w, h] = c.args as number[]
          expect([sx, sy, sw, sh]).toEqual([0, 0, step.size, step.size])
          expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true)
          expect(w).toBe(T)
          expect(h).toBe(T)
          expect((x - f.device.ox) % T === 0).toBe(true)
          expect((y - f.device.oy) % T === 0).toBe(true)
          seen.add(`${(x - f.device.ox) / T},${(y - f.device.oy) / T}`)
        }
        // Нарисованы ровно видимые плитки (кольцо не сводится).
        expect([...seen].sort()).toEqual(visible.map(tileKey).sort())
        expect(s.back.raw.imageSmoothingEnabled).toBe(false)
        expect(s.front.raw.imageSmoothingEnabled).toBe(false)
      }
    }
  })

  it('видимые плитки и кольцо рисуются один раз; повторный draw ничего не рисует и не создаёт', () => {
    const s = setup()
    const f = frame({ ox: -100, oy: -60 })
    s.draw(f)
    const step = latticeStep(1)
    const withRing = tilesOf(tileRange(step, f.device, s.W, s.H), 1)
    expect(s.surfaces.all.length).toBe(withRing.length)
    expect(s.engine.stats().rendered).toBe(withRing.length)
    expect(s.requests).toBe(0)
    s.reset()
    s.draw(f)
    s.draw({ ...f, time: 500 })
    expect(s.back.calls).toEqual([])
    expect(s.front.calls).toEqual([])
    expect(s.surfaces.all.length).toBe(withRing.length)
    expect(s.artCalls).toBe(1)
  })

  it('сдвиг на полплитки создаёт только плитки нового ряда кольца', () => {
    const s = setup()
    const step = latticeStep(1)
    const T = step.size * step.u
    const f1 = frame({ ox: 0, oy: 0 })
    s.draw(f1)
    const before = new Set(tilesOf(tileRange(step, f1.device, s.W, s.H), 1).map(tileKey))
    const n0 = s.surfaces.all.length
    s.reset()
    const f2 = frame({ ox: -T / 2, oy: -T / 2 })
    s.draw(f2)
    const after = tilesOf(tileRange(step, f2.device, s.W, s.H), 1).map(tileKey)
    const fresh = after.filter((k) => !before.has(k))
    expect(fresh.length).toBeGreaterThan(0)
    expect(s.surfaces.all.length - n0).toBe(fresh.length)
    // Видимые уже были готовы из запаса: на экране нет пустых мест.
    expect(draws(s.back).length).toBe(tilesOf(tileRange(step, f2.device, s.W, s.H)).length)
    expect(s.requests).toBe(0)
  })

  it('кольцо не рисуется, если вместе с видимыми не помещается в предел памяти', () => {
    // k = 0.5: u = 1, плитка 512² = 262144 пикселя; 8×6 видимых (12.6 млн) + кольцо 32 → 21 млн > 16 млн.
    const W = 4096
    const H = 3072
    const s = setup({ W, H })
    const f = frame({ W, H, zoom: 0.5 })
    const step = latticeStep(0.5)
    expect(step.size).toBe(512)
    const visible = tilesOf(tileRange(step, f.device, W, H))
    expect(visible.length).toBe(48)
    expect((visible.length + 32) * 512 * 512).toBeGreaterThan(AMBIENT_TILE_MAX_PX)
    s.draw(f)
    expect(s.surfaces.all.length).toBe(48)
    expect(s.requests).toBe(0)
    s.draw(f)
    expect(s.surfaces.all.length).toBe(48)
    expect(s.engine.stats().tilePixels).toBeLessThanOrEqual(AMBIENT_TILE_MAX_PX)
  })

  it('при цене плитки 5 мс в кадре ровно две новые плитки (ближние к центру), третья отложена', () => {
    const s = setup({ cost: 5 })
    const f = frame({ ox: -100, oy: -60 })
    const step = latticeStep(1)
    const T = step.size * step.u
    const visible = tilesOf(tileRange(step, f.device, s.W, s.H))
    s.draw(f)
    expect(s.surfaces.all.length).toBe(2)
    expect(s.requests).toBe(1)
    expect(s.clock.t).toBeLessThanOrEqual(AMBIENT_TILE_BUDGET_MS)
    // Нарисованы две ближние к центру.
    const dist = (t: Tile) => {
      const o = tileOrigin(step, f.device, t.ti, t.tj)
      return (o.x + T / 2 - s.W / 2) ** 2 + (o.y + T / 2 - s.H / 2) ** 2
    }
    const nearest = [...visible].sort((a, b) => dist(a) - dist(b) || a.tj - b.tj || a.ti - b.ti).slice(0, 2)
    const drawn = draws(s.back).map((c) => {
      const [, , , , , x, y] = c.args as number[]
      return `${(x - f.device.ox) / T},${(y - f.device.oy) / T}`
    })
    expect(drawn.sort()).toEqual(nearest.map(tileKey).sort())
    // Дорисовка следующими кадрами: по две плитки, пока не готовы видимые и кольцо.
    const total = tilesOf(tileRange(step, f.device, s.W, s.H), 1).length
    let guard = 0
    while (s.requests > guard && guard < 100) {
      guard += 1
      const before = s.surfaces.all.length
      s.clock.t += 100
      s.draw({ ...f, time: s.clock.t })
      expect(s.surfaces.all.length - before).toBeLessThanOrEqual(2)
    }
    expect(s.surfaces.all.length).toBe(total)
    const r = s.requests
    s.draw({ ...f, time: s.clock.t + 100 })
    expect(s.requests).toBe(r)
  })

  it('смена sceneRev с теми же точками — ноль отрисовок и сведений', () => {
    const points = [{ x: 100, y: 100 }, { x: 600, y: 300 }]
    const s = setup()
    s.draw(frame({ points, sceneRev: 1 }))
    const n = s.engine.stats().rendered
    s.reset()
    s.draw(frame({ points: points.map((p) => ({ ...p })), sceneRev: 2 }))
    s.draw(frame({ points: [...points].reverse(), sceneRev: 3 }))
    expect(s.engine.stats().rendered).toBe(n)
    expect(s.back.calls).toEqual([])
    expect(s.front.calls).toEqual([])
  })

  it('перенос точки — заново рисуются только плитки в радиусе влияния, прежние освобождаются', () => {
    const p1 = [{ x: 100, y: 100 }, { x: 900, y: 500 }]
    const p2 = [{ x: 140, y: 100 }, { x: 900, y: 500 }]
    const s = setup()
    const f = frame({ points: p1, sceneRev: 1 })
    s.draw(f)
    const step = latticeStep(1)
    const all = tilesOf(tileRange(step, f.device, s.W, s.H), 1)
    const c1 = buildClearing(p1)
    const c2 = buildClearing(p2)
    const changed = all.filter((t) => tileSignature(t.ti, t.tj, step, c1) !== tileSignature(t.ti, t.tj, step, c2))
    expect(changed.length).toBeGreaterThan(0)
    expect(changed.length).toBeLessThan(all.length)
    const n = s.engine.stats().rendered
    const created = s.surfaces.all.length
    s.draw(frame({ points: p2, sceneRev: 2 }))
    expect(s.engine.stats().rendered - n).toBe(changed.length)
    // animate: false — растворений нет, прежние поверхности освобождены сразу.
    expect(s.surfaces.all.length - created).toBe(changed.length)
    expect(s.surfaces.all.filter((x) => x.released > 0).length).toBe(changed.length)
    expect(s.back.calls.some((c) => c.comp === 'lighter')).toBe(false)
    expect(s.scheduler.starts).toBe(0)
  })

  it('предел памяти: после 300 прыжков камеры кэш не больше AMBIENT_TILE_MAX_PX, лишнее освобождено', () => {
    const s = setup()
    let seed = 12345
    const rnd = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
      return seed / 2 ** 32
    }
    for (let i = 0; i < 300; i++) {
      const ox = Math.round((rnd() - 0.5) * 4e6)
      const oy = Math.round((rnd() - 0.5) * 4e6)
      s.draw(frame({ zoom: 2, ox, oy, time: i * 16 }))
      const st = s.engine.stats()
      expect(st.tilePixels).toBeLessThanOrEqual(AMBIENT_TILE_MAX_PX)
    }
    const st = s.engine.stats()
    expect(st.rendered).toBeGreaterThan(AMBIENT_TILE_MAX_PX / (128 * 128))
    // Живы ровно поверхности кэша; каждая вытесненная освобождена один раз.
    expect(live(s.surfaces.all).length).toBe(st.tiles)
    expect(s.surfaces.all.every((x) => x.released <= 1)).toBe(true)
  })

  it('смена сцены освобождает плитки прежней и рисует заново', () => {
    const s = setup()
    const f = frame()
    s.draw(f)
    const n = s.surfaces.all.length
    s.engine.configure({ scene: 'winter', animate: false })
    expect(live(s.surfaces.all).length).toBe(0)
    s.reset()
    s.draw(f)
    expect(s.surfaces.all.length).toBe(2 * n)
    expect(clears(s.back).length).toBe(1)
    expect(s.artCalls).toBe(2)
  })
})

// ───────────────────────── растворение ─────────────────────────

describe('engine: растворение', () => {
  it('смена поляны при animate: старая гаснет, новая проявляется через lighter, за 3 шага', () => {
    const p1 = [{ x: 100, y: 100 }]
    const p2 = [{ x: 140, y: 100 }]
    const s = setup({ animate: true })
    const f1 = frame({ points: p1, sceneRev: 1 })
    s.draw(f1)
    expect(s.scheduler.starts).toBe(0) // эффектов нет
    const step = latticeStep(1)
    const range = tileRange(step, f1.device, s.W, s.H)
    const c1 = buildClearing(p1)
    const c2 = buildClearing(p2)
    const changed = (t: Tile) => tileSignature(t.ti, t.tj, step, c1) !== tileSignature(t.ti, t.tj, step, c2)
    const visibleChanged = tilesOf(range).filter(changed).length
    const allChanged = tilesOf(range, 1).filter(changed).length
    expect(visibleChanged).toBeGreaterThan(0)
    const created = s.surfaces.all.length
    s.reset()
    s.draw(frame({ points: p2, sceneRev: 2, time: 1000 }))
    const fresh = s.surfaces.all.slice(created)
    expect(fresh.length).toBe(allChanged)
    // Видимые старые живы (растворение), плитки кольца сменились сразу; планировщик запущен ради шагов.
    expect(s.surfaces.all.slice(0, created).filter((x) => x.released > 0).length).toBe(allChanged - visibleChanged)
    expect(s.scheduler.running).toBe(true)
    const lighter = s.back.calls.filter((c) => c.comp === 'lighter')
    expect(lighter.length).toBe(visibleChanged)
    const alphas = (time: number) => {
      s.reset()
      s.draw(frame({ points: p2, sceneRev: 2, time }))
      return s.back.calls.filter((c) => c.comp === 'lighter').map((c) => c.alpha)
    }
    expect(new Set(alphas(1000 + 80))).toEqual(new Set([1 / 3]))
    expect(new Set(alphas(1000 + 160))).toEqual(new Set([2 / 3]))
    // Состояние возвращено после растворения.
    expect(s.back.raw.globalAlpha).toBe(1)
    expect(s.back.raw.globalCompositeOperation).toBe('source-over')
    expect(alphas(1000 + AMBIENT_FADE_MS)).toEqual([])
    const released = s.surfaces.all.filter((x) => x.released > 0).length
    expect(released).toBe(fresh.length)
    expect(s.scheduler.running).toBe(false)
  })

  it('растворение плитки, ушедшей с экрана, завершается сразу', () => {
    const p1 = [{ x: 100, y: 100 }]
    const p2 = [{ x: 140, y: 100 }]
    const s = setup({ animate: true })
    s.draw(frame({ points: p1, sceneRev: 1 }))
    const created = s.surfaces.all.length
    s.draw(frame({ points: p2, sceneRev: 2, time: 1000 }))
    const fading = s.surfaces.all.length - created
    expect(fading).toBeGreaterThan(0)
    s.draw(frame({ points: p2, sceneRev: 2, time: 1010, ox: -200000, oy: -200000 }))
    expect(s.surfaces.all.slice(0, created).filter((x) => x.released > 0).length).toBeGreaterThanOrEqual(fading)
    expect(s.scheduler.running).toBe(false)
  })
})

// ───────────────────────── эффекты и планировщик ─────────────────────────

describe('engine: эффекты и планировщик', () => {
  it('animate: false — планировщик не запускается, эффекты не рисуются, растворений нет', () => {
    const over = fxEffect('o', 'over', 'screen')
    const s = setup({ animate: false, effects: [over.eff] })
    s.draw(frame({ points: [{ x: 100, y: 100 }], sceneRev: 1 }))
    s.draw(frame({ points: [{ x: 140, y: 100 }], sceneRev: 2, time: 100 }))
    expect(s.scheduler.starts).toBe(0)
    expect(s.effectCalls).toBe(0)
    expect(over.log.length).toBe(0)
    expect(s.back.calls.some((c) => c.comp === 'lighter')).toBe(false)
    expect(draws(s.front).length).toBe(0)
  })

  it('animate: true и пустой список эффектов — планировщик не запущен', () => {
    const s = setup({ animate: true, effects: [] })
    s.draw(frame())
    s.draw(frame({ time: 100 }))
    expect(s.scheduler.starts).toBe(0)
    expect(s.scheduler.running).toBe(false)
  })

  it('тик перерисовывает front, не трогая плитки', () => {
    const over = fxEffect('o', 'over', 'screen')
    const s = setup({ animate: true, effects: [over.eff] })
    const f = frame({ dpr: 1.5, W: 1280, H: 800 })
    s.draw(f)
    expect(s.scheduler.running).toBe(true)
    expect(over.log.length).toBe(1)
    const fx = effectUnit(1280, 800, 1.5)
    expect(over.log[0]).toEqual({ t: 0, w: fx.w, h: fx.h })
    const surfaces = s.surfaces.all.length
    const rendered = s.engine.stats().rendered
    s.reset()
    s.draw({ ...f, time: 50 })
    expect(s.back.calls).toEqual([])
    expect(s.front.calls).toEqual([])
    s.scheduler.queue.push({ t: 0.083, dt: 0.083 })
    s.draw({ ...f, time: 83 })
    expect(over.log.length).toBe(2)
    expect(over.log[1].t).toBe(0.083)
    expect(s.back.calls).toEqual([])
    expect(clears(s.front).length).toBe(1)
    const d = draws(s.front)
    expect(d.length).toBe(1)
    expect(d[0].args.slice(1)).toEqual([0, 0, fx.w, fx.h, 0, 0, fx.w * fx.e, fx.h * fx.e])
    expect(s.surfaces.all.length).toBe(surfaces)
    expect(s.engine.stats().rendered).toBe(rendered)
    expect(s.engine.stats().ticks).toBe(1)
  })

  it('пара world между тиками едет вместе с камерой; смена k — перерисовка сразу', () => {
    const over = fxEffect('w', 'over', 'world')
    const s = setup({ animate: true, effects: [over.eff] })
    s.draw(frame({ ox: 10, oy: 20 }))
    expect(over.log.length).toBe(1)
    s.reset()
    s.draw(frame({ ox: 17, oy: 17 }))
    expect(over.log.length).toBe(1)
    const d = draws(s.front)
    expect(d.length).toBe(1)
    expect(d[0].args.slice(5, 7)).toEqual([7, -3])
    s.reset()
    s.draw(frame({ ox: 17, oy: 17, zoom: 1.5 }))
    expect(over.log.length).toBe(2)
    expect(draws(s.front)[0].args.slice(5, 7)).toEqual([0, 0])
  })

  it('пара under сводится в back поверх плиток; тик пересводит back без новых плиток', () => {
    const under = fxEffect('u', 'under', 'screen')
    const s = setup({ animate: true, effects: [under.eff] })
    const f = frame()
    s.draw(f)
    const n = s.surfaces.all.length
    const rendered = s.engine.stats().rendered
    s.reset()
    s.scheduler.queue.push({ t: 0.1, dt: 0.1 })
    s.draw({ ...f, time: 100 })
    const d = draws(s.back)
    const step = latticeStep(1)
    const visible = tilesOf(tileRange(step, f.device, s.W, s.H)).length
    expect(d.length).toBe(visible + 1)
    // Растр эффектов — последним.
    const last = d[d.length - 1].args as number[]
    const fx = effectUnit(s.W, s.H, 1)
    expect(last.slice(1)).toEqual([0, 0, fx.w, fx.h, 0, 0, fx.w * fx.e, fx.h * fx.e])
    expect(s.front.calls).toEqual([])
    expect(s.surfaces.all.length).toBe(n)
    expect(s.engine.stats().rendered).toBe(rendered)
  })

  it('configure(animate: false) останавливает планировщик, освобождает растры и чистит front', () => {
    const over = fxEffect('o', 'over', 'screen')
    const s = setup({ animate: true, effects: [over.eff] })
    s.draw(frame())
    const pairSurfaces = s.surfaces.all.filter((x) => x.w !== x.h)
    expect(pairSurfaces.length).toBe(1)
    s.engine.configure({ scene: 'autumn', animate: false })
    expect(s.scheduler.running).toBe(false)
    expect(pairSurfaces[0].released).toBe(1)
    s.reset()
    s.draw(frame({ time: 100 }))
    expect(clears(s.front).length).toBe(1)
    expect(draws(s.front).length).toBe(0)
    s.reset()
    s.draw(frame({ time: 200 }))
    expect(s.front.calls).toEqual([])
    expect(s.scheduler.calls.filter((x) => x).length).toBe(1)
  })
})

// ───────────────────────── жизненный цикл ─────────────────────────

describe('engine: жизненный цикл', () => {
  it('dispose освобождает всё (плитки, растворения, растры эффектов) и глушит draw', () => {
    const over = fxEffect('o', 'over', 'screen')
    const under = fxEffect('u', 'under', 'world')
    const s = setup({ animate: true, effects: [over.eff, under.eff] })
    s.draw(frame({ points: [{ x: 100, y: 100 }], sceneRev: 1 }))
    s.draw(frame({ points: [{ x: 140, y: 100 }], sceneRev: 2, time: 1000 }))
    expect(live(s.surfaces.all).length).toBeGreaterThan(s.engine.stats().tiles) // есть растворения и пары
    s.engine.dispose()
    expect(s.surfaces.all.every((x) => x.released === 1)).toBe(true)
    expect(s.scheduler.running).toBe(false)
    expect(s.engine.stats().tiles).toBe(0)
    expect(s.engine.stats().tilePixels).toBe(0)
    s.reset()
    const n = s.surfaces.all.length
    s.draw(frame({ time: 2000 }))
    s.engine.dispose()
    expect(s.surfaces.all.length).toBe(n)
    expect(s.back.calls).toEqual([])
  })

  it('pixel: false — canvas очищены, ничего не создано', () => {
    const over = fxEffect('o', 'over', 'screen')
    const s = setup({ animate: true, effects: [over.eff] })
    s.draw(frame({ pixel: false }))
    expect(s.surfaces.all.length).toBe(0)
    expect(s.artCalls).toBe(0)
    expect(s.effectCalls).toBe(0)
    expect(clears(s.back).length).toBe(1)
    expect(clears(s.front).length).toBe(1)
    expect(draws(s.back).length + draws(s.front).length).toBe(0)
    expect(s.scheduler.starts).toBe(0)

    s.draw(frame())
    const n = s.surfaces.all.length
    expect(n).toBeGreaterThan(0)
    s.reset()
    s.draw(frame({ pixel: false, time: 50 }))
    expect(clears(s.back).length).toBe(1)
    expect(clears(s.front).length).toBe(1)
    expect(draws(s.back).length + draws(s.front).length).toBe(0)
    expect(s.surfaces.all.length).toBe(n)
    expect(s.scheduler.running).toBe(false)
    // Уже чистые canvas второй раз не трогаются; возврат — полное сведение из кэша.
    s.reset()
    s.draw(frame({ pixel: false, time: 60 }))
    expect(s.back.calls).toEqual([])
    s.draw(frame({ time: 70 }))
    expect(draws(s.back).length).toBeGreaterThan(0)
    expect(s.surfaces.all.length).toBe(n)
  })

  it('canvas нулевого размера — ничего не создаётся', () => {
    const s = setup({ W: 0, H: 0 })
    s.draw(frame({ W: 0, H: 0 }))
    expect(s.surfaces.all.length).toBe(0)
    expect(s.engine.stats()).toEqual({ tiles: 0, tilePixels: 0, rendered: 0, ticks: 0 })
  })

  it('смена размера canvas пересоздаёт растр эффектов с прежними часами и пересводит оба canvas', () => {
    const over = fxEffect('o', 'over', 'screen')
    const s = setup({ animate: true, effects: [over.eff] })
    s.draw(frame())
    // Планировщик запущен в конце первого кадра: тик приходит во втором.
    s.scheduler.queue.push({ t: 0.5, dt: 0.083 })
    s.draw(frame({ time: 83 }))
    expect(over.log.at(-1)?.t).toBe(0.5)
    s.back.raw.canvas.width = 900
    s.front.raw.canvas.width = 900
    s.reset()
    s.draw(frame({ time: 90, W: 900 }))
    const fx = effectUnit(900, 800, 1)
    expect(over.log.at(-1)).toEqual({ t: 0.5, w: fx.w, h: fx.h })
    expect(clears(s.back).length).toBe(1)
    expect(clears(s.front).length).toBe(1)
  })

  it('графика берётся из кэша: deps.art один раз на (сцена, тема, lod, смягчение)', () => {
    const s = setup()
    s.draw(frame())
    s.draw(frame({ ox: 30 }))
    expect(s.artCalls).toBe(1)
    s.draw(frame({ zoom: 0.5 }))
    expect(s.artCalls).toBe(2)
    s.draw(frame())
    expect(s.artCalls).toBe(2)
  })

  it('EffectFrame: мир ↔ арт-пиксели согласованы', () => {
    let seen: Parameters<AmbientEffect['draw']>[1] | null = null
    const eff: AmbientEffect = { id: 'x', plane: 'over', anchor: 'screen', draw: (_o, f) => (seen = f) }
    const s = setup({ animate: true, effects: [eff] })
    s.draw(frame({ ox: 40, oy: -20, zoom: 0.5, dpr: 2 }))
    expect(seen).not.toBeNull()
    const f = seen as unknown as Parameters<AmbientEffect['draw']>[1]
    expect(f.e).toBe(4)
    expect(f.zoom).toBe(0.5)
    expect(f.wx(f.ax(123) - 0.5)).toBeCloseTo(123)
    expect(f.wy(f.ay(-77) - 0.5)).toBeCloseTo(-77)
    expect(f.bounds.minX).toBeLessThan(f.wx(0))
    expect(f.bounds.maxX).toBeGreaterThan(f.wx(f.w))
  })
})

// ───────────────────────── исправления ревью 6 ─────────────────────────

/** Кадры до готовности: пока движок просит дорисовку. */
function settle(s: ReturnType<typeof setup>, f: AmbientFrame) {
  let guard = 0
  let before: number
  do {
    before = s.requests
    s.clock.t += 100
    s.draw(f)
  } while (s.requests > before && ++guard < 500)
}

describe('engine: ревью 6', () => {
  it('арт-пиксель эффектов берётся по окну: сужение сцены панелью деталей его не меняет', () => {
    const es: number[] = []
    const eff: AmbientEffect = { id: 'x', plane: 'over', anchor: 'screen', draw: (_o, f) => es.push(f.e) }
    const s = setup({ W: 2290, H: 1250, animate: true, effects: [eff], win: { width: 2560, height: 1400 } })
    s.draw(frame({ W: 2290, H: 1250 }))
    s.back.raw.canvas.width = 1824
    s.front.raw.canvas.width = 1824
    s.draw(frame({ W: 1824, H: 1250, time: 10 }))
    expect(es.length).toBe(2)
    expect(es[0]).toBe(es[1])
    expect(es[0]).toBe(effectUnit(1824, 1250, 1, { W: 2560, H: 1400 }).e)
    // Без окна эти размеры стоят по разные стороны порога.
    expect(effectUnit(2290, 1250, 1).e).not.toBe(effectUnit(1824, 1250, 1).e)
  })

  it('устаревшая плитка из кэша, которой не было на экране, не растворяется: прежняя освобождается сразу', () => {
    const p1 = [{ x: 500, y: 500 }]
    const p2 = [{ x: 540, y: 500 }]
    const s = setup({ animate: true })
    const f1 = frame({ points: p1, sceneRev: 1 })
    s.draw(f1)
    const n1 = s.surfaces.all.length
    const step = latticeStep(1)
    const c1 = buildClearing(p1)
    const c2 = buildClearing(p2)
    const changed = tilesOf(tileRange(step, f1.device, s.W, s.H), 1).filter(
      (t) => tileSignature(t.ti, t.tj, step, c1) !== tileSignature(t.ti, t.tj, step, c2),
    )
    expect(changed.length).toBeGreaterThan(0)
    // Отдалить, перенести ноду, вернуться.
    s.draw(frame({ points: p1, sceneRev: 1, zoom: 0.5, time: 100 }))
    s.draw(frame({ points: p2, sceneRev: 2, zoom: 0.5, time: 200 }))
    s.reset()
    s.draw(frame({ points: p2, sceneRev: 2, time: 1000 }))
    expect(s.back.calls.some((c) => c.comp === 'lighter')).toBe(false)
    expect(s.surfaces.all.slice(0, n1).filter((x) => x.released > 0).length).toBe(changed.length)
    expect(s.scheduler.running).toBe(false)
  })

  it('устаревшая невиденная плитка вне бюджета не выводится; бывшая на экране — остаётся до перерисовки', () => {
    const p1 = [{ x: 500, y: 500 }]
    const p2 = [{ x: 540, y: 500 }]
    // Цена 11 мс: одна плитка за кадр.
    const s = setup({ cost: 11, animate: true })
    const f1 = frame({ points: p1, sceneRev: 1 })
    settle(s, f1)
    const step = latticeStep(1)
    const c1 = buildClearing(p1)
    const c2 = buildClearing(p2)
    const visible = tilesOf(tileRange(step, f1.device, s.W, s.H))
    const visibleChanged = visible.filter(
      (t) => tileSignature(t.ti, t.tj, step, c1) !== tileSignature(t.ti, t.tj, step, c2),
    ).length
    expect(visibleChanged).toBeGreaterThanOrEqual(2)

    // Через другую ступень: на экране этих плиток не было.
    settle(s, frame({ points: p1, sceneRev: 1, zoom: 0.5 }))
    settle(s, frame({ points: p2, sceneRev: 2, zoom: 0.5 }))
    s.reset()
    const req = s.requests
    s.draw(frame({ points: p2, sceneRev: 2, time: 1000 }))
    expect(s.requests).toBe(req + 1)
    expect(draws(s.back).length).toBe(visible.length - visibleChanged + 1)
    expect(s.back.calls.some((c) => c.comp === 'lighter')).toBe(false)

    // Та же смена прямо на экране: устаревшие видимые остаются (сведены все видимые), одна растворяется.
    const t = setup({ cost: 11, animate: true })
    settle(t, f1)
    t.reset()
    t.draw(frame({ points: p2, sceneRev: 2, time: 1000 }))
    expect(draws(t.back).length).toBe(visible.length + 1)
    expect(t.back.calls.filter((c) => c.comp === 'lighter').length).toBe(1)
  })

  it('запас-кольцо не держит бывшие видимые плитки сверх предела кэша (4K, 50 %)', () => {
    const W = 3840
    const H = 2160
    const s = setup({ W, H })
    const step = latticeStep(0.5)
    const T = step.size * step.u
    expect(step.size).toBe(512)
    const walk = [
      [0, 0],
      [-T, 0],
      [-T, -T],
      [0, -T],
      [T, -T],
      [T, 0],
      [T, T],
      [0, T],
      [-T, T],
      [0, 0],
      [-T / 2, -T / 2],
      [T / 2, T / 2],
      [0, 0],
    ]
    for (let round = 0; round < 3; round++) {
      for (const [ox, oy] of walk) {
        // Сдвиг 100: экран задевает 9×6 плиток (14,2 млн пикселей) — кольцу почти не остаётся места.
        s.draw(frame({ W, H, zoom: 0.5, ox: ox + 100, oy: oy + 100, time: s.clock.t }))
        expect(s.engine.stats().tilePixels).toBeLessThanOrEqual(AMBIENT_TILE_MAX_PX)
        s.clock.t += 16
      }
    }
    // Видимые на месте: каждое сведение — все видимые плитки.
    s.reset()
    const f = frame({ W, H, zoom: 0.5, ox: -T, oy: 0, time: s.clock.t })
    s.draw(f)
    expect(draws(s.back).length).toBe(tilesOf(tileRange(step, f.device, W, H)).length)
    expect(live(s.surfaces.all).length).toBe(s.engine.stats().tiles)
  })

  it('ступень без графики («Бумага» на обзоре) — ни плиток, ни сведений; lod 0 — как прежде', () => {
    const s = setup()
    const far = frame({ zoom: 0.25 })
    expect(latticeStep(0.25).lod).toBeGreaterThan(0)
    s.draw(far)
    expect(s.surfaces.all.length).toBe(0)
    expect(draws(s.back).length).toBe(0)
    s.draw(frame({ zoom: 0.25, ox: 300, time: 10 }))
    expect(s.surfaces.all.length).toBe(0)
    expect(s.engine.stats().rendered).toBe(0)
    s.draw(frame({ time: 20 }))
    const n = s.surfaces.all.length
    expect(n).toBeGreaterThan(0)
    s.reset()
    s.draw(frame({ zoom: 0.25, time: 30 }))
    // Был лес — canvas очищен один раз, новых плиток нет.
    expect(clears(s.back).length).toBe(1)
    expect(draws(s.back).length).toBe(0)
    expect(s.surfaces.all.length).toBe(n)
    s.reset()
    s.draw(frame({ zoom: 0.25, ox: 40, time: 40 }))
    expect(s.back.calls).toEqual([])
  })

  it('reset (потеря контекста GPU): кадр запрошен один раз, кэш и растры выброшены, всё сведено заново', () => {
    const over = fxEffect('o', 'over', 'screen')
    const s = setup({ animate: true, effects: [over.eff] })
    const f = frame()
    s.draw(f)
    const n = s.surfaces.all.length
    const rendered = s.engine.stats().rendered
    const req = s.requests
    s.engine.reset()
    s.engine.reset()
    expect(s.requests).toBe(req + 1)
    s.reset()
    s.draw({ ...f, time: 50 })
    expect(s.surfaces.all.slice(0, n).every((x) => x.released === 1)).toBe(true)
    expect(s.engine.stats().rendered - rendered).toBe(rendered)
    expect(draws(s.back).length).toBe(tilesOf(tileRange(latticeStep(1), f.device, s.W, s.H)).length)
    expect(draws(s.front).length).toBe(1)
    expect(over.log.length).toBe(2)
    // Дальше — как обычно: неподвижный кадр ничего не стоит.
    s.reset()
    s.draw({ ...f, time: 60 })
    expect(s.back.calls).toEqual([])
    s.engine.dispose()
    s.engine.reset()
    expect(s.requests).toBe(req + 1)
  })
})
