/**
 * Кэш плиток живого фона (spec-stage6 §4.5): LRU с пределом по пикселям решётки. Поверхность плитки (canvas) —
 * внешний ресурс: кэш отдаёт её release ровно один раз, когда вытесняет или очищает запись. Записи текущего кадра
 * не вытесняются, даже если предел превышен: видимые плитки важнее предела (он догонит на следующем кадре).
 */

export interface TileEntry<S> {
  key: string
  surface: S
  /** size·size. */
  pixels: number
  /** tileSignature на момент отрисовки. */
  sig: number
  /** Ревизия полян, на которой sig проверена. */
  rev: number
  /** Номер кадра последнего использования. */
  used: number
}

export interface TileStore<S> {
  /** Запись по ключу; помечает used = frame. */
  get: (key: string, frame: number) => TileEntry<S> | undefined
  /** Запись по ключу без пометки used: trim вытесняет её как прежде. */
  peek: (key: string) => TileEntry<S> | undefined
  /**
   * Кладёт запись. Если ключ уже был — прежняя поверхность возвращается вызывающему (он решает: растворение или
   * release); release для неё не вызывается. Та же самая поверхность не возвращается (её нельзя освобождать).
   */
  put: (entry: Omit<TileEntry<S>, 'used'>, frame: number) => S | undefined
  /** Вытесняет давно не использованные, пока pixels > maxPixels. Записи с used === frame не трогает. */
  trim: (frame: number) => void
  /** release всех. */
  clear: () => void
  readonly size: number
  readonly pixels: number
}

export function createTileStore<S>(opts: { maxPixels: number; release: (s: S) => void }): TileStore<S> {
  const { maxPixels, release } = opts
  // Map хранит порядок вставки: при равных used раньше вытесняется положенная раньше.
  const map = new Map<string, TileEntry<S>>()
  let pixels = 0

  const pixelsOf = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0)

  const get = (key: string, frame: number): TileEntry<S> | undefined => {
    const e = map.get(key)
    if (e) e.used = frame
    return e
  }

  const peek = (key: string): TileEntry<S> | undefined => map.get(key)

  const put = (entry: Omit<TileEntry<S>, 'used'>, frame: number): S | undefined => {
    const next: TileEntry<S> = {
      key: entry.key,
      surface: entry.surface,
      pixels: pixelsOf(entry.pixels),
      sig: entry.sig,
      rev: entry.rev,
      used: frame,
    }
    const prev = map.get(entry.key)
    if (prev) {
      pixels -= prev.pixels
      map.delete(entry.key)
    }
    map.set(entry.key, next)
    pixels += next.pixels
    return prev && prev.surface !== next.surface ? prev.surface : undefined
  }

  const trim = (frame: number): void => {
    if (pixels <= maxPixels) return
    const old = [...map.values()].filter((e) => e.used !== frame).sort((a, b) => a.used - b.used)
    for (const e of old) {
      if (pixels <= maxPixels) break
      // Сначала убрать из кэша: если release бросит, запись уже не освободится второй раз.
      map.delete(e.key)
      pixels -= e.pixels
      release(e.surface)
    }
  }

  const clear = (): void => {
    const all = [...map.values()]
    map.clear()
    pixels = 0
    for (const e of all) release(e.surface)
  }

  return {
    get,
    peek,
    put,
    trim,
    clear,
    get size() {
      return map.size
    },
    get pixels() {
      return pixels
    },
  }
}
