import { create } from 'zustand'

/**
 * Множественный выбор (чекбоксы) и «курсор» клавиатурной навигации в списке.
 * Не путать с useUi.selectedId — это запись, открытая в панели деталей.
 */
interface SelectionState {
  ids: ReadonlySet<string>
  /** Строка, на которой стоит клавиатурный курсор. */
  cursorId: string | null
  /** Опорная строка для выбора диапазона по Shift. */
  anchorId: string | null

  setCursor: (id: string | null) => void
  toggle: (id: string) => void
  /** Добавляет в выбор диапазон от опорной строки до toId (по порядку orderedIds). */
  selectRange: (orderedIds: readonly string[], toId: string) => void
  replace: (ids: Iterable<string>) => void
  /** Оставляет в выборе только существующие записи; ничего не меняет, если убирать нечего. */
  prune: (valid: ReadonlySet<string>) => void
  clear: () => void
}

const EMPTY: ReadonlySet<string> = new Set()

export const useSelection = create<SelectionState>((set) => ({
  ids: EMPTY,
  cursorId: null,
  anchorId: null,

  setCursor: (cursorId) => set({ cursorId }),

  toggle: (id) =>
    set((s) => {
      const next = new Set(s.ids)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { ids: next, anchorId: id, cursorId: id }
    }),

  selectRange: (orderedIds, toId) =>
    set((s) => {
      const to = orderedIds.indexOf(toId)
      if (to < 0) return s
      const fromRaw = s.anchorId ?? s.cursorId
      const from = fromRaw ? orderedIds.indexOf(fromRaw) : -1
      const start = from < 0 ? to : Math.min(from, to)
      const end = from < 0 ? to : Math.max(from, to)
      const next = new Set(s.ids)
      for (let i = start; i <= end; i++) next.add(orderedIds[i])
      return { ids: next, cursorId: toId, anchorId: s.anchorId ?? toId }
    }),

  replace: (ids) => set({ ids: new Set(ids) }),

  prune: (valid) =>
    set((s) => {
      let changed = false
      const next = new Set<string>()
      for (const id of s.ids) {
        if (valid.has(id)) next.add(id)
        else changed = true
      }
      const cursorGone = s.cursorId !== null && !valid.has(s.cursorId)
      const anchorGone = s.anchorId !== null && !valid.has(s.anchorId)
      if (!changed && !cursorGone && !anchorGone) return s
      return {
        ids: changed ? next : s.ids,
        cursorId: cursorGone ? null : s.cursorId,
        anchorId: anchorGone ? null : s.anchorId,
      }
    }),

  clear: () => set((s) => (s.ids.size === 0 ? s : { ids: EMPTY, anchorId: null })),
}))
