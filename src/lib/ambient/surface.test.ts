import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCanvasSurface } from '@/lib/ambient/surface'

/** Canvas без контекста (среда node): события и размер — как у настоящего. */
class FakeCanvas extends EventTarget {
  width = 300
  height = 150
  getContext() {
    return null
  }
}

describe('createCanvasSurface: восстановление контекста', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('contextrestored зовёт onRestored; contextlost — нет; после release — тишина', () => {
    const made: FakeCanvas[] = []
    vi.stubGlobal('document', {
      createElement: () => {
        const c = new FakeCanvas()
        made.push(c)
        return c
      },
    })
    const onRestored = vi.fn()
    const s = createCanvasSurface(512, 512, onRestored)
    const c = made[0]
    expect(s.source).toBe(c)
    expect([c.width, c.height]).toEqual([512, 512])
    c.dispatchEvent(new Event('contextlost'))
    expect(onRestored).not.toHaveBeenCalled()
    c.dispatchEvent(new Event('contextrestored'))
    expect(onRestored).toHaveBeenCalledTimes(1)
    s.release()
    expect([c.width, c.height]).toEqual([0, 0])
    c.dispatchEvent(new Event('contextrestored'))
    expect(onRestored).toHaveBeenCalledTimes(1)
    // Без обработчика и без контекста — put ничего не делает и не бросает.
    const t = createCanvasSurface(4, 4)
    expect(() => t.put(new Uint32Array(16))).not.toThrow()
  })
})
