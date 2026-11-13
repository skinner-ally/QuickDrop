import { describe, expect, it } from 'vitest'
import { GRAPH_CELL } from '@/lib/graphLayout'
import { buildSpatialIndex, deviceTransform, GRAPH_ZOOM_STEPS } from './geometry'
import { drawLinksClassic, drawLinksPixel, drawNodes, LINK_ZOOM_ALPHA_MIN, linkUnit, linkZoomAlpha } from './draw'
import type { LinkBuffer } from './draw'
import { packRgba } from './theme'
import { GRAPH_ALPHA_ARCHIVED, GRAPH_ALPHA_DIM, GRAPH_COLOR_KEYS } from './types'
import type { DrawState, GraphColorKey, GraphLink, GraphNode, GraphScene, GraphTheme, GraphViewport } from './types'

// ───────────────────────── подставные данные ─────────────────────────

const LINK = packRgba(10, 20, 30, 255)
const LINK_ALT = packRgba(40, 50, 60, 255)
const LINK_EDGE = packRgba(1, 2, 3, 255)
const LINK_HOT = packRgba(200, 150, 0, 255)

const cat = Object.fromEntries(GRAPH_COLOR_KEYS.map((key) => [key, `cat-${key}`])) as Record<GraphColorKey, string>

const PIXEL: GraphTheme = {
  pixel: true, cat, nodeEdge: 'edge', shadow: 'shadow', inbox: 'inbox', inboxEdge: 'inbox-edge', fav: 'fav', favEdge: 'fav-edge',
  sel: 'sel', selEdge: 'sel-edge', hover: 'hover',
  link: LINK, linkAlt: LINK_ALT, linkEdge: LINK_EDGE, linkHot: LINK_HOT, linkCss: 'link-css', linkHotCss: 'hot-css',
}
const CLASSIC: GraphTheme = {
  ...PIXEL, pixel: false, nodeEdge: null, shadow: null, selEdge: null, linkEdge: packRgba(0, 0, 0, 0),
}

const NONE: DrawState = { selectedId: null, hoveredId: null, cursorId: null, hotLink: null, drag: null, tempLink: null }
const st = (patch: Partial<DrawState>): DrawState => ({ ...NONE, ...patch })

type NodeSpec = Partial<GraphNode> & { x: number; y: number }

/** Сцена напрямую (без записей): id `n<индекс>`, если не задан. links — [a, b, поля связи]. */
function makeScene(specs: NodeSpec[], pairs: Array<[number, number, Partial<GraphLink>?]> = []): GraphScene {
  const nodes: GraphNode[] = specs.map((p, i) => ({
    id: `n${i}`, color: 'none', zone: 'none', inbox: false, archived: false, favorite: false, dim: false, title: '', links: [], ...p,
  }))
  const byId = new Map(nodes.map((n, i) => [n.id, i]))
  const links: GraphLink[] = pairs.map(([a, b, extra]) => {
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    nodes[lo].links.push(hi)
    nodes[hi].links.push(lo)
    return { a: lo, b: hi, cross: false, dim: nodes[lo].dim || nodes[hi].dim, ...extra }
  })
  for (const n of nodes) n.links.sort((x, y) => x - y)
  return { nodes, byId, links, bounds: null, index: buildSpatialIndex(nodes), matched: nodes.filter((n) => !n.dim).length }
}

const vp = (width: number, height: number, zoom = 1, dpr = 1, x = 0, y = 0): GraphViewport => ({
  width, height, dpr, camera: { x, y, zoom },
})

interface Call {
  op: string
  args: number[]
  fill: string
  stroke: string
  alpha: number
  width: number
}

/** Контекст, записывающий вызовы вместе с текущими fillStyle / strokeStyle / globalAlpha / lineWidth. */
function mockCtx() {
  const calls: Call[] = []
  const raw = {
    fillStyle: '#000' as string,
    strokeStyle: '#000' as string,
    globalAlpha: 1,
    lineWidth: 1,
    fillRect(...args: number[]) { rec('fillRect', args) },
    beginPath() { rec('beginPath', []) },
    moveTo(...args: number[]) { rec('moveTo', args) },
    lineTo(...args: number[]) { rec('lineTo', args) },
    stroke() { rec('stroke', []) },
  }
  function rec(op: string, args: number[]) {
    calls.push({ op, args, fill: raw.fillStyle, stroke: raw.strokeStyle, alpha: raw.globalAlpha, width: raw.lineWidth })
  }
  return { ctx: raw as unknown as CanvasRenderingContext2D, raw, calls, rects: () => calls.filter((c) => c.op === 'fillRect') }
}

function hasRect(calls: Call[], fill: string, x: number, y: number, w: number, h: number, alpha?: number): boolean {
  return calls.some(
    (c) => c.op === 'fillRect' && c.fill === fill && c.args[0] === x && c.args[1] === y && c.args[2] === w &&
      c.args[3] === h && (alpha === undefined || c.alpha === alpha),
  )
}

/** Рамка из четырёх fillRect (как frame в draw.ts). */
function hasFrame(calls: Call[], fill: string, x: number, y: number, size: number, w: number): boolean {
  return (
    hasRect(calls, fill, x, y, size, w) &&
    hasRect(calls, fill, x, y + size - w, size, w) &&
    hasRect(calls, fill, x, y + w, w, size - 2 * w) &&
    hasRect(calls, fill, x + size - w, y + w, w, size - 2 * w)
  )
}

function buffer(width: number, height: number, guard = 0): LinkBuffer {
  return { width, height, data: new Uint32Array(width * height + guard) }
}

// ───────────────────────── linkUnit ─────────────────────────

describe('linkUnit', () => {
  it('max(1, round(2 · zoom · dpr))', () => {
    expect(linkUnit(1, 1)).toBe(2)
    expect(linkUnit(2, 2)).toBe(8)
    expect(linkUnit(0.75, 1.25)).toBe(2)
    expect(linkUnit(0.25, 1)).toBe(1)
    expect(linkUnit(0.125, 1)).toBe(1)
    expect(linkUnit(Number.NaN, 1)).toBe(1)
  })
})

// ───────────────────────── ноды ─────────────────────────

describe('drawNodes', () => {
  it('все аргументы fillRect целые при dpr 1, 1.25, 1.5, 1.75, 2 и всех ступенях', () => {
    const scene = makeScene(
      [
        { x: 0, y: 0, inbox: true, color: 'blue' },
        { x: 32, y: 0, archived: true },
        { x: 64, y: 32, dim: true, inbox: true },
        { x: 13.3, y: -40.7, color: 'red' }, // сохранённая точка не по сетке
        { x: -96, y: 64 },
      ],
      [[0, 1], [0, 2], [3, 4]],
    )
    const state = st({
      selectedId: 'n0', hoveredId: 'n3', cursorId: 'n4',
      drag: { id: 'n1', x: 40.37, y: 7.91, drop: { x: 32, y: 0 } },
      tempLink: { fromId: 'n0', x: -5.5, y: 3.3, targetId: 'n4' },
    })
    for (const theme of [PIXEL, CLASSIC]) {
      for (const dpr of [1, 1.25, 1.5, 1.75, 2]) {
        for (const zoom of GRAPH_ZOOM_STEPS) {
          const { ctx, rects } = mockCtx()
          drawNodes(ctx, scene, vp(801, 603, zoom, dpr, 13.7, -7.3), theme, state)
          const list = rects()
          expect(list.length).toBeGreaterThan(0)
          for (const c of list) {
            for (const a of c.args) expect(Number.isInteger(a), `${a} при zoom ${zoom}, dpr ${dpr}`).toBe(true)
          }
        }
      }
    }
  })

  it('ноды вне экрана не рисуются, на границе видимой области — рисуются', () => {
    // 800×600, камера в 0: видимая область с запасом 32 px — мир [−432, 432] × [−332, 332].
    const scene = makeScene([{ x: 0, y: 0 }, { x: 432, y: 0 }, { x: 2000, y: 0 }, { x: 0, y: -333 }])
    const { ctx, rects } = mockCtx()
    expect(drawNodes(ctx, scene, vp(800, 600), CLASSIC, NONE)).toBe(2)
    const xs = rects().map((c) => c.args[0])
    expect(xs).toEqual([392, 824])
  })

  it('пиксельная тема: тень, рамка, заливка; метка «Входящие» с кромкой', () => {
    const scene = makeScene([{ x: 0, y: 0, color: 'blue', inbox: true }])
    const { ctx, calls, rects } = mockCtx()
    expect(drawNodes(ctx, scene, vp(800, 600), PIXEL, NONE)).toBe(1)
    // ox = 400, oy = 300; s = 16, угол (392, 292); рамка b = 2.
    expect(hasRect(calls, 'shadow', 394, 294, 16, 16)).toBe(true)
    expect(hasRect(calls, 'edge', 392, 292, 16, 16)).toBe(true)
    expect(hasRect(calls, 'cat-blue', 394, 294, 12, 12)).toBe(true)
    // метка m = 6 с вылетом b = 2 наружу, сердцевина с отступом 2
    expect(hasRect(calls, 'inbox-edge', 404, 290, 6, 6)).toBe(true)
    expect(hasRect(calls, 'inbox', 406, 292, 2, 2)).toBe(true)
    expect(rects()).toHaveLength(5)
    // порядок проходов: тень → рамка → заливка → метка
    expect(rects().map((c) => c.fill)).toEqual(['shadow', 'edge', 'cat-blue', 'inbox-edge', 'inbox'])
  })

  it('избранное: звезда 5×5 с контуром в левом нижнем углу; без избранного золота нет', () => {
    const { ctx, calls, rects } = mockCtx()
    drawNodes(ctx, makeScene([{ x: 0, y: 0, color: 'blue', favorite: true }]), vp(800, 600), PIXEL, NONE)
    // угол ноды (392, 292), s = 16, b = 2: звезда с вылетом наружу — левый верх (391, 304)
    expect(hasRect(calls, 'fav', 393, 304, 1, 1)).toBe(true)
    expect(hasRect(calls, 'fav', 391, 306, 5, 1)).toBe(true)
    expect(hasRect(calls, 'fav-edge', 390, 306, 5, 1)).toBe(true)
    const fills = rects().map((c) => c.fill)
    expect(fills.indexOf('fav-edge')).toBeLessThan(fills.indexOf('fav'))
    expect(fills.indexOf('cat-blue')).toBeLessThan(fills.indexOf('fav-edge'))

    const plain = mockCtx()
    drawNodes(plain.ctx, makeScene([{ x: 0, y: 0, color: 'blue' }]), vp(800, 600), PIXEL, NONE)
    expect(plain.rects().some((c) => c.fill === 'fav' || c.fill === 'fav-edge')).toBe(false)
  })

  it('избранное на малом масштабе: от 0.25 — золотой квадрат внутри ноды, ниже — ничего', () => {
    const mid = mockCtx()
    drawNodes(mid.ctx, makeScene([{ x: 0, y: 0, favorite: true }]), vp(800, 600, 0.5), PIXEL, NONE)
    // s = 8, b = 1, угол (396, 296); квадрат 3×3 прижат к левому нижнему углу
    expect(hasRect(mid.calls, 'fav', 397, 300, 3, 3)).toBe(true)
    expect(mid.rects().some((c) => c.fill === 'fav-edge')).toBe(false)

    const tiny = mockCtx()
    drawNodes(tiny.ctx, makeScene([{ x: 0, y: 0, favorite: true }]), vp(800, 600, 0.125), PIXEL, NONE)
    expect(tiny.rects().some((c) => c.fill === 'fav')).toBe(false)
  })

  it('«Классика»: одна заливка на ноду, без рамки и тени', () => {
    const scene = makeScene([{ x: 0, y: 0, color: 'green' }, { x: 32, y: 0 }, { x: 64, y: 0, color: 'green' }])
    const { ctx, rects } = mockCtx()
    drawNodes(ctx, scene, vp(800, 600), CLASSIC, NONE)
    expect(rects()).toHaveLength(3)
    expect(rects().map((c) => c.args)).toEqual([[392, 292, 16, 16], [424, 292, 16, 16], [456, 292, 16, 16]])
  })

  it('«Классика»: метка «Входящие» без вылета (рамки нет)', () => {
    const scene = makeScene([{ x: 0, y: 0, inbox: true }])
    const { ctx, calls } = mockCtx()
    drawNodes(ctx, scene, vp(800, 600), CLASSIC, NONE)
    expect(hasRect(calls, 'inbox-edge', 402, 292, 6, 6)).toBe(true)
    expect(hasRect(calls, 'inbox', 403, 293, 4, 4)).toBe(true)
  })

  it('масштаб 0.25: тёмный контур 1 px снаружи, без тени и метки', () => {
    const scene = makeScene([{ x: 0, y: 0, inbox: true, color: 'red' }])
    const { ctx, rects } = mockCtx()
    drawNodes(ctx, scene, vp(800, 600, 0.25), PIXEL, NONE)
    expect(rects()).toHaveLength(2)
    expect(rects()[0]).toMatchObject({ fill: 'edge', args: [397, 297, 6, 6] })
    expect(rects()[1]).toMatchObject({ fill: 'cat-red', args: [398, 298, 4, 4] })
  })

  it('масштаб 0.25 в «Классике» — одна заливка, без контура', () => {
    const scene = makeScene([{ x: 0, y: 0, inbox: true, color: 'red' }])
    const { ctx, rects } = mockCtx()
    drawNodes(ctx, scene, vp(800, 600, 0.25), CLASSIC, NONE)
    expect(rects()).toHaveLength(1)
    expect(rects()[0]).toMatchObject({ fill: 'cat-red', args: [398, 298, 4, 4] })
  })

  it('12,5 % при dpr 1 — без контура (между нодами 2 px земли); при dpr 1.5 — с контуром', () => {
    const scene = makeScene([{ x: 0, y: 0, color: 'red' }])
    const a = mockCtx()
    drawNodes(a.ctx, scene, vp(800, 600, 0.125), PIXEL, NONE)
    expect(a.rects().map((c) => c.fill)).toEqual(['cat-red'])
    const b = mockCtx()
    drawNodes(b.ctx, scene, vp(800, 600, 0.125, 1.5), PIXEL, NONE)
    // k = 0.1875: нода 3 px, шаг сетки 6 px
    expect(b.rects().map((c) => c.fill)).toEqual(['edge', 'cat-red'])
    expect(b.rects()[0].args[2]).toBe(5)
  })

  it('масштаб 0.5: рамка 1 px, метка «Входящие» видна', () => {
    const scene = makeScene([{ x: 0, y: 0, inbox: true }])
    const { ctx, calls } = mockCtx()
    drawNodes(ctx, scene, vp(800, 600, 0.5), PIXEL, NONE)
    // s = 8, угол (396, 296), b = 1, m = 3
    expect(hasRect(calls, 'edge', 396, 296, 8, 8)).toBe(true)
    expect(hasRect(calls, 'cat-none', 397, 297, 6, 6)).toBe(true)
    expect(hasRect(calls, 'inbox-edge', 402, 295, 3, 3)).toBe(true)
    expect(hasRect(calls, 'inbox', 403, 296, 1, 1)).toBe(true)
  })

  it('альфа приглушённых и архивных; после вызова globalAlpha = 1', () => {
    const scene = makeScene([
      { x: 0, y: 0, dim: true, archived: true, color: 'blue' },
      { x: 32, y: 0, dim: true, color: 'green' },
      { x: 64, y: 0, color: 'red' },
      { x: 96, y: 0, archived: true, color: 'violet' },
    ])
    const { ctx, raw, rects } = mockCtx()
    drawNodes(ctx, scene, vp(800, 600), PIXEL, NONE)
    const alphaOf = (fill: string) => rects().find((c) => c.fill === fill)?.alpha
    expect(alphaOf('cat-blue')).toBe(GRAPH_ALPHA_DIM)
    expect(alphaOf('cat-green')).toBe(GRAPH_ALPHA_DIM)
    expect(alphaOf('cat-red')).toBe(1)
    expect(alphaOf('cat-violet')).toBe(GRAPH_ALPHA_ARCHIVED)
    // тень и рамка — с той же альфой; у полупрозрачной тень — две полосы (видимая часть)
    expect(rects().filter((c) => c.fill === 'shadow').map((c) => c.alpha)).toEqual([
      GRAPH_ALPHA_DIM, GRAPH_ALPHA_DIM, GRAPH_ALPHA_DIM, GRAPH_ALPHA_DIM, 1, GRAPH_ALPHA_ARCHIVED, GRAPH_ALPHA_ARCHIVED,
    ])
    expect(raw.globalAlpha).toBe(1)
  })

  /** Пиксели всех fillRect: «x,y» → цвет последней записи, число записей и альфы. */
  function raster(list: Call[]): Map<string, { fill: string; n: number; alphas: number[] }> {
    const out = new Map<string, { fill: string; n: number; alphas: number[] }>()
    for (const c of list) {
      const [x, y, w, h] = c.args
      for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
          const key = `${xx},${yy}`
          const prev = out.get(key)
          out.set(key, { fill: c.fill, n: (prev?.n ?? 0) + 1, alphas: [...(prev?.alphas ?? []), c.alpha] })
        }
      }
    }
    return out
  }

  it('полупрозрачная нода: каждый пиксель пишется один раз, силуэт и цвета — как у непрозрачной', () => {
    const variants: Array<Partial<GraphNode>> = [
      { archived: true, inbox: true, color: 'blue' },
      { dim: true, inbox: true, color: 'green' },
      { archived: true, color: 'red' },
      { dim: true },
    ]
    for (const theme of [PIXEL, CLASSIC]) {
      for (const dpr of [1, 1.25, 1.5, 2]) {
        for (const zoom of GRAPH_ZOOM_STEPS) {
          for (const extra of variants) {
            const opaque = mockCtx()
            drawNodes(opaque.ctx, makeScene([{ x: 0, y: 0, ...extra, archived: false, dim: false }]), vp(800, 600, zoom, dpr), theme, NONE)
            const faded = mockCtx()
            drawNodes(faded.ctx, makeScene([{ x: 0, y: 0, ...extra }]), vp(800, 600, zoom, dpr), theme, NONE)
            const a = raster(opaque.rects())
            const b = raster(faded.rects())
            const where = `${theme.pixel ? 'пикс' : 'класс'} zoom ${zoom} dpr ${dpr} ${JSON.stringify(extra)}`
            expect(b.size, where).toBe(a.size)
            const alpha = extra.dim ? GRAPH_ALPHA_DIM : GRAPH_ALPHA_ARCHIVED
            for (const [key, px] of b) {
              expect(px.n, `${where}: пиксель ${key}`).toBe(1)
              expect(px.alphas[0]).toBe(alpha)
              expect(px.fill, `${where}: пиксель ${key}`).toBe(a.get(key)?.fill)
            }
          }
        }
      }
    }
  })

  it('выбранная нода: золото с зазором и тёмная кромка; соседи; наведённая и курсор', () => {
    const scene = makeScene(
      [{ x: 0, y: 0 }, { x: 64, y: 0 }, { x: 0, y: 64 }, { x: 64, y: 64 }, { x: -64, y: 0 }],
      [[0, 1]],
    )
    const { ctx, calls, raw } = mockCtx()
    drawNodes(ctx, scene, vp(800, 600), PIXEL, st({ selectedId: 'n0', hoveredId: 'n2', cursorId: 'n3' }))
    // w = 2. Выбранная (угол 392, 292): золото с зазором w, кромка снаружи.
    expect(hasFrame(calls, 'sel', 388, 288, 24, 2)).toBe(true)
    expect(hasFrame(calls, 'sel-edge', 386, 286, 28, 2)).toBe(true)
    // сосед (угол 456, 292) — вплотную, тёмная кромка снаружи
    expect(hasFrame(calls, 'sel', 454, 290, 20, 2)).toBe(true)
    expect(hasFrame(calls, 'sel-edge', 452, 288, 24, 2)).toBe(true)
    // наведённая (392, 356) и под курсором (456, 356) — тоже с кромкой
    expect(hasFrame(calls, 'hover', 390, 354, 20, 2)).toBe(true)
    expect(hasFrame(calls, 'hover', 454, 354, 20, 2)).toBe(true)
    expect(hasFrame(calls, 'sel-edge', 388, 352, 24, 2)).toBe(true)
    expect(hasFrame(calls, 'sel-edge', 452, 352, 24, 2)).toBe(true)
    // не сосед (угол 328, 292) — без рамки и кромки
    expect(calls.filter((c) => c.fill === 'sel')).toHaveLength(8)
    expect(calls.filter((c) => c.fill === 'sel-edge')).toHaveLength(16)
    expect(calls.some((c) => (c.fill === 'sel' || c.fill === 'sel-edge') && c.args[0] < 380)).toBe(false)
    // рамки — после всех нод и с альфой 1
    const lastFill = calls.findLastIndex((c) => c.fill.startsWith('cat-'))
    const firstFrame = calls.findIndex((c) => c.fill === 'sel' || c.fill === 'hover')
    expect(firstFrame).toBeGreaterThan(lastFill)
    expect(calls.filter((c) => c.fill === 'sel' || c.fill === 'hover').every((c) => c.alpha === 1)).toBe(true)
    expect(raw.globalAlpha).toBe(1)
  })

  it('«Классика»: выбранная без тёмной кромки', () => {
    const scene = makeScene([{ x: 0, y: 0 }])
    const { ctx, calls } = mockCtx()
    drawNodes(ctx, scene, vp(800, 600), CLASSIC, st({ selectedId: 'n0' }))
    expect(hasFrame(calls, 'sel', 388, 288, 24, 2)).toBe(true)
    expect(calls.some((c) => c.fill === 'sel-edge')).toBe(false)
  })

  it('«Классика»: у соседа и наведённой кромки нет', () => {
    const scene = makeScene([{ x: 0, y: 0 }, { x: 64, y: 0 }, { x: 0, y: 64 }], [[0, 1]])
    const { ctx, calls } = mockCtx()
    drawNodes(ctx, scene, vp(800, 600), CLASSIC, st({ selectedId: 'n0', hoveredId: 'n2' }))
    expect(hasFrame(calls, 'sel', 454, 290, 20, 2)).toBe(true)
    expect(hasFrame(calls, 'hover', 390, 354, 20, 2)).toBe(true)
    expect(calls.some((c) => c.fill === 'sel-edge')).toBe(false)
  })

  it('0.25: рамка соседа ложится на контур ноды, кромка снаружи', () => {
    const scene = makeScene([{ x: 0, y: 0 }, { x: 64, y: 0 }], [[0, 1]])
    const { ctx, calls } = mockCtx()
    drawNodes(ctx, scene, vp(800, 600, 0.25), PIXEL, st({ selectedId: 'n0' }))
    // сосед: угол (414, 298), s = 4, w = 1; контур (413, 297, 6), золото поверх него, кромка (412, 296, 8)
    expect(hasRect(calls, 'edge', 413, 297, 6, 6)).toBe(true)
    expect(hasFrame(calls, 'sel', 413, 297, 6, 1)).toBe(true)
    expect(hasFrame(calls, 'sel-edge', 412, 296, 8, 1)).toBe(true)
  })

  it('выбранная приглушённая нода тоже получает рамку с альфой 1', () => {
    const scene = makeScene([{ x: 0, y: 0, dim: true }])
    const { ctx, calls } = mockCtx()
    drawNodes(ctx, scene, vp(800, 600), PIXEL, st({ selectedId: 'n0' }))
    expect(calls.filter((c) => c.fill === 'sel').every((c) => c.alpha === 1)).toBe(true)
  })

  it('перетаскивание: призрак на месте, нода в точке указателя с тенью 2b, рамка клетки броска', () => {
    const scene = makeScene([{ x: 0, y: 0, color: 'blue' }, { x: 64, y: 0 }])
    const { ctx, calls, raw } = mockCtx()
    const n = drawNodes(
      ctx, scene, vp(800, 600), PIXEL,
      st({ selectedId: 'n0', drag: { id: 'n0', x: 100.4, y: 50.6, drop: { x: 96, y: 64 } } }),
    )
    expect(n).toBe(2)
    // на своём месте — альфа 0.3
    expect(hasRect(calls, 'cat-blue', 394, 294, 12, 12, 0.3)).toBe(true)
    // в точке (100.4, 50.6): угол (400 + 100 − 8, 300 + 51 − 8) = (492, 343)
    expect(hasRect(calls, 'shadow', 496, 347, 16, 16, 1)).toBe(true)
    expect(hasRect(calls, 'edge', 492, 343, 16, 16, 1)).toBe(true)
    expect(hasRect(calls, 'cat-blue', 494, 345, 12, 12, 1)).toBe(true)
    // клетка броска (96, 64): угол (488, 356), рамка вплотную
    expect(hasFrame(calls, 'hover', 486, 354, 20, 2)).toBe(true)
    expect(hasFrame(calls, 'sel-edge', 484, 352, 24, 2)).toBe(true)
    // рамка выбранной едет вместе с нодой
    expect(hasFrame(calls, 'sel', 488, 339, 24, 2)).toBe(true)
    expect(raw.globalAlpha).toBe(1)
  })

  it('цель протяжки связи — рамка, как у выбранной', () => {
    const scene = makeScene([{ x: 0, y: 0 }, { x: 64, y: 0 }])
    const { ctx, calls } = mockCtx()
    drawNodes(ctx, scene, vp(800, 600), PIXEL, st({ tempLink: { fromId: 'n0', x: 60, y: 2, targetId: 'n1' } }))
    expect(hasFrame(calls, 'sel', 452, 288, 24, 2)).toBe(true)
    expect(hasFrame(calls, 'sel-edge', 450, 286, 28, 2)).toBe(true)
  })

  it('пустая сцена — ничего', () => {
    const { ctx, calls } = mockCtx()
    expect(drawNodes(ctx, makeScene([]), vp(800, 600), PIXEL, st({ selectedId: 'x' }))).toBe(0)
    expect(calls.filter((c) => c.op === 'fillRect')).toHaveLength(0)
  })
})

// ───────────────────────── связи: пиксельные сцены ─────────────────────────

/** Блоки буфера: номер → цвет; проверяет, что каждый ненулевой пиксель принадлежит целому блоку u×u одного цвета. */
function readBlocks(buf: LinkBuffer, u: number, bx: number, by: number): Map<string, number> {
  const blocks = new Map<string, number>()
  const { width: W, height: H, data } = buf
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = data[y * W + x]
      if (c === 0) continue
      const i = Math.floor((x - bx) / u)
      const j = Math.floor((y - by) / u)
      const key = `${i},${j}`
      const prev = blocks.get(key)
      if (prev !== undefined) {
        expect(prev).toBe(c)
        continue
      }
      blocks.set(key, c)
      for (let yy = by + j * u; yy < by + (j + 1) * u; yy++) {
        for (let xx = bx + i * u; xx < bx + (i + 1) * u; xx++) {
          if (xx >= 0 && xx < W && yy >= 0 && yy < H) expect(data[yy * W + xx]).toBe(c)
        }
      }
    }
  }
  return blocks
}

describe('drawLinksPixel', () => {
  // 400×300, камера (1, 0): ox = 199, oy = 150; u = 2, начало решётки (1, 0).
  // A (0, 0) → блок (99, 75); B (100, 60) → X 299, Y 210 → блок (149, 105). Главная ось x, 50 шагов.
  const v = vp(400, 300, 1, 1, 1, 0)
  const pair = (extra?: Partial<GraphLink>, nodeExtra: Partial<GraphNode> = {}) =>
    makeScene([{ x: 0, y: 0, ...nodeExtra }, { x: 100, y: 60 }], [[0, 1, extra]])

  /** Только блоки сердцевины обычной связи. */
  const cores = (blocks: Map<string, number>): Map<string, number> =>
    new Map([...blocks].filter(([, c]) => c === LINK || c === LINK_ALT))

  it('диагональ — непрерывная цепочка блоков u×u с чередованием цвета через два шага', () => {
    const buf = buffer(400, 300)
    expect(drawLinksPixel(buf, pair(), v, PIXEL, NONE)).toBe(1)
    const blocks = cores(readBlocks(buf, 2, 1, 0))
    expect(blocks.size).toBe(51)
    let prevJ = 75
    for (let s = 0; s <= 50; s++) {
      const i = 99 + s
      const js = [...blocks.keys()].filter((k) => k.startsWith(`${i},`)).map((k) => Number(k.split(',')[1]))
      expect(js).toHaveLength(1)
      expect(Math.abs(js[0] - prevJ)).toBeLessThanOrEqual(1)
      prevJ = js[0]
      expect(blocks.get(`${i},${js[0]}`)).toBe((s >> 1) & 1 ? LINK_ALT : LINK)
    }
    expect(blocks.has('99,75')).toBe(true)
    expect(blocks.has('149,105')).toBe(true)
  })

  it('крутая линия (главная ось y) тоже непрерывна', () => {
    const scene = makeScene([{ x: 0, y: -100 }, { x: 30, y: 120 }], [[0, 1]])
    const buf = buffer(400, 300)
    drawLinksPixel(buf, scene, v, PIXEL, NONE)
    const blocks = cores(readBlocks(buf, 2, 1, 0))
    const byJ = new Map<number, number[]>()
    for (const key of blocks.keys()) {
      const [i, j] = key.split(',').map(Number)
      byJ.set(j, [...(byJ.get(j) ?? []), i])
    }
    const js = [...byJ.keys()].sort((a, b) => a - b)
    for (let q = 1; q < js.length; q++) expect(js[q] - js[q - 1]).toBe(1)
    for (const j of js) expect(byJ.get(j)).toHaveLength(1)
  })

  it('решётка привязана к миру: сдвиг камеры на u px устройства сдвигает картинку целиком', () => {
    const a = buffer(400, 300)
    const b = buffer(400, 300)
    drawLinksPixel(a, pair(), vp(400, 300, 1, 1, 1, 0), PIXEL, NONE)
    drawLinksPixel(b, pair(), vp(400, 300, 1, 1, 3, 0), PIXEL, NONE) // ox меньше на 2
    for (let y = 0; y < 300; y++) for (let x = 2; x < 400; x++) expect(b.data[y * 400 + x - 2]).toBe(a.data[y * 400 + x])
  })

  it('связь между зонами — пунктир: шаги s % 8 ≥ 5 пропущены вместе с кромкой', () => {
    const buf = buffer(400, 300)
    drawLinksPixel(buf, pair({ cross: true }), v, PIXEL, NONE)
    const blocks = readBlocks(buf, 2, 1, 0)
    const coreCols = new Set([...cores(blocks).keys()].map((k) => Number(k.split(',')[0]) - 99))
    for (let s = 0; s <= 50; s++) expect(coreCols.has(s)).toBe(s % 8 < 5)
    // шаг s % 8 = 6 далеко от нарисованных: ни кромки, ни сердцевины; 5 и 7 — только кромка соседнего шага
    const allCols = new Set([...blocks.keys()].map((k) => Number(k.split(',')[0]) - 99))
    for (let s = 0; s <= 50; s++) if (s % 8 === 6) expect(allCols.has(s), `шаг ${s}`).toBe(false)
    expect(allCols.has(5)).toBe(true)
  })

  it('обычная связь — тёмная кромка 3×3 блока вокруг шага, сердцевина поверх', () => {
    const buf = buffer(400, 300)
    drawLinksPixel(buf, pair(), v, PIXEL, NONE)
    const blocks = readBlocks(buf, 2, 1, 0)
    expect(new Set(blocks.values())).toEqual(new Set([LINK, LINK_ALT, LINK_EDGE]))
    expect(blocks.get('99,75')).toBe(LINK)
    expect(blocks.get('98,74')).toBe(LINK_EDGE)
    expect(blocks.get('98,76')).toBe(LINK_EDGE)
    expect(blocks.get('99,74')).toBe(LINK_EDGE)
    expect(blocks.get('149,105')).toBe(LINK_ALT)
    expect(blocks.get('150,106')).toBe(LINK_EDGE)
  })

  it('кромка — ровно объединение квадратов 3×3 вокруг сердцевины (случайные отрезки, u = 2 и 3, пунктир, отсечение)', () => {
    let seed = 7
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    let checked = 0
    for (const dpr of [1, 1.5]) {
      const view = vp(400, 300, 1, dpr, 3.3, -1.7)
      const t = deviceTransform(view)
      const u = linkUnit(1, dpr)
      const bx = ((t.ox % u) + u) % u
      const by = ((t.oy % u) + u) % u
      const W = Math.round(400 * dpr)
      const H = Math.round(300 * dpr)
      const iFirst = Math.ceil(-bx / u)
      const iLast = Math.floor((W - bx) / u) - 1
      const jFirst = Math.ceil(-by / u)
      const jLast = Math.floor((H - by) / u) - 1
      for (let n = 0; n < 60; n++) {
        const far = n % 5 === 0 ? 2000 : 220
        const a = { x: (rnd() - 0.5) * 2 * far, y: (rnd() - 0.5) * 2 * far }
        const b = { x: (rnd() - 0.5) * 2 * 220, y: (rnd() - 0.5) * 2 * 160 }
        const cross = n % 3 === 0
        const buf = buffer(W, H)
        // n % 4 === 0 — горячая (другие цвета, без пунктира)
        const hot = n % 4 === 0
        drawLinksPixel(buf, makeScene([a, b], [[0, 1, { cross }]]), view, PIXEL, hot ? st({ selectedId: 'n0' }) : NONE)
        // без проверки целостности блоков (её делает readBlocks в других тестах) — иначе тест идёт секунды
        const blocks = new Map<string, number>()
        for (let j = jFirst; j <= jLast; j++) {
          for (let i = iFirst; i <= iLast; i++) {
            const c = buf.data[(by + j * u) * W + bx + i * u]
            if (c !== 0) blocks.set(`${i},${j}`, c)
          }
        }
        if (n === 0) readBlocks(buf, u, bx, by)
        const isCore = (c: number | undefined) => c === LINK || c === LINK_ALT || c === LINK_HOT
        const wrong: string[] = []
        let coreCount = 0
        for (let i = iFirst + 1; i < iLast; i++) {
          for (let j = jFirst + 1; j < jLast; j++) {
            const c = blocks.get(`${i},${j}`)
            if (isCore(c)) {
              coreCount++
              continue
            }
            let near = false
            for (let di = -1; di <= 1 && !near; di++) for (let dj = -1; dj <= 1; dj++) if (isCore(blocks.get(`${i + di},${j + dj}`))) near = true
            if ((c === LINK_EDGE) !== near) wrong.push(`${i},${j}`)
          }
        }
        expect(wrong, `dpr ${dpr}, отрезок ${n}`).toEqual([])
        checked += coreCount
      }
    }
    // отрезки действительно попадали на экран
    expect(checked).toBeGreaterThan(2000)
  })

  it('при u = 1 (масштаб 0,25, dpr 1) у обычной связи кромки нет, сердцевина — цвета кромки с альфой linkZoomAlpha; у горячей кромка есть', () => {
    const view = vp(400, 300, 0.25, 1, 0, 0)
    expect(linkUnit(0.25, 1)).toBe(1)
    const alpha = (c: number) => c >>> 24 // little-endian, как в draw.ts
    const rgb = (c: number) => c & 0x00ffffff
    const scene = makeScene([{ x: 0, y: 0 }, { x: 400, y: 160 }], [[0, 1]])

    const plainBuf = buffer(400, 300)
    drawLinksPixel(plainBuf, scene, view, PIXEL, NONE)
    const colors = new Set([...plainBuf.data].filter((c) => c !== 0))
    // Один цвет: ни кромки, ни двух цветов сердцевины.
    expect(colors.size).toBe(1)
    const [only] = [...colors]
    expect(rgb(only)).toBe(rgb(LINK_EDGE))
    expect(alpha(only)).toBe(Math.round(255 * linkZoomAlpha(0.25)))
    // Линия в один «пиксель»: по одному пикселю на шаг главной оси, без полос 1×3.
    const lit = [...plainBuf.data].filter((c) => c !== 0).length
    expect(lit).toBeLessThanOrEqual(110) // 100 шагов по главной оси + запас

    const hotBuf = buffer(400, 300)
    drawLinksPixel(hotBuf, scene, view, PIXEL, st({ selectedId: 'n0' }))
    const hotColors = new Set([...hotBuf.data].filter((c) => c !== 0))
    expect(hotColors.has(LINK_HOT)).toBe(true)
    expect(hotColors.has(LINK_EDGE)).toBe(true)
  })

  it('протягиваемая связь в одну клетку — кромка 3×3 вокруг блока', () => {
    const buf = buffer(400, 300)
    drawLinksPixel(buf, makeScene([{ x: 0, y: 0 }]), v, PIXEL, st({ tempLink: { fromId: 'n0', x: 0.4, y: 0.4, targetId: null } }))
    const blocks = readBlocks(buf, 2, 1, 0)
    expect(blocks.get('99,75')).toBe(LINK_HOT)
    for (const [di, dj] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
      expect(blocks.get(`${99 + di},${75 + dj}`)).toBe(LINK_EDGE)
    }
    expect(blocks.size).toBe(9)
  })

  it('две пересекающиеся обычные связи: в точке пересечения — сердцевина, не кромка', () => {
    // горизонталь и вертикаль через (0, 0) → блок (99, 75)
    const scene = makeScene([{ x: -100, y: 0 }, { x: 100, y: 0 }, { x: 0, y: -100 }, { x: 0, y: 100 }], [[0, 1], [2, 3]])
    const buf = buffer(400, 300)
    drawLinksPixel(buf, scene, v, PIXEL, NONE)
    const blocks = readBlocks(buf, 2, 1, 0)
    for (const key of ['99,75', '98,75', '100,75', '99,74', '99,76']) {
      expect([LINK, LINK_ALT]).toContain(blocks.get(key))
    }
  })

  it('приглушённая связь — альфа × 0.2 в байте цвета, у кромки тоже', () => {
    const buf = buffer(400, 300)
    drawLinksPixel(buf, pair({ dim: true }), v, PIXEL, NONE)
    const colors = new Set(buf.data.filter((c) => c !== 0))
    expect(colors).toEqual(new Set([packRgba(10, 20, 30, 51), packRgba(40, 50, 60, 51), packRgba(1, 2, 3, 51)]))
  })

  it('кромка обычной связи прозрачна — рисуется только сердцевина', () => {
    const buf = buffer(400, 300)
    drawLinksPixel(buf, pair(), v, { ...PIXEL, linkEdge: packRgba(0, 0, 0, 0) }, NONE)
    expect(new Set(buf.data.filter((c) => c !== 0))).toEqual(new Set([LINK, LINK_ALT]))
  })

  it('альфа обычных и приглушённых связей убывает с масштабом, горячих — нет', () => {
    expect(linkZoomAlpha(1)).toBe(1)
    expect(linkZoomAlpha(2)).toBe(1)
    expect(linkZoomAlpha(0.125)).toBeCloseTo(LINK_ZOOM_ALPHA_MIN)
    expect(linkZoomAlpha(0.01)).toBe(LINK_ZOOM_ALPHA_MIN)
    expect(linkZoomAlpha(Number.NaN)).toBe(1)
    const steps = GRAPH_ZOOM_STEPS.map(linkZoomAlpha)
    for (let q = 1; q < steps.length; q++) expect(steps[q]).toBeGreaterThanOrEqual(steps[q - 1])
    expect(linkZoomAlpha(0.5)).toBeLessThan(1)

    // 0.5: обычная — альфа × f, горячая — 255
    const view = vp(400, 300, 0.5, 1, 1, 0)
    const f = linkZoomAlpha(0.5)
    const scene = makeScene([{ x: 0, y: 0 }, { x: 200, y: 120 }, { x: 0, y: 200 }, { x: 200, y: 260 }], [[0, 1], [2, 3]])
    const buf = buffer(400, 300)
    drawLinksPixel(buf, scene, view, PIXEL, st({ hoveredId: 'n2' }))
    const alphas = new Set([...buf.data].filter((c) => c !== 0).map((c) => new Uint8Array(new Uint32Array([c]).buffer)[3]))
    expect(alphas).toEqual(new Set([Math.round(255 * f), 255]))
    expect(buf.data.includes(LINK_HOT)).toBe(true)
  })

  it('buf.dirty — наименьшая рамка записанных пикселей; ничего не записано — undefined', () => {
    const buf = buffer(400, 300)
    drawLinksPixel(buf, pair(), v, PIXEL, st({ selectedId: 'n0' }))
    let x0 = 400
    let y0 = 300
    let x1 = 0
    let y1 = 0
    for (let y = 0; y < 300; y++) {
      for (let x = 0; x < 400; x++) {
        if (buf.data[y * 400 + x] === 0) continue
        x0 = Math.min(x0, x)
        y0 = Math.min(y0, y)
        x1 = Math.max(x1, x + 1)
        y1 = Math.max(y1, y + 1)
      }
    }
    expect(buf.dirty).toEqual({ x0, y0, x1, y1 })
    expect((x1 - x0) * (y1 - y0)).toBeLessThan(400 * 300 / 4)

    const off = makeScene([{ x: 5000, y: 5000 }, { x: 6000, y: 5000 }], [[0, 1]])
    drawLinksPixel(buf, off, v, PIXEL, NONE)
    expect(buf.dirty).toBeUndefined()
  })

  it('обнуление только прошлой рамки даёт тот же кадр, что полное обнуление', () => {
    const scene = makeScene([{ x: 0, y: 0 }, { x: 100, y: 60 }, { x: -120, y: 40 }], [[0, 1], [0, 2, { cross: true }]])
    const a = buffer(400, 300)
    drawLinksPixel(a, scene, v, PIXEL, st({ selectedId: 'n1' }))
    const d = a.dirty
    expect(d).toBeDefined()
    if (d) for (let y = d.y0; y < d.y1; y++) a.data.fill(0, y * 400 + d.x0, y * 400 + d.x1)
    const next = vp(400, 300, 1, 1, 13, -9)
    drawLinksPixel(a, scene, next, PIXEL, st({ hoveredId: 'n2' }))
    const b = buffer(400, 300)
    drawLinksPixel(b, scene, next, PIXEL, st({ hoveredId: 'n2' }))
    expect(a.data).toEqual(b.data)
  })

  it('горячая связь (выбранная нода) — кромка 3×3 блока и сердцевина, без пунктира и приглушения', () => {
    const buf = buffer(400, 300)
    drawLinksPixel(buf, pair({ cross: true, dim: true }), v, PIXEL, st({ selectedId: 'n0' }))
    const colors = new Set(buf.data.filter((c) => c !== 0))
    expect(colors).toEqual(new Set([LINK_EDGE, LINK_HOT]))
    // сердцевина — на каждом шаге, кромка — вокруг первого блока
    const blocks = readBlocks(buf, 2, 1, 0)
    const hotCols = new Set(
      [...blocks.entries()].filter(([, c]) => c === LINK_HOT).map(([k]) => Number(k.split(',')[0])),
    )
    for (let i = 99; i <= 149; i++) expect(hotCols.has(i)).toBe(true)
    expect(blocks.get('99,74')).toBe(LINK_EDGE)
    expect(blocks.get('98,75')).toBe(LINK_EDGE)
  })

  it('горячая — у наведённой, под курсором и выбранная связь (hotLink в любом порядке)', () => {
    for (const state of [st({ hoveredId: 'n1' }), st({ cursorId: 'n0' }), st({ hotLink: { a: 'n1', b: 'n0' } })]) {
      const buf = buffer(400, 300)
      drawLinksPixel(buf, pair(), v, PIXEL, state)
      expect(buf.data.includes(LINK_HOT)).toBe(true)
      expect(buf.data.includes(LINK)).toBe(false)
    }
  })

  it('порядок: приглушённые → обычные → горячие (горячая поверх)', () => {
    // три связи из одной точки по одной прямой: перекрываются блоки у общего конца
    const scene = makeScene(
      [{ x: 0, y: 0 }, { x: 100, y: 0, dim: true }, { x: 120, y: 0 }, { x: 140, y: 0 }],
      [[0, 1, { dim: true }], [0, 2], [0, 3]],
    )
    const buf = buffer(400, 300)
    drawLinksPixel(buf, scene, v, PIXEL, st({ hotLink: { a: 'n0', b: 'n3' } }))
    // блок (100, 75) — у всех трёх связей; сверху горячая
    const blocks = readBlocks(buf, 2, 1, 0)
    expect(blocks.get('100,75')).toBe(LINK_HOT)
  })

  it('протягиваемая связь — горячая от ноды к точке мира', () => {
    const scene = makeScene([{ x: 0, y: 0 }])
    const buf = buffer(400, 300)
    expect(drawLinksPixel(buf, scene, v, PIXEL, st({ tempLink: { fromId: 'n0', x: 50, y: 0, targetId: null } }))).toBe(1)
    const blocks = readBlocks(buf, 2, 1, 0)
    expect(blocks.get('99,75')).toBe(LINK_HOT)
    expect(blocks.get('124,75')).toBe(LINK_HOT)
    expect(blocks.get('125,75')).toBe(LINK_EDGE)
    expect(blocks.has('126,75')).toBe(false)
  })

  it('кромка прозрачна — не рисуется (не стирает обычные связи)', () => {
    const buf = buffer(400, 300)
    drawLinksPixel(buf, pair(), v, { ...PIXEL, linkEdge: packRgba(0, 0, 0, 0) }, st({ selectedId: 'n0' }))
    expect(new Set(buf.data.filter((c) => c !== 0))).toEqual(new Set([LINK_HOT]))
  })

  it('связь вне экрана не трогает буфер', () => {
    const scene = makeScene([{ x: 5000, y: 5000 }, { x: 6000, y: 5000 }, { x: -5000, y: 0 }, { x: -5000, y: 400 }], [[0, 1], [2, 3]])
    const buf = buffer(400, 300)
    expect(drawLinksPixel(buf, scene, v, PIXEL, st({ selectedId: 'n0' }))).toBe(0)
    expect(buf.data.every((c) => c === 0)).toBe(true)
  })

  it('связь через весь экран с концами далеко за краями — рисуется только видимая часть', () => {
    const scene = makeScene([{ x: -100000, y: 10 }, { x: 100000, y: 10 }], [[0, 1, { cross: true }]])
    const buf = buffer(400, 300)
    expect(drawLinksPixel(buf, scene, v, PIXEL, NONE)).toBe(1)
    const blocks = readBlocks(buf, 2, 1, 0)
    // от левого края до правого: блоки −1..199 (частично видимые по краям), пунктир с шагом 8
    const cols = [...blocks.keys()].map((k) => Number(k.split(',')[0]))
    expect(Math.min(...cols)).toBeLessThanOrEqual(0)
    expect(Math.max(...cols)).toBeGreaterThanOrEqual(199)
    expect(blocks.size).toBeGreaterThan(100)
  })

  it('запись не выходит за границы буфера и не переносится на соседнюю строку', () => {
    // 101 × 80, камера x = 0.5 → ox = 50, начало решётки 0; последний блок i = 50 — столбец 100 (половина блока).
    const W = 101
    const H = 80
    const scene = makeScene([{ x: 50, y: -1000 }, { x: 50, y: 1000 }, { x: -1000, y: -40 }, { x: 1000, y: -40 }], [[0, 1], [2, 3]])
    const buf = buffer(W, H, 64)
    const view = vp(W, H, 1, 1, 0.5, 0)
    drawLinksPixel(buf, scene, view, PIXEL, st({ selectedId: 'n0', cursorId: 'n2' }))
    // вертикальная горячая у правого края: перенос записал бы в столбцы 0..2 следующей строки.
    // Строки 0..3 законно заняты горизонтальной горячей (мир y = −40 → блок 0, кромка ±1 блок).
    expect(buf.data[0]).toBe(LINK_HOT)
    for (let y = 4; y < H; y++) for (let x = 0; x < 3; x++) expect(buf.data[y * W + x], `(${x}, ${y})`).toBe(0)
    // за пределами W × H — ничего
    for (let q = W * H; q < buf.data.length; q++) expect(buf.data[q]).toBe(0)
    // правый край действительно закрашен
    expect(buf.data[40 * W + 100]).toBe(LINK_HOT)
  })

  it('пустая сцена и пустой буфер — 0', () => {
    expect(drawLinksPixel(buffer(400, 300), makeScene([]), v, PIXEL, NONE)).toBe(0)
    expect(drawLinksPixel(buffer(0, 0), pair(), v, PIXEL, NONE)).toBe(0)
  })
})

// ───────────────────────── связи: «Классика» ─────────────────────────

describe('drawLinksClassic', () => {
  it('три прохода — по одному beginPath и stroke; альфа, толщина и цвет прохода', () => {
    const scene = makeScene(
      [{ x: 0, y: 0 }, { x: 64, y: 0, dim: true }, { x: 0, y: 64 }, { x: 64, y: 64 }, { x: -64, y: 0 }, { x: -64, y: 64 }],
      [[0, 1], [0, 2], [2, 3], [4, 5], [3, 5]],
    )
    const { ctx, calls, raw } = mockCtx()
    // dpr 1.5 → толщина 2, у горячих 4. Курсор на n4: связь 4–5 горячая.
    const n = drawLinksClassic(ctx, scene, vp(800, 600, 1, 1.5), CLASSIC, st({ cursorId: 'n4' }))
    expect(n).toBe(5)
    const strokes = calls.filter((c) => c.op === 'stroke')
    expect(calls.filter((c) => c.op === 'beginPath')).toHaveLength(3)
    expect(strokes.map((c) => [c.alpha, c.width, c.stroke])).toEqual([
      [GRAPH_ALPHA_DIM, 2, 'link-css'],
      [1, 2, 'link-css'],
      [1, 4, 'hot-css'],
    ])
    expect(calls.filter((c) => c.op === 'moveTo')).toHaveLength(5)
    expect(raw.globalAlpha).toBe(1)
  })

  it('на 25 %: альфа приглушённых и обычных × linkZoomAlpha, горячих — 1', () => {
    const scene = makeScene([{ x: 0, y: 0 }, { x: 64, y: 0, dim: true }, { x: 0, y: 64 }, { x: -64, y: 0 }], [[0, 1], [0, 2], [3, 0]])
    const { ctx, calls } = mockCtx()
    drawLinksClassic(ctx, scene, vp(800, 600, 0.25), CLASSIC, st({ hotLink: { a: 'n3', b: 'n0' } }))
    const f = linkZoomAlpha(0.25)
    expect(calls.filter((c) => c.op === 'stroke').map((c) => c.alpha)).toEqual([GRAPH_ALPHA_DIM * f, f, 1])
  })

  it('связи вне экрана не рисуются; пустые проходы пропускаются', () => {
    const scene = makeScene([{ x: 5000, y: 0 }, { x: 6000, y: 0 }], [[0, 1]])
    const { ctx, calls } = mockCtx()
    expect(drawLinksClassic(ctx, scene, vp(800, 600), CLASSIC, NONE)).toBe(0)
    expect(calls.filter((c) => c.op === 'stroke')).toHaveLength(0)
  })

  it('длинная связь обрезается по экрану; протягиваемая — в горячем проходе', () => {
    const scene = makeScene([{ x: -100000, y: 0 }, { x: 100000, y: 0 }], [[0, 1]])
    const { ctx, calls } = mockCtx()
    expect(drawLinksClassic(ctx, scene, vp(800, 600), CLASSIC, st({ tempLink: { fromId: 'n0', x: 0, y: 50, targetId: null } }))).toBe(2)
    for (const c of calls.filter((q) => q.op === 'moveTo' || q.op === 'lineTo')) {
      expect(c.args[0]).toBeGreaterThanOrEqual(-4)
      expect(c.args[0]).toBeLessThanOrEqual(804)
    }
    expect(calls.filter((c) => c.op === 'stroke').map((c) => c.stroke)).toEqual(['link-css', 'hot-css'])
  })
})

// ───────────────────────── нагрузка ─────────────────────────

describe('нагрузка', () => {
  const cols = 45
  /** База проверки нагрузки §6: 2000 нод, 3000 случайных связей (детерминированно). */
  function bigScene(): GraphScene {
    const specs: NodeSpec[] = []
    for (let i = 0; i < 2000; i++) {
      specs.push({
        x: (i % cols) * GRAPH_CELL,
        y: Math.floor(i / cols) * GRAPH_CELL,
        color: GRAPH_COLOR_KEYS[i % GRAPH_COLOR_KEYS.length],
        inbox: i % 7 === 0,
        archived: i % 11 === 0,
        dim: i % 5 === 0,
      })
    }
    // детерминированный счётчик вместо Math.random
    let seed = 12345
    const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648)
    const pairs: Array<[number, number, Partial<GraphLink>]> = []
    const seen = new Set<number>()
    while (pairs.length < 3000) {
      const a = next() % 2000
      const b = next() % 2000
      if (a === b || seen.has(Math.min(a, b) * 2000 + Math.max(a, b))) continue
      seen.add(Math.min(a, b) * 2000 + Math.max(a, b))
      pairs.push([a, b, { cross: (a + b) % 3 === 0, dim: a % 5 === 0 || b % 5 === 0 }])
    }
    return makeScene(specs, pairs)
  }
  const center = { x: (cols * GRAPH_CELL) / 2, y: (Math.ceil(2000 / cols) * GRAPH_CELL) / 2 }

  it('связи при u ≥ 2: 1600×1000 при dpr 1.5, масштаб 100 % и 200 % (u = 3 и 6) — быстрее 60 мс', () => {
    const scene = bigScene()
    const state = st({ selectedId: 'n100', hoveredId: 'n200' })
    const buf = buffer(2400, 1500)
    for (const zoom of [1, 2]) {
      const view = vp(1600, 1000, zoom, 1.5, center.x, center.y)
      const once = () => {
        buf.data.fill(0)
        return drawLinksPixel(buf, scene, view, PIXEL, state)
      }
      once()
      once()
      let best = Infinity
      for (let r = 0; r < 3; r++) {
        const t0 = performance.now()
        once()
        best = Math.min(best, performance.now() - t0)
      }
      expect(best, `zoom ${zoom}: ${best.toFixed(1)} мс`).toBeLessThan(60)
    }
  })

  /** Лучшее из прогонов только drawLinksPixel после прогрева: рост времени связей в 2 раза этот замер ловит. */
  const bestLinksMs = (zoom: number, runs: number): number => {
    const scene = bigScene()
    const view = vp(1600, 1000, zoom, 1, center.x, center.y)
    const state = st({ selectedId: 'n100', hoveredId: 'n200' })
    const buf = buffer(1600, 1000)
    const once = () => {
      buf.data.fill(0)
      return drawLinksPixel(buf, scene, view, PIXEL, state)
    }
    once()
    once()
    let best = Infinity
    for (let r = 0; r < runs; r++) {
      const t0 = performance.now()
      once()
      best = Math.min(best, performance.now() - t0)
    }
    return best
  }

  it('связи при u = 1 на 12,5 % (dpr 1) — быстрее 20 мс (без кромки обычных связей)', () => {
    const best = bestLinksMs(0.125, 5)
    expect(best, `${best.toFixed(1)} мс`).toBeLessThan(20)
  })

  it('связи при u = 1 на 50 % (dpr 1) — быстрее 25 мс', () => {
    const best = bestLinksMs(0.5, 3)
    expect(best, `${best.toFixed(1)} мс`).toBeLessThan(25)
  })

  it('2000 нод и 3000 связей на масштабе 0.125, всё на экране 1600×1000 — быстрее 60 мс', () => {
    const scene = bigScene()
    const view = vp(1600, 1000, 0.125, 1, center.x, center.y)
    const state = st({ selectedId: 'n100', hoveredId: 'n200' })
    const buf = buffer(1600, 1000)
    let rects = 0
    const ctx = {
      fillStyle: '', strokeStyle: '', globalAlpha: 1, lineWidth: 1,
      fillRect() { rects++ },
    } as unknown as CanvasRenderingContext2D

    const frameOnce = () => {
      buf.data.fill(0)
      const links = drawLinksPixel(buf, scene, view, PIXEL, state)
      const nodes = drawNodes(ctx, scene, view, PIXEL, state)
      return { links, nodes }
    }
    frameOnce() // прогрев: в приложении кадры идут подряд
    const t0 = performance.now()
    const { links, nodes } = frameOnce()
    const ms = performance.now() - t0
    expect(nodes).toBe(2000)
    expect(links).toBe(3000)
    expect(rects).toBeGreaterThan(0)
    expect(ms).toBeLessThan(60)
  })
})
