import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type GraphModule = typeof import('./graph')

/** Стор читает камеру при создании, поэтому каждому тесту нужен свежий модуль. */
async function loadStore(): Promise<GraphModule> {
  vi.resetModules()
  return import('./graph')
}

/** Подделка localStorage: считает обращения, по желанию бросает. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      data.delete(key)
    }),
  }
}

const KEY = 'qd-graph-camera'
const ARCHIVE_KEY = 'qd-graph-archive'
const HINT_KEY = 'qd-graph-hint'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('useGraph без localStorage', () => {
  it('значения по умолчанию', async () => {
    expect(typeof localStorage).toBe('undefined')
    const { useGraph, GRAPH_CAMERA_KEY } = await loadStore()
    expect(GRAPH_CAMERA_KEY).toBe(KEY)
    const state = useGraph.getState()
    expect(state.camera).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(state.cameraRestored).toBe(false)
    expect(state.viewSize).toEqual({ width: 0, height: 0 })
    expect(state.bounds).toBeNull()
    expect(state.hoveredId).toBeNull()
    expect(state.cursorId).toBeNull()
    expect(state.drag).toBeNull()
    expect(state.linkFrom).toBeNull()
    expect(state.selectedLink).toBeNull()
    expect(state.menu).toBeNull()
    expect(state.pickerFor).toBeNull()
    expect(state.showArchive).toBe(true)
    expect(state.hintSeen).toBe(false)
    expect('focusZone' in state).toBe(false)
  })

  it('setCamera меняет только переданные поля', async () => {
    const { useGraph } = await loadStore()
    useGraph.getState().setCamera({ x: 120, y: -40 })
    expect(useGraph.getState().camera).toEqual({ x: 120, y: -40, zoom: 1 })
    useGraph.getState().setCamera({ zoom: 2 })
    expect(useGraph.getState().camera).toEqual({ x: 120, y: -40, zoom: 2 })
    useGraph.getState().setCamera({})
    expect(useGraph.getState().camera).toEqual({ x: 120, y: -40, zoom: 2 })
  })

  it('setCamera приводит масштаб к ступени, держит его в пределах 0.125…2 и пропускает негодные значения', async () => {
    const { useGraph, GRAPH_ZOOM_MIN, GRAPH_ZOOM_MAX } = await loadStore()
    expect([GRAPH_ZOOM_MIN, GRAPH_ZOOM_MAX]).toEqual([0.125, 2])
    const { setCamera } = useGraph.getState()
    setCamera({ zoom: 100 })
    expect(useGraph.getState().camera.zoom).toBe(2)
    setCamera({ zoom: 0 })
    expect(useGraph.getState().camera.zoom).toBe(0.125)
    setCamera({ zoom: -3 })
    expect(useGraph.getState().camera.zoom).toBe(0.125)
    setCamera({ zoom: 0.6 })
    expect(useGraph.getState().camera.zoom).toBe(0.5)
    setCamera({ zoom: 0.7 })
    expect(useGraph.getState().camera.zoom).toBe(0.75)

    setCamera({ x: 10, y: 20, zoom: 1.5 })
    setCamera({ x: Number.NaN, y: Number.POSITIVE_INFINITY, zoom: Number.NaN })
    setCamera({ x: '7' as unknown as number, zoom: null as unknown as number })
    expect(useGraph.getState().camera).toEqual({ x: 10, y: 20, zoom: 1.5 })

    // Дальше предела координат графа камере смотреть не на что.
    setCamera({ x: 5e9, y: -5e9 })
    expect(useGraph.getState().camera).toEqual({ x: 1_000_000, y: -1_000_000, zoom: 1.5 })
  })

  it('setCamera без изменений не будит подписчиков', async () => {
    const { useGraph } = await loadStore()
    useGraph.getState().setCamera({ x: 5 })
    const listener = vi.fn()
    const unsubscribe = useGraph.subscribe(listener)
    const before = useGraph.getState().camera
    useGraph.getState().setCamera({ x: 5 })
    useGraph.getState().setCamera({ y: Number.NaN })
    useGraph.getState().setCamera({ y: -0 })
    expect(listener).not.toHaveBeenCalled()
    expect(useGraph.getState().camera).toBe(before)
    useGraph.getState().setCamera({ x: 6 })
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('resetCamera возвращает камеру по умолчанию, не трогая остальное', async () => {
    const { useGraph } = await loadStore()
    useGraph.getState().setCamera({ x: 300, y: 200, zoom: 0.5 })
    useGraph.getState().setHovered('item-1')
    useGraph.getState().setCursor('item-2')
    useGraph.getState().resetCamera()
    expect(useGraph.getState().camera).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(useGraph.getState().hoveredId).toBe('item-1')
    expect(useGraph.getState().cursorId).toBe('item-2')
  })

  it('setHovered, setCursor, setDrag, setLinkFrom; то же значение не будит подписчиков', async () => {
    const { useGraph } = await loadStore()
    const listener = vi.fn()
    const unsubscribe = useGraph.subscribe(listener)

    useGraph.getState().setHovered('a')
    expect(useGraph.getState().hoveredId).toBe('a')
    useGraph.getState().setHovered('a')
    expect(listener).toHaveBeenCalledTimes(1)
    useGraph.getState().setHovered(null)
    expect(useGraph.getState().hoveredId).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)

    useGraph.getState().setCursor('c')
    useGraph.getState().setCursor('c')
    expect(useGraph.getState().cursorId).toBe('c')
    expect(listener).toHaveBeenCalledTimes(3)

    useGraph.getState().setDrag('node')
    useGraph.getState().setDrag('node')
    expect(useGraph.getState().drag).toBe('node')
    useGraph.getState().setDrag(null)
    expect(listener).toHaveBeenCalledTimes(5)

    useGraph.getState().setLinkFrom('x')
    useGraph.getState().setLinkFrom('x')
    expect(useGraph.getState().linkFrom).toBe('x')
    expect(listener).toHaveBeenCalledTimes(6)
    unsubscribe()
  })

  it('работает молча: ничего не бросает и не ставит таймер записи', async () => {
    const { useGraph } = await loadStore()
    expect(() => {
      useGraph.getState().setCamera({ x: 1, y: 2, zoom: 3 })
      useGraph.getState().resetCamera()
      useGraph.getState().setCamera({ x: 64 })
    }).not.toThrow()
    expect(vi.getTimerCount()).toBe(0)
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow()
    expect(useGraph.getState().camera).toEqual({ x: 64, y: 0, zoom: 1 })
  })
})

describe('useGraph с localStorage', () => {
  it('читает сохранённую камеру при создании стора', async () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ x: 512, y: -96, zoom: 0.5 }) })
    vi.stubGlobal('localStorage', storage)
    const { useGraph } = await loadStore()
    expect(useGraph.getState().camera).toEqual({ x: 512, y: -96, zoom: 0.5 })
    expect(storage.getItem).toHaveBeenCalledWith(KEY)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('масштаб вне ступеней подтягивается к ближайшей ступени', async () => {
    vi.stubGlobal('localStorage', fakeStorage({ [KEY]: JSON.stringify({ x: 1, y: 2, zoom: 50 }) }))
    expect((await loadStore()).useGraph.getState().camera).toEqual({ x: 1, y: 2, zoom: 2 })

    vi.stubGlobal('localStorage', fakeStorage({ [KEY]: JSON.stringify({ x: 1, y: 2, zoom: 0 }) }))
    expect((await loadStore()).useGraph.getState().camera).toEqual({ x: 1, y: 2, zoom: 0.125 })

    vi.stubGlobal('localStorage', fakeStorage({ [KEY]: JSON.stringify({ x: 1, y: 2, zoom: 1.2 }) }))
    expect((await loadStore()).useGraph.getState().camera).toEqual({ x: 1, y: 2, zoom: 1 })
  })

  it('cameraRestored: только если из хранилища прочитана годная камера', async () => {
    vi.stubGlobal('localStorage', fakeStorage({ [KEY]: JSON.stringify({ x: 1, y: 2, zoom: 0.5 }) }))
    expect((await loadStore()).useGraph.getState().cameraRestored).toBe(true)

    vi.stubGlobal('localStorage', fakeStorage())
    expect((await loadStore()).useGraph.getState().cameraRestored).toBe(false)

    vi.stubGlobal('localStorage', fakeStorage({ [KEY]: '{oops' }))
    expect((await loadStore()).useGraph.getState().cameraRestored).toBe(false)

    vi.stubGlobal('localStorage', fakeStorage({ [KEY]: JSON.stringify({ x: 1, y: 2 }) }))
    expect((await loadStore()).useGraph.getState().cameraRestored).toBe(false)
  })

  it.each([
    ['не JSON', '{oops'],
    ['пустая строка', ''],
    ['null', 'null'],
    ['число', '5'],
    ['массив', '[1, 2, 3]'],
    ['нет поля', JSON.stringify({ x: 1, y: 2 })],
    ['строка вместо числа', JSON.stringify({ x: '1', y: 2, zoom: 1 })],
    ['null вместо числа', JSON.stringify({ x: 1, y: null, zoom: 1 })],
    ['масштаб не число', JSON.stringify({ x: 1, y: 2, zoom: 'big' })],
    ['переполнение до Infinity', '{"x":1e999,"y":0,"zoom":1}'],
  ])('негодное сохранённое значение (%s) → камера по умолчанию', async (_name, raw) => {
    vi.stubGlobal('localStorage', fakeStorage({ [KEY]: raw }))
    const { useGraph } = await loadStore()
    expect(useGraph.getState().camera).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(useGraph.getState().cameraRestored).toBe(false)
  })

  it('setCamera пишет с задержкой 300 мс, серия изменений — одна запись с последним значением', async () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    const { useGraph } = await loadStore()

    useGraph.getState().setCamera({ x: 10 })
    vi.advanceTimersByTime(200)
    useGraph.getState().setCamera({ x: 20, zoom: 2 })
    vi.advanceTimersByTime(299)
    expect(storage.setItem).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(JSON.parse(storage.data.get(KEY)!)).toEqual({ x: 20, y: 0, zoom: 2 })

    // Без изменений запись не повторяется.
    useGraph.getState().setCamera({ x: 20 })
    vi.advanceTimersByTime(1000)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
  })

  it('resetCamera тоже сохраняется; наведение и курсор — нет', async () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ x: 512, y: -96, zoom: 0.5 }) })
    vi.stubGlobal('localStorage', storage)
    const { useGraph } = await loadStore()

    useGraph.getState().setHovered('a')
    useGraph.getState().setCursor('b')
    vi.advanceTimersByTime(1000)
    expect(storage.setItem).not.toHaveBeenCalled()

    useGraph.getState().resetCamera()
    vi.advanceTimersByTime(300)
    expect(JSON.parse(storage.data.get(KEY)!)).toEqual({ x: 0, y: 0, zoom: 1 })
  })

  it('сохранённая камера переживает пересоздание стора', async () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    const first = await loadStore()
    first.useGraph.getState().setCamera({ x: -640, y: 320, zoom: 0.25 })
    first.useGraph.getState().setCursor('cat-1')
    vi.advanceTimersByTime(300)

    const second = await loadStore()
    expect(second.useGraph).not.toBe(first.useGraph)
    expect(second.useGraph.getState().camera).toEqual({ x: -640, y: 320, zoom: 0.25 })
    expect(second.useGraph.getState().cameraRestored).toBe(true)
    expect(second.useGraph.getState().cursorId).toBeNull()
  })

  it('хранилище, которое бросает при чтении и записи, не мешает работе', async () => {
    const storage = fakeStorage()
    storage.getItem.mockImplementation(() => {
      throw new Error('SecurityError')
    })
    storage.setItem.mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    vi.stubGlobal('localStorage', storage)
    const { useGraph } = await loadStore()
    expect(useGraph.getState().camera).toEqual({ x: 0, y: 0, zoom: 1 })
    useGraph.getState().setCamera({ x: 7 })
    expect(() => vi.advanceTimersByTime(300)).not.toThrow()
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    expect(useGraph.getState().camera).toEqual({ x: 7, y: 0, zoom: 1 })
  })

  it('обращение к localStorage бросает (приватный режим) — молча в памяти', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError')
      },
    })
    const { useGraph } = await loadStore()
    expect(useGraph.getState().camera).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(() => useGraph.getState().setCamera({ x: 3, zoom: 2 })).not.toThrow()
    expect(vi.getTimerCount()).toBe(0)
    expect(useGraph.getState().camera).toEqual({ x: 3, y: 0, zoom: 2 })
  })
})

describe('useGraph: ступени масштаба и вид', () => {
  it('zoomStep: ступени вверх и вниз, на краях камера не меняется', async () => {
    const { useGraph } = await loadStore()
    const zoomOf = () => useGraph.getState().camera.zoom
    const seen: number[] = [zoomOf()]
    for (let i = 0; i < 4; i++) {
      useGraph.getState().zoomStep(1)
      seen.push(zoomOf())
    }
    expect(seen).toEqual([1, 1.5, 2, 2, 2])
    const listener = vi.fn()
    const unsubscribe = useGraph.subscribe(listener)
    useGraph.getState().zoomStep(1)
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()

    for (let i = 0; i < 10; i++) useGraph.getState().zoomStep(-1)
    expect(zoomOf()).toBe(0.125)
    const before = useGraph.getState().camera
    useGraph.getState().zoomStep(-1)
    expect(useGraph.getState().camera).toBe(before)
  })

  it('zoomStep: точка под якорем остаётся под ним; по умолчанию якорь — центр', async () => {
    const { useGraph } = await loadStore()
    useGraph.getState().setViewSize(800, 600)
    useGraph.getState().setCamera({ x: 100, y: 50, zoom: 1 })
    // Якорь в левом верхнем углу: мировая точка (100 − 400, 50 − 300) = (−300, −250) остаётся на месте.
    useGraph.getState().zoomStep(1, { x: 0, y: 0 })
    const c = useGraph.getState().camera
    expect(c.zoom).toBe(1.5)
    expect(c.x - 400 / c.zoom).toBeCloseTo(-300, 6)
    expect(c.y - 300 / c.zoom).toBeCloseTo(-250, 6)

    useGraph.getState().setCamera({ x: 7, y: 9, zoom: 1 })
    useGraph.getState().zoomStep(-1)
    expect(useGraph.getState().camera).toEqual({ x: 7, y: 9, zoom: 0.75 })
  })

  it('panBy сдвигает содержимое: камера уходит в обратную сторону, с учётом масштаба', async () => {
    const { useGraph } = await loadStore()
    useGraph.getState().setCamera({ x: 0, y: 0, zoom: 2 })
    useGraph.getState().panBy(40, -20)
    expect(useGraph.getState().camera).toEqual({ x: -20, y: 10, zoom: 2 })
    useGraph.getState().panBy(Number.NaN, 1)
    expect(useGraph.getState().camera).toEqual({ x: -20, y: 10, zoom: 2 })
  })

  it('setViewSize: тот же размер не будит подписчиков, негодный → 0', async () => {
    const { useGraph } = await loadStore()
    const listener = vi.fn()
    const unsubscribe = useGraph.subscribe(listener)
    useGraph.getState().setViewSize(800, 600)
    useGraph.getState().setViewSize(800, 600)
    expect(listener).toHaveBeenCalledTimes(1)
    useGraph.getState().setViewSize(Number.NaN, -5)
    expect(useGraph.getState().viewSize).toEqual({ width: 0, height: 0 })
    unsubscribe()
  })

  it('setViewSize: содержимое не сдвигается на экране (левый верхний угол на месте), cameraRev не растёт', async () => {
    const { useGraph } = await loadStore()
    const { worldToScreen } = await import('@/lib/graph/geometry')
    const screen = (p: { x: number; y: number }) => {
      const { camera, viewSize } = useGraph.getState()
      return worldToScreen({ width: viewSize.width, height: viewSize.height, dpr: 1, camera }, p)
    }
    useGraph.getState().setViewSize(900, 600)
    useGraph.getState().setCamera({ x: 100, y: 50, zoom: 0.5 })
    const rev = useGraph.getState().cameraRev
    const pts = [{ x: 0, y: 0 }, { x: 640, y: -96 }, { x: -1200, y: 300 }]
    const before = pts.map(screen)
    // Справа открылась панель деталей 460 px.
    useGraph.getState().setViewSize(440, 600)
    pts.forEach((p, i) => {
      expect(Math.abs(screen(p).x - before[i].x)).toBeLessThanOrEqual(1)
      expect(Math.abs(screen(p).y - before[i].y)).toBeLessThanOrEqual(1)
    })
    expect(useGraph.getState().cameraRev).toBe(rev)
    // Сдвинулся верхний край (строка фильтров) — на месте нижний.
    const low = pts.map(screen)
    useGraph.getState().setViewSize(440, 566, { x: 0, y: 1 })
    pts.forEach((p, i) => {
      expect(Math.abs(screen(p).x - low[i].x)).toBeLessThanOrEqual(1)
      expect(Math.abs(566 - screen(p).y - (600 - low[i].y))).toBeLessThanOrEqual(1)
    })
    // Панель закрылась — камера вернулась точно.
    useGraph.getState().setViewSize(440, 600, { x: 0, y: 1 })
    useGraph.getState().setViewSize(900, 600)
    expect(useGraph.getState().camera).toEqual({ x: 100, y: 50, zoom: 0.5 })
  })

  it('setViewSize: 900 → 440 → 0 → 900 возвращает камеру точно (панель закрылась вместе с уходом из раздела)', async () => {
    const { useGraph } = await loadStore()
    useGraph.getState().setViewSize(900, 600)
    useGraph.getState().setCamera({ x: 100, y: 50, zoom: 0.5 })
    useGraph.getState().setViewSize(440, 600, { x: 0, y: 0 })
    expect(useGraph.getState().camera).not.toEqual({ x: 100, y: 50, zoom: 0.5 })
    useGraph.getState().setViewSize(0, 0)
    // В 0 камера не меняется.
    const hidden = useGraph.getState().camera
    expect(hidden.x).toBe(100 + (0.5 * (440 - 900)) / 0.5)
    useGraph.getState().setViewSize(900, 600)
    expect(useGraph.getState().camera).toEqual({ x: 100, y: 50, zoom: 0.5 })
  })

  it('setViewSize: три цикла 920 → 460 → 0 → 920 не уводят ноду по экрану', async () => {
    const { useGraph } = await loadStore()
    const { worldToScreen } = await import('@/lib/graph/geometry')
    const screenX = () => {
      const { camera, viewSize } = useGraph.getState()
      return worldToScreen({ width: viewSize.width, height: viewSize.height, dpr: 1, camera }, { x: -100, y: 0 }).x
    }
    useGraph.getState().setViewSize(920, 600)
    const x0 = screenX()
    for (let i = 0; i < 3; i++) {
      useGraph.getState().setViewSize(460, 600, { x: 0, y: 0 })
      useGraph.getState().setViewSize(0, 0)
      useGraph.getState().setViewSize(920, 600)
      expect(screenX()).toBe(x0)
    }
  })

  it('setViewSize: камера, сохранённая при открытой панели, после перезагрузки возвращается к полной ширине', async () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    const first = await loadStore()
    first.useGraph.getState().setViewSize(920, 600)
    first.useGraph.getState().setCamera({ x: 100, y: 50, zoom: 1 })
    first.useGraph.getState().setViewSize(460, 600, { x: 0, y: 0 })
    vi.runOnlyPendingTimers()
    expect(JSON.parse(storage.data.get(KEY)!)).toMatchObject({ w: 460, h: 600 })

    const second = await loadStore()
    second.useGraph.getState().setViewSize(920, 600)
    expect(second.useGraph.getState().camera).toEqual({ x: 100, y: 50, zoom: 1 })
  })

  it('setViewSize: первый замер без памяти камеру не трогает; старый формат без размера читается', async () => {
    vi.stubGlobal('localStorage', fakeStorage({ [KEY]: JSON.stringify({ x: 1, y: 2, zoom: 1 }) }))
    const { useGraph } = await loadStore()
    useGraph.getState().setViewSize(440, 600)
    expect(useGraph.getState().camera).toEqual({ x: 1, y: 2, zoom: 1 })
  })

  it('setViewSize: доли пикселя при keep по центру камеру и localStorage не трогают', async () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    const { useGraph } = await loadStore()
    useGraph.getState().setViewSize(800, 600)
    const cam = useGraph.getState().camera
    useGraph.getState().setViewSize(800.4, 600.6, { x: 0.5, y: 0.5 })
    expect(useGraph.getState().camera).toBe(cam)
    vi.advanceTimersByTime(1000)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('cursorByKeys: клик ставит false, клавиатура — true, смена и null снимают, resetTransient сбрасывает', async () => {
    const { useGraph } = await loadStore()
    const g = () => useGraph.getState()
    g().setCursor('a')
    expect(g().cursorByKeys).toBe(false)
    g().setCursor('a', true)
    expect(g().cursorByKeys).toBe(true)
    g().setCursor('a')
    expect(g().cursorByKeys).toBe(false)
    g().setCursor('a', true)
    g().setCursor(null, true)
    expect(g().cursorByKeys).toBe(false)
    g().setCursor('b', true)
    g().resetTransient()
    expect(g().cursorByKeys).toBe(false)
    expect(g().cursorId).toBeNull()
  })

  it('cameraRev растёт при каждом изменении камеры и не растёт без изменения', async () => {
    const { useGraph } = await loadStore()
    const rev = () => useGraph.getState().cameraRev
    expect(rev()).toBe(0)
    useGraph.getState().setViewSize(800, 600)
    useGraph.getState().panBy(10, 0)
    expect(rev()).toBe(1)
    useGraph.getState().zoomStep(1)
    useGraph.getState().centerOn({ x: 5, y: 5 })
    expect(rev()).toBe(3)
    useGraph.getState().setCamera({ x: 5, y: 5 })
    expect(rev()).toBe(3)
  })

  it('fitAll без размера сцены ничего не делает; с размером вписывает bounds', async () => {
    const { useGraph } = await loadStore()
    useGraph.getState().setBounds({ minX: -2000, minY: -1000, maxX: 2000, maxY: 1000 })
    useGraph.getState().setCamera({ x: 5, y: 5, zoom: 2 })
    useGraph.getState().fitAll()
    expect(useGraph.getState().camera).toEqual({ x: 5, y: 5, zoom: 2 })

    useGraph.getState().setViewSize(1000, 600)
    useGraph.getState().fitAll()
    // 4000 × 0.125 + 96 = 596 ≤ 1000; 2000 × 0.125 + 96 = 346 ≤ 600; при 0.25 по ширине уже 1096.
    expect(useGraph.getState().camera).toEqual({ x: 0, y: 0, zoom: 0.125 })

    useGraph.getState().setBounds({ minX: 0, minY: 0, maxX: 64, maxY: 64 })
    useGraph.getState().fitAll()
    expect(useGraph.getState().camera).toEqual({ x: 32, y: 32, zoom: 1 })

    // Пустой граф — камера по умолчанию.
    useGraph.getState().setBounds(null)
    useGraph.getState().fitAll()
    expect(useGraph.getState().camera).toEqual({ x: 0, y: 0, zoom: 1 })
  })

  it('setBounds: равные границы не будят подписчиков', async () => {
    const { useGraph } = await loadStore()
    useGraph.getState().setBounds({ minX: 0, minY: 0, maxX: 1, maxY: 1 })
    const listener = vi.fn()
    const unsubscribe = useGraph.subscribe(listener)
    useGraph.getState().setBounds({ minX: 0, minY: 0, maxX: 1, maxY: 1 })
    expect(listener).not.toHaveBeenCalled()
    useGraph.getState().setBounds(null)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('centerOn: центр в точке; minZoom поднимает масштаб, но не опускает', async () => {
    const { useGraph } = await loadStore()
    useGraph.getState().setCamera({ zoom: 0.25 })
    useGraph.getState().centerOn({ x: 64, y: -32 })
    expect(useGraph.getState().camera).toEqual({ x: 64, y: -32, zoom: 0.25 })
    useGraph.getState().centerOn({ x: 10, y: 20 }, 1)
    expect(useGraph.getState().camera).toEqual({ x: 10, y: 20, zoom: 1 })
    useGraph.getState().setCamera({ zoom: 2 })
    useGraph.getState().centerOn({ x: 0, y: 0 }, 1)
    expect(useGraph.getState().camera).toEqual({ x: 0, y: 0, zoom: 2 })
  })
})

describe('useGraph: всплывающие и сиюминутное', () => {
  it('открытие одного всплывающего закрывает остальные', async () => {
    const { useGraph } = await loadStore()
    const link = { a: 'a', b: 'b', x: 1, y: 2 }
    const g = () => useGraph.getState()

    g().openMenu({ id: 'n', x: 10, y: 20 })
    expect(g().menu).toEqual({ id: 'n', x: 10, y: 20 })

    g().openPicker('n')
    expect(g().pickerFor).toBe('n')
    expect(g().menu).toBeNull()

    g().selectLink(link)
    expect(g().selectedLink).toEqual(link)
    expect(g().pickerFor).toBeNull()
    expect(g().menu).toBeNull()

    g().openMenu({ id: 'm', x: 0, y: 0 })
    expect(g().selectedLink).toBeNull()
    expect(g().menu).toEqual({ id: 'm', x: 0, y: 0 })

    g().selectLink(link)
    expect(g().menu).toBeNull()
    g().openPicker('k')
    expect(g().selectedLink).toBeNull()

    // Закрытие одного не трогает остальные.
    g().openMenu(null)
    expect(g().pickerFor).toBe('k')
    g().openPicker(null)
    expect(g().pickerFor).toBeNull()
  })

  it('то же значение всплывающего не будит подписчиков', async () => {
    const { useGraph } = await loadStore()
    const g = () => useGraph.getState()
    g().openMenu({ id: 'n', x: 1, y: 2 })
    const listener = vi.fn()
    const unsubscribe = useGraph.subscribe(listener)
    g().openMenu({ id: 'n', x: 1, y: 2 })
    g().openPicker(null)
    g().selectLink(null)
    expect(listener).not.toHaveBeenCalled()
    g().openMenu(null)
    expect(listener).toHaveBeenCalledTimes(1)
    g().openPicker('n')
    g().openPicker('n')
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('resetTransient сбрасывает сиюминутное и не трогает камеру, архив и подсказку', async () => {
    const { useGraph } = await loadStore()
    const g = () => useGraph.getState()
    g().setCamera({ x: 5, y: 6, zoom: 0.5 })
    g().setHovered('h')
    g().setCursor('c')
    g().setDrag('pan')
    g().setLinkFrom('l')
    g().openMenu({ id: 'n', x: 1, y: 1 })
    g().setShowArchive(false)
    g().dismissHint()
    g().resetTransient()
    expect(g()).toMatchObject({
      hoveredId: null,
      cursorId: null,
      drag: null,
      linkFrom: null,
      selectedLink: null,
      menu: null,
      pickerFor: null,
      showArchive: false,
      hintSeen: true,
      camera: { x: 5, y: 6, zoom: 0.5 },
    })

    // Уже чисто — подписчиков не будит.
    const listener = vi.fn()
    const unsubscribe = useGraph.subscribe(listener)
    g().resetTransient()
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()

    g().openPicker('p')
    g().selectLink({ a: '1', b: '2', x: 0, y: 0 })
    g().resetTransient()
    expect(g().pickerFor).toBeNull()
    expect(g().selectedLink).toBeNull()
  })
})

describe('useGraph: архив и подсказка в localStorage', () => {
  it('по умолчанию архив показан, подсказка не закрыта; читается при создании', async () => {
    vi.stubGlobal('localStorage', fakeStorage())
    const fresh = (await loadStore()).useGraph.getState()
    expect(fresh.showArchive).toBe(true)
    expect(fresh.hintSeen).toBe(false)

    vi.stubGlobal('localStorage', fakeStorage({ [ARCHIVE_KEY]: '0', [HINT_KEY]: '1' }))
    const saved = (await loadStore()).useGraph.getState()
    expect(saved.showArchive).toBe(false)
    expect(saved.hintSeen).toBe(true)

    vi.stubGlobal('localStorage', fakeStorage({ [ARCHIVE_KEY]: 'мусор', [HINT_KEY]: 'мусор' }))
    const junk = (await loadStore()).useGraph.getState()
    expect(junk.showArchive).toBe(true)
    expect(junk.hintSeen).toBe(false)
  })

  it('setShowArchive и dismissHint пишутся сразу; повтор не пишет', async () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    const { useGraph, GRAPH_ARCHIVE_KEY, GRAPH_HINT_KEY } = await loadStore()
    expect([GRAPH_ARCHIVE_KEY, GRAPH_HINT_KEY]).toEqual([ARCHIVE_KEY, HINT_KEY])

    useGraph.getState().setShowArchive(false)
    expect(useGraph.getState().showArchive).toBe(false)
    expect(storage.data.get(ARCHIVE_KEY)).toBe('0')
    useGraph.getState().setShowArchive(false)
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    useGraph.getState().setShowArchive(true)
    expect(storage.data.get(ARCHIVE_KEY)).toBe('1')

    useGraph.getState().dismissHint()
    expect(useGraph.getState().hintSeen).toBe(true)
    expect(storage.data.get(HINT_KEY)).toBe('1')
    const calls = storage.setItem.mock.calls.length
    useGraph.getState().dismissHint()
    expect(storage.setItem).toHaveBeenCalledTimes(calls)

    // Переживает пересоздание стора.
    const again = (await loadStore()).useGraph.getState()
    expect(again.showArchive).toBe(true)
    expect(again.hintSeen).toBe(true)
  })

  it('без хранилища и с хранилищем, которое бросает, значения живут в памяти', async () => {
    const { useGraph } = await loadStore()
    useGraph.getState().setShowArchive(false)
    useGraph.getState().dismissHint()
    expect(useGraph.getState()).toMatchObject({ showArchive: false, hintSeen: true })

    const storage = fakeStorage()
    storage.getItem.mockImplementation(() => {
      throw new Error('SecurityError')
    })
    storage.setItem.mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    vi.stubGlobal('localStorage', storage)
    const second = (await loadStore()).useGraph
    expect(second.getState()).toMatchObject({ showArchive: true, hintSeen: false })
    expect(() => second.getState().setShowArchive(false)).not.toThrow()
    expect(() => second.getState().dismissHint()).not.toThrow()
    expect(second.getState()).toMatchObject({ showArchive: false, hintSeen: true })
  })
})
