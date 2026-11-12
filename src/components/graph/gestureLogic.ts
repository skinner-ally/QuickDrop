/**
 * Чистые правила жестов и холста графа (без DOM и стора): размер битмапа, подстройка камеры под сдвиг краёв
 * сцены, пороги жеста, обход соседей по Tab, частичное обнуление буфера связей.
 */

/** Сдвиг указателя, после которого нажатие мышью или пером становится жестом, CSS-пиксели. */
export const MOUSE_MOVE_PX = 4
/** То же для пальца: палец дрожит при касании и удержании сильнее (системный допуск 8–10 px). */
export const TOUCH_MOVE_PX = 10

export function movePx(touch: boolean): number {
  return touch ? TOUCH_MOVE_PX : MOUSE_MOVE_PX
}

/**
 * Нажатие или жест без нажатой кнопки: кнопку отпустили там, где сцена pointerup не получила (вне сцены до
 * захвата, при неактивном окне). Касание без кнопок не бывает, его не трогаем.
 */
export function buttonsReleased(pointerType: string, buttons: number): boolean {
  return pointerType !== 'touch' && buttons === 0
}

/**
 * Откладывать ли выбор ноды одиночным кликом: только мышью/пером и только там, где выбор меняет то, что под
 * указателем, — иначе второй клик двойного клика попадает не в сцену.
 * - Окно уже 1100 px (sidePanel = false): детали открываются модальным листом с подложкой — всегда.
 * - Окно шире, панель сбоку: панель закрыта (panelOpen = false) и клик в её полосе у правого края окна
 *   (underPanel) — панель встанет под указатель. Уже открытая панель раскладку не двигает, клик левее полосы
 *   панели остаётся на сцене: выбор сразу.
 */
export function deferSelect(touch: boolean, sidePanel: boolean, panelOpen = true, underPanel = false): boolean {
  if (touch) return false
  if (!sidePanel) return true
  return !panelOpen && underPanel
}

/** Клик в полосе боковой панели деталей (запас на рамку и отступы): clientX — координата окна, innerWidth — его ширина. */
export function underDetailPanel(clientX: number, innerWidth: number, asidePx: number, slackPx = 16): boolean {
  return Number.isFinite(clientX) && Number.isFinite(innerWidth) && clientX > innerWidth - asidePx - slackPx
}

/**
 * Размер битмапа canvas в пикселях устройства. Точный размер из devicePixelContentBoxSize, если браузер его дал:
 * при дробном dpr коробка canvas привязывается к пикселям устройства с учётом её положения, и round(css·dpr)
 * может отличаться на 1 px — тогда браузер растягивает буфер. Иначе — round(css·dpr). Негодное → 0.
 */
export function bitmapSize(
  cssW: number,
  cssH: number,
  dpr: number,
  device?: { inlineSize: number; blockSize: number },
): { W: number; H: number } {
  const ok = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0)
  if (device) return { W: ok(device.inlineSize), H: ok(device.blockSize) }
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
  return { W: ok(cssW * d), H: ok(cssH * d) }
}

export interface StageRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Доля сцены (для setViewSize/resizeCamera), которая остаётся на месте при смене размера: содержимое не
 * двигается на экране, какой бы край сцены ни сдвинулся. Справа открылась панель — левый край на месте (0);
 * сверху появилась строка фильтров — на месте нижний край (1). Без прежней рамки — левый верхний угол.
 * Доли пикселя (дробный contentRect против целого clientWidth, масштаб Windows 125–150 %) — центр: камера не
 * уползает от замера к замеру.
 */
export function resizeKeep(prev: StageRect | null, next: StageRect): { x: number; y: number } {
  if (!prev) return { x: 0, y: 0 }
  const axis = (d0: number, d1: number, s0: number, s1: number) => {
    const ds = s1 - s0
    const dl = d1 - d0
    if (!Number.isFinite(ds) || !Number.isFinite(dl) || ds === 0) return 0
    if (Math.abs(ds) < 1 && Math.abs(dl) < 1) return 0.5
    return -dl / ds
  }
  return {
    x: axis(prev.left, next.left, prev.width, next.width),
    y: axis(prev.top, next.top, prev.height, next.height),
  }
}

/**
 * Обход соседей по Tab: позиция следующего соседа в order длины len или null — обход закончен, клавиша не
 * перехватывается и фокус уходит дальше по странице (Tab не ловушка). at — текущая позиция (−1 — обход не начат).
 */
export function tabRingNext(len: number, at: number, back: boolean): number | null {
  if (!(len > 0)) return null
  if (at < 0 || at >= len) return back ? len - 1 : 0
  const next = at + (back ? -1 : 1)
  return next < 0 || next >= len ? null : next
}

/** Рамка пикселей буфера [x0, x1) × [y0, y1). */
export interface PixelRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Обнулить в буфере шириной width только рамку r (прошлые связи), а не весь буфер. */
export function clearRect32(data: Uint32Array, width: number, r: PixelRect): void {
  const height = width > 0 ? Math.floor(data.length / width) : 0
  const x0 = Math.max(0, r.x0)
  const x1 = Math.min(width, r.x1)
  const y0 = Math.max(0, r.y0)
  const y1 = Math.min(height, r.y1)
  if (!(x1 > x0) || !(y1 > y0)) return
  for (let y = y0; y < y1; y++) data.fill(0, y * width + x0, y * width + x1)
}
