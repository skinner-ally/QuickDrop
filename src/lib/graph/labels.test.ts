import { describe, expect, it } from 'vitest'
import type { GraphPoint, Item } from '@/types'
import { GRAPH_CELL, GRAPH_NODE_SIZE } from '@/lib/graphLayout'
import { GRAPH_LABEL_GAP, GRAPH_LABEL_HEIGHT, GRAPH_LABEL_LIMIT, GRAPH_LABEL_MAX_WIDTH, pickLabels } from './labels'
import type { GraphLabel } from './labels'
import { buildGraphScene } from './scene'
import type { Bounds, GraphScene } from './types'

function item(id: string, title = 'abc'): Item {
  return {
    id, type: 'text', title, content: '', categoryId: null, tags: [], links: [], status: 'library',
    favorite: 0, source: 'manual', createdAt: 1, updatedAt: 1,
  }
}

function scene(points: Array<[string, number, number, string?]>, match: Set<string> | null = null): GraphScene {
  const positions = new Map<string, GraphPoint>(points.map(([id, x, y]) => [id, { x, y }]))
  const items = points.map(([id, , , title]) => item(id, title))
  return buildGraphScene({ items, positions, categories: [], match, showArchive: true })
}

/** Решётка size × size с шагом сетки; id `r{строка}c{столбец}`. */
function grid(size: number, title = 'abc'): GraphScene {
  const pts: Array<[string, number, number, string]> = []
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) pts.push([`r${r}c${c}`, c * GRAPH_CELL, r * GRAPH_CELL, title])
  return scene(pts)
}

const EVERYWHERE: Bounds = { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 }

function rectOf(l: GraphLabel, zoom: number, width: number) {
  const left = l.x * zoom + (GRAPH_NODE_SIZE / 2) * zoom + GRAPH_LABEL_GAP
  const top = l.y * zoom - GRAPH_LABEL_HEIGHT / 2
  return { left, top, right: left + width, bottom: top + GRAPH_LABEL_HEIGHT }
}

describe('pickLabels', () => {
  it('ниже 100 % — пусто', () => {
    expect(pickLabels(grid(3), EVERYWHERE, 0.75, ['r0c0'])).toEqual([])
    expect(pickLabels(grid(3), EVERYWHERE, Number.NaN, [])).toEqual([])
  })

  it('одиночная нода — подпись с текстом заголовка', () => {
    const s = scene([['a', 64, -32, 'Заголовок']])
    expect(pickLabels(s, EVERYWHERE, 1, [])).toEqual([{ index: 0, id: 'a', text: 'Заголовок', x: 64, y: -32, plate: false }])
  })

  it('плотная решётка при 100 % — подписи только у правого края', () => {
    const labels = pickLabels(grid(6), EVERYWHERE, 1, [])
    expect(labels.map((l) => l.id).sort()).toEqual(['r0c5', 'r1c5', 'r2c5', 'r3c5', 'r4c5', 'r5c5'])
  })

  it('при 200 % короткие подписи помещаются между нодами', () => {
    // Ширина «abc» — 25 px: от 22 до 47, квадрат соседа начинается с 48.
    expect(pickLabels(grid(4), EVERYWHERE, 2, [])).toHaveLength(16)
  })

  it('приоритетные — на плашке поверх решётки, обычные их не перекрывают', () => {
    const labels = pickLabels(grid(6), EVERYWHERE, 1, ['r2c2', 'r2c3', 'missing', 'r2c2'])
    expect(labels.slice(0, 2)).toEqual([
      expect.objectContaining({ id: 'r2c2', plate: true }),
      expect.objectContaining({ id: 'r2c3', plate: true }),
    ])
    expect(labels.filter((l) => l.plate)).toHaveLength(2)
    expect(labels.filter((l) => !l.plate).map((l) => l.id).sort()).toEqual(
      ['r0c5', 'r1c5', 'r2c5', 'r3c5', 'r4c5', 'r5c5'],
    )
  })

  it('приоритетная плашка не накрывает другую плашку', () => {
    const s = scene([
      ['a', 0, 0, 'очень длинный заголовок записи'],
      ['b', 64, 0, 'второй длинный заголовок'],
    ])
    const labels = pickLabels(s, EVERYWHERE, 1, ['a', 'b'])
    expect(labels.map((l) => [l.id, l.plate])).toEqual([['a', true]])
  })

  it('приоритетная вне области не подписывается', () => {
    const s = scene([['a', 0, 0], ['b', 500, 0]])
    const area = { minX: -100, minY: -100, maxX: 100, maxY: 100 }
    expect(pickLabels(s, area, 1, ['b']).map((l) => l.id)).toEqual(['a'])
  })

  it('не больше предела', () => {
    expect(pickLabels(grid(4), EVERYWHERE, 2, [], { limit: 5 })).toHaveLength(5)
    expect(pickLabels(grid(4), EVERYWHERE, 2, ['r0c0', 'r0c1'], { limit: 1 }).map((l) => l.id)).toEqual(['r0c0'])
    expect(pickLabels(grid(14), EVERYWHERE, 2, [])).toHaveLength(GRAPH_LABEL_LIMIT)
  })

  it('core: предел сначала тратится на видимые ноды, а не на запас за экраном', () => {
    const pts: Array<[string, number, number, string]> = []
    // Верхняя группа — вне core (в запасе области), нижняя — внутри; порядок сцены ставит верхнюю первой.
    for (let i = 0; i < 10; i++) pts.push([`top${i}`, i * 256, 0, 'abc'])
    for (let i = 0; i < 10; i++) pts.push([`bottom${i}`, i * 256, 1024, 'abc'])
    const s = scene(pts)
    const core = { minX: -100, minY: 900, maxX: 3000, maxY: 1200 }
    const withCore = pickLabels(s, EVERYWHERE, 1, [], { limit: 10, core })
    expect(withCore.map((l) => l.id).sort()).toEqual(pts.slice(10).map((p) => p[0]).sort())
    // Без core — прежнее поведение: первые по порядку сцены.
    const plain = pickLabels(s, EVERYWHERE, 1, [], { limit: 10 })
    expect(plain.map((l) => l.id).sort()).toEqual(pts.slice(0, 10).map((p) => p[0]).sort())
    // Предел не исчерпан — подписи получают и ноды вне core.
    expect(pickLabels(s, EVERYWHERE, 1, [], { core })).toHaveLength(20)
  })

  it('приглушённые ноды подписей не получают, но подписи их квадраты не накрывают', () => {
    // a — приглушена; подпись b (слева от a) накрыла бы квадрат a.
    const s = scene([['a', 0, 0], ['b', -32, 0]], new Set(['b']))
    expect(pickLabels(s, EVERYWHERE, 2, [])).toHaveLength(1)
    expect(pickLabels(s, EVERYWHERE, 1, [])).toEqual([])
  })

  it('подпись не накрывает соседнюю подпись', () => {
    // b на 12 px ниже a: квадраты и подписи не задевают чужие квадраты, но подписи пересекаются.
    const s = scene([['a', 0, 0], ['b', 0, 12]])
    const labels = pickLabels(s, EVERYWHERE, 1, [])
    expect(labels.map((l) => l.id)).toEqual(['a'])
  })

  it('ширина — по measure, но не больше предела', () => {
    const s = scene([['a', 0, 0, 'x'], ['b', 100, 0, 'y']])
    // Узкая подпись a помещается до квадрата b (92..108): 14 + 70 = 84.
    expect(pickLabels(s, EVERYWHERE, 1, [], { measure: () => 70 })).toHaveLength(2)
    // Широкая (ограничена 160) — накрывает b.
    expect(pickLabels(s, EVERYWHERE, 1, [], { measure: () => 1000 }).map((l) => l.id)).toEqual(['b'])
  })

  it('на случайном наборе подписи не пересекаются и не накрывают чужие ноды', () => {
    let seed = 99
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    const pts: Array<[string, number, number, string]> = []
    const used = new Set<string>()
    while (pts.length < 400) {
      const cx = Math.floor(rand() * 40)
      const cy = Math.floor(rand() * 40)
      if (used.has(`${cx},${cy}`)) continue
      used.add(`${cx},${cy}`)
      pts.push([`n${pts.length}`, cx * GRAPH_CELL, cy * GRAPH_CELL, 'x'.repeat(1 + Math.floor(rand() * 30))])
    }
    const s = scene(pts)
    for (const zoom of [1, 1.5, 2]) {
      const labels = pickLabels(s, EVERYWHERE, zoom, [])
      expect(labels.length).toBeGreaterThan(10)
      const rects = labels.map((l) => rectOf(l, zoom, Math.min(GRAPH_LABEL_MAX_WIDTH, l.text.length * 7 + 4)))
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i]
          const b = rects[j]
          expect(a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom).toBe(false)
        }
        for (const n of s.nodes) {
          if (n.id === labels[i].id) continue
          const h = (GRAPH_NODE_SIZE / 2) * zoom
          const sq = { left: n.x * zoom - h, top: n.y * zoom - h, right: n.x * zoom + h, bottom: n.y * zoom + h }
          const r = rects[i]
          expect(r.left < sq.right && sq.left < r.right && r.top < sq.bottom && sq.top < r.bottom).toBe(false)
        }
      }
    }
  })
})
