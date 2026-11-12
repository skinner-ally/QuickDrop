import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GRAPH_NONE_ZONE } from '@/lib/graphLayout'

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
    expect(state.hoveredId).toBeNull()
    expect(state.focusZone).toBeNull()
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

  it('setCamera держит масштаб в пределах 0.1…4 и пропускает негодные значения', async () => {
    const { useGraph, GRAPH_ZOOM_MIN, GRAPH_ZOOM_MAX } = await loadStore()
    expect([GRAPH_ZOOM_MIN, GRAPH_ZOOM_MAX]).toEqual([0.1, 4])
    const { setCamera } = useGraph.getState()
    setCamera({ zoom: 100 })
    expect(useGraph.getState().camera.zoom).toBe(4)
    setCamera({ zoom: 0 })
    expect(useGraph.getState().camera.zoom).toBe(0.1)
    setCamera({ zoom: -3 })
    expect(useGraph.getState().camera.zoom).toBe(0.1)

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
    useGraph.getState().setFocusZone('cat-1')
    useGraph.getState().resetCamera()
    expect(useGraph.getState().camera).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(useGraph.getState().hoveredId).toBe('item-1')
    expect(useGraph.getState().focusZone).toBe('cat-1')
  })

  it('setHovered и setFocusZone; то же значение не будит подписчиков', async () => {
    const { useGraph } = await loadStore()
    const listener = vi.fn()
    const unsubscribe = useGraph.subscribe(listener)

    useGraph.getState().setHovered('a')
    expect(useGraph.getState().hoveredId).toBe('a')
    useGraph.getState().setHovered('a')
    expect(listener).toHaveBeenCalledTimes(1)
    useGraph.getState().setHovered(null)
    expect(useGraph.getState().hoveredId).toBeNull()

    useGraph.getState().setFocusZone(GRAPH_NONE_ZONE)
    expect(useGraph.getState().focusZone).toBe('none')
    useGraph.getState().setFocusZone('none')
    expect(listener).toHaveBeenCalledTimes(3)
    useGraph.getState().setFocusZone(null)
    expect(useGraph.getState().focusZone).toBeNull()
    expect(listener).toHaveBeenCalledTimes(4)
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

  it('масштаб вне пределов подтягивается к 0.1…4', async () => {
    vi.stubGlobal('localStorage', fakeStorage({ [KEY]: JSON.stringify({ x: 1, y: 2, zoom: 50 }) }))
    expect((await loadStore()).useGraph.getState().camera).toEqual({ x: 1, y: 2, zoom: 4 })

    vi.stubGlobal('localStorage', fakeStorage({ [KEY]: JSON.stringify({ x: 1, y: 2, zoom: 0 }) }))
    expect((await loadStore()).useGraph.getState().camera).toEqual({ x: 1, y: 2, zoom: 0.1 })
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

  it('resetCamera тоже сохраняется; наведение и зона — нет', async () => {
    const storage = fakeStorage({ [KEY]: JSON.stringify({ x: 512, y: -96, zoom: 0.5 }) })
    vi.stubGlobal('localStorage', storage)
    const { useGraph } = await loadStore()

    useGraph.getState().setHovered('a')
    useGraph.getState().setFocusZone('cat-1')
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
    first.useGraph.getState().setFocusZone('cat-1')
    vi.advanceTimersByTime(300)

    const second = await loadStore()
    expect(second.useGraph).not.toBe(first.useGraph)
    expect(second.useGraph.getState().camera).toEqual({ x: -640, y: 320, zoom: 0.25 })
    expect(second.useGraph.getState().focusZone).toBeNull()
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
