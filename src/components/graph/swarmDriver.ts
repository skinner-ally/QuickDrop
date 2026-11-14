import {
  displaceScene,
  releaseSwarm,
  setSwarmLead,
  stepSwarm,
  swarmPositions,
  swarmSettled,
  type Swarm,
} from '@/lib/graph/swarm'
import type { GraphScene } from '@/lib/graph/types'
import type { GraphPoint } from '@/types'

/**
 * Ход стаи (lib/graph/swarm) во времени: одна стая на приложение, шаг — по кадрам, а в скрытой вкладке или панели,
 * где кадров нет, — по таймеру (иначе стая не доплыла бы и не закончилась). Холст и подписи подписываются на
 * изменения и берут отсюда сцену со смещёнными нодами.
 */

let swarm: Swarm | null = null
let rev = 0
let raf = 0
let timer: ReturnType<typeof setInterval> | undefined
let last = 0
const listeners = new Set<() => void>()

let shownBase: GraphScene | null = null
let shownRev = -1
let shown: GraphScene | null = null
let posRev = -1
let pos: Map<string, GraphPoint> | null = null

function emit(): void {
  rev += 1
  for (const cb of listeners) cb()
}

function halt(): void {
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  if (timer !== undefined) clearInterval(timer)
  timer = undefined
}

function advance(now: number): void {
  const s = swarm
  if (!s) return
  const dt = Math.min(1, Math.max(0, (now - last) / 1000))
  last = now
  const moving = stepSwarm(s, dt)
  if (swarmSettled(s)) {
    stopSwarm()
    return
  }
  if (moving) emit()
}

function tick(now: number): void {
  raf = swarm ? requestAnimationFrame(tick) : 0
  advance(now)
}

export function getSwarm(): Swarm | null {
  return swarm
}

/** Запустить стаю (прежняя, если была, сразу встаёт на места). */
export function startSwarm(next: Swarm): void {
  stopSwarm()
  swarm = next
  last = performance.now()
  raf = requestAnimationFrame(tick)
  timer = setInterval(() => {
    const now = performance.now()
    if (now - last > 150) advance(now)
  }, 200)
  emit()
}

/** Убрать стаю: ноды рисуются там, где стоят в сцене. */
export function stopSwarm(): void {
  if (!swarm) return
  swarm = null
  shown = null
  shownBase = null
  pos = null
  halt()
  emit()
}

/** Ведущая нода переехала за указателем. */
export function moveSwarmLead(point: GraphPoint): void {
  if (!swarm || swarm.released) return
  setSwarmLead(swarm, point)
  emit()
}

/** Ноду отпустили: стая доплывает до итоговых клеток и сама заканчивается. */
export function dropSwarm(drop: GraphPoint, finals?: Readonly<Record<string, GraphPoint>>): void {
  if (!swarm || swarm.released) return
  releaseSwarm(swarm, drop, finals)
  if (swarm.rigid) stopSwarm()
  else emit()
}

/** Жест отменён: стая возвращается на исходные места. */
export function cancelSwarm(): void {
  if (swarm && !swarm.released) dropSwarm(swarm.leadHome)
}

export function subscribeSwarm(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Текущие положения нод стаи; null — стаи нет. */
export function swarmPoints(): ReadonlyMap<string, GraphPoint> | null {
  if (!swarm) return null
  if (posRev !== rev || !pos) {
    pos = swarmPositions(swarm)
    posRev = rev
  }
  return pos
}

/** Сцена, какой её видно сейчас: ноды стаи — в анимированных положениях. Без стаи — сама base. */
export function shownScene(base: GraphScene): GraphScene {
  const points = swarmPoints()
  if (!points) return base
  if (shownBase !== base || shownRev !== rev || !shown) {
    shown = displaceScene(base, points)
    shownBase = base
    shownRev = rev
  }
  return shown
}
