import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from 'react'
import { FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useCategories } from '@/hooks/useItems'
import { actArchive, actDelete, actToLibrary, actUnarchive } from '@/lib/actions'
import { setFavorite } from '@/db/repo'
import { getAllItemsSnapshot } from '@/hooks/useItems'
import { describeError } from '@/lib/errors'
import { matchKey } from '@/lib/keys'
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
  '[role="dialog"][data-open]:not([data-ending-style]), [role="alertdialog"][data-open]:not([data-ending-style]), [role="menu"][data-open]:not([data-ending-style]), [role="listbox"][data-open]:not([data-ending-style]), [data-slot="popover-content"][data-open]:not([data-ending-style])'

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
const MUTATING_KEYS = ['KeyE', 'KeyA', 'KeyF', 'Delete', 'Backspace']
const MUTATING_FALLBACK = ['e', 'a', 'f', 'Delete', 'Backspace']
const isMutating = (e: KeyboardEvent) => MUTATING_KEYS.some((c, i) => matchKey(e, c, MUTATING_FALLBACK[i]))

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
  const layoutRef = useRef(layoutMode)
  layoutRef.current = layoutMode

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
        // Открытая запись выпала из выдачи при правке, но остаётся открытой: курсор не уходит на соседа,
        // иначе клавиши (Del) подействуют на него, а не на запись в деталях.
        const keepOpen =
          ui.selectedId === sel.cursorId &&
          (() => {
            const open = getAllItemsSnapshot()?.find((i) => i.id === ui.selectedId)
            return !!open && inSection(open, variant)
          })()
        if (keepOpen) sel.setCursor(null)
        else {
          const next = successor(sel.cursorId)
          if (next !== undefined) sel.setCursor(next)
        }
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

  // Запись открыли извне (Ctrl+K, связанная запись, «Открыть» в toast): курсор следует за ней.
  useEffect(() => {
    if (selectedId && ids.includes(selectedId) && useSelection.getState().cursorId !== selectedId) {
      useSelection.getState().setCursor(selectedId)
    }
  }, [selectedId, ids])

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

    /** Запись, на которую действуют клавиши: курсор, иначе открытая в деталях (даже если выпала из выдачи). */
    function activeItem(): Item | undefined {
      const { hits: list, variant: v } = latest.current
      const id = activeId()
      const hit = id ? list.find((h) => h.item.id === id) : undefined
      if (hit) return hit.item
      const open = useUi.getState().selectedId
      if (!open) return undefined
      const found = getAllItemsSnapshot()?.find((i) => i.id === open)
      return found && inSection(found, v) ? found : undefined
    }

    /** Модальный лист деталей: список под ним недоступен, отмеченные записи не трогаем. */
    const sheetOpen = () => !!document.querySelector('[data-detail-sheet]')

    function targets(): Item[] {
      const { hits: list } = latest.current
      const checked = useSelection.getState().ids
      if (checked.size > 0 && !sheetOpen()) return list.filter((h) => checked.has(h.item.id)).map((h) => h.item)
      const item = activeItem()
      return item ? [item] : []
    }

    /** Число колонок сетки — по DOM: сколько карточек лежит в первом ряду. */
    function gridCols(): number {
      const els = rootRef.current?.querySelectorAll<HTMLElement>('[data-item-id]')
      if (!els || els.length < 2) return 1
      const top = els[0].offsetTop
      let n = 0
      for (const el of els) {
        if (el.offsetTop !== top) break
        n++
      }
      return Math.max(1, n)
    }

    function move(delta: number) {
      const { ids: list } = latest.current
      if (list.length === 0) return
      // Курсора ещё нет: первое нажатие ставит его на открытую запись или на первую строку.
      const cur = useSelection.getState().cursorId
      const from = cur ? list.indexOf(cur) : -1
      let to: number
      if (from < 0) {
        const open = useUi.getState().selectedId
        const openIdx = open ? list.indexOf(open) : -1
        to = openIdx >= 0 ? openIdx : 0
      } else to = Math.min(list.length - 1, Math.max(0, from + delta))
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
      // Панель добавления/палитра уже открыты, но их диалог ещё не в DOM (ленивый чанк).
      const ui = useUi.getState()
      if (ui.captureOpen || ui.paletteOpen || ui.navOpen) return
      const { ids: list } = latest.current
      const mod = e.ctrlKey || e.metaKey

      if (mod && !e.altKey && !e.shiftKey && matchKey(e, 'KeyA', 'a')) {
        // В модальном листе деталей Ctrl+A — выделение текста, а не «выбрать все» под затемнением.
        if (list.length === 0 || sheetOpen()) return
        e.preventDefault()
        useSelection.getState().replace(list)
        return
      }
      if (mod || e.altKey) return

      if (matchKey(e, 'Escape', 'Escape')) {
        // Если Esc закрыл детали, useHotkeys уже вызвал preventDefault и сюда не дошло; отметки живут.
        if (!sheetOpen()) useSelection.getState().clear()
        return
      }
      if (list.length === 0) return
      if (e.repeat && isMutating(e)) return

      const handled = () => e.preventDefault()
      const grid = layoutRef.current === 'grid'
      const cols = grid ? gridCols() : 1
      const KEYS: [string, string][] = [
        ['KeyJ', 'j'], ['KeyK', 'k'], ['KeyO', 'o'], ['KeyE', 'e'], ['KeyA', 'a'], ['KeyF', 'f'], ['KeyX', 'x'],
        ['Enter', 'Enter'], ['NumpadEnter', 'Enter'], ['ArrowDown', 'ArrowDown'], ['ArrowUp', 'ArrowUp'],
        ['ArrowLeft', 'ArrowLeft'], ['ArrowRight', 'ArrowRight'], ['Delete', 'Delete'], ['Backspace', 'Backspace'],
      ]
      // Физический код; при пустом e.code — по e.key (matchKey).
      const code = KEYS.find(([c, k]) => matchKey(e, c, k))?.[0] ?? ''
      switch (code) {
        case 'KeyJ':
          handled()
          move(1)
          break
        case 'ArrowDown':
          handled()
          move(cols)
          break
        case 'KeyK':
          handled()
          move(-1)
          break
        case 'ArrowUp':
          handled()
          move(-cols)
          break
        case 'ArrowRight':
        case 'ArrowLeft':
          if (!grid) return
          handled()
          move(code === 'ArrowRight' ? 1 : -1)
          break
        case 'Enter':
        case 'NumpadEnter':
        case 'KeyO': {
          // На кнопке Enter — это её нажатие, а не «открыть».
          if (code !== 'KeyO' && e.target instanceof HTMLElement && e.target.closest('button, a, [role="menuitem"], [role="checkbox"]'))
            return
          // Единый источник истины — курсор из store (фокус строки его синхронизирует).
          const id = activeId()
          if (!id) return
          handled()
          useSelection.getState().setCursor(id)
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
          ).catch((err: unknown) => toast.error(describeError(err)))
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

  // Фокус на строке (Tab, клик, возврат из панели деталей) переносит на неё курсор.
  const onRowFocus = useCallback((e: FocusEvent<HTMLDivElement>) => {
    const t = e.target
    if (!(t instanceof HTMLElement) || !t.hasAttribute('data-item-id')) return
    const id = t.dataset.itemId
    if (id && useSelection.getState().cursorId !== id) useSelection.setState({ cursorId: id })
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
      <div ref={rootRef} onPointerDown={() => setKbd(false)} onFocus={onRowFocus}>
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
                  cursor={cursorId === en.hit.item.id}
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
