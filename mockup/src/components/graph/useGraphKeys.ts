import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { GraphLive } from '@/components/graph/GraphCanvas'
import {
  actArchive,
  actDelete,
  actLinkItems,
  actToggleFavorite,
  actUnarchive,
  actUnlinkItems,
} from '@/lib/actions'
import { tabRingNext } from '@/components/graph/gestureLogic'
import { detailSheetOpen, graphKeyTarget, isEditableTarget, overlayOpen } from '@/lib/hotkeyGuards'
import { matchKey } from '@/lib/keys'
import { ensureVisible, nearestInDirection, screenToWorld, sortByAngle, worldToScreen } from '@/lib/graph/geometry'
import { smiteFromScene } from '@/lib/graph/smite'
import type { GraphScene, GraphViewport } from '@/lib/graph/types'
import { useGraph } from '@/store/graph'
import { useUi } from '@/store/ui'
import type { Item } from '@/types'

export interface GraphKeyOptions {
  stageRef: RefObject<HTMLDivElement | null>
  live: GraphLive
  sceneRef: RefObject<GraphScene>
  itemsRef: RefObject<ReadonlyMap<string, Item>>
}

/** Сдвиг вида Shift+стрелкой, CSS-пиксели. */
const PAN_STEP = 96
/** Фокусируемая обёртка боковой панели деталей (AppShell: DetailPane внутри aside). */
const DETAIL_PANE = 'aside[aria-label="Подробности записи"] [tabindex="-1"]'

type Dir = 'left' | 'right' | 'up' | 'down'
const ARROWS: ReadonlyArray<[string, Dir]> = [
  ['ArrowLeft', 'left'],
  ['ArrowRight', 'right'],
  ['ArrowUp', 'up'],
  ['ArrowDown', 'down'],
]

function viewport(): GraphViewport {
  const { camera, viewSize } = useGraph.getState()
  return { width: viewSize.width, height: viewSize.height, dpr: 1, camera }
}

/**
 * Клавиши раздела «Граф» (spec-stage5 §4.2.4). Слушатель на document в фазе перехвата — раньше useHotkeys:
 * обработанная клавиша получает preventDefault, и глобальные клавиши её пропускают. 1–5, N и / не трогаются.
 */
export function useGraphKeys(options: GraphKeyOptions): void {
  const opts = useRef(options)
  useLayoutEffect(() => {
    opts.current = options
  })
  const { stageRef, live } = options

  useEffect(() => {
    const scene = () => opts.current.sceneRef.current
    // Обход соседей по Tab: вокруг какой ноды и на каком соседе стоит курсор.
    let tabRing: { hub: string; at: string } | null = null

    /** Курсор на ноду: показать её на экране; открыта панель деталей — она следует за курсором. */
    const moveCursor = (id: string) => {
      const g = useGraph.getState()
      const sc = scene()
      const node = sc.nodes[sc.byId.get(id) ?? -1]
      if (!node) return
      g.setCursor(id, true)
      const cam = ensureVisible(viewport(), { x: node.x, y: node.y })
      if (cam) g.setCamera(cam)
      const ui = useUi.getState()
      if (ui.selectedId !== null && ui.selectedId !== id) ui.select(id)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return
      if (isEditableTarget(e.target) || overlayOpen() || detailSheetOpen()) return
      // Меню, выбор категории и плашка связи держат свою клавиатуру. Панель графа — нет: после клика по её кнопке
      // клавиши графа должны работать (стрелки, Tab и Enter там и так не перехватываются — фокус не на сцене).
      if (e.target instanceof Element && e.target.closest('[data-graph-ui]:not([role="toolbar"])')) return

      const stage = stageRef.current
      const active = document.activeElement
      // Стрелки, Tab, Enter, Пробел, Shift+F10 — только когда фокус на сцене (или нигде): иначе они ломали бы кнопки
      // и поля панели деталей, боковой панели и панели графа.
      const stageFocus = !active || active === document.body || active === stage

      const g = useGraph.getState()
      const ui = useUi.getState()
      const sc = scene()
      // Запись, открытая в панели деталей, важнее курсора: действие уходит на то, что пользователь видит в панели.
      const target = graphKeyTarget(ui.selectedId, g.cursorId, sc.byId)
      const targetInScene = target !== null
      // Только preventDefault: useHotkeys пропускает такие клавиши сам, а события ниже по дереву нужны (contextmenu).
      const handled = () => e.preventDefault()

      // ── только при фокусе на сцене ──
      if (stageFocus) {
        const arrow = ARROWS.find(([code]) => matchKey(e, code, code))
        if (arrow) {
          handled()
          const dir = arrow[1]
          if (e.shiftKey) {
            const dx = dir === 'left' ? PAN_STEP : dir === 'right' ? -PAN_STEP : 0
            const dy = dir === 'up' ? PAN_STEP : dir === 'down' ? -PAN_STEP : 0
            g.panBy(dx, dy)
            return
          }
          if (sc.nodes.length === 0) return
          const fromId = g.cursorId !== null && sc.byId.has(g.cursorId) ? g.cursorId : ui.selectedId
          const fromIndex = fromId !== null ? sc.byId.get(fromId) : undefined
          let next: number
          if (fromIndex === undefined) {
            // Ни курсора, ни выбранной ноды — начинаем с ближайшей к центру экрана.
            const v = viewport()
            const c = screenToWorld(v, { x: v.width / 2, y: v.height / 2 })
            next = -1
            let best = Infinity
            sc.nodes.forEach((n, i) => {
              const d = Math.hypot(n.x - c.x, n.y - c.y)
              if (d < best) {
                best = d
                next = i
              }
            })
          } else {
            const from = sc.nodes[fromIndex]
            next = nearestInDirection(sc.nodes, { x: from.x, y: from.y }, dir, fromIndex)
          }
          if (next >= 0) moveCursor(sc.nodes[next].id)
          return
        }

        if (matchKey(e, 'Tab', 'Tab')) {
          // Обход соседей ноды, с которой начали: пока курсор стоит на её соседе, пришедшем по Tab, центр — прежний.
          // Обход один: после последнего соседа (первого при Shift+Tab) и у ноды без связей Tab не перехватывается,
          // и фокус уходит дальше по странице — панель графа, панель деталей (Р17: Tab не ловушка).
          const hubIndex =
            tabRing && tabRing.at === g.cursorId && sc.byId.has(tabRing.hub) ? sc.byId.get(tabRing.hub) : undefined
          const ci = hubIndex ?? (target !== null ? sc.byId.get(target) : undefined)
          if (ci === undefined) return
          const center = sc.nodes[ci]
          if (center.links.length === 0) return
          const order = sortByAngle(sc.nodes, { x: center.x, y: center.y }, center.links)
          const at = hubIndex !== undefined && g.cursorId !== null ? order.indexOf(sc.byId.get(g.cursorId) ?? -1) : -1
          const pos = tabRingNext(order.length, at, e.shiftKey)
          if (pos === null) {
            tabRing = null
            return
          }
          handled()
          const id = sc.nodes[order[pos]].id
          tabRing = { hub: center.id, at: id }
          moveCursor(id)
          return
        }

        if ((matchKey(e, 'Enter', 'Enter') || matchKey(e, 'NumpadEnter', 'Enter') || matchKey(e, 'Space', ' ')) && !e.shiftKey) {
          const cursor = g.cursorId
          if (cursor === null || !sc.byId.has(cursor)) return
          handled()
          if (e.repeat) return
          if (g.linkFrom !== null) {
            if (g.linkFrom !== cursor) void actLinkItems(g.linkFrom, cursor)
            g.setLinkFrom(null)
          } else if (ui.selectedId === cursor) {
            // Запись уже открыта в боковой панели (она фокус не забирает) — Enter переводит фокус в неё.
            document.querySelector<HTMLElement>(DETAIL_PANE)?.focus()
          } else {
            ui.select(cursor)
          }
          return
        }

        if ((e.shiftKey && matchKey(e, 'F10', 'F10')) || (!e.shiftKey && matchKey(e, 'ContextMenu', 'ContextMenu'))) {
          if (!targetInScene || target === null) return
          handled()
          const node = sc.nodes[sc.byId.get(target) as number]
          const p = worldToScreen(viewport(), { x: node.x, y: node.y })
          g.openMenu({ id: target, x: Math.round(p.x), y: Math.round(p.y) })
          return
        }
      }

      // ── при любом фокусе вне полей ввода ──
      if (matchKey(e, 'Escape', 'Escape')) {
        if (live.cancel()) return handled()
        if (g.linkFrom !== null) {
          handled()
          g.setLinkFrom(null)
          return
        }
        if (g.selectedLink !== null) {
          handled()
          g.selectLink(null)
          return
        }
        // Детали открыты — Esc закроет их useHotkeys.
        if (ui.selectedId !== null) return
        if (g.cursorId !== null) {
          handled()
          g.setCursor(null)
        }
        return
      }

      // Масштаб: «+» — это и Shift+«=».
      if (matchKey(e, 'Equal', '=') || matchKey(e, 'NumpadAdd', '+') || (!e.code && e.key === '+')) {
        handled()
        g.zoomStep(1)
        return
      }
      if (e.shiftKey) return
      if (matchKey(e, 'Minus', '-') || matchKey(e, 'NumpadSubtract', '-')) {
        handled()
        g.zoomStep(-1)
        return
      }
      if (matchKey(e, 'Digit0', '0') || matchKey(e, 'Numpad0', '0')) {
        handled()
        g.fitAll()
        return
      }

      if (matchKey(e, 'Delete', 'Delete') || matchKey(e, 'Backspace', 'Backspace')) {
        const link = g.selectedLink
        if (link) {
          handled()
          if (e.repeat) return
          void actUnlinkItems(link.a, link.b)
          g.selectLink(null)
          return
        }
        if (!targetInScene || target === null) return
        handled()
        if (e.repeat) return
        if (g.cursorId === target) g.setCursor(null)
        if (ui.selectedId === target) ui.select(null)
        // на графе — сцена казни (lib/graph/smite); без сцены — обычное удаление
        const sc = scene()
        if (sc) smiteFromScene([target], sc)
        else void actDelete(target)
        return
      }

      if (matchKey(e, 'KeyL', 'l')) {
        if (g.linkFrom !== null) {
          handled()
          g.setLinkFrom(null)
          return
        }
        if (!targetInScene || target === null) return
        handled()
        g.setLinkFrom(target)
        return
      }

      if (!targetInScene || target === null) return
      const item = opts.current.itemsRef.current.get(target)

      if (matchKey(e, 'KeyE', 'e')) {
        handled()
        if (e.repeat) return
        g.openPicker(target)
        return
      }
      if (matchKey(e, 'KeyA', 'a')) {
        handled()
        if (e.repeat || !item) return
        void (item.status === 'archive' ? actUnarchive(target) : actArchive(target))
        return
      }
      if (matchKey(e, 'KeyF', 'f')) {
        handled()
        if (e.repeat || !item) return
        void actToggleFavorite(item)
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [stageRef, live])
}
