// Типы сцены «казни» ноды (node-smite.js).
import type { PxPainter } from '../../core/index.js'

type Act = { poses: Array<[number, Record<string, unknown>]>; [k: string]: unknown }
/** Расстояние от ног рыцаря до центра ноды, пиксели сцены. */
export const TX: number
export const meta: { duration?: number; loop?: boolean; [k: string]: unknown }
export const act: Act
export const actDodge: Act
/** Время сцены, когда нода гибнет: с уклонением — после второго удара. */
export function deathAt(dodge: boolean): number
export function drawNodeIdle(p: PxPainter, o: Record<string, unknown>): void
export function create(o: Record<string, unknown>): unknown
