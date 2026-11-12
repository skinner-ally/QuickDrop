import { describe, expect, it } from 'vitest'
import type { Bounds } from '@/lib/graph/types'
import { CLEAR_GROUND_R, EMPTY_CLEARING, buildClearing, objectCleared, pondCleared } from '@/lib/ambient/clearing'
import { OBJECT_CLEAR, POND_CELL, pondOfCell } from '@/lib/ambient/world'
import type { Pond, WorldObject } from '@/lib/ambient/world'

const area = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({ minX, minY, maxX, maxY })

function tree(x: number, y: number): WorldObject {
  const c = OBJECT_CLEAR.tree
  return { id: 1, x, y, kind: 'tree', pal: 0, variant: 0, clearX: c.x, clearUp: c.up, clearDown: c.down }
}

// Псевдослучайные точки для перестановок (без Math.random — тесты повторяемы).
function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

describe('clearing: near', () => {
  it('граница радиуса включается; r <= 0 → false', () => {
    const c = buildClearing([{ x: 0, y: 0 }])
    expect(c.near(30, 40, 50)).toBe(true)
    expect(c.near(30, 40, 49.999)).toBe(false)
    expect(c.near(0, 0, 0)).toBe(false)
    expect(c.near(0, 0, -5)).toBe(false)
    expect(c.near(Number.NaN, 0, 10)).toBe(false)
  })

  it('через границу корзины и при отрицательных координатах', () => {
    const c = buildClearing([{ x: 127, y: -1 }, { x: -300, y: -260 }])
    expect(c.near(129, 1, 3)).toBe(true) // соседняя корзина по обеим осям
    expect(c.near(-260, -230, 50)).toBe(true) // 40·30 → 50
    expect(c.near(-260, -230, 49.9)).toBe(false)
    expect(c.near(-128, -128, 10)).toBe(false)
    // Радиус больше нескольких корзин.
    expect(c.near(600, 0, 474)).toBe(true)
    expect(c.near(600, 0, 472)).toBe(false)
  })

  it('пустой набор и негодные точки', () => {
    expect(EMPTY_CLEARING.near(0, 0, 1000)).toBe(false)
    expect(EMPTY_CLEARING.inBox(area(-1e6, -1e6, 1e6, 1e6))).toBe(false)
    expect(EMPTY_CLEARING.signature(area(-1e6, -1e6, 1e6, 1e6))).toBe(0)
    expect(EMPTY_CLEARING.key).toBe(0)
    expect(EMPTY_CLEARING.size).toBe(0)
    const c = buildClearing([{ x: Number.NaN, y: 0 }, { x: 5, y: Number.POSITIVE_INFINITY }, { x: 10, y: 10 }])
    expect(c.size).toBe(1)
    expect(c.key).toBe(buildClearing([{ x: 10, y: 10 }]).key)
  })
})

describe('clearing: inBox', () => {
  it('граница рамки включается', () => {
    const c = buildClearing([{ x: 100, y: 200 }])
    expect(c.inBox(area(100, 200, 150, 250))).toBe(true)
    expect(c.inBox(area(50, 150, 100, 200))).toBe(true)
    expect(c.inBox(area(100.001, 150, 150, 250))).toBe(false)
    expect(c.inBox(area(0, 0, 99.999, 1000))).toBe(false)
    expect(c.inBox(area(10, 10, 0, 0))).toBe(false) // перевёрнутая рамка
  })

  it('рамка больше корзины и рамка шире всего набора', () => {
    const c = buildClearing([{ x: -1000, y: 900 }, { x: 5000, y: -4000 }])
    expect(c.inBox(area(-1200, 500, -900, 1200))).toBe(true)
    expect(c.inBox(area(-999, 500, 4999, 1200))).toBe(false)
    expect(c.inBox(area(-1e9, -1e9, 1e9, 1e9))).toBe(true)
    expect(c.inBox(area(Number.NEGATIVE_INFINITY, 0, Number.POSITIVE_INFINITY, 1000))).toBe(true)
  })
})

describe('clearing: подписи', () => {
  const rnd = lcg(42)
  const pts = Array.from({ length: 300 }, () => ({ x: Math.round(rnd() * 4000 - 2000), y: Math.round(rnd() * 4000 - 2000) }))
  const B = area(-500, -500, 700, 300)

  it('не зависит от перестановки точек; key равных наборов равен', () => {
    const a = buildClearing(pts)
    const shuffled = [...pts]
    const r = lcg(7)
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    const b = buildClearing(shuffled)
    const c = buildClearing(pts.map((p) => ({ ...p })))
    expect(b.signature(B)).toBe(a.signature(B))
    expect(b.key).toBe(a.key)
    expect(c.key).toBe(a.key)
    expect(a.signature(B)).not.toBe(0)
    expect(a.size).toBe(300)
  })

  it('меняется при сдвиге точки внутри b, не меняется при сдвиге точки вне b', () => {
    const a = buildClearing(pts)
    const inside = pts.findIndex((p) => p.x >= B.minX && p.x <= B.maxX && p.y >= B.minY && p.y <= B.maxY)
    const outside = pts.findIndex((p) => p.x > B.maxX + 50)
    expect(inside).toBeGreaterThanOrEqual(0)
    expect(outside).toBeGreaterThanOrEqual(0)
    const movedIn = pts.map((p, i) => (i === inside ? { x: p.x + 1, y: p.y } : p))
    const movedOut = pts.map((p, i) => (i === outside ? { x: p.x + 40, y: p.y - 3 } : p))
    expect(buildClearing(movedIn).signature(B)).not.toBe(a.signature(B))
    expect(buildClearing(movedOut).signature(B)).toBe(a.signature(B))
    expect(buildClearing(movedOut).key).not.toBe(a.key)
    // Перенос точки из b наружу тоже меняет подпись.
    const left = pts.map((p, i) => (i === inside ? { x: B.maxX + 100, y: p.y } : p))
    expect(buildClearing(left).signature(B)).not.toBe(a.signature(B))
  })

  it('пустая область — 0; подпись всей плоскости = key', () => {
    const a = buildClearing(pts)
    expect(a.signature(area(5000, 5000, 6000, 6000))).toBe(0)
    expect(a.signature(area(-1e7, -1e7, 1e7, 1e7))).toBe(a.key)
  })

  it('сборка 2000 точек быстрая', () => {
    const r = lcg(3)
    const many = Array.from({ length: 2000 }, () => ({ x: r() * 20000, y: r() * 20000 }))
    const t0 = performance.now()
    buildClearing(many)
    expect(performance.now() - t0).toBeLessThan(50)
  })
})

describe('clearing: объекты и пруды', () => {
  it('дерево: нода в 100 px выше опоры — скрыто; 200 выше, 60 ниже, 80 сбоку — нет', () => {
    const o = tree(1000, 2000)
    expect(objectCleared(o, buildClearing([{ x: 1000, y: 1900 }]))).toBe(true)
    expect(objectCleared(o, buildClearing([{ x: 1000, y: 1800 }]))).toBe(false)
    expect(objectCleared(o, buildClearing([{ x: 1000, y: 2060 }]))).toBe(false)
    expect(objectCleared(o, buildClearing([{ x: 1080, y: 2000 }]))).toBe(false)
    expect(objectCleared(o, buildClearing([{ x: 920, y: 2000 }]))).toBe(false)
    // Края рамки включаются.
    expect(objectCleared(o, buildClearing([{ x: 1074, y: 1860 }]))).toBe(true)
    expect(objectCleared(o, buildClearing([{ x: 926, y: 2044 }]))).toBe(true)
    expect(objectCleared(o, EMPTY_CLEARING)).toBe(false)
  })

  it('объект с clearX = 0 (камыш) сам не скрывается', () => {
    const reed: WorldObject = { ...tree(0, 0), kind: 'reed', clearX: 0, clearUp: 0, clearDown: 0 }
    expect(objectCleared(reed, buildClearing([{ x: 0, y: 0 }]))).toBe(false)
  })

  it('pondCleared: нода ближе reach к центру пруда', () => {
    let p: Pond | null = null
    for (let sx = 0; !p && sx < 50; sx++) p = pondOfCell(sx, 1)
    expect(p).not.toBeNull()
    const q = p as Pond
    expect(q.x).toBeGreaterThan(0)
    expect(q.y).toBeGreaterThan(POND_CELL)
    expect(pondCleared(q, buildClearing([{ x: q.x + q.reach - 0.01, y: q.y }]))).toBe(true)
    expect(pondCleared(q, buildClearing([{ x: q.x, y: q.y - q.reach - 0.5 }]))).toBe(false)
    expect(pondCleared(q, buildClearing([{ x: q.x + q.r, y: q.y + q.r * 0.5 }]))).toBe(true)
    expect(pondCleared(q, EMPTY_CLEARING)).toBe(false)
  })

  it('CLEAR_GROUND_R = 56', () => {
    expect(CLEAR_GROUND_R).toBe(56)
  })
})
