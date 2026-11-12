/**
 * Мелочь земли и узор сетки (spec-stage6 §5.1): по сценам из SCENES/sceneTile мокапа. Спрайт мелочи ставится опорой в
 * центре (clearing.ts держит радиус CLEAR_GROUND_R на этом), размер не больше DETAIL_LIMIT. Какой вид рисовать, решает
 * доля r1 места: виды идут подряд, каждому своя доля; остаток — пусто. Ночь — ночные цвета мокапа, не фильтр.
 */

import { DETAIL } from '@/lib/ambient/sprites/palette'
import type { DetailColors } from '@/lib/ambient/sprites/palette'
import { makeSprite } from '@/lib/ambient/sprites/build'
import type { PixelSetter } from '@/lib/ambient/sprites/build'
import { hexColor } from '@/lib/ambient/raster'
import type { AmbientScene, Sprite } from '@/lib/ambient/types'

export interface GroundSprites {
  /** r1 выбирает вид, r2 — вариант внутри вида; null — на этом месте пусто. */
  detail: (r1: number, r2: number) => Sprite | null
  /** Узор по сетке графа; null — нет (всё, кроме «Бумаги»). */
  grid: Sprite | null
  /** Все спрайты мелочи (тесты и проверки размеров). */
  all: readonly Sprite[]
}

/** Вид мелочи: доля мест (по r1) и варианты (выбираются по r2). */
interface Kind {
  share: number
  variants: readonly Sprite[]
}

/** Доли мелочи по сценам (сумма видов): ориентир — счёт на плитку 128² мокапа, делённый на 64 клетки и 5 мест. */
export const DETAIL_SHARE: Record<AmbientScene, number> = {
  meadow: 0.86,
  autumn: 0.64,
  winter: 0.67,
  paper: 0.174,
}

/** Малый спрайт: пиксели по клеточной карте-строкам, символ → цвет, пробел и '.' — пусто. Опора — центр. */
function pixmap(rows: readonly string[], colors: Record<string, number>): Sprite {
  const h = rows.length
  const w = Math.max(...rows.map((r) => r.length))
  return makeSprite(w, h, { ax: Math.floor(w / 2), ay: Math.floor(h / 2) }, (set: PixelSetter) => {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = colors[row[x]]
        if (c) set(x, y, c)
      }
    })
  })
}

/** Пучок травы 3×3: две боковые травинки и средняя ниже. */
const tuft = (c: number): Sprite => pixmap(['x.x', 'xxx', '.x.'], { x: c })
/** Штрих шириной n. */
const stroke = (c: number, n: number): Sprite => pixmap(['x'.repeat(n)], { x: c })
const dot = (c: number): Sprite => pixmap(['x'], { x: c })

function pick(kinds: readonly Kind[]): (r1: number, r2: number) => Sprite | null {
  // накопленные границы считаем один раз
  const edges: number[] = []
  let acc = 0
  for (const k of kinds) edges.push((acc += k.share))
  return (r1, r2) => {
    for (let i = 0; i < kinds.length; i++) {
      if (r1 < edges[i]) {
        const v = kinds[i].variants
        return v[Math.min(v.length - 1, Math.floor(Math.max(0, r2) * v.length))]
      }
    }
    return null
  }
}

function leaves(c: DetailColors, col: (hex: string) => number): Kind[] {
  const dk = col(c.dk)
  const cols = c.leaves.map(col)
  // три формы листа из sceneTile; цвет листа выбирает r2
  const shape = (rows: readonly string[]) => cols.map((lc) => pixmap(rows, { x: lc, d: dk }))
  return [
    { share: 0.03, variants: shape(['.x.', 'xxx', 'xxx', '.d.']) },
    { share: 0.03, variants: shape(['.xx.', '.xxx', 'd...']) },
    { share: 0.03, variants: shape(['xx', '.x']) },
  ]
}

export function buildGround(scene: AmbientScene, dark: boolean): GroundSprites {
  const c = DETAIL[scene][dark ? 'night' : 'day']
  const col = (hex: string): number => hexColor(hex)
  const dk = col(c.dk)
  const lt = col(c.lt)
  let kinds: Kind[] = []
  let grid: Sprite | null = null

  if (scene === 'meadow') {
    const petals = col(c.dot)
    const heart = col(c.dot2)
    kinds = [
      { share: 0.5, variants: [tuft(dk)] },
      { share: 0.32, variants: [stroke(lt, 2)] },
      { share: 0.04, variants: [pixmap(['.x.', 'xcx', '.x.'], { x: petals, c: heart })] },
    ]
  } else if (scene === 'autumn') {
    const cap = col(c.cap)
    const stem = col(c.stem)
    kinds = [
      { share: 0.14, variants: [tuft(dk)] },
      { share: 0.08, variants: [tuft(col(c.green))] },
      { share: 0.32, variants: [stroke(lt, 2)] },
      ...leaves(c, col),
      {
        share: 0.01,
        // гриб: шляпка 5 в ширину, ножка и тёмный корень
        variants: [
          pixmap(['.xxs.', 'xsxxx', 'xxxxx', '..s..', '..s..', '.ddd.'], { x: cap, s: stem, d: dk }),
        ],
      },
    ]
  } else if (scene === 'winter') {
    kinds = [
      { share: 0.06, variants: [tuft(col(c.dot2))] },
      { share: 0.32, variants: [stroke(lt, 2)] },
      { share: 0.2, variants: [stroke(dk, 3)] },
      { share: 0.09, variants: [dot(col(c.dot))] },
    ]
  } else {
    // «Бумага»: волокна (светлые и тёмные поровну), редкие кляксы двух форм, точка сетки между нодами
    const ink = col(c.ink)
    const soft = hexColor(c.ink, 0.55)
    kinds = [
      { share: 0.17, variants: [stroke(lt, 3), stroke(dk, 3)] },
      {
        share: 0.004,
        variants: [
          pixmap(['.xxx..', 'xxxxx.', 'xxxxxx', '.xxxx.', '..s...'], { x: ink, s: soft }),
          pixmap(['..xxx..', '.xxxxxx', 'xxxxxx.', '.sxxs..'], { x: ink, s: soft }),
        ],
      },
    ]
    grid = dot(col(c.dot))
  }

  const detail = pick(kinds)
  const all: Sprite[] = kinds.flatMap((k) => [...k.variants])
  if (grid) all.push(grid)
  return { detail, grid, all }
}
