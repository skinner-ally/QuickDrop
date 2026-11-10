import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useCategories } from '@/hooks/useItems'
import { actArchive, actDelete, actToLibrary, actUnarchive } from '@/lib/actions'
import { setFavorite } from '@/db/repo'
import { getAllItemsSnapshot } from '@/hooks/useItems'
import { useSelection } from '@/store/selection'
import { useUi } from '@/store/ui'
import type { SearchHit } from '@/search'
import type { Item } from '@/types'
import { BulkBar } from './BulkBar'
import { EmptyState } from './EmptyState'
import { CategoriesContext } from './CategoryBadge'
import { ItemCard, ItemRow, type ItemVariant } from './ItemCard'

/** Сколько записей рендерится за раз; остальные подгружаются при прокрутке. */
const PAGE = 60

// Открытые окна/меню/выпадающие списки: клавиши списка в это время не работают.
const OPEN_OVERLAY =
  '[role="dialog"][data-open], [role="alertdialog"][data-open], [role="menu"][data-open], [role="listbox"][data-open], [data-slot="popover-content"][data-open]'

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  const role = el.getAttribute('role')
  // Кнопка-combobox (CategorySelect) вводом не является: после закрытия списка фокус остаётся на ней.
  if (role === 'combobox') return tag !== 'BUTTON'
  return role === 'textbox' || role === 'searchbox'
}

/** Относится ли запись к разделу независимо от поиска и фильтров (статус/избранное). */
function inSection(item: Item, variant: ItemVariant): boolean {
  switch (variant) {
    case 'inbox':
      return item.status === 'inbox'
    case 'library':
      return item.status === 'library'
    case 'archive':
      return item.status === 'archive'
    case 'favorites':
      return item.favorite === 1 && item.status !== 'archive'
  }
}

/** Действия, меняющие данные, не повторяем при удержании клавиши. */
const MUTATING_KEYS = new Set(['KeyE', 'KeyA', 'KeyF', 'Delete', 'Backspace'])

// ───────────────────────── группировка по дате ─────────────────────────

const GROUP_LABELS = ['Сегодня', 'Вчера', 'На этой неделе', 'Ранее'] as const

function dateGroup(ts: number, now: number): number {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const t0 = today.getTime()
  if (ts >= t0) return 0
  if (ts >= t0 - 86_400_000) return 1
  const weekStart = new Date(t0)
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7)) // понедельник
  if (ts >= weekStart.getTime()) return 2
  return 3
}

type ListEntry = { kind: 'header'; label: string } | { kind: 'hit'; hit: SearchHit }

// ───────────────────────── список ─────────────────────────

export function ItemList({
  hits,
  variant,
  layout,
  emptyState,
}: {
  hits: SearchHit[]
  variant: ItemVariant
  layout?: 'list' | 'grid'
  emptyState?: ReactNode
}) {
  const categories = useCategories()
  const uiLayout = useUi((s) => s.layout)
  const selectedId = useUi((s) => s.selectedId)
  const query = useUi((s) => s.query)
  const sort = useUi((s) => s.sort)
  const filter = useUi((s) => s.filter)
  const checkedIds = useSelection((s) => s.ids)
  const cursorId = useSelection((s) => s.cursorId)
  const layoutMode = layout ?? uiLayout

  const [shown, setShown] = useState(PAGE)
  const [kbd, setKbd] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const ids = useMemo(() => hits.map((h) => h.item.id), [hits])
  const latest = useRef({ ids, hits, variant })
  latest.current = { ids, hits, variant }

  // Новый раздел/запрос/сортировка — снова с первой порции.
  useEffect(() => setShown(PAGE), [variant, query, sort, filter, layoutMode])

  // ── выбор и курсор: убираем исчезнувшие записи, курсор и панель деталей переходят на соседнюю ──
  const prevIds = useRef<string[]>([])
  const prevViewKey = useRef('')
  const filterKey = JSON.stringify(filter)
  useEffect(() => {
    const prev = prevIds.current
    prevIds.current = ids
    const viewKey = `${variant}|${query}|${sort}|${filterKey}`
    const sameView = prevViewKey.current === viewKey
    prevViewKey.current = viewKey

    const valid = new Set(ids)
    const sel = useSelection.getState()
    const ui = useUi.getState()

    // undefined — записи не было в прежнем списке; null — переходить некуда (список опустел).
    const successor = (gone: string): string | null | undefined => {
      const i = prev.indexOf(gone)
      if (i < 0) return undefined
      for (let j = i + 1; j < prev.length; j++) if (valid.has(prev[j])) return prev[j]
      for (let j = i - 1; j >= 0; j--) if (valid.has(prev[j])) return prev[j]
      return null
    }

    if (sameView) {
      if (sel.cursorId && !valid.has(sel.cursorId)) {
        const next = successor(sel.cursorId)
        if (next !== undefined) sel.setCursor(next)
      }
      if (ui.selectedId && !valid.has(ui.selectedId)) {
        // Запись, выпавшая из выдачи из-за поиска/фильтра (а не из-за смены статуса или удаления),
        // остаётся открытой: иначе панель деталей уходит на соседа прямо во время правки.
        const open = getAllItemsSnapshot()?.find((i) => i.id === ui.selectedId)
        if (!open || !inSection(open, variant)) {
          const next = successor(ui.selectedId)
          if (next !== undefined) ui.select(next)
        }
      }
    }
    useSelection.getState().prune(valid)
  }, [ids, variant, query, sort, filterKey])

  // При уходе со страницы выбор не должен «протекать» в другой раздел.
  useEffect(
    () => () => {
      const sel = useSelection.getState()
      sel.replace([])
      sel.setCursor(null)
    },
    [],
  )

  // ── клавиатура ──
  useEffect(() => {
    function activeId(): string | null {
      const { ids: list } = latest.current
      const sel = useSelection.getState()
      if (sel.cursorId && list.includes(sel.cursorId)) return sel.cursorId
      const open = useUi.getState().selectedId
      return open && list.includes(open) ? open : null
    }

    function targets(): Item[] {
      const { hits: list } = latest.current
      const checked = useSelection.getState().ids
      if (checked.size > 0) return list.filter((h) => checked.has(h.item.id)).map((h) => h.item)
      const id = activeId()
      const hit = id ? list.find((h) => h.item.id === id) : undefined
      return hit ? [hit.item] : []
    }

    function move(delta: number) {
      const { ids: list } = latest.current
      if (list.length === 0) return
      const cur = activeId()
      const from = cur ? list.indexOf(cur) : -1
      const to = from < 0 ? 0 : Math.min(list.length - 1, Math.max(0, from + delta))
      const id = list[to]
      useSelection.getState().setCursor(id)
      // Если панель деталей уже открыта, она следует за курсором — так удобно разбирать поток.
      if (useUi.getState().selectedId) useUi.getState().select(id)
      setKbd(true)
      setShown((c) => Math.max(c, to + 1 + PAGE / 2))
    }

    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing) return
      if (isTyping(e.target)) return
      if (document.querySelector(OPEN_OVERLAY)) return
      const { ids: list } = latest.current
      const mod = e.ctrlKey || e.metaKey

      if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyA') {
        if (list.length === 0) return
        e.preventDefault()
        useSelection.getState().replace(list)
        return
      }
      if (mod || e.altKey) return

      if (e.code === 'Escape') {
        useSelection.getState().clear()
        return
      }
      if (list.length === 0) return
      if (e.repeat && MUTATING_KEYS.has(e.code)) return

      const handled = () => e.preventDefault()
      switch (e.code) {
        case 'KeyJ':
        case 'ArrowDown':
          handled()
          move(1)
          break
        case 'KeyK':
        case 'ArrowUp':
          handled()
          move(-1)
          break
        case 'Enter':
        case 'NumpadEnter':
        case 'KeyO': {
          // На кнопке Enter — это её нажатие, а не «открыть».
          if (e.code !== 'KeyO' && e.target instanceof HTMLElement && e.target.closest('button, a, [role="menuitem"], [role="checkbox"]'))
            return
          // Сфокусированная Tab-ом строка открывается даже без курсора.
          const focusedRow =
            e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('[data-item-id]')?.dataset.itemId : undefined
          const id = focusedRow && list.includes(focusedRow) ? focusedRow : activeId()
          if (!id) return
          handled()
          useUi.getState().select(id)
          break
        }
        case 'KeyE': {
          const items = targets()
          if (items.length === 0) return
          handled()
          const restore = items.filter((i) => i.status === 'archive').map((i) => i.id)
          const toLibrary = items.filter((i) => i.status === 'inbox').map((i) => i.id)
          if (restore.length) void actUnarchive(restore)
          if (toLibrary.length) void actToLibrary(toLibrary)
          break
        }
        case 'KeyA': {
          const items = targets()
          if (items.length === 0) return
          handled()
          const toArchive = items.filter((i) => i.status !== 'archive').map((i) => i.id)
          const restore = items.filter((i) => i.status === 'archive').map((i) => i.id)
          if (toArchive.length) void actArchive(toArchive)
          if (restore.length) void actUnarchive(restore)
          break
        }
        case 'KeyF': {
          const items = targets()
          if (items.length === 0) return
          handled()
          // Единое состояние: если все уже в избранном — снимаем, иначе отмечаем всем.
          const value = !items.every((i) => i.favorite === 1)
          setFavorite(
            items.map((i) => i.id),
            value,
          ).catch((err: unknown) => toast.error(err instanceof Error && err.message ? err.message : 'Что-то пошло не так'))
          break
        }
        case 'KeyX': {
          const id = activeId()
          if (!id) return
          handled()
          useSelection.getState().toggle(id)
          break
        }
        case 'Delete':
        case 'Backspace': {
          const items = targets()
          if (items.length === 0) return
          handled()
          void actDelete(items.map((i) => i.id))
          break
        }
        default:
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Курсорная строка всегда в зоне видимости.
  useEffect(() => {
    if (!kbd || !cursorId) return
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(cursorId)}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'nearest' })
    el.focus({ preventScroll: true })
  }, [kbd, cursorId])

  // Дозагрузка порциями при прокрутке.
  const hasMore = shown < hits.length
  useEffect(() => {
    const el = sentinelRef.current
    if (!hasMore || !el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting)) setShown((c) => c + PAGE)
      },
      { rootMargin: '600px 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, shown])

  const onActivate = useCallback((id: string, e: MouseEvent) => {
    const sel = useSelection.getState()
    if (e.shiftKey) {
      window.getSelection()?.removeAllRanges()
      sel.selectRange(latest.current.ids, id)
      return
    }
    if (e.ctrlKey || e.metaKey) {
      sel.toggle(id)
      return
    }
    useSelection.setState({ cursorId: id, anchorId: id })
    useUi.getState().select(id)
  }, [])

  const onToggle = useCallback((id: string, e: MouseEvent) => {
    const sel = useSelection.getState()
    if (e.shiftKey) {
      window.getSelection()?.removeAllRanges()
      sel.selectRange(latest.current.ids, id)
    } else sel.toggle(id)
  }, [])

  const grouped = layoutMode === 'list' && (sort === 'newest' || sort === 'oldest') && query.trim() === ''
  const entries = useMemo<ListEntry[]>(() => {
    const out: ListEntry[] = []
    const now = Date.now()
    let last = -1
    for (const hit of hits.slice(0, shown)) {
      if (grouped) {
        const g = dateGroup(hit.item.createdAt, now)
        if (g !== last) {
          out.push({ kind: 'header', label: GROUP_LABELS[g] })
          last = g
        }
      }
      out.push({ kind: 'hit', hit })
    }
    return out
  }, [hits, shown, grouped])

  if (hits.length === 0) {
    return <>{emptyState ?? <EmptyState icon={FolderOpen} title="Здесь пока пусто" />}</>
  }

  const tabbableId = cursorId && ids.includes(cursorId) ? cursorId : ids[0]
  const selecting = checkedIds.size > 0
  const EntryView = layoutMode === 'grid' ? ItemCard : ItemRow

  return (
    <TooltipProvider delay={400}>
     <CategoriesContext.Provider value={categories}>
      <div ref={rootRef} onPointerDown={() => setKbd(false)}>
        <div
          role="list"
          aria-label="Записи"
          className={
            layoutMode === 'grid'
              ? 'grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(240px,1fr))]'
              : 'flex flex-col gap-px'
          }
        >
          {entries.map((en) =>
            en.kind === 'header' ? (
              <div
                key={`h-${en.label}`}
                role="presentation"
                className="sticky top-0 z-10 bg-background px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground"
              >
                {en.label}
              </div>
            ) : (
              <EntryView
                  key={en.hit.item.id}
                  hit={en.hit}
                  variant={variant}
                  open={selectedId === en.hit.item.id}
                  checked={checkedIds.has(en.hit.item.id)}
                  cursor={kbd && cursorId === en.hit.item.id}
                  selecting={selecting}
                  tabbable={tabbableId === en.hit.item.id}
                  onActivate={onActivate}
                  onToggle={onToggle}
                />
            ),
          )}
        </div>
        {hasMore && <div ref={sentinelRef} className="h-px" aria-hidden />}
        <BulkBar variant={variant} />
      </div>
     </CategoriesContext.Provider>
    </TooltipProvider>
  )
}
