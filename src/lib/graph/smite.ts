/**
 * «Казнь» ноды на графе (макет): вместо мгновенного удаления выходит латник и рубит ноду (pixelfx, moves/node-smite).
 * Здесь — только очередь сцен и скрытые ноды; рисует и ведёт время components/graph/GraphSmite. Запись уходит в корзину
 * в момент смертельного удара обычным actDelete, поэтому «Отменить» в уведомлении работает как всегда.
 */

import { create } from 'zustand'
import { actDelete } from '@/lib/actions'
import { readGraphTheme } from '@/lib/graph/theme'
import { useGraph } from '@/store/graph'
import { useUi } from '@/store/ui'
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

/**
 * Граф ушёл с экрана (раздел сменили, сцену заменила пустая заглушка): сцены больше некому вести. Запись, по которой
 * удар ещё не пришёлся, удаляется сразу — удаление не должно ни потеряться, ни случиться позже само.
 */
export function smiteAbortAll(): void {
  const runs = useSmite.getState().runs
  if (runs.length === 0) return
  const pending = runs.filter((r) => !r.struck).map((r) => r.id)
  setRuns([])
  if (pending.length) void actDelete(pending)
}

/** 'rgb(r, g, b)' → '#rrggbb' (pixelfx читает только hex). */
function rgbToHex(css: string): string | null {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(css)
  if (!m) return null
  return '#' + m.slice(1, 4).map((v) => Math.max(0, Math.min(255, Math.round(Number(v)))).toString(16).padStart(2, '0')).join('')
}

let probe: CanvasRenderingContext2D | null | undefined

/** Любой цвет CSS (в «Классике» — oklch) → '#rrggbb'; не hex и не rgb — через холст 1×1. */
function toHex(css: string | null | undefined, fallback: string): string {
  if (!css) return fallback
  if (/^#[0-9a-f]{6}$/i.test(css)) return css
  const rgb = rgbToHex(css)
  if (rgb) return rgb
  try {
    if (probe === undefined) {
      const c = document.createElement('canvas')
      c.width = c.height = 1
      probe = c.getContext('2d', { willReadFrequently: true })
    }
    if (!probe) return fallback
    probe.clearRect(0, 0, 1, 1)
    probe.fillStyle = '#000'
    probe.fillStyle = css
    probe.fillRect(0, 0, 1, 1)
    const [r, g, b] = probe.getImageData(0, 0, 1, 1).data
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
  } catch {
    return fallback
  }
}

/** Казнь нод графа: положение и цвета берутся из сцены и темы графа. */
export function smiteFromScene(ids: string[], scene: GraphScene): void {
  // Нода уходит в сцену: выбор, курсор и меню с неё снимаются, чтобы по невидимой ноде нельзя было действовать.
  const gone = new Set(ids)
  const ui = useUi.getState()
  if (ui.selectedId !== null && gone.has(ui.selectedId)) ui.select(null)
  const g = useGraph.getState()
  if (g.cursorId !== null && gone.has(g.cursorId)) g.setCursor(null)
  if (g.menu !== null) g.openMenu(null)
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
