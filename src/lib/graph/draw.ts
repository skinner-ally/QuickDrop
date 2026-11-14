/**
 * Рисование графа: чистые функции «сцена → вызовы canvas». Хост (GraphCanvas) готовит canvas, буфер связей и тему
 * и вызывает их на каждый кадр. Все координаты — целые пиксели устройства: X = ox + round(x · k) (deviceTransform).
 *
 * Невидимое отсекается: ноды — пространственным индексом сцены, связи — отсечением Лианга — Барски (рисуется только
 * видимая часть отрезка, шаги до неё не перебираются).
 */

import { GRAPH_CELL, GRAPH_NODE_SIZE } from '@/lib/graphLayout'
import { deviceTransform, queryBounds, visibleBounds } from './geometry'
import { useSmite } from './smite'
import { GRAPH_ALPHA_ARCHIVED, GRAPH_ALPHA_DIM } from './types'
import type { DeviceTransform, DrawState, GraphNode, GraphScene, GraphTheme, GraphViewport } from './types'

/** Прямоугольник пикселей буфера [x0, x1) × [y0, y1). */
export interface DirtyRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Буфер связей пиксельных сцен: data — вид Uint32Array на ImageData.data.buffer (width × height пикселей). */
export interface LinkBuffer {
  width: number
  height: number
  data: Uint32Array
  /**
   * Заполняет drawLinksPixel: рамка всех пикселей, записанных этим вызовом; undefined — не записано ничего.
   * Хост может обнулять перед следующим кадром только её и выгружать только её (putImageData с dirty-параметрами).
   */
  dirty?: DirtyRect
}

/** Альфа ноды, которую тянут, на её прежнем месте. */
const DRAG_GHOST_ALPHA = 0.3
/** Запас видимой области для нод, CSS-пиксели: рамки выделения и тень не обрываются у края. */
const NODE_MARGIN_PX = 32

/**
 * Сторона «пикселя» связи в пикселях устройства. Не растёт вместе с масштабом: на 200 % прежняя связь
 * (2·zoom «пикселя» с кромкой) занимала четверть ноды. Теперь от 150 % — 2 px экрана, ниже — 1 px.
 */
export function linkUnit(zoom: number, dpr: number): number {
  const u = Math.round((zoom >= 1.5 ? 2 : 1) * dpr)
  return Number.isFinite(u) && u > 1 ? u : 1
}

/** Ниже 50 % нода не меньше этого размера (CSS-пиксели) и обведена: иначе на обзоре она теряется в лесу. */
const OVERVIEW_NODE_PX = 12

/** Множитель альфы обычных и приглушённых связей на самой мелкой ступени (12,5 %). */
export const LINK_ZOOM_ALPHA_MIN = 0.35

/**
 * Множитель альфы обычных и приглушённых связей от масштаба: 1 от 100 %, вниз — по log2 до LINK_ZOOM_ALPHA_MIN на
 * 12,5 % (0.25 → ≈0.57, 0.5 → ≈0.78). На мелком масштабе на экран попадают тысячи связей, и без этого они сливаются
 * в сплошную штриховку поверх земли. Горячие связи не ослабляются.
 */
export function linkZoomAlpha(zoom: number): number {
  if (!(zoom > 0) || zoom >= 1) return 1
  const f = LINK_ZOOM_ALPHA_MIN + ((1 - LINK_ZOOM_ALPHA_MIN) * Math.log2(zoom / 0.125)) / 3
  return Math.min(1, Math.max(LINK_ZOOM_ALPHA_MIN, f))
}

// ───────────────────────── общее ─────────────────────────

// Порядок байтов Uint32Array поверх ImageData (как в theme.packRgba): альфа — старший байт на little-endian.
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1

function alphaByte(c: number): number {
  return LITTLE_ENDIAN ? c >>> 24 : c & 0xff
}

/** Тот же цвет с альфой × f. ImageData не premultiplied — достаточно поменять байт альфы. */
function scaleAlpha(c: number, f: number): number {
  const a = Math.min(255, Math.max(0, Math.round(alphaByte(c) * f)))
  return LITTLE_ENDIAN ? ((c & 0x00ffffff) | (a << 24)) >>> 0 : ((c & 0xffffff00) | a) >>> 0
}

function mod(a: number, n: number): number {
  return ((a % n) + n) % n
}

// Результат отсечения: доли отрезка [t0, t1] внутри прямоугольника. Один буфер на модуль — без аллокаций на связь.
const CLIP = new Float64Array(2)

/** Отсечение Лианга — Барски отрезка (x0, y0)–(x1, y1) прямоугольником. false — отрезок снаружи. */
function clipSegment(
  x0: number, y0: number, x1: number, y1: number,
  minX: number, minY: number, maxX: number, maxY: number,
): boolean {
  let t0 = 0
  let t1 = 1
  const dx = x1 - x0
  const dy = y1 - y0
  const edge = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
    return true
  }
  if (!edge(-dx, x0 - minX) || !edge(dx, maxX - x0) || !edge(-dy, y0 - minY) || !edge(dy, maxY - y0)) return false
  CLIP[0] = t0
  CLIP[1] = t1
  return true
}

/** Горячие ноды: выбранная, наведённая и под курсором клавиатуры — их связи рисуются золотом. */
function hotNodeSet(scene: GraphScene, state: DrawState): Set<number> {
  const hot = new Set<number>()
  for (const id of [state.selectedId, state.hoveredId, state.cursorId]) {
    if (id === null) continue
    const i = scene.byId.get(id)
    if (i !== undefined) hot.add(i)
  }
  return hot
}

type LinkKind = 'dim' | 'normal' | 'hot'

/** Разбор связей по проходам: приглушённые → обычные → горячие (горячие не приглушаются). */
function classifyLinks(scene: GraphScene, state: DrawState): { dim: number[]; normal: number[]; hot: number[] } {
  const hotNodes = hotNodeSet(scene, state)
  let ha = -1
  let hb = -1
  if (state.hotLink) {
    ha = scene.byId.get(state.hotLink.a) ?? -1
    hb = scene.byId.get(state.hotLink.b) ?? -1
  }
  const out = { dim: [] as number[], normal: [] as number[], hot: [] as number[] }
  const links = scene.links
  for (let i = 0; i < links.length; i++) {
    const l = links[i]
    let kind: LinkKind = l.dim ? 'dim' : 'normal'
    if (hotNodes.has(l.a) || hotNodes.has(l.b) || (ha >= 0 && hb >= 0 && ((l.a === ha && l.b === hb) || (l.a === hb && l.b === ha)))) {
      kind = 'hot'
    }
    out[kind].push(i)
  }
  return out
}

/** Протягиваемая связь: от центра ноды к точке мира. null — нет или нода не в сцене. */
function tempSegment(scene: GraphScene, state: DrawState): { from: GraphNode; x: number; y: number } | null {
  const temp = state.tempLink
  if (!temp || !Number.isFinite(temp.x) || !Number.isFinite(temp.y)) return null
  const i = scene.byId.get(temp.fromId)
  return i === undefined ? null : { from: scene.nodes[i], x: temp.x, y: temp.y }
}

// ───────────────────────── связи: пиксельные сцены ─────────────────────────

// Буфер блоков (u > 1): один на модуль, растёт по необходимости; между вызовами — нули.
let blockScratch = new Uint32Array(0)
let blockScratchDirty = false

/**
 * Пиксельные сцены: связи в буфер (хост перед вызовом обнуляет data — целиком или по прошлой buf.dirty).
 * Возвращает число нарисованных связей (с видимой частью; протягиваемая тоже считается) и пишет в buf.dirty рамку
 * записанных пикселей.
 *
 * Решётка «пикселей» привязана к миру: блок (i, j) занимает u×u пикселей устройства с углом
 * (ox mod u + i·u, oy mod u + j·u), поэтому при сдвиге связи едут вместе с нодами. Линия — Брезенхэм по номерам
 * блоков между центрами нод; номер шага s отсчитывается от начала связи и не зависит от отсечения — узор чередования
 * и пунктира при сдвиге не «ползёт». У каждой связи тёмная кромка (3×3 блока вокруг шага, как в мокапе): светлые
 * цвета верёвки на дневной земле без неё не читаются.
 */
export function drawLinksPixel(
  buf: LinkBuffer, scene: GraphScene, v: GraphViewport, theme: GraphTheme, state: DrawState,
): number {
  buf.dirty = undefined
  const W = Math.floor(buf.width)
  const H = Math.floor(buf.height)
  if (!(W > 0) || !(H > 0) || buf.data.length < W * H) return 0
  const data = buf.data
  const t = deviceTransform(v)
  const u = linkUnit(v.camera.zoom, v.dpr)
  const bx = mod(t.ox, u)
  const by = mod(t.oy, u)

  // Видимые номера блоков с запасом: 1 блок — кромка, 0.5 — отклонение Брезенхэма от прямой.
  const ciMin = Math.floor(-bx / u) - 1.5
  const ciMax = Math.floor((W - 1 - bx) / u) + 1.5
  const cjMin = Math.floor(-by / u) - 1.5
  const cjMax = Math.floor((H - 1 - by) / u) + 1.5

  const blockI = (wx: number): number => Math.floor((t.ox + Math.round(wx * t.k) - bx) / u)
  const blockJ = (wy: number): number => Math.floor((t.oy + Math.round(wy * t.k) - by) / u)

  /*
   * При u > 1 линии пишутся в буфер блоков (один элемент на блок u×u), и в конце видимые блоки разворачиваются в
   * пиксели построчно. Запись блока прямо в пиксели — u строк по u пикселей в разных строках кадра; на нагрузке §6
   * (1600×1000, dpr 1.5, 100 %) с кромками это ~90 мс на кадр против ~35 мс через буфер блоков (замер в Node).
   * При u = 1 буфер блоков — сам кадр.
   */
  const iBase = bx > 0 ? -1 : 0
  const jBase = by > 0 ? -1 : 0
  const BW = Math.floor((W - 1 - bx) / u) - iBase + 1
  const BH = Math.floor((H - 1 - by) / u) - jBase + 1
  const direct = u === 1
  if (!direct) {
    if (blockScratch.length < BW * BH) blockScratch = new Uint32Array(BW * BH)
    // Прошлый вызов оборвался исключением — буфер блоков не дочищен.
    else if (blockScratchDirty) blockScratch.fill(0)
    blockScratchDirty = true
  }
  const tgt = direct ? data : blockScratch

  // Рамка записанного в номерах буфера блоков (включительно).
  let da0 = BW
  let db0 = BH
  let da1 = -1
  let db1 = -1

  /** Один блок (i, j); запись только внутри буфера. */
  const put = (i: number, j: number, color: number): void => {
    const a = i - iBase
    const b = j - jBase
    if (a < 0 || a >= BW || b < 0 || b >= BH) return
    tgt[b * BW + a] = color
    if (a < da0) da0 = a
    if (a > da1) da1 = a
    if (b < db0) db0 = b
    if (b > db1) db1 = b
  }

  // Ориентация текущего отрезка walk: главная ось — x (wX) и её направление (wD). Читает кромка.
  let wX = true
  let wD = 1

  /**
   * Шаги Брезенхэма от блока (i0, j0) к (i1, j1), только видимая часть. Точка шага s по главной оси:
   * поперечное смещение = floor((2·s·minor + major) / (2·major)) — то же, что у классического Брезенхэма,
   * поэтому начать можно с любого шага. false — отрезок не виден.
   *
   * edge — шаг идёт в edgeVisit, иначе в coreVisit. Не колбэком: вызов разных замыканий из одного места V8 не
   * встраивает, и на нагрузке §6 это заметная доля кадра.
   */
  const walk = (i0: number, j0: number, i1: number, j1: number, edge: boolean): boolean => {
    if (!clipSegment(i0, j0, i1, j1, ciMin, cjMin, ciMax, cjMax)) return false
    const di = i1 - i0
    const dj = j1 - j0
    const adi = Math.abs(di)
    const adj = Math.abs(dj)
    const n = Math.max(adi, adj)
    if (n === 0) {
      wX = true
      wD = 1
      if (edge) edgeVisit(i0, j0, 0)
      else coreVisit(i0, j0, 0)
      return true
    }
    const xMajor = adi >= adj
    const major = n
    const minor = xMajor ? adj : adi
    const sMaj = xMajor ? Math.sign(di) : Math.sign(dj)
    const sMin = xMajor ? Math.sign(dj) : Math.sign(di)
    wX = xMajor
    wD = sMaj
    const twoMaj = 2 * major
    const twoMin = 2 * minor
    let s = Math.max(0, Math.floor(CLIP[0] * n) - 1)
    const end = Math.min(n, Math.ceil(CLIP[1] * n) + 1)
    const num = s * twoMin + major
    let m = Math.floor(num / twoMaj)
    let rem = num - m * twoMaj
    for (; s <= end; s++) {
      const i = xMajor ? i0 + sMaj * s : i0 + sMin * m
      const j = xMajor ? j0 + sMin * m : j0 + sMaj * s
      if (edge) edgeVisit(i, j, s)
      else coreVisit(i, j, s)
      rem += twoMin
      if (rem >= twoMaj) {
        rem -= twoMaj
        m++
      }
    }
    return true
  }

  // Сердцевина: цвет чередуется через два шага, у связи между зонами шаги s % 8 ≥ 5 пропускаются.
  let cC0 = 0
  let cC1 = 0
  let cCross = false
  const coreVisit = (i: number, j: number, s: number): void => {
    if (cCross && (s & 7) >= 5) return
    put(i, j, (s >> 1) & 1 ? cC1 : cC0)
  }
  const coreLine = (i0: number, j0: number, i1: number, j1: number, cross: boolean, c0: number, c1: number): boolean => {
    cC0 = c0
    cC1 = c1
    cCross = cross
    return walk(i0, j0, i1, j1, false)
  }

  /*
   * Кромка — объединение квадратов 3×3 блока вокруг шагов линии (пропущенные шаги пунктира не в счёт). Квадрат на
   * каждый шаг писал бы каждый пиксель кромки трижды, поэтому на шаг пишется полоса 1×3 поперёк главной оси, при
   * смене поперечной координаты — по блоку с двух сторон, у концов непрерывного участка — ещё по полосе. Результат
   * побайтно тот же, что у квадратов (проверяет тест).
   */
  let eOn = false
  let ePi = 0
  let ePj = 0
  let eColor = 0
  let eCross = false
  /** Три блока поперёк главной оси с центром (i, j): то же, что три put, но с одной проверкой границ. */
  const strip = (i: number, j: number): void => {
    let a0: number
    let a1: number
    let b0: number
    let b1: number
    if (wX) {
      a0 = a1 = i - iBase
      b0 = j - 1 - jBase
      b1 = b0 + 2
    } else {
      b0 = b1 = j - jBase
      a0 = i - 1 - iBase
      a1 = a0 + 2
    }
    if (a0 < 0) a0 = 0
    if (a1 >= BW) a1 = BW - 1
    if (b0 < 0) b0 = 0
    if (b1 >= BH) b1 = BH - 1
    if (a0 > a1 || b0 > b1) return
    const c = eColor
    if (wX) for (let p = b0 * BW + a0, e = b1 * BW + a0; p <= e; p += BW) tgt[p] = c
    else for (let p = b0 * BW + a0, e = b0 * BW + a1; p <= e; p++) tgt[p] = c
    if (a0 < da0) da0 = a0
    if (a1 > da1) da1 = a1
    if (b0 < db0) db0 = b0
    if (b1 > db1) db1 = b1
  }
  const capAfter = (): void => {
    if (wX) strip(ePi + wD, ePj)
    else strip(ePi, ePj + wD)
  }
  const edgeVisit = (i: number, j: number, s: number): void => {
    if (eCross && (s & 7) >= 5) {
      if (eOn) capAfter()
      eOn = false
      return
    }
    if (!eOn) {
      if (wX) strip(i - wD, j)
      else strip(i, j - wD)
    } else if (wX) {
      if (j !== ePj) {
        const d = j - ePj
        put(i, j - 2 * d, eColor)
        put(ePi, j + d, eColor)
      }
    } else if (i !== ePi) {
      const d = i - ePi
      put(i - 2 * d, j, eColor)
      put(i + d, ePj, eColor)
    }
    strip(i, j)
    eOn = true
    ePi = i
    ePj = j
  }
  const edgeLine = (i0: number, j0: number, i1: number, j1: number, cross: boolean, color: number): void => {
    eOn = false
    eColor = color
    eCross = cross
    walk(i0, j0, i1, j1, true)
    if (eOn) capAfter()
  }

  const nodes = scene.nodes
  const links = scene.links
  const { dim, normal, hot } = classifyLinks(scene, state)
  const zf = linkZoomAlpha(v.camera.zoom)
  let drawn = 0

  // Обычные и приглушённые: сначала кромки всей группы, затем сердцевины — кромка соседней связи не перекрывает
  // сердцевину. Цвет сердцевины чередуется через два шага; между зонами — пунктир (шаги s % 8 ≥ 5 пропускаются
  // вместе с кромкой). При u = 1 (одна точка экрана на «пиксель» связи) кромки у них нет: второй проход по всем
  // связям вдвое замедлял кадр на мелком масштабе (12,5–50 % при dpr 1), поэтому сердцевина там рисуется цветом
  // кромки — иначе тонкая линия пропадает на дневной земле. У горячих связей кромка остаётся.
  // От 100 % кромка есть и при u = 1: связь — тонкая верёвка 3 px (кромка, сердцевина, кромка). Ниже 100 % при
  // u = 1 кромки нет (цена кадра на обзоре), сердцевина рисуется цветом кромки.
  const edgeAtUnit = v.camera.zoom >= 1
  const plain = (list: number[], c0: number, c1: number, edge: number): void => {
    if (list.length === 0) return
    if ((!direct || edgeAtUnit) && alphaByte(edge) > 0) {
      for (const li of list) {
        const l = links[li]
        const a = nodes[l.a]
        const b = nodes[l.b]
        edgeLine(blockI(a.x), blockJ(a.y), blockI(b.x), blockJ(b.y), l.cross, edge)
      }
    }
    for (const li of list) {
      const l = links[li]
      const a = nodes[l.a]
      const b = nodes[l.b]
      if (coreLine(blockI(a.x), blockJ(a.y), blockI(b.x), blockJ(b.y), l.cross, c0, c1)) drawn++
    }
  }
  const fDim = GRAPH_ALPHA_DIM * zf
  const edgeCore = direct && !edgeAtUnit && alphaByte(theme.linkEdge) > 0
  const dimEdge = scaleAlpha(theme.linkEdge, fDim)
  const normalEdge = scaleAlpha(theme.linkEdge, zf)
  const dimThin = scaleAlpha(theme.linkThin, fDim)
  const normalThin = scaleAlpha(theme.linkThin, zf)
  plain(
    dim,
    edgeCore ? dimThin : scaleAlpha(theme.link, fDim),
    edgeCore ? dimThin : scaleAlpha(theme.linkAlt, fDim),
    dimEdge,
  )
  plain(
    normal,
    edgeCore ? normalThin : scaleAlpha(theme.link, zf),
    edgeCore ? normalThin : scaleAlpha(theme.linkAlt, zf),
    normalEdge,
  )

  // Горячие: так же кромки, затем сердцевины; без пунктира, приглушения и ослабления от масштаба.
  const segments: Array<[number, number, number, number]> = []
  for (const li of hot) {
    const l = links[li]
    const a = nodes[l.a]
    const b = nodes[l.b]
    segments.push([blockI(a.x), blockJ(a.y), blockI(b.x), blockJ(b.y)])
  }
  const temp = tempSegment(scene, state)
  if (temp) segments.push([blockI(temp.from.x), blockJ(temp.from.y), blockI(temp.x), blockJ(temp.y)])
  if (segments.length > 0) {
    const edge = theme.linkEdge
    if (alphaByte(edge) > 0) {
      for (const [i0, j0, i1, j1] of segments) edgeLine(i0, j0, i1, j1, false, edge)
    }
    const core = theme.linkHot
    for (const [i0, j0, i1, j1] of segments) {
      if (coreLine(i0, j0, i1, j1, false, core, core)) drawn++
    }
  }

  if (da1 < da0) {
    blockScratchDirty = false
    return drawn
  }
  // Рамка в пикселях: блоки на краю видны частично.
  const x0 = Math.max(0, bx + (da0 + iBase) * u)
  const x1 = Math.min(W, bx + (da1 + 1 + iBase) * u)
  const y0 = Math.max(0, by + (db0 + jBase) * u)
  const y1 = Math.min(H, by + (db1 + 1 + jBase) * u)
  buf.dirty = { x0, y0, x1, y1 }
  if (direct) return drawn

  // Разворот блоков рамки в пиксели: первая строка пикселей блока — поблочно, остальные u − 1 — копией первой.
  // Пустые блоки пишутся нулями (хост обнулил эти пиксели, запись ничего не меняет). Буфер блоков сразу чистится.
  const scratch = blockScratch
  for (let b = db0; b <= db1; b++) {
    const py = by + (b + jBase) * u
    const ry0 = Math.max(0, py)
    const ry1 = Math.min(H, py + u)
    const srow = b * BW
    if (ry0 < ry1) {
      const prow = ry0 * W
      for (let a = da0; a <= da1; a++) {
        const c = scratch[srow + a]
        const px = bx + (a + iBase) * u
        const end = prow + Math.min(W, px + u)
        for (let p = prow + Math.max(0, px); p < end; p++) data[p] = c
      }
      for (let y = ry0 + 1; y < ry1; y++) data.copyWithin(y * W + x0, prow + x0, prow + x1)
    }
    scratch.fill(0, srow + da0, srow + da1 + 1)
  }
  blockScratchDirty = false
  return drawn
}

// ───────────────────────── связи: «Классика» ─────────────────────────

/**
 * «Классика»: связи линиями. Три прохода (приглушённые, обычные, горячие), в каждом — один beginPath … stroke;
 * пустой проход не рисуется. Альфа приглушённых и обычных умножается на linkZoomAlpha. Возвращает число
 * нарисованных связей (с видимой частью).
 */
export function drawLinksClassic(
  ctx: CanvasRenderingContext2D, scene: GraphScene, v: GraphViewport, theme: GraphTheme, state: DrawState,
): number {
  const t = deviceTransform(v)
  const W = Math.round(v.width * v.dpr)
  const H = Math.round(v.height * v.dpr)
  const lw = Math.max(1, Math.round(v.dpr))
  const nodes = scene.nodes
  const links = scene.links
  const { dim, normal, hot } = classifyLinks(scene, state)
  let drawn = 0

  const px = (wx: number): number => t.ox + Math.round(wx * t.k)
  const py = (wy: number): number => t.oy + Math.round(wy * t.k)

  const pass = (segs: Array<[number, number, number, number]>, alpha: number, style: string, width: number): void => {
    // Линия нечётной толщины по центру пикселя — резкая, без размазывания на два ряда.
    const off = width % 2 === 1 ? 0.5 : 0
    let open = false
    for (const [x0, y0, x1, y1] of segs) {
      if (!clipSegment(x0, y0, x1, y1, -width, -width, W + width, H + width)) continue
      const t0 = CLIP[0]
      const t1 = CLIP[1]
      if (!open) {
        ctx.globalAlpha = alpha
        ctx.strokeStyle = style
        ctx.lineWidth = width
        ctx.beginPath()
        open = true
      }
      ctx.moveTo(x0 + (x1 - x0) * t0 + off, y0 + (y1 - y0) * t0 + off)
      ctx.lineTo(x0 + (x1 - x0) * t1 + off, y0 + (y1 - y0) * t1 + off)
      drawn++
    }
    if (open) ctx.stroke()
  }
  const segOf = (list: number[]): Array<[number, number, number, number]> =>
    list.map((li) => {
      const l = links[li]
      return [px(nodes[l.a].x), py(nodes[l.a].y), px(nodes[l.b].x), py(nodes[l.b].y)]
    })

  const zf = linkZoomAlpha(v.camera.zoom)
  pass(segOf(dim), GRAPH_ALPHA_DIM * zf, theme.linkCss, lw)
  pass(segOf(normal), zf, theme.linkCss, lw)
  const hotSegs = segOf(hot)
  const temp = tempSegment(scene, state)
  if (temp) hotSegs.push([px(temp.from.x), py(temp.from.y), px(temp.x), py(temp.y)])
  pass(hotSegs, 1, theme.linkHotCss, lw * 2)
  ctx.globalAlpha = 1
  return drawn
}

// ───────────────────────── ноды ─────────────────────────

/** Рамка толщиной w по краю квадрата (x, y, size) — четыре fillRect. */
function frame(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, w: number): void {
  ctx.fillRect(x, y, size, w)
  ctx.fillRect(x, y + size - w, size, w)
  ctx.fillRect(x, y + w, w, size - 2 * w)
  ctx.fillRect(x + size - w, y + w, w, size - 2 * w)
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** fillRect без части, попавшей в ex (до четырёх кусков, не перекрываются). */
function fillRectExcept(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, ex: Rect | null): void {
  if (w <= 0 || h <= 0) return
  if (ex) {
    const ix0 = Math.max(x, ex.x)
    const iy0 = Math.max(y, ex.y)
    const ix1 = Math.min(x + w, ex.x + ex.w)
    const iy1 = Math.min(y + h, ex.y + ex.h)
    if (ix0 < ix1 && iy0 < iy1) {
      if (iy0 > y) ctx.fillRect(x, y, w, iy0 - y)
      if (iy1 < y + h) ctx.fillRect(x, iy1, w, y + h - iy1)
      if (ix0 > x) ctx.fillRect(x, iy0, ix0 - x, iy1 - iy0)
      if (ix1 < x + w) ctx.fillRect(ix1, iy0, x + w - ix1, iy1 - iy0)
      return
    }
  }
  ctx.fillRect(x, y, w, h)
}

/** Рамка, как frame, но без части, попавшей в ex. */
function frameExcept(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, w: number, ex: Rect | null): void {
  fillRectExcept(ctx, x, y, size, w, ex)
  fillRectExcept(ctx, x, y + size - w, size, w, ex)
  fillRectExcept(ctx, x, y + w, w, size - 2 * w, ex)
  fillRectExcept(ctx, x + size - w, y + w, w, size - 2 * w, ex)
}

/** Ниже этого масштаба устройства (zoom · dpr) звёздочки избранного нет: нода меньше 4 px. */
const FAV_MIN_K = 0.25
/** С этого масштаба избранное — звезда, ниже — золотой квадрат. */
const FAV_STAR_MIN_K = 0.75
/** Звезда 5×5: [строка, колонка, длина]. */
const FAV_STAR_RUNS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 2, 1],
  [1, 1, 3],
  [2, 0, 5],
  [3, 1, 3],
  [4, 1, 1],
  [4, 3, 1],
]
const FAV_EDGE_SHIFTS: ReadonlyArray<readonly [number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]

function nodeAlpha(n: GraphNode): number {
  return n.dim ? GRAPH_ALPHA_DIM : n.archived ? GRAPH_ALPHA_ARCHIVED : 1
}

/**
 * Ноды, выделение, перетаскиваемая нода, цель протяжки. Возвращает число нарисованных нод (видимых; нода, которую
 * тянут, считается один раз).
 *
 * Ноды сцены не перекрываются (сетка 48, квадрат 24), поэтому рисуются проходами — тень, рамка, заливка, метка, —
 * и fillStyle меняется редко: сцена уже упорядочена (приглушённые, затем по цвету). Хост рисует ноды после связей —
 * поверх них.
 *
 * Непрозрачная нода — слоями друг на друга (тень s×s, рамка s×s, заливка, метка). У полупрозрачной (приглушённая,
 * архивная, призрак переносимой) слои с альфой просвечивали бы друг сквозь друга, поэтому каждый её пиксель
 * пишется ровно один раз: видимая часть тени, рамка по краю, заливка и метка не перекрываются.
 */
export function drawNodes(
  ctx: CanvasRenderingContext2D, scene: GraphScene, v: GraphViewport, theme: GraphTheme, state: DrawState,
): number {
  const nodes = scene.nodes
  const t: DeviceTransform = deviceTransform(v)
  const k = t.k
  const overview = v.camera.zoom < 0.5
  // Обзор (ниже 50 %) определяется масштабом, а не плотностью экрана: на 25 % при dpr 2 (k = 0.5) нода тоже рисуется
  // по-обзорному — без рамки, тени и метки, иначе полупрозрачная нода вышла бы меньше непрозрачной.
  const b = theme.nodeEdge !== null && !overview && k >= 0.5 ? Math.max(1, Math.round(2 * k)) : 0
  // Ниже 50 % — тёмный контур снаружи, и нода растёт до OVERVIEW_NODE_PX, но не больше, чем позволяет шаг сетки:
  // соседние ноды не склеиваются в одно пятно: в плотной зоне они встают сеткой цветных клеток, контур к контуру.
  const o = theme.nodeEdge !== null && overview ? Math.max(1, Math.round(v.dpr)) : 0
  const sBase = Math.max(2, Math.round(GRAPH_NODE_SIZE * k))
  const cellPx = Math.round(GRAPH_CELL * k)
  // Без контура («Классика») между соседями остаётся хотя бы пиксель земли.
  const gap = o > 0 ? 2 * o : Math.max(1, Math.round(v.dpr))
  const s = overview ? Math.max(sBase, Math.min(Math.round(OVERVIEW_NODE_PX * v.dpr), cellPx - gap)) : sBase
  const half = Math.floor(s / 2)
  const w = Math.max(1, Math.round(2 * k))
  const withShadow = theme.shadow !== null && !overview && k >= 0.5
  const withInbox = !overview && k >= 0.5
  const m = Math.max(2, Math.round(6 * k))
  const mPad = Math.max(1, b)
  const mInner = m - 2 * mPad

  const left = (wx: number): number => t.ox + Math.round(wx * k) - half
  const top = (wy: number): number => t.oy + Math.round(wy * k) - half

  const vb = visibleBounds(v, NODE_MARGIN_PX)
  // ноды, которые сейчас рисует сцена казни (lib/graph/smite), холст графа не рисует
  const hidden = useSmite.getState().hidden
  const found = queryBounds(scene.index, nodes, vb)
  const visible = hidden.size ? found.filter((i) => !hidden.has(nodes[i].id)) : found
  const count = visible.length
  const xs = new Array<number>(count)
  const ys = new Array<number>(count)
  const alphas = new Array<number>(count)
  const drag = state.drag
  const dragIndex = drag ? (scene.byId.get(drag.id) ?? -1) : -1
  for (let q = 0; q < count; q++) {
    const n = nodes[visible[q]]
    xs[q] = left(n.x)
    ys[q] = top(n.y)
    const a = nodeAlpha(n)
    alphas[q] = visible[q] === dragIndex ? Math.min(a, DRAG_GHOST_ALPHA) : a
  }

  // Смены состояния контекста — только когда значение меняется.
  let curAlpha = Number.NaN
  let curFill: string | null = null
  const setAlpha = (a: number): void => {
    if (a !== curAlpha) {
      ctx.globalAlpha = a
      curAlpha = a
    }
  }
  const setFill = (c: string): void => {
    if (c !== curFill) {
      ctx.fillStyle = c
      curFill = c
    }
  }

  /** Рамка w цветом color вплотную вокруг квадрата с углом (x, y) и кромка theme.selEdge снаружи (если есть). */
  const edgedRing = (x: number, y: number, color: string): void => {
    setFill(color)
    frame(ctx, x - w, y - w, s + 2 * w, w)
    if (theme.selEdge !== null) {
      setFill(theme.selEdge)
      frame(ctx, x - 2 * w, y - 2 * w, s + 4 * w, w)
    }
  }

  /** Метка «Входящие»: квадрат m в правом верхнем углу с вылетом b наружу, кромка и сердцевина. */
  const markRect = (x0: number, y0: number): Rect => ({ x: x0 + s - m + b, y: y0 - b, w: m, h: m })
  const inboxEdge = (x0: number, y0: number, solid: boolean): void => {
    if (solid) ctx.fillRect(x0 + s - m + b, y0 - b, m, m)
    // полупрозрачная: только кольцо под сердцевиной; при mInner < 1 сердцевина закрывает всю метку
    else if (mInner >= 1) frame(ctx, x0 + s - m + b, y0 - b, m, mPad)
  }
  const inboxCore = (x0: number, y0: number): void => {
    if (mInner >= 1) ctx.fillRect(x0 + s - m + b + mPad, y0 - b + mPad, mInner, mInner)
    else ctx.fillRect(x0 + s - m + b, y0 - b, m, m)
  }
  // Избранное: от 75 % — звезда 5×5 «клеток» размером fu px (контур наружу, вылет b, как у метки «Входящие»);
  // на 25–75 % звезду не разобрать — золотой квадрат внутри ноды.
  const favStar = k >= FAV_STAR_MIN_K
  const fu = Math.max(1, Math.round(k))
  const favSq = Math.max(2, Math.round(5 * k))
  const favMark = (x0: number, y0: number, pass: 'edge' | 'core'): void => {
    if (!favStar) {
      ctx.fillRect(x0 + b, y0 + s - b - favSq, favSq, favSq)
      return
    }
    const x = x0 - b + fu
    const y = y0 + s + b - 6 * fu
    for (const [row, col, len] of FAV_STAR_RUNS) {
      if (pass === 'core') {
        ctx.fillRect(x + col * fu, y + row * fu, len * fu, fu)
        continue
      }
      for (const [dx, dy] of FAV_EDGE_SHIFTS) {
        ctx.fillRect(x + col * fu + dx * fu, y + row * fu + dy * fu, len * fu, fu)
      }
    }
  }
  // Часть полупрозрачной ноды под меткой «Входящие» не рисуется: метка ложится на землю, а не на ноду.
  const exclOf = (q: number): Rect | null => (withInbox && nodes[visible[q]].inbox ? markRect(xs[q], ys[q]) : null)

  // 1. Тень.
  if (withShadow) {
    setFill(theme.shadow as string)
    for (let q = 0; q < count; q++) {
      setAlpha(alphas[q])
      if (alphas[q] >= 1) {
        ctx.fillRect(xs[q] + b, ys[q] + b, s, s)
      } else {
        // видимая часть тени: полоса справа и полоса снизу
        const ex = exclOf(q)
        fillRectExcept(ctx, xs[q] + s, ys[q] + b, b, s, ex)
        fillRectExcept(ctx, xs[q] + b, ys[q] + s, s - b, b, ex)
      }
    }
  }
  // 2. Рамка (или контур снаружи ниже 50 %).
  if (b > 0 || o > 0) {
    setFill(theme.nodeEdge as string)
    for (let q = 0; q < count; q++) {
      setAlpha(alphas[q])
      if (alphas[q] >= 1) ctx.fillRect(xs[q] - o, ys[q] - o, s + 2 * o, s + 2 * o)
      else if (b > 0) frameExcept(ctx, xs[q], ys[q], s, b, exclOf(q))
      else frame(ctx, xs[q] - o, ys[q] - o, s + 2 * o, o)
    }
  }
  // 3. Заливка цветом категории.
  const inner = s - 2 * b
  for (let q = 0; q < count; q++) {
    setAlpha(alphas[q])
    setFill(theme.cat[nodes[visible[q]].color] ?? theme.cat.none)
    if (alphas[q] >= 1) ctx.fillRect(xs[q] + b, ys[q] + b, inner, inner)
    else fillRectExcept(ctx, xs[q] + b, ys[q] + b, inner, inner, exclOf(q))
  }
  // 4. Метка «Входящие».
  if (withInbox) {
    let any = false
    for (let q = 0; q < count; q++) {
      if (!nodes[visible[q]].inbox) continue
      if (!any) {
        setFill(theme.inboxEdge)
        any = true
      }
      setAlpha(alphas[q])
      inboxEdge(xs[q], ys[q], alphas[q] >= 1)
    }
    if (any) {
      setFill(theme.inbox)
      for (let q = 0; q < count; q++) {
        if (!nodes[visible[q]].inbox) continue
        setAlpha(alphas[q])
        inboxCore(xs[q], ys[q])
      }
    }
  }
  // 5. Звёздочка избранного (левый нижний угол). Контур — звезда, сдвинутая на единицу в четыре стороны.
  if (k >= FAV_MIN_K) {
    for (const pass of ['edge', 'core'] as const) {
      if (pass === 'edge' && !favStar) continue
      let filled = false
      for (let q = 0; q < count; q++) {
        if (!nodes[visible[q]].favorite) continue
        if (!filled) {
          setFill(pass === 'edge' ? theme.favEdge : theme.fav)
          filled = true
        }
        setAlpha(alphas[q])
        favMark(xs[q], ys[q], pass)
      }
    }
  }
  setAlpha(1)

  // Нода, которую тянут: клетка, куда встанет, и сама нода в точке указателя — поверх остальных.
  let dragX = 0
  let dragY = 0
  if (drag && dragIndex >= 0) {
    const n = nodes[dragIndex]
    dragX = left(Number.isFinite(drag.x) ? drag.x : n.x)
    dragY = top(Number.isFinite(drag.y) ? drag.y : n.y)
    if (drag.drop && Number.isFinite(drag.drop.x) && Number.isFinite(drag.drop.y)) {
      edgedRing(left(drag.drop.x), top(drag.drop.y), theme.hover)
    }
    if (theme.shadow !== null && b > 0) {
      setFill(theme.shadow)
      ctx.fillRect(dragX + 2 * b, dragY + 2 * b, s, s)
    }
    if (b > 0 || o > 0) {
      setFill(theme.nodeEdge as string)
      ctx.fillRect(dragX - o, dragY - o, s + 2 * o, s + 2 * o)
    }
    setFill(theme.cat[n.color] ?? theme.cat.none)
    ctx.fillRect(dragX + b, dragY + b, inner, inner)
    if (withInbox && n.inbox) {
      setFill(theme.inboxEdge)
      inboxEdge(dragX, dragY, true)
      setFill(theme.inbox)
      inboxCore(dragX, dragY)
    }
    if (k >= FAV_MIN_K && n.favorite) {
      if (favStar) {
        setFill(theme.favEdge)
        favMark(dragX, dragY, 'edge')
      }
      setFill(theme.fav)
      favMark(dragX, dragY, 'core')
    }
  }

  // Выделение (альфа 1). Нода видна → её угол; нода, которую тянут, — в точке указателя; иначе рамки нет.
  const cornerOf = (i: number): [number, number] | null => {
    if (i === dragIndex) return [dragX, dragY]
    const n = nodes[i]
    if (n.x < vb.minX || n.x > vb.maxX || n.y < vb.minY || n.y > vb.maxY) return null
    return [left(n.x), top(n.y)]
  }
  /**
   * Рамка вплотную снаружи квадрата и, если есть, тёмная кромка снаружи неё (DESIGN §3, правило про золото): светлая
   * рамка соседа, наведения и курсора без кромки на дневной земле не видна.
   */
  const ring = (i: number, color: string): void => {
    const c = cornerOf(i)
    if (c) edgedRing(c[0], c[1], color)
  }
  /** Рамка выбранной: золото с зазором w и, если есть, тёмная кромка снаружи (DESIGN §3, правило про золото). */
  const selRing = (i: number): void => {
    const c = cornerOf(i)
    if (!c) return
    setFill(theme.sel)
    frame(ctx, c[0] - 2 * w, c[1] - 2 * w, s + 4 * w, w)
    if (theme.selEdge !== null) {
      setFill(theme.selEdge)
      frame(ctx, c[0] - 3 * w, c[1] - 3 * w, s + 6 * w, w)
    }
  }

  const sel = state.selectedId !== null ? (scene.byId.get(state.selectedId) ?? -1) : -1
  if (sel >= 0) for (const j of nodes[sel].links) ring(j, theme.sel)
  for (const id of [state.hoveredId, state.cursorId]) {
    if (id === null) continue
    const i = scene.byId.get(id)
    if (i !== undefined) ring(i, theme.hover)
  }
  if (sel >= 0) selRing(sel)
  const target = state.tempLink?.targetId
  if (target != null) {
    const i = scene.byId.get(target)
    if (i !== undefined && i !== sel) selRing(i)
  }
  setAlpha(1)
  return count
}

// ───────────────────────── стая: шлейф ─────────────────────────

/** Шлейф ведомой ноды: отпечатки на местах, где она была столько секунд назад, и их альфа. */
const SWARM_TRAIL: ReadonlyArray<readonly [number, number]> = [
  [0.07, 0.16],
  [0.035, 0.32],
]
/** Медленнее этого (пиксели устройства в секунду) шлейфа нет: стоящая и доплывающая нода — без следа. */
const SWARM_TRAIL_MIN_SPEED = 90
/** Отпечаток не отстаёт от ноды дальше, чем на столько её размеров. */
const SWARM_TRAIL_MAX = 1.5

/**
 * Шлейф плывущих нод стаи (lib/graph/swarm): два уменьшающихся квадрата цвета категории позади ноды, ступенями
 * альфы — без градиентов и свечений. Рисуется после связей и до нод. Размер квадрата — как у drawNodes.
 */
export function drawSwarmTrails(
  ctx: CanvasRenderingContext2D,
  scene: GraphScene,
  v: GraphViewport,
  theme: GraphTheme,
  members: ReadonlyArray<{ id: string; x: number; y: number; vx: number; vy: number }>,
): void {
  const t: DeviceTransform = deviceTransform(v)
  const k = t.k
  const overview = v.camera.zoom < 0.5
  const o = theme.nodeEdge !== null && overview ? Math.max(1, Math.round(v.dpr)) : 0
  const sBase = Math.max(2, Math.round(GRAPH_NODE_SIZE * k))
  const cellPx = Math.round(GRAPH_CELL * k)
  const s = overview ? Math.max(sBase, Math.min(Math.round(OVERVIEW_NODE_PX * v.dpr), cellPx - 2 * o)) : sBase
  const half = Math.floor(s / 2)
  const shrink = Math.max(1, Math.round(s / 6))
  const vb = visibleBounds(v, NODE_MARGIN_PX)
  const hidden = useSmite.getState().hidden
  let fill: string | null = null
  for (let pass = 0; pass < SWARM_TRAIL.length; pass++) {
    const [lag, alpha] = SWARM_TRAIL[pass]
    const size = s - 2 * shrink * (SWARM_TRAIL.length - pass)
    if (size < 1) continue
    const inset = (s - size) >> 1
    for (const m of members) {
      const speed = Math.hypot(m.vx, m.vy) * k
      if (!(speed >= SWARM_TRAIL_MIN_SPEED)) continue
      if (m.x < vb.minX || m.x > vb.maxX || m.y < vb.minY || m.y > vb.maxY) continue
      const i = scene.byId.get(m.id)
      if (i === undefined || hidden.has(m.id)) continue
      const n = scene.nodes[i]
      // Отставание ограничено: на рывке отпечаток не отрывается от ноды.
      const f = Math.min(lag, (SWARM_TRAIL_MAX * s * (lag / SWARM_TRAIL[0][0])) / speed)
      const x = t.ox + Math.round((m.x - m.vx * f) * k) - half + inset
      const y = t.oy + Math.round((m.y - m.vy * f) * k) - half + inset
      const color = theme.cat[n.color] ?? theme.cat.none
      if (color !== fill) {
        ctx.fillStyle = color
        fill = color
      }
      ctx.globalAlpha = alpha * nodeAlpha(n)
      ctx.fillRect(x, y, size, size)
    }
  }
  ctx.globalAlpha = 1
}
