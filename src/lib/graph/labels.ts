/**
 * Выбор подписей нод: справа от ноды, только там, где подпись не закрывает другие ноды и подписи.
 * Выбранная нода и её соседи (priority) подписываются всегда — на плашке, им можно закрывать ноды.
 * Геометрия подписей — в CSS-пикселях масштаба zoom (сдвиг экрана одинаков для всех и на пересечения не влияет).
 */

import { GRAPH_NODE_SIZE } from '@/lib/graphLayout'
import { GRAPH_LABEL_ZOOM, queryBounds } from './geometry'
import type { Bounds, GraphScene } from './types'

export const GRAPH_LABEL_LIMIT = 150
/** CSS-пиксели. */
export const GRAPH_LABEL_MAX_WIDTH = 160
export const GRAPH_LABEL_HEIGHT = 16
/** От края ноды до подписи, CSS-пиксели. */
export const GRAPH_LABEL_GAP = 6

export interface GraphLabel {
  /** Индекс ноды в сцене. */
  index: number
  id: string
  text: string
  /** Центр ноды, мир. Подпись ставится справа: left = x·zoom + GRAPH_NODE_SIZE·zoom/2 + GAP, по вертикали — по центру. */
  x: number
  y: number
  /** На плашке (выбранная нода и её соседи). */
  plate: boolean
}

interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

const defaultMeasure = (t: string) => t.length * 7 + 4

function pointIn(area: Bounds, x: number, y: number): boolean {
  return x >= area.minX && x <= area.maxX && y >= area.minY && y <= area.maxY
}

/**
 * area — где подписи нужны (обычно экран с запасом на сдвиг без пересчёта). opts.core — видимая часть
 * (visibleBounds без запаса): её ноды обходятся первыми, и предел не уходит на подписи за экраном.
 */
export function pickLabels(
  scene: GraphScene,
  area: Bounds,
  zoom: number,
  priority: readonly string[],
  opts?: { limit?: number; measure?: (text: string) => number; core?: Bounds },
): GraphLabel[] {
  if (!(zoom >= GRAPH_LABEL_ZOOM)) return []
  const limit = Math.max(0, opts?.limit ?? GRAPH_LABEL_LIMIT)
  const measure = opts?.measure ?? defaultMeasure
  const half = GRAPH_NODE_SIZE / 2
  const out: GraphLabel[] = []
  const rects: Rect[] = []
  const plates: Rect[] = []
  const taken = new Set<number>()

  const rectOf = (x: number, y: number, text: string): Rect => {
    const width = Math.max(0, Math.min(GRAPH_LABEL_MAX_WIDTH, measure(text)))
    const left = x * zoom + half * zoom + GRAPH_LABEL_GAP
    const top = y * zoom - GRAPH_LABEL_HEIGHT / 2
    return { left, top, right: left + width, bottom: top + GRAPH_LABEL_HEIGHT }
  }
  const accept = (index: number, rect: Rect, plate: boolean) => {
    const n = scene.nodes[index]
    out.push({ index, id: n.id, text: n.title, x: n.x, y: n.y, plate })
    rects.push(rect)
    if (plate) plates.push(rect)
    taken.add(index)
  }

  // 1. Приоритетные — на плашке; закрывать ноды им можно, другие плашки — нет.
  for (const id of priority) {
    if (out.length >= limit) return out
    const index = scene.byId.get(id)
    if (index === undefined || taken.has(index)) continue
    const n = scene.nodes[index]
    if (!pointIn(area, n.x, n.y)) continue
    const rect = rectOf(n.x, n.y, n.title)
    if (plates.some((p) => overlaps(p, rect))) continue
    accept(index, rect, true)
  }

  // 2. Остальные ноды области в порядке сцены, сначала core, затем остальная область: подпись не пересекает
  //    принятые и не накрывает квадрат другой ноды.
  const found = queryBounds(scene.index, scene.nodes, area)
  const core = opts?.core
  let ordered = found
  if (core) {
    const inner: number[] = []
    const outer: number[] = []
    for (const i of found) (pointIn(core, scene.nodes[i].x, scene.nodes[i].y) ? inner : outer).push(i)
    ordered = inner.concat(outer)
  }
  for (const index of ordered) {
    if (out.length >= limit) break
    if (taken.has(index)) continue
    const n = scene.nodes[index]
    if (n.dim) continue
    const rect = rectOf(n.x, n.y, n.title)
    if (rects.some((r) => overlaps(r, rect))) continue
    // Прямоугольник подписи в мире, расширенный на полноды: центры нод, чей квадрат может его задеть.
    const world = {
      minX: rect.left / zoom - half,
      minY: rect.top / zoom - half,
      maxX: rect.right / zoom + half,
      maxY: rect.bottom / zoom + half,
    }
    let covers = false
    for (const j of queryBounds(scene.index, scene.nodes, world)) {
      if (j === index) continue
      const m = scene.nodes[j]
      const square = {
        left: (m.x - half) * zoom,
        top: (m.y - half) * zoom,
        right: (m.x + half) * zoom,
        bottom: (m.y + half) * zoom,
      }
      if (overlaps(square, rect)) {
        covers = true
        break
      }
    }
    if (covers) continue
    accept(index, rect, false)
  }
  return out
}
