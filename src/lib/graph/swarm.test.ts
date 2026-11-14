import { describe, expect, it } from 'vitest'
import { GRAPH_CELL, snapToGrid } from '@/lib/graphLayout'
import type { GraphPoint } from '@/types'
import { buildSpatialIndex, queryBounds } from './geometry'
import {
  SWARM_JITTER,
  SWARM_MAX_DELAY,
  SWARM_SETTLE_MAX,
  SWARM_WAVE_SPEED,
  createSwarm,
  displaceScene,
  movedCountText,
  planSwarmDrop,
  releaseSwarm,
  setSwarmLead,
  stepSwarm,
  swarmPositions,
  swarmSettled,
  takenWithoutSwarm,
} from './swarm'
import type { Swarm, SwarmNode } from './swarm'
import type { GraphNode, GraphScene } from './types'

const C = GRAPH_CELL
const cellKey = (p: GraphPoint) => `${Math.round(p.x / C)},${Math.round(p.y / C)}`

/** Стая: ведущая в (0, 0), ведомые — по списку клеток. */
function swarmOf(cells: Array<[number, number]>, rigid = false): Swarm {
  const others: SwarmNode[] = cells.map(([cx, cy], i) => ({ id: `m${i}`, x: cx * C, y: cy * C }))
  return createSwarm({ id: 'lead', x: 0, y: 0 }, others, rigid)
}

/** Шаги по 1/60 с, пока не пройдёт seconds; onStep — после каждого шага. */
function run(swarm: Swarm, seconds: number, onStep?: () => void): void {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
    stepSwarm(swarm, 1 / 60)
    onStep?.()
  }
}

describe('createSwarm', () => {
  it('ведомые без ведущей и негодных точек, от ближних к дальним (при равенстве — по id)', () => {
    const s = createSwarm({ id: 'lead', x: 0, y: 0 }, [
      { id: 'far', x: 10 * C, y: 0 },
      { id: 'lead', x: 0, y: 0 },
      { id: 'b', x: 0, y: C },
      { id: 'a', x: C, y: 0 },
      { id: 'nan', x: Number.NaN, y: 0 },
      { id: 'inf', x: 0, y: Number.POSITIVE_INFINITY },
    ])
    expect(s.members.map((m) => m.id)).toEqual(['a', 'b', 'far'])
    expect(s.leadId).toBe('lead')
    expect(s.leadHome).toEqual({ x: 0, y: 0 })
    expect(s.released).toBe(false)
    for (const m of s.members) expect({ x: m.x, y: m.y, vx: m.vx, vy: m.vy }).toEqual({ x: m.hx, y: m.hy, vx: 0, vy: 0 })
  })

  it('задержка растёт с расстоянием: расстояние / скорость волны ± разброс, не больше предела', () => {
    const cells: Array<[number, number]> = [[1, 0], [3, 0], [6, 0], [10, 0], [40, 0]]
    const s = swarmOf(cells)
    for (const m of s.members) {
      const base = Math.hypot(m.hx, m.hy) / SWARM_WAVE_SPEED
      expect(m.delay).toBeGreaterThanOrEqual(Math.min(SWARM_MAX_DELAY, base * (1 - SWARM_JITTER)) - 1e-12)
      expect(m.delay).toBeLessThanOrEqual(Math.min(SWARM_MAX_DELAY, base * (1 + SWARM_JITTER)) + 1e-12)
    }
    // разброс ±10 % не переставляет ноды, разнесённые больше чем на 25 %
    const delays = s.members.map((m) => m.delay)
    for (let i = 1; i < delays.length; i++) expect(delays[i]).toBeGreaterThan(delays[i - 1])
    // 40 клеток — дальше волны за предел: задержка ровно предел
    expect(delays.at(-1)).toBe(SWARM_MAX_DELAY)
    // нода на месте ведущей ждать не должна
    expect(swarmOf([[0, 0]]).members[0].delay).toBe(0)
  })

  it('пружина у дальних мягче (частота ниже), затухание меньше', () => {
    const s = swarmOf([[1, 0], [20, 0]])
    const [near, far] = s.members
    expect(far.omega).toBeLessThan(near.omega)
    expect(far.zeta).toBeLessThan(near.zeta)
    for (const m of s.members) expect(m.zeta).toBeLessThan(1)
  })
})

describe('stepSwarm', () => {
  it('негодный шаг ничего не делает', () => {
    const s = swarmOf([[1, 0]])
    setSwarmLead(s, { x: 100, y: 0 })
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(stepSwarm(s, dt)).toBe(false)
    expect(s.t).toBe(0)
    expect(s.members[0].x).toBe(C)
  })

  it('setSwarmLead пропускает негодную точку', () => {
    const s = swarmOf([[1, 0]])
    setSwarmLead(s, { x: 10, y: 20 })
    setSwarmLead(s, { x: Number.NaN, y: 0 })
    expect(s.lead).toEqual({ x: 10, y: 20 })
  })

  it('стоящая ведущая — ведомые на месте, кадр не нужен', () => {
    const s = swarmOf([[1, 0], [2, 3]])
    expect(stepSwarm(s, 1 / 60)).toBe(false)
    expect(s.members.map((m) => [m.x, m.y])).toEqual([[C, 0], [2 * C, 3 * C]])
  })

  it('пока не дошла волна, дальняя нода стоит; ближняя уже движется', () => {
    const s = swarmOf([[1, 0], [12, 0]])
    const [near, far] = s.members
    expect(far.delay).toBeGreaterThan(0.3)
    setSwarmLead(s, { x: 5 * C, y: 0 })
    run(s, 0.2)
    expect(far.x).toBe(far.hx)
    expect(far.vx).toBe(0)
    expect(near.x).toBeGreaterThan(near.hx + C)
  })

  it('пружины сходятся: после остановки ведущей все ведомые точно в «месте + сдвиг»; с перехлёстом', () => {
    const cells: Array<[number, number]> = [[1, 0], [0, 2], [-3, 1], [5, -4], [9, 9]]
    const s = swarmOf(cells)
    const shift = { x: 7 * C, y: -2 * C }
    setSwarmLead(s, shift)
    const maxX = new Map<string, number>()
    run(s, 4, () => {
      for (const m of s.members) maxX.set(m.id, Math.max(maxX.get(m.id) ?? -Infinity, m.x))
    })
    for (const m of s.members) {
      expect(m.x).toBe(m.hx + shift.x)
      expect(m.y).toBe(m.hy + shift.y)
      expect(m.vx).toBe(0)
      expect(m.vy).toBe(0)
      // недожатая пружина проскакивает цель
      expect(maxX.get(m.id)!).toBeGreaterThan(m.hx + shift.x)
    }
    expect(stepSwarm(s, 1 / 60)).toBe(false)
  })

  it('устойчиво при большом шаге (вкладка в фоне): одна секунда за раз не разгоняет ноды', () => {
    const s = swarmOf([[1, 0], [4, 4]])
    setSwarmLead(s, { x: 3 * C, y: 0 })
    for (let i = 0; i < 5; i++) stepSwarm(s, 1)
    for (const m of s.members) {
      expect(m.x).toBe(m.hx + 3 * C)
      expect(m.y).toBe(m.hy)
    }
  })

  it('без анимации (rigid) ведомые сразу повторяют сдвиг', () => {
    const s = swarmOf([[1, 0], [20, 5]], true)
    setSwarmLead(s, { x: 2 * C, y: C })
    expect(stepSwarm(s, 1 / 60)).toBe(true)
    for (const m of s.members) expect([m.x, m.y]).toEqual([m.hx + 2 * C, m.hy + C])
    expect(stepSwarm(s, 1 / 60)).toBe(false)
  })
})

describe('releaseSwarm, swarmSettled, swarmPositions', () => {
  it('до отпускания не успокоена; ведущая в swarmPositions — в точке указателя', () => {
    const s = swarmOf([[1, 0]])
    setSwarmLead(s, { x: 33, y: 44 })
    expect(swarmSettled(s)).toBe(false)
    const pos = swarmPositions(s)
    expect(pos.get('lead')).toEqual({ x: 33, y: 44 })
    expect(pos.get('m0')).toEqual({ x: C, y: 0 })
  })

  it('после отпускания все доплывают в свои клетки (finals), ведущая — в drop; успокаивается в пределе времени', () => {
    const s = swarmOf([[1, 0], [0, 1], [2, 2]])
    setSwarmLead(s, { x: 3 * C + 7, y: -5 })
    run(s, 0.3)
    const drop = { x: 3 * C, y: 0 }
    // m0 «уезжает» в свою клетку, m1 и m2 — без finals: «место + сдвиг»
    const finals = { m0: { x: 5 * C, y: 0 } }
    releaseSwarm(s, drop, finals)
    expect(s.released).toBe(true)
    expect(s.members[0].id).toBe('lead')
    // повторное отпускание ничего не меняет
    releaseSwarm(s, { x: 999, y: 999 })
    expect(s.lead).toEqual(drop)

    let elapsed = 0
    while (!swarmSettled(s)) {
      stepSwarm(s, 1 / 60)
      elapsed += 1 / 60
      expect(elapsed).toBeLessThan(SWARM_SETTLE_MAX + 0.1)
    }
    const pos = swarmPositions(s)
    expect(pos.get('lead')).toEqual(drop)
    expect(pos.get('m0')).toEqual(finals.m0)
    expect(pos.get('m1')).toEqual({ x: 3 * C, y: C })
    expect(pos.get('m2')).toEqual({ x: 5 * C, y: 2 * C })
  })

  it('rigid после отпускания успокоена сразу', () => {
    const s = swarmOf([[1, 0]], true)
    releaseSwarm(s, { x: C, y: C })
    expect(swarmSettled(s)).toBe(true)
  })
})

describe('planSwarmDrop', () => {
  it('ведущая — в drop, ведомые — в «место + сдвиг» на сетке, если клетка свободна', () => {
    const s = swarmOf([[1, 0], [0, 1], [-1, -1]])
    const plan = planSwarmDrop(s, { x: 10 * C, y: 4 * C }, {})
    expect(plan).toEqual({
      lead: { x: 10 * C, y: 4 * C },
      m0: { x: 11 * C, y: 4 * C },
      m1: { x: 10 * C, y: 5 * C },
      m2: { x: 9 * C, y: 3 * C },
    })
  })

  it('клетки на сетке, без наложений с чужими нодами и между собой; свои старые места не мешают', () => {
    let seed = 5
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let round = 0; round < 40; round++) {
      // плотная стая 5×5 вокруг ведущей
      const cells: Array<[number, number]> = []
      for (let cy = -2; cy <= 2; cy++) for (let cx = -2; cx <= 2; cx++) if (cx || cy) cells.push([cx, cy])
      const s = swarmOf(cells)
      // чужие ноды — случайно вокруг места броска, в том числе не по сетке; в taken есть и сама стая
      const drop = snapToGrid({ x: (rnd() - 0.5) * 20 * C, y: (rnd() - 0.5) * 20 * C })
      const taken: Record<string, GraphPoint> = { lead: { x: 0, y: 0 } }
      for (const m of s.members) taken[m.id] = { x: m.hx, y: m.hy }
      for (let i = 0; i < 30; i++) {
        taken[`o${i}`] = { x: drop.x + (rnd() - 0.5) * 8 * C, y: drop.y + (rnd() - 0.5) * 8 * C }
      }
      const plan = planSwarmDrop(s, drop, taken)
      expect(Object.keys(plan).sort()).toEqual(['lead', ...s.members.map((m) => m.id)].sort())
      expect(plan.lead).toEqual(drop)
      const foreign = new Set(Object.entries(taken).filter(([id]) => id.startsWith('o')).map(([, p]) => cellKey(p)))
      const used = new Set<string>()
      for (const [id, p] of Object.entries(plan)) {
        expect(snapToGrid(p), id).toEqual(p)
        if (id !== 'lead') expect(foreign.has(cellKey(p)), `${id} в клетке чужой ноды`).toBe(false)
        expect(used.has(cellKey(p)), `${id} делит клетку`).toBe(false)
        used.add(cellKey(p))
      }
    }
  })

  it('занятая клетка — ближайшая свободная; ближние к ведущей выбирают первыми', () => {
    // m0 (клетка 1, 0) и m1 (2, 0); при броске в (0, 0) с тем же местом m0 встаёт на свою клетку,
    // а клетку m1 занимает чужая нода — m1 уходит в ближайшую свободную.
    const s = swarmOf([[1, 0], [2, 0]])
    const plan = planSwarmDrop(s, { x: 0, y: 0 }, { other: { x: 2 * C, y: 0 } })
    expect(plan.m0).toEqual({ x: C, y: 0 })
    expect(plan.m1).not.toEqual({ x: 2 * C, y: 0 })
    expect(Math.max(Math.abs(plan.m1.x - 2 * C), Math.abs(plan.m1.y)) / C).toBe(1)
  })
})

describe('takenWithoutSwarm', () => {
  it('убирает ведомых, остальное (и ведущую) оставляет; без стаи — всё', () => {
    const s = swarmOf([[1, 0]])
    const taken: Array<[string, GraphPoint]> = [['lead', { x: 0, y: 0 }], ['m0', { x: C, y: 0 }], ['x', { x: 5, y: 5 }]]
    expect(takenWithoutSwarm(taken, s)).toEqual({ lead: { x: 0, y: 0 }, x: { x: 5, y: 5 } })
    expect(takenWithoutSwarm(taken, null)).toEqual(Object.fromEntries(taken))
  })
})

describe('displaceScene', () => {
  function scene(points: Array<[string, number, number]>): GraphScene {
    const nodes: GraphNode[] = points.map(([id, x, y]) => ({
      id, x, y, color: 'none', zone: 'none', inbox: false, archived: false, favorite: false, dim: false, title: id, links: [],
    }))
    return {
      nodes, byId: new Map(nodes.map((n, i) => [n.id, i])), links: [], bounds: null, index: buildSpatialIndex(nodes), matched: nodes.length,
    }
  }

  it('без сдвигов — та же сцена', () => {
    const s = scene([['a', 0, 0], ['b', C, 0]])
    expect(displaceScene(s, new Map())).toBe(s)
    expect(displaceScene(s, new Map([['a', { x: 0, y: 0 }], ['zz', { x: 9, y: 9 }]]))).toBe(s)
  })

  it('сдвинутые ноды — в новых точках, остальные — те же объекты; порядок и индекс', () => {
    const s = scene([['a', 0, 0], ['b', C, 0], ['c', 2 * C, 0]])
    const moved = displaceScene(s, new Map([['b', { x: 500, y: 700 }]]))
    expect(moved).not.toBe(s)
    expect(moved.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c'])
    expect(moved.nodes[0]).toBe(s.nodes[0])
    expect(moved.nodes[2]).toBe(s.nodes[2])
    expect(moved.nodes[1]).toMatchObject({ id: 'b', x: 500, y: 700 })
    // исходная сцена не тронута
    expect(s.nodes[1]).toMatchObject({ x: C, y: 0 })
    expect(moved.byId).toBe(s.byId)
    expect(moved.links).toBe(s.links)
    // индекс перестроен: нода ищется на новом месте и не ищется на старом
    expect(queryBounds(moved.index, moved.nodes, { minX: 490, minY: 690, maxX: 510, maxY: 710 })).toEqual([1])
    expect(queryBounds(moved.index, moved.nodes, { minX: C - 5, minY: -5, maxX: C + 5, maxY: 5 })).toEqual([])
  })
})

describe('movedCountText', () => {
  it('склонение: 1, 2, 5, 11, 21, 112 и соседние', () => {
    expect(movedCountText(1)).toBe('Перемещена 1 запись')
    expect(movedCountText(2)).toBe('Перемещено 2 записи')
    expect(movedCountText(4)).toBe('Перемещено 4 записи')
    expect(movedCountText(5)).toBe('Перемещено 5 записей')
    expect(movedCountText(11)).toBe('Перемещено 11 записей')
    expect(movedCountText(12)).toBe('Перемещено 12 записей')
    expect(movedCountText(14)).toBe('Перемещено 14 записей')
    expect(movedCountText(21)).toBe('Перемещена 21 запись')
    expect(movedCountText(22)).toBe('Перемещено 22 записи')
    expect(movedCountText(101)).toBe('Перемещена 101 запись')
    expect(movedCountText(111)).toBe('Перемещено 111 записей')
    expect(movedCountText(112)).toBe('Перемещено 112 записей')
    expect(movedCountText(0)).toBe('Перемещено 0 записей')
  })
})
