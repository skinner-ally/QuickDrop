/**
 * Контракт живого фона графа (лес, пруды, листопад, лучи, снег, светлячки). Слой ставит этап 6 (`lib/ambient`,
 * контроллер) через `setAmbientLayer`; хост (`GraphCanvas`) вызывает `draw` на каждой перерисовке графа и на каждый
 * кадр фона. При `getAmbientLayer() === null` хост фоновые canvas не измеряет и не рисует.
 * Подписчик получает причину пробуждения: `'layer'` — сменился слой (перерисовать всё), `'frame'` — нужен только кадр
 * фона (граф не перерисовывается). Правила остановки анимации (скрытое окно, `prefers-reduced-motion`, выключенный
 * «Живой фон», «Классика») — `lib/ambient/scheduler.ts`.
 */

import type { DeviceTransform, GraphViewport } from '@/lib/graph/types'

/** Причина пробуждения хоста: сменился слой (перерисовать всё) или нужен только кадр фона. */
export type AmbientWake = 'layer' | 'frame'

/** Счётчики слоя для отладки и приёмки. */
export interface AmbientStats {
  /** Плиток сейчас в кэше. */
  tiles: number
  /** Пикселей решётки в кэше плиток сейчас. */
  tilePixels: number
  /** Плиток отрисовано с создания слоя. */
  rendered: number
  /** Тиков эффектов с создания слоя. */
  ticks: number
}

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
  /** Растёт, когда хост получил другую сцену графа (набор и положения нод). Нет — считать, что сцена новая каждый кадр. */
  sceneRev?: number
  /** Центры нод сцены (мир). Нет — пустой набор. */
  points?: ReadonlyArray<{ x: number; y: number }>
}

export interface AmbientLayer {
  /**
   * Хост вызывает при каждой перерисовке графа (сдвиг, масштаб, размер, сцена, набор нод) и по requestAmbientFrame().
   * Оба canvas уже нужного размера (пиксели устройства).
   */
  draw: (target: { back: CanvasRenderingContext2D; front: CanvasRenderingContext2D }, frame: AmbientFrame) => void
  /** Отладка и приёмка: хост пишет значения в data-атрибуты сцены. */
  stats?: () => AmbientStats
}

let current: AmbientLayer | null = null
const listeners = new Set<(kind: AmbientWake) => void>()

function notify(kind: AmbientWake): void {
  // Копия: подписчик может отписаться изнутри вызова.
  for (const cb of [...listeners]) cb(kind)
}

/** Поставить (или снять, null) рисовальщик фона. Повторная установка того же слоя хоста не будит. */
export function setAmbientLayer(layer: AmbientLayer | null): void {
  if (current === layer) return
  current = layer
  notify('layer')
}

export function getAmbientLayer(): AmbientLayer | null {
  return current
}

/** Попросить хост нарисовать кадр фона (анимация, дорисовка плиток); граф при этом не перерисовывается. */
export function requestAmbientFrame(): void {
  notify('frame')
}

/**
 * Хост: подписка на setAmbientLayer (`'layer'`) и requestAmbientFrame (`'frame'`). Возвращает отписку.
 * Подписчик без параметра тоже годится (прежний контракт этапа 5).
 */
export function subscribeAmbient(cb: (kind: AmbientWake) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
