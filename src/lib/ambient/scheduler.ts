/**
 * Режимы живого фона и тики эффектов (spec-stage6 §4.3). Модуль чистый: таймеры и запрос кадра внедряются, своего
 * requestAnimationFrame нет. Цепочка «таймер → request() → кадр хоста → consume() → новый таймер» сама встаёт, если
 * хост не рисует (окно скрыто или свёрнуто): без consume следующий таймер не взводится.
 */

import { AMBIENT_TICK_MS } from '@/lib/ambient/types'

export interface AmbientConditions {
  /** Раздел «Граф» открыт и сцена графа есть в DOM. */
  stage: boolean
  /** document.visibilityState === 'visible'. */
  visible: boolean
  /** prefers-reduced-motion: reduce. */
  reducedMotion: boolean
  /** settings.ambient. */
  enabled: boolean
  /** Сцена не «Классика». */
  pixel: boolean
}

export type AmbientMode = 'off' | 'static' | 'animated'

export function ambientMode(c: AmbientConditions): AmbientMode {
  if (!c.stage || !c.enabled || !c.pixel) return 'off'
  if (c.reducedMotion || !c.visible) return 'static'
  return 'animated'
}

export interface SchedulerDeps {
  setTimer: (cb: () => void, ms: number) => unknown
  clearTimer: (id: unknown) => void
  /** Попросить хост о кадре фона (requestAmbientFrame). */
  request: () => void
}

export interface AmbientScheduler {
  /** Запустить или остановить тики. Повтор того же значения — ничего. */
  setRunning: (on: boolean) => void
  readonly running: boolean
  /** Взведён ли таймер (тесты, отладка). */
  readonly armed: boolean
  /** Слой зовёт в начале каждого draw. null — тик не наступил; иначе часы эффектов t (с) и шаг dt (с). */
  consume: (now: number) => { t: number; dt: number } | null
  dispose: () => void
}

/** Наибольший шаг часов за тик, с: долгий кадр не даёт эффектам прыгнуть. */
const MAX_DT = 0.25

export function createAmbientScheduler(deps: SchedulerDeps, periodMs: number = AMBIENT_TICK_MS): AmbientScheduler {
  let running = false
  let disposed = false
  /** Тик наступил и ждёт кадра хоста. */
  let due = false
  let timerId: unknown = null
  let armed = false
  /** Поколение таймера: запоздалый обратный вызов снятого таймера ничего не делает. */
  let gen = 0
  let t = 0
  let lastNow = 0
  /** Следующий тик — первый после запуска: dt = 0, пауза в часы не входит. */
  let first = true

  const disarm = (): void => {
    gen += 1
    if (armed) {
      armed = false
      const id = timerId
      timerId = null
      deps.clearTimer(id)
    }
  }

  const arm = (): void => {
    disarm()
    const my = gen
    armed = true
    timerId = deps.setTimer(() => {
      if (my !== gen) return
      armed = false
      timerId = null
      if (!running || disposed) return
      due = true
      deps.request()
    }, periodMs)
  }

  const setRunning = (on: boolean): void => {
    if (disposed || on === running) return
    running = on
    if (on) {
      due = true
      deps.request()
    } else {
      disarm()
      due = false
      first = true
    }
  }

  const consume = (now: number): { t: number; dt: number } | null => {
    if (disposed || !running || !due) return null
    due = false
    let dt = 0
    if (!first) {
      const raw = (now - lastNow) / 1000
      dt = Number.isFinite(raw) ? Math.min(MAX_DT, Math.max(0, raw)) : 0
    }
    first = false
    t += dt
    lastNow = now
    arm()
    return { t, dt }
  }

  const dispose = (): void => {
    if (disposed) return
    setRunning(false)
    disposed = true
  }

  return {
    setRunning,
    get running() {
      return running
    },
    get armed() {
      return armed
    },
    consume,
    dispose,
  }
}
