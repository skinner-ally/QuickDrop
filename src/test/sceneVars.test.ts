import { describe, expect, it } from 'vitest'
import { AMBIENT_OVERLAY_MAX, AMBIENT_SCENES } from '@/lib/ambient/types'
import {
  contrast,
  luminance,
  overlay,
  parseRootBlocks,
  readSceneCss,
  SCENE_VARIANTS,
  sceneVars,
} from '@/test/sceneVars'

/** --ground из src/styles/scenes.css (менять вместе с файлом). */
const GROUND: Record<string, string> = {
  'meadow:day': '#86ab5e',
  'meadow:night': '#1f3038',
  'autumn:day': '#c2a55e',
  'autumn:night': '#2c2132',
  'paper:day': '#eadbb4',
  'paper:night': '#23232f',
  'winter:day': '#dde7ee',
  'winter:night': '#1c2740',
}

describe('sceneVars: разбор scenes.css', () => {
  const blocks = readSceneCss()

  it('восемь вариантов: все сцены × день/ночь, имена и классы', () => {
    expect(SCENE_VARIANTS).toHaveLength(8)
    for (const scene of AMBIENT_SCENES) {
      const both = SCENE_VARIANTS.filter((v) => v.scene === scene)
      expect(both.map((v) => v.dark).sort()).toEqual([false, true])
      for (const v of both) {
        expect(v.classes).toContain('pixel')
        expect(v.classes).toContain(`sc-${scene}`)
        expect(v.classes.includes('dark')).toBe(v.dark)
        expect(v.name.length).toBeGreaterThan(0)
      }
    }
    expect(new Set(SCENE_VARIANTS.map((v) => v.name)).size).toBe(8)
  })

  for (const v of SCENE_VARIANTS) {
    it(`--ground: ${v.name}`, () => {
      const get = sceneVars(blocks, v.classes)
      const want = GROUND[`${v.scene}:${v.dark ? 'night' : 'day'}`]
      expect(get('--ground')).toBe(want)
      // земля графа — та же переменная через var()
      expect(get('--graph-bg')).toBe(want)
    })
  }

  it('каскад: более специфичный блок сильнее, :is() учитывается', () => {
    const b = parseRootBlocks(`
      :root.a { --x: #111111; --y: var(--x); }
      /* комментарий { --x: #ffffff; } */
      :root.a.b { --x: #222222; }
      :root.a:is(.c, .d) { --x: #333333; }
    `)
    expect(sceneVars(b, ['a'])('--y')).toBe('#111111')
    expect(sceneVars(b, ['a', 'b'])('--y')).toBe('#222222')
    expect(sceneVars(b, ['a', 'd'])('--x')).toBe('#333333')
    expect(() => sceneVars(b, ['a'])('--nope')).toThrow()
  })
})

describe('контраст и заливка', () => {
  it('overlay: чёрный под белым 0.2 → #333333', () => {
    expect(overlay('#000000', { r: 255, g: 255, b: 255, alpha: 0.2 })).toBe('#333333')
    expect(overlay('#000000', AMBIENT_OVERLAY_MAX)).toBe('#333333')
    expect(overlay('#123456', { r: 0, g: 0, b: 0, alpha: 0 })).toBe('#123456')
    expect(overlay('#fff', { r: 0, g: 0, b: 0, alpha: 1 })).toBe('#000000')
  })

  it('luminance и contrast по WCAG', () => {
    expect(luminance('#000000')).toBe(0)
    expect(luminance('#ffffff')).toBeCloseTo(1, 10)
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 6)
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 6)
    expect(contrast('#86ab5e', '#86ab5e')).toBe(1)
  })
})
