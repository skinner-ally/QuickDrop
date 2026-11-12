/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { AMBIENT_TICK_MS } from '@/lib/ambient/types'
import { ambientMode, createAmbientScheduler } from '@/lib/ambient/scheduler'
import type { AmbientConditions, AmbientMode, AmbientScheduler } from '@/lib/ambient/scheduler'

/** Подставные таймеры: свой список, без vi.useFakeTimers. */
function harness(periodMs?: number) {
  let nextId = 1
  const timers = new Map<number, { cb: () => void; ms: number }>()
  const log = { set: 0, clear: 0, request: 0, setMs: [] as number[] }
  const s: AmbientScheduler = createAmbientScheduler(
    {
      setTimer: (cb, ms) => {
        const id = nextId++
        timers.set(id, { cb, ms })
        log.set += 1
        log.setMs.push(ms)
        return id
      },
      clearTimer: (id) => {
        log.clear += 1
        timers.delete(id as number)
      },
      request: () => {
        log.request += 1
      },
    },
    periodMs,
  )
  /** «Прокрутка времени»: срабатывают все взведённые таймеры. */
  const advance = (): number => {
    const due = [...timers.entries()]
    for (const [id, t] of due) {
      timers.delete(id)
      t.cb()
    }
    return due.length
  }
  return { s, timers, log, advance }
}

/** Инвариант планировщика: пока running — ровно одно из «тик ждёт кадра» и «таймер взведён»; иначе ни того, ни другого. */
function invariant(h: ReturnType<typeof harness>, due: boolean): void {
  expect(h.s.armed).toBe(h.timers.size === 1)
  expect(h.timers.size).toBeLessThanOrEqual(1)
  if (h.s.running) expect(Number(due) + Number(h.s.armed)).toBe(1)
  else {
    expect(h.s.armed).toBe(false)
    expect(h.timers.size).toBe(0)
  }
}

const KEYS = ['stage', 'visible', 'reducedMotion', 'enabled', 'pixel'] as const

function expectedMode(c: AmbientConditions): AmbientMode {
  if (!c.stage || !c.enabled || !c.pixel) return 'off'
  if (c.reducedMotion || !c.visible) return 'static'
  return 'animated'
}

const ALL_ON: AmbientConditions = { stage: true, visible: true, reducedMotion: false, enabled: true, pixel: true }

describe('ambientMode', () => {
  it('таблица на все 32 сочетания', () => {
    const counts: Record<AmbientMode, number> = { off: 0, static: 0, animated: 0 }
    for (let m = 0; m < 32; m++) {
      const c = Object.fromEntries(KEYS.map((k, i) => [k, Boolean(m & (1 << i))])) as unknown as AmbientConditions
      const mode = ambientMode(c)
      expect(mode, JSON.stringify(c)).toBe(expectedMode(c))
      counts[mode] += 1
    }
    // off: 32 − 4 (stage·enabled·pixel истинны → 4 сочетания visible×reducedMotion); animated — ровно одно.
    expect(counts).toEqual({ off: 28, static: 3, animated: 1 })
  })

  it('всё включено — animated', () => {
    expect(ambientMode(ALL_ON)).toBe('animated')
  })

  it('каждое условие остановки по отдельности даёт не animated', () => {
    expect(ambientMode({ ...ALL_ON, stage: false })).toBe('off')
    expect(ambientMode({ ...ALL_ON, enabled: false })).toBe('off')
    expect(ambientMode({ ...ALL_ON, pixel: false })).toBe('off')
    expect(ambientMode({ ...ALL_ON, visible: false })).toBe('static')
    expect(ambientMode({ ...ALL_ON, reducedMotion: true })).toBe('static')
  })
})

describe('createAmbientScheduler', () => {
  it('до запуска: не running, таймеров нет, consume → null', () => {
    const h = harness()
    expect(h.s.running).toBe(false)
    expect(h.s.armed).toBe(false)
    expect(h.s.consume(0)).toBeNull()
    expect(h.log).toMatchObject({ set: 0, request: 0 })
  })

  it('запуск → один request, таймер не взводится', () => {
    const h = harness()
    h.s.setRunning(true)
    expect(h.s.running).toBe(true)
    expect(h.log.request).toBe(1)
    expect(h.log.set).toBe(0)
    invariant(h, true)
  })

  it('повторный setRunning(true) не шлёт второй request', () => {
    const h = harness()
    h.s.setRunning(true)
    h.s.setRunning(true)
    expect(h.log.request).toBe(1)
    h.s.consume(0)
    h.s.setRunning(true)
    expect(h.log.request).toBe(1)
    expect(h.timers.size).toBe(1)
  })

  it('consume → первый тик dt = 0, взведён ровно один таймер на period', () => {
    const h = harness()
    h.s.setRunning(true)
    expect(h.s.consume(1000)).toEqual({ t: 0, dt: 0 })
    expect(h.timers.size).toBe(1)
    expect(h.log.setMs).toEqual([AMBIENT_TICK_MS])
    invariant(h, false)
    // Тик уже взят: второй consume до срабатывания таймера — null, новых таймеров нет.
    expect(h.s.consume(1010)).toBeNull()
    expect(h.log.set).toBe(1)
  })

  it('свой период таймера', () => {
    const h = harness(40)
    h.s.setRunning(true)
    h.s.consume(0)
    expect(h.log.setMs).toEqual([40])
  })

  it('срабатывание → request, armed === false, тик ждёт кадра', () => {
    const h = harness()
    h.s.setRunning(true)
    h.s.consume(0)
    expect(h.advance()).toBe(1)
    expect(h.log.request).toBe(2)
    expect(h.s.armed).toBe(false)
    invariant(h, true)
    expect(h.s.consume(83)).toEqual({ t: 0.083, dt: 0.083 })
    invariant(h, false)
  })

  it('два срабатывания подряд без consume невозможны: кадр не нарисован — цепочка стоит', () => {
    const h = harness()
    h.s.setRunning(true)
    h.s.consume(0)
    expect(h.advance()).toBe(1)
    for (let i = 0; i < 5; i++) expect(h.advance()).toBe(0)
    expect(h.log.request).toBe(2)
    expect(h.log.set).toBe(1)
    invariant(h, true)
  })

  it('длинная цепочка держит инвариант и часы', () => {
    const h = harness()
    h.s.setRunning(true)
    let now = 0
    let last = h.s.consume(now)
    for (let i = 0; i < 50; i++) {
      invariant(h, false)
      h.advance()
      invariant(h, true)
      now += 83
      last = h.s.consume(now)
    }
    expect(last?.t).toBeCloseTo(50 * 0.083, 9)
    expect(h.log.request).toBe(51)
    expect(h.log.set).toBe(51)
  })

  it('setRunning(false), пока тик ждёт кадра: таймеров 0, прокрутка не зовёт request', () => {
    const h = harness()
    h.s.setRunning(true)
    h.s.setRunning(false)
    expect(h.s.running).toBe(false)
    invariant(h, false)
    expect(h.s.consume(10)).toBeNull()
    for (let i = 0; i < 3; i++) h.advance()
    expect(h.log.request).toBe(1)
    expect(h.log.set).toBe(0)
  })

  it('setRunning(false), пока таймер взведён: таймер снят, прокрутка не зовёт request', () => {
    const h = harness()
    h.s.setRunning(true)
    h.s.consume(0)
    expect(h.s.armed).toBe(true)
    h.s.setRunning(false)
    expect(h.log.clear).toBe(1)
    expect(h.timers.size).toBe(0)
    invariant(h, false)
    for (let i = 0; i < 3; i++) expect(h.advance()).toBe(0)
    expect(h.log.request).toBe(1)
    expect(h.s.consume(500)).toBeNull()
  })

  it('запоздалый обратный вызов снятого таймера ничего не делает', () => {
    const callbacks: Array<() => void> = []
    let requests = 0
    const s = createAmbientScheduler({
      setTimer: (cb) => {
        callbacks.push(cb)
        return callbacks.length
      },
      clearTimer: () => {}, // «не успел» снять
      request: () => {
        requests += 1
      },
    })
    s.setRunning(true)
    s.consume(0)
    s.setRunning(false)
    callbacks[0]()
    expect(requests).toBe(1)
    expect(s.armed).toBe(false)
    expect(s.consume(100)).toBeNull()
    // Перезапуск: старый вызов не крадёт новый таймер.
    s.setRunning(true)
    expect(requests).toBe(2)
    s.consume(200)
    expect(s.armed).toBe(true)
    callbacks[0]()
    expect(s.armed).toBe(true)
    expect(requests).toBe(2)
  })

  it('пауза 10 с не даёт скачка t, t сохраняется', () => {
    const h = harness()
    h.s.setRunning(true)
    h.s.consume(0)
    h.advance()
    expect(h.s.consume(100)?.t).toBeCloseTo(0.1, 9)
    h.s.setRunning(false)
    h.s.setRunning(true)
    expect(h.log.request).toBe(3)
    const tick = h.s.consume(10_100)
    expect(tick?.dt).toBe(0)
    expect(tick?.t).toBeCloseTo(0.1, 9)
    h.advance()
    const next = h.s.consume(10_183)
    expect(next?.dt).toBeCloseTo(0.083, 9)
    expect(next?.t).toBeCloseTo(0.183, 9)
  })

  it('dt ограничен 0.25 и не бывает отрицательным', () => {
    const h = harness()
    h.s.setRunning(true)
    h.s.consume(0)
    h.advance()
    expect(h.s.consume(5000)).toEqual({ t: 0.25, dt: 0.25 })
    h.advance()
    expect(h.s.consume(4000)).toEqual({ t: 0.25, dt: 0 })
    h.advance()
    expect(h.s.consume(Number.NaN)?.dt).toBe(0)
  })

  it('dispose: таймеров 0, request больше не зовётся, методы пустые, идемпотентен', () => {
    const h = harness()
    h.s.setRunning(true)
    h.s.consume(0)
    h.s.dispose()
    expect(h.s.running).toBe(false)
    expect(h.timers.size).toBe(0)
    invariant(h, false)
    h.s.dispose()
    h.s.dispose()
    h.s.setRunning(true)
    expect(h.s.running).toBe(false)
    expect(h.s.consume(100)).toBeNull()
    for (let i = 0; i < 3; i++) h.advance()
    expect(h.log.request).toBe(1)
    expect(h.log.set).toBe(1)
    expect(h.log.clear).toBe(1)
  })

  it('dispose из остановленного: ничего не зовёт', () => {
    const h = harness()
    h.s.dispose()
    expect(h.log).toMatchObject({ set: 0, clear: 0, request: 0 })
    h.s.setRunning(true)
    expect(h.log.request).toBe(0)
  })

  it('модуль не трогает rAF, setInterval, window и document', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('./scheduler.ts', import.meta.url), 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/requestAnimationFrame|setInterval|\bwindow\b|\bdocument\b|\bsetTimeout\b/)
  })
})
