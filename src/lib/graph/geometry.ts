/**
 * Геометрия графа: ступени масштаба, мир ↔ экран, вписывание, пространственный индекс и попадания.
 * Чистый модуль: без DOM. Экран — CSS-пиксели от левого верхнего угла сцены; мир — px при масштабе 100 %.
 */

import type { GraphPoint } from '@/types'
import { GRAPH_CELL, GRAPH_NODE_SIZE } from '@/lib/graphLayout'
import type { Bounds, DeviceTransform, GraphCamera, GraphViewport, SpatialIndex } from './types'

/**
 * Ступени масштаба. Шаг сетки 32 px × ступень × devicePixelRatio (кратен 0.25) — целое число пикселей устройства:
 * решётка нод ровная, рамки не «плывут».
 */
export const GRAPH_ZOOM_STEPS: readonly number[] = [0.125, 0.25, 0.5, 0.75, 1, 1.5, 2]
/** С этого масштаба показываются подписи. */
export const GRAPH_LABEL_ZOOM = 1

const MIN_ZOOM = GRAPH_ZOOM_STEPS[0]
const MAX_ZOOM = GRAPH_ZOOM_STEPS[GRAPH_ZOOM_STEPS.length - 1]

/** Ближайшая ступень; при равном расстоянии — меньшая. NaN → 1. */
export function snapZoom(zoom: number): number {
  if (Number.isNaN(zoom)) return 1
  if (zoom <= MIN_ZOOM) return MIN_ZOOM
  if (zoom >= MAX_ZOOM) return MAX_ZOOM
  let best = GRAPH_ZOOM_STEPS[0]
  for (const step of GRAPH_ZOOM_STEPS) {
    if (Math.abs(step - zoom) < Math.abs(best - zoom)) best = step
  }
  return best
}

/** Соседняя ступень в направлении dir (от масштаба не со ступени — ближайшая в ту сторону); на краю — та же. */
export function stepZoom(zoom: number, dir: 1 | -1): number {
  const z = Number.isNaN(zoom) ? 1 : zoom
  if (dir > 0) {
    for (const step of GRAPH_ZOOM_STEPS) if (step > z + 1e-9) return step
    return MAX_ZOOM
  }
  for (let i = GRAPH_ZOOM_STEPS.length - 1; i >= 0; i--) {
    if (GRAPH_ZOOM_STEPS[i] < z - 1e-9) return GRAPH_ZOOM_STEPS[i]
  }
  return MIN_ZOOM
}

/** Мир → пиксели устройства: ox = round(width·dpr/2 − camera.x·k), так же oy; k = zoom · dpr. */
export function deviceTransform(v: GraphViewport): DeviceTransform {
  const k = v.camera.zoom * v.dpr
  return {
    ox: Math.round((v.width * v.dpr) / 2 - v.camera.x * k) + 0,
    oy: Math.round((v.height * v.dpr) / 2 - v.camera.y * k) + 0,
    k,
  }
}

/** Мировая точка → CSS-пиксели сцены (то же преобразование, что у рисования, через целые ox, oy). */
export function worldToScreen(v: GraphViewport, p: GraphPoint): GraphPoint {
  const { ox, oy, k } = deviceTransform(v)
  return { x: (ox + p.x * k) / v.dpr, y: (oy + p.y * k) / v.dpr }
}

/** CSS-пиксели сцены → мировая точка. */
export function screenToWorld(v: GraphViewport, p: GraphPoint): GraphPoint {
  const { ox, oy, k } = deviceTransform(v)
  return { x: (p.x * v.dpr - ox) / k, y: (p.y * v.dpr - oy) / k }
}

/** Видимая часть мира; marginPx — запас в CSS-пикселях с каждой стороны. */
export function visibleBounds(v: GraphViewport, marginPx = 0): Bounds {
  const a = screenToWorld(v, { x: -marginPx, y: -marginPx })
  const b = screenToWorld(v, { x: v.width + marginPx, y: v.height + marginPx })
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y }
}

/**
 * Камера после смены масштаба: мировая точка под anchor (CSS-пиксели сцены) остаётся под ним.
 * Масштаб приводится к ступени. Считается без округления ox, oy: приближение и отдаление в одной точке
 * возвращают камеру точно на место.
 */
export function zoomAt(v: GraphViewport, zoom: number, anchor: GraphPoint): GraphCamera {
  const { camera } = v
  const next = snapZoom(zoom)
  const ax = anchor.x - v.width / 2
  const ay = anchor.y - v.height / 2
  const wx = camera.x + ax / camera.zoom
  const wy = camera.y + ay / camera.zoom
  return { x: wx - ax / next, y: wy - ay / next, zoom: next }
}

/**
 * Камера после смены размера сцены: на месте остаётся точка сцены на доле keep её ширины и высоты
 * (0 — левый/верхний край, 0.5 — центр, 1 — правый/нижний; по умолчанию левый верхний угол — край, который
 * не двигается, когда справа открывается панель деталей). Без этого камера держит центр, и при сужении сцены
 * на 460 px всё содержимое уезжает на 230 px. Размер 0 (до первого замера, сцена скрыта) — камера как была.
 */
export function resizeCamera(
  camera: GraphCamera,
  prev: { width: number; height: number },
  next: { width: number; height: number },
  keep: { x: number; y: number } = { x: 0, y: 0 },
): GraphCamera {
  if (!(prev.width > 0) || !(prev.height > 0) || !(next.width > 0) || !(next.height > 0)) return camera
  if (!(camera.zoom > 0)) return camera
  const fx = Number.isFinite(keep.x) ? keep.x : 0
  const fy = Number.isFinite(keep.y) ? keep.y : 0
  const x = camera.x + ((0.5 - fx) * (next.width - prev.width)) / camera.zoom
  const y = camera.y + ((0.5 - fy) * (next.height - prev.height)) / camera.zoom
  return x === camera.x && y === camera.y ? camera : { x, y, zoom: camera.zoom }
}

/** Камера после сдвига содержимого на dx, dy CSS-пикселей (перетаскивание фона). */
export function panBy(camera: GraphCamera, dx: number, dy: number): GraphCamera {
  return { x: camera.x - dx / camera.zoom, y: camera.y - dy / camera.zoom, zoom: camera.zoom }
}

/**
 * Вписать bounds: наибольшая ступень, при которой bounds с отступом padPx с каждой стороны помещается, но не
 * больше 1 (не помещается и на наименьшей — наименьшая). bounds null или размер сцены 0 → { x: 0, y: 0, zoom: 1 }.
 */
export function fitCamera(
  bounds: Bounds | null,
  size: { width: number; height: number },
  padPx = 48,
): GraphCamera {
  if (!bounds || !(size.width > 0) || !(size.height > 0)) return { x: 0, y: 0, zoom: 1 }
  const bw = bounds.maxX - bounds.minX
  const bh = bounds.maxY - bounds.minY
  let zoom = MIN_ZOOM
  for (const step of GRAPH_ZOOM_STEPS) {
    if (step > 1) break
    if (bw * step + 2 * padPx <= size.width && bh * step + 2 * padPx <= size.height) zoom = step
  }
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, zoom }
}

/** Камера, при которой p виден с запасом marginPx (по умолчанию 64): центр переносится на p. null — уже виден. */
export function ensureVisible(v: GraphViewport, p: GraphPoint, marginPx = 64): GraphCamera | null {
  const s = worldToScreen(v, p)
  // На маленькой сцене запас не больше половины стороны: иначе точка не была бы «видна» нигде.
  const mx = Math.max(0, Math.min(marginPx, v.width / 2 - 1))
  const my = Math.max(0, Math.min(marginPx, v.height / 2 - 1))
  const inside = s.x >= mx && s.x <= v.width - mx && s.y >= my && s.y <= v.height - my
  if (inside) return null
  if (v.camera.x === p.x && v.camera.y === p.y) return null
  return { x: p.x, y: p.y, zoom: v.camera.zoom }
}

// ───────────────────────── пространственный индекс ─────────────────────────

// Корзина → одно число (ключ Map). Корзины в пределах ±2²¹ по каждой оси.
const KEY_OFFSET = 2 ** 21
const KEY_SPAN = 2 ** 22

function bucketKey(bx: number, by: number): number {
  return (bx + KEY_OFFSET) * KEY_SPAN + (by + KEY_OFFSET)
}

function finite(p: GraphPoint): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y)
}

/** Индекс точек по квадратным корзинам со стороной bucket (мир, по умолчанию 256). Негодные точки пропускаются. */
export function buildSpatialIndex(points: ReadonlyArray<GraphPoint>, bucket = 256): SpatialIndex {
  const size = bucket > 0 && Number.isFinite(bucket) ? bucket : 256
  const cells = new Map<number, number[]>()
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (!finite(p)) continue
    const key = bucketKey(Math.floor(p.x / size), Math.floor(p.y / size))
    const list = cells.get(key)
    if (list) list.push(i)
    else cells.set(key, [i])
  }
  return { bucket: size, cells }
}

/** Индексы точек внутри b (включая границу), по возрастанию. */
export function queryBounds(index: SpatialIndex, points: ReadonlyArray<GraphPoint>, b: Bounds): number[] {
  if (!(b.minX <= b.maxX) || !(b.minY <= b.maxY)) return []
  const out: number[] = []
  const inside = (i: number) => {
    const p = points[i]
    return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY
  }
  const size = index.bucket
  const bx0 = Math.floor(b.minX / size)
  const bx1 = Math.floor(b.maxX / size)
  const by0 = Math.floor(b.minY / size)
  const by1 = Math.floor(b.maxY / size)
  const span = (bx1 - bx0 + 1) * (by1 - by0 + 1)
  if (!Number.isFinite(span) || span > index.cells.size) {
    // Область больше заполненных корзин (весь граф на мелком масштабе) — дешевле обойти сами корзины.
    for (const list of index.cells.values()) for (const i of list) if (inside(i)) out.push(i)
  } else {
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const list = index.cells.get(bucketKey(bx, by))
        if (list) for (const i of list) if (inside(i)) out.push(i)
      }
    }
  }
  return out.sort((x, y) => x - y)
}

/** Полуширина зоны попадания в ноду мышью и пером, CSS-пиксели (на мелком масштабе). */
export const GRAPH_HIT_PX = 7
/** То же для связи. */
export const GRAPH_LINK_HIT_PX = 5
/** Полуширина зоны попадания пальцем (в ноду и в связь), CSS-пиксели: зона нажатия ≥ 36 px (DESIGN §10). */
export const GRAPH_TOUCH_HIT_PX = 18

/**
 * Нода под мировой точкой: полуширина зоны попадания max(GRAPH_NODE_SIZE/2 + 2, radiusPx/zoom) — на мелком
 * масштабе в ноду можно попасть. radiusPx — GRAPH_HIT_PX (по умолчанию) или GRAPH_TOUCH_HIT_PX для пальца.
 * Ближайшая по Чебышёву, при равенстве — с большим индексом (рисуется поверх). −1 — нет.
 * Для клика и наведения; начинать перенос ноды — только по hitNodeStrict.
 */
export function hitNode(
  index: SpatialIndex,
  points: ReadonlyArray<GraphPoint>,
  p: GraphPoint,
  zoom: number,
  opts?: { radiusPx?: number },
): number {
  const z = zoom > 0 ? zoom : 1
  const radius = opts?.radiusPx !== undefined && opts.radiusPx >= 0 ? opts.radiusPx : GRAPH_HIT_PX
  return hitNodeWithin(index, points, p, Math.max(GRAPH_NODE_SIZE / 2 + 2, radius / z))
}

/**
 * Нода для переноса: только сам квадрат с запасом 2 экранных px, но не больше четверти зазора между соседними
 * квадратами (4 мировых px). Широкая зона hitNode на мелком масштабе смыкается между соседями, и перетаскивание
 * фона внутри зоны хватало бы ноду; без предела запаса то же случилось бы и здесь на 25 % и 12,5 %
 * (2 экранных px там — половина шага сетки).
 */
export function hitNodeStrict(index: SpatialIndex, points: ReadonlyArray<GraphPoint>, p: GraphPoint, zoom: number): number {
  const margin = Math.min(2 / (zoom > 0 ? zoom : 1), (GRAPH_CELL - GRAPH_NODE_SIZE) / 4)
  return hitNodeWithin(index, points, p, GRAPH_NODE_SIZE / 2 + margin)
}

function hitNodeWithin(index: SpatialIndex, points: ReadonlyArray<GraphPoint>, p: GraphPoint, half: number): number {
  if (!finite(p)) return -1
  const candidates = queryBounds(index, points, { minX: p.x - half, minY: p.y - half, maxX: p.x + half, maxY: p.y + half })
  let best = -1
  let bestDist = Infinity
  for (const i of candidates) {
    const q = points[i]
    const d = Math.max(Math.abs(q.x - p.x), Math.abs(q.y - p.y))
    if (d <= bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

function segmentDistance(p: GraphPoint, a: GraphPoint, b: GraphPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * Связь под мировой точкой: расстояние до отрезка ≤ max(3, radiusPx/zoom), radiusPx — GRAPH_LINK_HIT_PX
 * (по умолчанию) или GRAPH_TOUCH_HIT_PX для пальца; ближайшая, при равенстве — с большим индексом.
 * Перебор всех связей. −1 — нет.
 */
export function hitLink(
  points: ReadonlyArray<GraphPoint>,
  links: ReadonlyArray<{ a: number; b: number }>,
  p: GraphPoint,
  zoom: number,
  opts?: { radiusPx?: number },
): number {
  if (!finite(p)) return -1
  const radius = opts?.radiusPx !== undefined && opts.radiusPx >= 0 ? opts.radiusPx : GRAPH_LINK_HIT_PX
  const limit = Math.max(3, radius / (zoom > 0 ? zoom : 1))
  let best = -1
  let bestDist = Infinity
  for (let i = 0; i < links.length; i++) {
    const a = points[links[i].a]
    const b = points[links[i].b]
    if (!a || !b) continue
    // Дешёвая отбраковка по рамке отрезка.
    if (p.x < Math.min(a.x, b.x) - limit || p.x > Math.max(a.x, b.x) + limit) continue
    if (p.y < Math.min(a.y, b.y) - limit || p.y > Math.max(a.y, b.y) + limit) continue
    const d = segmentDistance(p, a, b)
    if (d <= limit && d <= bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

/**
 * Ближайшая нода в направлении (стрелки клавиатуры): главная дельта > 0, |поперечная| ≤ главной (конус 90°);
 * минимум (главная + 2·|поперечная|), при равенстве — меньший индекс. skip — индекс, который не рассматривается
 * (текущая нода). −1 — нет.
 */
export function nearestInDirection(
  points: ReadonlyArray<GraphPoint>,
  from: GraphPoint,
  dir: 'left' | 'right' | 'up' | 'down',
  skip?: number,
): number {
  let best = -1
  let bestScore = Infinity
  for (let i = 0; i < points.length; i++) {
    if (i === skip) continue
    const p = points[i]
    const dx = p.x - from.x
    const dy = p.y - from.y
    let main: number
    let cross: number
    if (dir === 'right') [main, cross] = [dx, dy]
    else if (dir === 'left') [main, cross] = [-dx, dy]
    else if (dir === 'down') [main, cross] = [dy, dx]
    else [main, cross] = [-dy, dx]
    if (!(main > 0) || Math.abs(cross) > main) continue
    const score = main + 2 * Math.abs(cross)
    if (score < bestScore) {
      bestScore = score
      best = i
    }
  }
  return best
}

/**
 * Соседи ноды по часовой стрелке от «12 часов» (экранная ось y вниз) — порядок Tab. При одинаковом угле —
 * ближе к центру, затем меньший индекс.
 */
export function sortByAngle(points: ReadonlyArray<GraphPoint>, center: GraphPoint, indices: readonly number[]): number[] {
  const angle = (i: number) => {
    const dx = points[i].x - center.x
    const dy = points[i].y - center.y
    if (dx === 0 && dy === 0) return 0
    const a = Math.atan2(dx, -dy)
    return a < 0 ? a + 2 * Math.PI : a
  }
  const dist = (i: number) => Math.hypot(points[i].x - center.x, points[i].y - center.y)
  return [...indices].sort((a, b) => angle(a) - angle(b) || dist(a) - dist(b) || a - b)
}

/**
 * Одиночное событие колеса в пикселях с |deltaY| от этого значения — деление колеса мыши: шаг сразу. Деление
 * даёт 100 px только при «3 строки за щелчок» и масштабе страницы 100 %; при «1 строке» — около 33, при
 * увеличенной странице — меньше. Внутри потока событий (тачпад) такая дельта идёт в накопление, см. GRAPH_WHEEL_BURST_MS.
 */
export const GRAPH_WHEEL_NOTCH_PX = 30
/** Пауза колеса, после которой накопленное забывается, мс. */
export const GRAPH_WHEEL_IDLE_MS = 250
/**
 * Событие не позже этого после прошлого — часть потока (тачпад шлёт события раз в 8–16 мс, и дельты в нём бывают
 * 30–150 px): мгновенного шага оно не даёт. Деления мыши стоят дальше друг от друга.
 */
export const GRAPH_WHEEL_BURST_MS = 50

/**
 * Колесо → шаг масштаба. Строки и страницы (deltaMode 1, 2) и одиночное пиксельное событие от
 * GRAPH_WHEEL_NOTCH_PX (прошлого не было или оно дальше GRAPH_WHEEL_BURST_MS) — деление колеса, шаг сразу.
 * Остальные пиксельные дельты (поток тачпада, в том числе крупные) накапливаются до 90 (с ctrlKey — щипок — 30).
 * За событие не больше одного шага, после шага накопленное сбрасывается, смена направления начинает заново.
 * lastTime — timeStamp прошлого события: если e.timeStamp позже него больше чем на GRAPH_WHEEL_IDLE_MS,
 * накопленное забывается. steps > 0 — приблизить (колесо от себя, deltaY < 0).
 */
export function wheelSteps(
  acc: number,
  e: { deltaY: number; deltaMode: number; ctrlKey: boolean; timeStamp?: number },
  lastTime?: number,
): { acc: number; steps: -1 | 0 | 1 } {
  const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? 400 : 1
  const delta = -e.deltaY * unit
  const hasTime =
    e.timeStamp !== undefined && lastTime !== undefined && Number.isFinite(e.timeStamp) && Number.isFinite(lastTime)
  const idle = hasTime && (e.timeStamp as number) - (lastTime as number) > GRAPH_WHEEL_IDLE_MS
  const prev = Number.isFinite(acc) && !idle ? acc : 0
  if (!Number.isFinite(delta) || delta === 0) return { acc: prev, steps: 0 }
  const dir = delta > 0 ? 1 : -1
  // Без времени (или с негодным) событие считается одиночным.
  const isolated = !hasTime || (e.timeStamp as number) - (lastTime as number) > GRAPH_WHEEL_BURST_MS
  if (e.deltaMode === 1 || e.deltaMode === 2 || (Math.abs(delta) >= GRAPH_WHEEL_NOTCH_PX && isolated)) {
    return { acc: 0, steps: dir }
  }
  const sum = Math.sign(delta) === Math.sign(prev) ? prev + delta : delta
  const threshold = e.ctrlKey ? 30 : 90
  if (Math.abs(sum) >= threshold) return { acc: 0, steps: dir }
  return { acc: sum, steps: 0 }
}

/** Щипок: отношение расстояний > 1.35 → 1 (приблизить); < 0.74 → −1; иначе 0. */
export function pinchStep(startDist: number, dist: number): -1 | 0 | 1 {
  if (!(startDist > 0) || !Number.isFinite(startDist) || !Number.isFinite(dist)) return 0
  const ratio = dist / startDist
  if (ratio > 1.35) return 1
  if (ratio < 0.74) return -1
  return 0
}
