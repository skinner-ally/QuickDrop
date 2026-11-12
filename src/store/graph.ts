import { create } from 'zustand'
import { fitCamera, panBy as panCamera, resizeCamera, snapZoom, stepZoom, zoomAt } from '@/lib/graph/geometry'
import type { Bounds, GraphCamera, GraphViewport } from '@/lib/graph/types'
import { MAX_GRAPH_COORD } from '@/lib/normalize'
import type { GraphPoint } from '@/types'

// Тип переехал в lib/graph/types; экспорт отсюда остаётся для прежних импортов.
export type { GraphCamera } from '@/lib/graph/types'

type DragKind = 'pan' | 'node' | 'link'
type LinkRef = { a: string; b: string; x: number; y: number }
type MenuRef = { id: string; x: number; y: number }

interface GraphState {
  camera: GraphCamera
  /**
   * Номер изменения камеры: растёт при каждом setCamera (сдвиг, масштаб, вписывание, центрирование), но не при
   * подстройке камеры под новый размер сцены. По нему видно, двигал ли пользователь вид (revealDecision).
   */
  cameraRev: number
  /** Камера прочитана из localStorage; иначе при первом показе графа делается fitAll. */
  cameraRestored: boolean
  /** Размер сцены в CSS-пикселях; 0×0 — ещё не измерена. */
  viewSize: { width: number; height: number }
  /** Границы нод сцены (ставит GraphView). */
  bounds: Bounds | null
  hoveredId: string | null
  /** Курсор клавиатуры. */
  cursorId: string | null
  /** Курсор поставлен клавиатурой (подсказка у него показывается), а не кликом мыши. */
  cursorByKeys: boolean
  /** Идущий жест — DOM-слой прячет подсказку и ручку. */
  drag: DragKind | null
  /** Режим связи: от какой ноды. */
  linkFrom: string | null
  /** Выбранная связь; x, y — мировая точка клика (якорь плашки). */
  selectedLink: LinkRef | null
  /** Меню ноды; x, y — CSS-пиксели сцены. */
  menu: MenuRef | null
  /** Для какой ноды открыт выбор категории. */
  pickerFor: string | null
  showArchive: boolean
  hintSeen: boolean

  setCamera: (patch: Partial<GraphCamera>) => void
  resetCamera: () => void
  /**
   * Размер сцены. Камера подстраивается так, что на экране ничего не сдвигается: на месте остаётся точка сцены
   * на доле keep (по умолчанию левый верхний угол; { x: 0, y: 1 } — левый нижний, если сдвинулся верхний край).
   * Из 0 (сцена была скрыта) камера возвращается от последнего ненулевого размера с якорем в левом верхнем углу:
   * иначе сужение панелью деталей, после которого сцену закрыли, оставляло бы вид сдвинутым навсегда. В 0 камера
   * не меняется.
   */
  setViewSize: (width: number, height: number, keep?: { x: number; y: number }) => void
  setBounds: (bounds: Bounds | null) => void
  /** Шаг масштаба; anchor — CSS-пиксели сцены, по умолчанию центр. */
  zoomStep: (dir: 1 | -1, anchor?: GraphPoint) => void
  /** Сдвиг содержимого на dx, dy CSS-пикселей (перетаскивание фона). */
  panBy: (dx: number, dy: number) => void
  /** Вписать bounds в viewSize; viewSize 0×0 — ничего. */
  fitAll: () => void
  /** Центр камеры в p; minZoom — поднять масштаб до этой ступени, если он меньше. */
  centerOn: (p: GraphPoint, minZoom?: number) => void
  setHovered: (id: string | null) => void
  setCursor: (id: string | null, byKeys?: boolean) => void
  setDrag: (kind: DragKind | null) => void
  setLinkFrom: (id: string | null) => void
  selectLink: (link: LinkRef | null) => void
  openMenu: (menu: MenuRef | null) => void
  openPicker: (id: string | null) => void
  setShowArchive: (on: boolean) => void
  dismissHint: () => void
  /** Сброс сиюминутного: hoveredId, cursorId, drag, linkFrom, selectedLink, menu, pickerFor → null. */
  resetTransient: () => void
}

export const GRAPH_CAMERA_KEY = 'qd-graph-camera'
export const GRAPH_ARCHIVE_KEY = 'qd-graph-archive'
export const GRAPH_HINT_KEY = 'qd-graph-hint'
/** Первая и последняя ступени масштаба (GRAPH_ZOOM_STEPS). */
export const GRAPH_ZOOM_MIN = 0.125
export const GRAPH_ZOOM_MAX = 2

const DEFAULT_CAMERA: GraphCamera = { x: 0, y: 0, zoom: 1 }
const SAVE_DELAY_MS = 300

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

// `+ 0` убирает −0: после JSON он читается как 0, и камера «менялась» бы без движения.
function clampCoord(v: number): number {
  return Math.max(-MAX_GRAPH_COORD, Math.min(MAX_GRAPH_COORD, v)) + 0
}

/** Последний ненулевой размер сцены: по нему камера возвращается после скрытия сцены и после перезагрузки. */
let lastViewSize: { width: number; height: number } | null = null

/** Хранилище может отсутствовать (тесты) или бросать уже при обращении (приватный режим, запрет в настройках). */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function readItem(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeItem(key: string, value: string): void {
  try {
    storage()?.setItem(key, value)
  } catch {
    // Хранилище переполнено или запрещено — значение остаётся только в памяти.
  }
}

/** restored — годная камера прочитана из хранилища (сохранённый масштаб не со ступени подтягивается к ближайшей). */
function readCamera(): { camera: GraphCamera; restored: boolean; size: { width: number; height: number } | null } {
  const fallback = { camera: { ...DEFAULT_CAMERA }, restored: false, size: null }
  try {
    const raw = readItem(GRAPH_CAMERA_KEY)
    if (!raw) return fallback
    const data: unknown = JSON.parse(raw)
    if (typeof data !== 'object' || data === null) return fallback
    const { x, y, zoom, w, h } = data as Record<string, unknown>
    if (!isNumber(x) || !isNumber(y) || !isNumber(zoom)) return fallback
    // Размер сцены, при котором камера сохранена (старый формат — без него).
    const size = isNumber(w) && isNumber(h) && w > 0 && h > 0 ? { width: w, height: h } : null
    return { camera: { x: clampCoord(x), y: clampCoord(y), zoom: snapZoom(zoom) }, restored: true, size }
  } catch {
    return fallback
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined

/** Запись с задержкой: при сдвиге и масштабировании камера меняется на каждый кадр. */
function scheduleSave(): void {
  if (!storage()) return
  if (saveTimer !== undefined) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    const camera = useGraph.getState().camera
    writeItem(GRAPH_CAMERA_KEY, JSON.stringify(lastViewSize ? { ...camera, w: lastViewSize.width, h: lastViewSize.height } : camera))
  }, SAVE_DELAY_MS)
}

const initialCamera = readCamera()
lastViewSize = initialCamera.size

const sameRef = <T extends object>(a: T | null, b: T | null): boolean => {
  if (a === b) return true
  if (!a || !b) return false
  const keys = Object.keys(a) as Array<keyof T>
  return keys.every((k) => a[k] === b[k])
}

export const useGraph = create<GraphState>((set, get) => {
  /** Вид для геометрии: dpr = 1 — на камеру плотность пикселей не влияет. */
  const viewport = (): GraphViewport => {
    const { camera, viewSize } = get()
    return { width: viewSize.width, height: viewSize.height, dpr: 1, camera }
  }

  const setCamera = (patch: Partial<GraphCamera>): void => {
    const prev = get().camera
    // Негодные значения (NaN от деления на нулевую ширину и т.п.) пропускаются, а не портят камеру.
    const camera: GraphCamera = {
      x: isNumber(patch.x) ? clampCoord(patch.x) : prev.x,
      y: isNumber(patch.y) ? clampCoord(patch.y) : prev.y,
      zoom: isNumber(patch.zoom) ? snapZoom(patch.zoom) : prev.zoom,
    }
    if (camera.x === prev.x && camera.y === prev.y && camera.zoom === prev.zoom) return
    set((s) => ({ camera, cameraRev: s.cameraRev + 1 }))
    scheduleSave()
  }

  return {
    camera: initialCamera.camera,
    cameraRev: 0,
    cameraRestored: initialCamera.restored,
    viewSize: { width: 0, height: 0 },
    bounds: null,
    hoveredId: null,
    cursorId: null,
    cursorByKeys: false,
    drag: null,
    linkFrom: null,
    selectedLink: null,
    menu: null,
    pickerFor: null,
    showArchive: readItem(GRAPH_ARCHIVE_KEY) !== '0',
    hintSeen: readItem(GRAPH_HINT_KEY) === '1',

    setCamera,
    resetCamera: () => setCamera(DEFAULT_CAMERA),
    setViewSize: (width, height, keep) => {
      const s = get()
      const w = isNumber(width) && width > 0 ? width : 0
      const h = isNumber(height) && height > 0 ? height : 0
      if (s.viewSize.width === w && s.viewSize.height === h) return
      const viewSize = { width: w, height: h }
      const wasHidden = !(s.viewSize.width > 0) || !(s.viewSize.height > 0)
      const shown = w > 0 && h > 0
      // Сцена снова показана: возврат от последнего размера (якорь — левый верхний угол, как у панели деталей).
      const moved =
        shown && wasHidden && lastViewSize
          ? resizeCamera(s.camera, lastViewSize, viewSize, { x: 0, y: 0 })
          : resizeCamera(s.camera, s.viewSize, viewSize, keep)
      if (shown) lastViewSize = viewSize
      if (moved === s.camera) {
        set({ viewSize })
        return
      }
      // Мимо setCamera: это не движение вида, cameraRev не растёт.
      set({ viewSize, camera: { x: clampCoord(moved.x), y: clampCoord(moved.y), zoom: moved.zoom } })
      scheduleSave()
    },
    setBounds: (bounds) => set((s) => (sameRef(s.bounds, bounds) ? s : { bounds })),
    zoomStep: (dir, anchor) => {
      const v = viewport()
      const zoom = stepZoom(v.camera.zoom, dir)
      if (zoom === v.camera.zoom) return
      setCamera(zoomAt(v, zoom, anchor ?? { x: v.width / 2, y: v.height / 2 }))
    },
    panBy: (dx, dy) => {
      if (!isNumber(dx) || !isNumber(dy)) return
      setCamera(panCamera(get().camera, dx, dy))
    },
    fitAll: () => {
      const { viewSize, bounds } = get()
      if (!(viewSize.width > 0) || !(viewSize.height > 0)) return
      setCamera(fitCamera(bounds, viewSize))
    },
    centerOn: (p, minZoom) => {
      const camera = get().camera
      const zoom = minZoom !== undefined && isNumber(minZoom) ? Math.max(camera.zoom, snapZoom(minZoom)) : camera.zoom
      setCamera({ x: p.x, y: p.y, zoom })
    },

    // Наведение меняется на каждое движение мыши: то же значение не должно будить подписчиков.
    setHovered: (id) => set((s) => (s.hoveredId === id ? s : { hoveredId: id })),
    setCursor: (id, byKeys = false) =>
      set((s) => {
        const k = id !== null && byKeys
        return s.cursorId === id && s.cursorByKeys === k ? s : { cursorId: id, cursorByKeys: k }
      }),
    setDrag: (kind) => set((s) => (s.drag === kind ? s : { drag: kind })),
    setLinkFrom: (id) => set((s) => (s.linkFrom === id ? s : { linkFrom: id })),

    // Открытие одного всплывающего закрывает остальные.
    selectLink: (link) =>
      set((s) => {
        if (link === null) return s.selectedLink === null ? s : { selectedLink: null }
        if (sameRef(s.selectedLink, link) && s.menu === null && s.pickerFor === null) return s
        return { selectedLink: link, menu: null, pickerFor: null }
      }),
    openMenu: (menu) =>
      set((s) => {
        if (menu === null) return s.menu === null ? s : { menu: null }
        if (sameRef(s.menu, menu) && s.pickerFor === null && s.selectedLink === null) return s
        return { menu, pickerFor: null, selectedLink: null }
      }),
    openPicker: (id) =>
      set((s) => {
        if (id === null) return s.pickerFor === null ? s : { pickerFor: null }
        if (s.pickerFor === id && s.menu === null && s.selectedLink === null) return s
        return { pickerFor: id, menu: null, selectedLink: null }
      }),

    setShowArchive: (on) => {
      if (get().showArchive === on) return
      set({ showArchive: on })
      writeItem(GRAPH_ARCHIVE_KEY, on ? '1' : '0')
    },
    dismissHint: () => {
      if (get().hintSeen) return
      set({ hintSeen: true })
      writeItem(GRAPH_HINT_KEY, '1')
    },
    resetTransient: () =>
      set((s) =>
        s.hoveredId === null &&
        s.cursorId === null &&
        !s.cursorByKeys &&
        s.drag === null &&
        s.linkFrom === null &&
        s.selectedLink === null &&
        s.menu === null &&
        s.pickerFor === null
          ? s
          : { hoveredId: null, cursorId: null, cursorByKeys: false, drag: null, linkFrom: null, selectedLink: null, menu: null, pickerFor: null },
      ),
  }
})
