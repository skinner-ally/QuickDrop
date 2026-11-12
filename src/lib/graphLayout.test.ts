import { describe, expect, it } from 'vitest'
import type { GraphPoint, Item } from '@/types'
import { fitCamera } from './graph/geometry'
import type { Bounds } from './graph/types'
import {
  GRAPH_CELL,
  GRAPH_MOAT,
  GRAPH_NODE_SIZE,
  GRAPH_NONE_ZONE,
  GRAPH_ZONE_GAP,
  computeLayout as rawComputeLayout,
  findFreeSpot,
  snapToGrid,
  toLayoutNodes,
} from './graphLayout'
import type { LayoutNode, LayoutResult } from './graphLayout'

// ───────────────────────── помощники ─────────────────────────

function node(id: string, categoryId: string | null = null, links: string[] = [], createdAt = 0): LayoutNode {
  return { id, categoryId, links, createdAt }
}

/** Генератор с фиксированным зерном: тесты не должны зависеть от Math.random. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(list: readonly T[], rand: () => number): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

interface TestGraph {
  nodes: LayoutNode[]
  categories: string[]
}

/** Случайный граф: часть записей без категории, связи двунаправленные, доля inside — внутри категории. */
function makeGraph(count: number, categoryCount: number, linkCount: number, seed: number, inside = 0.66): TestGraph {
  const rand = mulberry32(seed)
  const categories = Array.from({ length: categoryCount }, (_, i) => `cat-${String(i).padStart(2, '0')}`)
  const links = new Map<string, Set<string>>()
  const nodes: LayoutNode[] = []
  const byZone = new Map<string, string[]>()
  for (let i = 0; i < count; i++) {
    const id = `n${String(i).padStart(5, '0')}`
    const categoryId = rand() < 0.15 ? null : categories[Math.floor(rand() * categoryCount)]
    // Каждая третья запись создана в ту же миллисекунду, что и предыдущая: порядок добивается по id.
    const createdAt = 1_700_000_000_000 + Math.floor(i / 3) * 1000
    nodes.push({ id, categoryId, links: [], createdAt })
    links.set(id, new Set())
    const zone = categoryId ?? GRAPH_NONE_ZONE
    byZone.set(zone, [...(byZone.get(zone) ?? []), id])
  }
  let made = 0
  while (made < linkCount) {
    const a = nodes[Math.floor(rand() * count)]
    let bId: string
    if (rand() < inside) {
      const mates = byZone.get(a.categoryId ?? GRAPH_NONE_ZONE)!
      bId = mates[Math.floor(rand() * mates.length)]
    } else {
      bId = nodes[Math.floor(rand() * count)].id
    }
    if (bId === a.id || links.get(a.id)!.has(bId)) continue
    links.get(a.id)!.add(bId)
    links.get(bId)!.add(a.id)
    made++
  }
  for (const n of nodes) n.links = [...links.get(n.id)!]
  return { nodes, categories }
}

const cellOf = (p: GraphPoint) => `${Math.round(p.x / GRAPH_CELL)},${Math.round(p.y / GRAPH_CELL)}`
const dist = (a: GraphPoint, b: GraphPoint) => Math.hypot(a.x - b.x, a.y - b.y)
/** Расстояние в клетках по большей из осей: 1 — соседние клетки (в т.ч. по диагонали). */
const cellGap = (a: GraphPoint, b: GraphPoint) =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) / GRAPH_CELL

function toRecord(positions: Map<string, GraphPoint>): Record<string, GraphPoint> {
  return Object.fromEntries(positions)
}

function expectNoSharedCells(result: LayoutResult) {
  const cells = new Set<string>()
  for (const p of result.positions.values()) cells.add(cellOf(p))
  expect(cells.size).toBe(result.positions.size)
}

/** Сравнение целиком, включая порядок записей в positions. */
function snapshot(result: LayoutResult) {
  return {
    positions: [...result.positions],
    placed: result.placed,
    displaced: result.displaced,
    zones: result.zones,
    bounds: result.bounds,
  }
}

/**
 * computeLayout с общей проверкой после любого вызова: клетки всех нод различны, разведённые — подмножество placed.
 */
function computeLayout(...args: Parameters<typeof rawComputeLayout>): LayoutResult {
  const result = rawComputeLayout(...args)
  expectNoSharedCells(result)
  const placed = new Set(result.placed)
  for (const id of result.displaced) expect(placed.has(id)).toBe(true)
  return result
}

// ───────────────────────── computeLayout ─────────────────────────

describe('computeLayout: детерминированность', () => {
  const { nodes, categories } = makeGraph(400, 6, 600, 11)

  it('повторный вызов даёт тот же результат', () => {
    const first = computeLayout(nodes, categories, {})
    const second = computeLayout(nodes, categories, {})
    expect(snapshot(second)).toEqual(snapshot(first))
  })

  it('порядок нод и связей на входе не влияет на результат', () => {
    const rand = mulberry32(5)
    const mixed = shuffled(nodes, rand).map((n) => ({ ...n, links: shuffled(n.links, rand) }))
    expect(snapshot(computeLayout(mixed, categories, {}))).toEqual(snapshot(computeLayout(nodes, categories, {})))
  })

  it('не зависит от порядка ключей в сохранённых положениях', () => {
    const saved = toRecord(computeLayout(nodes.slice(0, 200), categories, {}).positions)
    const reversed = Object.fromEntries(Object.entries(saved).reverse())
    expect(snapshot(computeLayout(nodes, categories, reversed))).toEqual(
      snapshot(computeLayout(nodes, categories, saved)),
    )
  })

  it('не меняет входные данные', () => {
    const frozenNodes = nodes.map((n) => Object.freeze({ ...n, links: Object.freeze([...n.links]) }))
    const fixed = Object.freeze({ [nodes[0].id]: Object.freeze({ x: 64, y: 64 }) })
    expect(() => computeLayout(Object.freeze(frozenNodes), Object.freeze([...categories]), fixed)).not.toThrow()
  })

  it('положения выдаются в порядке (createdAt, id), все — в узлах сетки', () => {
    const result = computeLayout(shuffled(nodes, mulberry32(9)), categories, {})
    const expected = [...nodes].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1)).map((n) => n.id)
    expect([...result.positions.keys()]).toEqual(expected)
    for (const p of result.positions.values()) expect(snapToGrid(p)).toEqual(p)
    expect([...result.placed].sort()).toEqual([...expected].sort())
  })
})

describe('computeLayout: наложения', () => {
  it('нет двух нод в одной клетке', () => {
    const { nodes, categories } = makeGraph(500, 8, 900, 3)
    const result = computeLayout(nodes, categories, {})
    expect(result.positions.size).toBe(500)
    expectNoSharedCells(result)
  })

  it('новые ноды не встают в клетки сохранённых, даже если те стоят не по сетке', () => {
    const { nodes, categories } = makeGraph(300, 5, 400, 21)
    const rand = mulberry32(8)
    // Сохранённые положения — где попало вокруг центра, со сдвигом от узлов сетки и в разных клетках.
    const fixed: Record<string, GraphPoint> = {}
    const usedCells = new Set<string>()
    for (const n of nodes.slice(0, 120)) {
      for (;;) {
        const p = { x: Math.round((rand() - 0.5) * 900), y: Math.round((rand() - 0.5) * 900) }
        if (usedCells.has(cellOf(p))) continue
        usedCells.add(cellOf(p))
        fixed[n.id] = p
        break
      }
    }
    const result = computeLayout(nodes, categories, fixed)
    expectNoSharedCells(result)
    expect(result.placed).toHaveLength(180)
    // Квадрат новой ноды не пересекается ни с чьим: центры разнесены хотя бы по одной оси не меньше чем на
    // сторону ноды. Пары сохранённых не проверяются — их расставил пользователь.
    const all = [...result.positions.values()]
    for (const id of result.placed) {
      const p = result.positions.get(id)!
      for (const q of all) {
        if (q === p) continue
        const apart = Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y))
        expect(apart).toBeGreaterThanOrEqual(GRAPH_NODE_SIZE)
      }
    }
  })
})

describe('computeLayout: сохранённые положения', () => {
  it('возвращаются без изменений и не попадают в placed', () => {
    const nodes = [node('a', 'c1', ['b'], 1), node('b', 'c1', ['a'], 2), node('c', 'c2', [], 3), node('d', null, [], 4)]
    const fixed = { a: { x: 100, y: 37 }, c: { x: -513, y: 2048 } }
    const result = computeLayout(nodes, ['c1', 'c2'], fixed)
    expect(result.positions.get('a')).toEqual({ x: 100, y: 37 })
    expect(result.positions.get('c')).toEqual({ x: -513, y: 2048 })
    expect([...result.placed].sort()).toEqual(['b', 'd'])
    expect(fixed).toEqual({ a: { x: 100, y: 37 }, c: { x: -513, y: 2048 } })
  })

  it('повторная раскладка с сохранёнными положениями всех нод ничего не размещает', () => {
    const { nodes, categories } = makeGraph(300, 5, 400, 4)
    const first = computeLayout(nodes, categories, {})
    const second = computeLayout(nodes, categories, toRecord(first.positions))
    expect(second.placed).toEqual([])
    expect([...second.positions]).toEqual([...first.positions])
    expect(second.bounds).toEqual(first.bounds)
  })

  it('клетки сохранённых положений скрытых записей не занимаются', () => {
    // Запись из корзины держит место в самом центре зоны «без категории».
    const lone = computeLayout([node('a')], [], { ghost: { x: 0, y: 0 } })
    expect(lone.positions.get('a')).not.toEqual({ x: 0, y: 0 })
    expect(lone.positions.has('ghost')).toBe(false)

    // Скрытые записи занимают каждую вторую клетку вокруг центра — ноды встают только между ними.
    const ghosts: Record<string, GraphPoint> = {}
    for (let cy = -6; cy <= 6; cy++) {
      for (let cx = -6; cx <= 6; cx++) {
        if ((cx + cy) % 2 === 0) ghosts[`ghost:${cx}:${cy}`] = { x: cx * GRAPH_CELL + 5, y: cy * GRAPH_CELL - 7 }
      }
    }
    const nodes = Array.from({ length: 40 }, (_, i) => node(`n${i}`, null, i > 0 ? [`n${i - 1}`] : [], i))
    const result = computeLayout(nodes, [], ghosts)
    const ghostCells = new Set(Object.values(ghosts).map(cellOf))
    for (const p of result.positions.values()) expect(ghostCells.has(cellOf(p))).toBe(false)
    expect(result.positions.size).toBe(40)
    expectNoSharedCells(result)
  })

  it('две сохранённые ноды в одной клетке: первая остаётся, вторая разводится в ближайшую свободную клетку', () => {
    const fixed = { a: { x: 0, y: 0 }, b: { x: 5, y: -3 } }
    const nodes = [node('a', null, [], 1), node('b', null, [], 2), node('c', null, [], 3)]
    const result = computeLayout(nodes, [], fixed)
    expect(result.positions.get('a')).toEqual({ x: 0, y: 0 })
    // Ближайшая к (5, −3) свободная клетка — справа: 27² + 3² против 5² + 29² у клетки сверху.
    expect(result.positions.get('b')).toEqual({ x: 32, y: 0 })
    expect(result.displaced).toEqual(['b'])
    expect(result.placed).toEqual(['b', 'c'])
    expect(cellOf(result.positions.get('c')!)).not.toBe(cellOf({ x: 0, y: 0 }))

    // Не зависит от порядка нод на входе и ключей fixed.
    const reversedFixed = { b: { x: 5, y: -3 }, a: { x: 0, y: 0 } }
    expect(snapshot(computeLayout([...nodes].reverse(), [], reversedFixed))).toEqual(snapshot(result))
  })

  it('первой остаётся нода, раньше созданная, а не стоящая раньше по id', () => {
    const fixed = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }
    const result = computeLayout([node('a', null, [], 2), node('b', null, [], 1)], [], fixed)
    expect(result.positions.get('b')).toEqual({ x: 0, y: 0 })
    expect(result.displaced).toEqual(['a'])
    // Ничья по расстоянию — меньший y, затем меньший x.
    expect(result.positions.get('a')).toEqual({ x: 0, y: -32 })
  })

  it('три ноды в одной клетке разводятся по порядку в ближайшие клетки', () => {
    const fixed = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, c: { x: 0, y: 0 } }
    const result = computeLayout([node('c', null, [], 3), node('a', null, [], 1), node('b', null, [], 2)], [], fixed)
    expect(result.positions.get('a')).toEqual({ x: 0, y: 0 })
    expect(result.positions.get('b')).toEqual({ x: 0, y: -32 })
    expect(result.positions.get('c')).toEqual({ x: -32, y: 0 })
    expect(result.displaced).toEqual(['b', 'c'])
    expect(result.placed).toEqual(['b', 'c'])
  })

  it('сохранённая точка не по сетке занимает свою клетку и остаётся как есть', () => {
    // (20, 3) и (30, 0) — обе в клетке (1, 0).
    const fixed = { a: { x: 20, y: 3 }, b: { x: 30, y: 0 } }
    const result = computeLayout([node('a', null, [], 1), node('b', null, [], 2)], [], fixed)
    expect(result.positions.get('a')).toEqual({ x: 20, y: 3 })
    expect(result.positions.get('b')).toEqual({ x: 0, y: 0 })
    expect(result.displaced).toEqual(['b'])
  })

  it('скрытая запись держит клетку, но видимую ноду с той же клеткой не вытесняет', () => {
    const fixed = { ghost: { x: 0, y: 0 }, a: { x: 3, y: 2 }, b: { x: 96, y: 0 }, other: { x: 100, y: 5 } }
    const result = computeLayout([node('a', null, [], 1), node('b', null, [], 2), node('c', null, [], 3)], [], fixed)
    expect(result.positions.get('a')).toEqual({ x: 3, y: 2 })
    expect(result.positions.get('b')).toEqual({ x: 96, y: 0 })
    expect(result.displaced).toEqual([])
    expect(result.placed).toEqual(['c'])
    expect(result.positions.has('ghost')).toBe(false)
  })

  it('разведённая нода не попадает в клетку скрытой записи', () => {
    // Ближайшая к (0, 0) клетка сверху занята скрытой записью — разведённая нода встаёт слева.
    const fixed = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, ghost: { x: 0, y: -32 } }
    const result = computeLayout([node('a', null, [], 1), node('b', null, [], 2)], [], fixed)
    expect(result.positions.get('b')).toEqual({ x: -32, y: 0 })
  })

  it('связанная нода тянется и к соседу, и к центру зоны', () => {
    // Центр зоны — (0, 0) (медиана сохранённых), сосед далеко в своей зоне — в клетке (10, 0).
    // Только по связи нода встала бы вплотную, в (9, 0); с притяжением к центру — на клетку ближе к нему.
    const fixed = { s1: { x: 0, y: 0 }, s2: { x: 0, y: 32 }, far: { x: 320, y: 0 } }
    const nodes = [node('s1', null, [], 1), node('s2', null, [], 2), node('far', null, [], 3), node('new', null, ['far'], 4)]
    const result = computeLayout(nodes, [], fixed)
    expect(result.zones[0]).toMatchObject({ x: 0, y: 0 })
    expect(result.placed).toEqual(['new'])
    expect(result.positions.get('new')).toEqual({ x: 256, y: 0 })
  })

  it('негодные сохранённые положения не считаются: нода размещается заново', () => {
    const fixed = { a: { x: Number.NaN, y: 0 }, b: { x: 0, y: Number.POSITIVE_INFINITY } }
    const result = computeLayout([node('a', null, [], 1), node('b', null, [], 2)], [], fixed)
    expect(result.placed).toEqual(['a', 'b'])
    expect(result.positions.get('a')).toEqual({ x: 0, y: 0 })
  })

  it('id, совпадающий с именем свойства прототипа, не считается сохранённым', () => {
    const result = computeLayout([node('constructor'), node('__proto__')], [], {})
    expect([...result.placed].sort()).toEqual(['__proto__', 'constructor'])
    for (const p of result.positions.values()) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
  })

  it('новая нода при сохранённых положениях остальных никого не сдвигает и встаёт у своей зоны', () => {
    const { nodes, categories } = makeGraph(400, 6, 500, 17)
    const before = computeLayout(nodes, categories, {})
    const saved = toRecord(before.positions)

    const fresh = node('zz-new', categories[2], [], 1_800_000_000_000)
    const after = computeLayout([...nodes, fresh], categories, saved)
    expect(after.placed).toEqual(['zz-new'])
    for (const [id, p] of before.positions) expect(after.positions.get(id)).toEqual(p)

    const zone = after.zones.find((z) => z.key === categories[2])!
    const spot = after.positions.get('zz-new')!
    expect(dist(spot, zone)).toBeLessThanOrEqual(zone.r)
    expect(Object.values(saved).map(cellOf)).not.toContain(cellOf(spot))
    // Ближе к своей зоне, чем к любой другой.
    for (const other of after.zones) {
      if (other.key !== zone.key) expect(dist(spot, other)).toBeGreaterThan(dist(spot, zone))
    }
  })

  it('новая нода, связанная с нодой на краю зоны, встаёт рядом с ней', () => {
    const { nodes, categories } = makeGraph(400, 6, 500, 17)
    const before = computeLayout(nodes, categories, {})
    const zone = before.zones.find((z) => z.key === categories[1])!
    const mates = nodes.filter((n) => n.categoryId === categories[1])
    // Самая дальняя от центра нода зоны: вокруг неё точно есть свободные клетки.
    const edge = mates.reduce((far, n) =>
      dist(before.positions.get(n.id)!, zone) > dist(before.positions.get(far.id)!, zone) ? n : far,
    )
    const fresh = node('zz-new', categories[1], [edge.id], 1_800_000_000_000)
    const after = computeLayout([...nodes, fresh], categories, toRecord(before.positions))
    expect(after.placed).toEqual(['zz-new'])
    expect(cellGap(after.positions.get('zz-new')!, before.positions.get(edge.id)!)).toBeLessThanOrEqual(2)
  })

  it('зона новой категории обходит уже разложенные зоны', () => {
    const { nodes, categories } = makeGraph(300, 4, 300, 23)
    const before = computeLayout(nodes, categories, {})
    const fresh = Array.from({ length: 5 }, (_, i) => node(`new-${i}`, 'cat-new', [], 1_800_000_000_000 + i))
    const after = computeLayout([...nodes, ...fresh], [...categories, 'cat-new'], toRecord(before.positions))
    expect([...after.placed].sort()).toEqual(fresh.map((n) => n.id))
    const zone = after.zones.find((z) => z.key === 'cat-new')!
    for (const other of after.zones) {
      if (other.key === 'cat-new') continue
      expect(dist(zone, other)).toBeGreaterThanOrEqual(zone.r + other.r + GRAPH_ZONE_GAP * GRAPH_CELL)
    }
    for (const n of fresh) expect(dist(after.positions.get(n.id)!, zone)).toBeLessThanOrEqual(zone.r)
  })

  it('центр зоны с сохранёнными нодами — покоординатная нижняя медиана, привязанная к сетке', () => {
    const nodes = [node('a', 'c1', [], 1), node('b', 'c1', [], 2), node('c', 'c1', [], 3), node('d', 'c1', [], 4)]
    const fixed = { a: { x: 1000, y: -40 }, b: { x: 10, y: 700 }, c: { x: 330, y: 90 }, d: { x: 650, y: 100 } }
    const [zone] = computeLayout(nodes, ['c1'], fixed).zones
    // x: 10, 330, 650, 1000 → 330 → 320; y: −40, 90, 100, 700 → 90 → 96
    expect(zone).toEqual({ key: 'c1', x: 320, y: 96, r: 96, count: 4 })
  })
})

describe('computeLayout: зоны', () => {
  it('на пустом fixed зоны не пересекаются, «без категории» — в (0, 0)', () => {
    const { nodes, categories } = makeGraph(600, 9, 800, 2)
    const { zones } = computeLayout(nodes, categories, {})
    expect(zones).toHaveLength(10)
    expect(zones[0]).toMatchObject({ key: GRAPH_NONE_ZONE, x: 0, y: 0 })
    for (let i = 0; i < zones.length; i++) {
      for (let j = i + 1; j < zones.length; j++) {
        expect(dist(zones[i], zones[j])).toBeGreaterThanOrEqual(zones[i].r + zones[j].r + GRAPH_ZONE_GAP * GRAPH_CELL)
      }
    }
    expect(zones.reduce((sum, z) => sum + z.count, 0)).toBe(600)
    for (const z of zones) expect(snapToGrid(z)).toEqual({ x: z.x, y: z.y })
  })

  it('порядок зон: без категории, категории по порядку, неизвестные по алфавиту; пустых зон нет', () => {
    const nodes = [
      node('a', 'zeta', [], 1),
      node('b', 'c2', [], 2),
      node('c', null, [], 3),
      node('d', 'alpha', [], 4),
      node('e', 'c1', [], 5),
      node('f', 'c2', [], 6),
    ]
    const { zones } = computeLayout(nodes, ['c1', 'empty', 'c2', 'c1'], {})
    expect(zones.map((z) => [z.key, z.count])).toEqual([
      [GRAPH_NONE_ZONE, 1],
      ['c1', 1],
      ['c2', 2],
      ['alpha', 1],
      ['zeta', 1],
    ])
  })

  it('радиус зоны растёт ступенями по числу нод', () => {
    const radius = (n: number) =>
      computeLayout(
        Array.from({ length: n }, (_, i) => node(`n${i}`, 'c1', [], i)),
        ['c1'],
        {},
      ).zones[0].r
    // cap = max(8, 2^ceil(log2(1.5·n))); rc = ceil(sqrt(cap / π)) + 1
    expect(radius(1)).toBe(3 * GRAPH_CELL)
    expect(radius(5)).toBe(3 * GRAPH_CELL)
    expect(radius(6)).toBe(4 * GRAPH_CELL)
    expect(radius(10)).toBe(4 * GRAPH_CELL)
    expect(radius(11)).toBe(5 * GRAPH_CELL)
    expect(radius(100)).toBe(11 * GRAPH_CELL)
  })

  it('ноды одной категории держатся вместе: каждая внутри своей зоны и вне чужих', () => {
    const { nodes, categories } = makeGraph(800, 8, 1200, 31)
    const result = computeLayout(nodes, categories, {})
    const zoneByKey = new Map(result.zones.map((z) => [z.key, z]))
    for (const n of nodes) {
      const p = result.positions.get(n.id)!
      const own = zoneByKey.get(n.categoryId ?? GRAPH_NONE_ZONE)!
      expect(dist(p, own)).toBeLessThanOrEqual(own.r)
      for (const other of result.zones) {
        if (other !== own) expect(dist(p, other)).toBeGreaterThan(other.r)
      }
    }
  })

  it('связи с чужой категорией не уводят ноды из своей зоны', () => {
    // Цепочка в зоне A, каждая нода которой связана с одной нодой зоны B: без ограничения цепочка
    // шаг за шагом уползала бы к B. Зона B раскладывается первой, поэтому её нода уже стоит.
    const aIds = Array.from({ length: 30 }, (_, i) => `a${String(i).padStart(2, '0')}`)
    const nodes = [
      node('b00', 'B', aIds, 0),
      ...Array.from({ length: 29 }, (_, i) => node(`b${String(i + 1).padStart(2, '0')}`, 'B', [], i + 1)),
      ...aIds.map((id, i) => node(id, 'A', i > 0 ? ['b00', aIds[i - 1]] : ['b00'], 100 + i)),
    ]
    const result = computeLayout(nodes, ['B', 'A'], {})
    const zoneA = result.zones.find((z) => z.key === 'A')!
    const zoneB = result.zones.find((z) => z.key === 'B')!
    for (const id of aIds) {
      const p = result.positions.get(id)!
      expect(dist(p, zoneA)).toBeLessThanOrEqual(zoneA.r)
      expect(dist(p, zoneB)).toBeGreaterThan(zoneB.r)
    }
    // Связь при этом работает: цепочка собирается на стороне зоны, обращённой к B.
    const toB = { x: zoneB.x - zoneA.x, y: zoneB.y - zoneA.y }
    const facing = aIds.filter((id) => {
      const p = result.positions.get(id)!
      return (p.x - zoneA.x) * toB.x + (p.y - zoneA.y) * toB.y > 0
    })
    expect(facing.length).toBeGreaterThan(aIds.length / 2)
    expectNoSharedCells(result)
  })

  it('плотные связи между категориями не смешивают зоны', () => {
    const { nodes, categories } = makeGraph(500, 5, 3000, 9, 0.1)
    const result = computeLayout(nodes, categories, {})
    const zoneByKey = new Map(result.zones.map((z) => [z.key, z]))
    for (const n of nodes) {
      const p = result.positions.get(n.id)!
      const own = zoneByKey.get(n.categoryId ?? GRAPH_NONE_ZONE)!
      expect(dist(p, own)).toBeLessThanOrEqual(own.r)
    }
    expectNoSharedCells(result)
  })

  it('без связей зона заполняется от центра плотным кругом', () => {
    const nodes = Array.from({ length: 21 }, (_, i) => node(`n${String(i).padStart(2, '0')}`, null, [], i))
    const result = computeLayout(nodes, [], {})
    expect(result.positions.get('n00')).toEqual({ x: 0, y: 0 })
    // 21 клетка с dx² + dy² ≤ 5 — ровно круг радиуса √5 клеток.
    for (const p of result.positions.values()) expect(dist(p, { x: 0, y: 0 })).toBeLessThanOrEqual(Math.sqrt(5) * GRAPH_CELL)
    expect(result.placed).toEqual(nodes.map((n) => n.id))
  })
})

describe('computeLayout: связи', () => {
  it('две связанные ноды одной зоны — в соседних клетках', () => {
    const pair = computeLayout([node('a', 'c1', ['b'], 1), node('b', 'c1', ['a'], 2)], ['c1'], {})
    expect(cellGap(pair.positions.get('a')!, pair.positions.get('b')!)).toBe(1)

    // Между ними по времени создано ещё много несвязанных нод той же зоны.
    const nodes = [
      node('first', 'c1', ['last'], 0),
      ...Array.from({ length: 30 }, (_, i) => node(`mid-${i}`, 'c1', [], i + 1)),
      node('last', 'c1', ['first'], 100),
    ]
    const result = computeLayout(nodes, ['c1'], {})
    expect(cellGap(result.positions.get('first')!, result.positions.get('last')!)).toBe(1)
    expectNoSharedCells(result)
  })

  it('связь, записанная только с одной стороны, тоже стягивает', () => {
    const nodes = [
      node('first', 'c1', [], 0),
      ...Array.from({ length: 30 }, (_, i) => node(`mid-${i}`, 'c1', [], i + 1)),
      node('last', 'c1', ['first'], 100),
    ]
    const result = computeLayout(nodes, ['c1'], {})
    expect(cellGap(result.positions.get('first')!, result.positions.get('last')!)).toBe(1)
  })

  it('связанная группа собирается вокруг ноды с наибольшей степенью', () => {
    const spokes = Array.from({ length: 8 }, (_, i) => `s${i}`)
    // Первым по времени создан луч, а не центр звезды: обход всё равно начинается с центра.
    const star = [...spokes.map((id, i) => node(id, 'c1', ['hub'], i)), node('hub', 'c1', spokes, 50)]
    const pads = Array.from({ length: 20 }, (_, i) => node(`pad-${i}`, 'c1', [], 100 + i))
    const result = computeLayout([...star, ...pads], ['c1'], {})
    const hub = result.positions.get('hub')!
    expect(hub).toEqual({ x: 0, y: 0 })
    for (const id of spokes) expect(cellGap(result.positions.get(id)!, hub)).toBe(1)

    // Центр звезды зажат раньше созданными нодами: лучи встают в пределах квадрата 5×5 вокруг него.
    const early = Array.from({ length: 20 }, (_, i) => node(`pad-${i}`, 'c1', [], i))
    const late = [node('hub', 'c1', spokes, 50), ...spokes.map((id, i) => node(id, 'c1', ['hub'], 60 + i))]
    const crowded = computeLayout([...early, ...late], ['c1'], {})
    for (const id of spokes) {
      expect(cellGap(crowded.positions.get(id)!, crowded.positions.get('hub')!)).toBeLessThanOrEqual(2)
    }
    expectNoSharedCells(crowded)
  })

  it('новая нода встаёт рядом с сохранённой связанной нодой своей зоны, даже вынесенной далеко', () => {
    const nodes = [node('a', 'c1', ['b'], 1), node('b', 'c1', ['a'], 2), node('c', 'c1', [], 3)]
    const far = { x: 3200, y: -1600 }
    const result = computeLayout(nodes, ['c1'], { a: far, c: { x: 0, y: 0 } })
    const [zone] = result.zones
    const spot = result.positions.get('b')!
    expect(cellGap(spot, far)).toBeLessThanOrEqual(2)
    // За радиусом зоны нода встаёт с внутренней стороны от соседа, а не дальше него.
    expect(dist(far, zone)).toBeGreaterThan(zone.r)
    expect(dist(spot, zone)).toBeLessThan(dist(far, zone))
  })

  it('связи на неизвестные id и на себя игнорируются', () => {
    const nodes = [
      node('a', 'c1', ['a', 'missing', 'b', 'b'], 1),
      node('b', 'c1', ['a', 'a', 'gone'], 2),
      node('c', 'c1', ['c'], 3),
    ]
    const clean = [node('a', 'c1', ['b'], 1), node('b', 'c1', ['a'], 2), node('c', 'c1', [], 3)]
    expect(snapshot(computeLayout(nodes, ['c1'], {}))).toEqual(snapshot(computeLayout(clean, ['c1'], {})))
  })
})

describe('computeLayout: граничные случаи', () => {
  it('пустой вход', () => {
    const empty = { positions: new Map(), placed: [], displaced: [], zones: [], bounds: null }
    expect(computeLayout([], [], {})).toEqual(empty)
    expect(computeLayout([], ['c1'], { ghost: { x: 0, y: 0 } })).toEqual(empty)
  })

  it('одна нода: центр, границы по размеру ноды', () => {
    const result = computeLayout([node('a')], [], {})
    expect([...result.positions]).toEqual([['a', { x: 0, y: 0 }]])
    expect(result.placed).toEqual(['a'])
    expect(result.zones).toEqual([{ key: GRAPH_NONE_ZONE, x: 0, y: 0, r: 96, count: 1 }])
    const half = GRAPH_NODE_SIZE / 2
    expect(result.bounds).toEqual({ minX: -half, minY: -half, maxX: half, maxY: half })
  })

  it('границы охватывают все ноды, включая сохранённые', () => {
    // Центр зоны — у сохранённой ноды (её клетка 992, −512 занята), новая встаёт в соседнюю клетку выше.
    const result = computeLayout([node('a', null, [], 1), node('b', null, [], 2)], [], { b: { x: 1000, y: -500 } })
    expect(result.positions.get('a')).toEqual({ x: 992, y: -544 })
    expect(result.bounds).toEqual({ minX: 984, minY: -552, maxX: 1008, maxY: -492 })
  })

  it('дубли id: остаётся одна нода, результат не зависит от порядка', () => {
    const nodes = [node('a', 'c1', [], 5), node('b', 'c1', [], 2), node('a', 'c2', [], 1), node('a', 'c1', [], 1)]
    const result = computeLayout(nodes, ['c1', 'c2'], {})
    expect(result.positions.size).toBe(2)
    expect([...result.placed].sort()).toEqual(['a', 'b'])
    expect(result.zones.reduce((sum, z) => sum + z.count, 0)).toBe(2)
    expect(snapshot(computeLayout([...nodes].reverse(), ['c1', 'c2'], {}))).toEqual(snapshot(result))
  })

  it('неизвестная категория получает свою зону', () => {
    const nodes = [node('a', 'known', [], 1), node('b', 'deleted-category', [], 2), node('c', null, [], 3)]
    const result = computeLayout(nodes, ['known'], {})
    expect(result.zones.map((z) => z.key)).toEqual([GRAPH_NONE_ZONE, 'known', 'deleted-category'])
    expect(result.positions.size).toBe(3)
    expectNoSharedCells(result)
  })

  it('много мелких зон: все получают место без пересечений', () => {
    const nodes = Array.from({ length: 150 }, (_, i) => node(`n${i}`, `cat-${String(i).padStart(3, '0')}`, [], i))
    const { zones, positions } = computeLayout(nodes, [], {})
    expect(zones).toHaveLength(150)
    for (let i = 0; i < zones.length; i++) {
      for (let j = i + 1; j < zones.length; j++) {
        expect(dist(zones[i], zones[j])).toBeGreaterThanOrEqual(zones[i].r + zones[j].r + GRAPH_ZONE_GAP * GRAPH_CELL)
      }
    }
    expect(new Set([...positions.values()].map(cellOf)).size).toBe(150)
  })
})

// ───────────────────────── ров между зонами ─────────────────────────

/** Нарушения рва: пары нод разных зон ближе GRAPH_MOAT + 1 клеток по Чебышёву (квадрат (2·MOAT+1)²). */
function moatViolations(
  positions: Map<string, GraphPoint>,
  zoneOf: (id: string) => string,
  only?: ReadonlySet<string>,
): string[] {
  const byCell = new Map<string, string>()
  for (const [id, p] of positions) byCell.set(cellOf(p), id)
  const bad: string[] = []
  for (const [id, p] of positions) {
    if (only && !only.has(id)) continue
    const cx = Math.round(p.x / GRAPH_CELL)
    const cy = Math.round(p.y / GRAPH_CELL)
    for (let dy = -GRAPH_MOAT; dy <= GRAPH_MOAT; dy++) {
      for (let dx = -GRAPH_MOAT; dx <= GRAPH_MOAT; dx++) {
        const other = byCell.get(`${cx + dx},${cy + dy}`)
        if (other !== undefined && other !== id && zoneOf(other) !== zoneOf(id)) bad.push(`${id}~${other}`)
      }
    }
  }
  return bad
}

describe('computeLayout: ров между зонами', () => {
  // Зона B — сохранённый блок 3×5 клеток справа от центра зоны A; у A одна сохранённая нода в (0, 0).
  const bFixed: Record<string, GraphPoint> = {}
  const bNodes: LayoutNode[] = []
  for (let cy = -2; cy <= 2; cy++) {
    for (let cx = 2; cx <= 4; cx++) {
      const id = `b:${cx}:${cy}`
      bFixed[id] = { x: cx * GRAPH_CELL, y: cy * GRAPH_CELL }
      bNodes.push(node(id, 'B', [], 0))
    }
  }
  const zoneOf = (id: string) => (id.startsWith('b:') ? 'B' : 'A')

  it('новые ноды зоны A не встают ближе рва к нодам зоны B', () => {
    const fresh = Array.from({ length: 30 }, (_, i) => node(`a${String(i).padStart(2, '0')}`, 'A', [], 10 + i))
    const fixed = { ...bFixed, a0: { x: 0, y: 0 } }
    const result = computeLayout([...bNodes, node('a0', 'A', [], 1), ...fresh], ['A', 'B'], fixed)
    expect(result.placed).toEqual(fresh.map((n) => n.id))
    expect(moatViolations(result.positions, zoneOf, new Set(result.placed))).toEqual([])
    // Ров не выкидывает ноды далеко: первая встаёт вплотную к сохранённой ноде своей зоны, с дальней от B стороны.
    expect(result.positions.get('a00')).toEqual({ x: -32, y: 0 })
  })

  it('связь с нодой чужой зоны тянет, но не ближе рва', () => {
    const fixed = { ...bFixed, a0: { x: 0, y: 0 } }
    const base = [...bNodes, node('a0', 'A', [], 1)]
    const target = 'b:2:2'
    const linked = computeLayout([...base, node('x', 'A', [target], 10)], ['A', 'B'], fixed)
    const alone = computeLayout([...base, node('x', 'A', [], 10)], ['A', 'B'], fixed)
    const t = bFixed[target]
    const spot = linked.positions.get('x')!
    expect(moatViolations(linked.positions, zoneOf, new Set(['x']))).toEqual([])
    expect(dist(spot, t)).toBeLessThanOrEqual(dist(alone.positions.get('x')!, t))
    // Без связи — (−1, 0); со связью к (2, 2) — (−1, 2): на одной строке с соседом, ровно за рвом.
    expect(alone.positions.get('x')).toEqual({ x: -32, y: 0 })
    expect(spot).toEqual({ x: -32, y: 64 })
  })

  it('сохранённые ноды ров не сдвигает, разведённые встают в ближайшую клетку без рва', () => {
    // Нода зоны A сохранена вплотную к B — остаётся; нода A в клетке ноды B разводится рядом, пусть и во рву.
    const fixed = { ...bFixed, near: { x: 32, y: 0 }, clash: { x: 64, y: 0 } }
    const nodes = [...bNodes, node('near', 'A', [], 1), node('clash', 'A', [], 2)]
    const result = computeLayout(nodes, ['A', 'B'], fixed)
    expect(result.positions.get('near')).toEqual({ x: 32, y: 0 })
    expect(result.displaced).toEqual(['clash'])
    expect(cellGap(result.positions.get('clash')!, { x: 64, y: 0 })).toBeLessThanOrEqual(3)
  })
})

interface GrowthRun {
  nodes: LayoutNode[]
  fixed: Record<string, GraphPoint>
  categories: string[]
  zoneOf: (id: string) => string
}

/**
 * Постепенный рост: 7 зон × 8 нод с нуля (результат — fixed), затем steps нод по одной: категория и 0–2 связи
 * (в том числе с чужой зоной) — из генератора с зерном. После каждого шага placed — только новая нода, прежние
 * точки не изменились. newCategoryAt — шаг, с которого появляется восьмая категория; skew — доля нод первой зоны.
 */
function grow(steps: number, seed: number, opts: { newCategoryAt?: number; skew?: number } = {}): GrowthRun {
  const rand = mulberry32(seed)
  const categories = Array.from({ length: 7 }, (_, i) => `c${i}`)
  const category = new Map<string, string>()
  const nodes: LayoutNode[] = []
  for (let z = 0; z < 7; z++) {
    for (let k = 0; k < 8; k++) {
      const id = `s${z}-${k}`
      nodes.push(node(id, categories[z], [], z * 8 + k))
      category.set(id, categories[z])
    }
  }
  const first = computeLayout(nodes, categories, {})
  const fixed = toRecord(first.positions)

  for (let step = 0; step < steps; step++) {
    if (step === opts.newCategoryAt) categories.push('c-new')
    const roll = rand()
    let cat: string
    if (opts.newCategoryAt !== undefined && step >= opts.newCategoryAt && roll < 0.3) cat = 'c-new'
    else if (opts.skew !== undefined && rand() < opts.skew) cat = categories[0]
    else cat = categories[Math.floor(rand() * 7)]
    const linkCount = Math.floor(rand() * 3)
    const links: string[] = []
    for (let k = 0; k < linkCount; k++) links.push(nodes[Math.floor(rand() * nodes.length)].id)
    const id = `g${String(step).padStart(4, '0')}`
    nodes.push(node(id, cat, links, 1000 + step))
    category.set(id, cat)

    const result = computeLayout(nodes, categories, fixed)
    expect(result.placed).toEqual([id])
    for (const prev of Object.keys(fixed)) expect(result.positions.get(prev)).toEqual(fixed[prev])
    fixed[id] = result.positions.get(id)!
  }
  return { nodes, fixed, categories, zoneOf: (id) => category.get(id)! }
}

describe('computeLayout: постепенный рост', () => {
  it('500 нод по одной: прежние точки не сдвигаются, зоны не перемешиваются', () => {
    const started = performance.now()
    const run = grow(500, 101)
    const positions = new Map(Object.entries(run.fixed))
    expect(positions.size).toBe(556)
    expect(new Set([...positions.values()].map(cellOf)).size).toBe(556)
    expect(moatViolations(positions, run.zoneOf)).toEqual([])
    expect(performance.now() - started).toBeLessThan(5000)
  })

  it('перекос: 70 % новых нод в одну зону', () => {
    const run = grow(300, 7, { skew: 0.7 })
    const positions = new Map(Object.entries(run.fixed))
    expect(new Set([...positions.values()].map(cellOf)).size).toBe(positions.size)
    expect(moatViolations(positions, run.zoneOf)).toEqual([])
  })

  it('новая категория посреди роста: существующие ноды не сдвигаются, новая зона не ближе рва к чужим', () => {
    const run = grow(300, 55, { newCategoryAt: 150 })
    const positions = new Map(Object.entries(run.fixed))
    const fresh = new Set([...positions.keys()].filter((id) => run.zoneOf(id) === 'c-new'))
    expect(fresh.size).toBeGreaterThan(10)
    expect(moatViolations(positions, run.zoneOf, fresh)).toEqual([])
    expect(moatViolations(positions, run.zoneOf)).toEqual([])
  })
})

/** Участки зоны: связность нод своей зоны на расстоянии Чебышёва ≤ GRAPH_MOAT клеток; размеры по убыванию. */
function fragmentSizes(points: readonly GraphPoint[]): number[] {
  const seen = new Uint8Array(points.length)
  const sizes: number[] = []
  for (let s = 0; s < points.length; s++) {
    if (seen[s]) continue
    seen[s] = 1
    const stack = [s]
    let size = 0
    while (stack.length > 0) {
      const v = stack.pop()!
      size++
      for (let u = 0; u < points.length; u++) {
        if (seen[u] || cellGap(points[v], points[u]) > GRAPH_MOAT) continue
        seen[u] = 1
        stack.push(u)
      }
    }
    sizes.push(size)
  }
  return sizes.sort((a, b) => b - a)
}

describe('computeLayout: рост с пустого графа', () => {
  it('600 записей по одной: зоны не рвутся на острова, прежние точки не сдвигаются', () => {
    const rand = mulberry32(3)
    const categories = Array.from({ length: 8 }, (_, i) => `c${i}`)
    const nodes: LayoutNode[] = []
    const fixed: Record<string, GraphPoint> = {}
    for (let step = 0; step < 600; step++) {
      const roll = Math.floor(rand() * 9)
      const linkCount = Math.floor(rand() * 3)
      const links: string[] = []
      for (let k = 0; k < linkCount && nodes.length > 0; k++) links.push(nodes[Math.floor(rand() * nodes.length)].id)
      const id = `g${String(step).padStart(4, '0')}`
      nodes.push(node(id, roll === 8 ? null : categories[roll], links, step))
      const result = computeLayout(nodes, categories, fixed)
      expect(result.placed).toEqual([id])
      for (const prev of Object.keys(fixed)) expect(result.positions.get(prev)).toEqual(fixed[prev])
      fixed[id] = result.positions.get(id)!
    }
    const zoneOf = (id: string) => nodes.find((n) => n.id === id)!.categoryId ?? GRAPH_NONE_ZONE
    const positions = new Map(Object.entries(fixed))
    expect(new Set([...positions.values()].map(cellOf)).size).toBe(600)
    expect(moatViolations(positions, zoneOf)).toEqual([])

    let outside = 0
    for (const key of [GRAPH_NONE_ZONE, ...categories]) {
      const points = nodes.filter((n) => (n.categoryId ?? GRAPH_NONE_ZONE) === key).map((n) => fixed[n.id])
      if (points.length === 0) continue
      outside += points.length - fragmentSizes(points)[0]
    }
    // До запаса места у новой зоны здесь вне основного участка было 6 %.
    expect(outside / 600).toBeLessThanOrEqual(0.02)
  })

  it('новая зона рядом с сохранёнными нодами получает место под рост, свежая раскладка — нет', () => {
    const reserve = 6 * GRAPH_CELL // zoneRadiusCells(GRAPH_ZONE_RESERVE)
    const grown = computeLayout([node('a', 'A', [], 1), node('b', 'B', [], 2)], ['A', 'B'], { a: { x: 0, y: 0 } })
    const [za, zb] = grown.zones
    expect(dist(za, zb)).toBeGreaterThanOrEqual(2 * reserve + GRAPH_ZONE_GAP * GRAPH_CELL)
    // Свежая раскладка тех же двух нод раздвигает зоны только по их размеру.
    const fresh = computeLayout([node('a', 'A', [], 1), node('b', 'B', [], 2)], ['A', 'B'], {})
    expect(dist(fresh.zones[0], fresh.zones[1])).toBeLessThan(2 * reserve)
  })

  it('рост по одной записи на малой базе не разбрасывает граф: «Весь граф» вписывает не мельче 50 %', () => {
    const view = { width: 920, height: 640 }
    const grow = (total: number, cats: number): number => {
      const categories = Array.from({ length: cats }, (_, i) => `c${i}`)
      const nodes: LayoutNode[] = []
      const fixed: Record<string, GraphPoint> = {}
      let bounds: Bounds | null = null
      for (let i = 0; i < total; i++) {
        nodes.push(node(`g${String(i).padStart(3, '0')}`, categories[i % cats], [], i))
        const r = computeLayout(nodes, categories, fixed)
        for (const [id, pt] of r.positions) fixed[id] = pt
        bounds = r.bounds
      }
      return fitCamera(bounds, view).zoom
    }
    expect(grow(12, 4)).toBeGreaterThanOrEqual(0.5)
    expect(grow(30, 6)).toBeGreaterThanOrEqual(0.5)
  })

  it('демоданные (30 записей свежей раскладкой) и три новые категории по две записи: масштаб не мельче 50 %', () => {
    const view = { width: 920, height: 640 }
    const cats = Array.from({ length: 6 }, (_, i) => `c${i}`)
    const base: LayoutNode[] = Array.from({ length: 30 }, (_, i) => node(`d${String(i).padStart(2, '0')}`, cats[i % 6], [], i))
    const fresh = computeLayout(base, cats, {})
    const fixed: Record<string, GraphPoint> = Object.fromEntries(fresh.positions)
    const extraCats = ['x0', 'x1', 'x2']
    const nodes = [...base]
    let result = fresh
    let step = 100
    for (const c of extraCats) {
      for (let k = 0; k < 2; k++) {
        nodes.push(node(`n${step}`, c, [], step++))
        result = computeLayout(nodes, [...cats, ...extraCats], fixed)
        for (const [id, pt] of result.positions) fixed[id] = pt
      }
    }
    expect(fitCamera(result.bounds, view).zoom).toBeGreaterThanOrEqual(0.5)
  })

  it('отдельный участок зоны начинается только вдали от чужих нод', () => {
    // Сохранённая нода A в (0, 0) окружена кольцом нод B на расстоянии 3 клеток: рядом с ней всё во рву B.
    const fixed: Record<string, GraphPoint> = { a0: { x: 0, y: 0 } }
    const nodes: LayoutNode[] = [node('a0', 'A', [], 0)]
    for (let cy = -3; cy <= 3; cy++) {
      for (let cx = -3; cx <= 3; cx++) {
        if (Math.max(Math.abs(cx), Math.abs(cy)) !== 3) continue
        const id = `b:${cx}:${cy}`
        fixed[id] = { x: cx * GRAPH_CELL, y: cy * GRAPH_CELL }
        nodes.push(node(id, 'B', [], 1))
      }
    }
    const fresh = [node('a1', 'A', [], 10), node('a2', 'A', [], 11), node('a3', 'A', ['b:3:0'], 12)]
    const result = computeLayout([...nodes, ...fresh], ['A', 'B'], fixed)
    expect(result.placed).toEqual(['a1', 'a2', 'a3'])
    const bs = nodes.filter((n) => n.categoryId === 'B').map((n) => fixed[n.id])
    const p1 = result.positions.get('a1')!
    // Первая нода начинает участок: в квадрате 9×9 вокруг неё нет нод B.
    for (const b of bs) expect(cellGap(p1, b)).toBeGreaterThan(4)
    // Следующие (в том числе связанная с B) продолжают этот участок, а не начинают новые у кольца.
    expect(fragmentSizes([p1, result.positions.get('a2')!, result.positions.get('a3')!])).toEqual([3])
    expect(moatViolations(result.positions, (id) => (id.startsWith('b:') ? 'B' : 'A'), new Set(result.placed))).toEqual([])
  })
})

describe('computeLayout: производительность', () => {
  it('2000 нод, 12 категорий, 3000 связей — быстрее 1500 мс', () => {
    const { nodes, categories } = makeGraph(2000, 12, 3000, 42)
    // Прогрев на другом графе: измеряется раскладка, а не первая компиляция модуля.
    computeLayout(makeGraph(200, 4, 200, 1).nodes, [], {})

    const started = performance.now()
    const result = computeLayout(nodes, categories, {})
    const elapsed = performance.now() - started

    expect(result.positions.size).toBe(2000)
    expect(result.placed).toHaveLength(2000)
    expectNoSharedCells(result)
    expect(elapsed).toBeLessThan(1500)

    // Дополнение разложенного графа (обычный случай после первого показа) — тоже в пределе.
    const saved = toRecord(result.positions)
    const extra = Array.from({ length: 50 }, (_, i) =>
      node(`extra-${i}`, categories[i % 12], [nodes[i * 7].id], 1_900_000_000_000 + i),
    )
    const startedAgain = performance.now()
    const again = computeLayout([...nodes, ...extra], categories, saved)
    expect(performance.now() - startedAgain).toBeLessThan(1500)
    expect(again.placed).toHaveLength(50)
    expectNoSharedCells(again)

    // Обычный шаг роста: 2000 сохранённых + 1 новая.
    const one = node('one-more', categories[3], [nodes[11].id, nodes[1500].id], 2_000_000_000_000)
    const startedOne = performance.now()
    const single = computeLayout([...nodes, one], categories, saved)
    expect(performance.now() - startedOne).toBeLessThan(300)
    expect(single.placed).toEqual(['one-more'])
  })
})

// ───────────────────────── findFreeSpot, snapToGrid ─────────────────────────

describe('snapToGrid', () => {
  it('привязывает к ближайшему узлу сетки', () => {
    expect(snapToGrid({ x: 15, y: 17 })).toEqual({ x: 0, y: 32 })
    expect(snapToGrid({ x: 100, y: -100 })).toEqual({ x: 96, y: -96 })
    expect(snapToGrid({ x: 64, y: -320 })).toEqual({ x: 64, y: -320 })
  })

  it('не выдаёт −0', () => {
    const p = snapToGrid({ x: -10, y: -16 })
    expect(Object.is(p.x, 0)).toBe(true)
    expect(Object.is(p.y, 0)).toBe(true)
  })
})

describe('findFreeSpot', () => {
  it('свободно — привязка к сетке', () => {
    expect(findFreeSpot({ x: 37, y: -50 }, {})).toEqual({ x: 32, y: -64 })
    expect(findFreeSpot({ x: 37, y: -50 }, { other: { x: 320, y: 320 } })).toEqual({ x: 32, y: -64 })
  })

  it('занято — ближайшая к цели свободная клетка', () => {
    // Цель чуть правее и ниже занятого узла: ближе всего клетка справа.
    expect(findFreeSpot({ x: 3, y: 2 }, { a: { x: 0, y: 0 } })).toEqual({ x: 32, y: 0 })
    expect(findFreeSpot({ x: -2, y: 5 }, { a: { x: 0, y: 0 } })).toEqual({ x: 0, y: 32 })
    // Справа тоже занято.
    expect(findFreeSpot({ x: 3, y: 2 }, { a: { x: 0, y: 0 }, b: { x: 32, y: 0 } })).toEqual({ x: 0, y: 32 })
  })

  it('при равном расстоянии выбор однозначен: сначала меньший y, потом меньший x', () => {
    expect(findFreeSpot({ x: 0, y: 0 }, { a: { x: 0, y: 0 } })).toEqual({ x: 0, y: -32 })
    expect(findFreeSpot({ x: 0, y: 0 }, { a: { x: 0, y: 0 }, b: { x: 0, y: -32 } })).toEqual({ x: -32, y: 0 })
  })

  it('ignoreId: собственное место ноды не считается занятым', () => {
    const taken = { a: { x: 0, y: 0 }, b: { x: 32, y: 0 } }
    expect(findFreeSpot({ x: 5, y: 5 }, taken, 'a')).toEqual({ x: 0, y: 0 })
    expect(findFreeSpot({ x: 30, y: 5 }, taken, 'b')).toEqual({ x: 32, y: 0 })
    // Клетка цели занята другой нодой: своё прежнее место — такой же кандидат, как любая свободная клетка.
    expect(findFreeSpot({ x: 20, y: 0 }, taken, 'a')).toEqual({ x: 0, y: 0 })
    expect(findFreeSpot({ x: 30, y: 5 }, taken, 'a')).toEqual({ x: 32, y: 32 })
    expect(findFreeSpot({ x: 20, y: 0 }, taken)).toEqual({ x: 32, y: -32 })
  })

  it('занятое положение не по сетке занимает свою клетку', () => {
    expect(findFreeSpot({ x: 30, y: 0 }, { a: { x: 20, y: 3 } })).toEqual({ x: 0, y: 0 })
  })

  it('выбирается из сплошного занятого блока к ближайшему краю', () => {
    const taken: Record<string, GraphPoint> = {}
    for (let cy = -3; cy <= 3; cy++) {
      for (let cx = -3; cx <= 3; cx++) taken[`${cx}:${cy}`] = { x: cx * GRAPH_CELL, y: cy * GRAPH_CELL }
    }
    expect(findFreeSpot({ x: 0, y: 0 }, taken)).toEqual({ x: 0, y: -128 })
    expect(findFreeSpot({ x: 70, y: 10 }, taken)).toEqual({ x: 128, y: 0 })
  })

  it('совпадает с полным перебором на случайных данных', () => {
    const rand = mulberry32(77)
    for (let round = 0; round < 60; round++) {
      const taken: Record<string, GraphPoint> = {}
      const cells = new Set<string>()
      const amount = 5 + Math.floor(rand() * 120)
      for (let i = 0; i < amount; i++) {
        const p = { x: Math.round((rand() - 0.5) * 400), y: Math.round((rand() - 0.5) * 400) }
        taken[`t${i}`] = p
        cells.add(cellOf(p))
      }
      const target = { x: (rand() - 0.5) * 300, y: (rand() - 0.5) * 300 }
      const spot = findFreeSpot(target, taken)

      expect(snapToGrid(spot)).toEqual(spot)
      expect(cells.has(cellOf(spot))).toBe(false)
      let best = Infinity
      for (let cy = -20; cy <= 20; cy++) {
        for (let cx = -20; cx <= 20; cx++) {
          if (cells.has(`${cx},${cy}`)) continue
          best = Math.min(best, dist({ x: cx * GRAPH_CELL, y: cy * GRAPH_CELL }, target))
        }
      }
      expect(dist(spot, target)).toBeCloseTo(best, 9)
    }
  })

  it('ближайшая свободная клетка может быть во втором кольце, хотя в первом свободная есть', () => {
    // Цель на 15 px правее занятого узла (0, 0); в первом кольце свободна только (−1, −1) — ≈57 px,
    // во втором (2, 0) — 49 px. Остановка после первого же кольца со свободной клеткой выбрала бы дальнюю.
    const taken: Record<string, GraphPoint> = { c: { x: 0, y: 0 } }
    for (const [cx, cy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1], [1, -1], [-1, 1]]) {
      taken[`${cx}:${cy}`] = { x: cx * GRAPH_CELL, y: cy * GRAPH_CELL }
    }
    expect(findFreeSpot({ x: 15, y: 0 }, taken)).toEqual({ x: 64, y: 0 })
  })

  it('негодная цель и негодные занятые положения не ломают поиск', () => {
    expect(findFreeSpot({ x: Number.NaN, y: Number.POSITIVE_INFINITY }, {})).toEqual({ x: 0, y: 0 })
    expect(findFreeSpot({ x: 0, y: 0 }, { bad: { x: Number.NaN, y: 0 } })).toEqual({ x: 0, y: 0 })
  })

  it('цель за пределом координат подтягивается к пределу', () => {
    expect(findFreeSpot({ x: 5e9, y: -5e9 }, {})).toEqual({ x: 1_000_000, y: -1_000_000 })
  })
})

// ───────────────────────── toLayoutNodes ─────────────────────────

describe('toLayoutNodes', () => {
  function item(patch: Partial<Item> & { id: string }): Item {
    return {
      type: 'text',
      title: '',
      content: '',
      categoryId: null,
      tags: [],
      links: [],
      status: 'inbox',
      favorite: 0,
      source: 'manual',
      createdAt: 1,
      updatedAt: 1,
      ...patch,
    }
  }

  const items = [
    item({ id: 'inbox', status: 'inbox', createdAt: 10 }),
    item({ id: 'library', status: 'library', categoryId: 'c1', links: ['inbox'], createdAt: 20 }),
    item({ id: 'archive', status: 'archive', prevStatus: 'library', createdAt: 30 }),
    item({ id: 'trashed-inbox', status: 'inbox', deletedAt: 5 }),
    item({ id: 'trashed-library', status: 'library', categoryId: 'c2', deletedAt: 0, createdAt: 40 }),
    item({ id: 'constructor', status: 'library', deletedAt: 7 }),
  ]

  it('берёт входящие, базу знаний и архив; без fixed корзина не входит', () => {
    const expected = [
      { id: 'inbox', categoryId: null, links: [], createdAt: 10 },
      { id: 'library', categoryId: 'c1', links: ['inbox'], createdAt: 20 },
      { id: 'archive', categoryId: null, links: [], createdAt: 30 },
    ]
    expect(toLayoutNodes(items)).toEqual(expected)
    expect(toLayoutNodes(items, {})).toEqual(expected)
  })

  it('запись корзины входит, только если у неё есть годное сохранённое положение', () => {
    const fixed = {
      'trashed-library': { x: 64, y: 0 },
      'trashed-inbox': { x: Number.NaN, y: 0 },
      inbox: { x: 0, y: 0 },
    }
    expect(toLayoutNodes(items, fixed).map((n) => n.id)).toEqual(['inbox', 'library', 'archive', 'trashed-library'])
    expect(toLayoutNodes(items, fixed)[3]).toEqual({ id: 'trashed-library', categoryId: 'c2', links: [], createdAt: 40 })
  })

  it('id записи корзины, совпадающий с именем свойства прототипа, не находит положение', () => {
    expect(toLayoutNodes(items, {}).map((n) => n.id)).not.toContain('constructor')
  })

  it('пустой список', () => {
    expect(toLayoutNodes([])).toEqual([])
    expect(toLayoutNodes([], { a: { x: 0, y: 0 } })).toEqual([])
  })
})
