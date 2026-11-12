import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GraphOverlayProps } from '@/components/graph/GraphOverlay'
import { estimateTextWidth, labelBoxWidth, overlayViewport } from '@/components/graph/overlayGeometry'
import { GRAPH_NODE_SIZE } from '@/lib/graphLayout'
import { visibleBounds } from '@/lib/graph/geometry'
import { GRAPH_LABEL_GAP, pickLabels } from '@/lib/graph/labels'
import { subscribeGraphTheme } from '@/lib/graph/theme'
import { useGraph } from '@/store/graph'
import { useUi } from '@/store/ui'

/** Пока граф двигают, набор подписей не пересчитывается; после последнего движения — с этой задержкой. */
const REPICK_DELAY_MS = 120
/** Сколько соседей выбранной ноды получают подпись на плашке. */
const NEIGHBOR_LIMIT = 24

/** Сдвиг контейнера подписей: ровно столько, на сколько камера уводит мир от центра сцены (целые пиксели). */
function translateOf(camera: { x: number; y: number; zoom: number }, size: { width: number; height: number }): string {
  const tx = Math.round(size.width / 2 - camera.x * camera.zoom)
  const ty = Math.round(size.height / 2 - camera.y * camera.zoom)
  return `translate(${tx}px, ${ty}px)`
}

/** Шрифт подписи, как его видит браузер: для измерения ширины. */
interface LabelFont {
  /** Значение для canvas.font; пусто — canvas недоступен, ширина оценивается по кеглю. */
  font: string
  size: number
  /** Разрядка между знаками, px (в «Мягком» пиксельном шрифте .07em). */
  spacing: number
}

function readLabelFont(el: HTMLElement): LabelFont {
  const cs = getComputedStyle(el)
  const size = parseFloat(cs.fontSize)
  const spacing = parseFloat(cs.letterSpacing)
  // Вес подписи в пиксельных сценах задаёт .px-graph-label через --fw-m; у контейнера он другой.
  const root = document.documentElement
  const fw = root.classList.contains('pixel') ? getComputedStyle(root).getPropertyValue('--fw-m').trim() : ''
  const weight = fw || cs.fontWeight
  return {
    font: Number.isFinite(size) ? `${weight} ${size}px ${cs.fontFamily}` : '',
    size: Number.isFinite(size) ? size : 12,
    spacing: Number.isFinite(spacing) ? spacing : 0,
  }
}

/** Ширина подписи по реальному шрифту; без canvas — оценка по кеглю. Кеш по строке сбрасывается вместе со шрифтом. */
function makeMeasure(f: LabelFont): (text: string) => number {
  let ctx: CanvasRenderingContext2D | null = null
  try {
    if (f.font && typeof document !== 'undefined') {
      ctx = document.createElement('canvas').getContext('2d')
      if (ctx) ctx.font = f.font
    }
  } catch {
    ctx = null
  }
  const cache = new Map<string, number>()
  return (text) => {
    const hit = cache.get(text)
    if (hit !== undefined) return hit
    const width = labelBoxWidth(ctx ? ctx.measureText(text).width : estimateTextWidth(text.length, f.size), text.length, f.spacing)
    if (cache.size > 5000) cache.clear()
    cache.set(text, width)
    return width
  }
}

export function GraphLabels({ scene }: GraphOverlayProps) {
  // Масштаб и размер сцены — реактивно; положение камеры — нет: на каждый кадр сдвига React не перерисовывается.
  const zoom = useGraph((s) => s.camera.zoom)
  const width = useGraph((s) => s.viewSize.width)
  const height = useGraph((s) => s.viewSize.height)
  const selectedId = useUi((s) => s.selectedId)
  // Счётчик пересчёта после сдвига (подписи у новых краёв экрана).
  const [panTick, setPanTick] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  // Шрифт подписи зависит от темы шрифтов («Мягкий» и «Пиксельный» шире и выше базового): пересчёт при смене класса <html>.
  const [labelFont, setLabelFont] = useState<LabelFont | null>(null)
  const measure = useMemo(() => (labelFont ? makeMeasure(labelFont) : undefined), [labelFont])

  const labels = useMemo(() => {
    if (!(width > 0) || !(height > 0)) return []
    const { camera } = useGraph.getState()
    const v = overlayViewport(camera, { width, height })
    // Запас в пол-экрана с каждой стороны: небольшой сдвиг не оставляет края без подписей.
    const area = visibleBounds(v, Math.max(width, height) / 2)
    const priority: string[] = []
    if (selectedId !== null) {
      const si = scene.byId.get(selectedId)
      if (si !== undefined) {
        priority.push(selectedId)
        for (const j of scene.nodes[si].links.slice(0, NEIGHBOR_LIMIT)) priority.push(scene.nodes[j].id)
      }
    }
    // core — видимая часть без запаса: предел подписей тратится сначала на ноды, которые на экране.
    return pickLabels(scene, area, zoom, priority, { core: visibleBounds(v), measure })
    // panTick — намеренная зависимость: камера читается из стора, а не из замыкания.
  }, [scene, zoom, width, height, selectedId, panTick, measure])

  useLayoutEffect(() => {
    const read = () => {
      const el = boxRef.current
      if (!el) return
      const next = readLabelFont(el)
      setLabelFont((p) => (p && p.font === next.font && p.spacing === next.spacing ? p : next))
    }
    read()
    const off = subscribeGraphTheme(read)
    // Шрифт мог загрузиться после первой вёрстки: измеренная ширина тогда была бы от запасного.
    void document.fonts?.ready.then(read)
    return off
  }, [])

  // Сдвиг — только transform контейнера, без React. Каждый коммит тоже его выставляет (смена масштаба и размера).
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const s = useGraph.getState()
    el.style.transform = translateOf(s.camera, s.viewSize)
  })

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let lastX = useGraph.getState().camera.x
    let lastY = useGraph.getState().camera.y
    let lastCamera = useGraph.getState().camera
    let lastSize = useGraph.getState().viewSize
    const unsubscribe = useGraph.subscribe((s) => {
      // Стор меняется и от наведения, и от жестов: сдвиг пересчитывается только при смене камеры или размера.
      if (s.camera === lastCamera && s.viewSize === lastSize) return
      lastCamera = s.camera
      lastSize = s.viewSize
      const el = boxRef.current
      if (!el) return
      el.style.transform = translateOf(s.camera, s.viewSize)
      if (s.camera.x === lastX && s.camera.y === lastY) return
      lastX = s.camera.x
      lastY = s.camera.y
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        setPanTick((n) => n + 1)
      }, REPICK_DELAY_MS)
    })
    return () => {
      unsubscribe()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])

  const half = (GRAPH_NODE_SIZE * zoom) / 2
  return (
    <div ref={boxRef} aria-hidden className="absolute top-0 left-0 text-xs will-change-transform">
      {labels.map((l) => (
        <span
          key={l.id}
          data-plate={l.plate ? 'true' : undefined}
          className="px-graph-label absolute block max-w-40 -translate-y-1/2 truncate rounded bg-background/85 px-1 leading-4 whitespace-nowrap pixel:py-0.5 text-foreground data-[plate=true]:bg-popover data-[plate=true]:ring-1 data-[plate=true]:ring-border"
          style={{ left: Math.round(l.x * zoom + half + GRAPH_LABEL_GAP), top: Math.round(l.y * zoom) }}
        >
          {l.text}
        </span>
      ))}
    </div>
  )
}
