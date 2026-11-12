/**
 * Контракт живого фона графа (лес, пруды, листопад, лучи, снег, светлячки). Рисовальщик — этап 6: он ставит слой через
 * `setAmbientLayer`, хост (`GraphCanvas`) вызывает `draw` на каждой перерисовке графа. На этапе 5 слой никто не ставит:
 * при `getAmbientLayer() === null` хост фоновые canvas не измеряет и не рисует.
 * Остановку анимации (скрытое окно, `prefers-reduced-motion`, выключенный «Живой фон», «Классика») решает этап 6.
 */

import type { DeviceTransform, GraphViewport } from '@/lib/graph/types'

export interface AmbientFrame {
  viewport: GraphViewport
  /** Мир → пиксели устройства canvas (то же преобразование, что у нод). */
  device: DeviceTransform
  pixel: boolean
  dark: boolean
  /** performance.now() кадра. */
  time: number
  /** Есть ли нода ближе radius (мир) к точке — «лес не растёт под нодами и рядом». */
  nodeNear: (wx: number, wy: number, radius: number) => boolean
}

export interface AmbientLayer {
  /**
   * Хост вызывает при каждой перерисовке графа (сдвиг, масштаб, размер, сцена, набор нод) и по requestAmbientFrame().
   * Оба canvas уже нужного размера (пиксели устройства).
   */
  draw: (target: { back: CanvasRenderingContext2D; front: CanvasRenderingContext2D }, frame: AmbientFrame) => void
}

let current: AmbientLayer | null = null
const listeners = new Set<() => void>()

function notify(): void {
  // Копия: подписчик может отписаться изнутри вызова.
  for (const cb of [...listeners]) cb()
}

/** Этап 6: поставить (или снять, null) рисовальщик фона. Повторная установка того же слоя хоста не будит. */
export function setAmbientLayer(layer: AmbientLayer | null): void {
  if (current === layer) return
  current = layer
  notify()
}

export function getAmbientLayer(): AmbientLayer | null {
  return current
}

/** Этап 6: попросить хост перерисовать фон в следующем кадре (анимация). */
export function requestAmbientFrame(): void {
  notify()
}

/** Хост: подписка на setAmbientLayer и requestAmbientFrame. Возвращает отписку. */
export function subscribeAmbient(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
