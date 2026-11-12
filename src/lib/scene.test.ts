import code from '../../public/theme-init.js?raw'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/types'
import {
  FONT_LABEL,
  FONT_PREFS,
  SCENE_LABEL,
  SCENE_PREFS,
  THEME_COLOR,
  isFontPref,
  isPixelScene,
  isScenePref,
  resolveScene,
  sceneClasses,
  seasonScene,
} from './scene'
import type { Scene } from './scene'

/** Локальная дата: месяц с 1, как в календаре. */
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12)

describe('seasonScene', () => {
  it('границы времён года', () => {
    expect(seasonScene(day(2026, 11, 30))).toBe('autumn')
    expect(seasonScene(day(2026, 12, 1))).toBe('winter')
    expect(seasonScene(day(2027, 2, 28))).toBe('winter')
    expect(seasonScene(day(2028, 2, 29))).toBe('winter')
    expect(seasonScene(day(2027, 3, 1))).toBe('meadow')
    expect(seasonScene(day(2027, 8, 31))).toBe('meadow')
    expect(seasonScene(day(2027, 9, 1))).toBe('autumn')
  })

  it('каждый месяц относится к своему времени года', () => {
    const byMonth = Array.from({ length: 12 }, (_, i) => seasonScene(new Date(2026, i, 15)))
    expect(byMonth).toEqual([
      'winter', 'winter',
      'meadow', 'meadow', 'meadow', 'meadow', 'meadow', 'meadow',
      'autumn', 'autumn', 'autumn',
      'winter',
    ])
  })

  it('считает по локальной дате, а не по UTC', () => {
    // последняя минута ноября и первая минута декабря по местному времени
    expect(seasonScene(new Date(2026, 10, 30, 23, 59))).toBe('autumn')
    expect(seasonScene(new Date(2026, 11, 1, 0, 0))).toBe('winter')
  })

  it('без аргумента берёт текущую дату', () => {
    expect(seasonScene()).toBe(seasonScene(new Date()))
  })
})

describe('resolveScene', () => {
  it('auto — по календарю', () => {
    expect(resolveScene('auto', day(2026, 11, 11))).toBe('autumn')
    expect(resolveScene('auto', day(2026, 1, 10))).toBe('winter')
    expect(resolveScene('auto', day(2026, 6, 10))).toBe('meadow')
    expect(resolveScene('auto')).toBe(seasonScene())
  })

  it('явный выбор не зависит от даты', () => {
    const winter = day(2026, 1, 10)
    expect(resolveScene('meadow', winter)).toBe('meadow')
    expect(resolveScene('autumn', winter)).toBe('autumn')
    expect(resolveScene('paper', winter)).toBe('paper')
    expect(resolveScene('winter', day(2026, 7, 1))).toBe('winter')
    expect(resolveScene('classic', winter)).toBe('classic')
  })

  it('auto никогда не даёт «Бумагу» и «Классику»', () => {
    for (let m = 0; m < 12; m++) {
      expect(['meadow', 'autumn', 'winter']).toContain(resolveScene('auto', new Date(2026, m, 1)))
    }
  })
})

describe('охранные функции', () => {
  it('isScenePref принимает только значения списка', () => {
    for (const v of SCENE_PREFS) expect(isScenePref(v)).toBe(true)
    for (const v of ['neon', '', 'Autumn', 'sc-autumn', 'round', null, undefined, 1, {}, ['auto']]) {
      expect(isScenePref(v)).toBe(false)
    }
  })

  it('isFontPref принимает только значения списка', () => {
    for (const v of FONT_PREFS) expect(isFontPref(v)).toBe(true)
    for (const v of ['neon', '', 'Round', 'ft-round', 'auto', null, undefined, 1, {}, ['round']]) {
      expect(isFontPref(v)).toBe(false)
    }
  })

  it('значения по умолчанию проходят проверку', () => {
    expect(isScenePref(DEFAULT_SETTINGS.scene)).toBe(true)
    expect(isFontPref(DEFAULT_SETTINGS.font)).toBe(true)
  })
})

describe('sceneClasses', () => {
  it('пиксельная сцена: сцена, pixel, шрифт', () => {
    expect(sceneClasses('autumn', 'round')).toEqual(['sc-autumn', 'pixel', 'ft-round'])
    expect(sceneClasses('winter', 'pixel')).toEqual(['sc-winter', 'pixel', 'ft-pixel'])
  })

  it('«Классика»: без pixel', () => {
    expect(sceneClasses('classic', 'round')).toEqual(['sc-classic', 'ft-round'])
    expect(sceneClasses('classic', 'soft')).toEqual(['sc-classic', 'ft-soft'])
  })

  it('для любой пары ровно один sc-* и один ft-*, pixel ⇔ сцена не classic', () => {
    const scenes = SCENE_PREFS.filter((s): s is Scene => s !== 'auto')
    for (const scene of scenes) {
      for (const font of FONT_PREFS) {
        const cls = sceneClasses(scene, font)
        expect(cls.filter((c) => c.startsWith('sc-'))).toEqual([`sc-${scene}`])
        expect(cls.filter((c) => c.startsWith('ft-'))).toEqual([`ft-${font}`])
        expect(cls.includes('pixel')).toBe(scene !== 'classic')
        expect(isPixelScene(scene)).toBe(scene !== 'classic')
      }
    }
  })
})

describe('подписи и цвета', () => {
  it('подпись есть у каждого значения', () => {
    expect(SCENE_PREFS.map((s) => SCENE_LABEL[s])).toEqual(['Авто', 'Луг', 'Осень', 'Бумага', 'Зима', 'Классика'])
    expect(FONT_PREFS.map((f) => FONT_LABEL[f])).toEqual(['Округлый', 'Строгий', 'Мягкий пиксель', 'Пиксельный'])
  })

  it('THEME_COLOR задан для каждой сцены, день и ночь', () => {
    const scenes = SCENE_PREFS.filter((s): s is Scene => s !== 'auto')
    expect(Object.keys(THEME_COLOR).sort()).toEqual([...scenes].sort())
    for (const scene of scenes) {
      expect(THEME_COLOR[scene].light).toMatch(/^#[0-9a-f]{6}$/i)
      expect(THEME_COLOR[scene].dark).toMatch(/^#[0-9a-f]{6}$/i)
    }
    expect(THEME_COLOR.classic).toEqual({ light: '#FBFAF8', dark: '#1a1816' })
    expect(THEME_COLOR.autumn).toEqual({ light: '#4a2416', dark: '#170f18' })
  })
})

describe('public/theme-init.js: theme-color до React', () => {
  function run(scene: string, theme: string) {
    const metas: Array<{ content?: string; name?: string; media?: string | null; removed?: boolean; removeAttribute(n: string): void; remove(): void }> = []
    const mk = () => {
      const m = {
        removed: false,
        media: 'x' as string | null,
        removeAttribute(n: string) {
          if (n === 'media') m.media = null
        },
        remove() {
          m.removed = true
        },
      } as (typeof metas)[number]
      return m
    }
    metas.push(mk(), mk())
    const doc = {
      documentElement: { classList: { add() {} }, style: {} },
      querySelectorAll: () => metas,
      createElement: mk,
      head: { appendChild() {} },
    }
    const store: Record<string, string> = { 'qd-scene': scene, 'qd-theme': theme }
    const win = { matchMedia: () => ({ matches: false }) }
    new Function('document', 'window', 'localStorage', code)(doc, win, { getItem: (k: string) => store[k] ?? null })
    return metas
  }

  it('цвет совпадает с THEME_COLOR, лишний meta убран, media снят', () => {
    for (const scene of Object.keys(THEME_COLOR) as Scene[]) {
      for (const theme of ['light', 'dark'] as const) {
        const [first, second] = run(scene, theme)
        expect(first.content).toBe(THEME_COLOR[scene][theme])
        expect(first.media).toBeNull()
        expect(second.removed).toBe(true)
      }
    }
  })
})
