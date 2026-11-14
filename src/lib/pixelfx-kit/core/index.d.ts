// Типы для той части ядра pixelfx (JS, MIT), которую использует приложение: сцена казни ноды на графе.
export interface PxFrame {
  w: number
  h: number
  ox: number
  oy: number
  color: Uint32Array
  light: Uint32Array
}
/** Модуль эффекта pixelfx: meta, draw/create и необязательный act. */
export interface PxEffect {
  meta?: { duration?: number; loop?: boolean; [k: string]: unknown }
  act?: { poses: Array<[number, Record<string, unknown>]>; [k: string]: unknown }
  [k: string]: unknown
}
export interface PxAct {
  t: number
  shake: [number, number]
  update(dt: number): void
  draw(frame: PxFrame): void
  done(): boolean
}
/** Рисовальщик pixelfx; place задаёт начало координат эффекта. */
export interface PxPainter {
  place(x: number, y: number, flip: boolean): PxPainter
  [k: string]: unknown
}
export function createFrame(w: number, h: number, ox?: number, oy?: number): PxFrame
export function clearFrame(f: PxFrame): PxFrame
export function composite(f: PxFrame, out: Uint8ClampedArray, bg?: number | Uint8ClampedArray | null, lightK?: number): Uint8ClampedArray
export function painterFor(frame: PxFrame): PxPainter
export function createAct(mod: PxEffect, o?: Record<string, unknown>): PxAct
export function actSpan(mod: PxEffect): { from: number; to: number }
