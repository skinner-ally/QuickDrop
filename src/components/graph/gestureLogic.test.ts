import { describe, expect, it } from 'vitest'
import {
  bitmapSize,
  buttonsReleased,
  clearRect32,
  deferSelect,
  movePx,
  resizeKeep,
  tabRingNext,
  underDetailPanel,
} from '@/components/graph/gestureLogic'
import { resizeCamera, worldToScreen } from '@/lib/graph/geometry'

describe('movePx', () => {
  it('палец — 10 px, мышь и перо — 4 px', () => {
    expect(movePx(true)).toBe(10)
    expect(movePx(false)).toBe(4)
  })
})

describe('buttonsReleased', () => {
  it('мышь и перо без кнопок — нажатие зависло', () => {
    expect(buttonsReleased('mouse', 0)).toBe(true)
    expect(buttonsReleased('pen', 0)).toBe(true)
  })
  it('нажатая кнопка (левая, средняя) и касание — нет', () => {
    expect(buttonsReleased('mouse', 1)).toBe(false)
    expect(buttonsReleased('mouse', 4)).toBe(false)
    expect(buttonsReleased('touch', 0)).toBe(false)
  })
})

describe('deferSelect', () => {
  it('модальный лист (узкое окно): мышью откладывается всегда', () => {
    expect(deferSelect(false, false)).toBe(true)
    expect(deferSelect(false, false, true, false)).toBe(true)
    expect(deferSelect(false, false, false, false)).toBe(true)
  })
  it('боковая панель закрыта и откроется под указателем — откладывается', () => {
    expect(deferSelect(false, true, false, true)).toBe(true)
  })
  it('боковая панель закрыта, но клик левее её полосы — сразу', () => {
    expect(deferSelect(false, true, false, false)).toBe(false)
  })
  it('боковая панель уже открыта — раскладка не сдвинется, сразу', () => {
    expect(deferSelect(false, true, true, true)).toBe(false)
    expect(deferSelect(false, true)).toBe(false)
  })
  it('касание — никогда', () => {
    expect(deferSelect(true, false)).toBe(false)
    expect(deferSelect(true, true, false, true)).toBe(false)
  })
})

describe('underDetailPanel', () => {
  it('клик правее левого края панели (с запасом) — под панелью', () => {
    // окно 1200, панель 460: левый край панели в 740, запас 16 → от 724
    expect(underDetailPanel(725, 1200, 460)).toBe(true)
    expect(underDetailPanel(724, 1200, 460)).toBe(false)
    expect(underDetailPanel(300, 1200, 460)).toBe(false)
    expect(underDetailPanel(Number.NaN, 1200, 460)).toBe(false)
  })
})

describe('bitmapSize', () => {
  it('без точного размера — round(css·dpr)', () => {
    expect(bitmapSize(803.6, 400, 1.25)).toEqual({ W: 1005, H: 500 })
    expect(bitmapSize(1001, 600, 1.5)).toEqual({ W: 1502, H: 900 })
  })
  it('точный размер устройства важнее округления', () => {
    expect(bitmapSize(1001, 600, 1.5, { inlineSize: 1501, blockSize: 899 })).toEqual({ W: 1501, H: 899 })
    expect(bitmapSize(803.6, 400, 1.25, { inlineSize: 1004, blockSize: 500 })).toEqual({ W: 1004, H: 500 })
  })
  it('негодные значения — 0, негодный dpr — 1', () => {
    expect(bitmapSize(-5, Number.NaN, 2)).toEqual({ W: 0, H: 0 })
    expect(bitmapSize(100, 50, Number.NaN)).toEqual({ W: 100, H: 50 })
    expect(bitmapSize(100, 50, 1, { inlineSize: Number.NaN, blockSize: -1 })).toEqual({ W: 0, H: 0 })
  })
})

describe('resizeKeep', () => {
  it('доли пикселя: держим центр, камера не уползает', () => {
    const prev = { left: 232, top: 40, width: 1000, height: 600 }
    expect(resizeKeep(prev, { left: 232, top: 40, width: 1000.4, height: 600.8 })).toEqual({ x: 0.5, y: 0.5 })
    expect(resizeKeep(prev, { left: 232.2, top: 40, width: 1000.4, height: 600 })).toEqual({ x: 0.5, y: 0 })
  })
  it('без прежней рамки — левый верхний угол', () => {
    expect(resizeKeep(null, { left: 0, top: 0, width: 10, height: 10 })).toEqual({ x: 0, y: 0 })
  })
  it('панель справа: левый край на месте', () => {
    const k = resizeKeep({ left: 240, top: 100, width: 900, height: 600 }, { left: 240, top: 100, width: 440, height: 600 })
    expect(Math.abs(k.x)).toBe(0)
    expect(Math.abs(k.y)).toBe(0)
  })
  it('строка фильтров сверху: на месте нижний край', () => {
    const k = resizeKeep({ left: 0, top: 100, width: 900, height: 600 }, { left: 0, top: 134, width: 900, height: 566 })
    expect(k.y).toBe(1)
  })
  it('с resizeCamera содержимое не двигается на экране при сдвиге любого края', () => {
    const camera = { x: 100, y: 50, zoom: 0.5 }
    const prev = { left: 240, top: 100, width: 900, height: 600 }
    const cases = [
      { left: 240, top: 100, width: 440, height: 600 }, // справа открылась панель
      { left: 240, top: 134, width: 900, height: 566 }, // сверху строка фильтров
      { left: 200, top: 90, width: 1000, height: 640 }, // окно растянули за левый верхний угол
    ]
    for (const next of cases) {
      const cam = resizeCamera(camera, prev, next, resizeKeep(prev, next))
      for (const w of [{ x: 0, y: 0 }, { x: 640, y: -320 }, { x: -1000, y: 900 }]) {
        const a = worldToScreen({ width: prev.width, height: prev.height, dpr: 1, camera }, w)
        const b = worldToScreen({ width: next.width, height: next.height, dpr: 1, camera: cam }, w)
        expect(b.x + next.left).toBeCloseTo(a.x + prev.left, 6)
        expect(b.y + next.top).toBeCloseTo(a.y + prev.top, 6)
      }
    }
  })
})

describe('tabRingNext', () => {
  it('начало обхода: Tab — первый сосед, Shift+Tab — последний', () => {
    expect(tabRingNext(3, -1, false)).toBe(0)
    expect(tabRingNext(3, -1, true)).toBe(2)
  })
  it('обход конечный: после последнего (первого при Shift) — null, фокус уходит дальше', () => {
    expect(tabRingNext(3, 0, false)).toBe(1)
    expect(tabRingNext(3, 1, false)).toBe(2)
    expect(tabRingNext(3, 2, false)).toBeNull()
    expect(tabRingNext(3, 2, true)).toBe(1)
    expect(tabRingNext(3, 0, true)).toBeNull()
  })
  it('без соседей — null', () => {
    expect(tabRingNext(0, -1, false)).toBeNull()
  })
})

describe('clearRect32', () => {
  it('обнуляет только рамку, остальное не трогает', () => {
    const W = 8
    const data = new Uint32Array(W * 6).fill(7)
    clearRect32(data, W, { x0: 2, y0: 1, x1: 5, y1: 3 })
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < W; x++) {
        const inside = x >= 2 && x < 5 && y >= 1 && y < 3
        expect(data[y * W + x]).toBe(inside ? 0 : 7)
      }
    }
  })
  it('рамка за краем буфера обрезается', () => {
    const data = new Uint32Array(4 * 4).fill(1)
    clearRect32(data, 4, { x0: -3, y0: 2, x1: 99, y1: 99 })
    expect([...data.slice(0, 8)].every((v) => v === 1)).toBe(true)
    expect([...data.slice(8)].every((v) => v === 0)).toBe(true)
    clearRect32(data, 4, { x0: 3, y0: 0, x1: 3, y1: 4 })
    expect(data[0]).toBe(1)
  })
})
