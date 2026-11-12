import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createGraphLive, GraphCanvas } from '@/components/graph/GraphCanvas'
import { GraphHeader } from '@/components/graph/GraphHeader'
import { GraphHint } from '@/components/graph/GraphHint'
import { GraphOverlay } from '@/components/graph/GraphOverlay'
import { GraphToolbar } from '@/components/graph/GraphToolbar'
import { useAmbient } from '@/components/graph/useAmbient'
import { useGraphGestures } from '@/components/graph/useGraphGestures'
import { useGraphKeys } from '@/components/graph/useGraphKeys'
import { EmptyState } from '@/components/items/EmptyState'
import { FilterBar } from '@/components/items/FilterBar'
import { Button } from '@/components/ui/button'
import { addPositions, setPositions } from '@/db/repo'
import { useAllItems, useCategoryList, useDayKey, useItemsWithTrash, usePositions } from '@/hooks/useItems'
import { actMoveNode } from '@/lib/actions'
import { describeError } from '@/lib/errors'
import { computeLayout, toLayoutNodes, type LayoutResult } from '@/lib/graphLayout'
import { ensureVisible } from '@/lib/graph/geometry'
import { revealDecision, type RevealMemo } from '@/lib/graph/interaction'
import { computeGraphMatch } from '@/lib/graph/match'
import { buildGraphScene } from '@/lib/graph/scene'
import type { GraphScene } from '@/lib/graph/types'
import { useGraph } from '@/store/graph'
import { useUi } from '@/store/ui'
import type { Category, GraphPoint, Item } from '@/types'

const NO_ITEMS: Item[] = []
const NO_CATEGORIES: Category[] = []
const NO_POSITIONS: Readonly<Record<string, GraphPoint>> = {}
const NO_MOVES: ReadonlyMap<string, GraphPoint> = new Map()
const EMPTY_LAYOUT: LayoutResult = { positions: new Map(), placed: [], displaced: [], zones: [], bounds: null }
/** Брошенная нода показывается на новом месте, пока база не подтвердила запись, но не дольше этого. */
const PENDING_MOVE_MS = 3000

// Вид вписывается в граф один раз за сессию, если камера не была восстановлена: при возврате в раздел вид прежний.
let fittedOnce = false

/** Подпись того, от чего зависит раскладка: правка заголовка или текста записи раскладку не пересчитывает. */
function itemsSignature(items: readonly Item[]): string {
  const parts: string[] = []
  for (const it of items) {
    const links = Array.isArray(it.links) ? [...it.links].sort().join(',') : ''
    parts.push(`${it.id}|${it.categoryId ?? ''}|${it.createdAt}|${it.deletedAt !== undefined ? 1 : 0}|${links}`)
  }
  return parts.join('\n')
}

function positionsSignature(fixed: Readonly<Record<string, GraphPoint>>): string {
  return Object.keys(fixed)
    .sort()
    .map((id) => `${id}:${fixed[id].x},${fixed[id].y}`)
    .join(';')
}

const samePoint = (a: GraphPoint | undefined, b: GraphPoint | undefined): boolean =>
  !!a && !!b && a.x === b.x && a.y === b.y

/** Раскладка: пересчёт только при смене подписи (записи раскладки, порядок категорий, сохранённые положения). */
function useLayout(
  all: Item[] | undefined,
  fixed: Record<string, GraphPoint> | undefined,
  categories: Category[] | undefined,
): LayoutResult {
  const itemsSig = useMemo(() => (all ? itemsSignature(all) : ''), [all])
  const fixedSig = useMemo(() => (fixed ? positionsSignature(fixed) : ''), [fixed])
  const catSig = categories ? categories.map((c) => c.id).join(',') : '\u0000'

  // Ключ — подписи, а не сами массивы: значения берутся из этого же рендера.
  return useMemo(() => {
    void itemsSig
    void fixedSig
    void catSig
    // Без порядка категорий зоны встали бы по алфавиту id и сразу сохранились бы: ждём и его.
    if (!all || !fixed || !categories) return EMPTY_LAYOUT
    return computeLayout(toLayoutNodes(all, fixed), categories.map((cat) => cat.id), fixed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all === undefined, fixed === undefined, itemsSig, fixedSig, catSig])
}

/**
 * Места, выданные раскладкой, сохраняются сразу: новые — addPositions (существующее не затирается), разведённые —
 * setPositions. Одна запись за раз; неудавшийся набор не повторяется (один toast).
 * all — снимок записей, по которому считалась раскладка: новое место пишется, только если категория записи в базе
 * та же (снимок положений мог прийти раньше снимка записей со сменой категории).
 */
function useSaveLayout(layout: LayoutResult, fixed: Record<string, GraphPoint> | undefined, all: Item[] | undefined): void {
  const writing = useRef(false)
  const done = useRef<{ sig: string; fixed: unknown } | null>(null)
  const failed = useRef<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!fixed || !all || layout.placed.length === 0 || writing.current) return
    const byId = new Map(all.map((it) => [it.id, it]))
    const displaced = new Set(layout.displaced)
    const add: Record<string, GraphPoint> = {}
    const cats: Record<string, string | null> = {}
    const set: Record<string, GraphPoint> = {}
    const sigParts: string[] = []
    for (const id of layout.placed) {
      const p = layout.positions.get(id)
      if (!p) continue
      if (displaced.has(id)) set[id] = p
      else {
        add[id] = p
        cats[id] = byId.get(id)?.categoryId ?? null
      }
      sigParts.push(`${id}:${p.x},${p.y}`)
    }
    const sig = sigParts.join(';')
    if (sig === '' || failed.current === sig) return
    // Тот же набор уже записан, а снимок положений ещё не обновился — второй раз не пишем.
    if (done.current && done.current.sig === sig && done.current.fixed === fixed) return

    writing.current = true
    void (async () => {
      try {
        if (Object.keys(add).length > 0) await addPositions(add, cats)
        if (Object.keys(set).length > 0) await setPositions(set)
        done.current = { sig, fixed }
      } catch (e) {
        failed.current = sig
        toast.error(describeError(e))
      } finally {
        writing.current = false
        // Пока шла запись, раскладка могла выдать новые места: проверить ещё раз.
        setTick((n) => n + 1)
      }
    })()
  }, [layout, fixed, all, tick])
}

export function GraphView() {
  const all = useItemsWithTrash()
  const live = useAllItems()
  const fixed = usePositions()
  const categoryList = useCategoryList()
  const categories = categoryList ?? NO_CATEGORIES
  const query = useUi((s) => s.query)
  const filter = useUi((s) => s.filter)
  const selectedId = useUi((s) => s.selectedId)
  const openCapture = useUi((s) => s.openCapture)
  const showArchive = useGraph((s) => s.showArchive)
  const setShowArchive = useGraph((s) => s.setShowArchive)
  const dayKey = useDayKey()

  const loaded = all !== undefined && fixed !== undefined && categoryList !== undefined
  const graphItems = live ?? NO_ITEMS

  const layout = useLayout(all, fixed, categoryList)
  useSaveLayout(layout, fixed, all)

  // ── незаписанные броски ──
  const [pendingMoves, setPendingMoves] = useState<ReadonlyMap<string, GraphPoint>>(NO_MOVES)
  const dropPending = (id: string, point?: GraphPoint) =>
    setPendingMoves((prev) => {
      if (!prev.has(id) || (point && !samePoint(prev.get(id), point))) return prev
      const next = new Map(prev)
      next.delete(id)
      return next
    })
  useEffect(() => {
    if (pendingMoves.size === 0) return
    const f = fixed ?? NO_POSITIONS
    const confirmed = [...pendingMoves].filter(([id, p]) => samePoint(f[id], p))
    if (confirmed.length === 0) return
    setPendingMoves((prev) => {
      const next = new Map(prev)
      for (const [id, p] of confirmed) if (samePoint(next.get(id), p)) next.delete(id)
      return next
    })
  }, [fixed, pendingMoves])

  const onMoved = (id: string, point: GraphPoint) => {
    setPendingMoves((prev) => new Map(prev).set(id, point))
    window.setTimeout(() => dropPending(id, point), PENDING_MOVE_MS)
    void actMoveNode(id, point)
  }

  const positions = useMemo(() => {
    if (pendingMoves.size === 0) return layout.positions
    const m = new Map(layout.positions)
    for (const [id, p] of pendingMoves) if (m.has(id)) m.set(id, p)
    return m
  }, [layout, pendingMoves])

  // ── отбор и сцена ──
  const match = useMemo(() => {
    void dayKey // относительные даты запроса считаются от «сейчас»
    if (!all) return { active: false, ids: null }
    return computeGraphMatch(all, graphItems, categories, query, filter)
  }, [all, graphItems, categories, query, filter, dayKey])

  const scene: GraphScene = useMemo(
    () => buildGraphScene({ items: graphItems, positions, categories, match: match.ids, showArchive }),
    [graphItems, positions, categories, match.ids, showArchive],
  )

  const itemsById = useMemo(() => new Map(graphItems.map((it) => [it.id, it])), [graphItems])

  // ── общие ссылки для жестов и клавиш ──
  // Сцена появляется и пропадает вместе с пустыми состояниями: жестам нужен сам элемент, а не только ссылка.
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null)
  const setStage = useCallback((el: HTMLDivElement | null) => {
    stageRef.current = el
    setStageEl(el)
  }, [])
  const [graphLive] = useState(createGraphLive)
  const sceneRef = useRef(scene)
  const takenRef = useRef<ReadonlyMap<string, GraphPoint>>(positions)
  const itemsRef = useRef<ReadonlyMap<string, Item>>(itemsById)
  useEffect(() => {
    sceneRef.current = scene
    takenRef.current = positions
    itemsRef.current = itemsById
  }, [scene, positions, itemsById])

  useGraphGestures({ stage: stageEl, live: graphLive, sceneRef, takenRef, onMoved })
  useAmbient(loaded ? stageEl : null)
  useGraphKeys({ stageRef, live: graphLive, sceneRef, itemsRef })

  // ── эффекты ──
  const viewW = useGraph((s) => s.viewSize.width)
  const viewH = useGraph((s) => s.viewSize.height)

  useEffect(() => {
    useGraph.getState().setBounds(scene.bounds)
  }, [scene.bounds])

  useEffect(() => {
    if (fittedOnce || scene.nodes.length === 0 || !(viewW > 0) || !(viewH > 0)) return
    fittedOnce = true
    const g = useGraph.getState()
    if (!g.cameraRestored) g.fitAll()
  }, [scene.nodes.length, viewW, viewH])

  // Выбранная нода показывается: камера сдвигается, если нода вне экрана. Повод — новый выбор (палитра, связанные
  // записи), переезд ноды (смена категории) и сужение сцены панелью деталей, но не смена размера после того, как
  // пользователь сам сдвинул вид (строка фильтров, ресайз окна не возвращают камеру к ноде) — revealDecision.
  // Переезд идёт с запасом 0: брошенная у края нода вид не двигает, а ушедшая за край — да.
  const revealMemo = useRef<RevealMemo | null>(null)
  useEffect(() => {
    if (selectedId === null) {
      revealMemo.current = null
      return
    }
    const i = scene.byId.get(selectedId)
    if (i === undefined || !(viewW > 0) || !(viewH > 0)) return
    const g = useGraph.getState()
    const node = scene.nodes[i]
    const cur: RevealMemo = { id: selectedId, x: node.x, y: node.y, width: viewW, height: viewH, cameraRev: g.cameraRev }
    const d = revealDecision(revealMemo.current, cur)
    if (!d.reveal) {
      revealMemo.current = d.memo
      return
    }
    const cam = ensureVisible(
      { width: viewW, height: viewH, dpr: 1, camera: g.camera },
      { x: node.x, y: node.y },
      d.moved ? 0 : undefined,
    )
    if (cam) g.setCamera(cam)
    revealMemo.current = { ...d.memo, cameraRev: useGraph.getState().cameraRev }
  }, [selectedId, scene, viewW, viewH])

  // Запись открыли извне (палитра, связанные записи, вики-ссылка, меню ноды): курсор клавиатуры следует за ней —
  // один раз на каждую смену выбора, когда нода появится в сцене (показ архива пересобирает сцену позже).
  const cursorSynced = useRef<string | null>(null)
  useEffect(() => {
    if (selectedId === null) {
      cursorSynced.current = null
      return
    }
    if (cursorSynced.current === selectedId || !scene.byId.has(selectedId)) return
    cursorSynced.current = selectedId
    const g = useGraph.getState()
    if (g.cursorId !== selectedId) g.setCursor(selectedId)
  }, [selectedId, scene])

  // Выбранная запись ушла в корзину — панель деталей закрывается.
  useEffect(() => {
    if (!all || selectedId === null) return
    const item = all.find((it) => it.id === selectedId)
    if (item?.deletedAt !== undefined) useUi.getState().select(null)
  }, [all, selectedId])

  // Курсор, наведение и режим связи у ноды, которой больше нет в сцене, сбрасываются.
  useEffect(() => {
    const g = useGraph.getState()
    if (g.cursorId !== null && !scene.byId.has(g.cursorId)) g.setCursor(null)
    if (g.hoveredId !== null && !scene.byId.has(g.hoveredId)) g.setHovered(null)
    if (g.linkFrom !== null && !scene.byId.has(g.linkFrom)) g.setLinkFrom(null)
    if (g.pickerFor !== null && !scene.byId.has(g.pickerFor)) g.openPicker(null)
  }, [scene])

  useEffect(() => () => useGraph.getState().resetTransient(), [])

  // ── разметка ──
  const empty = loaded && graphItems.length === 0
  const allArchivedHidden =
    loaded && !empty && !showArchive && graphItems.every((it) => it.status === 'archive')

  let body
  if (empty) {
    body = (
      <EmptyState
        icon="graph"
        title="Граф пуст"
        description="Добавьте записи — они появятся здесь квадратами цвета своей категории."
        action={
          <Button variant="outline" size="sm" onClick={() => openCapture()}>
            Добавить запись
          </Button>
        }
      />
    )
  } else if (allArchivedHidden) {
    body = (
      <EmptyState
        icon="graph"
        title="Все записи в архиве"
        description="Архив на графе скрыт. Покажите его, чтобы увидеть записи."
        action={
          <Button variant="outline" size="sm" onClick={() => setShowArchive(true)}>
            Показать архив
          </Button>
        }
      />
    )
  } else {
    body = (
      <div className="relative flex min-h-60 flex-1 flex-col">
        <div
          ref={setStage}
          data-graph-stage
          tabIndex={0}
          role="application"
          aria-label="Граф записей"
          aria-describedby="graph-a11y-help"
          aria-busy={!loaded || undefined}
          className="relative min-h-0 flex-1 touch-none overflow-hidden rounded-lg border border-border bg-background outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset data-[cursor=crosshair]:cursor-crosshair data-[cursor=grab]:cursor-grab data-[cursor=grabbing]:cursor-grabbing data-[cursor=pointer]:cursor-pointer px-graph-stage"
        >
          <GraphCanvas scene={scene} stageRef={stageRef} live={graphLive} />
          <GraphOverlay scene={scene} items={itemsById} categories={categories} />
        </div>
        {/* Панель графа и подсказка — вне role="application": в режиме приложения диктор не дал бы прочитать их
            обычным образом. Слой повторяет внутренний край рамки сцены, поэтому их места прежние. */}
        <div className="pointer-events-none absolute inset-px pixel:inset-0.5 *:pointer-events-auto">
          {scene.nodes.length > 0 && <GraphToolbar />}
          <GraphHint />
        </div>
      </div>
    )
  }

  return (
    <section
      aria-label="Граф"
      className="flex h-full min-h-0 flex-col gap-3 px-4 pt-4 pb-4 md:px-6 pixel:gap-2.5 pixel:p-2.5"
    >
      <GraphHeader total={scene.nodes.length} matched={scene.matched} links={scene.links.length} filtered={match.active} />
      <FilterBar mode="graph" />
      {body}
    </section>
  )
}
