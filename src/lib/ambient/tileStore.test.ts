import { describe, expect, it } from 'vitest'
import { createTileStore } from '@/lib/ambient/tileStore'
import type { TileStore } from '@/lib/ambient/tileStore'

interface Surf {
  id: string
}

function setup(maxPixels: number) {
  const released: string[] = []
  const store = createTileStore<Surf>({ maxPixels, release: (s) => released.push(s.id) })
  const add = (key: string, pixels: number, frame: number, id = key) =>
    store.put({ key, surface: { id }, pixels, sig: 0, rev: 0 }, frame)
  return { store, released, add }
}

/** Сумма пикселей и число записей по ключам — сверка с size и pixels. */
function consistent(store: TileStore<Surf>, keys: string[], frame: number, pixelsOf: (k: string) => number) {
  let n = 0
  let px = 0
  for (const k of keys) {
    const e = store.get(k, frame)
    if (e) {
      n++
      px += e.pixels
      expect(e.pixels).toBe(pixelsOf(k))
    }
  }
  expect(store.size).toBe(n)
  expect(store.pixels).toBe(px)
}

describe('tileStore', () => {
  it('get помечает used и отдаёт ту же запись', () => {
    const { store, add } = setup(100)
    expect(store.get('a', 1)).toBeUndefined()
    add('a', 10, 1)
    const e = store.get('a', 5)!
    expect(e.used).toBe(5)
    expect(e.surface.id).toBe('a')
    // Запись изменяема: движок пишет в неё rev.
    e.rev = 7
    expect(store.get('a', 6)!.rev).toBe(7)
  })

  it('вытесняет самые старые по used, пока pixels > maxPixels', () => {
    const { store, released, add } = setup(30)
    add('a', 10, 1)
    add('b', 10, 2)
    add('c', 10, 3)
    add('d', 10, 4)
    // a стала свежей; старейшая — b, затем c.
    store.get('a', 5)
    add('e', 10, 6)
    store.trim(6)
    expect(released).toEqual(['b', 'c'])
    expect(store.size).toBe(3)
    expect(store.pixels).toBe(30)
    expect(store.get('b', 7)).toBeUndefined()
    expect(store.get('c', 7)).toBeUndefined()
    expect(store.get('a', 7)).toBeDefined()
    expect(store.get('d', 7)).toBeDefined()
    expect(store.get('e', 7)).toBeDefined()
  })

  it('при равных used раньше уходит положенная раньше', () => {
    const { store, released, add } = setup(10)
    add('x', 10, 1)
    add('y', 10, 1)
    add('z', 10, 1)
    store.trim(2)
    expect(released).toEqual(['x', 'y'])
  })

  it('записи текущего кадра не вытесняются, даже если сумма больше предела', () => {
    const { store, released, add } = setup(15)
    add('a', 10, 1)
    add('b', 10, 2)
    add('c', 10, 2)
    store.trim(2)
    // Вытеснена только a; b и c — текущий кадр, предел превышен.
    expect(released).toEqual(['a'])
    expect(store.pixels).toBe(20)
    expect(store.size).toBe(2)
    // На следующем кадре предел догоняет (b и c не использовались в кадре 3).
    store.get('c', 3)
    store.trim(3)
    expect(released).toEqual(['a', 'b'])
    expect(store.pixels).toBe(10)
  })

  it('trim в пределах — ничего не трогает', () => {
    const { store, released, add } = setup(100)
    add('a', 40, 1)
    add('b', 60, 1)
    store.trim(9)
    expect(released).toEqual([])
    expect(store.size).toBe(2)
    expect(store.pixels).toBe(100)
  })

  it('release ровно один раз на вытесненную запись', () => {
    const { store, released, add } = setup(20)
    for (let f = 1; f <= 50; f++) {
      add(`t${f}`, 10, f)
      store.trim(f)
    }
    // Повторные trim и clear не освобождают уже освобождённое.
    store.trim(51)
    store.trim(51)
    store.clear()
    store.clear()
    expect(released.length).toBe(50)
    expect(new Set(released).size).toBe(50)
  })

  it('put на существующий ключ не вызывает release и возвращает старую поверхность', () => {
    const { store, released, add } = setup(100)
    expect(add('a', 10, 1, 'a1')).toBeUndefined()
    const old = add('a', 16, 2, 'a2')
    expect(old).toEqual({ id: 'a1' })
    expect(released).toEqual([])
    expect(store.size).toBe(1)
    expect(store.pixels).toBe(16)
    const e = store.get('a', 3)!
    expect(e.surface.id).toBe('a2')
    expect(e.used).toBe(3)
    // Старая поверхность больше не в кэше: clear освобождает только новую.
    store.clear()
    expect(released).toEqual(['a2'])
  })

  it('put той же поверхности под тем же ключом её не возвращает', () => {
    const released: Surf[] = []
    const store = createTileStore<Surf>({ maxPixels: 100, release: (s) => released.push(s) })
    const s = { id: 's' }
    store.put({ key: 'k', surface: s, pixels: 10, sig: 1, rev: 0 }, 1)
    expect(store.put({ key: 'k', surface: s, pixels: 10, sig: 2, rev: 1 }, 2)).toBeUndefined()
    expect(store.get('k', 3)!.sig).toBe(2)
    expect(released).toEqual([])
  })

  it('put обновляет used: обновлённая запись не старейшая', () => {
    const { store, released, add } = setup(20)
    add('a', 10, 1)
    add('b', 10, 2)
    add('a', 10, 3)
    add('c', 10, 4)
    store.trim(4)
    expect(released).toEqual(['b'])
  })

  it('clear освобождает все и обнуляет счётчики', () => {
    const { store, released, add } = setup(1000)
    add('a', 10, 1)
    add('b', 20, 1)
    add('c', 30, 2)
    store.clear()
    expect(released.sort()).toEqual(['a', 'b', 'c'])
    expect(store.size).toBe(0)
    expect(store.pixels).toBe(0)
    expect(store.get('a', 3)).toBeUndefined()
    // После clear кэш снова работает.
    add('d', 5, 4)
    expect(store.size).toBe(1)
    expect(store.pixels).toBe(5)
  })

  it('pixels и size согласованы после смешанной последовательности операций', () => {
    const { store, released, add } = setup(200)
    const sizes = new Map<string, number>()
    const keys = Array.from({ length: 12 }, (_, i) => `k${i}`)
    // Детерминированная «случайность».
    let seed = 12345
    const rnd = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
      return seed / 4294967296
    }
    const live = new Set<string>()
    const surfaces = new Map<string, string>()
    let n = 0
    for (let f = 1; f <= 400; f++) {
      const op = rnd()
      const k = keys[Math.floor(rnd() * keys.length)]
      if (op < 0.5) {
        const px = 10 + Math.floor(rnd() * 50)
        const id = `s${n++}`
        const prev = add(k, px, f, id)
        if (live.has(k)) {
          expect(prev?.id).toBe(surfaces.get(k))
          // Вызывающий сам освобождает возвращённую поверхность — в счёт release кэша она не входит.
        } else expect(prev).toBeUndefined()
        live.add(k)
        sizes.set(k, px)
        surfaces.set(k, id)
      } else if (op < 0.8) {
        store.get(k, f)
      } else if (op < 0.97) {
        store.trim(f)
      } else {
        store.clear()
      }
      // Обновить «живые» по факту кэша (без get, чтобы не трогать used).
      for (const key of [...live]) {
        const id = surfaces.get(key)!
        if (released.includes(id)) live.delete(key)
      }
      expect(store.size).toBe(live.size)
      let px = 0
      for (const key of live) px += sizes.get(key)!
      expect(store.pixels).toBe(px)
    }
    // Каждая поверхность освобождена не больше одного раза.
    expect(new Set(released).size).toBe(released.length)
    consistent(store, keys, 1000, (k) => sizes.get(k)!)
  })

  it('peek не помечает used: просмотренная в текущем кадре запись вытесняется', () => {
    const { store, released, add } = setup(20)
    add('a', 10, 1)
    add('b', 10, 1)
    expect(store.peek('a')?.used).toBe(1)
    expect(store.peek('zz')).toBeUndefined()
    add('c', 10, 2)
    store.get('b', 2)
    store.peek('a')
    store.trim(2)
    expect(released).toEqual(['a'])
    expect(store.peek('a')).toBeUndefined()
  })

  it('негодное число пикселей считается нулём', () => {
    const { store, add } = setup(10)
    add('a', Number.NaN, 1)
    add('b', -5, 1)
    expect(store.pixels).toBe(0)
    expect(store.size).toBe(2)
  })
})
