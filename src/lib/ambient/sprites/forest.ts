/**
 * Лес сцены в картах пикселей (spec-stage6 §5.1): деревья 4 гамм × 3 кроны, сосны, кусты, камни, мелочь (пень,
 * тыква / ромашка / сугроб, гриб), камыш, кувшинка и цвета воды. Перенос `makeSprites` из mockup/forest.js.
 * Ночь — `nightColor` от дневных цветов (так же, как фильтр мокапа над слоем леса).
 */

import { BARK, FOREST, STONE } from '@/lib/ambient/sprites/palette'
import type { ForestScene } from '@/lib/ambient/sprites/palette'
import { crown, ellipse, makeSprite, nightColor } from '@/lib/ambient/sprites/build'
import { hash2 } from '@/lib/ambient/world'
import { hexColor } from '@/lib/ambient/raster'
import type { Sprite, WaterColors } from '@/lib/ambient/types'

export interface ForestSprites {
  /** [гамма][крона] */
  tree: Sprite[][]
  pine: Sprite[]
  /** [гамма][вид] */
  bush: Sprite[][]
  stone: Sprite[]
  /** 0 — пень, 1 — тыква / ромашка / сугроб, 2 — гриб / сугроб. */
  small: Sprite[]
  reed: Sprite[]
  /** null — кувшинок в сцене нет (зима). */
  lily: Sprite[] | null
  water: WaterColors
}

/** Формы крон: шары [cx, cy, r] на поле 30×40. */
const CROWNS: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
  [[15, 14, 10], [9, 18, 7], [21, 18, 7], [15, 9, 7]],
  [[15, 13, 9], [10, 11, 6], [20, 12, 7], [13, 20, 7], [20, 19, 5]],
  [[15, 11, 8], [15, 18, 9], [11, 14, 6], [20, 15, 6]],
]

export function buildForest(scene: ForestScene, dark: boolean): ForestSprites {
  const T = FOREST[scene]
  const col = (hex: string, a = 1): number => {
    const c = hexColor(hex, a)
    return dark ? nightColor(c) : c
  }
  const shadowColor = col(T.shadow[0], T.shadow[1])
  const bark = BARK.map((c) => col(c))
  const snowy = T.extra === 'drift'

  const tree: Sprite[][] = []
  const bush: Sprite[][] = []
  T.leaf.forEach((p, pi) => {
    const line = col(p.line)
    const tones = p.tones.map((c) => col(c))
    tree.push(
      CROWNS.map((cs, v) =>
        makeSprite(30, 40, { line, shadow: [15, 36.5, 10, 3], shadowColor, ay: 37 }, (set) => {
          for (let y = 24; y <= 36; y++) for (let x = 13; x <= 16; x++) set(x, y, bark[x === 13 ? 2 : x === 16 ? 0 : 1])
          set(12, 36, bark[1])
          set(17, 36, bark[0])
          set(12, 35, bark[2])
          crown(set, cs, tones, pi * 7 + v)
        }),
      ),
    )
    bush.push(
      [0, 1].map((v) =>
        makeSprite(20, 15, { line, shadow: [10, 12.5, 8, 2.2], shadowColor, ay: 13 }, (set) => {
          crown(
            set,
            v
              ? [[7, 8, 5], [13, 8, 4], [10, 6, 4]]
              : [[6, 8, 4], [12, 8, 5], [9, 5, 4]],
            tones,
            40 + pi * 3 + v,
          )
        }),
      ),
    )
  })

  const pineTones = T.pine.tones.map((c) => col(c))
  const pine: Sprite[] = []
  for (let v = 0; v < 2; v++) {
    pine.push(
      makeSprite(20, 38, { line: col(T.pine.line), shadow: [10, 34.5, 6, 2], shadowColor, ay: 35 }, (set) => {
        for (let y = 29; y <= 34; y++) {
          set(9, y, bark[2])
          set(10, y, bark[0])
        }
        const n = 3 + v
        const hh = v ? 10 : 12
        for (let i = 0; i < n; i++) {
          const ay = 2 + i * (v ? 6 : 7)
          const hw = 3.6 + i * (v ? 1.7 : 2.2)
          for (let y = 0; y < hh; y++) {
            const w = ((y + 1) / hh) * hw
            for (let x = Math.ceil(10 - w); x < 10 + w; x++) {
              const rel = (x + 0.5 - 10) / w
              let tn = rel < -0.4 ? 2 : rel < 0.25 ? 1 : 0
              if (y === hh - 1) tn = 0
              else if (tn === 2 && hash2(x, ay + y, 90 + v) < 0.3) tn = 3
              set(x, ay + y, pineTones[tn])
            }
          }
        }
      }),
    )
  }

  const gray = STONE.tones.map((c) => col(c))
  const stone = (
    [
      [13, 10],
      [9, 7],
    ] as const
  ).map(([w, h]) =>
    makeSprite(w, h, { line: col(STONE.line), shadow: [w / 2, h - 2, w / 2 - 1, 1.6], shadowColor, ay: h - 2 }, (set) => {
      ellipse(set, w / 2, h / 2 - 0.5, w / 2 - 1.5, h / 2 - 2, (x, y) => {
        const l = 0.5 - ((x - w / 2) / w + (y - h / 2) / h) * 1.5
        return gray[l < 0.25 ? 0 : l < 0.55 ? 1 : l < 0.9 ? 2 : 3]
      })
    }),
  )

  const small: Sprite[] = []
  // пень
  small.push(
    makeSprite(12, 11, { line: bark[0], shadow: [6, 8.5, 5, 1.8], shadowColor, ay: 9 }, (set) => {
      for (let y = 4; y <= 8; y++) for (let x = 2; x <= 9; x++) set(x, y, bark[x < 4 ? 2 : x > 7 ? 0 : 1])
      ellipse(set, 6, 4, 4, 2, (_x, _y, d) =>
        col(snowy ? (d < 0.5 ? '#ffffff' : '#d6e2ea') : d < 0.25 ? '#a87a40' : '#c89a5a'),
      )
    }),
  )
  if (T.extra === 'pumpkin') {
    const pump = ['#b8501a', '#e07a1e', '#f5a23a'].map((c) => col(c))
    small.push(
      makeSprite(11, 10, { line: col('#6e2a0e'), shadow: [5.5, 8, 4.5, 1.5], shadowColor, ay: 8 }, (set) => {
        ellipse(set, 5.5, 5.5, 4, 3, (x, y) => pump[x === 3 || x === 7 ? 0 : x < 5 && y < 6 ? 2 : 1])
        set(5, 1, col('#4a6a2a'))
        set(5, 2, col('#4a6a2a'))
      }),
    )
  } else if (T.extra === 'flower') {
    // ромашка
    small.push(
      makeSprite(9, 11, { line: col('#2c5a26'), ay: 9 }, (set) => {
        for (let y = 5; y <= 9; y++) set(4, y, col('#4a9a3c'))
        set(3, 7, col('#6cbc4a'))
        set(5, 8, col('#6cbc4a'))
        for (const [x, y] of [[4, 2], [3, 3], [5, 3], [4, 4], [3, 2], [5, 4]]) set(x, y, col('#fff6dc'))
        set(4, 3, col('#f2c14e'))
      }),
    )
  }
  if (snowy) {
    // сугробы вместо тыкв и грибов
    for (const [w, h] of [[15, 8], [10, 6]] as const) {
      small.push(
        makeSprite(w, h, { line: col('#8fa6bc'), ay: h - 2 }, (set) => {
          ellipse(set, w / 2, h / 2 + 0.5, w / 2 - 1.5, h / 2 - 1.5, (x, y) =>
            col(y < h / 2 ? '#ffffff' : x > w / 2 ? '#c4d2de' : '#e6eef4'),
          )
        }),
      )
    }
  } else {
    small.push(
      makeSprite(9, 10, { line: col('#5e1512'), shadow: [4.5, 8, 3, 1.2], shadowColor, ay: 8 }, (set) => {
        for (let y = 5; y <= 7; y++) {
          set(4, y, col('#f0e0c0'))
          set(5, y, col('#d8c4a0'))
        }
        for (let y = 2; y <= 4; y++) {
          for (let x = y === 2 ? 3 : 2; x <= (y === 2 ? 5 : 6); x++) set(x, y, col(x < 4 ? '#e2583a' : '#c23a26'))
        }
        set(3, 3, col('#fff4e0'))
        set(5, 4, col('#fff4e0'))
      }),
    )
  }

  // камыш: три стебля с бурыми початками
  const reedCol = T.reed.map((c) => col(c))
  const head = col('#6e4220')
  const reed: Sprite[] = []
  for (let v = 0; v < 3; v++) {
    reed.push(
      makeSprite(12, 18, { ay: 16 }, (set) => {
        const stems = [[2, 6 + v], [5, 3], [9, 5 + ((v * 2) % 3)]]
        stems.forEach(([x, top], i) => {
          for (let y = top; y <= 16; y++) set(x, y, reedCol[i === 1 ? 1 : 0])
          for (let y = top; y < top + 4; y++) {
            set(x, y, head)
            if (i === 1) set(x + 1, y, col('#8a5a2c'))
          }
          set(x, top - 1, reedCol[1])
        })
        for (let k = 0; k < 5; k++) {
          set(6 + k, 15 - k * 2, reedCol[1])
          set(4 - (k >> 1), 14 - k, reedCol[0])
        }
      }),
    )
  }

  // кувшинка
  let lily: Sprite[] | null = null
  if (T.lily) {
    lily = []
    for (let v = 0; v < 2; v++) {
      lily.push(
        makeSprite(9, 6, { ay: 3 }, (set) => {
          ellipse(set, 4.5, 3, 4, 2.4, (x, y) => (x === 4 && y < 3 ? 0 : col(y < 3 ? '#62a85a' : '#3c8a48')))
          if (v) {
            set(5, 2, col('#f5a0c0'))
            set(6, 2, col('#fff0f6'))
            set(5, 3, col('#e07aa8'))
          }
        }),
      )
    }
  }

  const w = T.water
  const water: WaterColors = {
    deep: col(w.deep),
    mid: col(w.mid),
    lit: col(w.lit),
    bank: col(w.bank),
    dash: col(w.dash),
    shore: col(w.shore[0], w.shore[1]),
  }

  return { tree, pine, bush, stone, small, reed, lily, water }
}
