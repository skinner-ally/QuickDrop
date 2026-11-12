import { create } from 'zustand'
import { MAX_GRAPH_COORD } from '@/lib/normalize'

/** Камера графа: x, y — мировая точка в центре экрана. */
export interface GraphCamera {
  x: number
  y: number
  zoom: number
}

interface GraphState {
  camera: GraphCamera
  hoveredId: string | null
  /** Ключ зоны (id категории или 'none'), остальные ноды приглушены; null — нет. */
  focusZone: string | null
  setCamera: (patch: Partial<GraphCamera>) => void
  resetCamera: () => void
  setHovered: (id: string | null) => void
  setFocusZone: (key: string | null) => void
}

export const GRAPH_CAMERA_KEY = 'qd-graph-camera'
export const GRAPH_ZOOM_MIN = 0.1
export const GRAPH_ZOOM_MAX = 4

const DEFAULT_CAMERA: GraphCamera = { x: 0, y: 0, zoom: 1 }
const SAVE_DELAY_MS = 300

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

// `+ 0` убирает −0: после JSON он читается как 0, и камера «менялась» бы без движения.
function clampCoord(v: number): number {
  return Math.max(-MAX_GRAPH_COORD, Math.min(MAX_GRAPH_COORD, v)) + 0
}

function clampZoom(v: number): number {
  return Math.max(GRAPH_ZOOM_MIN, Math.min(GRAPH_ZOOM_MAX, v))
}

/** Хранилище может отсутствовать (тесты) или бросать уже при обращении (приватный режим, запрет в настройках). */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function readCamera(): GraphCamera {
  try {
    const raw = storage()?.getItem(GRAPH_CAMERA_KEY)
    if (!raw) return { ...DEFAULT_CAMERA }
    const data: unknown = JSON.parse(raw)
    if (typeof data !== 'object' || data === null) return { ...DEFAULT_CAMERA }
    const { x, y, zoom } = data as Record<string, unknown>
    if (!isNumber(x) || !isNumber(y) || !isNumber(zoom)) return { ...DEFAULT_CAMERA }
    return { x: clampCoord(x), y: clampCoord(y), zoom: clampZoom(zoom) }
  } catch {
    return { ...DEFAULT_CAMERA }
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

/** Запись с задержкой: при сдвиге и масштабировании камера меняется на каждый кадр. */
function scheduleSave(): void {
  if (!storage()) return
  if (saveTimer !== undefined) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    try {
      storage()?.setItem(GRAPH_CAMERA_KEY, JSON.stringify(useGraph.getState().camera))
    } catch {
      // Хранилище переполнено или запрещено — камера остаётся только в памяти.
    }
  }, SAVE_DELAY_MS)
}

export const useGraph = create<GraphState>((set, get) => ({
  camera: readCamera(),
  hoveredId: null,
  focusZone: null,

  setCamera: (patch) => {
    const prev = get().camera
    // Негодные значения (NaN от деления на нулевую ширину и т.п.) пропускаются, а не портят камеру.
    const camera: GraphCamera = {
      x: isNumber(patch.x) ? clampCoord(patch.x) : prev.x,
      y: isNumber(patch.y) ? clampCoord(patch.y) : prev.y,
      zoom: isNumber(patch.zoom) ? clampZoom(patch.zoom) : prev.zoom,
    }
    if (camera.x === prev.x && camera.y === prev.y && camera.zoom === prev.zoom) return
    set({ camera })
    scheduleSave()
  },
  resetCamera: () => get().setCamera(DEFAULT_CAMERA),
  // Наведение меняется на каждое движение мыши: то же значение не должно будить подписчиков.
  setHovered: (id) => set((s) => (s.hoveredId === id ? s : { hoveredId: id })),
  setFocusZone: (key) => set((s) => (s.focusZone === key ? s : { focusZone: key })),
}))
