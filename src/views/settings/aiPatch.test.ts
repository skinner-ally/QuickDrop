import { describe, expect, it } from 'vitest'
import { aiEnabledPatch } from './aiPatch'

describe('aiEnabledPatch', () => {
  it('включение ИИ при включённом автораспознавании сдвигает момент', () => {
    expect(aiEnabledPatch({ aiAutoOcr: true }, true, 5000)).toEqual({ aiEnabled: true, aiAutoOcrSince: 5000 })
  })

  it('без автораспознавания или при выключении — только aiEnabled', () => {
    expect(aiEnabledPatch({ aiAutoOcr: false }, true, 5000)).toEqual({ aiEnabled: true })
    expect(aiEnabledPatch({ aiAutoOcr: true }, false, 5000)).toEqual({ aiEnabled: false })
  })
})
