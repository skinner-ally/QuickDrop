import { useEffect, useRef, type RefObject } from 'react'
import { getSwarm, shownScene, subscribeSwarm } from '@/components/graph/swarmDriver'
import { bitmapSize, clearRect32, resizeKeep, type StageRect } from '@/components/graph/gestureLogic'
import { getAmbientLayer, subscribeAmbient } from '@/lib/graph/ambient'
import { useSmite } from '@/lib/graph/smite'
import { drawLinksClassic, drawLinksPixel, drawNodes, drawSwarmTrails, type DirtyRect, type LinkBuffer } from '@/lib/graph/draw'
import { deviceTransform, queryBounds, screenToWorld } from '@/lib/graph/geometry'
import { readGraphTheme, subscribeGraphTheme } from '@/lib/graph/theme'
import type { DrawState, GraphScene, GraphTheme, GraphViewport } from '@/lib/graph/types'
import { useGraph } from '@/store/graph'
import { useUi } from '@/store/ui'

/**
 * Сиюминутное состояние жеста, общее для холста, жестов и клавиш. Живёт вне React: перетаскивание и наведение
 * на связь меняются на каждое движение указателя, а перерисовываться должен только canvas.
 */
export interface GraphLive {
  /** Перетаскиваемая нода (мир) и клетка, куда она встанет. */
  drag: DrawState['drag']
  /** Протягиваемая связь. */
  tempLink: DrawState['tempLink']
  /** Связь под указателем мыши. */
  hoverLink: { a: string; b: string } | null
  /** Указатель мыши над сценой, CSS-пиксели сцены (для протяжки в режиме связи); null — вне сцены. */
  pointer: { x: number; y: number } | null
  /** Попросить кадр (ставит холст). */
  invalidate: () => void
  /** Отменить идущий жест (ставят жесты); true — жест был. */
  cancel: () => boolean
}

export function createGraphLive(): GraphLive {
  return {
    drag: null,
    tempLink: null,
    hoverLink: null,
    pointer: null,
    invalidate: () => {},
    cancel: () => false,
  }
}

export interface GraphCanvasProps {
  scene: GraphScene
  stageRef: RefObject<HTMLDivElement | null>
  live: GraphLive
}

type Size = { cssW: number; cssH: number; dpr: number; W: number; H: number }

function currentDpr(): number {
  const d = typeof window === 'undefined' ? 1 : window.devicePixelRatio
  return Number.isFinite(d) && d > 0 ? d : 1
}

/**
 * Три canvas сцены: back (живой фон под нодами: плитки леса, листопад), main (связи и ноды), front (фон поверх нод:
 * лучи, снег, бабочки, светлячки). Рисование — только по запросу, постоянного цикла нет. Два повода кадра:
 * invalidate() — граф и фон (камера, сцена, размер, тема, смена слоя); invalidateAmbient() — только кадр фона
 * (тик эффектов, дорисовка плиток): граф по нему не перерисовывается. Оба ставят один requestAnimationFrame.
 * React перерисовывает компонент лишь при смене сцены.
 * Замеры в data-атрибутах сцены: drawMs — только граф, ambientMs — только слой; ambientTiles/Ticks/Rendered — счётчики
 * слоя (приёмка этапа 6).
 */
export function GraphCanvas({ scene, stageRef, live }: GraphCanvasProps) {
  const backRef = useRef<HTMLCanvasElement>(null)
  const mainRef = useRef<HTMLCanvasElement>(null)
  const frontRef = useRef<HTMLCanvasElement>(null)
  const sceneRef = useRef(scene)
  const invalidateRef = useRef<() => void>(() => {})

  useEffect(() => {
    const stage = stageRef.current
    const main = mainRef.current
    const back = backRef.current
    const front = frontRef.current
    if (!stage || !main || !back || !front) return
    const ctx = main.getContext('2d')
    if (!ctx) return

    let size: Size = { cssW: 0, cssH: 0, dpr: currentDpr(), W: 0, H: 0 }
    // Буфер связей пиксельных сцен — лениво, в первом пиксельном кадре: «Классике» он не нужен.
    let image: ImageData | null = null
    let buf: LinkBuffer | null = null
    // Рамка пикселей, записанных в буфер прошлым кадром: обнуляется и выгружается только она.
    let prevDirty: DirtyRect | null = null
    // Рамка сцены в окне при прошлом замере: по сдвигу её краёв камера подстраивается так, что граф не уезжает.
    let stageRect: StageRect | null = null
    let theme: GraphTheme | null = null
    let themeDirty = true
    let raf = 0
    let disposed = false
    // Фоновые canvas измеряются, только пока слой этапа 6 подключён.
    let ambientSized = false
    // Граф нужно перерисовать (иначе кадр только для фона).
    let graphDirty = true
    // Ревизия сцены для слоя: растёт при смене sceneRef.current по ссылке.
    let lastScene: GraphScene | null = null
    let sceneRev = 0
    let lastV: GraphViewport | null = null

    /** Новый размер сцены. true — растр холста сброшен: кадр нужно нарисовать до вывода, иначе он мигнёт пустым. */
    const resize = (cssW: number, cssH: number, device?: { inlineSize: number; blockSize: number }): boolean => {
      const dpr = currentDpr()
      const { W, H } = bitmapSize(cssW, cssH, dpr, device)
      const r = stage.getBoundingClientRect()
      const rect: StageRect = { left: r.left + stage.clientLeft, top: r.top + stage.clientTop, width: cssW, height: cssH }
      const keep = resizeKeep(stageRect, rect)
      stageRect = rect
      size = { cssW, cssH, dpr, W, H }
      useGraph.getState().setViewSize(cssW, cssH, keep)
      // Растр трогается только при смене размера в пикселях: присваивание width очищает холст.
      if (main.width === W && main.height === H) return false
      main.width = W
      main.height = H
      image = null
      buf = null
      prevDirty = null
      if (ambientSized) sizeAmbient(true)
      return true
    }

    const sizeAmbient = (on: boolean) => {
      const W = on ? size.W : 0
      const H = on ? size.H : 0
      if (back.width !== W) back.width = W
      if (back.height !== H) back.height = H
      if (front.width !== W) front.width = W
      if (front.height !== H) front.height = H
      ambientSized = on
    }

    const clearAmbientStats = () => {
      delete stage.dataset.ambientMs
      delete stage.dataset.ambientTiles
      delete stage.dataset.ambientTicks
      delete stage.dataset.ambientRendered
    }

    const frame = () => {
      raf = 0
      if (disposed) return
      const t0 = performance.now()
      if (themeDirty) {
        theme = readGraphTheme(stage)
        themeDirty = false
      }
      const { W, H, cssW, cssH, dpr } = size
      // Ранний выход оставляет graphDirty: граф дорисуется в первом годном кадре.
      if (!theme || !(W > 0) || !(H > 0)) return
      const g = useGraph.getState()
      const sc = sceneRef.current
      if (sc !== lastScene) {
        lastScene = sc
        sceneRev += 1
      }
      // Кадр только для фона берёт прежний вид: камера между ними не менялась (её смена ставит graphDirty).
      const v: GraphViewport =
        !graphDirty && lastV && lastV.width === cssW && lastV.height === cssH && lastV.dpr === dpr && lastV.camera === g.camera
          ? lastV
          : { width: cssW, height: cssH, dpr, camera: g.camera }
      if (graphDirty) {
        graphDirty = false
        lastV = v
        // Ноды стаи рисуются в текущих положениях; слой фона видит сцену как есть (поляны не перестраиваются на кадр).
        drawGraph(shownScene(sc), v, g, W, H)
        stage.dataset.drawMs = (performance.now() - t0).toFixed(2)
      }

      const layer = getAmbientLayer()
      if (layer) {
        if (!ambientSized) sizeAmbient(true)
        const bctx = back.getContext('2d')
        const fctx = front.getContext('2d')
        if (bctx && fctx) {
          const a0 = performance.now()
          layer.draw(
            { back: bctx, front: fctx },
            {
              viewport: v,
              device: deviceTransform(v),
              pixel: theme.pixel,
              dark: document.documentElement.classList.contains('dark'),
              time: t0,
              nodeNear: (wx, wy, r) => {
                const hits = queryBounds(sc.index, sc.nodes, { minX: wx - r, minY: wy - r, maxX: wx + r, maxY: wy + r })
                for (const i of hits) if (Math.hypot(sc.nodes[i].x - wx, sc.nodes[i].y - wy) <= r) return true
                return false
              },
              sceneRev,
              points: sc.nodes,
            },
          )
          stage.dataset.ambientMs = (performance.now() - a0).toFixed(2)
          const st = layer.stats?.()
          if (st) {
            stage.dataset.ambientTiles = String(st.tiles)
            stage.dataset.ambientTicks = String(st.ticks)
            stage.dataset.ambientRendered = String(st.rendered)
          }
        }
      } else {
        if (ambientSized || back.width !== 0) sizeAmbient(false)
        if (stage.dataset.ambientMs !== undefined) clearAmbientStats()
      }
    }

    const drawGraph = (sc: GraphScene, v: GraphViewport, g: ReturnType<typeof useGraph.getState>, W: number, H: number) => {
      if (!theme) return

      // Режим связи с мыши: временная связь от выбранной ноды к указателю.
      let tempLink = live.tempLink
      if (!tempLink && g.linkFrom !== null && live.pointer && sc.byId.has(g.linkFrom)) {
        const p = screenToWorld({ ...v, dpr: 1 }, live.pointer)
        tempLink = { fromId: g.linkFrom, x: p.x, y: p.y, targetId: g.hoveredId !== g.linkFrom ? g.hoveredId : null }
      }
      const state: DrawState = {
        selectedId: useUi.getState().selectedId,
        hoveredId: g.hoveredId,
        cursorId: g.cursorId,
        hotLink: g.selectedLink ? { a: g.selectedLink.a, b: g.selectedLink.b } : live.hoverLink,
        drag: live.drag,
        tempLink,
      }

      ctx.imageSmoothingEnabled = false
      if (theme.pixel) {
        let img = image
        let b = buf
        if (!img || !b || img.width !== W || img.height !== H) {
          img = ctx.createImageData(W, H)
          b = { width: W, height: H, data: new Uint32Array(img.data.buffer) }
          image = img
          buf = b
          prevDirty = null
        }
        // Обнуляется и выгружается только рамка связей, а не весь буфер: на 4K при 150 % это 32 МБ на кадр.
        if (prevDirty) clearRect32(b.data, W, prevDirty)
        drawLinksPixel(b, sc, v, theme, state)
        ctx.clearRect(0, 0, W, H)
        const d = b.dirty
        if (d) ctx.putImageData(img, 0, 0, d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0)
        prevDirty = d ?? null
      } else {
        ctx.clearRect(0, 0, W, H)
        drawLinksClassic(ctx, sc, v, theme, state)
      }
      const swarm = getSwarm()
      if (swarm && !swarm.rigid) drawSwarmTrails(ctx, sc, v, theme, swarm.members)
      drawNodes(ctx, sc, v, theme, state)
    }

    function invalidateAmbient() {
      if (raf || disposed) return
      raf = requestAnimationFrame(frame)
    }
    function invalidate() {
      graphDirty = true
      invalidateAmbient()
    }
    invalidateRef.current = invalidate
    live.invalidate = invalidate

    // Размер: ResizeObserver на основном canvas (его коробка — внутренняя область сцены) с точным размером в
    // пикселях устройства; он же срабатывает при смене devicePixelRatio. Где device-pixel-content-box нет
    // (Safari), размер — round(css·dpr), а смену dpr ловит window.resize.
    let exact = false
    const ro = new ResizeObserver((entries) => {
      const e = entries[entries.length - 1]
      const r = e.contentRect
      const d = exact ? e.devicePixelContentBoxSize?.[0] : undefined
      if (resize(r.width, r.height, d ? { inlineSize: d.inlineSize, blockSize: d.blockSize } : undefined)) {
        // Колбэк идёт после вёрстки и до отрисовки кадра: рисуем сразу, rAF успел бы только к следующему кадру.
        if (raf) cancelAnimationFrame(raf)
        raf = 0
        graphDirty = true
        frame()
      } else {
        invalidate()
      }
    })
    try {
      ro.observe(main, { box: 'device-pixel-content-box' })
      exact = true
    } catch {
      ro.observe(main)
    }
    // Первый замер — той же коробки и с тем же дробным размером, что даст ResizeObserver: целый clientWidth,
    // за которым следует дробный contentRect, сдвигал бы камеру на доли пикселя при каждом входе в раздел.
    const r0 = main.getBoundingClientRect()
    resize(r0.width, r0.height)
    const onWindowResize = () => {
      if (exact || currentDpr() === size.dpr) return
      resize(size.cssW, size.cssH)
      invalidate()
    }
    window.addEventListener('resize', onWindowResize)

    const offTheme = subscribeGraphTheme(() => {
      themeDirty = true
      invalidate()
    })
    const offAmbient = subscribeAmbient((kind) => (kind === 'frame' ? invalidateAmbient() : invalidate()))

    // Перерисовка по смене того, что видно на холсте; React при этом не перерисовывается.
    const offGraph = useGraph.subscribe((s, p) => {
      if (
        s.camera !== p.camera ||
        s.hoveredId !== p.hoveredId ||
        s.cursorId !== p.cursorId ||
        s.selectedLink !== p.selectedLink ||
        s.linkFrom !== p.linkFrom ||
        s.drag !== p.drag
      ) {
        invalidate()
      }
    })
    // сцена казни прячет и возвращает ноды
    const offSmite = useSmite.subscribe((s, p) => {
      if (s.hidden !== p.hidden) invalidate()
    })
    const offSwarm = subscribeSwarm(() => invalidate())
    const offUi = useUi.subscribe((s, p) => {
      if (s.selectedId !== p.selectedId) invalidate()
    })

    invalidate()
    return () => {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      ro.disconnect()
      window.removeEventListener('resize', onWindowResize)
      offTheme()
      offAmbient()
      offGraph()
      offUi()
      offSmite()
      offSwarm()
      live.invalidate = () => {}
      invalidateRef.current = () => {}
      delete stage.dataset.drawMs
      clearAmbientStats()
      // Сцены нет: следующий замер (возврат в раздел) начнётся с нуля и не станет подстраивать камеру
      // от размера, который был до ухода.
      useGraph.getState().setViewSize(0, 0)
    }
  }, [stageRef, live])

  useEffect(() => {
    sceneRef.current = scene
    invalidateRef.current()
  }, [scene])

  return (
    <>
      <canvas ref={backRef} data-graph-ambient="back" aria-hidden width={0} height={0} className="pointer-events-none absolute inset-0 size-full" />
      <canvas ref={mainRef} data-graph-canvas aria-hidden className="absolute inset-0 size-full" />
      <canvas ref={frontRef} data-graph-ambient="front" aria-hidden width={0} height={0} className="pointer-events-none absolute inset-0 size-full" />
    </>
  )
}
