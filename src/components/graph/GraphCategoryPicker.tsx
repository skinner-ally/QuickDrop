import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { focusGraphStage, overlayViewport, placeBox, useMeasuredSize } from '@/components/graph/GraphTooltip'
import type { GraphOverlayProps } from '@/components/graph/GraphOverlay'
import { Icon } from '@/components/icons'
import { catColorVar } from '@/components/items/categoryColor'
import { Kbd } from '@/components/ui/kbd'
import { actSetCategory } from '@/lib/actions'
import { GRAPH_NODE_SIZE } from '@/lib/graphLayout'
import { worldToScreen } from '@/lib/graph/geometry'
import { useGraph } from '@/store/graph'
import type { CategoryColor } from '@/types'

interface Row {
  /** null — «Без категории». */
  id: string | null
  name: string
  color: CategoryColor | null
  /** Цифра выбора: 0 — «Без категории», 1–9 — первые девять категорий. */
  digit: string | null
}

/** Цифра с основной или цифровой клавиатуры; с Shift/Ctrl/Alt/⌘ — не выбор. */
function digitOf(e: KeyboardEvent): string | null {
  if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return null
  const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code)
  return m ? m[1] : /^\d$/.test(e.key) ? e.key : null
}

export function GraphCategoryPicker(props: GraphOverlayProps) {
  const pickerFor = useGraph((s) => s.pickerFor)
  const exists = pickerFor !== null && props.scene.byId.has(pickerFor) && props.items.has(pickerFor)

  // Запись исчезла из сцены (удалена, архив скрыт): список закрывается.
  useEffect(() => {
    if (pickerFor !== null && !exists) useGraph.getState().openPicker(null)
  }, [pickerFor, exists])

  if (pickerFor === null || !exists) return null
  return <PickerBox key={pickerFor} {...props} id={pickerFor} />
}

function PickerBox({ scene, items, categories, id }: GraphOverlayProps & { id: string }) {
  const camera = useGraph((s) => s.camera)
  const viewSize = useGraph((s) => s.viewSize)
  const [ref, size] = useMeasuredSize<HTMLDivElement>()
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])

  const item = items.get(id)
  const node = scene.nodes[scene.byId.get(id) ?? -1]

  const rows: Row[] = [
    { id: null, name: 'Без категории', color: null, digit: '0' },
    ...categories.map((c, i): Row => ({ id: c.id, name: c.name, color: c.color, digit: i < 9 ? String(i + 1) : null })),
  ]
  const currentIndex = Math.max(0, rows.findIndex((r) => r.id === (item?.categoryId ?? null)))
  const [active, setActive] = useState(currentIndex)

  // Фокус — на строку, которая сейчас под курсором списка (при открытии — текущая категория).
  useEffect(() => {
    rowRefs.current[active]?.focus()
  }, [active])

  // Клик вне списка закрывает его.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const box = ref.current
      if (box && e.target instanceof Node && box.contains(e.target)) return
      useGraph.getState().openPicker(null)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [ref])

  if (!item || !node) return null

  const choose = (row: Row) => {
    void actSetCategory(id, row.id)
    useGraph.getState().openPicker(null)
    focusGraphStage()
  }
  const close = () => {
    useGraph.getState().openPicker(null)
    focusGraphStage()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    // Ctrl/⌘/Alt-сочетания (палитра, поиск) не трогаем; всё остальное не уходит к горячим клавишам приложения.
    if (e.ctrlKey || e.metaKey || e.altKey) return
    e.stopPropagation()
    const digit = digitOf(e)
    if (digit !== null) {
      e.preventDefault()
      const row = rows.find((r) => r.digit === digit)
      if (row) choose(row)
      return
    }
    const last = rows.length - 1
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive((a) => (a >= last ? 0 : a + 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive((a) => (a <= 0 ? last : a - 1))
        break
      case 'Tab':
        // Tab не выводит фокус из открытого списка: ходит по строкам по кругу.
        e.preventDefault()
        setActive((a) => (e.shiftKey ? (a <= 0 ? last : a - 1) : a >= last ? 0 : a + 1))
        break
      case 'Home':
        e.preventDefault()
        setActive(0)
        break
      case 'End':
        e.preventDefault()
        setActive(last)
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        choose(rows[active])
        break
      case 'Escape':
        e.preventDefault()
        close()
        break
    }
  }

  const c = worldToScreen(overlayViewport(camera, viewSize), { x: node.x, y: node.y })
  const half = (GRAPH_NODE_SIZE * camera.zoom) / 2
  const gap = 6
  // Ниже ноды; у нижнего края сцены — выше. По горизонтали — под нодой.
  const { left, top } = placeBox({ x: c.x - 16, y: c.y + half + gap }, size, viewSize, {
    flipX: c.x + 16,
    flipY: c.y - half - gap,
  })

  return (
    <div
      ref={ref}
      data-graph-ui
      className="pointer-events-auto absolute z-20 w-56 px-pop rounded-lg border bg-popover text-popover-foreground shadow-md"
      style={{ left, top }}
      onKeyDown={onKeyDown}
    >
      <div role="listbox" aria-label="Категория записи" className="max-h-64 overflow-y-auto p-1">
        {rows.map((r, i) => {
          const current = r.id === item.categoryId
          return (
            <div
              key={r.id ?? 'none'}
              ref={(el) => {
                rowRefs.current[i] = el
              }}
              role="option"
              tabIndex={i === active ? 0 : -1}
              aria-selected={current}
              onClick={() => choose(r)}
              onFocus={() => setActive(i)}
              className="px-nav flex min-h-7 cursor-default items-center gap-2 rounded-md px-1.5 py-1 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground pointer-coarse:min-h-9"
            >
              {r.digit !== null ? (
                <Kbd className="pointer-coarse:hidden">{r.digit}</Kbd>
              ) : (
                <span aria-hidden className="w-5 shrink-0 pointer-coarse:hidden" />
              )}
              <span aria-hidden className="px-sw inline-block size-2 shrink-0 rounded-full pixel:size-2.5" style={{ background: catColorVar(r.color) }} />
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              {current && <Icon name="check" size={14} pixelSize={16} className="shrink-0" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
