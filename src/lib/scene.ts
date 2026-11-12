import { FONT_PREFS, SCENE_PREFS } from '@/types'
import type { FontPref, ScenePref } from '@/types'

export type Scene = Exclude<ScenePref, 'auto'>

// Списки значений объявлены один раз — в src/types.ts; здесь только реэкспорт.
export { SCENE_PREFS, FONT_PREFS } from '@/types'

export const SCENE_LABEL: Record<ScenePref, string> = {
  auto: 'Авто',
  meadow: 'Луг',
  autumn: 'Осень',
  paper: 'Бумага',
  winter: 'Зима',
  classic: 'Классика',
}

export const FONT_LABEL: Record<FontPref, string> = {
  round: 'Округлый',
  plain: 'Строгий',
  soft: 'Мягкий пиксель',
  pixel: 'Пиксельный',
}

export function isScenePref(v: unknown): v is ScenePref {
  return typeof v === 'string' && (SCENE_PREFS as readonly string[]).includes(v)
}

export function isFontPref(v: unknown): v is FontPref {
  return typeof v === 'string' && (FONT_PREFS as readonly string[]).includes(v)
}

/** Декабрь–февраль — winter, сентябрь–ноябрь — autumn, иначе meadow (по локальной дате). */
export function seasonScene(d: Date = new Date()): 'meadow' | 'autumn' | 'winter' {
  const m = d.getMonth()
  if (m === 11 || m < 2) return 'winter'
  return m >= 8 ? 'autumn' : 'meadow'
}

export function resolveScene(pref: ScenePref, d?: Date): Scene {
  return pref === 'auto' ? seasonScene(d) : pref
}

export function isPixelScene(scene: Scene): boolean {
  return scene !== 'classic'
}

/** Классы для <html>: ['sc-autumn', 'pixel', 'ft-round'] / ['sc-classic', 'ft-round']. */
export function sceneClasses(scene: Scene, font: FontPref): string[] {
  return isPixelScene(scene) ? [`sc-${scene}`, 'pixel', `ft-${font}`] : [`sc-${scene}`, `ft-${font}`]
}

/** Цвет панели браузера/заголовка PWA: рама окна сцены (= --wood-dark; у «Классики» — фон). */
export const THEME_COLOR: Record<Scene, { light: string; dark: string }> = {
  classic: { light: '#FBFAF8', dark: '#1a1816' },
  meadow: { light: '#4a2e1a', dark: '#14111d' },
  autumn: { light: '#4a2416', dark: '#170f18' },
  paper: { light: '#5a4630', dark: '#0f0f16' },
  winter: { light: '#3a3440', dark: '#0e1220' },
}
