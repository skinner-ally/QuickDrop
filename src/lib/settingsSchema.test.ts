import { describe, expect, it } from 'vitest'
import { mergeSettings } from '@/db/settings'
import { BACKUP_PERIODS, DEFAULT_SETTINGS, FONT_PREFS, SCENE_PREFS, THEMES, type Settings } from '@/types'
import { MAX_SETTING_STRING, isValidSetting } from './settingsSchema'

describe('isValidSetting', () => {
  it('значения по умолчанию годятся все', () => {
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
      expect(isValidSetting(key, DEFAULT_SETTINGS[key]), key).toBe(true)
    }
  })

  it('тип должен совпадать с типом значения по умолчанию', () => {
    expect(isValidSetting('seeded', true)).toBe(true)
    expect(isValidSetting('seeded', 1)).toBe(false)
    expect(isValidSetting('seeded', 'true')).toBe(false)
    expect(isValidSetting('ambient', null)).toBe(false)
    expect(isValidSetting('aiModel', 5)).toBe(false)
    expect(isValidSetting('aiModel', undefined)).toBe(false)
    expect(isValidSetting('trashDays', '30')).toBe(false)
    expect(isValidSetting('extToken', {})).toBe(false)
  })

  it.each([
    ['theme', THEMES],
    ['scene', SCENE_PREFS],
    ['font', FONT_PREFS],
    ['backupEvery', BACKUP_PERIODS],
  ] as const)('%s — только значения из списка', (key, allowed) => {
    for (const value of allowed) expect(isValidSetting(key, value), value).toBe(true)
    expect(isValidSetting(key, 'x')).toBe(false)
    expect(isValidSetting(key, '')).toBe(false)
    expect(isValidSetting(key, allowed[0].toUpperCase())).toBe(false)
    expect(isValidSetting(key, 0)).toBe(false)
  })

  it('значение одного перечисления не годится для другого', () => {
    expect(isValidSetting('scene', 'dark')).toBe(false)
    expect(isValidSetting('theme', 'winter')).toBe(false)
    expect(isValidSetting('font', 'auto')).toBe(false)
    expect(isValidSetting('backupEvery', 'system')).toBe(false)
  })

  it.each([
    ['trashDays', 0, 3650],
    ['backupKeep', 1, 100],
    ['extPort', 1024, 65535],
  ] as const)('%s — целое от %i до %i', (key, min, max) => {
    expect(isValidSetting(key, min)).toBe(true)
    expect(isValidSetting(key, max)).toBe(true)
    expect(isValidSetting(key, min - 1)).toBe(false)
    expect(isValidSetting(key, max + 1)).toBe(false)
    expect(isValidSetting(key, min + 0.5)).toBe(false)
    expect(isValidSetting(key, NaN)).toBe(false)
    expect(isValidSetting(key, Infinity)).toBe(false)
  })

  it('backupLastAt — конечное неотрицательное число', () => {
    expect(isValidSetting('backupLastAt', 0)).toBe(true)
    expect(isValidSetting('backupLastAt', 1_762_819_200_000)).toBe(true)
    expect(isValidSetting('backupLastAt', 0.5)).toBe(true)
    expect(isValidSetting('backupLastAt', -1)).toBe(false)
    expect(isValidSetting('backupLastAt', NaN)).toBe(false)
    expect(isValidSetting('backupLastAt', Infinity)).toBe(false)
  })

  it('строки — не длиннее предела', () => {
    const ok = 'a'.repeat(MAX_SETTING_STRING)
    for (const key of ['linkProxyUrl', 'aiApiKey', 'backupDir', 'mdExportDir', 'extToken'] as const) {
      expect(isValidSetting(key, ''), key).toBe(true)
      expect(isValidSetting(key, ok), key).toBe(true)
      expect(isValidSetting(key, `${ok}a`), key).toBe(false)
    }
  })

  it('неизвестный ключ не годится, в том числе унаследованный от Object', () => {
    for (const key of ['unknown', '', '__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(isValidSetting(key as keyof Settings, true), key).toBe(false)
      expect(isValidSetting(key as keyof Settings, 'x'), key).toBe(false)
      expect(isValidSetting(key as keyof Settings, () => {}), key).toBe(false)
    }
  })
})

describe('mergeSettings', () => {
  it('негодные значения заменяются значениями по умолчанию', () => {
    const merged = mergeSettings([
      { key: 'scene', value: 'x' },
      { key: 'trashDays', value: -1 },
      { key: 'theme', value: 'sepia' },
      { key: 'font', value: 5 },
      { key: 'backupEvery', value: 'hourly' },
      { key: 'backupKeep', value: 0 },
      { key: 'extPort', value: 80 },
      { key: 'backupLastAt', value: -5 },
      { key: 'чужой-ключ', value: 1 },
    ])
    expect(merged).toEqual(DEFAULT_SETTINGS)
  })

  it('годные значения принимаются', () => {
    const merged = mergeSettings([
      { key: 'scene', value: 'winter' },
      { key: 'font', value: 'pixel' },
      { key: 'ambient', value: false },
      { key: 'trashDays', value: 0 },
      { key: 'backupEvery', value: 'weekly' },
      { key: 'backupKeep', value: 3 },
      { key: 'extPort', value: 50000 },
      { key: 'closeToTray', value: false },
    ])
    expect(merged).toEqual({
      ...DEFAULT_SETTINGS,
      scene: 'winter',
      font: 'pixel',
      ambient: false,
      trashDays: 0,
      backupEvery: 'weekly',
      backupKeep: 3,
      extPort: 50000,
      closeToTray: false,
    })
  })
})
