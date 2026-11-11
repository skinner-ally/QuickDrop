import { afterEach, describe, expect, it, vi } from 'vitest'
import { newId } from './id'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('newId', () => {
  afterEach(() => vi.restoreAllMocks())

  it('даёт UUID v4', () => {
    expect(newId()).toMatch(UUID_V4)
  })

  it('работает без crypto.randomUUID (http в локальной сети)', () => {
    vi.spyOn(crypto, 'randomUUID').mockImplementation(undefined as never)
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true, writable: true })
    const a = newId()
    const b = newId()
    expect(a).toMatch(UUID_V4)
    expect(a).not.toBe(b)
  })
})
