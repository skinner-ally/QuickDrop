/**
 * Мир живого фона по координатам (spec-stage6 §4.1): лес с чащами и полянами, кусты, камни, редкие пруды с камышами
 * и мелочь земли. Перенос расстановки mockup/forest.js один к одному — те же формулы и «соли» хеша. Мир не хранится:
 * всё вычисляется из координат, поэтому одно и то же место всегда одинаково, в любом порядке запросов.
 *
 * Внутри счёт в арт-пикселях мокапа (1 арт = ART_PX px мира), наружу — px мира. Объект несёт вид, а не картинку:
 * спрайты выбирает графика сцены (SceneArt.object).
 */

import type { Bounds } from '@/lib/graph/types'
import type { ObjectKind } from '@/lib/ambient/types'

/** px мира в номинальном арт-пикселе. */
export const ART_PX = 2
/** Сторона ячейки генерации, px мира (CH·PX мокапа). */
export const WORLD_CHUNK = 512
/** Место под один объект (G·PX мокапа): 8×8 мест в ячейке. */
export const WORLD_SLOT = 64
/** Ячейка, в которой не больше одного пруда, px мира (SC·PX мокапа). */
export const POND_CELL = 1536
export const POND_CHANCE = 0.42
/** Клетка мелочи земли, px мира (= GRAPH_CELL). */
export const GROUND_CELL = 32
/** Мест под мелочь земли в клетке. */
export const GROUND_SLOTS = 5

// Те же величины в арт-пикселях мокапа.
const CH = WORLD_CHUNK / ART_PX // 256
const G = WORLD_SLOT / ART_PX // 32
const SC = POND_CELL / ART_PX // 768
const SLOTS = CH / G // 8
const CHUNKS_PER_POND = SC / CH // 3
const CACHE_MAX = 600

// ───────────────────────── случайность по координатам ─────────────────────────

/** Целочисленный хеш места (h2 мокапа до деления), 0..2³²−1. */
export function hashU32(x: number, y: number, s = 0): number {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return (n ^ (n >>> 16)) >>> 0
}

/** h2 мокапа: [0, 1). Аргументы усекаются до целых (как `| 0`). */
export function hash2(x: number, y: number, s = 0): number {
  return hashU32(x, y, s) / 4294967296
}

const smooth = (t: number) => t * t * (3 - 2 * t)

/** vn мокапа: шум значений с плавной интерполяцией, [0, 1). */
export function valueNoise(x: number, y: number, s = 0): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = smooth(x - xi)
  const fy = smooth(y - yi)
  const a = hash2(xi, yi, s)
  const b = hash2(xi + 1, yi, s)
  const c = hash2(xi, yi + 1, s)
  const d = hash2(xi + 1, yi + 1, s)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

const step = (a: number, b: number, v: number) => (v <= a ? 0 : v >= b ? 1 : smooth((v - a) / (b - a)))

/** Густота леса в арт-координатах (density мокапа): крупные пятна чащи и полян плюс мелкая неровность опушек. */
function densityArt(gx: number, gy: number): number {
  return 0.65 * valueNoise(gx / 420, gy / 420, 1) + 0.35 * valueNoise(gx / 150 + 31, gy / 150 + 17, 2)
}

/** Густота леса в точке мира. */
export function forestDensity(wx: number, wy: number): number {
  return densityArt(wx / ART_PX, wy / ART_PX)
}

// ───────────────────────── объекты и пруды ─────────────────────────

export interface WorldObject {
  /**
   * Номер места: стабилен, не зависит от порядка запросов, уникален (лес — >= 0 по месту, камыши и кувшинки — < 0
   * по пруду и порядковому номеру). Целое до 2⁴⁶: не приводить к int32.
   */
  id: number
  /** Мир, точка опоры. */
  x: number
  y: number
  kind: ObjectKind
  pal: number
  variant: number
  /** Поляна: объект скрыт, если центр ноды лежит в рамке [x − clearX, x + clearX] × [y − clearUp, y + clearDown]. 0 — не скрывается сам. */
  clearX: number
  clearUp: number
  clearDown: number
}

export interface Pond {
  id: number
  /** Мир; r — радиус по x до искажения. */
  x: number
  y: number
  r: number
  a1: number
  a2: number
  /** Пруд скрыт целиком, если нода ближе reach к (x, y). */
  reach: number
  /** Камыши и кувшинки (clearX = 0: прячутся только вместе с прудом). */
  objects: readonly WorldObject[]
}

/**
 * Рамки полян объектов, px мира: наибольший спрайт из SPRITE_LIMITS × ART_PX × 1.34 (наибольший относительный
 * размер спрайта) + полноды 8 px + запас 24 px. От ступени масштаба не зависят: лес у зон один на любом масштабе.
 */
export const OBJECT_CLEAR: Readonly<Record<ObjectKind, { x: number; up: number; down: number }>> = {
  tree: { x: 74, up: 140, down: 44 },
  pine: { x: 60, up: 134, down: 44 },
  bush: { x: 60, up: 72, down: 44 },
  stone: { x: 54, up: 62, down: 44 },
  small: { x: 54, up: 62, down: 44 },
  reed: { x: 0, up: 0, down: 0 },
  lily: { x: 0, up: 0, down: 0 },
}

/** Запас поляны пруда сверх его размера, px мира: reach = r·1.45 + POND_REACH_PAD. */
export const POND_REACH_PAD = 56

// Номера мест — взаимно однозначно от координат (хеш h2 на соседних местах даёт совпадения).
// Места и ячейки в пределах ±2²⁰ по каждой оси; номера — целые до 2⁴⁶ (точны в double).
const ID_OFFSET = 2 ** 20
const ID_SPAN = 2 ** 21
const placeId = (a: number, b: number) => (a + ID_OFFSET) * ID_SPAN + (b + ID_OFFSET)
/** Номер объекта леса: место (qx, qy), неотрицательный. */
const forestId = (qx: number, qy: number) => placeId(qx, qy)
/** Номер камыша или кувшинки: пруд (sx, sy) и порядковый i (< 32), отрицательный — не совпадает с лесом. */
const pondObjectId = (sx: number, sy: number, i: number) => -(placeId(sx, sy) * 32 + i + 1)

function makeObject(id: number, x: number, y: number, kind: ObjectKind, pal: number, variant: number): WorldObject {
  const c = OBJECT_CLEAR[kind]
  return Object.freeze({ id, x, y, kind, pal, variant, clearX: c.x, clearUp: c.up, clearDown: c.down })
}

const pondCache = new Map<string, Pond | null>()
const chunkCache = new Map<string, readonly WorldObject[]>()

/** pondD мокапа: <= 1 — вода. Мера не зависит от единиц, поэтому считается прямо в px мира. */
export function pondDistance(p: Pond, wx: number, wy: number): number {
  const dx = wx - p.x
  const dy = (wy - p.y) / 0.72
  const a = Math.atan2(dy, dx)
  return Math.hypot(dx, dy) / (p.r * (1 + 0.16 * Math.sin(3 * a + p.a1) + 0.09 * Math.sin(5 * a + p.a2)))
}

function buildPond(sx: number, sy: number): Pond | null {
  if (hash2(sx, sy, 11) >= POND_CHANCE) return null
  // Арт-пиксели мокапа; пруд отстоит от краёв своей ячейки на m.
  const r = 26 + hash2(sx, sy, 12) * 26
  const m = r * 1.3 + 14
  const px = sx * SC + m + hash2(sx, sy, 13) * (SC - 2 * m)
  const py = sy * SC + m + hash2(sx, sy, 14) * (SC - 2 * m)
  const a1 = hash2(sx, sy, 15) * 6.28
  const a2 = hash2(sx, sy, 16) * 6.28
  const at = (a: number, dd: number): [number, number] => {
    const R = r * (1 + 0.16 * Math.sin(3 * a + a1) + 0.09 * Math.sin(5 * a + a2)) * dd
    return [Math.round(px + Math.cos(a) * R) * ART_PX, Math.round(py + Math.sin(a) * R * 0.72) * ART_PX]
  }
  const objects: WorldObject[] = []
  const nr = 7 + Math.floor(hash2(sx, sy, 17) * 8)
  for (let i = 0; i < nr; i++) {
    // Камыши кучками: соседние углы, у самой кромки.
    const a = hash2(sx, sy, 20 + (i >> 1)) * 6.28 + (i & 1) * 0.22
    const [x, y] = at(a, 0.93 + hash2(i, sx, sy + 3) * 0.14)
    objects.push(makeObject(pondObjectId(sx, sy, i), x, y, 'reed', 0, Math.floor(hash2(i, sx + 5, sy) * 3)))
  }
  // Кувшинки ставятся всегда; в сцене без них (зима) графика вернёт null и они пропустятся.
  const nl = 2 + Math.floor(hash2(sx, sy, 18) * 4)
  for (let i = 0; i < nl; i++) {
    const [x, y] = at(hash2(i, sx, sy + 40) * 6.28, 0.2 + hash2(i, sx, sy + 41) * 0.45)
    objects.push(makeObject(pondObjectId(sx, sy, nr + i), x, y, 'lily', 0, hash2(i, sx, sy + 42) < 0.45 ? 1 : 0))
  }
  const rw = r * ART_PX
  return Object.freeze({
    id: placeId(sx, sy),
    x: px * ART_PX,
    y: py * ART_PX,
    r: rw,
    a1,
    a2,
    reach: rw * 1.45 + POND_REACH_PAD,
    objects: Object.freeze(objects),
  })
}

/** Пруд ячейки POND_CELL (sx, sy) или null. */
export function pondOfCell(sx: number, sy: number): Pond | null {
  const k = `${sx},${sy}`
  const hit = pondCache.get(k)
  if (hit !== undefined) return hit
  if (pondCache.size >= CACHE_MAX) pondCache.clear()
  const p = buildPond(sx, sy)
  pondCache.set(k, p)
  return p
}

/** Рамка пруда (мир), как у отрисовки мокапа: x ± r·1.45, y ± r·1.1. Вода, берег и опоры камышей — внутри. */
export function pondBox(p: Pond): Bounds {
  return { minX: p.x - p.r * 1.45, minY: p.y - p.r * 1.1, maxX: p.x + p.r * 1.45, maxY: p.y + p.r * 1.1 }
}

function buildChunk(cx: number, cy: number): readonly WorldObject[] {
  const list: WorldObject[] = []
  const pond = pondOfCell(Math.floor(cx / CHUNKS_PER_POND), Math.floor(cy / CHUNKS_PER_POND))
  for (let j = 0; j < SLOTS; j++) {
    for (let i = 0; i < SLOTS; i++) {
      const qx = cx * SLOTS + i
      const qy = cy * SLOTS + j
      const x = qx * G + Math.floor(hash2(qx, qy, 3) * G)
      const y = qy * G + Math.floor(hash2(qx, qy, 4) * G)
      const d = densityArt(x, y)
      const wood = step(0.5, 0.64, d)
      const r = hash2(qx, qy, 5)
      const kind = hash2(qx, qy, 6)
      const v = hash2(qx, qy, 7)
      let k: ObjectKind
      let pal = 0
      let variant = 0
      if (r < wood * 0.82) {
        // В роще преобладает один цвет листвы, но встречаются и чужие.
        const grove = Math.floor(valueNoise(x / 260 + 7, y / 260 + 3, 8) * 4 + v * 1.7) % 4
        if (kind < 0.16) {
          k = 'pine'
          variant = v < 0.5 ? 0 : 1
        } else if (kind < 0.27) {
          k = 'bush'
          pal = grove
          variant = v < 0.5 ? 0 : 1
        } else {
          k = 'tree'
          pal = grove
          variant = Math.floor(v * 3)
        }
      } else if (r > 0.93) {
        if (kind < 0.3) {
          k = 'bush'
          pal = Math.floor(v * 4)
        } else if (kind < 0.55) {
          k = 'stone'
          variant = v < 0.5 ? 0 : 1
        } else {
          k = 'small'
          variant = Math.floor(v * 3)
        }
      } else continue
      // У воды своего пруда не растёт; высоким (дерево, сосна) проверяется точка выше опоры.
      const tall = k === 'tree' || k === 'pine'
      if (pond && pondDistance(pond, x * ART_PX, (y - (tall ? 10 : 0)) * ART_PX) < (tall ? 1.75 : 1.25)) continue
      list.push(makeObject(forestId(qx, qy), x * ART_PX, y * ART_PX, k, pal, variant))
    }
  }
  return Object.freeze(list)
}

/** Лес ячейки WORLD_CHUNK (cx, cy), без объектов пруда. Порядок — по местам (строки, затем столбцы). */
export function chunkObjects(cx: number, cy: number): readonly WorldObject[] {
  const k = `${cx},${cy}`
  const hit = chunkCache.get(k)
  if (hit) return hit
  if (chunkCache.size >= CACHE_MAX) chunkCache.clear()
  const list = buildChunk(cx, cy)
  chunkCache.set(k, list)
  return list
}

function validBounds(b: Bounds): boolean {
  return b.minX <= b.maxX && b.minY <= b.maxY && Number.isFinite(b.minX + b.maxX + b.minY + b.maxY)
}

/** Сравнение порядка рисования: (y, x, id). */
export function compareObjects(a: WorldObject, b: WorldObject): number {
  return a.y - b.y || a.x - b.x || a.id - b.id
}

/** Лес с опорой в границах b (включая границу), по ячейкам; порядок (y, x, id). */
export function objectsIn(b: Bounds): WorldObject[] {
  if (!validBounds(b)) return []
  const out: WorldObject[] = []
  const cx0 = Math.floor(b.minX / WORLD_CHUNK)
  const cx1 = Math.floor(b.maxX / WORLD_CHUNK)
  const cy0 = Math.floor(b.minY / WORLD_CHUNK)
  const cy1 = Math.floor(b.maxY / WORLD_CHUNK)
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      for (const o of chunkObjects(cx, cy)) {
        if (o.x >= b.minX && o.x <= b.maxX && o.y >= b.minY && o.y <= b.maxY) out.push(o)
      }
    }
  }
  return out.sort(compareObjects)
}

/** Пруды, чья рамка (pondBox) пересекает b (включая касание); порядок — по ячейкам (sy, sx). */
export function pondsIn(b: Bounds): Pond[] {
  if (!validBounds(b)) return []
  const out: Pond[] = []
  // Рамка пруда целиком внутри его ячейки, поэтому соседние ячейки смотреть не нужно.
  const sx0 = Math.floor(b.minX / POND_CELL)
  const sx1 = Math.floor(b.maxX / POND_CELL)
  const sy0 = Math.floor(b.minY / POND_CELL)
  const sy1 = Math.floor(b.maxY / POND_CELL)
  for (let sy = sy0; sy <= sy1; sy++) {
    for (let sx = sx0; sx <= sx1; sx++) {
      const p = pondOfCell(sx, sy)
      if (!p) continue
      const f = pondBox(p)
      if (f.maxX >= b.minX && f.minX <= b.maxX && f.maxY >= b.minY && f.minY <= b.maxY) out.push(p)
    }
  }
  return out
}

/**
 * Мелочь земли в границах b (включая границу): для клетки (gx, gy) и места j ∈ [0, GROUND_SLOTS) —
 * x = gx·32 + floor(hash2(gx, gy, 100+4j)·32), y — соль 101+4j, r1 — 102+4j, r2 — 103+4j. Что рисовать, решает графика сцены.
 */
export function eachGroundDetail(b: Bounds, visit: (x: number, y: number, r1: number, r2: number) => void): void {
  if (!validBounds(b)) return
  const gx0 = Math.floor(b.minX / GROUND_CELL)
  const gx1 = Math.floor(b.maxX / GROUND_CELL)
  const gy0 = Math.floor(b.minY / GROUND_CELL)
  const gy1 = Math.floor(b.maxY / GROUND_CELL)
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let j = 0; j < GROUND_SLOTS; j++) {
        const s = 100 + 4 * j
        const x = gx * GROUND_CELL + Math.floor(hash2(gx, gy, s) * GROUND_CELL)
        const y = gy * GROUND_CELL + Math.floor(hash2(gx, gy, s + 1) * GROUND_CELL)
        if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue
        visit(x, y, hash2(gx, gy, s + 2), hash2(gx, gy, s + 3))
      }
    }
  }
}

/** Сбросить кэши ячеек и прудов (для тестов): результат запросов от кэша не зависит. */
export function resetWorldCache(): void {
  chunkCache.clear()
  pondCache.clear()
}
