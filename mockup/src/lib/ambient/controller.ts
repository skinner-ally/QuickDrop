/**
 * Контроллер режимов живого фона (spec-stage6 §6.2): по условиям (раздел, окно, reduced-motion, настройка, сцена)
 * ставит или снимает слой графа. `off` — слоя нет, движок и планировщик выброшены (память кэша плиток свободна);
 * `static` — лес без эффектов и таймеров; `animated` — всё.
 */

import type { Scene } from '@/lib/scene'
import { getAmbientLayer, requestAmbientFrame, setAmbientLayer } from '@/lib/graph/ambient'
import type { AmbientScene } from '@/lib/ambient/types'
import type { AmbientEngine } from '@/lib/ambient/engine'
import { createAmbientEngine } from '@/lib/ambient/engine'
import type { AmbientConditions, AmbientMode, AmbientScheduler } from '@/lib/ambient/scheduler'
import { ambientMode, createAmbientScheduler } from '@/lib/ambient/scheduler'
import { createCanvasSurface } from '@/lib/ambient/surface'
import { buildSceneArt } from '@/lib/ambient/sprites'
import { effectsFor } from '@/lib/ambient/effects'

export interface AmbientControllerDeps {
  createEngine?: (scheduler: AmbientScheduler) => AmbientEngine
  createScheduler?: () => AmbientScheduler
}

export interface AmbientController {
  update: (c: AmbientConditions & { scene: Scene }) => void
  readonly mode: AmbientMode
  dispose: () => void
}

function defaultScheduler(): AmbientScheduler {
  return createAmbientScheduler({
    setTimer: (cb, ms) => window.setTimeout(cb, ms),
    clearTimer: (id) => window.clearTimeout(id as number),
    request: requestAmbientFrame,
  })
}

function defaultEngine(scheduler: AmbientScheduler): AmbientEngine {
  const engine = createAmbientEngine({
    // Потеря контекста GPU очищает поверхности: кэш и сведение — заново (вызов придёт позже создания движка).
    createSurface: (w, h) => createCanvasSurface(w, h, () => engine.reset()),
    art: buildSceneArt,
    effects: effectsFor,
    scheduler,
    requestFrame: requestAmbientFrame,
    windowSize: () => ({ width: window.innerWidth, height: window.innerHeight }),
  })
  return engine
}

export function createAmbientController(deps: AmbientControllerDeps = {}): AmbientController {
  const makeScheduler = deps.createScheduler ?? defaultScheduler
  const makeEngine = deps.createEngine ?? defaultEngine

  let mode: AmbientMode = 'off'
  let engine: AmbientEngine | null = null
  let scheduler: AmbientScheduler | null = null
  let cfg: { scene: AmbientScene; animate: boolean } | null = null

  const teardown = () => {
    if (engine && getAmbientLayer() === engine) setAmbientLayer(null)
    engine?.dispose()
    scheduler?.dispose()
    engine = null
    scheduler = null
    cfg = null
    mode = 'off'
  }

  const update = (c: AmbientConditions & { scene: Scene }) => {
    const pixel = c.pixel && c.scene !== 'classic'
    const next = ambientMode({
      stage: c.stage,
      visible: c.visible,
      reducedMotion: c.reducedMotion,
      enabled: c.enabled,
      pixel,
    })
    if (next === 'off' || c.scene === 'classic') {
      teardown()
      return
    }
    const scene: AmbientScene = c.scene
    const animate = next === 'animated'
    if (!engine || !scheduler) {
      scheduler = makeScheduler()
      engine = makeEngine(scheduler)
    }
    const same = cfg !== null && cfg.scene === scene && cfg.animate === animate && getAmbientLayer() === engine
    mode = next
    if (same) return
    cfg = { scene, animate }
    engine.configure(cfg)
    setAmbientLayer(engine)
    // Слой мог стоять и раньше (static → animated): setAmbientLayer тогда хост не будит, нужен кадр фона.
    requestAmbientFrame()
  }

  return {
    update,
    get mode() {
      return mode
    },
    // Как «off»: контроллер остаётся годным (StrictMode монтирует эффекты повторно).
    dispose: teardown,
  }
}
