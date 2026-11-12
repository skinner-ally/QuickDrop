/**
 * Чистая геометрия и правила DOM-слоя графа (без React и стора): положение коробок, ручки связи,
 * выбор цели подсказки, ширина подписи. Вынесено из компонентов, чтобы проверяться тестами в node.
 */

import type { GraphViewport } from '@/lib/graph/types'

export interface Box {
  w: number
  h: number
}

/** Вид для геометрии DOM-слоя: CSS-пиксели, dpr = 1 (на положение элементов плотность пикселей не влияет). */
export function overlayViewport(camera: GraphViewport['camera'], size: { width: number; height: number }): GraphViewport {
  return { width: size.width, height: size.height, dpr: 1, camera }
}

/**
 * Левый верхний угол коробки: сначала в anchor; не помещается справа — правым краем в flipX, не помещается
 * снизу — нижним краем в flipY; затем зажимается в сцену с запасом margin (по умолчанию 8 px).
 */
export function placeBox(
  anchor: { x: number; y: number },
  size: Box,
  view: { width: number; height: number },
  opts?: { flipX?: number; flipY?: number; margin?: number },
): { left: number; top: number } {
  // 8 px: у px-pop рама и жёсткая тень выступают ещё на 4–8 px, а слой подсказок обрезает по краю сцены.
  const m = opts?.margin ?? 8
  let left = anchor.x
  let top = anchor.y
  if (opts?.flipX !== undefined && left + size.w > view.width - m) left = opts.flipX - size.w
  if (opts?.flipY !== undefined && top + size.h > view.height - m) top = opts.flipY - size.h
  left = Math.max(m, Math.min(left, view.width - size.w - m))
  top = Math.max(m, Math.min(top, view.height - size.h - m))
  return { left: Math.round(left), top: Math.round(top) }
}

/** Квадрат ноды целиком за краем сцены (центр c, полуразмер half, CSS-пиксели). */
export function nodeOffScene(c: { x: number; y: number }, half: number, view: { width: number; height: number }): boolean {
  return c.x + half < 0 || c.x - half > view.width || c.y + half < 0 || c.y - half > view.height
}

/** Размер ручки связи, CSS-пиксели (и в «Классике», и в пиксельных сценах). */
export const HANDLE_SIZE = 20
/** Насколько ручка заходит на угол выбранной ноды, px: больше — закрывает ноду и мешает второму клику и переносу. */
export const HANDLE_OVERLAP = 4
/**
 * Ручка связи показывается с этого масштаба. Соседняя нода сетки лежит в 32·z от центра, её край — в 24·z;
 * ручка за углом выбранной ноды достаёт до 8·z − 4 + размер: 20 px помещается с масштаба 1 (ступень).
 */
export const HANDLE_MIN_ZOOM = 1

/**
 * Ручка связи — у правого нижнего угла выбранной ноды, снаружи: заходит на угол только на HANDLE_OVERLAP, центр
 * и почти весь квадрат ноды свободны для клика, двойного клика и переноса. У нижнего края сцены ручка уходит на
 * верхний угол, у правого — на левый. Соседи по сетке не закрыты. null — нода целиком за краем сцены: ручка
 * сопровождает ноду и не прилипает к краю.
 */
export function handleBox(
  c: { x: number; y: number },
  half: number,
  size: Box,
  view: { width: number; height: number },
): { left: number; top: number } | null {
  if (nodeOffScene(c, half, view)) return null
  return placeBox({ x: c.x + half - HANDLE_OVERLAP, y: c.y + half - HANDLE_OVERLAP }, size, view, {
    flipX: c.x - half + HANDLE_OVERLAP,
    flipY: c.y - half + HANDLE_OVERLAP,
    margin: 2,
  })
}

/**
 * Показывается ли ручка связи. Только в широком окне (панель деталей сбоку; в узком детали — модальный лист, и
 * сцена inert), не на касании (связь пальцем — удержание записи и «Связать с…»; 36 px ручка закрыла бы ноду и
 * соседей), с масштаба HANDLE_MIN_ZOOM и не во время жеста.
 */
export function handleVisible(s: { wide: boolean; coarse: boolean; zoom: number; dragging: boolean }): boolean {
  return s.wide && !s.coarse && !s.dragging && s.zoom >= HANDLE_MIN_ZOOM
}

/**
 * Нода, подсказку которой показать. Наведение мыши — после задержки (shownId уже совпал с hoveredId), пока
 * задержка идёт — ничего. Без наведения — нода под курсором, поставленным клавиатурой (byKeys), сразу: другого
 * видимого названия у неё нет. Курсор, оставшийся после клика мышью, подсказки не даёт: закрыли детали, и плашка
 * висела бы у ноды без наведения. Курсор на ноде, открытой в панели деталей, подсказки не получает (запись уже на
 * экране); на касании тоже.
 */
export function tooltipTarget(s: {
  hoveredId: string | null
  shownId: string | null
  cursorId: string | null
  selectedId: string | null
  coarse: boolean
  byKeys: boolean
}): string | null {
  if (s.hoveredId !== null) return s.shownId === s.hoveredId ? s.hoveredId : null
  if (s.coarse || !s.byKeys || s.cursorId === null || s.cursorId === s.selectedId) return null
  return s.cursorId
}

/** Ширина плашки подписи: текст + отступы по 4 px и разрядка между знаками (CSS-пиксели). */
export function labelBoxWidth(textWidth: number, length: number, letterSpacing: number): number {
  return textWidth + length * (Number.isFinite(letterSpacing) ? letterSpacing : 0) + 8
}

/** Оценка ширины текста без canvas: 12 px Nunito/Geist — около 7 px на знак; другие кегли — пропорционально. */
export function estimateTextWidth(length: number, fontSize: number): number {
  return length * ((Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 12) * 7) / 12
}
