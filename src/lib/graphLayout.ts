/**
 * Автораскладка графа: ноды одной категории собираются в цветовую зону, связанные ноды встают рядом.
 * Сохранённые положения не пересчитываются — раскладка только дополняет их.
 *
 * Гарантии (покрыты тестами):
 *  1. Детерминированность. Один и тот же вход всегда даёт один и тот же результат: без Math.random, все
 *     сортировки добиты до полного порядка, порядок нод на входе и ключей fixed не важен.
 *  2. Устойчивость. Нода с годным сохранённым положением, клетку которого не занимает нода, стоящая раньше по
 *     (createdAt, id), возвращается как есть. Добавление записи или категории не меняет ни одного такого положения.
 *  3. Одна нода — одна клетка. В positions нет двух нод в одной клетке, в том числе сохранённых: из совпавших
 *     остаётся первая по (createdAt, id), остальные разводятся в ближайшие свободные клетки (displaced).
 *  4. Зоны не перемешиваются. Нода, получившая место в этом вызове (кроме разведённых), стоит не ближе GRAPH_MOAT
 *     клеток по Чебышёву к любой ноде другой зоны, у которой уже есть место (ров между зонами).
 *
 * Цена рва: зона, окружённая соседями, растёт в обход них и может продолжиться «островом» за ними — но не внутри
 * чужой зоны. Чтобы это было редкостью, при дополнении сохранённой раскладки новая зона получает место под
 * GRAPH_ZONE_RESERVE нод, а отдельный участок зоны начинается только вдали от чужих нод (без «тропок» по
 * коридорам). Порядок наводит «Разложить»: при пустом fixed зоны раздвинуты по своим размерам. Запас — компромисс
 * между островами на больших базах и масштабом «Весь граф» на малых; на 2000 записях / 12 категориях при росте
 * по одной вне основного участка остаётся порядка 8 % нод.
 */

import type { GraphPoint, Item } from '@/types'
import type { Bounds } from './graph/types'
import { MAX_GRAPH_COORD } from './normalize'

/** Сторона квадрата ноды, px при 100 %. */
export const GRAPH_NODE_SIZE = 16
/** Шаг сетки, px; центр ноды — в узле сетки. */
export const GRAPH_CELL = 32
/** Зазор между зонами, клеток. */
export const GRAPH_ZONE_GAP = 3
/** Ключ зоны записей без категории. */
export const GRAPH_NONE_ZONE = 'none'
/** Ров между зонами, клеток: новая нода не встаёт ближе (по Чебышёву) к ноде чужой зоны. */
export const GRAPH_MOAT = 2

export interface LayoutNode {
  id: string
  categoryId: string | null
  links: readonly string[]
  createdAt: number
}

export interface LayoutZone {
  key: string
  x: number
  y: number
  r: number
  count: number
}

export interface LayoutResult {
  /** Положения всех нод из nodes: сохранённые — как были, новые и разведённые — рассчитанные. */
  positions: Map<string, GraphPoint>
  /** id нод, получивших место в этом вызове: новые и разведённые (их нужно сохранить). */
  placed: string[]
  /** Подмножество placed: ноды, чьё сохранённое место было занято другой нодой. */
  displaced: string[]
  zones: LayoutZone[]
  bounds: Bounds | null
}

const GOLDEN_ANGLE = 2.399963229728653
const MAX_CENTER_TRIES = 50_000
/** Сколько ближайших к центру свободных клеток зоны рассматривается для ноды. */
const CENTER_CANDIDATES = 8
/** Вокруг скольких связанных нод ищется место. */
const NEIGHBOR_LIMIT = 6
/** Половина стороны квадрата клеток вокруг связанной ноды своей зоны (2 → 5×5). */
const NEIGHBOR_REACH = 2
/**
 * То же для связанной ноды чужой зоны (→ 9×9): клетки ближе рва к ней заблокированы, и при прежнем квадрате
 * 5×5 связь с чужой нодой не тянула бы вовсе.
 */
const FOREIGN_REACH = NEIGHBOR_REACH + GRAPH_MOAT
const CENTER_WEIGHT = 0.25
/** Сторона корзины (в клетках) для проверки центра новой зоны по нодам с местом. */
const POINT_BUCKET_CELLS = 8
/** Значение claim: клетка во рву двух и более зон — закрыта для всех. */
const MIXED = -1
/**
 * Ёмкость (в нодах), под которую оставляется место у новой зоны, если на графе уже есть ноды с местом.
 * При росте с пустого графа центры ранних зон иначе встают «по одной ноде» (9 клеток друг от друга), зоны
 * упираются во рвы соседей уже на десятках нод и дальше растут островами. 24 → радиус 6 клеток. Это компромисс:
 * запас 48 (радиус 8) убирал острова и на 2000 записях, но на малых базах разбрасывал граф так, что «Весь граф»
 * вписывал его на 25 % вместо 75 % (30 записей в 6 категориях). С 24 на 2000 записях / 12 категориях при росте
 * по одной вне основного участка остаётся порядка 8 % нод; порядок наводит «Разложить заново».
 */
export const GRAPH_ZONE_RESERVE = 24
/**
 * Отдельный участок зоны (клетка, у которой в пределах рва нет нод своей зоны) начинается только там, где в
 * квадрате (2·FRAGMENT_CLEAR + 1)² нет нод чужих зон: иначе зажатая зона продолжается одиночными «тропками»
 * по середине коридоров между соседями.
 */
const FRAGMENT_CLEAR = 4

// Клетка → одно число (ключ Set): строки-ключи на 2000 нодах заметно медленнее.
const KEY_OFFSET = 2 ** 21
const KEY_SPAN = 2 ** 22

function cellKey(cx: number, cy: number): number {
  return (cx + KEY_OFFSET) * KEY_SPAN + (cy + KEY_OFFSET)
}

/** Клетка сетки, в которую попадает координата. `+ 0` убирает −0. */
function toCell(v: number): number {
  return Math.round(v / GRAPH_CELL) + 0
}

function isPoint(p: GraphPoint | undefined): p is GraphPoint {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y)
}

function compareStrings(a: string, b: string): number {
  // Не localeCompare: порядок не должен зависеть от языка системы.
  return a < b ? -1 : a > b ? 1 : 0
}

function compareNodes(a: LayoutNode, b: LayoutNode): number {
  return (
    a.createdAt - b.createdAt ||
    compareStrings(a.id, b.id) ||
    // Только для дублей id: какой из них останется, не должно зависеть от порядка на входе.
    Number(a.categoryId !== null) - Number(b.categoryId !== null) ||
    compareStrings(a.categoryId ?? '', b.categoryId ?? '') ||
    compareStrings(linksKey(a), linksKey(b))
  )
}

function linksKey(node: LayoutNode): string {
  return [...node.links].sort(compareStrings).join('\n')
}

// Смещения клеток от центра зоны по возрастанию (dx² + dy², dy, dx). Список общий для всех зон и
// дорастает по требованию: круг меньшего радиуса — всегда начало списка для большего.
let offsetRadius = 0
let offsetDx: number[] = []
let offsetDy: number[] = []

function ensureOffsets(count: number): void {
  while (offsetDx.length < count) {
    offsetRadius = offsetRadius === 0 ? 24 : offsetRadius * 2
    const r = offsetRadius
    const cells: Array<[number, number, number]> = []
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = dx * dx + dy * dy
        if (d <= r * r) cells.push([d, dy, dx])
      }
    }
    cells.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
    offsetDx = cells.map((c) => c[2])
    offsetDy = cells.map((c) => c[1])
  }
}

/** Радиус зоны в клетках. Ёмкость растёт степенями двойки, чтобы геометрия зоны менялась редко. */
function zoneRadiusCells(n: number): number {
  let cap = 8
  while (cap < 1.5 * n) cap *= 2
  return Math.ceil(Math.sqrt(cap / Math.PI)) + 1
}

/** Нижняя медиана. */
function lowerMedian(values: number[]): number {
  values.sort((a, b) => a - b)
  return values[(values.length - 1) >> 1]
}

/**
 * Ближайшая к точке (tx, ty) клетка, для которой taken — false. Ничья — меньший y, затем меньший x.
 * Общий помощник броска ноды (findFreeSpot) и разведения совпавших сохранённых нод.
 */
function nearestFreeCell(tx: number, ty: number, taken: (cx: number, cy: number) => boolean): [number, number] {
  const baseX = toCell(tx)
  const baseY = toCell(ty)
  if (!taken(baseX, baseY)) return [baseX, baseY]

  let bestX = 0
  let bestY = 0
  let bestDist = Infinity
  const consider = (cx: number, cy: number) => {
    if (taken(cx, cy)) return
    const dx = cx * GRAPH_CELL - tx
    const dy = cy * GRAPH_CELL - ty
    const dist = dx * dx + dy * dy
    if (dist > bestDist) return
    if (dist === bestDist && (cy > bestY || (cy === bestY && cx >= bestX))) return
    bestDist = dist
    bestX = cx
    bestY = cy
  }
  // Кольца клеток вокруг исходной. Занятых клеток конечное число, поэтому свободная найдётся.
  for (let k = 1; ; k++) {
    for (let d = -k; d <= k; d++) {
      consider(baseX + d, baseY - k)
      consider(baseX + d, baseY + k)
    }
    for (let d = -k + 1; d <= k - 1; d++) {
      consider(baseX - k, baseY + d)
      consider(baseX + k, baseY + d)
    }
    // Цель лежит не дальше полклетки от центра исходной клетки, значит до любой клетки следующего
    // кольца не меньше (k + 0.5) клетки: ближе найденной там уже не будет.
    const reach = (k + 0.5) * GRAPH_CELL
    if (bestDist < reach * reach) break
  }
  return [bestX, bestY]
}

interface Zone {
  key: string
  /** Индексы нод зоны в порядке (createdAt, id). */
  members: number[]
  /** Центр и радиус, px. */
  x: number
  y: number
  r: number
  /** Клетка центра. */
  cx: number
  cy: number
  /** Указатель на первую незаблокированную клетку в списке смещений; только растёт. */
  ptr: number
}

export function snapToGrid(p: GraphPoint): GraphPoint {
  return { x: toCell(p.x) * GRAPH_CELL, y: toCell(p.y) * GRAPH_CELL }
}

/**
 * Записи раскладки: все записи вне корзины (inbox, library, archive) и записи корзины, у которых есть годное
 * положение в fixed (держат своё место). Без fixed записи корзины не берутся.
 */
export function toLayoutNodes(items: readonly Item[], fixed?: Readonly<Record<string, GraphPoint>>): LayoutNode[] {
  const nodes: LayoutNode[] = []
  for (const item of items) {
    if (item.deletedAt !== undefined) {
      // hasOwn: id вроде «constructor» не должен найтись в прототипе.
      if (!fixed || !Object.hasOwn(fixed, item.id) || !isPoint(fixed[item.id])) continue
    }
    nodes.push({
      id: item.id,
      categoryId: item.categoryId ?? null,
      links: Array.isArray(item.links) ? item.links : [],
      createdAt: item.createdAt,
    })
  }
  return nodes
}

export function computeLayout(
  nodes: readonly LayoutNode[],
  categoryOrder: readonly string[],
  fixed: Readonly<Record<string, GraphPoint>>,
): LayoutResult {
  // 1. Порядок (createdAt, id), дубли id отбрасываются.
  const list: LayoutNode[] = []
  const indexOf = new Map<string, number>()
  for (const node of [...nodes].sort(compareNodes)) {
    if (indexOf.has(node.id)) continue
    indexOf.set(node.id, list.length)
    list.push(node)
  }
  const count = list.length
  if (count === 0) return { positions: new Map(), placed: [], displaced: [], zones: [], bounds: null }

  // Связи: без самоссылок и неизвестных id, в обе стороны, без дублей, по порядку нод.
  const adj: number[][] = list.map(() => [])
  for (let i = 0; i < count; i++) {
    for (const linkId of list[i].links) {
      const j = indexOf.get(linkId)
      if (j === undefined || j === i) continue
      adj[i].push(j)
      adj[j].push(i)
    }
  }
  for (let i = 0; i < count; i++) {
    if (adj[i].length > 1) adj[i] = [...new Set(adj[i])].sort((a, b) => a - b)
  }

  /** Место ноды в порядке по id — чтобы не сравнивать строки в горячем цикле. */
  const idRank = new Int32Array(count)
  list
    .map((_, i) => i)
    .sort((a, b) => compareStrings(list[a].id, list[b].id))
    .forEach((i, rank) => {
      idRank[i] = rank
    })

  // 3. Зоны: «без категории», затем категории по порядку, затем неизвестные id по алфавиту.
  //    (Раньше шага 2: зона ноды нужна для рва уже при разборе сохранённых положений.)
  const membersByKey = new Map<string, number[]>()
  for (let i = 0; i < count; i++) {
    const key = list[i].categoryId ?? GRAPH_NONE_ZONE
    const members = membersByKey.get(key)
    if (members) members.push(i)
    else membersByKey.set(key, [i])
  }
  const known = new Set<string>([GRAPH_NONE_ZONE, ...categoryOrder])
  const zoneKeys = [
    ...known,
    ...[...membersByKey.keys()].filter((key) => !known.has(key)).sort(compareStrings),
  ].filter((key) => membersByKey.has(key))

  // 4. Радиусы.
  const zones: Zone[] = zoneKeys.map((key) => {
    const members = membersByKey.get(key)!
    return { key, members, x: 0, y: 0, r: zoneRadiusCells(members.length) * GRAPH_CELL, cx: 0, cy: 0, ptr: 0 }
  })
  const zoneOf = new Int32Array(count)
  zones.forEach((zone, zi) => {
    for (const i of zone.members) zoneOf[i] = zi
  })

  // 2. Занятые клетки и ров. occupied — клетки с нодой; claim — чья зона владеет клеткой рва вокруг ноды
  //    (MIXED — нескольких). Клетка закрыта для зоны zi, если занята или во рву другой зоны.
  //    Для фиксированной zi blocked со временем только переходит из false в true: occupied растёт, а claim
  //    уходит от zi только в чужую зону или MIXED. Поэтому указатель зоны (ptr) верен и с рвом.
  const occupied = new Set<number>()
  const claim = new Map<number, number>()
  /** Клетка ноды с местом → её зона (скрытые записи из 2б сюда не входят). */
  const cellZone = new Map<number, number>()
  const mark = (cx: number, cy: number, zi: number) => {
    cellZone.set(cellKey(cx, cy), zi)
    for (let dy = -GRAPH_MOAT; dy <= GRAPH_MOAT; dy++) {
      for (let dx = -GRAPH_MOAT; dx <= GRAPH_MOAT; dx++) {
        const key = cellKey(cx + dx, cy + dy)
        const owner = claim.get(key)
        if (owner === undefined) claim.set(key, zi)
        else if (owner !== zi && owner !== MIXED) claim.set(key, MIXED)
      }
    }
  }
  const blocked = (cx: number, cy: number, zi: number): boolean => {
    const key = cellKey(cx, cy)
    if (occupied.has(key)) return true
    const owner = claim.get(key)
    return owner !== undefined && owner !== zi
  }
  /**
   * Клетка годится зоне zi: не закрыта и либо продолжает участок зоны (в её рву), либо начинает новый участок
   * вдали от чужих нод. В отличие от blocked, со временем может стать годной (рядом встала нода своей зоны),
   * поэтому указатель зоны по ней не сдвигается.
   */
  const usable = (cx: number, cy: number, zi: number): boolean => {
    if (blocked(cx, cy, zi)) return false
    if (claim.get(cellKey(cx, cy)) === zi) return true
    // Ближе рва чужих нод нет (иначе клетка закрыта) — смотрим только кольцо от рва до FRAGMENT_CLEAR.
    for (let dy = -FRAGMENT_CLEAR; dy <= FRAGMENT_CLEAR; dy++) {
      const inner = dy >= -GRAPH_MOAT && dy <= GRAPH_MOAT
      for (let dx = -FRAGMENT_CLEAR; dx <= FRAGMENT_CLEAR; dx++) {
        if (inner && dx >= -GRAPH_MOAT && dx <= GRAPH_MOAT) continue
        const owner = cellZone.get(cellKey(cx + dx, cy + dy))
        if (owner !== undefined && owner !== zi) return false
      }
    }
    return true
  }

  const xs = new Float64Array(count)
  const ys = new Float64Array(count)
  /** 1 — у ноды есть место (сохранённое или уже выданное в этом вызове). */
  const done = new Uint8Array(count)
  const placed: string[] = []
  const displaced: string[] = []

  // 2а. Сохранённые положения нод по порядку (createdAt, id): клетка свободна — точка остаётся как есть
  //     (в том числе не по сетке), занята более ранней нодой — нода уходит на разведение.
  const collided: number[] = []
  for (let i = 0; i < count; i++) {
    const id = list[i].id
    // hasOwn: id вроде «constructor» не должен найтись в прототипе.
    const p = Object.hasOwn(fixed, id) ? fixed[id] : undefined
    if (!isPoint(p)) continue
    const cx = toCell(p.x)
    const cy = toCell(p.y)
    const key = cellKey(cx, cy)
    if (occupied.has(key)) {
      collided.push(i)
      continue
    }
    occupied.add(key)
    mark(cx, cy, zoneOf[i])
    xs[i] = p.x
    ys[i] = p.y
    done[i] = 1
  }

  // 2б. Положения записей, которых нет среди нод (скрытые), держат клетку — иначе запись, вернувшаяся
  //     оттуда, оказалась бы на чужой ноде. Рва они не дают и видимую ноду не вытесняют.
  const hiddenXs: number[] = []
  const hiddenYs: number[] = []
  for (const id of Object.keys(fixed)) {
    if (indexOf.has(id)) continue
    const p = fixed[id]
    if (!isPoint(p)) continue
    const cx = toCell(p.x)
    const cy = toCell(p.y)
    occupied.add(cellKey(cx, cy))
    hiddenXs.push(cx * GRAPH_CELL)
    hiddenYs.push(cy * GRAPH_CELL)
  }

  // 2в. Разведение: ближайшая к сохранённой точке свободная клетка (ров не учитывается — нода уже стояла здесь).
  const isOccupied = (cx: number, cy: number) => occupied.has(cellKey(cx, cy))
  for (const i of collided) {
    const p = fixed[list[i].id]
    const [cx, cy] = nearestFreeCell(p.x, p.y, isOccupied)
    occupied.add(cellKey(cx, cy))
    mark(cx, cy, zoneOf[i])
    xs[i] = cx * GRAPH_CELL
    ys[i] = cy * GRAPH_CELL
    done[i] = 1
    placed.push(list[i].id)
    displaced.push(list[i].id)
  }

  // 5. Центры. Сначала зоны, у которых уже есть ноды с местом (их центр задан), потом остальные —
  //    так новая зона обходит все существующие, а не только стоящие раньше по порядку.
  const centered: Zone[] = []
  const setCenter = (zone: Zone, x: number, y: number) => {
    zone.cx = toCell(x)
    zone.cy = toCell(y)
    zone.x = zone.cx * GRAPH_CELL
    zone.y = zone.cy * GRAPH_CELL
    centered.push(zone)
  }
  const pending: Zone[] = []
  for (const zone of zones) {
    const saved = zone.members.filter((i) => done[i] === 1)
    if (saved.length === 0) {
      pending.push(zone)
      continue
    }
    setCenter(zone, lowerMedian(saved.map((i) => xs[i])), lowerMedian(saved.map((i) => ys[i])))
  }

  if (pending.length > 0) {
    // Точки с местом (ноды любой зоны и скрытые записи) по крупным корзинам: круг новой зоны вместе со рвом
    // не должен их задевать — зона с закреплённым центром могла разрастись далеко за свой круг.
    const bucketSize = POINT_BUCKET_CELLS * GRAPH_CELL
    const buckets = new Map<number, number[]>()
    const addPoint = (x: number, y: number) => {
      const key = cellKey(Math.floor(x / bucketSize), Math.floor(y / bucketSize))
      const bucket = buckets.get(key)
      if (bucket) bucket.push(x, y)
      else buckets.set(key, [x, y])
    }
    for (let i = 0; i < count; i++) if (done[i] === 1) addPoint(xs[i], ys[i])
    for (let k = 0; k < hiddenXs.length; k++) addPoint(hiddenXs[k], hiddenYs[k])

    const moat = GRAPH_MOAT * GRAPH_CELL
    const clearOfPoints = (x: number, y: number, r: number): boolean => {
      const reach = r + moat
      const reach2 = reach * reach
      const bx0 = Math.floor((x - reach) / bucketSize)
      const bx1 = Math.floor((x + reach) / bucketSize)
      const by0 = Math.floor((y - reach) / bucketSize)
      const by1 = Math.floor((y + reach) / bucketSize)
      for (let by = by0; by <= by1; by++) {
        for (let bx = bx0; bx <= bx1; bx++) {
          const bucket = buckets.get(cellKey(bx, by))
          if (!bucket) continue
          for (let k = 0; k < bucket.length; k += 2) {
            const dx = bucket[k] - x
            const dy = bucket[k + 1] - y
            if (dx * dx + dy * dy < reach2) return false
          }
        }
      }
      return true
    }
    const gap = GRAPH_ZONE_GAP * GRAPH_CELL
    // Запас места только при дополнении сохранённой раскладки: свежая («Разложить заново») знает итоговые
    // размеры зон и раздвигает их по ним. reserveR монотонна по r — ускорение searched остаётся верным.
    const hasSaved = done.some((d) => d === 1) || hiddenXs.length > 0
    const reserveMin = zoneRadiusCells(GRAPH_ZONE_RESERVE) * GRAPH_CELL
    const reserveR = (r: number) => (hasSaved ? Math.max(r, reserveMin) : r)
    const fits = (x: number, y: number, r: number) => {
      const rr = reserveR(r)
      for (const z of centered) {
        const dx = x - z.x
        const dy = y - z.y
        const min = rr + reserveR(z.r) + gap
        if (dx * dx + dy * dy < min * min) return false
      }
      return clearOfPoints(x, y, rr)
    }
    // Кандидаты «подсолнуха», отвергнутые для зоны радиуса r, не подойдут и зоне не меньшего радиуса
    // (зон с центром стало только больше, набор точек не меняется, условие монотонно по r) — поиск
    // продолжается с места, где закончился прошлый.
    const searched: Array<{ r: number; next: number }> = []
    for (const zone of pending) {
      let start = 0
      for (const s of searched) if (s.r <= zone.r && s.next > start) start = s.next
      let found = false
      for (let i = start; i < MAX_CENTER_TRIES; i++) {
        const rho = GRAPH_CELL * Math.sqrt(i)
        const theta = i * GOLDEN_ANGLE
        const x = toCell(rho * Math.cos(theta)) * GRAPH_CELL
        const y = toCell(rho * Math.sin(theta)) * GRAPH_CELL
        if (!fits(x, y, zone.r)) continue
        setCenter(zone, x, y)
        searched.push({ r: zone.r, next: i + 1 })
        found = true
        break
      }
      if (found) continue
      searched.push({ r: zone.r, next: MAX_CENTER_TRIES })
      let right = 0
      for (const z of centered) right = Math.max(right, z.x + reserveR(z.r))
      for (let i = 0; i < count; i++) if (done[i] === 1) right = Math.max(right, xs[i])
      for (const x of hiddenXs) right = Math.max(right, x)
      setCenter(zone, right + gap + moat + reserveR(zone.r), 0)
    }
  }

  // 6. Размещение нод без места.
  const compOf = new Int32Array(count).fill(-1)
  const queued = new Uint8Array(count)
  let compCount = 0

  const place = (v: number, zi: number) => {
    const zone = zones[zi]
    for (;;) {
      ensureOffsets(zone.ptr + 1)
      if (!blocked(zone.cx + offsetDx[zone.ptr], zone.cy + offsetDy[zone.ptr], zi)) break
      zone.ptr++
    }
    // Первая годная клетка от указателя: клетки «нового участка у чужих нод» пропускаются, но указатель стоит.
    let first = zone.ptr
    for (;;) {
      ensureOffsets(first + 1)
      if (usable(zone.cx + offsetDx[first], zone.cy + offsetDy[first], zi)) break
      first++
    }
    let bestX = zone.cx + offsetDx[first]
    let bestY = zone.cy + offsetDy[first]

    const linked = adj[v].filter((u) => done[u] === 1)
    if (linked.length > 0) {
      linked.sort((a, b) => idRank[a] - idRank[b])
      let bestScore = Infinity
      let bestCenter = Infinity
      const consider = (cx: number, cy: number) => {
        const px = cx * GRAPH_CELL
        const py = cy * GRAPH_CELL
        let pull = 0
        for (const u of linked) {
          const dx = px - xs[u]
          const dy = py - ys[u]
          pull += dx * dx + dy * dy
        }
        const center = (px - zone.x) * (px - zone.x) + (py - zone.y) * (py - zone.y)
        const score = pull + CENTER_WEIGHT * center
        if (score > bestScore) return
        if (score === bestScore) {
          if (center > bestCenter) return
          if (center === bestCenter && (cy > bestY || (cy === bestY && cx >= bestX))) return
        }
        bestScore = score
        bestCenter = center
        bestX = cx
        bestY = cy
      }

      // (а) ближайшие к центру незаблокированные клетки зоны
      for (let p = first, found = 0; found < CENTER_CANDIDATES; p++) {
        ensureOffsets(p + 1)
        const cx = zone.cx + offsetDx[p]
        const cy = zone.cy + offsetDy[p]
        if (!usable(cx, cy, zi)) continue
        found++
        consider(cx, cy)
      }
      // (б) клетки вокруг связанных нод: своей зоны — где бы они ни стояли, чужой — только у нашей зоны
      const reach = zone.r + 2 * GRAPH_CELL
      const zoneR2 = zone.r * zone.r
      let used = 0
      for (const u of linked) {
        if (used === NEIGHBOR_LIMIT) break
        const udx = xs[u] - zone.x
        const udy = ys[u] - zone.y
        const uCenter = udx * udx + udy * udy
        const own = zoneOf[u] === zi
        if (!own && uCenter >= reach * reach) continue
        used++
        const ux = toCell(xs[u])
        const uy = toCell(ys[u])
        const side = own ? NEIGHBOR_REACH : FOREIGN_REACH
        for (let dy = -side; dy <= side; dy++) {
          for (let dx = -side; dx <= side; dx++) {
            const cx = ux + dx
            const cy = uy + dy
            if (!usable(cx, cy, zi)) continue
            // Связь не выводит ноду из зоны: за её радиусом годится только клетка ближе к центру, чем
            // сам сосед. Иначе цепочка связей с чужой категорией шаг за шагом уползает в чужую зону.
            const px = cx * GRAPH_CELL - zone.x
            const py = cy * GRAPH_CELL - zone.y
            const center = px * px + py * py
            if (center > zoneR2 && center >= uCenter) continue
            consider(cx, cy)
          }
        }
      }
    }

    occupied.add(cellKey(bestX, bestY))
    mark(bestX, bestY, zi)
    xs[v] = bestX * GRAPH_CELL
    ys[v] = bestY * GRAPH_CELL
    done[v] = 1
    placed.push(list[v].id)
  }

  for (let zi = 0; zi < zones.length; zi++) {
    // Компоненты связности среди нод зоны, которым нужно место.
    const comps: Array<{ nodes: number[]; minCreatedAt: number; minIdRank: number }> = []
    for (const start of zones[zi].members) {
      if (done[start] === 1 || compOf[start] !== -1) continue
      const comp = compCount++
      const compNodes: number[] = []
      let minCreatedAt = Infinity
      let minIdRank = Infinity
      const stack = [start]
      compOf[start] = comp
      while (stack.length > 0) {
        const v = stack.pop()!
        compNodes.push(v)
        minCreatedAt = Math.min(minCreatedAt, list[v].createdAt)
        minIdRank = Math.min(minIdRank, idRank[v])
        for (const u of adj[v]) {
          if (zoneOf[u] !== zi || done[u] === 1 || compOf[u] !== -1) continue
          compOf[u] = comp
          stack.push(u)
        }
      }
      comps.push({ nodes: compNodes, minCreatedAt, minIdRank })
    }
    comps.sort((a, b) => a.minCreatedAt - b.minCreatedAt || a.minIdRank - b.minIdRank)

    for (const comp of comps) {
      // Обход в ширину от ноды с наибольшей степенью: вокруг неё соберётся вся компонента.
      let root = -1
      let rootDegree = -1
      for (const v of comp.nodes) {
        let degree = 0
        for (const u of adj[v]) if (compOf[u] === compOf[v]) degree++
        if (degree > rootDegree || (degree === rootDegree && v < root)) {
          root = v
          rootDegree = degree
        }
      }
      const queue = [root]
      queued[root] = 1
      for (let head = 0; head < queue.length; head++) {
        const v = queue[head]
        place(v, zi)
        for (const u of adj[v]) {
          if (queued[u] === 1 || compOf[u] !== compOf[v]) continue
          queued[u] = 1
          queue.push(u)
        }
      }
    }
  }

  // 7. Итог.
  const positions = new Map<string, GraphPoint>()
  const half = GRAPH_NODE_SIZE / 2
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (let i = 0; i < count; i++) {
    positions.set(list[i].id, { x: xs[i], y: ys[i] })
    bounds.minX = Math.min(bounds.minX, xs[i] - half)
    bounds.minY = Math.min(bounds.minY, ys[i] - half)
    bounds.maxX = Math.max(bounds.maxX, xs[i] + half)
    bounds.maxY = Math.max(bounds.maxY, ys[i] + half)
  }
  return {
    positions,
    placed,
    displaced,
    zones: zones.map((zone) => ({ key: zone.key, x: zone.x, y: zone.y, r: zone.r, count: zone.members.length })),
    bounds,
  }
}

/** Ближайший к target свободный узел сетки (для броска ноды). taken — занятые положения, ignoreId — сама нода. */
export function findFreeSpot(
  target: GraphPoint,
  taken: Readonly<Record<string, GraphPoint>>,
  ignoreId?: string,
): GraphPoint {
  // Точку дальше предела координат репозиторий не сохранит — ищем место внутри него.
  const clamp = (v: number) => (Number.isFinite(v) ? Math.max(-MAX_GRAPH_COORD, Math.min(MAX_GRAPH_COORD, v)) : 0)
  const tx = clamp(target.x)
  const ty = clamp(target.y)

  const occupied = new Set<number>()
  for (const id of Object.keys(taken)) {
    if (id === ignoreId) continue
    const p = taken[id]
    if (isPoint(p)) occupied.add(cellKey(toCell(p.x), toCell(p.y)))
  }

  const [cx, cy] = nearestFreeCell(tx, ty, (x, y) => occupied.has(cellKey(x, y)))
  return { x: cx * GRAPH_CELL, y: cy * GRAPH_CELL }
}
