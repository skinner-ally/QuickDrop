/** Строки одинаковой длины; '.' — пусто; '#' — currentColor; буква — цвет из PALETTE. Сетка 8×8 или 10×10. */
export type PixelMap = readonly string[]

export interface CompiledIcon {
  grid: 8 | 10
  layers: ReadonlyArray<{ fill: string; d: string }>
}

/** Карта → по одному path на цвет; горизонтальные отрезки одного цвета склеены. */
export function compileIcon(map: PixelMap, palette: Readonly<Record<string, string>>): CompiledIcon {
  const grid = map.length
  if (grid !== 8 && grid !== 10) throw new Error(`Значок: сетка ${grid}, допустимо 8 или 10`)

  // Map хранит порядок вставки — это и есть порядок первого появления цвета
  const paths = new Map<string, string>()
  map.forEach((row, y) => {
    if (row.length !== grid) throw new Error(`Значок: строка ${y} длиной ${row.length}, ожидалось ${grid}`)
    for (let x = 0; x < grid; x++) {
      const ch = row[x]
      if (ch === '.') continue
      if (!Object.hasOwn(palette, ch)) throw new Error(`Значок: символа «${ch}» нет в палитре`)
      let end = x
      while (end + 1 < grid && row[end + 1] === ch) end++
      const w = end - x + 1
      paths.set(ch, `${paths.get(ch) ?? ''}M${x} ${y}h${w}v1h-${w}z`)
      x = end
    }
  })

  return { grid, layers: [...paths].map(([ch, d]) => ({ fill: palette[ch], d })) }
}

/** Размер, кратный сетке: клетка значка — целое число пикселей экрана, не меньше 2. */
export function snapIconSize(grid: 8 | 10, size?: number): number {
  return Math.max(2, Math.floor((size ?? 16) / grid)) * grid
}
