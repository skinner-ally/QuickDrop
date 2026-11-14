/**
 * Чистые правила взаимодействия со сценой графа: память о клике по ноде (двойной клик) и когда вести камеру
 * к выбранной ноде. Без DOM и стора: решения принимают жесты и GraphView.
 */

import type { GraphPoint } from '@/types'

/** Наибольший промежуток между кликами двойного клика, мс (по умолчанию Windows). */
export const GRAPH_DBL_MS = 500
/** Наибольший сдвиг указателя между кликами двойного клика, CSS-пиксели. */
export const GRAPH_DBL_PX = 8
/**
 * Ширина боковой панели деталей, CSS-пиксели (AppShell и жесты графа: клик в этой полосе окна открывает панель
 * прямо под указателем).
 */
export const DETAIL_ASIDE_PX = 460
/**
 * Задержка выбора ноды одиночным кликом там, где выбор меняет то, что под указателем: открывает модальный лист
 * деталей или боковую панель на месте ноды. Не короче GRAPH_DBL_MS, иначе медленный двойной клик попадёт в
 * подложку листа или в панель. Второе нажатие и двойной клик отменяют отложенный выбор.
 */
export const GRAPH_SELECT_DEFER_MS = GRAPH_DBL_MS

/**
 * Последний клик по ноде: id и точка указателя (CSS-пиксели сцены) в момент t (мс, performance.now); camera и
 * viewSize — ссылки из стора графа на момент клика (стор заменяет объект при любой смене, по ссылке видно,
 * сдвигалась ли сцена).
 */
export interface NodeClickMemo {
  id: string
  x: number
  y: number
  t: number
  camera: unknown
  viewSize: unknown
}

/**
 * Нода второго клика двойного клика — по памяти о первом, а не по тому, что сейчас под указателем: после
 * первого клика сцена могла сузиться (открылась панель деталей) или камера сдвинулась к ноде у края.
 * null — память устарела (дольше GRAPH_DBL_MS), указатель ушёл дальше GRAPH_DBL_PX, памяти нет или сцена с
 * первого клика не менялась (view — те же camera и viewSize): тогда под указателем честно та нода, что есть, а на
 * мелком масштабе это может быть соседняя (шаг сетки 8 px на 25 %).
 */
export function secondClickNode(
  prev: NodeClickMemo | null,
  p: GraphPoint,
  now: number,
  view: { camera: unknown; viewSize: unknown },
): string | null {
  if (!prev) return null
  const dt = now - prev.t
  if (!(dt >= 0) || dt > GRAPH_DBL_MS) return null
  if (!(Math.hypot(p.x - prev.x, p.y - prev.y) <= GRAPH_DBL_PX)) return null
  if (prev.camera === view.camera && prev.viewSize === view.viewSize) return null
  return prev.id
}

/**
 * Что было, когда выбранная нода показывалась в последний раз: нода, её место, размер сцены и номер изменения
 * камеры (useGraph.cameraRev — растёт при каждом сдвиге и масштабе, но не при подстройке под размер сцены).
 */
export interface RevealMemo {
  id: string
  x: number
  y: number
  width: number
  height: number
  cameraRev: number
}

/**
 * Вести ли камеру к выбранной ноде (ensureVisible) и что запомнить.
 * - Новая выбранная нода — да. Нода переехала (смена категории, перенос мышью, откат неудачной записи) — да, но
 *   с moved: true: вызывающий ведёт камеру только если нода ушла за край сцены (запас 0), иначе бросок ноды
 *   к краю рывком центрировал бы вид.
 * - Сменился только размер сцены — да, пока пользователь не двигал камеру после показа (открытие панели
 *   деталей сужает сцену сразу после выбора). Сдвинул или масштабировал — нет, и до нового выбора больше нет:
 *   иначе строка фильтров или ресайз окна рывком возвращали бы вид к ноде.
 * - Иначе (сменилась только сцена) — нет.
 * memo при reveal = cur: после своего setCamera вызывающий записывает в него свежий cameraRev.
 */
export function revealDecision(
  prev: RevealMemo | null,
  cur: RevealMemo,
): { reveal: boolean; memo: RevealMemo; moved: boolean } {
  if (!prev || prev.id !== cur.id) return { reveal: true, memo: cur, moved: false }
  if (prev.x !== cur.x || prev.y !== cur.y) return { reveal: true, memo: cur, moved: true }
  if (prev.width === cur.width && prev.height === cur.height) return { reveal: false, memo: prev, moved: false }
  if (prev.cameraRev === cur.cameraRev) return { reveal: true, memo: cur, moved: false }
  // Номер камеры остаётся прежним: следующая смена размера тоже не вернёт вид к ноде.
  return { reveal: false, memo: { ...prev, width: cur.width, height: cur.height }, moved: false }
}
