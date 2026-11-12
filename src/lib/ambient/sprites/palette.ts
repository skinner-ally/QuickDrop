/**
 * Палитры графики живого фона (spec-stage6 §5.1): земля сцен, гаммы листвы и хвои, вода, тени и цвета мелочи земли.
 * Значения перенесены из mockup/forest.js (THEMES) и mockup/app.js (SCENES). Только строки '#rrggbb' и числа:
 * в цвета для растра их переводит forest.ts / ground.ts.
 */

import type { AmbientScene } from '@/lib/ambient/types'

/** Земля сцен: равна `--ground` в styles/scenes.css (проверяется тестом). Не рисуется, на неё смягчаются цвета. */
export const GROUND: Record<AmbientScene, { day: string; night: string }> = {
  meadow: { day: '#86ab5e', night: '#1f3038' },
  autumn: { day: '#c2a55e', night: '#2c2132' },
  paper: { day: '#eadbb4', night: '#23232f' },
  winter: { day: '#dde7ee', night: '#1c2740' },
}

/** Гамма кроны: контур и четыре тона от тени к свету. */
export interface LeafPalette {
  line: string
  tones: readonly [string, string, string, string]
}

export type ForestScene = 'meadow' | 'autumn' | 'winter'

export interface WaterHex {
  deep: string
  mid: string
  lit: string
  bank: string
  dash: string
  /** Берег: цвет и альфа. */
  shore: readonly [string, number]
}

export interface ForestTheme {
  /** Овальная тень под объектом: цвет и альфа. */
  shadow: readonly [string, number]
  /** Четыре гаммы листвы (деревья и кусты). */
  leaf: readonly LeafPalette[]
  pine: LeafPalette
  water: WaterHex
  /** Есть ли кувшинки. */
  lily: boolean
  /** Особый вид мелочи (вариант 1) и вид варианта 2: пень — всегда вариант 0. */
  extra: 'pumpkin' | 'flower' | 'drift'
  reed: readonly [string, string]
}

const WATER: WaterHex = {
  deep: '#3f8cb8',
  mid: '#4c9cc4',
  lit: '#7cc0dc',
  bank: '#2f729c',
  dash: '#9ad6ea',
  shore: ['#6a4a1c', 0.38],
}

export const FOREST: Record<ForestScene, ForestTheme> = {
  autumn: {
    shadow: ['#3c1c08', 0.22],
    water: WATER,
    lily: true,
    extra: 'pumpkin',
    reed: ['#4e6e2c', '#7a9a42'],
    leaf: [
      { line: '#6e2a0e', tones: ['#a8481a', '#d2691e', '#ee8f2c', '#ffc04a'] }, // рыжий
      { line: '#5e1512', tones: ['#93241c', '#c23a26', '#e2583a', '#f58a5a'] }, // красный
      { line: '#6e4c0c', tones: ['#b07c18', '#d9a520', '#f2c93c', '#ffe884'] }, // золотой
      { line: '#4a123c', tones: ['#7a1e5c', '#a52c78', '#c84a94', '#e67cb4'] }, // сливовый
    ],
    pine: { line: '#12301e', tones: ['#1c4a2c', '#2a6a3a', '#3c8a48', '#62a85a'] },
  },
  meadow: {
    shadow: ['#143214', 0.24],
    water: WATER,
    lily: true,
    extra: 'flower',
    reed: ['#3c7a2c', '#6aa83e'],
    leaf: [
      { line: '#1c4a1c', tones: ['#2c6a2a', '#3f8c36', '#5cae48', '#8ccc62'] },
      { line: '#22502c', tones: ['#327438', '#4a9a4c', '#70bc62', '#a2dc84'] },
      { line: '#3a5612', tones: ['#56841e', '#78a82c', '#9cc444', '#c8e474'] },
      { line: '#7a2e52', tones: ['#b85a86', '#dc86aa', '#f2aecb', '#ffd8e6'] }, // цветущее
    ],
    pine: { line: '#102c20', tones: ['#1a4630', '#26623e', '#35804c', '#58a060'] },
  },
  winter: {
    shadow: ['#28324a', 0.2],
    lily: false,
    extra: 'drift',
    reed: ['#8a6a3c', '#b08a50'],
    water: {
      deep: '#a8c6da',
      mid: '#bcd6e6',
      lit: '#e6f1f7',
      bank: '#86a4bc',
      dash: '#ffffff',
      shore: ['#5b6f96', 0.3],
    },
    leaf: [
      { line: '#5a6c88', tones: ['#93a8c0', '#bccbdc', '#e2ebf2', '#ffffff'] },
      { line: '#566a80', tones: ['#8aa2b4', '#b4c8d6', '#dce8ee', '#ffffff'] },
      { line: '#64708c', tones: ['#a0aac6', '#c6cee0', '#e8ecf4', '#ffffff'] },
      { line: '#4e6478', tones: ['#7f9aac', '#aac0ce', '#d6e4ea', '#f6fafc'] },
    ],
    pine: { line: '#12302a', tones: ['#1c4a3a', '#2a6a52', '#d8e6f0', '#ffffff'] }, // свет слева — снег на лапах
  },
}

/** Кора: тень, середина, свет (в мокапе порядок BARK[0..2]). */
export const BARK = ['#4a2a14', '#6e4220', '#8a5a2c'] as const
/** Камень: четыре тона от тени к свету и контур. */
export const STONE = { tones: ['#6f6a66', '#8f8a84', '#b3aea6', '#d6d2c8'], line: '#4a4542' } as const

/** Цвета мелочи земли одной сцены в одной яркости (SCENES[*].day / .night мокапа). */
export interface DetailColors {
  /** Тёмные пучки и штрихи. */
  dk: string
  /** Светлые штрихи. */
  lt: string
  /** Основной «цветной» штрих: лепестки, искры. */
  dot: string
  /** Второй цвет: серединка цветка, пучки зимы. */
  dot2: string
  /** Остатки зелёной травы (осень). */
  green: string
  /** Опавшие листья (осень). */
  leaves: readonly string[]
  /** Шляпка и ножка гриба (осень). */
  cap: string
  stem: string
  /** Приглушённые чернила клякс («Бумага»). */
  ink: string
}

export const DETAIL: Record<AmbientScene, { day: DetailColors; night: DetailColors }> = {
  meadow: {
    day: { dk: '#74994f', lt: '#98bd6e', dot: '#fff6dc', dot2: '#f2c14e', green: '#74994f', leaves: [], cap: '#c2452d', stem: '#f6ead0', ink: '#74994f' },
    night: { dk: '#18262d', lt: '#283c44', dot: '#4a6470', dot2: '#6c8a94', green: '#18262d', leaves: [], cap: '#7a3440', stem: '#b9a9b0', ink: '#18262d' },
  },
  autumn: {
    day: {
      dk: '#a98c4a', lt: '#d4ba74', dot: '#e8b83a', dot2: '#e2812c', green: '#99a052',
      leaves: ['#b9482a', '#e2812c', '#e8b83a', '#8c3a22'], cap: '#c2452d', stem: '#f6ead0', ink: '#a98c4a',
    },
    night: {
      dk: '#241a29', lt: '#382b3f', dot: '#8a7a3a', dot2: '#86563a', green: '#2f3a36',
      leaves: ['#6a3838', '#86563a', '#8a7a3a', '#4a2a2a'], cap: '#7a3440', stem: '#b9a9b0', ink: '#241a29',
    },
  },
  paper: {
    day: { dk: '#dccb9e', lt: '#f2e6c6', dot: '#bfa672', dot2: '#bfa672', green: '#dccb9e', leaves: [], cap: '#bfa672', stem: '#bfa672', ink: '#b8a272' },
    night: { dk: '#1d1d28', lt: '#2a2a38', dot: '#44445c', dot2: '#44445c', green: '#1d1d28', leaves: [], cap: '#44445c', stem: '#44445c', ink: '#3a3a52' },
  },
  winter: {
    day: { dk: '#c4d2de', lt: '#f5f9fb', dot: '#ffffff', dot2: '#8fa6bc', green: '#c4d2de', leaves: [], cap: '#8fa6bc', stem: '#ffffff', ink: '#c4d2de' },
    night: { dk: '#172036', lt: '#25334f', dot: '#6c80a8', dot2: '#3a4a70', green: '#172036', leaves: [], cap: '#3a4a70', stem: '#6c80a8', ink: '#172036' },
  },
}
