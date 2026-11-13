/// <reference types="node" />
/*! pixelfx (MIT) — Copyright (c) 2026 Patch, Copyright (c) 2026 Hugo Duprez. Лицензия: src/lib/pixelfx/LICENSE */

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildClearing } from '@/lib/ambient/clearing'
import { chA, chB, chG, chR, createRaster, hexColor } from '@/lib/ambient/raster'
import type { AmbientEffect, EffectFrame, Raster } from '@/lib/ambient/types'
import { AMBIENT_OVERLAY_MAX } from '@/lib/ambient/types'
import { fit, hex, mix } from './color'
import { drawLeaf, leafNearR, leaves } from './leaves'
import { TAU, clamp, hash, rand, wrap } from './math'
import { RAY_LEVELS, drawRayLight, moteNearR, rayGeometry, rays } from './rays'
import { bayer, trips } from './trips'

const dir = fileURLToPath(new URL('.', import.meta.url))
const read = (name: string): string => readFileSync(dir + name, 'utf8')

describe('hash и rand: эталон снят с mockup/pixelfx/core/math.js', () => {
  const REF: Array<[number[], number, number]> = [
    [[0], 493009611, 0.11478774505667388],
    [[1], 1059954845, 0.24678996880538762],
    [[7], 1655559385, 0.38546495721675456],
    [[1, 2, 3], 2901138804, 0.6754740150645375],
    [[152, 3, 72], 4260976464, 0.9920858927071095],
    [[152, 41, 2, 13], 3070282085, 0.7148557540494949],
    [[-5, 9], 2181848573, 0.508001207606867],
    [[3, 100, 1], 2368831172, 0.5515364864841104],
    [[2147483647, -2147483648], 4284907532, 0.997657778672874],
    [[3.7, 2.2], 269647435, 0.06278218585066497],
  ]
  it.each(REF)('hash(%j) = %i', (ns, h, r) => {
    expect(hash(...ns)).toBe(h)
    expect(rand(...ns)).toBe(r)
  })
  it('rand в [0, 1)', () => {
    for (let i = 0; i < 2000; i++) {
      const v = rand(9, i, 3)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('math', () => {
  it('wrap всегда неотрицателен, clamp ограничивает', () => {
    expect(wrap(-3, 5)).toBe(2)
    expect(wrap(7, 5)).toBe(2)
    expect(wrap(-0.5, 2)).toBe(1.5)
    expect(clamp(2)).toBe(1)
    expect(clamp(-1)).toBe(0)
    expect(clamp(5, 2, 4)).toBe(4)
    expect(TAU).toBeCloseTo(6.2831853, 6)
  })
})

describe('color', () => {
  it('hex читает #rgb и #rrggbb', () => {
    expect(hex('#fff')).toBe(hexColor('#ffffff'))
    expect(chR(hex('#102030'))).toBe(0x10)
    expect(chG(hex('#102030'))).toBe(0x20)
    expect(chB(hex('#102030'))).toBe(0x30)
    expect(chA(hex('#102030'))).toBe(255)
  })
  it('mix: концы и середина', () => {
    const a = hex('#000000')
    const b = hex('#ffffff')
    expect(mix(a, b, 0)).toBe(a)
    expect(mix(a, b, 1)).toBe(b)
    expect(chR(mix(a, b, 0.5))).toBe(128)
    expect(mix(a, b, 7)).toBe(b)
  })
  it('fit оставляет концы и даёт ровно n ступеней', () => {
    const list = ['#000000', '#444444', '#888888', '#ffffff']
    expect(fit(list, 4)).toEqual(list.map(hex))
    const six = fit(list, 6)
    expect(six).toHaveLength(6)
    expect(six[0]).toBe(hex('#000000'))
    expect(six[5]).toBe(hex('#ffffff'))
    const two = fit(list, 2)
    expect(two).toEqual([hex('#000000'), hex('#ffffff')])
  })
})

describe('trips', () => {
  it('зовёт fn ровно n раз, u в [0, 1), m в [m0, m1], номер места по порядку', () => {
    const seen: number[] = []
    for (const t of [0, 0.4, 3.3, 15.9, 16, 100.123]) {
      let calls = 0
      trips(t, 16, 37, 152, 2, 3, (u, k, m, i) => {
        expect(u).toBeGreaterThanOrEqual(0)
        expect(u).toBeLessThan(1)
        expect(m === 2 || m === 3).toBe(true)
        expect(Number.isInteger(k)).toBe(true)
        expect(i).toBe(calls)
        calls++
        seen.push(m)
      })
      expect(calls).toBe(37)
    }
    expect(new Set(seen)).toEqual(new Set([2, 3]))
  })
  it('детерминирован, падение идёт вперёд и за петлю делает m оборотов', () => {
    const grab = (t: number): number[] => {
      const out: number[] = []
      trips(t, 16, 12, 152, 2, 3, (u, k) => out.push(u, k))
      return out
    }
    expect(grab(3.25)).toEqual(grab(3.25))
    // через петлю (D секунд) картина та же: целое число оборотов
    const a = grab(2.5)
    const b = grab(2.5 + 16)
    for (let i = 0; i < a.length; i += 2) {
      expect(b[i]).toBeCloseTo(a[i], 9)
      expect(b[i + 1]).toBeGreaterThan(a[i + 1])
    }
  })
  it('n = 0 — ни одного вызова', () => {
    let calls = 0
    trips(1, 16, 0, 1, 1, 1, () => calls++)
    expect(calls).toBe(0)
  })
})

describe('bayer', () => {
  it('16 разных порогов в (0, 1), шаблон повторяется по 4', () => {
    const set = new Set<number>()
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const v = bayer(x, y)
        expect(v).toBeGreaterThan(0)
        expect(v).toBeLessThan(1)
        set.add(v)
        expect(bayer(x + 4, y + 8)).toBe(v)
      }
    }
    expect(set.size).toBe(16)
  })
})

describe('drawLeaf', () => {
  const col = ['#4a1d0c', '#8a3a14', '#c8621e', '#f0982e', '#ffcf72', '#fff0c4'].map(hex)
  it('рисует лист, альфа 0 — ничего, граница растра не нарушается', () => {
    const r = createRaster(40, 30)
    drawLeaf(r, 20, 15, 6, 0.3, 0.8, 0, col, 1)
    expect(r.data.some((c) => c !== 0)).toBe(true)
    const e = createRaster(40, 30)
    drawLeaf(e, 20, 15, 6, 0.3, 0.8, 0, col, 0)
    expect(e.data.every((c) => c === 0)).toBe(true)
    const edge = createRaster(10, 10)
    drawLeaf(edge, -2, 5, 6, 0, 1, 1, col, 1)
    drawLeaf(edge, 12, 5, 6, 0, 1, 2, col, 1)
    expect(edge.data.length).toBe(100)
  })
  it('альфа 0.35 закрашивает заметно меньше, чем 1', () => {
    const full = createRaster(40, 30)
    const part = createRaster(40, 30)
    drawLeaf(full, 20, 15, 6, 0.3, 0.8, 0, col, 1)
    drawLeaf(part, 20, 15, 6, 0.3, 0.8, 0, col, 0.35)
    const n = (r: typeof full): number => r.data.filter((c) => c !== 0).length
    expect(n(part)).toBeLessThan(n(full) * 0.5)
    expect(n(part)).toBeGreaterThan(0)
  })
})

describe('лучи: геометрия и заливка', () => {
  it('геометрия считается один раз на размер и пересчитывается при смене размера', () => {
    const a = rayGeometry(200, 120)
    expect(rayGeometry(200, 120)).toBe(a)
    const b = rayGeometry(201, 120)
    expect(b).not.toBe(a)
    expect(b.w).toBe(201)
    expect(b.bin.length).toBe(201 * 120)
    expect(b.fall.length).toBe(201 * 120)
    const c = rayGeometry(200, 120)
    expect(c).not.toBe(a)
    expect(c.bin).toEqual(a.bin)
  })
  it('номер угла и затухание в допустимых границах', () => {
    const g = rayGeometry(160, 100)
    for (let k = 0; k < g.bin.length; k++) {
      expect(g.bin[k]).toBeLessThan(1024)
      expect(g.fall[k]).toBeGreaterThanOrEqual(0)
      expect(g.fall[k]).toBeLessThanOrEqual(1)
    }
  })
  it('ступени светлые (яркость >= 0.6) и с альфой <= AMBIENT_OVERLAY_MAX', () => {
    const lin = (v: number): number => {
      const s = v / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    const maxA = Math.round(AMBIENT_OVERLAY_MAX.alpha * 255)
    const steps = RAY_LEVELS.filter((c) => c !== 0)
    expect(steps.length).toBe(5)
    for (const c of steps) {
      const L = 0.2126 * lin(chR(c)) + 0.7152 * lin(chG(c)) + 0.0722 * lin(chB(c))
      expect(L).toBeGreaterThanOrEqual(0.6)
      expect(chA(c)).toBeLessThanOrEqual(maxA)
      expect(chA(c)).toBeGreaterThan(0)
    }
  })
  it('сплошная заливка: альфа каждого пикселя <= AMBIENT_OVERLAY_MAX, есть и свет, и пустота', () => {
    const maxA = Math.round(AMBIENT_OVERLAY_MAX.alpha * 255)
    for (const [w, h] of [[320, 180], [200, 400], [97, 53]] as const) {
      for (const t of [0, 1.7, 4.2, 9.9, 123.4]) {
        const r = createRaster(w, h)
        drawRayLight(r, t)
        let lit = 0
        for (const c of r.data) {
          if (c === 0) continue
          lit++
          expect(chA(c)).toBeLessThanOrEqual(maxA)
        }
        expect(lit).toBeGreaterThan(0)
        expect(lit).toBeLessThan(w * h)
      }
    }
  })
  it('пустой растр и растр без места не ломаются', () => {
    drawRayLight(createRaster(0, 0), 1)
    drawRayLight(createRaster(1, 1), 1)
    drawRayLight(createRaster(0, 50), 1)
  })
  it('разные t — разная заливка; одинаковый t — побайтно равная', () => {
    const a = createRaster(160, 100)
    const b = createRaster(160, 100)
    const c = createRaster(160, 100)
    drawRayLight(a, 2)
    drawRayLight(b, 2)
    drawRayLight(c, 5)
    expect(a.data).toEqual(b.data)
    expect(a.data).not.toEqual(c.data)
  })
})

/** Кадр экранного эффекта: арт-пиксель = e px устройства, k = zoom (dpr 1); камера сдвинута на (ox, oy) px устройства. */
function frame(
  o: { w: number; h: number; t: number; e?: number; zoom?: number; ox?: number; oy?: number; near?: EffectFrame['near'] },
): EffectFrame {
  const e = o.e ?? 2
  const k = o.zoom ?? 1
  const ox = o.ox ?? 0
  const oy = o.oy ?? 0
  return {
    t: o.t,
    w: o.w,
    h: o.h,
    e,
    dark: false,
    zoom: k,
    ax: (wx) => (ox + wx * k) / e,
    ay: (wy) => (oy + wy * k) / e,
    wx: (ax) => ((ax + 0.5) * e - ox) / k,
    wy: (ay) => ((ay + 0.5) * e - oy) / k,
    bounds: { minX: -1e4, minY: -1e4, maxX: 1e4, maxY: 1e4 },
    near: o.near ?? (() => false),
  }
}

function paint(eff: AmbientEffect, f: EffectFrame): Raster {
  const r = createRaster(f.w, f.h)
  eff.draw(r, f)
  return r
}

/** Сетка нод через 128 px мира: рядом с каждой что-нибудь пролетает. */
function nodeGrid(): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = []
  for (let y = -512; y <= 512; y += 128) for (let x = -512; x <= 512; x += 128) pts.push({ x, y })
  return pts
}

describe('экранные эффекты заданы в абсолютных арт-пикселях, а не в долях растра', () => {
  /** Совпадение пикселей a и b в x < xMax, y < yMax; n — сколько там непустых. */
  function common(a: Raster, b: Raster, xMax: number, yMax: number): { same: boolean; n: number } {
    let n = 0
    for (let y = 0; y < yMax; y++) {
      for (let x = 0; x < xMax; x++) {
        const ca = a.data[y * a.w + x]
        if (ca !== 0) n++
        if (ca !== b.data[y * b.w + x]) return { same: false, n }
      }
    }
    return { same: true, n }
  }
  const effects: Array<[string, AmbientEffect]> = [
    ['листья', leaves],
    ['лучи и пылинки', rays],
  ]

  for (const [name, eff] of effects) {
    it(`${name}: 835×445 и 605×445 совпадают левее 565 (панель деталей сужает сцену)`, () => {
      let n = 0
      for (const t of [7.3, 12.1, 1000]) {
        const r = common(paint(eff, frame({ w: 835, h: 445, t })), paint(eff, frame({ w: 605, h: 445, t })), 605 - 40, 445)
        expect(r.same, `t=${t}`).toBe(true)
        n += r.n
      }
      expect(n).toBeGreaterThan(300)
    })
    it(`${name}: смена высоты на 2 арт-пикселя не двигает общую часть`, () => {
      let n = 0
      for (const t of [7.3, 1000]) {
        const r = common(paint(eff, frame({ w: 835, h: 445, t })), paint(eff, frame({ w: 835, h: 447, t })), 835 - 2, 445 - 10)
        expect(r.same, `t=${t}`).toBe(true)
        n += r.n
      }
      expect(n).toBeGreaterThan(300)
    })
  }

  it('число листьев всё ещё растёт с площадью растра', () => {
    const count = (w: number, h: number): number => {
      let n = 0
      for (const t of [1, 3, 5, 7, 9, 11, 13, 15]) n += paint(leaves, frame({ w, h, t })).data.filter((c) => c !== 0).length
      return n
    }
    expect(count(900, 600)).toBeGreaterThan(count(300, 200) * 4)
  })
})

describe('пороги «рядом с нодой» растут с размером арт-пикселя', () => {
  const NODE = 8 * Math.SQRT2
  const configs: Array<[number, number]> = []
  for (const e of [2, 3, 4]) for (const zoom of [0.5, 0.75, 1]) configs.push([e, zoom])

  it('пылинки (и хвост из двух пикселей) не ложатся на квадрат ноды ±8 px мира', () => {
    const pts = nodeGrid()
    const near = buildClearing(pts).near
    const maxFill = Math.round(AMBIENT_OVERLAY_MAX.alpha * 255)
    let motes = 0
    for (const [e, zoom] of configs) {
      for (let t = 0; t < 40; t += 0.9) {
        const base = { w: 200, h: 120, t, e, zoom, ox: 100 * e, oy: 60 * e }
        const f = frame({ ...base, near })
        const r = paint(rays, f)
        const free = paint(rays, frame(base))
        for (const p of pts) {
          const x0 = Math.max(0, Math.floor(f.ax(p.x - 8)))
          const x1 = Math.min(f.w, Math.ceil(f.ax(p.x + 8)))
          const y0 = Math.max(0, Math.floor(f.ay(p.y - 8)))
          const y1 = Math.min(f.h, Math.ceil(f.ay(p.y + 8)))
          for (let y = y0; y < y1; y++) {
            for (let x = x0; x < x1; x++) {
              if (chA(free.data[y * f.w + x]) > maxFill) motes++
              // заливка лучей полупрозрачна (<= maxFill), пылинка — нет
              expect(chA(r.data[y * f.w + x]), `e=${e} zoom=${zoom} t=${t} (${x},${y})`).toBeLessThanOrEqual(maxFill)
            }
          }
        }
      }
    }
    // без ограничения пылинки на нодах бывают: проверка не пустая
    expect(motes).toBeGreaterThan(20)
  })

  it('moteNearR: не меньше прежних 14 px и покрывает полудиагональ ноды плюс пиксель с хвостом', () => {
    for (const perArt of [0.5, 1, 2, 2.67, 4, 8, 16]) {
      const r = moteNearR(perArt)
      expect(r).toBeGreaterThanOrEqual(14)
      expect(r).toBeGreaterThanOrEqual(NODE + 1.5 * perArt)
    }
    expect(moteNearR(0.1)).toBeGreaterThanOrEqual(14)
  })

  it('leafNearR: покрывает полудиагональ ноды и наибольший вылет листа (1.25 размера + кромка)', () => {
    for (const perArt of [0.5, 1, 2, 2.67, 4, 8, 16]) {
      for (const size of [4.2, 5, 5.8, 6.5, 7.4]) {
        const r = leafNearR(size, perArt)
        expect(r).toBeGreaterThanOrEqual(36)
        expect(r).toBeGreaterThanOrEqual(NODE + 1.25 * size * perArt)
      }
    }
  })

  it('листья: точка приземления, признанная «не рядом», дальше от нод, чем лист достаёт', () => {
    const pts = nodeGrid()
    const clearing = buildClearing(pts)
    for (const [e, zoom] of configs) {
      const perArt = e / zoom
      let calls = 0
      let bad = 0
      for (let t = 0; t < 16; t += 0.7) {
        const f = frame({ w: 200, h: 120, t, e, zoom, ox: 100 * e, oy: 60 * e })
        f.near = (wx, wy, r) => {
          const res = clearing.near(wx, wy, r)
          calls++
          if (!res) {
            let d = Infinity
            for (const p of pts) d = Math.min(d, Math.hypot(p.x - wx, p.y - wy))
            // наименьший лист — размер 4.2: его вылет 1.25·4.2 арт-пикселя до кромки ноды
            if (d <= NODE + 1.25 * 4.2 * perArt) bad++
          }
          return res
        }
        paint(leaves, f)
      }
      expect(calls, `e=${e} zoom=${zoom}`).toBeGreaterThan(5)
      expect(bad, `e=${e} zoom=${zoom}`).toBe(0)
    }
  })
})

describe('лицензия', () => {
  it('в шапке math.ts полный текст MIT (для исходников; в сборке — public/licenses)', () => {
    const src = read('math.ts')
    expect(src.startsWith('/*!')).toBe(true)
    expect(src).toContain('Permission is hereby granted')
    const header = src.slice(0, src.indexOf('*/'))
    const lines = read('LICENSE')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    for (const line of lines) expect(header).toContain(line)
  })
  it('каждый .ts пакета начинается с /*! … */ или /// reference, затем /*!', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThanOrEqual(6)
    for (const f of files) {
      const src = read(f).replace(/^\/\/\/ <reference[^\n]*\n/, '')
      expect(src.startsWith('/*!'), f).toBe(true)
      expect(src.slice(0, src.indexOf('*/'))).toContain('Copyright (c) 2026 Patch')
    }
  })
  it('LICENSE и README на месте', () => {
    expect(read('LICENSE')).toContain('MIT License')
    expect(read('README.md')).toContain('LICENSE')
  })
})
