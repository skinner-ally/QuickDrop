import { describe, expect, it } from 'vitest'
import {
  HANDLE_MIN_ZOOM,
  HANDLE_OVERLAP,
  HANDLE_SIZE,
  estimateTextWidth,
  handleBox,
  handleVisible,
  labelBoxWidth,
  nodeOffScene,
  placeBox,
  tooltipTarget,
} from '@/components/graph/overlayGeometry'
import { GRAPH_CELL, GRAPH_NODE_SIZE } from '@/lib/graphLayout'

interface Rect {
  l: number
  t: number
  r: number
  b: number
}
const hit = (a: Rect, b: Rect) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b

/** Квадраты восьми соседей по сетке вокруг ноды с центром c при масштабе z. */
function neighbours(c: { x: number; y: number }, z: number): Rect[] {
  const half = (GRAPH_NODE_SIZE * z) / 2
  const out: Rect[] = []
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue
      const x = c.x + dx * GRAPH_CELL * z
      const y = c.y + dy * GRAPH_CELL * z
      out.push({ l: x - half, t: y - half, r: x + half, b: y + half })
    }
  }
  return out
}

describe('handleBox: ручка связи снаружи ноды и не закрывает соседей', () => {
  const view = { width: 1000, height: 700 }
  const size = HANDLE_SIZE
  const nodeRect = (c: { x: number; y: number }, z: number): Rect => {
    const half = (GRAPH_NODE_SIZE * z) / 2
    return { l: c.x - half, t: c.y - half, r: c.x + half, b: c.y + half }
  }
  // Ручка на касании не показывается (handleVisible), 36 px здесь не проверяется.
  for (const z of [1, 1.5, 2]) {
    for (const [name, c] of [
      ['в середине сцены', { x: 500, y: 350 }],
      ['у нижнего края (flip)', { x: 500, y: 690 }],
      ['у правого края (flip)', { x: 990, y: 350 }],
      ['в правом нижнем углу (flip по обеим осям)', { x: 990, y: 690 }],
    ] as const) {
      it(`масштаб ${z}, ${name}: центр ноды свободен, нода закрыта не больше чем на 4 px, соседи целы`, () => {
        const half = (GRAPH_NODE_SIZE * z) / 2
        const pos = handleBox(c, half, { w: size, h: size }, view)
        expect(pos).not.toBeNull()
        const box: Rect = { l: pos!.left, t: pos!.top, r: pos!.left + size, b: pos!.top + size }
        // центр ноды не под ручкой
        expect(c.x >= box.l && c.x <= box.r && c.y >= box.t && c.y <= box.b).toBe(false)
        // заход на квадрат ноды — не больше HANDLE_OVERLAP по каждой оси
        const n = nodeRect(c, z)
        const ox = Math.min(box.r, n.r) - Math.max(box.l, n.l)
        const oy = Math.min(box.b, n.b) - Math.max(box.t, n.t)
        expect(ox).toBeLessThanOrEqual(HANDLE_OVERLAP + 0.5)
        expect(oy).toBeLessThanOrEqual(HANDLE_OVERLAP + 0.5)
        for (const nb of neighbours(c, z)) expect(hit(box, nb)).toBe(false)
      })
    }
  }

  it('порог масштаба ручки не ниже того, с которого она помещается за углом ноды', () => {
    // край соседа — в 24·z от центра, ручка достаёт на 8·z − 4 + размер
    expect(8 * HANDLE_MIN_ZOOM - HANDLE_OVERLAP + HANDLE_SIZE).toBeLessThanOrEqual(24 * HANDLE_MIN_ZOOM)
  })

  it('ручка начинается в 4 px от угла внутрь ноды', () => {
    const pos = handleBox({ x: 500, y: 350 }, 8, { w: 20, h: 20 }, view)
    expect(pos).toEqual({ left: 500 + 8 - HANDLE_OVERLAP, top: 350 + 8 - HANDLE_OVERLAP })
  })

  it('нода за краем сцены — ручки нет (она не прилипает к краю)', () => {
    const sz = { w: 20, h: 20 }
    expect(handleBox({ x: -200, y: 300 }, 8, sz, view)).toBeNull()
    expect(handleBox({ x: 1300, y: 300 }, 8, sz, view)).toBeNull()
    expect(handleBox({ x: 300, y: -50 }, 8, sz, view)).toBeNull()
    expect(handleBox({ x: 300, y: 900 }, 8, sz, view)).toBeNull()
  })

  it('нода, которая видна хотя бы краем, получает ручку внутри сцены', () => {
    const pos = handleBox({ x: -4, y: 300 }, 8, { w: 20, h: 20 }, view)
    expect(pos).not.toBeNull()
    expect(pos!.left).toBeGreaterThanOrEqual(2)
  })
})

describe('handleVisible', () => {
  const on = { wide: true, coarse: false, zoom: 1, dragging: false }
  it('широкое окно, мышь, масштаб от порога, нет жеста — да', () => {
    expect(handleVisible(on)).toBe(true)
    expect(handleVisible({ ...on, zoom: 2 })).toBe(true)
  })
  it('касание, узкое окно, мелкий масштаб, жест — нет', () => {
    expect(handleVisible({ ...on, coarse: true })).toBe(false)
    expect(handleVisible({ ...on, wide: false })).toBe(false)
    expect(handleVisible({ ...on, zoom: 0.75 })).toBe(false)
    expect(handleVisible({ ...on, dragging: true })).toBe(false)
  })
})

describe('nodeOffScene', () => {
  const view = { width: 400, height: 300 }
  it('квадрат целиком снаружи — да; касается или виден — нет', () => {
    expect(nodeOffScene({ x: -9, y: 100 }, 8, view)).toBe(true)
    expect(nodeOffScene({ x: -8, y: 100 }, 8, view)).toBe(false)
    expect(nodeOffScene({ x: 409, y: 100 }, 8, view)).toBe(true)
    expect(nodeOffScene({ x: 100, y: 309 }, 8, view)).toBe(true)
    expect(nodeOffScene({ x: 200, y: 150 }, 8, view)).toBe(false)
  })
})

describe('tooltipTarget', () => {
  const base = { hoveredId: null, shownId: null, cursorId: null, selectedId: null, coarse: false, byKeys: true }
  it('наведение: до задержки ничего, после — наведённая нода (курсор не мешает)', () => {
    expect(tooltipTarget({ ...base, hoveredId: 'b', cursorId: 'a' })).toBeNull()
    expect(tooltipTarget({ ...base, hoveredId: 'b', shownId: 'a', cursorId: 'a' })).toBeNull()
    expect(tooltipTarget({ ...base, hoveredId: 'b', shownId: 'b', cursorId: 'a' })).toBe('b')
    // Наведение важнее курсора и без признака клавиатуры.
    expect(tooltipTarget({ ...base, byKeys: false, hoveredId: 'b', shownId: 'b', cursorId: 'a' })).toBe('b')
  })
  it('без наведения — нода под курсором, поставленным клавиатурой, сразу', () => {
    expect(tooltipTarget({ ...base, cursorId: 'a' })).toBe('a')
    expect(tooltipTarget({ ...base, cursorId: 'a', selectedId: 'x' })).toBe('a')
  })
  it('курсор после клика мышью (не клавиатура) подсказки не даёт: закрыли детали — плашка не висит', () => {
    expect(tooltipTarget({ ...base, cursorId: 'a', byKeys: false })).toBeNull()
  })
  it('курсор на открытой в деталях записи, касание и пустой курсор — подсказки нет', () => {
    expect(tooltipTarget({ ...base, cursorId: 'a', selectedId: 'a' })).toBeNull()
    expect(tooltipTarget({ ...base, cursorId: 'a', coarse: true })).toBeNull()
    expect(tooltipTarget(base)).toBeNull()
  })
})

describe('ширина подписи', () => {
  it('разрядка и отступы добавляются к ширине текста', () => {
    expect(labelBoxWidth(50, 10, 1)).toBe(68)
    expect(labelBoxWidth(50, 10, 0)).toBe(58)
    expect(labelBoxWidth(50, 10, Number.NaN)).toBe(58)
  })
  it('оценка без canvas растёт вместе с кеглем', () => {
    expect(estimateTextWidth(10, 12)).toBe(70)
    expect(estimateTextWidth(10, 16)).toBeGreaterThan(estimateTextWidth(10, 12))
    expect(estimateTextWidth(10, Number.NaN)).toBe(70)
  })
})

describe('placeBox (перенесён без изменений)', () => {
  const view = { width: 300, height: 200 }
  it('зажимает в сцену и переворачивает у края', () => {
    expect(placeBox({ x: 100, y: 50 }, { w: 40, h: 20 }, view)).toEqual({ left: 100, top: 50 })
    expect(placeBox({ x: 290, y: 50 }, { w: 40, h: 20 }, view, { flipX: 250 })).toEqual({ left: 210, top: 50 })
    expect(placeBox({ x: -50, y: 500 }, { w: 40, h: 20 }, view)).toEqual({ left: 8, top: 172 })
  })
})
