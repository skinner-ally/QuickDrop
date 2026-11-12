import { describe, expect, it } from 'vitest'
import { isUnfinishedDate } from './periodInput'

describe('isUnfinishedDate', () => {
  it('год набран не до конца', () => {
    expect(isUnfinishedDate('0002-11-10')).toBe(true)
    expect(isUnfinishedDate('0202-11-10')).toBe(true)
  })
  it('законченные и пустые значения', () => {
    expect(isUnfinishedDate('2026-11-10')).toBe(false)
    expect(isUnfinishedDate('1970-01-01')).toBe(false)
    expect(isUnfinishedDate('')).toBe(false)
  })
})
