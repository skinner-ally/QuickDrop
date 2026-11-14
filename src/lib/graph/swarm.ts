/**
 * «Стая» при переносе ноды: ноды той же категории плывут за ведущей, как щупальца медузы.
 * Чистая логика без DOM и времени: состояние, шаг пружин, итоговые клетки и сцена со смещёнными нодами.
 *
 * Модель. Цель каждой ведомой — «исходное место + сдвиг ведущей», но сдвиг берётся из прошлого: с запаздыванием,
 * растущим с расстоянием до ведущей (волна бежит от неё наружу). К цели нода идёт недожатой пружиной — отсюда
 * лёгкий перехлёст и колыхание при остановке; дальние ноды мягче и качаются дольше.
 */

import { createSpotFinder } from '@/lib/graphLayout'
import type { GraphPoint } from '@/types'
import { buildSpatialIndex } from './geometry'
import type { GraphScene } from './types'

/** Скорость волны от ведущей ноды, мировые px/с: запаздывание = расстояние / скорость. */
export const SWARM_WAVE_SPEED = 1300
/** Предел запаздывания, с (ноды, унесённые далеко от своей зоны, не ждут дольше). */
export const SWARM_MAX_DELAY = 0.6
/** Расстояние, на котором пружина становится самой мягкой, мировые px. */
export const SWARM_RANGE = 640
/** Собственная частота пружины, рад/с: у ведущей и на краю стаи. */
export const SWARM_OMEGA_NEAR = 15
export const SWARM_OMEGA_FAR = 8
/** Коэффициент затухания (< 1 — с перехлёстом): у ведущей и на краю стаи. */
export const SWARM_ZETA_NEAR = 0.68
export const SWARM_ZETA_FAR = 0.55
/** Разброс частоты и запаздывания между соседями (доля): стая не движется жёстким листом. */
export const SWARM_JITTER = 0.1
/** Шаг интегрирования, с. */
export const SWARM_STEP = 1 / 120
/** Ближе этого к цели и медленнее этого нода считается пришедшей (мировые px и px/с): без дрожания на месте. */
export const SWARM_REST_DIST = 0.3
export const SWARM_REST_SPEED = 4
/** После отпускания стая обязана успокоиться за это время, с. */
export const SWARM_SETTLE_MAX = 3

export interface SwarmMember {
  id: string
  /** Исходное место. */
  hx: number
  hy: number
  /** Текущее положение и скорость (мир). */
  x: number
  y: number
  vx: number
  vy: number
  delay: number
  omega: number
  zeta: number
  /** Поправка цели после отпускания: итоговая клетка минус «исходное место + итоговый сдвиг». */
  fx: number
  fy: number
}

export interface Swarm {
  leadId: string
  leadHome: GraphPoint
  /** Текущая точка ведущей ноды (за указателем; после отпускания — её клетка). */
  lead: GraphPoint
  members: SwarmMember[]
  /** Без анимации (prefers-reduced-motion): ведомые жёстко повторяют сдвиг. */
  rigid: boolean
  /** Время стаи, с. */
  t: number
  /** История сдвига ведущей: тройки (t, dx, dy) по возрастанию t. */
  hist: number[]
  released: boolean
  releasedAt: number
}

export interface SwarmNode {
  id: string
  x: number
  y: number
}

/** Детерминированный «случайный» множитель 1 ± SWARM_JITTER по номеру. */
function jitter(i: number, salt: number): number {
  const s = Math.sin((i + 1) * 12.9898 + salt * 78.233) * 43758.5453
  return 1 + (s - Math.floor(s) - 0.5) * 2 * SWARM_JITTER
}

function makeMember(node: SwarmNode, dist: number, i: number): SwarmMember {
  const f = Math.min(1, dist / SWARM_RANGE)
  return {
    id: node.id,
    hx: node.x,
    hy: node.y,
    x: node.x,
    y: node.y,
    vx: 0,
    vy: 0,
    delay: Math.min(SWARM_MAX_DELAY, (dist / SWARM_WAVE_SPEED) * jitter(i, 1)),
    omega: (SWARM_OMEGA_NEAR + (SWARM_OMEGA_FAR - SWARM_OMEGA_NEAR) * f) * jitter(i, 2),
    zeta: SWARM_ZETA_NEAR + (SWARM_ZETA_FAR - SWARM_ZETA_NEAR) * f,
    fx: 0,
    fy: 0,
  }
}

/** Стая: ведущая нода и ведомые (без неё самой). Ведомые упорядочены от ближних к дальним. */
export function createSwarm(lead: SwarmNode, others: readonly SwarmNode[], rigid = false): Swarm {
  const members = others
    .filter((n) => n.id !== lead.id && Number.isFinite(n.x) && Number.isFinite(n.y))
    .map((n) => ({ n, d: Math.hypot(n.x - lead.x, n.y - lead.y) }))
    .sort((a, b) => a.d - b.d || (a.n.id < b.n.id ? -1 : 1))
    .map(({ n, d }, i) => makeMember(n, d, i))
  return {
    leadId: lead.id,
    leadHome: { x: lead.x, y: lead.y },
    lead: { x: lead.x, y: lead.y },
    members,
    rigid,
    t: 0,
    hist: [0, 0, 0],
    released: false,
    releasedAt: 0,
  }
}

/** Ведущая нода переехала (точка мира). */
export function setSwarmLead(swarm: Swarm, point: GraphPoint): void {
  if (Number.isFinite(point.x) && Number.isFinite(point.y)) swarm.lead = { x: point.x, y: point.y }
}

const SHIFT: [number, number] = [0, 0]

/** Сдвиг ведущей в момент t (линейно между отсчётами истории) → SHIFT. */
function shiftAt(hist: readonly number[], t: number): void {
  const n = hist.length
  let i = n - 3
  while (i > 0 && hist[i] > t) i -= 3
  if (hist[i] >= t || i === n - 3) {
    SHIFT[0] = hist[i + 1]
    SHIFT[1] = hist[i + 2]
    return
  }
  const span = hist[i + 3] - hist[i]
  const f = span > 0 ? (t - hist[i]) / span : 1
  SHIFT[0] = hist[i + 1] + (hist[i + 4] - hist[i + 1]) * f
  SHIFT[1] = hist[i + 2] + (hist[i + 5] - hist[i + 2]) * f
}

/**
 * Шаг стаи на dt секунд. true — хоть одна ведомая сдвинулась (нужен кадр).
 * Интегрирование — полунеявный Эйлер шагами SWARM_STEP: устойчив при любом dt (в скрытой вкладке шаг идёт по таймеру).
 */
export function stepSwarm(swarm: Swarm, dt: number): boolean {
  if (!(dt > 0) || !Number.isFinite(dt)) return false
  swarm.t += dt
  const hist = swarm.hist
  hist.push(swarm.t, swarm.lead.x - swarm.leadHome.x, swarm.lead.y - swarm.leadHome.y)
  // История нужна не глубже самого большого запаздывания.
  const keepFrom = swarm.t - SWARM_MAX_DELAY - 0.2
  let drop = 0
  while (drop + 3 < hist.length && hist[drop + 3] < keepFrom) drop += 3
  if (drop > 0) hist.splice(0, drop)

  let moving = false
  const steps = Math.max(1, Math.ceil(dt / SWARM_STEP))
  const h = dt / steps
  for (const m of swarm.members) {
    shiftAt(hist, swarm.rigid ? swarm.t : swarm.t - m.delay)
    const tx = m.hx + SHIFT[0] + m.fx
    const ty = m.hy + SHIFT[1] + m.fy
    if (swarm.rigid) {
      if (m.x !== tx || m.y !== ty) moving = true
      m.x = tx
      m.y = ty
      continue
    }
    const k = m.omega * m.omega
    const c = 2 * m.zeta * m.omega
    const x0 = m.x
    const y0 = m.y
    for (let s = 0; s < steps; s++) {
      m.vx += (k * (tx - m.x) - c * m.vx) * h
      m.vy += (k * (ty - m.y) - c * m.vy) * h
      m.x += m.vx * h
      m.y += m.vy * h
    }
    if (Math.hypot(tx - m.x, ty - m.y) < SWARM_REST_DIST && Math.hypot(m.vx, m.vy) < SWARM_REST_SPEED) {
      m.x = tx
      m.y = ty
      m.vx = 0
      m.vy = 0
    }
    if (m.x !== x0 || m.y !== y0) moving = true
  }
  return moving
}

/**
 * Ноду отпустили: ведущая встаёт в drop, ведомые доплывают в finals (id → клетка; нет в finals — «исходное место +
 * итоговый сдвиг»). Ведущая становится членом стаи и доходит до клетки той же пружиной.
 */
export function releaseSwarm(swarm: Swarm, drop: GraphPoint, finals: Readonly<Record<string, GraphPoint>> = {}): void {
  if (swarm.released) return
  const from = swarm.lead
  const sx = drop.x - swarm.leadHome.x
  const sy = drop.y - swarm.leadHome.y
  for (const m of swarm.members) {
    const f = finals[m.id]
    m.fx = f ? f.x - (m.hx + sx) : 0
    m.fy = f ? f.y - (m.hy + sy) : 0
  }
  const lead = makeMember({ id: swarm.leadId, x: swarm.leadHome.x, y: swarm.leadHome.y }, 0, 0)
  lead.x = from.x
  lead.y = from.y
  swarm.members.unshift(lead)
  swarm.lead = { x: drop.x, y: drop.y }
  swarm.released = true
  swarm.releasedAt = swarm.t
}

/** Стая после отпускания успокоилась: все на местах (или вышло время). */
export function swarmSettled(swarm: Swarm): boolean {
  if (!swarm.released) return false
  if (swarm.rigid || swarm.t - swarm.releasedAt > SWARM_SETTLE_MAX) return true
  if (swarm.t - swarm.releasedAt <= SWARM_MAX_DELAY) return false
  const sx = swarm.lead.x - swarm.leadHome.x
  const sy = swarm.lead.y - swarm.leadHome.y
  for (const m of swarm.members) {
    if (m.vx !== 0 || m.vy !== 0 || m.x !== m.hx + sx + m.fx || m.y !== m.hy + sy + m.fy) return false
  }
  return true
}

/** Текущие положения нод стаи: ведомые и ведущая. */
export function swarmPositions(swarm: Swarm): Map<string, GraphPoint> {
  const out = new Map<string, GraphPoint>()
  if (!swarm.released) out.set(swarm.leadId, swarm.lead)
  for (const m of swarm.members) out.set(m.id, { x: m.x, y: m.y })
  return out
}

/**
 * Итоговые клетки группы: ведущая — в drop, ведомая — в «исходное место + сдвиг ведущей» на сетке; клетка занята
 * чужой нодой (или уже отдана) — ближайшая свободная. Ближние к ведущей выбирают первыми. taken — все занятые
 * положения (в том числе скрытых нод); положения самой группы в нём не считаются. Результат включает ведущую.
 */
export function planSwarmDrop(
  swarm: Swarm,
  drop: GraphPoint,
  taken: Readonly<Record<string, GraphPoint>>,
): Record<string, GraphPoint> {
  const group = new Set<string>([swarm.leadId])
  for (const m of swarm.members) group.add(m.id)
  const occupied: Record<string, GraphPoint> = {}
  for (const id of Object.keys(taken)) if (!group.has(id)) occupied[id] = taken[id]
  const sx = drop.x - swarm.leadHome.x
  const sy = drop.y - swarm.leadHome.y
  const out: Record<string, GraphPoint> = { [swarm.leadId]: { x: drop.x, y: drop.y } }
  occupied[swarm.leadId] = out[swarm.leadId]
  const spotFor = createSpotFinder(occupied)
  for (const m of swarm.members) {
    if (m.id === swarm.leadId) continue
    out[m.id] = spotFor({ x: m.hx + sx, y: m.hy + sy })
  }
  return out
}

/**
 * Занятые положения для клетки ведущей ноды во время переноса: всё, кроме самой стаи (она уедет вместе с ведущей).
 */
export function takenWithoutSwarm(
  taken: Iterable<readonly [string, GraphPoint]>,
  swarm: Swarm | null,
): Record<string, GraphPoint> {
  const skip = new Set<string>()
  if (swarm) for (const m of swarm.members) skip.add(m.id)
  const out: Record<string, GraphPoint> = {}
  for (const [id, p] of taken) if (!skip.has(id)) out[id] = p
  return out
}

/**
 * Сцена, в которой ноды стаи стоят в текущих (анимированных) положениях: по ней рисуются ноды, связи, выделение и
 * считается попадание указателя. Порядок нод и индексы связей прежние; пространственный индекс — заново.
 */
export function displaceScene(scene: GraphScene, positions: ReadonlyMap<string, GraphPoint>): GraphScene {
  if (positions.size === 0) return scene
  let changed = false
  const nodes = scene.nodes.map((n) => {
    const p = positions.get(n.id)
    if (!p || (p.x === n.x && p.y === n.y)) return n
    changed = true
    return { ...n, x: p.x, y: p.y }
  })
  return changed ? { ...scene, nodes, index: buildSpatialIndex(nodes) } : scene
}

/** «N записей» для toast о переносе группы. */
export function movedCountText(n: number): string {
  const d = n % 10
  const h = n % 100
  if (d === 1 && h !== 11) return `Перемещена ${n} запись`
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return `Перемещено ${n} записи`
  return `Перемещено ${n} записей`
}
