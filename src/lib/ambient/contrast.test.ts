import { describe, expect, it } from 'vitest'
import { AMBIENT_OVERLAY_MAX } from '@/lib/ambient/types'
import { contrast, overlay, readSceneCss, sceneVars, SCENE_VARIANTS } from '@/test/sceneVars'

/*
 * Читаемость графа под живым фоном. Земля под нодами остаётся ровной (поляны), поэтому проверки этапа 5
 * (lib/graph/theme.test.ts) верны и с фоном. Единственная сплошная заливка поверх нод — лучи (дневные «Луг» и
 * «Осень», effects.test.ts): белый не сильнее AMBIENT_OVERLAY_MAX. Она светлит и ноду, и землю, поэтому считаем
 * оба цвета под заливкой. Строгое «кромка к земле ≥ 3» ночью не проверяется: там кромка к земле ≈ 1.2–1.4 по
 * замыслу этапа 5 (читаемость дают заливка ноды и сердцевина связи — их проверяет theme.test.ts), а заливки нет.
 */

const blocks = readSceneCss()
const rays = SCENE_VARIANTS.filter((v) => !v.dark && (v.scene === 'meadow' || v.scene === 'autumn'))

describe('читаемость графа под лучами (дневные «Луг» и «Осень»)', () => {
  it('в проверку попадают ровно два варианта', () => {
    expect(rays.map((v) => v.name)).toEqual(['Луг день', 'Осень день'])
  })

  for (const v of rays) {
    describe(v.name, () => {
      const vars = sceneVars(blocks, v.classes)
      const ground = overlay(vars('--ground'), AMBIENT_OVERLAY_MAX)
      for (const key of ['--graph-node-edge', '--graph-link-edge', '--graph-sel-edge']) {
        it(`${key} к земле под заливкой ≥ 3`, () => {
          const edge = overlay(vars(key), AMBIENT_OVERLAY_MAX)
          expect(contrast(edge, ground)).toBeGreaterThanOrEqual(3)
        })
      }
    })
  }
})

describe('подпись ноды к своему контуру ≥ 4.5 (все восемь вариантов)', () => {
  for (const v of SCENE_VARIANTS) {
    it(v.name, () => {
      const vars = sceneVars(blocks, v.classes)
      expect(contrast(vars('--graph-label'), vars('--graph-label-edge'))).toBeGreaterThanOrEqual(4.5)
    })
  }
})
