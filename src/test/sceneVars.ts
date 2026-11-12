/// <reference types="node" />
/**
 * Помощник тестов: разбор `src/styles/scenes.css` без DOM (каскад `:root…` блоков, раскрытие var()), контраст по
 * WCAG и цвет под полупрозрачной заливкой. Логика — копия из `lib/graph/theme.test.ts`.
 * Только для тестов: читает node:fs, из кода приложения не импортируется.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { AmbientScene } from '@/lib/ambient/types'

/** Блок `:root…{ --x: … }`: классы селектора, варианты `:is(...)`, специфичность (число классов), порядок, переменные. */
export interface RootBlock {
  classes: string[]
  alts: string[] | null
  spec: number
  order: number
  vars: Record<string, string>
}

export function parseRootBlocks(css: string): RootBlock[] {
  const out: RootBlock[] = []
  let order = 0
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/:root([^{]*)\{([^}]*)\}/g)) {
    const sel = m[1].trim()
    const is = sel.match(/:is\(([^)]*)\)/)
    const alts = is ? [...is[1].matchAll(/\.([\w-]+)/g)].map((x) => x[1]) : null
    const classes = [...sel.replace(/:is\([^)]*\)/, '').matchAll(/\.([\w-]+)/g)].map((x) => x[1])
    const vars: Record<string, string> = {}
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]] = d[2].trim()
    out.push({ classes, alts, spec: classes.length + (alts ? 1 : 0), order: order++, vars })
  }
  return out
}

/** Вычисленные переменные <html> с данными классами (каскад по специфичности и порядку, var() раскрывается). */
export function sceneVars(blocks: RootBlock[], classes: string[]): (name: string) => string {
  const set = new Set(classes)
  const merged: Record<string, string> = {}
  blocks
    .filter((b) => b.classes.every((c) => set.has(c)) && (!b.alts || b.alts.some((c) => set.has(c))))
    .sort((a, b) => a.spec - b.spec || a.order - b.order)
    .forEach((b) => Object.assign(merged, b.vars))
  const resolve = (name: string, depth = 0): string => {
    const v = merged[name]
    if (v === undefined || depth > 10) throw new Error(`нет переменной ${name} для ${classes.join(' ')}`)
    const ref = v.match(/^var\((--[\w-]+)\)$/)
    return ref ? resolve(ref[1], depth + 1) : v
  }
  return resolve
}

/** Блоки `src/styles/scenes.css` (путь от корня проекта — vitest запускается из него). */
export function readSceneCss(): RootBlock[] {
  return parseRootBlocks(readFileSync(path.resolve(process.cwd(), 'src/styles/scenes.css'), 'utf-8'))
}

const SCENE_NAMES: Record<AmbientScene, string> = {
  meadow: 'Луг',
  autumn: 'Осень',
  paper: 'Бумага',
  winter: 'Зима',
}

/** Восемь пиксельных вариантов: четыре сцены × день/ночь, с классами <html>. */
export const SCENE_VARIANTS: ReadonlyArray<{ scene: AmbientScene; dark: boolean; name: string; classes: string[] }> = (
  ['meadow', 'autumn', 'paper', 'winter'] as const
).flatMap((scene) => [
  { scene, dark: false, name: `${SCENE_NAMES[scene]} день`, classes: ['pixel', `sc-${scene}`] },
  { scene, dark: true, name: `${SCENE_NAMES[scene]} ночь`, classes: ['pixel', `sc-${scene}`, 'dark'] },
])

function hexBytes(hex: string): [number, number, number] {
  let n = hex.trim().replace(/^#/, '')
  if (n.length === 3) n = n.replace(/./g, (ch) => ch + ch)
  if (!/^[0-9a-f]{6}$/i.test(n)) throw new Error(`не цвет #rrggbb: ${hex}`)
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) as [number, number, number]
}

/** Относительная яркость WCAG цвета '#rgb' | '#rrggbb'. */
export function luminance(hex: string): number {
  const [r, g, b] = hexBytes(hex)
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Контраст WCAG двух цветов, 1..21. */
export function contrast(a: string, b: string): number {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** Цвет hex под сплошной заливкой over (каналы 0..255, alpha 0..1), '#rrggbb'. */
export function overlay(hex: string, over: { r: number; g: number; b: number; alpha: number }): string {
  const a = Math.min(1, Math.max(0, over.alpha))
  const [r, g, b] = hexBytes(hex)
  const mix = (c: number, o: number) => Math.round(c * (1 - a) + o * a)
  return '#' + [mix(r, over.r), mix(g, over.g), mix(b, over.b)].map((c) => c.toString(16).padStart(2, '0')).join('')
}
