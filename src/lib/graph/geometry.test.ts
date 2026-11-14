import { describe, expect, it } from 'vitest'
import type { GraphPoint } from '@/types'
import { GRAPH_CELL } from '@/lib/graphLayout'
import {
  GRAPH_TOUCH_HIT_PX,
  GRAPH_ZOOM_STEPS,
  buildSpatialIndex,
  deviceTransform,
  ensureVisible,
  fitCamera,
  hitLink,
  hitNode,
  hitNodeStrict,
  nearestInDirection,
  panBy,
  pinchStep,
  queryBounds,
  resizeCamera,
  screenToWorld,
  snapZoom,
  sortByAngle,
  stepZoom,
  visibleBounds,
  wheelSteps,
  worldToScreen,
  zoomAt,
} from './geometry'
import type { GraphViewport } from './types'

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

function view(x: number, y: number, zoom: number, dpr = 1, width = 800, height = 600): GraphViewport {
  return { width, height, dpr, camera: { x, y, zoom } }
}

const DPRS = [1, 1.25, 1.5, 1.75, 2]

describe('ступени масштаба', () => {
  it('snapZoom: ближайшая ступень, края, NaN', () => {
    expect(snapZoom(1)).toBe(1)
    expect(snapZoom(0.9)).toBe(1)
    expect(snapZoom(0.6)).toBe(0.5)
    expect(snapZoom(1.3)).toBe(1.5)
    expect(snapZoom(0.01)).toBe(0.125)
    expect(snapZoom(100)).toBe(2)
    expect(snapZoom(Number.POSITIVE_INFINITY)).toBe(2)
    expect(snapZoom(Number.NEGATIVE_INFINITY)).toBe(0.125)
    expect(snapZoom(Number.NaN)).toBe(1)
    // Ровно посередине — меньшая.
    expect(snapZoom(0.625)).toBe(0.5)
    for (const step of GRAPH_ZOOM_STEPS) expect(snapZoom(step)).toBe(step)
  })

  it('stepZoom: соседняя ступень, на краю — та же', () => {
    expect(stepZoom(1, 1)).toBe(1.5)
    expect(stepZoom(1, -1)).toBe(0.75)
    expect(stepZoom(2, 1)).toBe(2)
    expect(stepZoom(0.125, -1)).toBe(0.125)
    // Не со ступени — ближайшая в ту сторону.
    expect(stepZoom(0.6, 1)).toBe(0.75)
    expect(stepZoom(0.6, -1)).toBe(0.5)
    expect(stepZoom(Number.NaN, 1)).toBe(1.5)
  })
})

describe('преобразования', () => {
  /**
   * Известное нарушение после перехода на GRAPH_CELL = 48: на 12,5 % при dpr 1.25 и 1.75 шаг сетки — 7,5 и 10,5 px
   * устройства (решётка нод неровная, зазоры через один на 1 px шире). Целый шаг на всех ступенях даёт только
   * клетка, кратная 32. Отчёт graph-redesign-tests.
   */
  const FRACTIONAL_CELL = new Set(['0.125@1.25', '0.125@1.75'])

  it('deviceTransform: целые ox, oy и целый шаг сетки на всех ступенях и плотностях', () => {
    const rand = mulberry32(3)
    for (const dpr of DPRS) {
      for (const zoom of GRAPH_ZOOM_STEPS) {
        const t = deviceTransform(view((rand() - 0.5) * 5000, (rand() - 0.5) * 5000, zoom, dpr, 801, 603))
        expect(Number.isInteger(t.ox)).toBe(true)
        expect(Number.isInteger(t.oy)).toBe(true)
        expect(t.k).toBe(zoom * dpr)
        if (FRACTIONAL_CELL.has(`${zoom}@${dpr}`)) continue
        expect(Number.isInteger(GRAPH_CELL * t.k), `шаг сетки ${zoom} @ dpr ${dpr}`).toBe(true)
      }
    }
  })

  // Падает, пока нарушение есть; когда шаг станет целым везде — it.fails упадёт: убрать его и FRACTIONAL_CELL.
  it.fails('целый шаг сетки и на 12,5 % при dpr 1.25 / 1.75 (известное нарушение, клетка 48)', () => {
    for (const key of FRACTIONAL_CELL) {
      const [zoom, dpr] = key.split('@').map(Number)
      expect(Number.isInteger(GRAPH_CELL * zoom * dpr)).toBe(true)
    }
  })

  it('deviceTransform: центр камеры — в центре сцены', () => {
    expect(deviceTransform(view(0, 0, 1, 2))).toEqual({ ox: 800, oy: 600, k: 2 })
    expect(deviceTransform(view(100, -50, 0.5))).toEqual({ ox: 350, oy: 325, k: 0.5 })
    expect(Object.is(deviceTransform(view(800, 600, 0.5)).ox, 0)).toBe(true)
  })

  it('мир ↔ экран: круговое преобразование', () => {
    const rand = mulberry32(11)
    for (const dpr of DPRS) {
      for (const zoom of GRAPH_ZOOM_STEPS) {
        const v = view((rand() - 0.5) * 4000, (rand() - 0.5) * 4000, zoom, dpr)
        for (let i = 0; i < 20; i++) {
          const p = { x: (rand() - 0.5) * 8000, y: (rand() - 0.5) * 8000 }
          const back = screenToWorld(v, worldToScreen(v, p))
          expect(back.x).toBeCloseTo(p.x, 6)
          expect(back.y).toBeCloseTo(p.y, 6)
        }
      }
    }
  })

  it('центр камеры виден в центре сцены с точностью до пикселя устройства', () => {
    const v = view(123.4, -77.7, 0.75, 1.25)
    const s = worldToScreen(v, v.camera)
    expect(Math.abs(s.x - 400)).toBeLessThanOrEqual(1)
    expect(Math.abs(s.y - 300)).toBeLessThanOrEqual(1)
  })

  it('visibleBounds: мир сцены и запас', () => {
    expect(visibleBounds(view(0, 0, 1))).toEqual({ minX: -400, minY: -300, maxX: 400, maxY: 300 })
    expect(visibleBounds(view(0, 0, 0.5), 10)).toEqual({ minX: -820, minY: -620, maxX: 820, maxY: 620 })
  })

  it('zoomAt: мировая точка под якорем остаётся под ним, туда и обратно — та же камера', () => {
    const rand = mulberry32(5)
    for (let round = 0; round < 50; round++) {
      const dpr = DPRS[round % DPRS.length]
      const v = view((rand() - 0.5) * 3000, (rand() - 0.5) * 3000, GRAPH_ZOOM_STEPS[round % 7], dpr)
      const anchor = { x: rand() * v.width, y: rand() * v.height }
      const world = screenToWorld(v, anchor)
      const next = zoomAt(v, GRAPH_ZOOM_STEPS[(round + 3) % 7], anchor)
      const after = screenToWorld({ ...v, camera: next }, anchor)
      // Округление ox до пикселя устройства: смещение не больше пикселя устройства на каждой из камер.
      expect(Math.abs(after.x - world.x)).toBeLessThanOrEqual(1 / (v.camera.zoom * dpr) + 1 / (next.zoom * dpr))
      expect(Math.abs(after.y - world.y)).toBeLessThanOrEqual(1 / (v.camera.zoom * dpr) + 1 / (next.zoom * dpr))
      const back = zoomAt({ ...v, camera: next }, v.camera.zoom, anchor)
      expect(back.x).toBeCloseTo(v.camera.x, 9)
      expect(back.y).toBeCloseTo(v.camera.y, 9)
      expect(back.zoom).toBe(v.camera.zoom)
    }
  })

  it('zoomAt: масштаб приводится к ступени; якорь в центре — центр не двигается', () => {
    const v = view(10, 20, 1)
    expect(zoomAt(v, 1.4, { x: 400, y: 300 })).toEqual({ x: 10, y: 20, zoom: 1.5 })
  })

  it('panBy: содержимое едет за указателем', () => {
    expect(panBy({ x: 0, y: 0, zoom: 0.5 }, 10, -20)).toEqual({ x: -20, y: 40, zoom: 0.5 })
  })
})

describe('fitCamera', () => {
  it('маленький граф — 100 % в центре границ', () => {
    expect(fitCamera({ minX: -8, minY: -8, maxX: 72, maxY: 40 }, { width: 800, height: 600 })).toEqual({
      x: 32,
      y: 16,
      zoom: 1,
    })
  })

  it('большой граф — наименьшая ступень', () => {
    expect(fitCamera({ minX: 0, minY: 0, maxX: 100_000, maxY: 100 }, { width: 800, height: 600 }).zoom).toBe(0.125)
  })

  it('выбирается наибольшая ступень, при которой граф с отступом помещается', () => {
    // 1200 px: при 0.5 — 600 + 96 ≤ 800; при 0.75 — 900 + 96 > 800.
    expect(fitCamera({ minX: 0, minY: 0, maxX: 1200, maxY: 100 }, { width: 800, height: 600 }).zoom).toBe(0.5)
    expect(fitCamera({ minX: 0, minY: 0, maxX: 1200, maxY: 100 }, { width: 800, height: 600 }, 0).zoom).toBe(0.5)
    expect(fitCamera({ minX: 0, minY: 0, maxX: 1000, maxY: 100 }, { width: 800, height: 600 }, 0).zoom).toBe(0.75)
  })

  it('пусто или сцена без размера — 100 % в нуле', () => {
    expect(fitCamera(null, { width: 800, height: 600 })).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(fitCamera({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { width: 0, height: 600 })).toEqual({ x: 0, y: 0, zoom: 1 })
  })
})

describe('ensureVisible', () => {
  it('видна с запасом — null; у края или за ним — центр на точке', () => {
    const v = view(0, 0, 1)
    expect(ensureVisible(v, { x: 100, y: 100 })).toBeNull()
    expect(ensureVisible(v, { x: 380, y: 0 })).toEqual({ x: 380, y: 0, zoom: 1 })
    expect(ensureVisible(v, { x: 5000, y: -5000 })).toEqual({ x: 5000, y: -5000, zoom: 1 })
    expect(ensureVisible(v, { x: 380, y: 0 }, 0)).toBeNull()
  })

  it('на крошечной сцене точка в центре считается видной', () => {
    const v = view(50, 50, 1, 1, 40, 40)
    expect(ensureVisible(v, { x: 50, y: 50 })).toBeNull()
    expect(ensureVisible(v, { x: 500, y: 50 })).toEqual({ x: 500, y: 50, zoom: 1 })
  })
})

describe('пространственный индекс', () => {
  const rand = mulberry32(42)
  const points: GraphPoint[] = Array.from({ length: 2000 }, () => ({
    x: Math.round((rand() - 0.5) * 6000),
    y: Math.round((rand() - 0.5) * 6000),
  }))
  const index = buildSpatialIndex(points)

  it('queryBounds совпадает с полным перебором', () => {
    for (let round = 0; round < 100; round++) {
      const x = (rand() - 0.5) * 7000
      const y = (rand() - 0.5) * 7000
      const b = { minX: x, minY: y, maxX: x + rand() * 2000, maxY: y + rand() * 2000 }
      const expected = points
        .map((p, i) => (p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY ? i : -1))
        .filter((i) => i >= 0)
      expect(queryBounds(index, points, b)).toEqual(expected)
    }
    // Огромная область — все точки.
    const all = queryBounds(index, points, { minX: -1e7, minY: -1e7, maxX: 1e7, maxY: 1e7 })
    expect(all).toEqual(points.map((_, i) => i))
  })

  it('граница входит, перевёрнутая область пуста, негодные точки пропускаются', () => {
    const pts = [{ x: 0, y: 0 }, { x: 256, y: 256 }, { x: Number.NaN, y: 0 }]
    const idx = buildSpatialIndex(pts)
    expect(queryBounds(idx, pts, { minX: 0, minY: 0, maxX: 256, maxY: 256 })).toEqual([0, 1])
    expect(queryBounds(idx, pts, { minX: 10, minY: 0, maxX: 0, maxY: 0 })).toEqual([])
  })
})

describe('resizeCamera', () => {
  const cam = { x: 100, y: 50, zoom: 0.5 }
  const pts = [{ x: 0, y: 0 }, { x: 333, y: -71 }, { x: -1000, y: 400 }]

  it('по умолчанию на месте левый верхний угол: экранное положение любой точки не меняется', () => {
    const next = resizeCamera(cam, { width: 900, height: 600 }, { width: 440, height: 566 })
    for (const p of pts) {
      const a = worldToScreen(view(cam.x, cam.y, cam.zoom, 1, 900, 600), p)
      const b = worldToScreen(view(next.x, next.y, next.zoom, 1, 440, 566), p)
      expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1)
    }
    expect(next.zoom).toBe(0.5)
  })

  it('keep: центр — камера как была; правый нижний угол остаётся на месте', () => {
    expect(resizeCamera(cam, { width: 900, height: 600 }, { width: 440, height: 500 }, { x: 0.5, y: 0.5 })).toBe(cam)
    const next = resizeCamera(cam, { width: 900, height: 600 }, { width: 440, height: 500 }, { x: 1, y: 1 })
    const p = pts[1]
    const a = worldToScreen(view(cam.x, cam.y, cam.zoom, 1, 900, 600), p)
    const b = worldToScreen(view(next.x, next.y, next.zoom, 1, 440, 500), p)
    expect(Math.abs(900 - a.x - (440 - b.x))).toBeLessThanOrEqual(1)
    expect(Math.abs(600 - a.y - (500 - b.y))).toBeLessThanOrEqual(1)
  })

  it('из нуля и в ноль камеру не трогает; туда и обратно — точно на место', () => {
    expect(resizeCamera(cam, { width: 0, height: 0 }, { width: 440, height: 600 })).toBe(cam)
    expect(resizeCamera(cam, { width: 900, height: 600 }, { width: 0, height: 0 })).toBe(cam)
    expect(resizeCamera(cam, { width: 900, height: 600 }, { width: 900, height: 600 })).toBe(cam)
    const there = resizeCamera(cam, { width: 900, height: 600 }, { width: 440, height: 600 })
    expect(resizeCamera(there, { width: 440, height: 600 }, { width: 900, height: 600 })).toEqual(cam)
  })
})

describe('попадания', () => {
  it('hitNode: квадрат ноды с полями; ближайшая; при равенстве — верхняя', () => {
    // Нода 24 px: полуширина зоны на 100 % — 12 + 2.
    const pts = [{ x: 0, y: 0 }, { x: GRAPH_CELL, y: 0 }, { x: 0, y: 0 }]
    const idx = buildSpatialIndex(pts)
    expect(hitNode(idx, pts, { x: 13, y: -13 }, 1)).toBe(2)
    expect(hitNode(idx, pts, { x: 15, y: 0 }, 1)).toBe(-1)
    expect(hitNode(idx, pts, { x: GRAPH_CELL - 12, y: 3 }, 1)).toBe(1)
  })

  it('hitNode на мелком масштабе: поле шире, выбирается ближайшая', () => {
    const pts = [{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 64, y: 0 }]
    const idx = buildSpatialIndex(pts)
    // 7 / 0.125 = 56 мировых px.
    expect(hitNode(idx, pts, { x: 20, y: 40 }, 0.125)).toBe(1)
    expect(hitNode(idx, pts, { x: 5, y: 10 }, 0.125)).toBe(0)
    expect(hitNode(idx, pts, { x: 130, y: 0 }, 0.125)).toBe(-1)
    expect(hitNode(idx, pts, { x: 119, y: 0 }, 0.125)).toBe(2)
  })

  it('hitLink: расстояние до отрезка, ближайшая, равенство — большая', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 10 }, { x: 100, y: 10 }]
    const links = [{ a: 0, b: 1 }, { a: 2, b: 3 }, { a: 0, b: 1 }]
    expect(hitLink(pts, links, { x: 50, y: 2 }, 1)).toBe(2)
    expect(hitLink(pts, links, { x: 50, y: 8 }, 1)).toBe(1)
    expect(hitLink(pts, links, { x: 50, y: 5 }, 1)).toBe(2)
    expect(hitLink(pts, links, { x: 50, y: -6 }, 1)).toBe(-1)
    // За концом отрезка — расстояние до конца.
    expect(hitLink(pts, links, { x: 104, y: 0 }, 1)).toBe(2)
    expect(hitLink(pts, links, { x: 106, y: 0 }, 1)).toBe(-1)
    expect(hitLink(pts, links, { x: 102, y: 0 }, 1)).toBe(2)
    // На мелком масштабе поле шире: 5 / 0.5 = 10.
    expect(hitLink(pts, [{ a: 0, b: 1 }], { x: 50, y: -9 }, 0.5)).toBe(0)
  })

  it('hitNodeStrict: на мелком масштабе зона не смыкается между соседями (перенос — только с квадрата)', () => {
    // Клетка 48, нода 24: зазор между квадратами соседей — 24, его четверть — 6.
    const pts = [{ x: 0, y: 0 }, { x: GRAPH_CELL, y: GRAPH_CELL }]
    const idx = buildSpatialIndex(pts)
    const mid = GRAPH_CELL / 2
    for (const zoom of [0.125, 0.25]) {
      // Посреди соседних узлов сетки широкая зона находит ноду, строгая — нет.
      expect(hitNode(idx, pts, { x: mid, y: mid }, zoom)).not.toBe(-1)
      expect(hitNodeStrict(idx, pts, { x: mid, y: mid }, zoom)).toBe(-1)
      // В центре ноды строгая находит её.
      expect(hitNodeStrict(idx, pts, { x: 0, y: 0 }, zoom)).toBe(0)
      expect(hitNodeStrict(idx, pts, { x: GRAPH_CELL + 1, y: GRAPH_CELL - 1 }, zoom)).toBe(1)
    }
    // 12,5 %: 2 экранных px = 16 мировых — больше четверти зазора, запас ограничен 6: полуширина 18.
    expect(hitNodeStrict(idx, pts, { x: -18, y: 0 }, 0.125)).toBe(0)
    expect(hitNodeStrict(idx, pts, { x: -19, y: 0 }, 0.125)).toBe(-1)
    // Доля площади плотной решётки, с которой начинается перенос, — не больше (36/48)² на любом масштабе.
    for (const zoom of GRAPH_ZOOM_STEPS) {
      expect(hitNodeStrict(idx, pts, { x: 0, y: 18.5 }, zoom)).toBe(-1)
    }
    // 100 %: у края квадрата обе находят ноду, дальше запаса — строгая нет.
    expect(hitNode(idx, pts, { x: 13, y: 0 }, 1)).toBe(0)
    expect(hitNodeStrict(idx, pts, { x: 13, y: 0 }, 1)).toBe(0)
    expect(hitNodeStrict(idx, pts, { x: 15, y: 0 }, 1)).toBe(-1)
    expect(hitNodeStrict(idx, pts, { x: Number.NaN, y: 0 }, 1)).toBe(-1)
  })

  it('палец: зона попадания 18 CSS-px (≥ 36 px), ближайшая нода по-прежнему выигрывает', () => {
    expect(GRAPH_TOUCH_HIT_PX).toBe(18)
    const pts = [{ x: 0, y: 0 }, { x: 96, y: 0 }]
    const idx = buildSpatialIndex(pts)
    const touch = { radiusPx: GRAPH_TOUCH_HIT_PX }
    // 100 %: мышь — 10 мировых px, палец — 18.
    expect(hitNode(idx, pts, { x: 17, y: 0 }, 1)).toBe(-1)
    expect(hitNode(idx, pts, { x: 17, y: 17 }, 1, touch)).toBe(0)
    expect(hitNode(idx, pts, { x: 19, y: 0 }, 1, touch)).toBe(-1)
    // 50 %: 18 / 0.5 = 36 мировых px.
    expect(hitNode(idx, pts, { x: 36, y: 0 }, 0.5, touch)).toBe(0)
    expect(hitNode(idx, pts, { x: 37, y: 0 }, 0.5, touch)).toBe(-1)
    // Между двумя нодами — ближайшая.
    expect(hitNode(idx, pts, { x: 60, y: 0 }, 0.25, touch)).toBe(1)
    // По умолчанию — прежние 7 px.
    expect(hitNode(idx, pts, { x: 14, y: 0 }, 0.5)).toBe(0)
    expect(hitNode(idx, pts, { x: 15, y: 0 }, 0.5)).toBe(-1)
    // Связь: мышь — 5 px, палец — 18.
    const lpts = [{ x: 0, y: 0 }, { x: 100, y: 0 }]
    const links = [{ a: 0, b: 1 }]
    expect(hitLink(lpts, links, { x: 50, y: 10 }, 1)).toBe(-1)
    expect(hitLink(lpts, links, { x: 50, y: 18 }, 1, touch)).toBe(0)
    expect(hitLink(lpts, links, { x: 50, y: 19 }, 1, touch)).toBe(-1)
  })
})

describe('клавиатура', () => {
  it('nearestInDirection: конус 45° в обе стороны, вес поперечной дельты, ничьи — меньший индекс', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 40, y: 30 }, // 40 + 60 = 100 — ничья с индексом 1
      { x: 30, y: 31 }, // вне конуса «вправо», в конусе «вниз»: 31 + 60 = 91
      { x: -50, y: 0 },
      { x: 0, y: 80 },
    ]
    expect(nearestInDirection(pts, pts[0], 'right', 0)).toBe(1)
    expect(nearestInDirection(pts, pts[0], 'left', 0)).toBe(4)
    expect(nearestInDirection(pts, pts[0], 'down', 0)).toBe(5)
    expect(nearestInDirection(pts.slice(0, 5), pts[0], 'down', 0)).toBe(3)
    expect(nearestInDirection(pts, pts[0], 'up', 0)).toBe(-1)
    // Сама точка (дельта 0) не выбирается и без skip.
    expect(nearestInDirection([{ x: 0, y: 0 }], { x: 0, y: 0 }, 'right')).toBe(-1)
    // Граница конуса входит.
    expect(nearestInDirection([{ x: 10, y: -10 }], { x: 0, y: 0 }, 'up')).toBe(0)
  })

  it('sortByAngle: по часовой от «12 часов»', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: -10, y: 0 }, // 9 часов
      { x: 0, y: 10 }, // 6
      { x: 10, y: 0 }, // 3
      { x: 0, y: -10 }, // 12
      { x: 10, y: -10 }, // полвторого
      { x: 0, y: -20 }, // 12, дальше
    ]
    expect(sortByAngle(pts, pts[0], [1, 2, 3, 4, 5, 6])).toEqual([4, 6, 5, 3, 2, 1])
    expect(sortByAngle(pts, pts[0], [])).toEqual([])
  })
})

describe('колесо и щипок', () => {
  it('мышь: одно деление (100) — шаг; знак: от себя — приблизить', () => {
    expect(wheelSteps(0, { deltaY: -100, deltaMode: 0, ctrlKey: false })).toEqual({ acc: 0, steps: 1 })
    expect(wheelSteps(0, { deltaY: 100, deltaMode: 0, ctrlKey: false })).toEqual({ acc: 0, steps: -1 })
    expect(wheelSteps(0, { deltaY: 3, deltaMode: 1, ctrlKey: false }).steps).toBe(-1)
    expect(wheelSteps(0, { deltaY: -1, deltaMode: 2, ctrlKey: false }).steps).toBe(1)
  })

  it('тачпад: 4 × 25 — ровно один шаг; большой рывок — не больше одного шага', () => {
    let acc = 0
    const steps: number[] = []
    for (let i = 0; i < 4; i++) {
      const r = wheelSteps(acc, { deltaY: 25, deltaMode: 0, ctrlKey: false })
      acc = r.acc
      steps.push(r.steps)
    }
    expect(steps).toEqual([0, 0, 0, -1])
    expect(acc).toBe(0)
    expect(wheelSteps(0, { deltaY: -5000, deltaMode: 0, ctrlKey: false })).toEqual({ acc: 0, steps: 1 })
  })

  it('деление колеса меньше 100 (1 строка за щелчок, увеличенная страница) — тоже шаг сразу', () => {
    expect(wheelSteps(0, { deltaY: -33.3, deltaMode: 0, ctrlKey: false })).toEqual({ acc: 0, steps: 1 })
    expect(wheelSteps(0, { deltaY: 66.7, deltaMode: 0, ctrlKey: false })).toEqual({ acc: 0, steps: -1 })
    expect(wheelSteps(0, { deltaY: 30, deltaMode: 0, ctrlKey: false }).steps).toBe(-1)
    // Строки — всегда деление, даже одна (Firefox при «1 строке за щелчок»).
    expect(wheelSteps(0, { deltaY: 1, deltaMode: 1, ctrlKey: false })).toEqual({ acc: 0, steps: -1 })
    // Мелкие дельты тачпада по-прежнему копятся.
    expect(wheelSteps(0, { deltaY: 29, deltaMode: 0, ctrlKey: false })).toEqual({ acc: -29, steps: 0 })
  })

  it('после паузы дольше 250 мс накопленное забывается', () => {
    const e = (timeStamp: number) => ({ deltaY: 20, deltaMode: 0, ctrlKey: false, timeStamp })
    expect(wheelSteps(-80, e(1000), 900)).toEqual({ acc: 0, steps: -1 })
    expect(wheelSteps(-80, e(1000), 700)).toEqual({ acc: -20, steps: 0 })
    expect(wheelSteps(-80, e(1000), 750)).toEqual({ acc: 0, steps: -1 })
    // Без времени — как раньше.
    expect(wheelSteps(-80, { deltaY: 20, deltaMode: 0, ctrlKey: false })).toEqual({ acc: 0, steps: -1 })
    expect(wheelSteps(-80, { deltaY: 0, deltaMode: 0, ctrlKey: false, timeStamp: 2000 }, 0)).toEqual({ acc: 0, steps: 0 })
  })

  it('поток тачпада с дельтами 30-80 px не даёт шаг на каждое событие', () => {
    const run = (deltas: number[], gap: number): number => {
      let acc = 0
      let last: number | undefined
      let total = 0
      deltas.forEach((d, i) => {
        const t = i * gap
        const r = wheelSteps(acc, { deltaY: d, deltaMode: 0, ctrlKey: false, timeStamp: t }, last)
        acc = r.acc
        last = t
        total += Math.abs(r.steps)
      })
      return total
    }
    // Семь событий свайпа за ~100 мс: не больше трёх шагов, а не семь.
    expect(run([40, 60, 80, 70, 50, 40, 35], 16)).toBeLessThanOrEqual(3)
    // Деления мыши по 33 px раз в 150 мс — шаг на каждое.
    expect(run([33, 33, 33, 33, 33], 150)).toBe(5)
    // Первое событие потока без прошлого — одиночное.
    expect(wheelSteps(0, { deltaY: 40, deltaMode: 0, ctrlKey: false, timeStamp: 16 }, undefined).steps).toBe(-1)
    // Строки внутри потока — по-прежнему шаг на событие.
    expect(wheelSteps(0, { deltaY: 1, deltaMode: 1, ctrlKey: false, timeStamp: 10 }, 0).steps).toBe(-1)
  })

  it('щипок тачпада (ctrlKey) — порог 30; смена направления начинает заново', () => {
    expect(wheelSteps(0, { deltaY: -30, deltaMode: 0, ctrlKey: true }).steps).toBe(1)
    expect(wheelSteps(20, { deltaY: -10, deltaMode: 0, ctrlKey: true }).steps).toBe(1)
    expect(wheelSteps(0, { deltaY: -10, deltaMode: 0, ctrlKey: true })).toEqual({ acc: 10, steps: 0 })
    expect(wheelSteps(0, { deltaY: -29, deltaMode: 0, ctrlKey: false })).toEqual({ acc: 29, steps: 0 })
    expect(wheelSteps(60, { deltaY: 20, deltaMode: 0, ctrlKey: false })).toEqual({ acc: -20, steps: 0 })
    expect(wheelSteps(60, { deltaY: 0, deltaMode: 0, ctrlKey: false })).toEqual({ acc: 60, steps: 0 })
    expect(wheelSteps(60, { deltaY: Number.NaN, deltaMode: 0, ctrlKey: false })).toEqual({ acc: 60, steps: 0 })
  })

  it('pinchStep: пороги и негодное начало', () => {
    expect(pinchStep(100, 136)).toBe(1)
    expect(pinchStep(100, 135)).toBe(0)
    expect(pinchStep(100, 74)).toBe(0)
    expect(pinchStep(100, 73)).toBe(-1)
    expect(pinchStep(0, 50)).toBe(0)
    expect(pinchStep(100, Number.NaN)).toBe(0)
  })
})
