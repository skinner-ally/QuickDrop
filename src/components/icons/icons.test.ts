import { describe, expect, it } from 'vitest'
import { compileIcon, snapIconSize, type PixelMap } from './compile'
import { ICON_NAMES, type IconName } from './names'
import { PIXEL_ICONS } from './pixel'
import { PALETTE } from './pixel/palette'
import { LUCIDE } from './registry'

const COLOR_NAMES: IconName[] = ['type-text', 'type-link', 'type-code', 'type-idea', 'type-file', 'type-image', 'sprout']

/** Псевдоним → значок, чью карту он повторяет. */
const ALIASES: Partial<Record<IconName, IconName>> = {
  sprout: 'type-idea',
  'book-marked': 'library',
  'folder-open': 'folder',
}

const sorted = (list: readonly string[]) => [...list].sort()

describe('реестр значков', () => {
  it('содержит 79 имён без повторов', () => {
    expect(ICON_NAMES).toHaveLength(79)
    expect(new Set(ICON_NAMES).size).toBe(79)
  })

  it('у каждого имени есть карта пикселей и значок lucide, лишних ключей нет', () => {
    expect(sorted(Object.keys(PIXEL_ICONS))).toEqual(sorted(ICON_NAMES))
    expect(sorted(Object.keys(LUCIDE))).toEqual(sorted(ICON_NAMES))
    for (const name of ICON_NAMES) {
      expect(LUCIDE[name], name).toBeTruthy()
    }
  })
})

describe('карты пикселей', () => {
  it.each(ICON_NAMES)('%s: квадрат нужной сетки, символы из палитры, не пустая', (name) => {
    const map = PIXEL_ICONS[name]
    const grid = COLOR_NAMES.includes(name) ? 10 : 8
    expect(map).toHaveLength(grid)
    for (const row of map) {
      expect(row).toHaveLength(grid)
      for (const ch of row) {
        if (ch === '.') continue
        if (grid === 8) expect(ch, `${name}: служебный значок одноцветный`).toBe('#')
        else expect(Object.hasOwn(PALETTE, ch), `${name}: символ «${ch}»`).toBe(true)
      }
    }
    expect(map.join('').replaceAll('.', '').length).toBeGreaterThan(0)
    expect(() => compileIcon(map, PALETTE)).not.toThrow()
  })

  it('check и x вписаны в центральные 6×6', () => {
    for (const name of ['check', 'x'] as const) {
      const map = PIXEL_ICONS[name]
      expect(map[0], name).toBe('........')
      expect(map[7], name).toBe('........')
      for (const row of map) {
        expect(row[0], name).toBe('.')
        expect(row[7], name).toBe('.')
      }
    }
  })

  it('разные имена — разные карты, кроме трёх псевдонимов', () => {
    const byMap = new Map<string, IconName>()
    for (const name of ICON_NAMES) {
      if (ALIASES[name]) continue
      const key = PIXEL_ICONS[name].join('\n')
      expect(byMap.get(key), `${name} повторяет другой значок`).toBeUndefined()
      byMap.set(key, name)
    }
    for (const [alias, source] of Object.entries(ALIASES) as Array<[IconName, IconName]>) {
      expect(PIXEL_ICONS[alias], alias).toEqual(PIXEL_ICONS[source])
    }
  })

  it('loader меняется при повороте на 90°', () => {
    const map = PIXEL_ICONS.loader
    const rotated = map.map((_, y) => map.map((row) => row[y]).reverse().join(''))
    expect(rotated).not.toEqual(map)
    const twice = rotated.map((_, y) => rotated.map((row) => row[y]).reverse().join(''))
    expect(twice).not.toEqual(map)
  })
})

describe('compileIcon', () => {
  const palette = { '#': 'currentColor', a: 'red', b: 'blue' }
  const blank = '........'

  it('склеивает горизонтальные отрезки в один path на цвет', () => {
    const map: PixelMap = ['##.#....', blank, '...####.', blank, blank, blank, blank, '.......#']
    expect(compileIcon(map, palette)).toEqual({
      grid: 8,
      layers: [{ fill: 'currentColor', d: 'M0 0h2v1h-2zM3 0h1v1h-1zM3 2h4v1h-4zM7 7h1v1h-1z' }],
    })
  })

  it('слои идут в порядке первого появления цвета', () => {
    const empty = '..........'
    const map: PixelMap = ['bba.......', empty, '.aa.#.....', empty, empty, empty, empty, empty, empty, '.........b']
    expect(compileIcon(map, palette)).toEqual({
      grid: 10,
      layers: [
        { fill: 'blue', d: 'M0 0h2v1h-2zM9 9h1v1h-1z' },
        { fill: 'red', d: 'M2 0h1v1h-1zM1 2h2v1h-2z' },
        { fill: 'currentColor', d: 'M4 2h1v1h-1z' },
      ],
    })
  })

  it('пустая карта даёт значок без слоёв', () => {
    expect(compileIcon(Array<string>(8).fill(blank), palette)).toEqual({ grid: 8, layers: [] })
  })

  it('бросает на строках разной длины', () => {
    expect(() => compileIcon([blank, blank, blank, '.......', blank, blank, blank, blank], palette)).toThrow(Error)
  })

  it('бросает, если сетка не квадрат 8 или 10', () => {
    expect(() => compileIcon(Array<string>(9).fill('.........'), palette)).toThrow(Error)
    expect(() => compileIcon(Array<string>(8).fill('..........'), palette)).toThrow(Error)
    expect(() => compileIcon([], palette)).toThrow(Error)
  })

  it('бросает на символе вне палитры', () => {
    expect(() => compileIcon([blank, blank, '...z....', blank, blank, blank, blank, blank], palette)).toThrow(Error)
    expect(() => compileIcon([blank, blank, '...#....', blank, blank, blank, blank, blank], {})).toThrow(Error)
  })
})

describe('snapIconSize', () => {
  it.each([
    [8, undefined, 16],
    [8, 13, 16],
    [8, 16, 16],
    [8, 20, 16],
    [8, 23, 16],
    [8, 24, 24],
    [8, 32, 32],
    [8, 48, 48],
    [10, undefined, 20],
    [10, 16, 20],
    [10, 29, 20],
    [10, 30, 30],
    [10, 64, 60],
  ] as const)('сетка %i, размер %s → %i', (grid, size, expected) => {
    expect(snapIconSize(grid, size)).toBe(expected)
  })
})
