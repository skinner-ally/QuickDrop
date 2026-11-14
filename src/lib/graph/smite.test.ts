import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { drawNodes } from './draw'
import { buildSpatialIndex } from './geometry'
import {
  SMITE_DODGE_CHANCE,
  SMITE_MAX,
  isSmiteHidden,
  smiteAbortAll,
  smiteFinished,
  smiteFromScene,
  smiteNodes,
  smiteStruck,
  useSmite,
} from './smite'
import type { GraphTheme } from './types'

const mocks = vi.hoisted(() => ({
  actDelete: vi.fn(async () => {}),
  readGraphTheme: vi.fn(),
}))

// Удаление — обычное actDelete (toast и «Отменить» проверяются в actions.test); здесь — только когда и что удаляется.
vi.mock('@/lib/actions', () => ({ actDelete: mocks.actDelete }))
vi.mock('@/lib/graph/theme', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/graph/theme')>()),
  readGraphTheme: mocks.readGraphTheme,
}))

const target = (id: string, at: { x: number; y: number } | null = { x: 0, y: 0 }) => ({ id, at, color: '#112233', edge: '#000000' })
const runs = () => useSmite.getState().runs
const hidden = () => [...useSmite.getState().hidden].sort()

beforeEach(() => {
  useSmite.setState({ runs: [], hidden: new Set() })
  mocks.actDelete.mockClear()
  mocks.readGraphTheme.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('smiteNodes', () => {
  it('нода с положением — сцена: запись ещё не удалена, нода скрыта с холста', () => {
    smiteNodes([target('a', { x: 48, y: -96 })])
    expect(mocks.actDelete).not.toHaveBeenCalled()
    expect(runs()).toHaveLength(1)
    expect(runs()[0]).toMatchObject({ id: 'a', at: { x: 48, y: -96 }, color: '#112233', edge: '#000000', struck: false })
    expect(hidden()).toEqual(['a'])
    expect(isSmiteHidden('a')).toBe(true)
    expect(isSmiteHidden('b')).toBe(false)
  })

  it('без положения ноды — удаление сразу, без сцены', () => {
    smiteNodes([target('a', null), target('b')])
    expect(mocks.actDelete).toHaveBeenCalledExactlyOnceWith(['a'])
    expect(runs().map((r) => r.id)).toEqual(['b'])
    expect(hidden()).toEqual(['b'])
  })

  it(`больше ${SMITE_MAX} сцен одновременно не бывает: остальные удаляются сразу одной пачкой`, () => {
    smiteNodes([target('a'), target('b')])
    smiteNodes([target('c'), target('d'), target('e')])
    expect(runs().map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(mocks.actDelete).toHaveBeenCalledExactlyOnceWith(['d', 'e'])
  })

  it('запись, у которой сцена уже идёт, не дублируется; пустой список — ничего', () => {
    smiteNodes([target('a')])
    const first = runs()
    smiteNodes([target('a')])
    smiteNodes([])
    expect(runs()).toBe(first)
    expect(mocks.actDelete).not.toHaveBeenCalled()
  })

  it('ключи сцен разные; уклонение — с вероятностью SMITE_DODGE_CHANCE', () => {
    const random = vi.spyOn(Math, 'random')
    random.mockReturnValueOnce(SMITE_DODGE_CHANCE - 0.01).mockReturnValueOnce(SMITE_DODGE_CHANCE + 0.01)
    smiteNodes([target('a'), target('b')])
    const [a, b] = runs()
    expect(a.dodge).toBe(true)
    expect(b.dodge).toBe(false)
    expect(a.key).not.toBe(b.key)
    random.mockRestore()
  })

  it('prefers-reduced-motion — всё удаляется сразу', () => {
    vi.stubGlobal('window', { matchMedia: (q: string) => ({ matches: q.includes('reduce') }) })
    smiteNodes([target('a'), target('b')])
    expect(runs()).toEqual([])
    expect(hidden()).toEqual([])
    expect(mocks.actDelete).toHaveBeenCalledExactlyOnceWith(['a', 'b'])
  })
})

describe('smiteStruck и smiteFinished', () => {
  it('удар отправляет запись в корзину один раз; нода скрыта, пока сцена не кончится', () => {
    smiteNodes([target('a'), target('b')])
    const [a, b] = runs()
    smiteStruck(a.key)
    smiteStruck(a.key)
    smiteStruck(-1)
    expect(mocks.actDelete).toHaveBeenCalledExactlyOnceWith('a')
    expect(runs().find((r) => r.key === a.key)?.struck).toBe(true)
    expect(hidden()).toEqual(['a', 'b'])

    smiteFinished(a.key)
    expect(mocks.actDelete).toHaveBeenCalledTimes(1)
    expect(runs().map((r) => r.id)).toEqual(['b'])
    expect(hidden()).toEqual(['b'])
    expect(b.struck).toBe(false)
  })

  it('сцена кончилась без удара (прервали) — запись удаляется сразу; неизвестный ключ — ничего', () => {
    smiteNodes([target('a')])
    const [a] = runs()
    smiteFinished(-1)
    expect(mocks.actDelete).not.toHaveBeenCalled()
    smiteFinished(a.key)
    expect(mocks.actDelete).toHaveBeenCalledExactlyOnceWith('a')
    expect(runs()).toEqual([])
    expect(hidden()).toEqual([])
    // после конца сцены запись можно казнить снова (например, после «Отменить»)
    smiteNodes([target('a')])
    expect(runs().map((r) => r.id)).toEqual(['a'])
  })
})

describe('smiteFromScene', () => {
  const scene = () => {
    const nodes = [
      { id: 'a', x: 96, y: -48, color: 'blue' as const, zone: 'z', inbox: false, archived: false, favorite: false, dim: false, title: 'a', links: [] },
    ]
    return { nodes, byId: new Map([['a', 0]]), links: [], bounds: null, index: buildSpatialIndex(nodes), matched: 1 }
  }

  it('центр ноды — из сцены, цвета — из темы графа в hex; ноды нет в сцене — удаление сразу', () => {
    vi.stubGlobal('document', { querySelector: () => ({}) })
    mocks.readGraphTheme.mockReturnValue({
      cat: { none: 'rgb(1, 2, 3)', blue: 'rgb(10, 200, 255)' },
      nodeEdge: 'rgba(74, 36, 22, 1)',
    } as unknown as GraphTheme)
    smiteFromScene(['a', 'gone'], scene())
    expect(runs()).toHaveLength(1)
    expect(runs()[0]).toMatchObject({ id: 'a', at: { x: 96, y: -48 }, color: '#0ac8ff', edge: '#4a2416' })
    expect(mocks.actDelete).toHaveBeenCalledExactlyOnceWith(['gone'])
  })

  it('без сцены графа на странице — запасные цвета', () => {
    vi.stubGlobal('document', { querySelector: () => null })
    smiteFromScene(['a'], scene())
    expect(mocks.readGraphTheme).not.toHaveBeenCalled()
    expect(runs()[0]).toMatchObject({ color: '#a7a294', edge: '#4a2416' })
  })

  it('hex из темы передаётся как есть; «Классика» без рамки — запасной цвет рамки', () => {
    vi.stubGlobal('document', { querySelector: () => ({}) })
    mocks.readGraphTheme.mockReturnValue({ cat: { none: '#abcdef', blue: '#123456' }, nodeEdge: null } as unknown as GraphTheme)
    smiteFromScene(['a'], scene())
    expect(runs()[0]).toMatchObject({ color: '#123456', edge: '#4a2416' })
  })
})

describe('холст графа и сцена казни', () => {
  it('drawNodes не рисует ноды, скрытые сценой', () => {
    const nodes = ['a', 'b', 'c'].map((id, i) => ({
      id, x: i * 48, y: 0, color: 'none' as const, zone: 'none', inbox: false, archived: false, favorite: false, dim: false, title: id, links: [],
    }))
    const scene = { nodes, byId: new Map(nodes.map((n, i) => [n.id, i])), links: [], bounds: null, index: buildSpatialIndex(nodes), matched: 3 }
    const ctx = { fillStyle: '', globalAlpha: 1, fillRect: vi.fn() } as unknown as CanvasRenderingContext2D
    const theme = {
      pixel: false, cat: { none: 'x' }, nodeEdge: null, shadow: null, inbox: 'i', inboxEdge: 'ie', fav: 'f', favEdge: 'fe',
      sel: 's', selEdge: null, hover: 'h', link: 0, linkAlt: 0, linkEdge: 0, linkThin: 0, linkHot: 0, linkCss: '', linkHotCss: '',
    } as unknown as GraphTheme
    const view = { width: 800, height: 600, dpr: 1, camera: { x: 0, y: 0, zoom: 1 } }
    const none = { selectedId: null, hoveredId: null, cursorId: null, hotLink: null, drag: null, tempLink: null }
    expect(drawNodes(ctx, scene, view, theme, none)).toBe(3)
    smiteNodes([target('b')])
    expect(drawNodes(ctx, scene, view, theme, none)).toBe(2)
  })
})

describe('smiteAbortAll (граф ушёл с экрана)', () => {
  it('запись без удара удаляется сразу, по ударенной повторного удаления нет; сцен и скрытых нод не остаётся', () => {
    smiteNodes([target('a'), target('b')])
    smiteStruck(runs()[0].key)
    mocks.actDelete.mockClear()
    smiteAbortAll()
    expect(mocks.actDelete).toHaveBeenCalledExactlyOnceWith(['b'])
    expect(runs()).toEqual([])
    expect(hidden()).toEqual([])
  })

  it('без сцен — ничего не делает', () => {
    smiteAbortAll()
    expect(mocks.actDelete).not.toHaveBeenCalled()
  })
})
