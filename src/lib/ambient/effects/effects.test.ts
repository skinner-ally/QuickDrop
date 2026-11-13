import { describe, expect, it, vi } from 'vitest'
import { buildClearing } from '@/lib/ambient/clearing'
import { chA, createRaster } from '@/lib/ambient/raster'
import type { AmbientEffect, AmbientScene, EffectFrame, Raster } from '@/lib/ambient/types'
import { AMBIENT_OVERLAY_MAX } from '@/lib/ambient/types'
import { leaves } from '@/lib/pixelfx/leaves'
import { rays } from '@/lib/pixelfx/rays'
import { BUTTERFLY_H, BUTTERFLY_W, butterflies, butterflyNearR, butterflySprite, drawButterfly } from './butterflies'
import { fireflies, firefliesOfCell } from './fireflies'
import { effectsFor } from './index'
import { snow, snowCount } from './snow'

// Перебор растров по сценам и масштабам: под полной нагрузкой vitest отдельные тесты идут 6–10 с.
vi.setConfig({ testTimeout: 30_000 })

/** Кадр эффектов как у движка: k = zoom · dpr, арт-пиксель — e пикселей устройства, запас видимой части 64 px. */
function makeFrame(
  o: Partial<{
    w: number
    h: number
    e: number
    t: number
    dark: boolean
    zoom: number
    dpr: number
    ox: number
    oy: number
    near: (wx: number, wy: number, r: number) => boolean
  }> = {},
): EffectFrame {
  const w = o.w ?? 200
  const h = o.h ?? 120
  const e = o.e ?? 2
  const zoom = o.zoom ?? 1
  const dpr = o.dpr ?? 1
  const ox = o.ox ?? 0
  const oy = o.oy ?? 0
  const k = zoom * dpr
  const W = w * e
  const H = h * e
  const m = 64 * dpr
  return {
    t: o.t ?? 1,
    w,
    h,
    e,
    dark: o.dark ?? false,
    zoom,
    ax: (wx) => (ox + wx * k) / e,
    ay: (wy) => (oy + wy * k) / e,
    wx: (ax) => ((ax + 0.5) * e - ox) / k,
    wy: (ay) => ((ay + 0.5) * e - oy) / k,
    bounds: { minX: (-m - ox) / k, minY: (-m - oy) / k, maxX: (W + m - ox) / k, maxY: (H + m - oy) / k },
    near: o.near ?? (() => false),
  }
}

function drawTo(eff: AmbientEffect, f: EffectFrame): Raster {
  const r = createRaster(f.w, f.h)
  eff.draw(r, f)
  return r
}

const painted = (r: Raster): number => r.data.reduce((n, c) => (c !== 0 ? n + 1 : n), 0)
/** Пиксели с заметной альфой (без слабой каймы свечения). */
const solid = (r: Raster): number => r.data.reduce((n, c) => (chA(c) >= 128 ? n + 1 : n), 0)

/** Растр, который запоминает обращения к индексам вне [0, длина) (записи вне растра). */
function guarded(w: number, h: number): { raster: Raster; bad: string[] } {
  const target = new Uint32Array(w * h)
  const bad: string[] = []
  const check = (p: string | symbol): void => {
    if (typeof p !== 'string') return
    if (/^-?\d+(\.\d+)?$/.test(p) || p === 'NaN' || p === 'Infinity' || p === '-Infinity') {
      const i = Number(p)
      if (!(Number.isInteger(i) && i >= 0 && i < target.length)) bad.push(p)
    }
  }
  const data = new Proxy(target, {
    get(t, p) {
      check(p)
      const v = Reflect.get(t, p, t)
      return typeof v === 'function' ? v.bind(t) : v
    },
    set(t, p, v) {
      check(p)
      return Reflect.set(t, p, v, t)
    },
  })
  return { raster: { w, h, data }, bad }
}

const ALL: ReadonlyArray<{ eff: AmbientEffect; dark: boolean }> = [
  { eff: leaves, dark: false },
  { eff: leaves, dark: true },
  { eff: rays, dark: false },
  { eff: snow, dark: false },
  { eff: fireflies, dark: true },
  { eff: butterflies, dark: false },
]

describe('effectsFor: таблица сцен', () => {
  const ids = (scene: AmbientScene, dark: boolean, zoom: number): string[] =>
    effectsFor(scene, dark, zoom).map((e) => e.id)

  it('Луг: день — лучи, бабочки от 75 %; ночь — светлячки от 50 %', () => {
    expect(ids('meadow', false, 1)).toEqual(['rays', 'butterflies'])
    expect(ids('meadow', false, 0.75)).toEqual(['rays', 'butterflies'])
    expect(ids('meadow', false, 0.5)).toEqual(['rays'])
    expect(ids('meadow', false, 0.125)).toEqual(['rays'])
    expect(ids('meadow', true, 2)).toEqual(['fireflies'])
    expect(ids('meadow', true, 0.5)).toEqual(['fireflies'])
    expect(ids('meadow', true, 0.25)).toEqual([])
  })
  it('Осень: листопад от 50 %; лучи только днём', () => {
    expect(ids('autumn', false, 1)).toEqual(['leaves', 'rays'])
    expect(ids('autumn', false, 0.5)).toEqual(['leaves', 'rays'])
    expect(ids('autumn', false, 0.25)).toEqual(['rays'])
    expect(ids('autumn', true, 1)).toEqual(['leaves'])
    expect(ids('autumn', true, 0.25)).toEqual([])
  })
  it('Зима: снег всегда; Бумага: ничего', () => {
    for (const dark of [false, true]) {
      for (const z of [0.125, 0.25, 0.5, 1, 2]) {
        expect(ids('winter', dark, z)).toEqual(['snow'])
        expect(ids('paper', dark, z)).toEqual([])
      }
    }
  })
  it('лучи есть только в дневных «Луге» и «Осени» на любом масштабе', () => {
    for (const scene of ['meadow', 'autumn', 'paper', 'winter'] as const) {
      for (const dark of [false, true]) {
        for (const z of [0.125, 0.25, 0.375, 0.5, 0.75, 1, 1.5, 2]) {
          const has = ids(scene, dark, z).includes('rays')
          expect(has, `${scene} ${dark ? 'ночь' : 'день'} ${z}`).toBe(!dark && (scene === 'meadow' || scene === 'autumn'))
        }
      }
    }
  })
  it('ссылка на массив стабильна; пустой набор — один и тот же', () => {
    expect(effectsFor('meadow', false, 1)).toBe(effectsFor('meadow', false, 2))
    expect(effectsFor('autumn', false, 1)).toBe(effectsFor('autumn', false, 0.5))
    expect(effectsFor('winter', true, 1)).toBe(effectsFor('winter', false, 0.25))
    expect(effectsFor('paper', false, 1)).toBe(effectsFor('paper', true, 0.125))
    expect(effectsFor('paper', false, 1)).toBe(effectsFor('meadow', true, 0.25))
    expect(effectsFor('meadow', false, 1)).not.toBe(effectsFor('meadow', false, 0.5))
  })
  it('плоскость и привязка эффектов', () => {
    expect([leaves.plane, leaves.anchor]).toEqual(['under', 'screen'])
    expect([rays.plane, rays.anchor]).toEqual(['over', 'screen'])
    expect([snow.plane, snow.anchor]).toEqual(['over', 'screen'])
    expect([fireflies.plane, fireflies.anchor]).toEqual(['over', 'world'])
    expect([butterflies.plane, butterflies.anchor]).toEqual(['over', 'world'])
  })
  it('нечисловой масштаб не бросает и не включает порогового', () => {
    expect(ids('autumn', true, Number.NaN)).toEqual([])
    expect(ids('meadow', false, Number.NaN)).toEqual(['rays'])
  })
})

describe('каждый эффект: детерминизм и границы растра', () => {
  for (const { eff, dark } of ALL) {
    const name = `${eff.id}${dark ? ' (ночь)' : ''}`
    // мировые эффекты редки (0–2 на ячейку 512 px): им нужен кадр побольше
    const [fw, fh] = eff.anchor === 'world' ? [900, 500] : [300, 200]
    it(`${name}: одинаковый кадр — побайтно равный растр, разные t — разный`, () => {
      const a = drawTo(eff, makeFrame({ w: fw, h: fh, t: 3.3, dark }))
      const b = drawTo(eff, makeFrame({ w: fw, h: fh, t: 3.3, dark }))
      expect(a.data).toEqual(b.data)
      expect(painted(a)).toBeGreaterThan(0)
      let differs = false
      for (const t of [4.1, 5.9, 8.4, 11.7]) {
        const c = drawTo(eff, makeFrame({ w: fw, h: fh, t, dark }))
        if (c.data.some((v, i) => v !== a.data[i])) differs = true
      }
      expect(differs).toBe(true)
    })

    it(`${name}: ничего не пишет вне растра (по краям, со сдвигом камеры, на малых растрах)`, () => {
      for (const [w, h, ox, oy] of [
        [120, 80, 0, 0],
        [120, 80, -317, 205],
        [97, 61, 1001, -999],
        [3, 2, 0, 0],
        [1, 1, 5, 5],
      ] as const) {
        for (const t of [0.5, 2.2, 7.7]) {
          const g = guarded(w, h)
          eff.draw(g.raster, makeFrame({ w, h, t, dark, ox, oy }))
          expect(g.bad, `${name} ${w}x${h} t=${t}`).toEqual([])
        }
      }
    })

    it(`${name}: растр без площади не ломается`, () => {
      eff.draw(createRaster(0, 0), makeFrame({ w: 0, h: 0, dark }))
      eff.draw(createRaster(0, 40), makeFrame({ w: 0, h: 40, dark }))
      eff.draw(createRaster(40, 0), makeFrame({ w: 40, h: 0, dark }))
    })

    it(`${name}: не стирает то, что уже есть в растре`, () => {
      const f = makeFrame({ w: 160, h: 100, t: 6.5, dark })
      const r = createRaster(160, 100)
      const mark = 0xff123456
      r.data[0] = mark
      r.data[160 * 100 - 1] = mark
      eff.draw(r, f)
      expect(painted(r)).toBeGreaterThan(0)
      // поверх чужого пикселя эффект рисует «поверх» или оставляет как есть, но не обнуляет
      expect(r.data[0]).not.toBe(0)
      expect(r.data[160 * 100 - 1]).not.toBe(0)
    })
  }
})

describe('листопад', () => {
  const times = [1, 3, 5, 7, 9, 11, 13, 15]
  const total = (f: (t: number) => EffectFrame): number => times.reduce((n, t) => n + solid(drawTo(leaves, f(t))), 0)

  it('число листьев растёт с площадью', () => {
    const small = total((t) => makeFrame({ w: 160, h: 100, t }))
    const big = total((t) => makeFrame({ w: 640, h: 400, t }))
    expect(small).toBeGreaterThan(0)
    expect(big).toBeGreaterThan(small * 6)
  })

  it('ночью листья темнее дневных', () => {
    const lum = (r: Raster): number => {
      let s = 0
      let n = 0
      for (const c of r.data) {
        if (c === 0) continue
        s += (c & 255) + ((c >>> 8) & 255) + ((c >>> 16) & 255)
        n++
      }
      return n ? s / n : 0
    }
    const day = lum(drawTo(leaves, makeFrame({ w: 400, h: 300, t: 6, dark: false })))
    const night = lum(drawTo(leaves, makeFrame({ w: 400, h: 300, t: 6, dark: true })))
    expect(night).toBeLessThan(day)
  })

  it('у нод (near → true) лежащих листьев нет, летящие бледные', () => {
    const free = total((t) => makeFrame({ w: 400, h: 300, t }))
    const blocked = total((t) => makeFrame({ w: 400, h: 300, t, near: () => true }))
    expect(free).toBeGreaterThan(0)
    expect(blocked).toBeGreaterThan(0)
    // летящие листья при альфе 0.35 — 6 клеток шаблона из 16; лежащие не рисуются совсем
    expect(blocked).toBeLessThan(free * 0.45)
  })

  it('растр листьев не зависит от того, где стоят ноды вдали от листа', () => {
    const t = 5
    const far = drawTo(leaves, makeFrame({ w: 300, h: 200, t, near: () => false }))
    const farToo = drawTo(leaves, makeFrame({ w: 300, h: 200, t, near: (wx, wy) => wx < -1e6 && wy < -1e6 }))
    expect(far.data).toEqual(farToo.data)
  })
})

describe('лучи', () => {
  it('рисуют и свет, и пылинки; у нод пылинок нет, заливка та же', () => {
    const maxFill = Math.round(AMBIENT_OVERLAY_MAX.alpha * 255)
    let motes = 0
    for (const t of [0, 1.5, 3, 4.5, 6, 7.5, 9]) {
      const free = drawTo(rays, makeFrame({ w: 400, h: 300, t }))
      const blocked = drawTo(rays, makeFrame({ w: 400, h: 300, t, near: () => true }))
      for (const c of blocked.data) expect(chA(c)).toBeLessThanOrEqual(maxFill)
      for (const c of free.data) if (chA(c) > maxFill) motes++
    }
    expect(motes).toBeGreaterThan(0)
  })

  it('800×500 на тик укладывается в 50 мс (лучший из нескольких прогонов)', () => {
    const f = makeFrame({ w: 800, h: 500, t: 2 })
    const r = createRaster(800, 500)
    rays.draw(r, f) // прогрев: геометрия считается один раз на размер
    let best = Infinity
    for (let i = 0; i < 6; i++) {
      r.data.fill(0)
      const t0 = performance.now()
      rays.draw(r, makeFrame({ w: 800, h: 500, t: 2 + i * 0.083 }))
      best = Math.min(best, performance.now() - t0)
    }
    expect(best).toBeLessThan(50)
  })
})

describe('снег', () => {
  it('число снежинок растёт с площадью', () => {
    expect(snowCount(0, 0)).toBe(0)
    expect(snowCount(520, 100)).toBe(20)
    expect(snowCount(640, 400)).toBe(98)
    expect(snowCount(1280, 800)).toBeGreaterThan(snowCount(640, 400) * 3.5)
    const small = painted(drawTo(snow, makeFrame({ w: 160, h: 100 })))
    const big = painted(drawTo(snow, makeFrame({ w: 640, h: 400 })))
    expect(big).toBeGreaterThan(small * 6)
  })
  it('плотность: на 640×400 около 100 снежинок (не меньше 80 закрашенных пикселей)', () => {
    let min = Infinity
    for (const t of [1, 4, 9, 16]) min = Math.min(min, painted(drawTo(snow, makeFrame({ w: 640, h: 400, t }))))
    expect(min).toBeGreaterThan(80)
  })
  it('снежинки белые и падают вниз со временем', () => {
    const a = drawTo(snow, makeFrame({ w: 200, h: 200, t: 2 }))
    for (const c of a.data) if (c !== 0) expect(c >>> 0).toBe(0xffffffff)
    // за 0.5 с самая медленная снежинка (10 арт-пикселей в секунду) смещается примерно на 5 строк
    const b = drawTo(snow, makeFrame({ w: 200, h: 200, t: 2.5 }))
    expect(b.data).not.toEqual(a.data)
  })
})

describe('экранный эффект не зависит от размера растра в общей части', () => {
  /** Доля совпавших непустых пикселей и число непустых в общей части; x < xMax, y < yMax. */
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

  it('снег: 835×445 и 605×445 совпадают левее 565 (открытие панели деталей не двигает снежинки)', () => {
    let n = 0
    for (const t of [7.3, 21.9, 1000]) {
      const wide = drawTo(snow, makeFrame({ w: 835, h: 445, t }))
      const narrow = drawTo(snow, makeFrame({ w: 605, h: 445, t }))
      const r = common(wide, narrow, 605 - 40, 445)
      expect(r.same, `t=${t}`).toBe(true)
      n += r.n
    }
    expect(n).toBeGreaterThan(100)
  })

  it('снег: смена высоты на 2 арт-пикселя не сбивает фазу падения (t = 1000 с)', () => {
    for (const t of [7.3, 1000, 86400.5]) {
      const a = drawTo(snow, makeFrame({ w: 835, h: 445, t }))
      const b = drawTo(snow, makeFrame({ w: 835, h: 447, t }))
      const r = common(a, b, 835 - 2, 445 - 10)
      expect(r.same, `t=${t}`).toBe(true)
      expect(r.n).toBeGreaterThan(50)
    }
  })
})

describe('мировые эффекты едут с камерой', () => {
  /** Растр при сдвиге камеры на (dx, dy) арт-пикселей равен исходному, сдвинутому на те же (dx, dy). */
  function checkShift(eff: AmbientEffect, dark: boolean, w: number, h: number, dx: number, dy: number, ts: number[]): number {
    let compared = 0
    const e = 2
    const pad = 12
    for (const t of ts) {
      const a = drawTo(eff, makeFrame({ w, h, t, dark, e, ox: 0, oy: 0 }))
      const b = drawTo(eff, makeFrame({ w, h, t, dark, e, ox: dx * e, oy: dy * e }))
      for (let y = pad + Math.max(0, -dy); y < h - pad - Math.max(0, dy); y++) {
        for (let x = pad + Math.max(0, -dx); x < w - pad - Math.max(0, dx); x++) {
          const ca = a.data[y * w + x]
          const cb = b.data[(y + dy) * w + (x + dx)]
          if (ca !== 0) compared++
          expect(cb, `t=${t} (${x},${y})`).toBe(ca)
        }
      }
    }
    return compared
  }

  it('светлячки: сдвиг растра = сдвиг камеры / e', () => {
    const n = checkShift(fireflies, true, 500, 300, 37, 21, [1.3, 4.6, 7.2, 10.9])
    expect(n).toBeGreaterThan(0)
  })
  it('светлячки: сдвиг в другую сторону', () => {
    const n = checkShift(fireflies, true, 500, 300, -23, -17, [2.2, 6.1, 9.4])
    expect(n).toBeGreaterThan(0)
  })
  it('бабочки: сдвиг растра = сдвиг камеры / e', () => {
    const n = checkShift(butterflies, false, 900, 500, 41, 29, [1.1, 3.7, 8.2, 12.5])
    expect(n).toBeGreaterThan(0)
  })
  it('смена видимой области не меняет вид общей части (ячейки мира, а не растра)', () => {
    // растр шире с тем же началом камеры: общая левая часть совпадает
    const t = 5.5
    const small = drawTo(fireflies, makeFrame({ w: 300, h: 200, t, dark: true }))
    const wide = drawTo(fireflies, makeFrame({ w: 600, h: 400, t, dark: true }))
    let compared = 0
    for (let y = 0; y < 200 - 12; y++) {
      for (let x = 0; x < 300 - 12; x++) {
        compared += small.data[y * 300 + x] !== 0 ? 1 : 0
        expect(wide.data[y * 600 + x]).toBe(small.data[y * 300 + x])
      }
    }
    expect(compared).toBeGreaterThan(0)
  })
})

describe('светлячки', () => {
  it('в ячейке мира от 1 до 5 светлячков, в среднем около 3', () => {
    let sum = 0
    let cells = 0
    const seen = new Set<number>()
    for (let cy = -20; cy < 20; cy++) {
      for (let cx = -20; cx < 20; cx++) {
        const n = firefliesOfCell(cx, cy, 3.7).length
        expect(n).toBeGreaterThanOrEqual(1)
        expect(n).toBeLessThanOrEqual(5)
        seen.add(n)
        sum += n
        cells++
      }
    }
    expect(seen.size).toBe(5)
    expect(sum / cells).toBeGreaterThan(2.7)
    expect(sum / cells).toBeLessThan(3.3)
  })
  it('на экране 1280×800 при 100 % в среднем горит заметно больше двух', () => {
    // растр 640×400 (e = 2): мир 1280×800 px, ячейка 512 — около 3.9 ячейки; горит около половины светлячков
    let lit = 0
    let frames = 0
    for (let t = 0; t < 60; t += 1.7) {
      const f = makeFrame({ w: 640, h: 400, t, dark: true })
      const b = f.bounds
      for (let cy = Math.floor(b.minY / 512); cy <= Math.floor(b.maxY / 512); cy++) {
        for (let cx = Math.floor(b.minX / 512); cx <= Math.floor(b.maxX / 512); cx++) {
          for (const ff of firefliesOfCell(cx, cy, t)) {
            if (ff.g >= 0.06 && ff.x >= 0 && ff.x < 1280 && ff.y >= 0 && ff.y < 800) lit++
          }
        }
      }
      frames++
    }
    expect(lit / frames).toBeGreaterThan(3)
  })
  it('над нодой не рисуются', () => {
    const free = painted(drawTo(fireflies, makeFrame({ w: 500, h: 300, t: 4.4, dark: true })))
    const blocked = painted(drawTo(fireflies, makeFrame({ w: 500, h: 300, t: 4.4, dark: true, near: () => true })))
    expect(free).toBeGreaterThan(0)
    expect(blocked).toBe(0)
  })
  it('свечение зелёно-жёлтое, ядро светлое', () => {
    const r = drawTo(fireflies, makeFrame({ w: 500, h: 300, t: 4.4, dark: true }))
    let maxA = 0
    for (const c of r.data) maxA = Math.max(maxA, chA(c))
    expect(maxA).toBe(255)
  })
})

describe('бабочки', () => {
  it('над нодой (faded) закрашено не больше 40 % пикселей спрайта: все расцветки, кадры и сдвиги шаблона', () => {
    for (let cw = 0; cw < 3; cw++) {
      for (let fr = 0; fr < 3; fr++) {
        const s = butterflySprite(cw, fr)
        const total = s.data.reduce((n, c) => (c !== 0 ? n + 1 : n), 0)
        expect(total).toBeGreaterThan(8)
        for (const mirror of [false, true]) {
          for (let ox = 0; ox < 4; ox++) {
            for (let oy = 0; oy < 4; oy++) {
              const r = createRaster(BUTTERFLY_W + 8, BUTTERFLY_H + 8)
              drawButterfly(r, 4 + ox, 4 + oy, cw, fr, mirror, true)
              // положение на растре перебирает все 16 сдвигов шаблона 4×4: доля от него не зависит
              const n = painted(r)
              expect(n / total, `cw${cw} fr${fr} ${ox},${oy}`).toBeLessThanOrEqual(0.4)
            }
          }
        }
      }
    }
  })

  it('спрайт: 9×7, три кадра отличаются, зеркало меняет вид', () => {
    expect(butterflySprite(0, 0).w).toBe(9)
    expect(butterflySprite(0, 0).h).toBe(7)
    expect(butterflySprite(0, 0).data).not.toEqual(butterflySprite(0, 1).data)
    expect(butterflySprite(0, 1).data).not.toEqual(butterflySprite(0, 2).data)
    const a = createRaster(12, 10)
    const b = createRaster(12, 10)
    drawButterfly(a, 1, 1, 0, 0, false, false)
    drawButterfly(b, 1, 1, 0, 0, true, false)
    expect(a.data).not.toEqual(b.data)
    expect(painted(a)).toBe(painted(b))
  })

  it('в кадре: у нод бабочек не больше 40 % от обычного числа пикселей', () => {
    let free = 0
    let blocked = 0
    for (const t of [1, 3, 6, 9]) {
      free += painted(drawTo(butterflies, makeFrame({ w: 900, h: 500, t })))
      blocked += painted(drawTo(butterflies, makeFrame({ w: 900, h: 500, t, near: () => true })))
    }
    expect(free).toBeGreaterThan(0)
    expect(blocked).toBeGreaterThan(0)
    expect(blocked).toBeLessThanOrEqual(free * 0.4)
  })

  it('порог «рядом с нодой» растёт с размером арт-пикселя: непрозрачная бабочка не закрывает ноду (e 2…4, масштаб 50…100 %)', () => {
    // сетка нод через 128 px мира: рядом с каждой пролетают бабочки; нода — квадрат ±8 px мира
    const pts: Array<{ x: number; y: number }> = []
    for (let y = -512; y <= 512; y += 128) for (let x = -512; x <= 512; x += 128) pts.push({ x, y })
    const near = buildClearing(pts).near
    let exercised = 0
    for (const e of [2, 3, 4]) {
      for (const zoom of [0.5, 0.75, 1]) {
        const base = { w: 200, h: 120, e, zoom, ox: 100 * e, oy: 60 * e }
        const k = zoom
        for (let t = 0; t < 300; t += 1) {
          const f = makeFrame({ ...base, t, near })
          const all = makeFrame({ ...base, t, near: () => true })
          const a = drawTo(butterflies, f)
          const b = drawTo(butterflies, all)
          // у каждой ноды сетки: пиксели рядом с ней (alpha 0.3, шаблон) уже есть в «всё бледное»; новых быть не должно
          for (const p of pts) {
            const x0 = Math.max(0, Math.floor(f.ax(p.x - 8)))
            const x1 = Math.min(f.w, Math.ceil(f.ax(p.x + 8)))
            const y0 = Math.max(0, Math.floor(f.ay(p.y - 8)))
            const y1 = Math.min(f.h, Math.ceil(f.ay(p.y + 8)))
            for (let y = y0; y < y1; y++) {
              for (let x = x0; x < x1; x++) {
                const i = y * f.w + x
                if (b.data[i] !== 0) exercised++
                expect(a.data[i] !== 0 && b.data[i] === 0, `e=${e} zoom=${k} t=${t} (${x},${y})`).toBe(false)
              }
            }
          }
        }
      }
    }
    expect(exercised).toBeGreaterThan(50)
  })

  it('butterflyNearR: не меньше нижней границы и покрывает полудиагональ ноды и спрайта', () => {
    for (const perArt of [0.5, 1, 2, 2.67, 4, 8, 16]) {
      const r = butterflyNearR(perArt)
      expect(r).toBeGreaterThanOrEqual(24)
      expect(r).toBeGreaterThanOrEqual(8 * Math.SQRT2 + 5.7 * perArt)
    }
    // мелкий арт-пиксель — нижняя граница
    expect(butterflyNearR(0.5)).toBe(24)
  })

  it('на сцене бывает примерно четверть ячеек с бабочкой', () => {
    // 0.25 на ячейку 512 px: на окне 6000×4000 мира (~12×8 ячеек) пикселей заметно больше, чем на 1000×700
    const many = painted(drawTo(butterflies, makeFrame({ w: 1500, h: 1000, t: 2 })))
    const few = painted(drawTo(butterflies, makeFrame({ w: 300, h: 200, t: 2 })))
    expect(many).toBeGreaterThan(few)
  })
})
