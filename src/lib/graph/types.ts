/**
 * Типы графа: камера, вид сцены, сцена для рисования, цвета и сиюминутное состояние.
 * Модуль без логики — общая основа для geometry, scene, labels, draw и DOM-слоя.
 */

import { CATEGORY_COLORS } from '@/types'
import type { CategoryColor, GraphPoint } from '@/types'

/** Камера: x, y — мировая точка в центре сцены; zoom — ступень из GRAPH_ZOOM_STEPS. */
export interface GraphCamera {
  x: number
  y: number
  zoom: number
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Вид сцены: размер в CSS-пикселях, плотность пикселей и камера. */
export interface GraphViewport {
  width: number
  height: number
  dpr: number
  camera: GraphCamera
}

/** Мир → пиксели устройства: X = ox + round(wx · k). ox, oy — целые; k = zoom · dpr. */
export interface DeviceTransform {
  ox: number
  oy: number
  k: number
}

export type GraphColorKey = CategoryColor | 'none'

/**
 * Порядок цветов при рисовании (сцена сортирует ноды по нему). Константа живёт здесь, а не в theme.ts:
 * её использует scene.ts, а theme.ts реэкспортирует.
 */
export const GRAPH_COLOR_KEYS: readonly GraphColorKey[] = ['none', ...CATEGORY_COLORS]

export interface GraphNode {
  id: string
  x: number
  y: number
  color: GraphColorKey
  /** id категории или 'none'. */
  zone: string
  inbox: boolean
  archived: boolean
  /** В избранном: на ноде золотая звёздочка. */
  favorite: boolean
  /** Не проходит отбор. */
  dim: boolean
  title: string
  /** Индексы связанных нод сцены, по возрастанию. */
  links: number[]
}

/** a < b — индексы в scene.nodes. */
export interface GraphLink {
  a: number
  b: number
  cross: boolean
  dim: boolean
}

export interface SpatialIndex {
  bucket: number
  cells: Map<number, number[]>
}

export interface GraphScene {
  /** Порядок рисования: сначала dim, затем остальные; внутри — по color (порядок GRAPH_COLOR_KEYS), затем (y, x, id). */
  nodes: GraphNode[]
  byId: ReadonlyMap<string, number>
  links: GraphLink[]
  /** По центрам нод ± GRAPH_NODE_SIZE / 2; пусто — null. */
  bounds: Bounds | null
  index: SpatialIndex
  /** Число нод, проходящих отбор. */
  matched: number
}

export interface GraphTheme {
  pixel: boolean
  cat: Record<GraphColorKey, string>
  /** null — рамки нет («Классика»). */
  nodeEdge: string | null
  shadow: string | null
  inbox: string
  inboxEdge: string
  /** Звёздочка избранного и её контур. */
  fav: string
  favEdge: string
  sel: string
  selEdge: string | null
  hover: string
  /** Цвета связей для буфера ImageData (packRgba). */
  link: number
  linkAlt: number
  linkEdge: number
  /**
   * Тонкая связь без кромки (ниже 100 %): из link и linkEdge — тот, что контрастнее к земле (--graph-bg).
   * Днём это тёмная кромка, ночью — светлая верёвка: тёмная линия на тёмной земле пропадала.
   */
  linkThin: number
  linkHot: number
  /** Цвета связей для stroke («Классика»). */
  linkCss: string
  linkHotCss: string
}

/** Сиюминутное состояние для рисования (не входит в сцену). */
export interface DrawState {
  selectedId: string | null
  hoveredId: string | null
  cursorId: string | null
  /** Выбранная или наведённая связь. */
  hotLink: { a: string; b: string } | null
  /** Перетаскиваемая нода: текущая точка мира и клетка, куда она встанет. */
  drag: { id: string; x: number; y: number; drop: GraphPoint | null } | null
  /** Протягиваемая связь: от ноды к точке мира; targetId — нода под указателем. */
  tempLink: { fromId: string; x: number; y: number; targetId: string | null } | null
}

/** Альфа нод и связей, не прошедших отбор. */
export const GRAPH_ALPHA_DIM = 0.2
/** Альфа архивных нод. */
export const GRAPH_ALPHA_ARCHIVED = 0.45
