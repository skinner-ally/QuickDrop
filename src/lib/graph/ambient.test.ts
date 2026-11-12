import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getAmbientLayer,
  requestAmbientFrame,
  setAmbientLayer,
  subscribeAmbient,
} from '@/lib/graph/ambient'
import type { AmbientLayer, AmbientStats, AmbientWake } from '@/lib/graph/ambient'

describe('ambient: причина пробуждения хоста', () => {
  afterEach(() => setAmbientLayer(null))

  it('setAmbientLayer зовёт подписчиков с "layer", requestAmbientFrame — с "frame"', () => {
    const got: AmbientWake[] = []
    const off = subscribeAmbient((kind) => got.push(kind))
    const layer: AmbientLayer = { draw: () => {} }
    setAmbientLayer(layer)
    requestAmbientFrame()
    setAmbientLayer(layer) // тот же слой — не будит
    setAmbientLayer(null)
    requestAmbientFrame()
    off()
    requestAmbientFrame()
    expect(got).toEqual(['layer', 'frame', 'layer', 'frame'])
  })

  it('подписчик без параметра работает (контракт этапа 5)', () => {
    let calls = 0
    const legacy: () => void = () => {
      calls++
    }
    const off = subscribeAmbient(legacy)
    requestAmbientFrame()
    setAmbientLayer({ draw: () => {} })
    expect(calls).toBe(2)
    off()
  })

  it('requestAmbientFrame и setAmbientLayer без подписчиков не бросают', () => {
    expect(() => requestAmbientFrame()).not.toThrow()
    expect(() => setAmbientLayer({ draw: () => {} })).not.toThrow()
    expect(getAmbientLayer()).not.toBeNull()
  })

  it('несколько подписчиков получают одну и ту же причину; отписка изнутри вызова безопасна', () => {
    const a = vi.fn()
    const offSelf = subscribeAmbient(() => offSelf())
    const offA = subscribeAmbient(a)
    requestAmbientFrame()
    setAmbientLayer({ draw: () => {} })
    expect(a.mock.calls).toEqual([['frame'], ['layer']])
    offA()
  })

  it('слой может отдавать stats (необязательно)', () => {
    const stats: AmbientStats = { tiles: 3, tilePixels: 3 * 512 * 512, rendered: 5, ticks: 0 }
    const layer: AmbientLayer = { draw: () => {}, stats: () => stats }
    setAmbientLayer(layer)
    expect(getAmbientLayer()?.stats?.()).toEqual(stats)
    const plain: AmbientLayer = { draw: () => {} }
    expect(plain.stats).toBeUndefined()
  })
})
