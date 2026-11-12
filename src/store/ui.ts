import { create } from 'zustand'
import type { ItemFilter, ItemType, SortMode } from '@/types'

/** Разделы приложения. */
export type View = 'inbox' | 'library' | 'favorites' | 'archive' | 'graph' | 'trash' | 'settings'

/** Фильтры интерфейса: статус, избранное и корзину задаёт раздел. */
export type UiFilter = Omit<ItemFilter, 'status' | 'favorite' | 'trashed'>

/** Чем предзаполнить панель быстрого добавления. */
export interface CaptureDraft {
  text?: string
  type?: ItemType
  files?: File[]
}

interface UiState {
  view: View
  /** Открытая в панели подробностей запись. */
  selectedId: string | null
  /** Строка поиска (общая для всех разделов). */
  query: string
  /** Фильтры текущего раздела (статус задаёт сам раздел, здесь — остальное). */
  filter: UiFilter
  sort: SortMode
  layout: 'list' | 'grid'

  captureOpen: boolean
  captureDraft: CaptureDraft | null
  paletteOpen: boolean
  /** Мобильное боковое меню. */
  navOpen: boolean

  setView: (view: View) => void
  select: (id: string | null) => void
  setQuery: (query: string) => void
  setFilter: (patch: Partial<UiFilter>) => void
  resetFilter: () => void
  /** Применить запрос целиком (сохранённый поиск): строка поиска заменяется, фильтры и выбор сбрасываются. */
  applyQuery: (query: string, view?: View) => void
  setSort: (sort: SortMode) => void
  setLayout: (layout: 'list' | 'grid') => void
  openCapture: (draft?: CaptureDraft) => void
  closeCapture: () => void
  setPaletteOpen: (open: boolean) => void
  setNavOpen: (open: boolean) => void
}

export const useUi = create<UiState>((set) => ({
  view: 'inbox',
  selectedId: null,
  query: '',
  filter: {},
  sort: 'newest',
  layout: 'list',
  captureOpen: false,
  captureDraft: null,
  paletteOpen: false,
  navOpen: false,

  // Смена раздела сбрасывает выбор и фильтры, но не поиск.
  setView: (view) => set({ view, selectedId: null, filter: {}, navOpen: false }),
  select: (selectedId) => set({ selectedId }),
  setQuery: (query) => set({ query }),
  setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
  resetFilter: () => set({ filter: {} }),
  applyQuery: (query, view) =>
    set((s) => ({ query, filter: {}, selectedId: null, navOpen: false, view: view ?? s.view })),
  setSort: (sort) => set({ sort }),
  setLayout: (layout) => set({ layout }),
  openCapture: (draft) => set({ captureOpen: true, captureDraft: draft ?? null }),
  closeCapture: () => set({ captureOpen: false, captureDraft: null }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setNavOpen: (navOpen) => set({ navOpen }),
}))
