import { describe, expect, it } from 'vitest'
import { GRAPH_DBL_MS, GRAPH_DBL_PX, GRAPH_SELECT_DEFER_MS, revealDecision, secondClickNode } from './interaction'
import { ensureVisible } from './geometry'
import type { RevealMemo } from './interaction'

describe('secondClickNode', () => {
  const camera = { x: 0, y: 0, zoom: 1 }
  const viewSize = { width: 900, height: 600 }
  const first = { id: 'a', x: 100, y: 50, t: 1000, camera, viewSize }
  // Сцена после первого клика изменилась: открылась панель деталей или камера пошла к ноде.
  const moved = { camera: { x: 5, y: 0, zoom: 1 }, viewSize }
  const narrowed = { camera, viewSize: { width: 440, height: 600 } }

  it('в пределах времени и сдвига, сцена сдвинулась — нода первого клика, даже если под указателем другое', () => {
    expect(secondClickNode(first, { x: 100, y: 50 }, 1200, moved)).toBe('a')
    expect(secondClickNode(first, { x: 100 + GRAPH_DBL_PX, y: 50 }, 1000 + GRAPH_DBL_MS, narrowed)).toBe('a')
  })

  it('сцена не менялась — null: под указателем честно та нода, что есть (соседняя на 25 %)', () => {
    expect(secondClickNode(first, { x: 108, y: 50 }, 1200, { camera, viewSize })).toBeNull()
  })

  it('позже, дальше или без памяти — null', () => {
    expect(secondClickNode(first, { x: 100, y: 50 }, 1001 + GRAPH_DBL_MS, moved)).toBeNull()
    expect(secondClickNode(first, { x: 100 + GRAPH_DBL_PX + 1, y: 50 }, 1100, moved)).toBeNull()
    expect(secondClickNode(first, { x: 100, y: 50 }, 999, moved)).toBeNull()
    expect(secondClickNode(first, { x: Number.NaN, y: 50 }, 1100, moved)).toBeNull()
    expect(secondClickNode(null, { x: 100, y: 50 }, 1100, moved)).toBeNull()
  })
})

describe('отложенный выбор', () => {
  it('не короче окна двойного клика, иначе медленный двойной клик попадёт в подложку листа', () => {
    expect(GRAPH_SELECT_DEFER_MS).toBeGreaterThanOrEqual(GRAPH_DBL_MS)
  })
})

describe('revealDecision', () => {
  const memo = (patch: Partial<RevealMemo> = {}): RevealMemo => ({
    id: 'a',
    x: 0,
    y: 0,
    width: 900,
    height: 600,
    cameraRev: 5,
    ...patch,
  })

  it('новая выбранная нода — показать', () => {
    expect(revealDecision(null, memo())).toEqual({ reveal: true, memo: memo(), moved: false })
    expect(revealDecision(memo({ id: 'b' }), memo()).reveal).toBe(true)
  })

  it('тот же выбор, новый размер, камера не двигалась (открылась панель деталей) — показать', () => {
    const r = revealDecision(memo(), memo({ width: 440 }))
    expect(r).toEqual({ reveal: true, memo: memo({ width: 440 }), moved: false })
  })

  it('тот же выбор, новый размер, но камеру двигали — не показывать, и после этого тоже', () => {
    const panned = revealDecision(memo(), memo({ height: 566, cameraRev: 9 }))
    expect(panned.reveal).toBe(false)
    expect(panned.memo).toEqual(memo({ height: 566 }))
    // Ещё одна смена размера без движения камеры — вид всё равно не возвращается.
    expect(revealDecision(panned.memo, memo({ height: 600, cameraRev: 9 })).reveal).toBe(false)
  })

  it('тот же выбор и тот же размер — не показывать (смена сцены не повод)', () => {
    expect(revealDecision(memo(), memo({ cameraRev: 9 }))).toEqual({ reveal: false, memo: memo(), moved: false })
  })

  it('нода переехала (смена категории) — показать, даже если камеру двигали', () => {
    expect(revealDecision(memo(), memo({ x: 640, cameraRev: 9 }))).toMatchObject({ reveal: true, moved: true })
    expect(revealDecision(memo(), memo({ y: -32 }))).toMatchObject({ reveal: true, moved: true })
  })

  it('новый id и смена только размера — moved: false', () => {
    expect(revealDecision(memo(), memo({ id: 'b' })).moved).toBe(false)
    expect(revealDecision(memo(), memo({ width: 440 })).moved).toBe(false)
    expect(revealDecision(memo(), memo({ width: 440, cameraRev: 9 })).moved).toBe(false)
  })

  it('брошенная у края нода (moved) камеру не двигает: запас 0 против запаса 64', () => {
    const v = { width: 460, height: 600, dpr: 1, camera: { x: 0, y: 0, zoom: 1 } }
    const p = { x: -190, y: 0 } // 40 px от левого края экрана
    expect(ensureVisible(v, p, 0)).toBeNull()
    expect(ensureVisible(v, p)).toEqual({ x: -190, y: 0, zoom: 1 })
  })
})
