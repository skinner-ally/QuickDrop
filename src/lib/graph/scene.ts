/**
 * Сборка сцены графа: какие записи — ноды, их цвет, зона, приглушение и связи; порядок рисования и индекс.
 * Чистая функция: пересобирается только при смене записей, положений, категорий, отбора и переключателя архива.
 */

import type { Category, GraphPoint, Item } from '@/types'
import { GRAPH_NODE_SIZE, GRAPH_NONE_ZONE } from '@/lib/graphLayout'
import { displayTitle } from '@/lib/itemTitle'
import { buildSpatialIndex } from './geometry'
import { GRAPH_COLOR_KEYS } from './types'
import type { GraphColorKey, GraphLink, GraphNode, GraphScene } from './types'

export interface SceneInput {
  /** Записи вне корзины (записи с deletedAt, если попали, пропускаются). */
  items: readonly Item[]
  positions: ReadonlyMap<string, GraphPoint>
  categories: readonly Category[]
  /** null — отбор не задан (ничего не приглушено). */
  match: ReadonlySet<string> | null
  showArchive: boolean
}

const COLOR_RANK = new Map<GraphColorKey, number>(GRAPH_COLOR_KEYS.map((key, i) => [key, i]))

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function buildGraphScene(input: SceneInput): GraphScene {
  const { items, positions, categories, match, showArchive } = input
  const colorOf = new Map<string, GraphColorKey>()
  for (const c of categories) colorOf.set(c.id, COLOR_RANK.has(c.color) ? c.color : 'none')

  const draft: Array<{ node: GraphNode; item: Item }> = []
  const seen = new Set<string>()
  for (const item of items) {
    if (item.deletedAt !== undefined) continue
    if (item.status === 'archive' && !showArchive) continue
    if (seen.has(item.id)) continue
    const p = positions.get(item.id)
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    seen.add(item.id)
    const categoryId = item.categoryId ?? null
    draft.push({
      item,
      node: {
        id: item.id,
        x: p.x,
        y: p.y,
        color: (categoryId !== null && colorOf.get(categoryId)) || 'none',
        zone: categoryId ?? GRAPH_NONE_ZONE,
        inbox: item.status === 'inbox',
        archived: item.status === 'archive',
        dim: match !== null && !match.has(item.id),
        title: displayTitle(item),
        links: [],
      },
    })
  }

  // Порядок рисования: приглушённые снизу, затем по цвету (меньше смен fillStyle), затем (y, x, id).
  draft.sort((p, q) => {
    const a = p.node
    const b = q.node
    return (
      Number(b.dim) - Number(a.dim) ||
      COLOR_RANK.get(a.color)! - COLOR_RANK.get(b.color)! ||
      a.y - b.y ||
      a.x - b.x ||
      compareStrings(a.id, b.id)
    )
  })
  const nodes = draft.map((d) => d.node)
  const byId = new Map<string, number>()
  nodes.forEach((n, i) => byId.set(n.id, i))

  // Связи: неупорядоченные пары видимых нод, записанные с любой стороны, без дублей и самоссылок.
  const count = nodes.length
  const pairs = new Set<number>()
  for (let i = 0; i < count; i++) {
    const links = draft[i].item.links
    if (!Array.isArray(links)) continue
    for (const id of links) {
      const j = byId.get(id)
      if (j === undefined || j === i) continue
      pairs.add(i < j ? i * count + j : j * count + i)
    }
  }
  const keys = [...pairs].sort((x, y) => x - y)
  const links: GraphLink[] = keys.map((key) => {
    const a = Math.floor(key / count)
    const b = key - a * count
    nodes[a].links.push(b)
    nodes[b].links.push(a)
    return { a, b, cross: nodes[a].zone !== nodes[b].zone, dim: nodes[a].dim || nodes[b].dim }
  })
  for (const n of nodes) if (n.links.length > 1) n.links.sort((x, y) => x - y)

  let bounds: GraphScene['bounds'] = null
  let matched = 0
  if (count > 0) {
    const half = GRAPH_NODE_SIZE / 2
    bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    for (const n of nodes) {
      if (!n.dim) matched++
      bounds.minX = Math.min(bounds.minX, n.x - half)
      bounds.minY = Math.min(bounds.minY, n.y - half)
      bounds.maxX = Math.max(bounds.maxX, n.x + half)
      bounds.maxY = Math.max(bounds.maxY, n.y + half)
    }
  }

  return { nodes, byId, links, bounds, index: buildSpatialIndex(nodes), matched }
}
