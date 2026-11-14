import type { GraphPoint } from '@/types'
import { GRAPH_CELL } from './graphLayout'
import { MAX_GRAPH_COORD } from './normalize'

/**
 * Шаг сетки графа до редизайна (0.2.1 и раньше). На нём стоят положения в базе схемы v2 и в резервных копиях
 * форматов 1–2: без переноса ноды нового размера на старом шаге стояли бы почти вплотную.
 */
export const LEGACY_GRAPH_CELL = 32

/** Точка со старой сетки на нынешнюю: масштаб GRAPH_CELL / LEGACY_GRAPH_CELL, узел сетки остаётся узлом. */
export function upgradeLegacyPoint(p: GraphPoint): GraphPoint {
  const k = GRAPH_CELL / LEGACY_GRAPH_CELL
  const fit = (v: number): number => Math.max(-MAX_GRAPH_COORD, Math.min(MAX_GRAPH_COORD, Math.round(v * k))) + 0
  return { x: fit(p.x), y: fit(p.y) }
}

let upgradedThisSession = false

/** Отмечает, что база только что перенесена на новую сетку (зовёт upgrade схемы v3). */
export function markLegacyGridUpgraded(): void {
  upgradedThisSession = true
}

/**
 * Сохранённая камера стоит в мировых координатах старой сетки: после переноса граф один раз вписывается целиком.
 * true — только при первом вызове после переноса.
 */
export function takeLegacyGridUpgraded(): boolean {
  const was = upgradedThisSession
  upgradedThisSession = false
  return was
}

/**
 * То же для положения из чужой копии, где поля могут быть чем угодно: масштабируются только конечные числа,
 * остальное остаётся как есть и отсеивается проверкой положения.
 */
export function upgradeLegacyRawPosition(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw
  const { x, y } = raw as { x?: unknown; y?: unknown }
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) return raw
  return { ...raw, ...upgradeLegacyPoint({ x, y }) }
}
