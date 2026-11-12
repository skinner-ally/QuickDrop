import { describe, expect, it } from 'vitest'
import { readSceneCss, sceneVars, SCENE_VARIANTS } from '@/test/sceneVars'
import { chA, chB, chG, chR, hexColor } from '@/lib/ambient/raster'
import { AMBIENT_SCENES, DETAIL_LIMIT, SPRITE_LIMITS } from '@/lib/ambient/types'
import type { Lod, ObjectKind, SceneArt, Sprite } from '@/lib/ambient/types'
import { downscale, makeSprite, nightColor, paintedCount, soften } from '@/lib/ambient/sprites/build'
import { buildForest } from '@/lib/ambient/sprites/forest'
import { buildGround } from '@/lib/ambient/sprites/ground'
import { buildSceneArt, DETAIL_SHARE, GROUND } from '@/lib/ambient/sprites/index'

const KINDS = Object.keys(SPRITE_LIMITS) as ObjectKind[]
const LODS: Lod[] = [0, 1, 2]
const FOREST_SCENES = ['meadow', 'autumn', 'winter'] as const

/** Все спрайты объектов сцены: [вид, гамма, вариант, спрайт]; null — в сцене такого нет. */
function objectsOf(art: SceneArt): Array<{ kind: ObjectKind; pal: number; variant: number; s: Sprite | null }> {
  const out: Array<{ kind: ObjectKind; pal: number; variant: number; s: Sprite | null }> = []
  for (const kind of KINDS) {
    const lim = SPRITE_LIMITS[kind]
    for (let pal = 0; pal < lim.pals; pal++) {
      for (let variant = 0; variant < lim.variants; variant++) out.push({ kind, pal, variant, s: art.object(kind, pal, variant) })
    }
  }
  return out
}

/** Спрайты мелочи земли и узор, достижимые через art.detail / art.grid. */
function detailsOf(art: SceneArt): Sprite[] {
  const seen = new Set<Sprite>()
  for (let i = 0; i < 2000; i++) {
    for (const r2 of [0, 0.13, 0.26, 0.4, 0.55, 0.7, 0.85, 0.999]) {
      const s = art.detail((i + 0.5) / 2000, r2)
      if (s) seen.add(s)
    }
  }
  if (art.grid) seen.add(art.grid)
  return [...seen]
}

function meanLuma(s: Sprite): number {
  let sum = 0
  let n = 0
  for (const c of s.data) {
    if (chA(c) === 0) continue
    sum += 0.2126 * chR(c) + 0.7152 * chG(c) + 0.0722 * chB(c)
    n++
  }
  return n ? sum / n : 0
}

/** Наибольшее отличие яркости цвета спрайта от земли. */
function maxContrast(s: Sprite, ground: number): number {
  const lum = (c: number) => 0.2126 * chR(c) + 0.7152 * chG(c) + 0.0722 * chB(c)
  let m = 0
  for (const c of s.data) if (chA(c) > 0) m = Math.max(m, Math.abs(lum(c) - lum(ground)))
  return m
}

function sameBytes(a: Sprite, b: Sprite): boolean {
  return a.w === b.w && a.h === b.h && a.ax === b.ax && a.ay === b.ay && a.data.length === b.data.length && a.data.every((v, i) => v === b.data[i])
}

describe('земля', () => {
  const blocks = readSceneCss()
  it.each(SCENE_VARIANTS.map((v) => [v.name, v] as const))('GROUND равна --ground: %s', (_n, v) => {
    const css = sceneVars(blocks, v.classes)('--ground').toLowerCase()
    expect(GROUND[v.scene][v.dark ? 'night' : 'day']).toBe(css)
  })

  it('SceneArt.ground — тот же цвет', () => {
    for (const scene of AMBIENT_SCENES) {
      for (const dark of [false, true]) {
        expect(buildSceneArt(scene, dark, 0, 0).ground).toBe(hexColor(GROUND[scene][dark ? 'night' : 'day']))
      }
    }
  })
})

describe('размеры и опоры', () => {
  for (const scene of FOREST_SCENES) {
    for (const dark of [false, true]) {
      it(`объекты ${scene} ${dark ? 'ночь' : 'день'}: пределы и опора`, () => {
        for (const { kind, pal, variant, s } of objectsOf(buildSceneArt(scene, dark, 0, 0))) {
          const id = `${kind}[${pal}][${variant}]`
          if (kind === 'lily' && scene === 'winter') {
            expect(s, id).toBeNull()
            continue
          }
          expect(s, id).not.toBeNull()
          const sp = s as Sprite
          const lim = SPRITE_LIMITS[kind]
          expect(sp.w, id).toBeLessThanOrEqual(lim.w)
          expect(sp.h, id).toBeLessThanOrEqual(lim.h)
          expect(sp.w * sp.h, id).toBe(sp.data.length)
          expect(Math.abs(sp.ax - sp.w / 2), id).toBeLessThanOrEqual(1)
          expect(sp.ay, id).toBeGreaterThanOrEqual(sp.h - 4)
          expect(sp.ay, id).toBeLessThanOrEqual(sp.h - 1)
          expect(paintedCount(sp), id).toBeGreaterThan(0)
        }
      })
    }
  }

  it('мелочь и узор: не больше DETAIL_LIMIT, опора — центр', () => {
    for (const scene of AMBIENT_SCENES) {
      for (const dark of [false, true]) {
        const list = detailsOf(buildSceneArt(scene, dark, 0, 0))
        expect(list.length, scene).toBeGreaterThan(0)
        for (const s of list) {
          expect(s.w, scene).toBeLessThanOrEqual(DETAIL_LIMIT)
          expect(s.h, scene).toBeLessThanOrEqual(DETAIL_LIMIT)
          expect(Math.abs(s.ax - s.w / 2), scene).toBeLessThanOrEqual(1)
          expect(Math.abs(s.ay - s.h / 2), scene).toBeLessThanOrEqual(1)
          expect(paintedCount(s), scene).toBeGreaterThan(0)
        }
      }
    }
  })

  it('точка опоры и размер лежат в спрайте на всех lod', () => {
    for (const scene of FOREST_SCENES) {
      for (const lod of LODS) {
        for (const { kind, s } of objectsOf(buildSceneArt(scene, false, lod, 0))) {
          if (!s) continue
          expect(s.ax, kind).toBeGreaterThanOrEqual(0)
          expect(s.ax, kind).toBeLessThan(s.w)
          expect(s.ay, kind).toBeGreaterThanOrEqual(0)
          expect(s.ay, kind).toBeLessThan(s.h)
          expect(Math.abs(s.ax - s.w / 2), kind).toBeLessThanOrEqual(1)
          expect(s.ay, kind).toBeGreaterThanOrEqual(s.h - 4)
        }
      }
    }
  })
})

describe('состав сцен', () => {
  it('в лесных сценах у каждого вида есть спрайт (кувшинки зимой нет)', () => {
    for (const scene of FOREST_SCENES) {
      for (const dark of [false, true]) {
        const art = buildSceneArt(scene, dark, 0, 0)
        for (const kind of KINDS) {
          const s = art.object(kind, 0, 0)
          if (kind === 'lily' && scene === 'winter') expect(s).toBeNull()
          else expect(s, `${scene} ${kind}`).not.toBeNull()
        }
        expect(art.water, scene).not.toBeNull()
        expect(art.grid, scene).toBeNull()
      }
    }
  })

  it('«Бумага»: ни объектов, ни воды; есть узор сетки (1×1) и мелочь', () => {
    for (const dark of [false, true]) {
      const art = buildSceneArt('paper', dark, 0, 0)
      for (const { s } of objectsOf(art)) expect(s).toBeNull()
      expect(art.water).toBeNull()
      expect(art.grid).not.toBeNull()
      expect(art.grid!.w).toBe(1)
      expect(art.grid!.h).toBe(1)
      expect(art.detail(0.05, 0.5)).not.toBeNull()
    }
  })

  it('номера вне предела не ломают выбор', () => {
    const art = buildSceneArt('meadow', false, 0, 0)
    expect(art.object('tree', 7, 5)).not.toBeNull()
    expect(art.object('tree', -1, -1)).not.toBeNull()
    expect(art.object('pine', 0, 1.7)).not.toBeNull()
  })

  it('цвета воды: пять сплошных и берег полупрозрачный', () => {
    for (const scene of FOREST_SCENES) {
      const w = buildSceneArt(scene, false, 0, 0).water!
      for (const k of ['deep', 'mid', 'lit', 'bank', 'dash'] as const) expect(chA(w[k]), `${scene} ${k}`).toBe(255)
      expect(chA(w.shore)).toBeGreaterThan(0)
      expect(chA(w.shore)).toBeLessThan(255)
    }
  })
})

describe('детерминизм', () => {
  it('лес и мелочь, собранные заново, побайтно равны', () => {
    for (const scene of FOREST_SCENES) {
      for (const dark of [false, true]) {
        const a = buildForest(scene, dark)
        const b = buildForest(scene, dark)
        const list = (f: typeof a): Sprite[] => [...f.tree.flat(), ...f.pine, ...f.bush.flat(), ...f.stone, ...f.small, ...f.reed, ...(f.lily ?? [])]
        const la = list(a)
        const lb = list(b)
        expect(la.length).toBe(lb.length)
        la.forEach((s, i) => expect(sameBytes(s, lb[i]), `${scene} #${i}`).toBe(true))
        expect(a.water).toEqual(b.water)
      }
    }
    for (const scene of AMBIENT_SCENES) {
      const a = buildGround(scene, false).all
      const b = buildGround(scene, false).all
      a.forEach((s, i) => expect(sameBytes(s, b[i]), scene).toBe(true))
    }
  })

  it('два вызова buildSceneArt дают равные спрайты', () => {
    for (const scene of AMBIENT_SCENES) {
      const a = objectsOf(buildSceneArt(scene, true, 1, 0.25))
      const b = objectsOf(buildSceneArt(scene, true, 1, 0.25))
      a.forEach((o, i) => {
        if (o.s) expect(sameBytes(o.s, b[i].s as Sprite)).toBe(true)
        else expect(b[i].s).toBeNull()
      })
    }
  })
})

describe('мелочь земли: доли', () => {
  it.each(AMBIENT_SCENES.map((s) => [s] as const))('доля мест с мелочью: %s', (scene) => {
    const art = buildSceneArt(scene, false, 0, 0)
    const N = 10_000
    let n = 0
    for (let i = 0; i < N; i++) if (art.detail((i + 0.5) / N, 0.5)) n++
    expect(Math.abs(n / N - DETAIL_SHARE[scene])).toBeLessThanOrEqual(0.02)
  })

  it('доли видов «Луга»: пучки 0.50, штрихи 0.32, ромашки 0.04', () => {
    const art = buildSceneArt('meadow', false, 0, 0)
    const counts = new Map<Sprite, number>()
    const N = 10_000
    for (let i = 0; i < N; i++) {
      const s = art.detail((i + 0.5) / N, 0.5)
      if (s) counts.set(s, (counts.get(s) ?? 0) + 1)
    }
    const shares = [...counts.values()].map((c) => c / N).sort((a, b) => b - a)
    expect(shares).toHaveLength(3)
    expect(shares[0]).toBeCloseTo(0.5, 1)
    expect(shares[1]).toBeCloseTo(0.32, 1)
    expect(shares[2]).toBeCloseTo(0.04, 1)
  })

  it('r2 выбирает вариант: листья «Осени» трёх форм и четырёх цветов', () => {
    const art = buildSceneArt('autumn', false, 0, 0)
    const seen = new Set<Sprite>()
    for (let i = 0; i < 400; i++) {
      const r1 = 0.54 + (i % 90) * 0.001 + 0.0005 // зона листьев: 0.54..0.63
      const s = art.detail(r1, (i * 0.37) % 1)
      if (s) seen.add(s)
    }
    expect(seen.size).toBe(12)
  })

  it('r1 = 1 или r2 = 1 не выходят за список', () => {
    for (const scene of AMBIENT_SCENES) {
      const art = buildSceneArt(scene, false, 0, 0)
      expect(art.detail(1, 0.5)).toBeNull()
      for (const r1 of [0, 0.1, 0.9999]) expect(() => art.detail(r1, 1)).not.toThrow()
    }
  })
})

describe('ночь', () => {
  it('nightColor: яркость вдвое ниже, альфа та же', () => {
    const c = hexColor('#d2691e', 0.5)
    const n = nightColor(c)
    expect(chA(n)).toBe(chA(c))
    expect(chR(n) + chG(n) + chB(n)).toBeLessThan((chR(c) + chG(c) + chB(c)) * 0.6)
    expect(nightColor(0)).toBe(0)
  })

  it('средняя яркость спрайта ночью ниже дневной', () => {
    for (const scene of FOREST_SCENES) {
      const day = objectsOf(buildSceneArt(scene, false, 0, 0))
      const night = objectsOf(buildSceneArt(scene, true, 0, 0))
      day.forEach((d, i) => {
        if (!d.s) return
        expect(meanLuma(night[i].s as Sprite), `${scene} ${d.kind}[${d.pal}][${d.variant}]`).toBeLessThan(meanLuma(d.s))
      })
    }
  })

  it('вода и мелочь ночью темнее', () => {
    for (const scene of FOREST_SCENES) {
      const d = buildSceneArt(scene, false, 0, 0).water!
      const n = buildSceneArt(scene, true, 0, 0).water!
      expect(chG(n.mid)).toBeLessThan(chG(d.mid))
    }
    for (const scene of AMBIENT_SCENES) {
      const d = detailsOf(buildSceneArt(scene, false, 0, 0)).map(meanLuma)
      const n = detailsOf(buildSceneArt(scene, true, 0, 0)).map(meanLuma)
      expect(n.reduce((a, b) => a + b, 0) / n.length, scene).toBeLessThan(d.reduce((a, b) => a + b, 0) / d.length)
    }
  })
})

describe('смягчение', () => {
  it('soften: альфа сохраняется, t = 0 — цвет как был, пустой остаётся пустым', () => {
    const g = hexColor('#86ab5e')
    const c = hexColor('#ff0000', 0.4)
    expect(chA(soften(c, g, 0.5))).toBe(chA(c))
    expect(soften(c, g, 0)).toBe(c)
    expect(soften(0, g, 0.5)).toBe(0)
  })

  it('soft = 0.5 уменьшает наибольший контраст к земле', () => {
    for (const scene of FOREST_SCENES) {
      for (const dark of [false, true]) {
        const hard = buildSceneArt(scene, dark, 0, 0)
        const soft = buildSceneArt(scene, dark, 0, 0.5)
        for (const [kind, pal, variant] of [['tree', 0, 0], ['tree', 3, 2], ['pine', 0, 0], ['bush', 1, 1], ['stone', 0, 0]] as const) {
          const a = hard.object(kind, pal, variant) as Sprite
          const b = soft.object(kind, pal, variant) as Sprite
          expect(maxContrast(b, soft.ground), `${scene} ${kind}`).toBeLessThan(maxContrast(a, hard.ground))
          expect(b.w).toBe(a.w)
          expect(b.ax).toBe(a.ax)
        }
      }
    }
  })

  it('soft вне 0..0.5 ограничивается; лес на смягчении — тот же рисунок', () => {
    const a = buildSceneArt('meadow', false, 0, 0.9)
    expect(a.soft).toBe(0.5)
    const b = buildSceneArt('meadow', false, 0, -1)
    expect(b.soft).toBe(0)
    const s0 = b.object('tree', 0, 0) as Sprite
    const s5 = a.object('tree', 0, 0) as Sprite
    // пустые пиксели остаются пустыми
    s0.data.forEach((v, i) => expect(chA(v) === 0).toBe(chA(s5.data[i]) === 0))
  })

  it('смягчённая вода и мелочь сдвигаются к земле', () => {
    const hard = buildSceneArt('winter', false, 0, 0)
    const soft = buildSceneArt('winter', false, 0, 0.5)
    expect(soft.water!.bank).not.toBe(hard.water!.bank)
    expect(chA(soft.water!.shore)).toBe(chA(hard.water!.shore))
  })
})

describe('lod', () => {
  it('lod 1 — ceil(w/2) × ceil(h/2), lod 2 — ceil(w/4) × ceil(h/4); пустых нет', () => {
    for (const scene of FOREST_SCENES) {
      for (const dark of [false, true]) {
        const full = objectsOf(buildSceneArt(scene, dark, 0, 0))
        const half = objectsOf(buildSceneArt(scene, dark, 1, 0))
        const quarter = objectsOf(buildSceneArt(scene, dark, 2, 0))
        full.forEach((f, i) => {
          const id = `${scene} ${f.kind}[${f.pal}][${f.variant}]`
          if (!f.s) {
            expect(half[i].s, id).toBeNull()
            expect(quarter[i].s, id).toBeNull()
            return
          }
          const h = half[i].s as Sprite
          const q = quarter[i].s as Sprite
          expect([h.w, h.h], id).toEqual([Math.ceil(f.s.w / 2), Math.ceil(f.s.h / 2)])
          expect([q.w, q.h], id).toEqual([Math.ceil(f.s.w / 4), Math.ceil(f.s.h / 4)])
          expect(paintedCount(h), id).toBeGreaterThan(0)
          expect(paintedCount(q), id).toBeGreaterThan(0)
        })
      }
    }
  })

  it('на lod 1 и 2 нет мелочи и узора', () => {
    for (const scene of AMBIENT_SCENES) {
      for (const lod of [1, 2] as const) {
        const art = buildSceneArt(scene, false, lod, 0)
        expect(art.grid).toBeNull()
        for (let i = 0; i < 100; i++) expect(art.detail(i / 100, 0.5)).toBeNull()
        expect(art.lod).toBe(lod)
      }
    }
  })

  it('downscale: блок берёт самый частый цвет, редкий блок пустеет, опора делится', () => {
    const a = hexColor('#ff0000')
    const b = hexColor('#00ff00')
    const s = makeSprite(5, 3, { ax: 4, ay: 2 }, (set) => {
      set(0, 0, a); set(1, 0, a); set(0, 1, b) // блок (0,0): красный 2, зелёный 1
      set(2, 0, b) // блок (1,0): один пиксель из четырёх — пусто
      set(4, 2, a) // край: блок (2,1) шириной 1 и высотой 1 — один пиксель из четырёх
    })
    const d = downscale(s, 2)
    expect([d.w, d.h]).toEqual([3, 2])
    expect(d.data[0]).toBe(a)
    expect(d.data[1]).toBe(0)
    expect(d.data[5]).toBe(0)
    expect([d.ax, d.ay]).toEqual([2, 1])
  })

  it('downscale: при равенстве цветов побеждает более тёмный (контур)', () => {
    const light = hexColor('#eeeeee')
    const dark = hexColor('#111111')
    const s = makeSprite(2, 2, {}, (set) => {
      set(0, 0, light)
      set(1, 0, dark)
    })
    expect(downscale(s, 2).data[0]).toBe(dark)
  })
})

describe('чистота спрайтов', () => {
  it('нет пикселей с нулевой альфой и ненулевым цветом (все сцены, lod, смягчение)', () => {
    for (const scene of AMBIENT_SCENES) {
      for (const dark of [false, true]) {
        for (const lod of LODS) {
          for (const soft of [0, 0.25, 0.5]) {
            const art = buildSceneArt(scene, dark, lod, soft)
            const all = [...objectsOf(art).map((o) => o.s), ...detailsOf(art)]
            for (const s of all) {
              if (!s) continue
              for (const c of s.data) if (chA(c) === 0) expect(c).toBe(0)
            }
            if (art.water) for (const k of ['deep', 'mid', 'lit', 'bank', 'dash', 'shore'] as const) expect(chA(art.water[k])).toBeGreaterThan(0)
          }
        }
      }
    }
  })

  it('сборка всех вариантов укладывается в разумное время', () => {
    const t0 = performance.now()
    for (const scene of AMBIENT_SCENES) {
      for (const dark of [false, true]) {
        for (const lod of LODS) {
          const art = buildSceneArt(scene, dark, lod, 0.25)
          objectsOf(art)
          detailsOf(art)
        }
      }
    }
    expect(performance.now() - t0).toBeLessThan(3000)
  })
})
