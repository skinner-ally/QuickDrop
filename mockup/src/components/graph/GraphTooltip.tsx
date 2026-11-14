import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { GraphOverlayProps } from '@/components/graph/GraphOverlay'
import { nodeOffScene, overlayViewport, placeBox, tooltipTarget, type Box } from '@/components/graph/overlayGeometry'
import { catColorVar } from '@/components/items/categoryColor'
import { TYPE_LABEL } from '@/lib/itemTitle'
import { GRAPH_NODE_SIZE } from '@/lib/graphLayout'
import { worldToScreen } from '@/lib/graph/geometry'
import { useGraph } from '@/store/graph'
import { useUi } from '@/store/ui'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import type { ItemStatus } from '@/types'

// Геометрия вынесена в overlayGeometry.ts (чистые функции под тесты); соседние файлы пакета импортируют её отсюда.
export { overlayViewport, placeBox }
export type { Box }

// ───────── общие помощники DOM-слоя графа (их импортируют соседние файлы пакета) ─────────

export const STATUS_LABEL: Record<ItemStatus, string> = {
  inbox: 'Входящие',
  library: 'База знаний',
  archive: 'Архив',
}

/** Фокус возвращается на сцену графа: детали, меню и выбор категории закрываются, клавиши графа продолжают работать. */
export function focusGraphStage(): void {
  if (typeof document === 'undefined') return
  document.querySelector<HTMLElement>('[data-graph-stage]')?.focus({ preventScroll: true })
}

/** Размер элемента после вёрстки (до отрисовки кадра): коробку нужно знать, чтобы не выпустить её за сцену. */
export function useMeasuredSize<T extends HTMLElement>(): [RefObject<T | null>, Box] {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState<Box>({ w: 0, h: 0 })
  // Без списка зависимостей: размер может смениться от любой перерисовки; setState — только при изменении.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    setSize((p) => (p.w === w && p.h === h ? p : { w, h }))
  })
  return [ref, size]
}

// ───────── подсказка наведённой ноды ─────────

const TOOLTIP_DELAY_MS = 250
const MAX_TAGS = 4

export function GraphTooltip(props: GraphOverlayProps) {
  const hoveredId = useGraph((s) => s.hoveredId)
  const cursorId = useGraph((s) => s.cursorId)
  const byKeys = useGraph((s) => s.cursorByKeys)
  const selectedId = useUi((s) => s.selectedId)
  // Касанием курсор не ведут: после закрытия листа подсказка у ноды висела бы без причины.
  const coarse = useMediaQuery('(pointer: coarse)')
  // Во время жеста, при открытом меню и выборе категории подсказки нет.
  const blocked = useGraph((s) => s.drag !== null || s.menu !== null || s.pickerFor !== null)
  const [shownId, setShownId] = useState<string | null>(null)

  useEffect(() => {
    if (!hoveredId || blocked) return
    const t = setTimeout(() => setShownId(hoveredId), TOOLTIP_DELAY_MS)
    return () => {
      clearTimeout(t)
      setShownId(null)
    }
  }, [hoveredId, blocked])

  const targetId = blocked ? null : tooltipTarget({ hoveredId, shownId, cursorId, selectedId, coarse, byKeys })
  if (targetId === null) return null
  return <TooltipBox {...props} id={targetId} />
}

function TooltipBox({ scene, items, categories, id }: GraphOverlayProps & { id: string }) {
  // Камера читается только здесь: пока подсказки нет, сдвиг графа этот компонент не перерисовывает.
  const camera = useGraph((s) => s.camera)
  const viewSize = useGraph((s) => s.viewSize)
  const [ref, size] = useMeasuredSize<HTMLDivElement>()

  const index = scene.byId.get(id)
  const node = index === undefined ? undefined : scene.nodes[index]
  const item = items.get(id)
  if (!node || !item) return null

  const v = overlayViewport(camera, viewSize)
  const c = worldToScreen(v, { x: node.x, y: node.y })
  const half = (GRAPH_NODE_SIZE * camera.zoom) / 2
  // Нода под курсором клавиатуры может быть за краем сцены: подсказка у края без ноды только сбивает.
  if (nodeOffScene(c, half, viewSize)) return null
  const gap = 8
  // Справа-снизу от ноды; у края сцены — слева и выше ноды.
  const { left, top } = placeBox(
    { x: c.x + half + gap, y: c.y + half + gap },
    size,
    viewSize,
    { flipX: c.x - half - gap, flipY: c.y - half - gap },
  )
  const category = item.categoryId ? categories.find((k) => k.id === item.categoryId) : undefined
  const tags = item.tags.slice(0, MAX_TAGS)

  return (
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none absolute z-10 w-max max-w-60 px-pop rounded-lg border bg-popover p-2 text-xs text-popover-foreground shadow-md"
      style={{ left, top }}
    >
      <div className="line-clamp-2 text-2sm font-medium break-words">{node.title}</div>
      <div className="mt-0.5 text-muted-foreground">
        {TYPE_LABEL[item.type]} · {STATUS_LABEL[item.status]}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span aria-hidden className="px-sw inline-block size-2 shrink-0 rounded-full pixel:size-2.5" style={{ background: catColorVar(category?.color) }} />
        <span className="min-w-0 truncate">{category ? category.name : 'Без категории'}</span>
      </div>
      {tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-1.5 text-muted-foreground">
          {tags.map((t) => (
            <span key={t} className="max-w-full truncate">
              #{t}
            </span>
          ))}
        </div>
      )}
      <div className="mt-1 text-muted-foreground">Связей: {node.links.length}</div>
    </div>
  )
}
