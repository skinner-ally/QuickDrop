/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getAmbientLayer,
  requestAmbientFrame,
  setAmbientLayer,
  subscribeAmbient,
} from '@/lib/graph/ambient'
import type { AmbientLayer } from '@/lib/graph/ambient'
import { composeGraphTheme, GRAPH_COLOR_KEYS, packRgba, subscribeGraphTheme } from '@/lib/graph/theme'
import type { GraphColorReader } from '@/lib/graph/theme'
import { GRAPH_COLOR_KEYS as TYPES_KEYS } from '@/lib/graph/types'
import { CATEGORY_COLORS } from '@/types'

describe('GRAPH_COLOR_KEYS', () => {
  it('«нет цвета» первым, затем цвета категорий по порядку', () => {
    expect(GRAPH_COLOR_KEYS).toEqual(['none', ...CATEGORY_COLORS])
    expect(GRAPH_COLOR_KEYS).toHaveLength(10)
  })

  it('реэкспорт — та же константа, что в types.ts', () => {
    expect(GRAPH_COLOR_KEYS).toBe(TYPES_KEYS)
  })
})

describe('packRgba', () => {
  const bytesOf = (n: number): number[] => Array.from(new Uint8Array(new Uint32Array([n]).buffer))

  it('байты в памяти идут как r, g, b, a (порядок ImageData)', () => {
    expect(bytesOf(packRgba(1, 2, 3, 4))).toEqual([1, 2, 3, 4])
    expect(bytesOf(packRgba(255, 0, 128, 255))).toEqual([255, 0, 128, 255])
  })

  it('запись через Uint32Array видна в ImageData-байтах', () => {
    const bytes = new Uint8ClampedArray(8)
    const view = new Uint32Array(bytes.buffer)
    view[1] = packRgba(10, 20, 30, 40)
    expect(Array.from(bytes)).toEqual([0, 0, 0, 0, 10, 20, 30, 40])
  })

  it('результат — неотрицательное целое (в том числе при альфе 255)', () => {
    for (const v of [packRgba(0, 0, 0, 0), packRgba(255, 255, 255, 255), packRgba(0, 0, 0, 255), packRgba(255, 0, 0, 255)]) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(0xffffffff)
    }
    expect(packRgba(0, 0, 0, 0)).toBe(0)
  })

  it('значения вне 0..255 и дроби приводятся к байту', () => {
    expect(packRgba(300, -5, 127.6, Number.NaN)).toBe(packRgba(255, 0, 128, 0))
  })
})

describe('composeGraphTheme', () => {
  /** Подставной читатель: значения переменных — из таблицы, байты — из второй таблицы (по умолчанию непрозрачный). */
  function reader(vars: Record<string, string>, bytes: Record<string, [number, number, number, number]> = {}) {
    const asked: string[] = []
    const r: GraphColorReader = {
      css: (name) => {
        asked.push(name)
        const v = vars[name]
        if (v === undefined) throw new Error(`не запрошена переменная ${name}`)
        return v
      },
      rgba: (css) => bytes[css] ?? [1, 2, 3, 255],
    }
    return { r, asked }
  }

  const base = (): Record<string, string> => {
    const v: Record<string, string> = {
      '--graph-node-edge': 'edge',
      '--graph-shadow': 'shadow',
      '--graph-inbox': 'inbox',
      '--graph-inbox-edge': 'inbox-edge',
      '--graph-fav': 'fav',
      '--graph-fav-edge': 'fav-edge',
      '--graph-sel': 'sel',
      '--graph-sel-edge': 'sel-edge',
      '--graph-hover': 'hover',
      '--graph-link': 'link',
      '--graph-link-alt': 'link-alt',
      '--graph-link-edge': 'link-edge',
      '--graph-link-hot': 'link-hot',
    }
    for (const k of GRAPH_COLOR_KEYS) v[`--cat-${k}`] = `cat-${k}`
    return v
  }

  it('поля темы берутся из переменных по таблице соответствия', () => {
    const { r } = reader(base(), {
      link: [10, 20, 30, 255],
      'link-alt': [40, 50, 60, 255],
      'link-edge': [70, 80, 90, 255],
      'link-hot': [100, 110, 120, 128],
    })
    const t = composeGraphTheme(true, r)
    expect(t.pixel).toBe(true)
    for (const k of GRAPH_COLOR_KEYS) expect(t.cat[k]).toBe(`cat-${k}`)
    expect(Object.keys(t.cat)).toHaveLength(GRAPH_COLOR_KEYS.length)
    expect(t.nodeEdge).toBe('edge')
    expect(t.shadow).toBe('shadow')
    expect(t.inbox).toBe('inbox')
    expect(t.inboxEdge).toBe('inbox-edge')
    expect(t.fav).toBe('fav')
    expect(t.favEdge).toBe('fav-edge')
    expect(t.sel).toBe('sel')
    expect(t.selEdge).toBe('sel-edge')
    expect(t.hover).toBe('hover')
    expect(t.linkCss).toBe('link')
    expect(t.linkHotCss).toBe('link-hot')
    expect(t.link).toBe(packRgba(10, 20, 30, 255))
    expect(t.linkAlt).toBe(packRgba(40, 50, 60, 255))
    expect(t.linkEdge).toBe(packRgba(70, 80, 90, 255))
    expect(t.linkHot).toBe(packRgba(100, 110, 120, 128))
  })

  it('прозрачные рамка, тень и кромка выделения («Классика») дают null', () => {
    const vars = base()
    vars['--graph-node-edge'] = 'transparent'
    vars['--graph-shadow'] = 'transparent'
    vars['--graph-sel-edge'] = 'transparent'
    const { r } = reader(vars, {
      transparent: [0, 0, 0, 0],
      'link-edge': [0, 0, 0, 0],
    })
    const t = composeGraphTheme(false, r)
    expect(t.pixel).toBe(false)
    expect(t.nodeEdge).toBeNull()
    expect(t.shadow).toBeNull()
    expect(t.selEdge).toBeNull()
    // обязательные цвета остаются строками, прозрачная кромка связи — нулевой пиксель
    expect(t.sel).toBe('sel')
    expect(t.linkEdge).toBe(0)
  })

  it('полупрозрачная тень — не null', () => {
    const vars = base()
    vars['--graph-shadow'] = 'rgb(40 24 10 / .28)'
    const { r } = reader(vars, { 'rgb(40 24 10 / .28)': [40, 24, 10, 71] })
    expect(composeGraphTheme(true, r).shadow).toBe('rgb(40 24 10 / .28)')
  })

  it('читает только переменные --graph-* и --cat-*', () => {
    const { r, asked } = reader(base())
    composeGraphTheme(true, r)
    for (const name of asked) expect(name).toMatch(/^--(graph|cat)-/)
    expect(asked).toContain('--cat-none')
  })
})

// ───────────────────────── scenes.css: читаемость графа на земле ─────────────────────────

/** Блоки `:root…{ --x: … }` файла сцен: селектор, специфичность (число классов), порядок, переменные. */
function parseRootBlocks(css: string) {
  const out: Array<{ classes: string[]; alts: string[] | null; spec: number; order: number; vars: Record<string, string> }> = []
  let order = 0
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/:root([^{]*)\{([^}]*)\}/g)) {
    const sel = m[1].trim()
    const is = sel.match(/:is\(([^)]*)\)/)
    const alts = is ? [...is[1].matchAll(/\.([\w-]+)/g)].map((x) => x[1]) : null
    const classes = [...sel.replace(/:is\([^)]*\)/, '').matchAll(/\.([\w-]+)/g)].map((x) => x[1])
    const vars: Record<string, string> = {}
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]] = d[2].trim()
    out.push({ classes, alts, spec: classes.length + (alts ? 1 : 0), order: order++, vars })
  }
  return out
}

/** Вычисленные переменные <html> с данными классами (каскад по специфичности и порядку, var() раскрывается). */
function sceneVars(blocks: ReturnType<typeof parseRootBlocks>, classes: string[]): (name: string) => string {
  const set = new Set(classes)
  const merged: Record<string, string> = {}
  blocks
    .filter((b) => b.classes.every((c) => set.has(c)) && (!b.alts || b.alts.some((c) => set.has(c))))
    .sort((a, b) => a.spec - b.spec || a.order - b.order)
    .forEach((b) => Object.assign(merged, b.vars))
  const resolve = (name: string, depth = 0): string => {
    const v = merged[name]
    if (v === undefined || depth > 10) throw new Error(`нет переменной ${name} для ${classes.join(' ')}`)
    const ref = v.match(/^var\((--[\w-]+)\)$/)
    return ref ? resolve(ref[1], depth + 1) : v
  }
  return resolve
}

function luminance(hex: string): number {
  const n = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

describe('scenes.css: граф читается на земле во всех восьми вариантах', () => {
  const blocks = parseRootBlocks(readFileSync('src/styles/scenes.css', 'utf-8'))
  const variants = ['meadow', 'autumn', 'paper', 'winter'].flatMap((sc) => [
    { name: `${sc} день`, classes: ['pixel', `sc-${sc}`] },
    { name: `${sc} ночь`, classes: ['pixel', `sc-${sc}`, 'dark'] },
  ])
  /** Элемент цвета fg с тёмной кромкой edge снаружи на земле ground: кромка отделяет его от земли, либо сам цвет. */
  const edged = (fg: string, edge: string, ground: string) =>
    contrast(fg, edge) >= 3 && (contrast(edge, ground) >= 3 || contrast(fg, ground) >= 3)

  for (const { name, classes } of variants) {
    it(name, () => {
      const v = sceneVars(blocks, classes)
      const ground = v('--graph-bg')
      // подпись: текст к контуру 2px (контур закрывает просветы букв)
      expect(contrast(v('--graph-label'), v('--graph-label-edge')), 'подпись').toBeGreaterThanOrEqual(4.5)
      // обычная связь: тёмная кромка или обе сердцевины
      const linkOk = contrast(v('--graph-link-edge'), ground) >= 3 ||
        Math.min(contrast(v('--graph-link'), ground), contrast(v('--graph-link-alt'), ground)) >= 3
      expect(linkOk, 'связь').toBe(true)
      // рамки: золото выбранной и соседей, наведение и курсор — с тёмной кромкой
      expect(edged(v('--graph-sel'), v('--graph-sel-edge'), ground), 'золото').toBe(true)
      expect(edged(v('--graph-hover'), v('--graph-sel-edge'), ground), 'наведение').toBe(true)
      // звёздочка избранного: золото с тёмной кромкой
      expect(edged(v('--graph-fav'), v('--graph-fav-edge'), ground), 'избранное').toBe(true)
      // нода любой категории: рамка/контур или сама заливка
      for (const key of GRAPH_COLOR_KEYS) {
        const fill = v(`--cat-${key}`)
        const ok = contrast(v('--graph-node-edge'), ground) >= 3 || contrast(fill, ground) >= 3
        expect(ok, `нода ${key}`).toBe(true)
      }
      // обводка фокуса сцены (pixel.css): золото между рамкой сцены и кромкой wood-dark
      expect(edged(v('--gold'), v('--wood-dark'), ground), 'фокус').toBe(true)
    })
  }
})

describe('subscribeGraphTheme вне браузера', () => {
  it('возвращает безопасную отписку', () => {
    const cb = vi.fn()
    const off = subscribeGraphTheme(cb)
    expect(typeof off).toBe('function')
    expect(() => off()).not.toThrow()
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('ambient: контракт живого фона', () => {
  afterEach(() => setAmbientLayer(null))

  const layer = (): AmbientLayer => ({ draw: vi.fn() })

  it('слой по умолчанию не задан', () => {
    expect(getAmbientLayer()).toBeNull()
  })

  it('setAmbientLayer ставит слой и будит подписчиков; тот же слой — не будит', () => {
    const cb = vi.fn()
    const off = subscribeAmbient(cb)
    const l = layer()
    setAmbientLayer(l)
    expect(getAmbientLayer()).toBe(l)
    expect(cb).toHaveBeenCalledTimes(1)
    setAmbientLayer(l)
    expect(cb).toHaveBeenCalledTimes(1)
    setAmbientLayer(null)
    expect(getAmbientLayer()).toBeNull()
    expect(cb).toHaveBeenCalledTimes(2)
    off()
  })

  it('requestAmbientFrame будит подписчиков, отписка работает', () => {
    const cb = vi.fn()
    const off = subscribeAmbient(cb)
    requestAmbientFrame()
    requestAmbientFrame()
    expect(cb).toHaveBeenCalledTimes(2)
    off()
    requestAmbientFrame()
    expect(cb).toHaveBeenCalledTimes(2)
  })

  it('подписчик может отписаться изнутри вызова', () => {
    const second = vi.fn()
    const offFirst = subscribeAmbient(() => offFirst())
    const offSecond = subscribeAmbient(second)
    requestAmbientFrame()
    requestAmbientFrame()
    expect(second).toHaveBeenCalledTimes(2)
    offSecond()
  })
})
