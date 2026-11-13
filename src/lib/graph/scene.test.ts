import { describe, expect, it } from 'vitest'
import type { Category, GraphPoint, Item } from '@/types'
import { buildGraphScene } from './scene'
import type { SceneInput } from './scene'
import { GRAPH_COLOR_KEYS } from './types'

function item(patch: Partial<Item> & { id: string }): Item {
  return {
    type: 'text',
    title: patch.id,
    content: '',
    categoryId: null,
    tags: [],
    links: [],
    status: 'library',
    favorite: 0,
    source: 'manual',
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

function category(id: string, color: Category['color'], order = 0): Category {
  return { id, name: id, color, order, createdAt: 1 }
}

function input(items: Item[], extra: Partial<SceneInput> = {}): SceneInput {
  const positions = new Map<string, GraphPoint>()
  items.forEach((it, i) => positions.set(it.id, { x: (i % 10) * 32, y: Math.floor(i / 10) * 32 }))
  return { items, positions, categories: [], match: null, showArchive: true, ...extra }
}

describe('buildGraphScene: какие записи — ноды', () => {
  it('корзина не входит; архив — только при showArchive; без положения — не входит', () => {
    const items = [
      item({ id: 'a' }),
      item({ id: 'arch', status: 'archive', prevStatus: 'library' }),
      item({ id: 'trash', deletedAt: 5 }),
      item({ id: 'nopos' }),
    ]
    const base = input(items)
    const positions = new Map(base.positions)
    positions.delete('nopos')
    const shown = buildGraphScene({ ...base, positions })
    expect(shown.nodes.map((n) => n.id).sort()).toEqual(['a', 'arch'])
    expect(shown.nodes.find((n) => n.id === 'arch')!.archived).toBe(true)
    const hidden = buildGraphScene({ ...base, positions, showArchive: false })
    expect(hidden.nodes.map((n) => n.id)).toEqual(['a'])
  })

  it('цвет и зона: по категории; неизвестная категория и null — цвет none', () => {
    const items = [
      item({ id: 'blue', categoryId: 'c1' }),
      item({ id: 'lost', categoryId: 'deleted' }),
      item({ id: 'none', categoryId: null }),
      item({ id: 'inbox', status: 'inbox', categoryId: 'c2' }),
    ]
    const scene = buildGraphScene(input(items, { categories: [category('c1', 'blue'), category('c2', 'pink')] }))
    const get = (id: string) => scene.nodes[scene.byId.get(id)!]
    expect(get('blue')).toMatchObject({ color: 'blue', zone: 'c1', inbox: false, archived: false })
    expect(get('lost')).toMatchObject({ color: 'none', zone: 'deleted' })
    expect(get('none')).toMatchObject({ color: 'none', zone: 'none' })
    expect(get('inbox')).toMatchObject({ color: 'pink', zone: 'c2', inbox: true })
  })

  it('избранное: нода помечается favorite', () => {
    const scene = buildGraphScene(input([item({ id: 'f', favorite: 1 }), item({ id: 'p', favorite: 0 })]))
    expect(scene.nodes[scene.byId.get('f')!].favorite).toBe(true)
    expect(scene.nodes[scene.byId.get('p')!].favorite).toBe(false)
  })

  it('заголовок — производный, как в списках', () => {
    const scene = buildGraphScene(input([item({ id: 'x', title: '', content: 'Первая строка\nвторая' })]))
    expect(scene.nodes[0].title).toBe('Первая строка')
  })

  it('дубли id — одна нода', () => {
    const scene = buildGraphScene(input([item({ id: 'a' }), item({ id: 'a', title: 'второй' })]))
    expect(scene.nodes).toHaveLength(1)
    expect(scene.nodes[0].title).toBe('a')
  })
})

describe('buildGraphScene: отбор и связи', () => {
  const items = [
    item({ id: 'a', categoryId: 'c1', links: ['b', 'c', 'a', 'missing'] }),
    item({ id: 'b', categoryId: 'c1', links: ['a'] }),
    // Связь записана только у a.
    item({ id: 'c', categoryId: 'c2' }),
    item({ id: 'd', categoryId: 'c2', links: ['c', 'trash'] }),
    item({ id: 'trash', deletedAt: 1, links: ['d'] }),
  ]
  const categories = [category('c1', 'blue'), category('c2', 'green')]

  it('связи: пары без дублей и самоссылок, записанные с любой стороны; cross — разные зоны', () => {
    const scene = buildGraphScene(input(items, { categories }))
    const pair = (l: { a: number; b: number }) => [scene.nodes[l.a].id, scene.nodes[l.b].id].sort().join('-')
    expect(scene.links.map(pair).sort()).toEqual(['a-b', 'a-c', 'c-d'])
    for (const l of scene.links) expect(l.a).toBeLessThan(l.b)
    const sorted = [...scene.links].sort((x, y) => x.a - y.a || x.b - y.b)
    expect(scene.links).toEqual(sorted)
    const byPair = new Map(scene.links.map((l) => [pair(l), l]))
    expect(byPair.get('a-b')!.cross).toBe(false)
    expect(byPair.get('a-c')!.cross).toBe(true)
    expect(byPair.get('c-d')!.cross).toBe(false)
    const a = scene.nodes[scene.byId.get('a')!]
    expect(a.links.map((i) => scene.nodes[i].id).sort()).toEqual(['b', 'c'])
    expect(a.links).toEqual([...a.links].sort((x, y) => x - y))
  })

  it('приглушение нод и связей; matched; без отбора ничего не приглушено', () => {
    const plain = buildGraphScene(input(items, { categories }))
    expect(plain.nodes.every((n) => !n.dim)).toBe(true)
    expect(plain.links.every((l) => !l.dim)).toBe(true)
    expect(plain.matched).toBe(4)

    const scene = buildGraphScene(input(items, { categories, match: new Set(['a', 'b', 'trash']) }))
    const get = (id: string) => scene.nodes[scene.byId.get(id)!]
    expect(get('a').dim).toBe(false)
    expect(get('c').dim).toBe(true)
    expect(scene.matched).toBe(2)
    for (const l of scene.links) {
      expect(l.dim).toBe(scene.nodes[l.a].dim || scene.nodes[l.b].dim)
    }
  })

  it('порядок рисования: приглушённые первыми, затем по цвету, затем (y, x, id)', () => {
    const many = [
      item({ id: 'p1', categoryId: 'pink' }),
      item({ id: 'n1' }),
      item({ id: 'b1', categoryId: 'blue' }),
      item({ id: 'b2', categoryId: 'blue' }),
      item({ id: 'dim', categoryId: 'pink' }),
    ]
    const positions = new Map<string, GraphPoint>([
      ['p1', { x: 0, y: 0 }],
      ['n1', { x: 64, y: 64 }],
      ['b1', { x: 32, y: 0 }],
      ['b2', { x: 0, y: 0 }],
      ['dim', { x: 0, y: 320 }],
    ])
    const scene = buildGraphScene({
      items: many,
      positions,
      categories: [category('pink', 'pink'), category('blue', 'blue')],
      match: new Set(['p1', 'n1', 'b1', 'b2']),
      showArchive: true,
    })
    expect(scene.nodes.map((n) => n.id)).toEqual(['dim', 'n1', 'b2', 'b1', 'p1'])
    expect(GRAPH_COLOR_KEYS.indexOf('blue')).toBeLessThan(GRAPH_COLOR_KEYS.indexOf('pink'))
    // Порядок не зависит от порядка записей на входе.
    const reversed = buildGraphScene({
      items: [...many].reverse(),
      positions,
      categories: [category('pink', 'pink'), category('blue', 'blue')],
      match: new Set(['p1', 'n1', 'b1', 'b2']),
      showArchive: true,
    })
    expect(reversed.nodes).toEqual(scene.nodes)
    expect(reversed.links).toEqual(scene.links)
  })
})

describe('buildGraphScene: границы и индекс', () => {
  it('bounds — по центрам ± половина ноды; пусто — null', () => {
    const items = [item({ id: 'a' }), item({ id: 'b' })]
    const positions = new Map<string, GraphPoint>([
      ['a', { x: -32, y: 64 }],
      ['b', { x: 100, y: -5 }],
    ])
    const scene = buildGraphScene({ items, positions, categories: [], match: null, showArchive: true })
    expect(scene.bounds).toEqual({ minX: -40, minY: -13, maxX: 108, maxY: 72 })
    const empty = buildGraphScene({ items: [], positions: new Map(), categories: [], match: null, showArchive: true })
    expect(empty.bounds).toBeNull()
    expect(empty.nodes).toEqual([])
    expect(empty.matched).toBe(0)
  })

  it('индекс построен по нодам сцены', () => {
    const scene = buildGraphScene(input(Array.from({ length: 25 }, (_, i) => item({ id: `n${i}` }))))
    const indexed = [...scene.index.cells.values()].flat().sort((a, b) => a - b)
    expect(indexed).toEqual(scene.nodes.map((_, i) => i))
  })

  it('2000 записей и 3000 связей — быстрее 100 мс', () => {
    const count = 2000
    const items: Item[] = []
    let seed = 7
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let i = 0; i < count; i++) items.push(item({ id: `n${i}`, categoryId: `c${i % 12}`, content: `Запись ${i}` }))
    for (let k = 0; k < 3000; k++) {
      const a = Math.floor(next() * count)
      const b = Math.floor(next() * count)
      items[a].links.push(items[b].id)
    }
    const categories = Array.from({ length: 12 }, (_, i) => category(`c${i}`, GRAPH_COLOR_KEYS[(i % 9) + 1] as Category['color'], i))
    const scene0 = input(items, { categories, match: new Set(items.filter((_, i) => i % 3 === 0).map((it) => it.id)) })
    buildGraphScene(input(items.slice(0, 50)))
    const started = performance.now()
    const scene = buildGraphScene(scene0)
    expect(performance.now() - started).toBeLessThan(100)
    expect(scene.nodes).toHaveLength(count)
    expect(scene.links.length).toBeGreaterThan(2900)
  })
})
