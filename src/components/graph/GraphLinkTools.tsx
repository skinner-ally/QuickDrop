import { useEffect } from 'react'
import { focusGraphStage, useMeasuredSize } from '@/components/graph/GraphTooltip'
import type { GraphOverlayProps } from '@/components/graph/GraphOverlay'
import { HANDLE_SIZE, handleBox, handleVisible, overlayViewport, placeBox } from '@/components/graph/overlayGeometry'
import { Icon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { actUnlinkItems } from '@/lib/actions'
import { GRAPH_NODE_SIZE } from '@/lib/graphLayout'
import { worldToScreen } from '@/lib/graph/geometry'
import { useGraph } from '@/store/graph'
import { useUi } from '@/store/ui'

const HANDLE_LABEL = 'Связать: потяните к другой записи или нажмите'

/** Ручка связи у выбранной ноды, строка режима связи и плашка выбранной связи. */
export function GraphLinkTools(props: GraphOverlayProps) {
  return (
    <>
      <LinkHandle {...props} />
      <LinkModeBar {...props} />
      <LinkPlate {...props} />
    </>
  )
}

// ───────── ручка ─────────

function LinkHandle(props: GraphOverlayProps) {
  const selectedId = useUi((s) => s.selectedId)
  // Ручка — только в окне от 1100 px, где детали идут боковой панелью: ниже они открываются модальным листом, а
  // колонка со сценой становится inert (ручка была бы видна, но недоступна). Там связь — через меню записи,
  // Shift+перетаскивание и L. На касании ручки тоже нет: связь — удержанием записи и «Связать с…» (как в GraphHint).
  const wide = useMediaQuery('(min-width: 1100px)')
  const coarse = useMediaQuery('(pointer: coarse)')
  // Во время жеста и на мелком масштабе ручки нет; на кадр сдвига этот компонент не перерисовывается по камере.
  const visible = useGraph((s) => handleVisible({ wide, coarse, dragging: s.drag !== null, zoom: s.camera.zoom }))
  if (!visible || selectedId === null || !props.scene.byId.has(selectedId)) return null
  return <HandleBox {...props} id={selectedId} />
}

function HandleBox({ scene, id }: GraphOverlayProps & { id: string }) {
  const camera = useGraph((s) => s.camera)
  const viewSize = useGraph((s) => s.viewSize)
  const linking = useGraph((s) => s.linkFrom === id)
  const [ref, size] = useMeasuredSize<HTMLDivElement>()

  const node = scene.nodes[scene.byId.get(id) ?? -1]
  if (!node) return null

  const c = worldToScreen(overlayViewport(camera, viewSize), { x: node.x, y: node.y })
  const half = (GRAPH_NODE_SIZE * camera.zoom) / 2
  // У угла ноды снаружи, а не под ней: под нодой и сбоку стоят соседи по сетке, ручка их закрывала (клик по
  // соседке включал режим связи), а по центру закрывала бы саму ноду. Нода за краем сцены — ручки нет.
  const pos = handleBox(c, half, size, viewSize)
  if (!pos) return null
  const { left, top } = pos

  return (
    <div ref={ref} className="pointer-events-none absolute z-10" style={{ left, top }}>
      <button
        type="button"
        data-graph-handle={id}
        aria-label={HANDLE_LABEL}
        title={HANDLE_LABEL}
        aria-pressed={linking}
        onClick={() => {
          const s = useGraph.getState()
          s.setLinkFrom(s.linkFrom === id ? null : id)
        }}
        style={{ width: HANDLE_SIZE, height: HANDLE_SIZE }}
        className="px-btn pointer-events-auto flex cursor-pointer items-center justify-center rounded-full border bg-background text-foreground shadow-sm outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/60 aria-pressed:bg-accent aria-pressed:text-accent-foreground"
      >
        <Icon name="link" size={12} pixelSize={16} />
      </button>
    </div>
  )
}

// ───────── режим связи ─────────

function LinkModeBar({ scene }: GraphOverlayProps) {
  const linkFrom = useGraph((s) => s.linkFrom)
  const node = linkFrom !== null ? scene.nodes[scene.byId.get(linkFrom) ?? -1] : undefined
  if (!node) return null

  return (
    <div
      data-graph-ui
      // Диктору режим объявляет живая строка GraphA11y; своя role="status" здесь говорила бы то же второй раз.
      className="pointer-events-auto absolute top-2 left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 px-pop rounded-lg border bg-popover py-1 pr-1 pl-3 text-2sm text-popover-foreground shadow-md"
    >
      <span className="flex min-w-0 items-baseline">
        <span className="shrink-0">Связать «</span>
        <span className="min-w-0 truncate">{node.title}</span>
        <span className="shrink-0">» — выберите вторую запись</span>
      </span>
      <Button
        variant="outline"
        size="xs"
        className="shrink-0 pointer-coarse:h-9 pointer-coarse:px-3"
        onClick={() => {
          useGraph.getState().setLinkFrom(null)
          focusGraphStage()
        }}
      >
        Отмена
      </Button>
    </div>
  )
}

// ───────── плашка выбранной связи ─────────

function LinkPlate(props: GraphOverlayProps) {
  const link = useGraph((s) => s.selectedLink)
  const { scene } = props
  const ia = link ? scene.byId.get(link.a) : undefined
  const ib = link ? scene.byId.get(link.b) : undefined
  const missing = link !== null && (ia === undefined || ib === undefined)

  // Один из концов исчез из сцены (удалён, архив скрыт) — связь больше не выбрана.
  useEffect(() => {
    if (missing) useGraph.getState().selectLink(null)
  }, [missing])

  if (!link || ia === undefined || ib === undefined) return null
  return <PlateBox {...props} a={link.a} b={link.b} x={link.x} y={link.y} titleA={scene.nodes[ia].title} titleB={scene.nodes[ib].title} />
}

function PlateBox({
  a,
  b,
  x,
  y,
  titleA,
  titleB,
}: GraphOverlayProps & { a: string; b: string; x: number; y: number; titleA: string; titleB: string }) {
  const camera = useGraph((s) => s.camera)
  const viewSize = useGraph((s) => s.viewSize)
  const [ref, size] = useMeasuredSize<HTMLDivElement>()

  // Клик вне плашки снимает выбор связи.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const box = ref.current
      if (box && e.target instanceof Node && box.contains(e.target)) return
      useGraph.getState().selectLink(null)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [ref])

  const c = worldToScreen(overlayViewport(camera, viewSize), { x, y })
  const gap = 10
  const { left, top } = placeBox({ x: c.x + gap, y: c.y + gap }, size, viewSize, { flipX: c.x - gap, flipY: c.y - gap })

  return (
    <div
      ref={ref}
      data-graph-ui
      className="pointer-events-auto absolute z-20 flex w-max max-w-64 flex-col gap-1.5 px-pop rounded-lg border bg-popover p-2 text-xs text-popover-foreground shadow-md"
      style={{ left, top }}
    >
      <div className="flex min-w-0 items-baseline gap-1">
        <span className="min-w-0 truncate">{titleA}</span>
        <span aria-hidden className="shrink-0 text-muted-foreground">
          —
        </span>
        <span className="min-w-0 truncate">{titleB}</span>
      </div>
      <Button
        variant="outline"
        size="xs"
        className="pointer-coarse:h-9 pointer-coarse:px-3"
        onClick={() => {
          void actUnlinkItems(a, b)
          useGraph.getState().selectLink(null)
          focusGraphStage()
        }}
      >
        <Icon name="unlink" size={14} pixelSize={16} />
        Убрать связь
      </Button>
    </div>
  )
}
