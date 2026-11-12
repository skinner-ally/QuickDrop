import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AmbientFrame, AmbientStats, AmbientWake } from '@/lib/graph/ambient'
import { getAmbientLayer, setAmbientLayer, subscribeAmbient } from '@/lib/graph/ambient'
import type { AmbientEngine } from '@/lib/ambient/engine'
import type { AmbientConditions, AmbientScheduler } from '@/lib/ambient/scheduler'
import type { AmbientController } from '@/lib/ambient/controller'
import { createAmbientController } from '@/lib/ambient/controller'
import type { Scene } from '@/lib/scene'

type Cond = AmbientConditions & { scene: Scene }

const ON: Cond = { stage: true, visible: true, reducedMotion: false, enabled: true, pixel: true, scene: 'autumn' }

/** Подставной планировщик: считает запуски; запущен ли — как у настоящего. */
function fakeScheduler() {
  const log = { starts: 0, disposed: 0 }
  let running = false
  const s: AmbientScheduler = {
    setRunning: (on) => {
      if (on === running) return
      running = on
      if (on) log.starts += 1
    },
    get running() {
      return running
    },
    get armed() {
      return false
    },
    consume: () => null,
    dispose: () => {
      log.disposed += 1
      running = false
    },
  }
  return { s, log }
}

/** Подставной движок: draw запускает планировщик, только если настроен на анимацию (как настоящий с эффектами). */
function fakeEngine(scheduler: AmbientScheduler) {
  const log = { configs: [] as Array<{ scene: string; animate: boolean }>, disposed: 0, draws: 0 }
  let animate = false
  const stats = (): AmbientStats => ({ tiles: 0, tilePixels: 0, rendered: 0, ticks: 0 })
  const engine: AmbientEngine = {
    configure: (c) => {
      log.configs.push({ ...c })
      animate = c.animate
      if (!animate) scheduler.setRunning(false)
    },
    draw: () => {
      log.draws += 1
      scheduler.setRunning(animate)
    },
    reset: () => {},
    dispose: () => {
      log.disposed += 1
      scheduler.setRunning(false)
    },
    stats,
  }
  return { engine, log }
}

function setup() {
  const engines: Array<ReturnType<typeof fakeEngine>> = []
  const schedulers: Array<ReturnType<typeof fakeScheduler>> = []
  const c: AmbientController = createAmbientController({
    createScheduler: () => {
      const s = fakeScheduler()
      schedulers.push(s)
      return s.s
    },
    createEngine: (sch) => {
      const e = fakeEngine(sch)
      engines.push(e)
      return e.engine
    },
  })
  const wakes: AmbientWake[] = []
  const off = subscribeAmbient((k) => wakes.push(k))
  /** Кадр хоста: слой рисует, если он есть. */
  const hostFrame = () => getAmbientLayer()?.draw({} as never, {} as AmbientFrame)
  const running = () => schedulers.length > 0 && schedulers[schedulers.length - 1].s.running
  const starts = () => schedulers.reduce((n, s) => n + s.log.starts, 0)
  return { c, engines, schedulers, wakes, off, hostFrame, running, starts }
}

let h: ReturnType<typeof setup>

beforeEach(() => {
  setAmbientLayer(null)
  h = setup()
})

afterEach(() => {
  h.c.dispose()
  h.off()
  setAmbientLayer(null)
})

describe('createAmbientController', () => {
  it('animated: слой поставлен, движок настроен на анимацию, кадр фона запрошен', () => {
    h.c.update(ON)
    expect(h.c.mode).toBe('animated')
    expect(h.engines).toHaveLength(1)
    expect(getAmbientLayer()).toBe(h.engines[0].engine)
    expect(h.engines[0].log.configs).toEqual([{ scene: 'autumn', animate: true }])
    expect(h.wakes).toEqual(['layer', 'frame'])
    h.hostFrame()
    expect(h.running()).toBe(true)
  })

  it('до первого update слоя нет и движок не создан', () => {
    expect(h.c.mode).toBe('off')
    expect(getAmbientLayer()).toBeNull()
    expect(h.engines).toHaveLength(0)
  })

  for (const key of ['stage', 'enabled', 'pixel'] as const) {
    it(`off при ${key} = false: слоя нет, движок и планировщик выброшены`, () => {
      h.c.update(ON)
      h.hostFrame()
      h.c.update({ ...ON, [key]: false })
      expect(h.c.mode).toBe('off')
      expect(getAmbientLayer()).toBeNull()
      expect(h.engines[0].log.disposed).toBe(1)
      expect(h.schedulers[0].log.disposed).toBe(1)
      expect(h.running()).toBe(false)
      h.hostFrame()
      expect(h.engines[0].log.draws).toBe(1)
    })

    it(`off при ${key} = false с самого начала: движок не создаётся`, () => {
      h.c.update({ ...ON, [key]: false })
      expect(h.c.mode).toBe('off')
      expect(getAmbientLayer()).toBeNull()
      expect(h.engines).toHaveLength(0)
      expect(h.starts()).toBe(0)
    })
  }

  it('«Классика» — off, даже если pixel ошибочно true', () => {
    h.c.update({ ...ON, scene: 'classic' })
    expect(h.c.mode).toBe('off')
    expect(getAmbientLayer()).toBeNull()
    expect(h.engines).toHaveLength(0)
    h.c.update(ON)
    h.c.update({ ...ON, scene: 'classic', pixel: false })
    expect(getAmbientLayer()).toBeNull()
    expect(h.engines[0].log.disposed).toBe(1)
  })

  it('static из-за reduced-motion: слой есть, планировщик не запускается', () => {
    h.c.update({ ...ON, reducedMotion: true })
    expect(h.c.mode).toBe('static')
    expect(getAmbientLayer()).toBe(h.engines[0].engine)
    expect(h.engines[0].log.configs).toEqual([{ scene: 'autumn', animate: false }])
    h.hostFrame()
    h.hostFrame()
    expect(h.starts()).toBe(0)
  })

  it('static из-за скрытого окна останавливает идущую анимацию, слой и кэш остаются', () => {
    h.c.update(ON)
    h.hostFrame()
    expect(h.running()).toBe(true)
    h.c.update({ ...ON, visible: false })
    expect(h.c.mode).toBe('static')
    expect(h.running()).toBe(false)
    expect(getAmbientLayer()).toBe(h.engines[0].engine)
    expect(h.engines).toHaveLength(1)
    expect(h.engines[0].log.disposed).toBe(0)
    const before = h.schedulers[0].log.starts
    h.hostFrame()
    expect(h.schedulers[0].log.starts).toBe(before)
  })

  it('возврат в animated тем же движком и с запросом кадра (слой не менялся)', () => {
    h.c.update({ ...ON, visible: false })
    h.wakes.length = 0
    h.c.update(ON)
    expect(h.c.mode).toBe('animated')
    expect(h.engines).toHaveLength(1)
    expect(h.engines[0].log.configs.at(-1)).toEqual({ scene: 'autumn', animate: true })
    expect(h.wakes).toEqual(['frame'])
    h.hostFrame()
    expect(h.running()).toBe(true)
  })

  it('смена сцены перенастраивает тот же движок', () => {
    h.c.update(ON)
    h.c.update({ ...ON, scene: 'winter' })
    expect(h.engines).toHaveLength(1)
    expect(h.engines[0].log.configs.at(-1)).toEqual({ scene: 'winter', animate: true })
  })

  it('после off новый движок создаётся заново', () => {
    h.c.update(ON)
    h.c.update({ ...ON, stage: false })
    h.c.update(ON)
    expect(h.engines).toHaveLength(2)
    expect(h.schedulers).toHaveLength(2)
    expect(getAmbientLayer()).toBe(h.engines[1].engine)
  })

  it('повторный update с теми же условиями ничего не пересоздаёт и хост не будит', () => {
    h.c.update(ON)
    h.wakes.length = 0
    h.c.update({ ...ON })
    h.c.update({ ...ON })
    expect(h.engines).toHaveLength(1)
    expect(h.schedulers).toHaveLength(1)
    expect(h.engines[0].log.configs).toHaveLength(1)
    expect(h.wakes).toEqual([])
  })

  it('dispose снимает слой; контроллер остаётся годным', () => {
    h.c.update(ON)
    h.c.dispose()
    expect(getAmbientLayer()).toBeNull()
    expect(h.c.mode).toBe('off')
    expect(h.engines[0].log.disposed).toBe(1)
    h.c.dispose()
    expect(h.engines[0].log.disposed).toBe(1)
    h.c.update(ON)
    expect(getAmbientLayer()).toBe(h.engines[1].engine)
  })

  it('чужой слой не снимается при off', () => {
    const foreign = { draw: () => {} }
    h.c.update(ON)
    setAmbientLayer(foreign)
    h.c.update({ ...ON, enabled: false })
    expect(getAmbientLayer()).toBe(foreign)
    expect(h.engines[0].log.disposed).toBe(1)
  })

  it('каждое условие остановки по отдельности: слоя нет или планировщик не запущен', () => {
    const stops: Array<Partial<Cond>> = [
      { stage: false },
      { enabled: false },
      { pixel: false },
      { scene: 'classic' },
      { visible: false },
      { reducedMotion: true },
    ]
    for (const stop of stops) {
      h.c.dispose()
      h.c.update(ON)
      h.hostFrame()
      h.c.update({ ...ON, ...stop })
      h.hostFrame()
      h.hostFrame()
      expect(getAmbientLayer() === null || !h.running()).toBe(true)
    }
  })
})
