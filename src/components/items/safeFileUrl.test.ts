import { describe, expect, it } from 'vitest'
import { classifyBlobType } from './safeFileUrl'

describe('classifyBlobType', () => {
  it('пропускает растр и PDF', () => {
    expect(classifyBlobType('image/png')).toBe('raster')
    expect(classifyBlobType('image/jpeg; charset=x')).toBe('raster')
    expect(classifyBlobType('application/pdf')).toBe('pdf')
    expect(classifyBlobType('APPLICATION/PDF')).toBe('pdf')
  })
  it('SVG отделяет, а исполняемые типы считает чужими', () => {
    expect(classifyBlobType('image/svg+xml')).toBe('svg')
    expect(classifyBlobType('text/html')).toBe('other')
    expect(classifyBlobType('application/xhtml+xml')).toBe('other')
    expect(classifyBlobType('')).toBe('other')
  })
})
