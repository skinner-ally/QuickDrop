/**
 * Слой живого фона (spec-stage6 §4.6): поляны → плитки (кэш, бюджет, запас-кольцо) → тик → растры эффектов → сведение
 * в canvas back и front. Всё внешнее внедрено (поверхности, графика, эффекты, планировщик, часы): модуль не трогает
 * DOM и проверяется на подделках контекста.
 *
 * Сведение идёт только при изменениях: неподвижная камера без тика не стоит ни одного drawImage. Плитки ложатся
 * в целые пиксели устройства с целым увеличением u (решётка, lattice.ts), поэтому швов и мыла нет.
 */

import type { AmbientFrame, AmbientLayer, AmbientStats } from '@/lib/graph/ambient'
import type { Bounds } from '@/lib/graph/types'
import type { AmbientEffect, AmbientScene, EffectFrame, Lod, Raster, SceneArt } from '@/lib/ambient/types'
import { AMBIENT_FADE_MS, AMBIENT_TILE_BUDGET_MS, AMBIENT_TILE_MAX_PX } from '@/lib/ambient/types'
import type { LatticeStep } from '@/lib/ambient/lattice'
import { effectUnit, latticeStep, softenFor, tileOrigin, tileRange } from '@/lib/ambient/lattice'
import { clearRaster, createRaster } from '@/lib/ambient/raster'
import type { Clearing } from '@/lib/ambient/clearing'
import { EMPTY_CLEARING, buildClearing } from '@/lib/ambient/clearing'
import type { AmbientScheduler } from '@/lib/ambient/scheduler'
import { renderTile, tileSignature, tilesBlank } from '@/lib/ambient/tileRender'
import { createTileStore } from '@/lib/ambient/tileStore'

export interface Surface {
  readonly source: CanvasImageSource
  readonly w: number
  readonly h: number
  /** Выгрузить растр w×h (putImageData). */
  put: (data: Uint32Array) => void
  release: () => void
}

export interface EngineDeps {
  createSurface: (w: number, h: number) => Surface
  art: (scene: AmbientScene, dark: boolean, lod: Lod, soft: number) => SceneArt
  effects: (scene: AmbientScene, dark: boolean, zoom: number) => readonly AmbientEffect[]
  scheduler: AmbientScheduler
  /** requestAmbientFrame: дорисовать плитки, не уложившиеся в бюджет. */
  requestFrame: () => void
  /** По умолчанию performance.now. */
  now?: () => number
  /**
   * Размер окна, CSS px: по нему выбирается арт-пиксель эффектов (effectUnit, ref), чтобы панель деталей, сужая
   * сцену, его не меняла. Нет (или null) — выбор по canvas.
   */
  windowSize?: () => { width: number; height: number } | null
}

export interface AmbientEngine extends AmbientLayer {
  configure: (cfg: { scene: AmbientScene; animate: boolean }) => void
  /**
   * Содержимое поверхностей и canvas потеряно (потеря контекста GPU): на следующем кадре кэш плиток и растры
   * эффектов выбрасываются, оба canvas сводятся заново. Просит кадр сам.
   */
  reset: () => void
  /** release всех поверхностей, scheduler.setRunning(false). */
  dispose: () => void
  stats: () => AmbientStats
}

/** Растворение плитки: прежняя поверхность гаснет, новая проявляется (3 шага). */
interface Fade {
  key: string
  ti: number
  tj: number
  stepKey: string
  old: Surface
  t0: number
}

type Plane = 'under' | 'over'
type Anchor = 'screen' | 'world'
const PAIRS: ReadonlyArray<{ plane: Plane; anchor: Anchor }> = [
  { plane: 'under', anchor: 'screen' },
  { plane: 'under', anchor: 'world' },
  { plane: 'over', anchor: 'screen' },
  { plane: 'over', anchor: 'world' },
]

/** Растр эффектов одной пары plane × anchor. */
interface FxPair {
  raster: Raster
  surface: Surface
  e: number
  effects: readonly AmbientEffect[]
  /** Камера на момент отрисовки растра: пара world между тиками сдвигается на разницу. */
  ox: number
  oy: number
  k: number
}

/** Видимая плитка к сведению. */
interface Placed {
  key: string
  x: number
  y: number
  surface: Surface
}

/** Запас вокруг экрана у границ мира для эффектов, px экрана (CSS). */
const FX_BOUNDS_MARGIN = 64

function sameList(a: readonly AmbientEffect[], b: readonly AmbientEffect[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export function createAmbientEngine(deps: EngineDeps): AmbientEngine {
  const now = deps.now ?? (() => performance.now())
  const scheduler = deps.scheduler

  let cfg: { scene: AmbientScene; animate: boolean } | null = null
  let disposed = false
  let frameNo = 0
  let rendered = 0
  let ticks = 0
  /** Часы эффектов последнего тика: растр, пересозданный без тика, рисуется с ними. */
  let fxT = 0

  const store = createTileStore<Surface>({ maxPixels: AMBIENT_TILE_MAX_PX, release: (s) => s.release() })
  const artCache = new Map<string, SceneArt>()
  const fades = new Map<string, Fade>()
  const pairs = new Map<string, FxPair>()
  let fxKey: string | null = null
  let fxList: readonly AmbientEffect[] = []

  let clearing: Clearing = EMPTY_CLEARING
  /** Ревизия полян: растёт, когда набор нод действительно сменился. */
  let clearRev = 0
  let lastSceneRev: number | undefined = undefined
  let haveSceneRev = false

  let work: Raster | null = null

  // Состояние сведения: null — неизвестно (canvas надо свести заново при первом же кадре).
  let backKey: string | null = null
  let frontKey: string | null = null
  let backCtx: CanvasRenderingContext2D | null = null
  let frontCtx: CanvasRenderingContext2D | null = null
  // На чужом (или ещё не виденном) canvas могло быть нарисовано: считать, что рисовали.
  let backPainted = true
  let frontPainted = true
  /** Ключи плиток, сведённых в back прошлым кадром: растворяется только то, что было на экране. */
  let shown = new Set<string>()
  let lost = false

  const releaseFades = () => {
    for (const f of fades.values()) f.old.release()
    fades.clear()
  }
  const releasePairs = () => {
    for (const p of pairs.values()) p.surface.release()
    pairs.clear()
  }

  const artFor = (scene: AmbientScene, dark: boolean, lod: Lod, soft: number): { key: string; art: SceneArt } => {
    const key = `${scene}:${dark ? 1 : 0}:${lod}:${soft}`
    let art = artCache.get(key)
    if (!art) {
      art = deps.art(scene, dark, lod, soft)
      artCache.set(key, art)
    }
    return { key, art }
  }

  /** Очистить оба canvas (если на них рисовали) и забыть сведение. */
  const blank = (back: CanvasRenderingContext2D, front: CanvasRenderingContext2D) => {
    if (backPainted || backCtx !== back) back.clearRect(0, 0, back.canvas.width, back.canvas.height)
    if (frontPainted || frontCtx !== front) front.clearRect(0, 0, front.canvas.width, front.canvas.height)
    backPainted = false
    frontPainted = false
    backCtx = back
    frontCtx = front
    backKey = null
    frontKey = null
    shown = new Set()
  }

  const draw = (target: { back: CanvasRenderingContext2D; front: CanvasRenderingContext2D }, frame: AmbientFrame) => {
    if (disposed) return
    const { back, front } = target
    const W = back.canvas.width
    const H = back.canvas.height
    frameNo += 1
    if (lost) {
      lost = false
      releaseFades()
      releasePairs()
      store.clear()
      backPainted = true
      frontPainted = true
      backKey = null
      frontKey = null
      shown = new Set()
    }

    // 1. Нечего рисовать: «Классика», canvas нулевого размера или слой ещё не настроен.
    if (!cfg || !frame.pixel || !(W > 0) || !(H > 0)) {
      blank(back, front)
      releaseFades()
      scheduler.setRunning(false)
      return
    }
    back.imageSmoothingEnabled = false
    front.imageSmoothingEnabled = false
    if (backCtx !== back) {
      backCtx = back
      backKey = null
      shown = new Set()
    }
    if (frontCtx !== front) {
      frontCtx = front
      frontKey = null
    }

    const { scene, animate } = cfg
    const device = frame.device
    const dpr = frame.viewport.dpr
    const zoom = frame.viewport.camera.zoom
    const dark = frame.dark

    // 2. Ступень решётки и графика.
    const step: LatticeStep = latticeStep(device.k)
    const { key: artKey, art } = artFor(scene, dark, step.lod, softenFor(zoom))

    // 3. Поляны: пересобрать по новой ревизии сцены; приглушение нод (те же точки) плитки не трогает.
    if (!haveSceneRev || frame.sceneRev === undefined || frame.sceneRev !== lastSceneRev) {
      const next = buildClearing(frame.points ?? [])
      if (next.key !== clearing.key || next.size !== clearing.size) {
        clearing = next
        clearRev += 1
      }
      lastSceneRev = frame.sceneRev
      haveSceneRev = frame.sceneRev !== undefined
    }

    // 4. Тик эффектов (в неподвижном режиме планировщик не запущен → null).
    const tick = scheduler.consume(frame.time)
    if (tick) {
      ticks += 1
      fxT = tick.t
    }

    // 5. Плитки.
    const size = step.size
    const tilePx = size * size
    const T = size * step.u
    const range = tileRange(step, device, W, H)
    const cx = W / 2
    const cy = H / 2
    const byCenter = (list: Array<{ ti: number; tj: number }>) =>
      list
        .map((t) => {
          const o = tileOrigin(step, device, t.ti, t.tj)
          return { ...t, d: (o.x + T / 2 - cx) ** 2 + (o.y + T / 2 - cy) ** 2 }
        })
        .sort((a, b) => a.d - b.d || a.tj - b.tj || a.ti - b.ti)
    const keyOf = (ti: number, tj: number) => `${artKey}|${step.key}|${ti},${tj}`

    const t0 = now()
    let lastCost = 0
    let count = 0
    let pending = false
    let tilesChanged = false
    // Первая плитка кадра рисуется всегда; следующая — только если с ценой прошлой укладывается в бюджет.
    const allow = () => count === 0 || now() - t0 + lastCost <= AMBIENT_TILE_BUDGET_MS

    const renderOne = (ti: number, tj: number): { surface: Surface; sig: number } => {
      const s0 = now()
      if (!work || work.w !== size || work.h !== size) work = createRaster(size, size)
      renderTile(work, ti, tj, step, art, clearing)
      const surface = deps.createSurface(size, size)
      surface.put(work.data)
      const sig = tileSignature(ti, tj, step, clearing)
      lastCost = Math.max(0, now() - s0)
      count += 1
      rendered += 1
      return { surface, sig }
    }

    // Ступень, на которой графика сцены ничего не даёт («Бумага» на обзоре): плиток нет вовсе.
    const blankStep = tilesBlank(art, step.lod)
    const visible: Array<{ ti: number; tj: number }> = []
    if (!blankStep) {
      for (let tj = range.tj0; tj <= range.tj1; tj++) for (let ti = range.ti0; ti <= range.ti1; ti++) visible.push({ ti, tj })
    }
    const visibleKeys = new Set<string>()
    const placed: Placed[] = []
    let usedPx = 0
    for (const { ti, tj } of byCenter(visible)) {
      const key = keyOf(ti, tj)
      visibleKeys.add(key)
      const o = tileOrigin(step, device, ti, tj)
      let entry = store.get(key, frameNo)
      if (!entry) {
        if (!allow()) {
          pending = true
          continue
        }
        const r = renderOne(ti, tj)
        store.put({ key, surface: r.surface, pixels: tilePx, sig: r.sig, rev: clearRev }, frameNo)
        entry = store.get(key, frameNo)
        tilesChanged = true
      } else if (entry.rev !== clearRev) {
        const sig = tileSignature(ti, tj, step, clearing)
        // Растворение — только для плитки, которая была на экране: прежний лес плитки из кэша (другая ступень,
        // давний участок) показывать нельзя ни на кадр.
        const wasShown = shown.has(key)
        if (sig === entry.sig) {
          entry.rev = clearRev
        } else if (allow()) {
          const r = renderOne(ti, tj)
          const old = store.put({ key, surface: r.surface, pixels: tilePx, sig: r.sig, rev: clearRev }, frameNo)
          const prevFade = fades.get(key)
          if (prevFade) {
            prevFade.old.release()
            fades.delete(key)
          }
          if (old) {
            if (animate && wasShown) fades.set(key, { key, ti, tj, stepKey: step.key, old, t0: frame.time })
            else old.release()
          }
          entry = store.get(key, frameNo)
          tilesChanged = true
        } else {
          pending = true
          // Бывшая на экране остаётся как есть до следующего кадра; невиденная не выводится (пустая земля лучше
          // неверного леса), как и ещё не нарисованная.
          if (!wasShown) continue
        }
      }
      if (entry) {
        usedPx += entry.pixels
        placed.push({ key, x: o.x, y: o.y, surface: entry.surface })
      }
    }

    // Растворения плиток, ушедших с экрана или со ступени, завершаются сразу.
    for (const f of [...fades.values()]) {
      if (!visibleKeys.has(f.key)) {
        f.old.release()
        fades.delete(f.key)
        tilesChanged = true
      }
    }

    // Запас-кольцо в одну плитку вокруг экрана: при сдвиге новый ряд уже готов. Кольцо держится в кэше (get),
    // но не сводится; недостающие рисуются, только если вместе с видимыми укладываются в предел памяти.
    const ring: Array<{ ti: number; tj: number }> = []
    for (let tj = range.tj0 - 1; tj <= range.tj1 + 1 && !blankStep; tj++) {
      for (let ti = range.ti0 - 1; ti <= range.ti1 + 1; ti++) {
        if (ti >= range.ti0 && ti <= range.ti1 && tj >= range.tj0 && tj <= range.tj1) continue
        ring.push({ ti, tj })
      }
    }
    const ringTodo: Array<{ ti: number; tj: number; stale: boolean }> = []
    let ringMissing = 0
    for (const t of byCenter(ring)) {
      const key = keyOf(t.ti, t.tj)
      const seen = store.peek(key)
      if (!seen) {
        ringMissing += 1
        ringTodo.push({ ti: t.ti, tj: t.tj, stale: false })
        continue
      }
      // Кольцо держится только в пределе памяти (ближние к центру — первыми): лишние, например бывшие видимые
      // после сдвига, не помечаются, и trim их вытесняет.
      if (usedPx + seen.pixels > AMBIENT_TILE_MAX_PX) continue
      const entry = store.get(key, frameNo)!
      usedPx += entry.pixels
      if (entry.rev !== clearRev) {
        if (tileSignature(t.ti, t.tj, step, clearing) === entry.sig) entry.rev = clearRev
        else ringTodo.push({ ti: t.ti, tj: t.tj, stale: true })
      }
    }
    if (!pending && ringTodo.length > 0) {
      const fits = usedPx + ringMissing * tilePx <= AMBIENT_TILE_MAX_PX
      for (const t of ringTodo) {
        // Устаревшая плитка кольца перерисовывается без растворения (её нет на экране) и памяти не добавляет.
        if (!t.stale && !fits) continue
        if (!allow()) {
          pending = true
          break
        }
        const key = keyOf(t.ti, t.tj)
        const r = renderOne(t.ti, t.tj)
        const old = store.put({ key, surface: r.surface, pixels: tilePx, sig: r.sig, rev: clearRev }, frameNo)
        if (old) old.release()
      }
    }
    store.trim(frameNo)

    // 6. Эффекты: растры четырёх пар plane × anchor.
    const nextFxKey = animate ? `${scene}:${dark ? 1 : 0}:${zoom}` : null
    if (nextFxKey !== fxKey) {
      fxKey = nextFxKey
      fxList = animate ? deps.effects(scene, dark, zoom) : []
    }
    const win = deps.windowSize?.() ?? null
    const fx = effectUnit(
      W,
      H,
      dpr,
      win ? { W: Math.round(win.width * (dpr > 0 ? dpr : 1)), H: Math.round(win.height * (dpr > 0 ? dpr : 1)) } : undefined,
    )
    let underChanged = false
    let overChanged = false
    const k = device.k
    let effectFrame: EffectFrame | null = null
    const makeFrame = (): EffectFrame => {
      const { ox, oy } = device
      const e = fx.e
      const m = FX_BOUNDS_MARGIN * (dpr > 0 ? dpr : 1)
      const bounds: Bounds = { minX: (-m - ox) / k, minY: (-m - oy) / k, maxX: (W + m - ox) / k, maxY: (H + m - oy) / k }
      const near = frame.points ? clearing.near : frame.nodeNear
      return {
        t: fxT,
        w: fx.w,
        h: fx.h,
        e,
        dark,
        zoom,
        ax: (wx) => (ox + wx * k) / e,
        ay: (wy) => (oy + wy * k) / e,
        wx: (ax) => ((ax + 0.5) * e - ox) / k,
        wy: (ay) => ((ay + 0.5) * e - oy) / k,
        bounds,
        near,
      }
    }
    for (const { plane, anchor } of PAIRS) {
      const id = `${plane}:${anchor}`
      const effs = fxList.filter((f) => f.plane === plane && f.anchor === anchor)
      let pair = pairs.get(id)
      let redraw = Boolean(tick)
      if (effs.length === 0 || fx.w === 0 || fx.h === 0) {
        if (pair) {
          pair.surface.release()
          pairs.delete(id)
          if (plane === 'under') underChanged = true
          else overChanged = true
        }
        continue
      }
      if (!pair || pair.raster.w !== fx.w || pair.raster.h !== fx.h || pair.e !== fx.e) {
        if (pair) pair.surface.release()
        pair = {
          raster: createRaster(fx.w, fx.h),
          surface: deps.createSurface(fx.w, fx.h),
          e: fx.e,
          effects: effs,
          ox: device.ox,
          oy: device.oy,
          k,
        }
        pairs.set(id, pair)
        redraw = true
      }
      if (!sameList(pair.effects, effs)) {
        pair.effects = effs
        redraw = true
      }
      // Растр world рисован при другом k: сдвиг его уже не совместит с миром.
      if (anchor === 'world' && pair.k !== k) redraw = true
      if (redraw) {
        effectFrame ??= makeFrame()
        clearRaster(pair.raster)
        for (const eff of effs) eff.draw(pair.raster, effectFrame)
        pair.surface.put(pair.raster.data)
        pair.ox = device.ox
        pair.oy = device.oy
        pair.k = k
        if (plane === 'under') underChanged = true
        else overChanged = true
      }
    }

    const drawPair = (ctx: CanvasRenderingContext2D, id: string) => {
      const p = pairs.get(id)
      if (!p) return
      const dx = id.endsWith(':world') ? device.ox - p.ox : 0
      const dy = id.endsWith(':world') ? device.oy - p.oy : 0
      ctx.drawImage(p.surface.source, 0, 0, p.raster.w, p.raster.h, dx, dy, p.raster.w * p.e, p.raster.h * p.e)
    }

    // 7. Сведение back.
    const nextBackKey = `${W}x${H}|${device.ox},${device.oy}|${step.key}|${artKey}`
    if (nextBackKey !== backKey || tilesChanged || fades.size > 0 || underChanged) {
      const hasUnder = pairs.has('under:screen') || pairs.has('under:world')
      if (placed.length > 0 || hasUnder || backPainted) {
        back.clearRect(0, 0, W, H)
        const D = size * step.u
        for (const t of placed) {
          const f = fades.get(t.key)
          if (!f) {
            back.drawImage(t.surface.source, 0, 0, size, size, t.x, t.y, D, D)
            continue
          }
          const p = Math.min(1, Math.max(0, Math.ceil((3 * (frame.time - f.t0)) / AMBIENT_FADE_MS) / 3))
          if (p >= 1) {
            f.old.release()
            fades.delete(f.key)
            back.drawImage(t.surface.source, 0, 0, size, size, t.x, t.y, D, D)
            continue
          }
          // Линейное смешение: 'lighter' складывает (1 − p)·старая + p·новая — общие объекты не просвечивают.
          back.globalAlpha = 1 - p
          back.drawImage(f.old.source, 0, 0, size, size, t.x, t.y, D, D)
          back.globalCompositeOperation = 'lighter'
          back.globalAlpha = p
          back.drawImage(t.surface.source, 0, 0, size, size, t.x, t.y, D, D)
          back.globalCompositeOperation = 'source-over'
          back.globalAlpha = 1
        }
        drawPair(back, 'under:screen')
        drawPair(back, 'under:world')
        backPainted = placed.length > 0 || hasUnder
      }
      backKey = nextBackKey
      shown = new Set(placed.map((t) => t.key))
    }

    // 8. Сведение front.
    const hasOverWorld = pairs.has('over:world')
    const nextFrontKey = `${W}x${H}` + (hasOverWorld ? `|${device.ox},${device.oy}` : '')
    if (nextFrontKey !== frontKey || overChanged) {
      const hasOver = pairs.has('over:screen') || hasOverWorld
      if (hasOver || frontPainted) {
        front.clearRect(0, 0, W, H)
        drawPair(front, 'over:screen')
        drawPair(front, 'over:world')
        frontPainted = hasOver
      }
      frontKey = nextFrontKey
    }

    // 9. Планировщик и дорисовка.
    scheduler.setRunning(animate && (fxList.length > 0 || fades.size > 0))
    if (pending) deps.requestFrame()
  }

  const configure = (next: { scene: AmbientScene; animate: boolean }) => {
    if (disposed) return
    const prev = cfg
    cfg = { scene: next.scene, animate: next.animate }
    if (prev && prev.scene === next.scene && prev.animate === next.animate) return
    if (!prev || prev.scene !== next.scene) {
      // Другая сцена — другая графика и плитки: прежние не понадобятся.
      artCache.clear()
      releaseFades()
      store.clear()
      fxKey = null
      backKey = null
      frontKey = null
    }
    if (!next.animate) {
      scheduler.setRunning(false)
      releaseFades()
      releasePairs()
      fxKey = null
      fxList = []
      backKey = null
      frontKey = null
    }
  }

  const reset = () => {
    if (disposed || lost) return
    lost = true
    deps.requestFrame()
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    scheduler.setRunning(false)
    releaseFades()
    releasePairs()
    store.clear()
    artCache.clear()
    work = null
  }

  const stats = (): AmbientStats => ({ tiles: store.size, tilePixels: store.pixels, rendered, ticks })

  return { draw, configure, reset, dispose, stats }
}
