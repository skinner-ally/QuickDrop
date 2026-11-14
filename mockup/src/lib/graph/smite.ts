/**
 * «Казнь» ноды на графе (макет): вместо мгновенного удаления выходит латник и рубит ноду (pixelfx, moves/node-smite).
 * Здесь — только очередь сцен и скрытые ноды; рисует и ведёт время components/graph/GraphSmite. Запись уходит в корзину
 * в момент смертельного удара обычным actDelete, поэтому «Отменить» в уведомлении работает как всегда.
 */

import { create } from 'zustand'
import { actDelete } from '@/lib/actions'
import { readGraphTheme } from '@/lib/graph/theme'
import type { GraphScene } from '@/lib/graph/types'
import type { GraphPoint } from '@/types'

/** Доля случаев, когда нода уклоняется от первого удара. */
export const SMITE_DODGE_CHANCE = 0.35
/** Больше записей за раз — без сцены: толпа рыцарей не читается и долго ждать. */
export const SMITE_MAX = 3

export interface SmiteRun {
  key: number
  id: string
  /** Центр ноды, мир (на момент начала: запись исчезнет из сцены раньше, чем уйдёт рыцарь). */
  at: GraphPoint
  /** Цвет категории и рамки ноды, '#rrggbb'. */
  color: string
  edge: string
  dodge: boolean
  seed: number
  /** Запись уже отправлена в корзину. */
  struck: boolean
}

interface SmiteState {
  runs: SmiteRun[]
  /** id нод, которые сейчас рисует сцена казни (холст графа их не рисует, подписи прячутся). */
  hidden: ReadonlySet<string>
}

export const useSmite = create<SmiteState>(() => ({ runs: [], hidden: new Set() }))

let nextKey = 1

function setRuns(runs: SmiteRun[]): void {
  // Ноду рисует сцена, пока она идёт; после удара запись в корзине и из графа уходит сама.
  useSmite.setState({ runs, hidden: new Set(runs.map((r) => r.id)) })
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * Удалить записи с графа со сценой. nodes — центр и цвета нод (их знает граф); без данных о ноде, при
 * prefers-reduced-motion и сверх SMITE_MAX запись удаляется сразу.
 */
export function smiteNodes(targets: Array<{ id: string; at: GraphPoint | null; color: string; edge: string }>): void {
  const current = useSmite.getState().runs
  const busy = new Set(current.map((r) => r.id))
  const fresh = targets.filter((t) => !busy.has(t.id))
  if (fresh.length === 0) return
  const direct: string[] = []
  const runs = [...current]
  for (const t of fresh) {
    if (!t.at || reducedMotion() || runs.length >= SMITE_MAX) {
      direct.push(t.id)
      continue
    }
    const seed = (Date.now() + nextKey * 7919) % 100_000
    runs.push({ key: nextKey++, id: t.id, at: t.at, color: t.color, edge: t.edge, dodge: Math.random() < SMITE_DODGE_CHANCE, seed, struck: false })
  }
  if (direct.length) void actDelete(direct)
  setRuns(runs)
}

/** Смертельный удар: запись — в корзину. */
export function smiteStruck(key: number): void {
  const runs = useSmite.getState().runs
  const run = runs.find((r) => r.key === key)
  if (!run || run.struck) return
  setRuns(runs.map((r) => (r.key === key ? { ...r, struck: true } : r)))
  void actDelete(run.id)
}

/** Сцена кончилась (рыцарь ушёл). Не ударил — значит сцену прервали: запись удаляется сразу. */
export function smiteFinished(key: number): void {
  const runs = useSmite.getState().runs
  const run = runs.find((r) => r.key === key)
  if (!run) return
  if (!run.struck) void actDelete(run.id)
  setRuns(runs.filter((r) => r.key !== key))
}

/** 'rgb(r, g, b)' / '#rgb' → '#rrggbb' (pixelfx читает только hex). */
function toHex(css: string | null | undefined, fallback: string): string {
  if (!css) return fallback
  if (css.startsWith('#')) return css
  const m = css.match(/\d+(\.\d+)?/g)
  if (!m || m.length < 3) return fallback
  return '#' + m.slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('')
}

/** Казнь нод графа: положение и цвета берутся из сцены и темы графа. */
export function smiteFromScene(ids: string[], scene: GraphScene): void {
  const stage = document.querySelector<HTMLElement>('[data-graph-stage]')
  const theme = stage ? readGraphTheme(stage) : null
  smiteNodes(
    ids.map((id) => {
      const i = scene.byId.get(id)
      const n = i === undefined ? undefined : scene.nodes[i]
      return {
        id,
        at: n ? { x: n.x, y: n.y } : null,
        color: toHex(n && theme ? (theme.cat[n.color] ?? theme.cat.none) : null, '#a7a294'),
        edge: toHex(theme?.nodeEdge, '#4a2416'),
      }
    }),
  )
}

/** Скрыта ли нода сценой казни (для рисования графа и подписей). */
export function isSmiteHidden(id: string): boolean {
  return useSmite.getState().hidden.has(id)
}
