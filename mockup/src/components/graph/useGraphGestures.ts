import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { GraphLive } from '@/components/graph/GraphCanvas'
import { actLinkItems } from '@/lib/actions'
import { buttonsReleased, deferSelect, movePx, underDetailPanel } from '@/components/graph/gestureLogic'
import { cancelSwarm, dropSwarm, getSwarm, moveSwarmLead, shownScene, startSwarm, stopSwarm } from '@/components/graph/swarmDriver'
import { findFreeSpot, GRAPH_NONE_ZONE } from '@/lib/graphLayout'
import {
  GRAPH_TOUCH_HIT_PX,
  hitLink,
  hitNode,
  hitNodeStrict,
  pinchStep,
  screenToWorld,
  wheelSteps,
} from '@/lib/graph/geometry'
import { createSwarm, planSwarmDrop, takenWithoutSwarm } from '@/lib/graph/swarm'
import { DETAIL_ASIDE_PX, GRAPH_SELECT_DEFER_MS, secondClickNode, type NodeClickMemo } from '@/lib/graph/interaction'
import type { GraphScene, GraphViewport } from '@/lib/graph/types'
import { useGraph } from '@/store/graph'
import { useUi } from '@/store/ui'
import type { GraphPoint } from '@/types'

export interface GraphGestureOptions {
  /** Элемент сцены; null — сцены нет (пустое состояние). */
  stage: HTMLDivElement | null
  live: GraphLive
  /** Текущая сцена (меняется без перерисовки жестов). */
  sceneRef: RefObject<GraphScene>
  /** Все занятые положения, в том числе скрытых нод (архив, корзина): брошенная нода на них не встаёт. */
  takenRef: RefObject<ReadonlyMap<string, GraphPoint>>
  /** Нода брошена в свободную клетку. */
  onMoved: (id: string, point: GraphPoint) => void
  /** Группа (нода и её категория) брошена: новые положения всех сдвинувшихся нод. */
  onGroupMoved: (moves: Record<string, GraphPoint>) => void
}

const LONG_PRESS_MS = 500
/** Боковая панель деталей (не модальный лист) — та же граница, что в AppShell. */
const SIDE_DETAIL_QUERY = '(min-width: 1100px)'
/** Строки и страницы колеса → пиксели (как в wheelSteps). */
const LINE_PX = 32
const PAGE_PX = 400

type Pt = { x: number; y: number }

interface Press {
  pointerId: number
  touch: boolean
  x0: number
  y0: number
  /** Координата нажатия в окне (не в сцене): боковая панель деталей прижата к краю окна. */
  clientX: number
  /** Нода для клика и долгого нажатия (широкая зона попадания). */
  nodeId: string | null
  /** Нода для переноса — только строгое попадание в квадрат; иначе перетаскивание сдвигает фон. */
  dragId: string | null
  handleId: string | null
  /** Нажатие пришлось на ручку связи, но это второй клик двойного клика по той же ноде: клик ручки гасится. */
  swallowHandle: boolean
  /** Сцена на момент первого клика, если это второй клик двойного клика: память о ноде не должна «забыть» сдвиг. */
  memoView: { camera: unknown; viewSize: unknown } | null
  shift: boolean
  /** Alt — перенос одной ноды, без её категории. */
  alt: boolean
}

type Active =
  | { kind: 'pan'; pointerId: number; x: number; y: number }
  | { kind: 'node'; pointerId: number; id: string; offX: number; offY: number; taken: Record<string, GraphPoint>; swarm: boolean }
  | { kind: 'link'; pointerId: number; fromId: string }
  | { kind: 'pinch'; dist: number }
  // Щипок закончился, пока на сцене ещё палец: ждём, пока поднимут все.
  | { kind: 'spent' }

const inUi = (t: EventTarget | null): boolean => t instanceof Element && t.closest('[data-graph-ui]') !== null

function handleOf(t: EventTarget | null): string | null {
  if (!(t instanceof Element)) return null
  return t.closest<HTMLElement>('[data-graph-handle]')?.dataset.graphHandle ?? null
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y)

function sideDetail(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(SIDE_DETAIL_QUERY).matches
}

/**
 * Указатель и колесо на сцене графа: сдвиг, масштаб, наведение, клик, двойной клик, перенос ноды, протяжка связи,
 * клик по связи, меню ноды, касания и щипок (spec-stage5 §4.2.3). Нажатия и колесо внутри [data-graph-ui] не трогаются.
 */
export function useGraphGestures(options: GraphGestureOptions): void {
  const opts = useRef(options)
  useLayoutEffect(() => {
    opts.current = options
  })
  const { stage, live } = options

  useEffect(() => {
    if (!stage) return

    let press: Press | null = null
    let active: Active | null = null
    let longTimer: ReturnType<typeof setTimeout> | undefined
    let dropRaf = 0
    let wheelAcc = 0
    let wheelT: number | undefined
    let suppressClick = false
    // Последний клик по ноде: второй клик двойного клика берёт ноду из памяти — после первого клика сцена могла
    // сузиться (открылась панель деталей) или камера сдвинулась к ноде у края.
    let lastClick: NodeClickMemo | null = null
    // Отложенный выбор ноды там, где выбор открывает модальный лист: двойной клик его отменяет.
    let pendingSelect: ReturnType<typeof setTimeout> | undefined
    // Время последнего Shift+F10 / клавиши меню: меню уже открыл useGraphKeys, событие contextmenu его не дублирует.
    let keyMenuAt = -Infinity
    const touches = new Map<number, Pt>()

    // Сцена, какой её видно: пока стая доплывает, указатель попадает в ноды там, где они нарисованы.
    const scene = () => shownScene(opts.current.sceneRef.current)
    const reducedMotion = () =>
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const viewport = (): GraphViewport => {
      const { camera, viewSize } = useGraph.getState()
      return { width: viewSize.width, height: viewSize.height, dpr: 1, camera }
    }
    const local = (e: { clientX: number; clientY: number }): Pt => {
      const r = stage.getBoundingClientRect()
      return { x: e.clientX - r.left - stage.clientLeft, y: e.clientY - r.top - stage.clientTop }
    }
    const world = (p: Pt): GraphPoint => screenToWorld(viewport(), p)
    // Пальцем зона попадания шире (≥ 36 px, DESIGN §10).
    const hitOpts = (touch: boolean) => (touch ? { radiusPx: GRAPH_TOUCH_HIT_PX } : undefined)
    const nodeAt = (p: Pt, touch = false): string | null => {
      const sc = scene()
      const i = hitNode(sc.index, sc.nodes, world(p), useGraph.getState().camera.zoom, hitOpts(touch))
      return i >= 0 ? sc.nodes[i].id : null
    }
    const nodeAtStrict = (p: Pt): string | null => {
      const sc = scene()
      const i = hitNodeStrict(sc.index, sc.nodes, world(p), useGraph.getState().camera.zoom)
      return i >= 0 ? sc.nodes[i].id : null
    }
    const linkAt = (p: Pt, touch = false): { a: string; b: string } | null => {
      const sc = scene()
      const i = hitLink(sc.nodes, sc.links, world(p), useGraph.getState().camera.zoom, hitOpts(touch))
      return i >= 0 ? { a: sc.nodes[sc.links[i].a].id, b: sc.nodes[sc.links[i].b].id } : null
    }
    const clearPendingSelect = () => {
      if (pendingSelect !== undefined) clearTimeout(pendingSelect)
      pendingSelect = undefined
    }
    const setCursorKind = (kind: 'grab' | 'grabbing' | 'pointer' | 'crosshair') => {
      if (stage.dataset.cursor !== kind) stage.dataset.cursor = kind
    }
    const capture = (pointerId: number) => {
      try {
        stage.setPointerCapture(pointerId)
      } catch {
        // указатель уже отпущен
      }
    }
    const release = (pointerId: number) => {
      try {
        if (stage.hasPointerCapture(pointerId)) stage.releasePointerCapture(pointerId)
      } catch {
        // уже снят
      }
    }
    const clearLong = () => {
      if (longTimer !== undefined) clearTimeout(longTimer)
      longTimer = undefined
    }
    const muteNextClick = () => {
      suppressClick = true
      // Клика может и не быть (отпустили вне сцены) — гасим только ближайший.
      setTimeout(() => {
        suppressClick = false
      }, 0)
    }

    /** Завершить жест без записи. */
    const endGesture = () => {
      const was = active
      active = null
      clearLong()
      if (dropRaf) cancelAnimationFrame(dropRaf)
      dropRaf = 0
      if (was && 'pointerId' in was) release(was.pointerId)
      // Жест прерван до отпускания: стая возвращается на места (после обычного отпускания она уже отпущена).
      cancelSwarm()
      live.drag = null
      live.tempLink = null
      useGraph.getState().setDrag(null)
      setCursorKind('grab')
      live.invalidate()
    }

    live.cancel = () => {
      // Esc сразу после клика отменяет и отложенное открытие записи.
      const pending = pendingSelect !== undefined
      clearPendingSelect()
      if (!active && !press) return pending
      press = null
      if (active) {
        endGesture()
        muteNextClick()
      }
      return true
    }

    const updateDrop = () => {
      if (!active || active.kind !== 'node' || !live.drag) return
      live.drag = { ...live.drag, drop: findFreeSpot({ x: live.drag.x, y: live.drag.y }, active.taken, active.id) }
    }
    // Свободная клетка пересчитывается не чаще кадра: на 2000 нод это обход всех положений.
    const scheduleDrop = () => {
      if (dropRaf) return
      dropRaf = requestAnimationFrame(() => {
        dropRaf = 0
        updateDrop()
        live.invalidate()
      })
    }

    const hover = (p: Pt, target: EventTarget | null) => {
      const g = useGraph.getState()
      live.pointer = p
      if (inUi(target) || handleOf(target)) {
        g.setHovered(null)
        const had = live.hoverLink !== null
        if (had) live.hoverLink = null
        setCursorKind('pointer')
        // Смену hoveredId холст видит сам (подписка на стор); кадр нужен, только если сняли связь или идёт
        // режим связи (временная линия за указателем).
        if (had || g.linkFrom !== null) live.invalidate()
        return
      }
      const id = nodeAt(p)
      g.setHovered(id)
      const link = id ? null : linkAt(p)
      const prev = live.hoverLink
      if (prev?.a !== link?.a || prev?.b !== link?.b) live.hoverLink = link
      setCursorKind(id || link ? 'pointer' : g.linkFrom !== null ? 'crosshair' : 'grab')
      // В режиме связи временная линия идёт за указателем.
      if (g.linkFrom !== null || prev !== live.hoverLink) live.invalidate()
    }

    const click = (pr: Press, p: Pt) => {
      // Клик по ручке связи обрабатывает её onClick.
      if (pr.handleId) return
      const g = useGraph.getState()
      const ui = useUi.getState()
      const id = pr.nodeId ?? nodeAt(p, pr.touch)
      clearPendingSelect()
      if (id) {
        if (g.linkFrom !== null && g.linkFrom !== id) {
          lastClick = null
          void actLinkItems(g.linkFrom, id)
          g.setLinkFrom(null)
        } else {
          g.setCursor(id)
          lastClick = pr.touch
            ? null
            : { id, x: p.x, y: p.y, t: performance.now(), ...(pr.memoView ?? { camera: g.camera, viewSize: g.viewSize }) }
          const under = underDetailPanel(pr.clientX, window.innerWidth, DETAIL_ASIDE_PX)
          if (deferSelect(pr.touch, sideDetail(), ui.selectedId !== null, under)) {
            pendingSelect = setTimeout(() => {
              pendingSelect = undefined
              useUi.getState().select(id)
            }, GRAPH_SELECT_DEFER_MS)
          } else {
            ui.select(id)
          }
        }
        stage.focus({ preventScroll: true })
        return
      }
      lastClick = null
      const link = linkAt(p, pr.touch)
      if (link) {
        const w = world(p)
        g.selectLink({ a: link.a, b: link.b, x: w.x, y: w.y })
        return
      }
      ui.select(null)
      g.setCursor(null)
      g.selectLink(null)
      g.setLinkFrom(null)
    }

    const startPinch = () => {
      const [a, b] = [...touches.values()]
      if (active) endGesture()
      press = null
      clearLong()
      active = { kind: 'pinch', dist: dist(a, b) }
      useGraph.getState().setDrag('pan')
    }

    const begin = (pr: Press, p: Pt) => {
      press = null
      clearLong()
      const g = useGraph.getState()
      // Пальцем — только сдвиг (Р18): перенос ноды и протяжка связи — мышью и пером.
      if (!pr.touch && (pr.handleId || (pr.nodeId && pr.shift))) {
        const fromId = (pr.handleId ?? pr.nodeId) as string
        active = { kind: 'link', pointerId: pr.pointerId, fromId }
        capture(pr.pointerId)
        g.setHovered(null)
        g.setDrag('link')
        setCursorKind('crosshair')
        moveLink(p)
        return
      }
      if (!pr.touch && pr.dragId) {
        // Прежняя стая ещё доплывает — сразу на места: новый перенос отсчитывается от положений сцены.
        stopSwarm()
        const sc = opts.current.sceneRef.current
        const node = sc.nodes[sc.byId.get(pr.dragId) ?? -1]
        if (node) {
          const w0 = world({ x: pr.x0, y: pr.y0 })
          // Ноды той же категории плывут следом; без категории и с Alt — только сама нода.
          const mates =
            pr.alt || node.zone === GRAPH_NONE_ZONE ? [] : sc.nodes.filter((n) => n.zone === node.zone && n.id !== node.id)
          const swarm = mates.length > 0 ? createSwarm(node, mates, reducedMotion()) : null
          const taken = takenWithoutSwarm(opts.current.takenRef.current, swarm)
          active = {
            kind: 'node',
            pointerId: pr.pointerId,
            id: node.id,
            offX: w0.x - node.x,
            offY: w0.y - node.y,
            taken,
            swarm: swarm !== null,
          }
          if (swarm) startSwarm(swarm)
          capture(pr.pointerId)
          g.setHovered(null)
          g.setDrag('node')
          setCursorKind('grabbing')
          live.drag = { id: node.id, x: node.x, y: node.y, drop: null }
          moveNode(p)
          updateDrop()
          live.invalidate()
          return
        }
      }
      active = { kind: 'pan', pointerId: pr.pointerId, x: pr.x0, y: pr.y0 }
      capture(pr.pointerId)
      g.setHovered(null)
      g.setDrag('pan')
      setCursorKind('grabbing')
      movePan(p)
    }

    const movePan = (p: Pt) => {
      if (!active || active.kind !== 'pan') return
      const dx = p.x - active.x
      const dy = p.y - active.y
      active.x = p.x
      active.y = p.y
      if (dx !== 0 || dy !== 0) useGraph.getState().panBy(dx, dy)
    }
    const moveNode = (p: Pt) => {
      if (!active || active.kind !== 'node' || !live.drag) return
      const w = world(p)
      live.drag = { ...live.drag, x: w.x - active.offX, y: w.y - active.offY }
      if (active.swarm) moveSwarmLead({ x: live.drag.x, y: live.drag.y })
      scheduleDrop()
      live.invalidate()
    }
    const moveLink = (p: Pt) => {
      if (!active || active.kind !== 'link') return
      const w = world(p)
      const over = nodeAt(p)
      live.tempLink = { fromId: active.fromId, x: w.x, y: w.y, targetId: over !== active.fromId ? over : null }
      live.invalidate()
    }

    const onPointerDown = (e: PointerEvent) => {
      if (inUi(e.target)) return
      // Новое нажатие отменяет отложенный выбор: при двойном клике его заново поставит click() на отпускании и
      // снимет dblclick, а при начатом жесте лист поверх сцены открываться не должен.
      clearPendingSelect()
      const p = local(e)
      const touch = e.pointerType === 'touch'
      if (touch) {
        touches.set(e.pointerId, p)
        if (touches.size === 2) {
          startPinch()
          return
        }
        if (touches.size > 2 || active) return
      }
      if (active) return
      if (e.button === 1) {
        // Средняя кнопка — сдвиг откуда угодно; preventDefault гасит автопрокрутку.
        e.preventDefault()
        press = null
        active = { kind: 'pan', pointerId: e.pointerId, x: p.x, y: p.y }
        capture(e.pointerId)
        useGraph.getState().setDrag('pan')
        setCursorKind('grabbing')
        return
      }
      if (e.button !== 0) return
      // Второй клик двойного клика — по ноде первого, даже если она уже ушла из-под указателя.
      const again = touch ? null : secondClickNode(lastClick, p, performance.now(), useGraph.getState())
      // Ручка у выбранной ноды заходит на её угол: второй клик по ней — это клик по ноде, а не включение связи.
      const rawHandle = handleOf(e.target)
      const swallowHandle = rawHandle !== null && again !== null && rawHandle === again
      const handleId = swallowHandle ? null : rawHandle
      const nodeId = handleId ? null : (again ?? nodeAt(p, touch))
      const dragId = handleId || touch ? null : nodeAtStrict(p)
      press = {
        pointerId: e.pointerId,
        touch,
        x0: p.x,
        y0: p.y,
        clientX: e.clientX,
        nodeId,
        dragId,
        handleId,
        swallowHandle,
        memoView: again !== null && lastClick ? { camera: lastClick.camera, viewSize: lastClick.viewSize } : null,
        shift: e.shiftKey,
        alt: e.altKey,
      }
      clearLong()
      if (touch && nodeId) {
        const pr = press
        longTimer = setTimeout(() => {
          longTimer = undefined
          if (press !== pr) return
          press = null
          useGraph.getState().openMenu({ id: nodeId, x: pr.x0, y: pr.y0 })
        }, LONG_PRESS_MS)
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const touch = e.pointerType === 'touch'
      if (touch && touches.has(e.pointerId)) touches.set(e.pointerId, local(e))
      if (active?.kind === 'pinch') {
        if (touches.size < 2) return
        const [a, b] = [...touches.values()]
        const d = dist(a, b)
        const step = pinchStep(active.dist, d)
        if (step !== 0) {
          useGraph.getState().zoomStep(step, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
          active.dist = d
        }
        return
      }
      if (active?.kind === 'spent') return
      const p = local(e)
      // Кнопку отпустили там, где сцена pointerup не получила (вне сцены до захвата, окно было неактивно):
      // нажатие и жест без кнопки не продолжаются и ничего не записывают.
      if (buttonsReleased(e.pointerType, e.buttons)) {
        if (press?.pointerId === e.pointerId) {
          press = null
          clearLong()
        }
        if (active && 'pointerId' in active && active.pointerId === e.pointerId) endGesture()
      }
      if (active && 'pointerId' in active) {
        if (active.pointerId !== e.pointerId) return
        if (active.kind === 'pan') movePan(p)
        else if (active.kind === 'node') moveNode(p)
        else moveLink(p)
        return
      }
      if (press && press.pointerId === e.pointerId) {
        if (Math.hypot(p.x - press.x0, p.y - press.y0) > movePx(press.touch)) begin(press, p)
        return
      }
      if (!touch && e.buttons === 0) hover(p, e.target)
    }

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        touches.delete(e.pointerId)
        if (active?.kind === 'pinch' || active?.kind === 'spent') {
          if (touches.size === 0) {
            active = null
            useGraph.getState().setDrag(null)
            muteNextClick()
          } else {
            active = { kind: 'spent' }
          }
          return
        }
      }
      if (press && press.pointerId === e.pointerId) {
        const pr = press
        press = null
        clearLong()
        if (pr.swallowHandle) muteNextClick()
        click(pr, local(e))
        return
      }
      if (!active || !('pointerId' in active) || active.pointerId !== e.pointerId) return
      const done = active
      if (done.kind === 'node') {
        updateDrop()
        const drag = live.drag
        const sc = opts.current.sceneRef.current
        const node = sc.nodes[sc.byId.get(done.id) ?? -1]
        const swarm = done.swarm ? getSwarm() : null
        if (swarm && !swarm.released && drag?.drop) {
          // Стая: итоговые клетки всей группы; сохраняются только сдвинувшиеся.
          const finals = planSwarmDrop(swarm, drag.drop, done.taken)
          const moves: Record<string, GraphPoint> = {}
          for (const id of Object.keys(finals)) {
            const n = sc.nodes[sc.byId.get(id) ?? -1]
            if (n && (n.x !== finals[id].x || n.y !== finals[id].y)) moves[id] = finals[id]
          }
          dropSwarm(drag.drop, finals)
          if (Object.keys(moves).length > 0) opts.current.onGroupMoved(moves)
        } else if (drag?.drop && !(node && node.x === drag.drop.x && node.y === drag.drop.y)) {
          opts.current.onMoved(done.id, drag.drop)
        }
      } else if (done.kind === 'link') {
        const target = live.tempLink?.targetId
        if (target) void actLinkItems(done.fromId, target)
      }
      endGesture()
      muteNextClick()
      if (e.pointerType !== 'touch') hover(local(e), e.target)
    }

    const onPointerCancel = (e: PointerEvent) => {
      if (e.pointerType === 'touch') touches.delete(e.pointerId)
      if (press?.pointerId === e.pointerId) press = null
      clearLong()
      if (active?.kind === 'pinch' || active?.kind === 'spent') {
        if (touches.size === 0) {
          active = null
          useGraph.getState().setDrag(null)
        } else {
          active = { kind: 'spent' }
        }
        return
      }
      if (active && 'pointerId' in active && active.pointerId === e.pointerId) endGesture()
    }

    const onLostCapture = (e: PointerEvent) => {
      // Обычное отпускание уже завершило жест; сюда доходит только потеря захвата посреди жеста.
      if (active && 'pointerId' in active && active.pointerId === e.pointerId) endGesture()
    }

    const onPointerLeave = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || active) return
      live.pointer = null
      useGraph.getState().setHovered(null)
      if (live.hoverLink) live.hoverLink = null
      live.invalidate()
    }

    const onWheel = (e: WheelEvent) => {
      if (inUi(e.target)) return
      e.preventDefault()
      const g = useGraph.getState()
      if (e.shiftKey && !e.ctrlKey) {
        // Shift+колесо: браузер сам может отдать прокрутку в deltaX.
        const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? PAGE_PX : 1
        const d = (e.deltaY !== 0 ? e.deltaY : e.deltaX) * unit
        if (d !== 0) g.panBy(-d, 0)
        return
      }
      const r = wheelSteps(wheelAcc, e, wheelT)
      wheelAcc = r.acc
      wheelT = e.timeStamp
      if (r.steps !== 0) g.zoomStep(r.steps, local(e))
    }

    const onDblClick = (e: MouseEvent) => {
      if (inUi(e.target)) return
      const p = local(e)
      const again = secondClickNode(lastClick, p, performance.now(), useGraph.getState())
      // Двойной клик по ручке связи — не жест сцены, кроме случая, когда это двойной клик по её ноде.
      if (handleOf(e.target) && again === null) return
      e.preventDefault()
      const id = again ?? nodeAt(p)
      lastClick = null
      const g = useGraph.getState()
      if (id) {
        const sc = scene()
        const node = sc.nodes[sc.byId.get(id) ?? -1]
        if (node) {
          clearPendingSelect()
          // Сначала камера, потом выбор: открывшаяся панель деталей застаёт ноду уже в центре.
          g.centerOn({ x: node.x, y: node.y }, 1)
          g.setCursor(id)
          useUi.getState().select(id)
        }
      } else {
        g.zoomStep(1, p)
      }
    }

    const onContextMenu = (e: MouseEvent) => {
      if (inUi(e.target)) return
      // Меню с клавиатуры (Shift+F10, клавиша меню) открывает useGraphKeys у ноды под курсором.
      if (performance.now() - keyMenuAt < 500) {
        e.preventDefault()
        return
      }
      const p = local(e)
      const id = nodeAt(p)
      if (!id) return
      e.preventDefault()
      press = null
      clearLong()
      useGraph.getState().openMenu({ id, x: p.x, y: p.y })
    }

    const onKeyDownMenu = (e: KeyboardEvent) => {
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) keyMenuAt = performance.now()
    }

    // Окно потеряло фокус посреди нажатия (Alt+Tab): отпускание кнопки сцена может не увидеть.
    const onWindowBlur = () => {
      press = null
      clearLong()
      touches.clear()
      if (active) endGesture()
    }

    const onClickCapture = (e: MouseEvent) => {
      if (!suppressClick) return
      suppressClick = false
      e.stopPropagation()
      e.preventDefault()
    }

    setCursorKind('grab')
    stage.addEventListener('pointerdown', onPointerDown)
    stage.addEventListener('pointermove', onPointerMove)
    stage.addEventListener('pointerup', onPointerUp)
    stage.addEventListener('pointercancel', onPointerCancel)
    stage.addEventListener('lostpointercapture', onLostCapture)
    stage.addEventListener('pointerleave', onPointerLeave)
    stage.addEventListener('wheel', onWheel, { passive: false })
    stage.addEventListener('dblclick', onDblClick)
    stage.addEventListener('contextmenu', onContextMenu)
    stage.addEventListener('click', onClickCapture, true)
    stage.addEventListener('keydown', onKeyDownMenu, true)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      window.removeEventListener('blur', onWindowBlur)
      clearPendingSelect()
      stage.removeEventListener('pointerdown', onPointerDown)
      stage.removeEventListener('pointermove', onPointerMove)
      stage.removeEventListener('pointerup', onPointerUp)
      stage.removeEventListener('pointercancel', onPointerCancel)
      stage.removeEventListener('lostpointercapture', onLostCapture)
      stage.removeEventListener('pointerleave', onPointerLeave)
      stage.removeEventListener('wheel', onWheel)
      stage.removeEventListener('dblclick', onDblClick)
      stage.removeEventListener('contextmenu', onContextMenu)
      stage.removeEventListener('click', onClickCapture, true)
      stage.removeEventListener('keydown', onKeyDownMenu, true)
      clearLong()
      if (dropRaf) cancelAnimationFrame(dropRaf)
      live.cancel = () => false
      stopSwarm()
      live.drag = null
      live.tempLink = null
      live.hoverLink = null
      live.pointer = null
    }
  }, [stage, live])
}
