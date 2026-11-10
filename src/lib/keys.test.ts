import { describe, expect, it } from 'vitest'
import { matchKey } from './keys'

describe('matchKey', () => {
  it('сравнивает по e.code, игнорируя раскладку', () => {
    expect(matchKey({ code: 'KeyN', key: 'т' }, 'KeyN', 'n')).toBe(true)
    expect(matchKey({ code: 'KeyM', key: 'n' }, 'KeyN', 'n')).toBe(false)
  })
  it('при пустом e.code использует e.key без учёта регистра', () => {
    expect(matchKey({ code: '', key: 'N' }, 'KeyN', 'n')).toBe(true)
    expect(matchKey({ code: '', key: 'x' }, 'KeyN', 'n')).toBe(false)
  })
  it('без запасного ключа при пустом e.code не совпадает', () => {
    expect(matchKey({ code: '', key: 'n' }, 'KeyN')).toBe(false)
  })
})
