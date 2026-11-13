import { create } from 'zustand'
import { presetOf, relativeRange } from '@/lib/dates'
import type { ItemFilter, ItemSource, ItemType, SortMode } from '@/types'

/** Разделы приложения. */
export type View = 'inbox' | 'library' | 'favorites' | 'archive' | 'graph' | 'trash' | 'settings'

/** Разделы без списка записей: заход туда применённый поиск не снимает, он нужен по возвращении. */
const NO_LIST_VIEWS: ReadonlySet<View> = new Set<View>(['settings', 'graph'])

/** Фильтры интерфейса: статус, избранное и корзину задаёт раздел. */
export type UiFilter = Omit<ItemFilter, 'status' | 'favorite' | 'trashed'>

/** Чем предзаполнить панель быстрого добавления. */
export interface CaptureDraft {
  text?: string
  type?: ItemType
  files?: File[]
  /** Откуда пришёл черновик; без него панель считает текст вставкой из буфера. */
  source?: ItemSource
}

/** Ключ localStorage для режима «Просмотр / Исходник». */
export const MD_PREVIEW_KEY = 'qd-md-preview'

/** Режим показа Markdown, запомненный в браузере; без localStorage (или при его сбое) — «Просмотр». */
function readMdPreview(): boolean {
  try {
    return globalThis.localStorage?.getItem(MD_PREVIEW_KEY) !== '0'
  } catch {
    return true
  }
}

function writeMdPreview(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(MD_PREVIEW_KEY, on ? '1' : '0')
  } catch {
    // приватный режим или запрет хранилища: режим действует до перезагрузки
  }
}

/** Фильтр без границ дат; остальные поля — как были. */
function withoutDates(filter: UiFilter): UiFilter {
  const next = { ...filter }
  delete next.from
  delete next.to
  return next
}

interface UiState {
  view: View
  /** Раздел, из которого открыли «Настройки»: повторное нажатие на кнопку возвращает туда. */
  settingsFrom: Exclude<View, 'settings'>
  /** Открытая в панели подробностей запись. */
  selectedId: string | null
  /** Строка поиска (общая для всех разделов). */
  query: string
  /**
   * Запрос, поставленный applyQuery (сохранённый поиск), пока пользователь его не менял; его раздел — в самом
   * запросе (is:…). null — строку набрали или изменили вручную.
   */
  appliedQuery: string | null
  /** Раздел, в котором применён appliedQuery. */
  appliedView: View | null
  /** Фильтры текущего раздела (статус задаёт сам раздел, здесь — остальное). */
  filter: UiFilter
  /** Период дат задан полями «свой период», а не быстрой кнопкой. */
  customDates: boolean
  sort: SortMode
  layout: 'list' | 'grid'
  /** Текст с разметкой показывается отрисованным (true) или исходником (false). */
  mdPreview: boolean

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
  /** null — снять период. custom по умолчанию false. */
  setDateRange: (range: { from?: number; to?: number } | null, custom?: boolean) => void
  /**
   * Быстрый период («Сегодня», «За неделю», «За месяц»), выбранный в сутки prevNow, переносится на сутки now.
   * Свой период, произвольные границы и пустой фильтр не трогаются (состояние то же — подписчики не оповещаются).
   */
  rollDatePreset: (prevNow: number, now: number) => void
  /**
   * Применить запрос целиком (сохранённый поиск): строка поиска заменяется, фильтры и выбор сбрасываются.
   * Запрос запоминается как appliedQuery: смена раздела снимет его, пока его не изменили.
   * home — раздел, куда запрос можно унести без сброса (appliedView); по умолчанию — view. Нужен «Графу»:
   * поиск с is:<раздел>, применённый там, при переходе в этот раздел остаётся.
   */
  applyQuery: (query: string, view?: View, home?: View) => void
  setSort: (sort: SortMode) => void
  setLayout: (layout: 'list' | 'grid') => void
  setMdPreview: (on: boolean) => void
  openCapture: (draft?: CaptureDraft) => void
  closeCapture: () => void
  setPaletteOpen: (open: boolean) => void
  setNavOpen: (open: boolean) => void
}

export const useUi = create<UiState>((set) => ({
  view: 'inbox',
  settingsFrom: 'inbox',
  selectedId: null,
  query: '',
  appliedQuery: null,
  appliedView: null,
  filter: {},
  customDates: false,
  sort: 'newest',
  layout: 'list',
  mdPreview: readMdPreview(),
  captureOpen: false,
  captureDraft: null,
  paletteOpen: false,
  navOpen: false,

  // Смена раздела сбрасывает выбор и фильтры, но не поиск: набранный вручную поиск общий для всех разделов.
  // Исключение — нетронутый сохранённый поиск: его is:<раздел> подменил бы выдачу чужого раздела.
  setView: (view) =>
    set((s) => {
      const dropApplied =
        s.appliedQuery !== null && s.query === s.appliedQuery && view !== s.appliedView && !NO_LIST_VIEWS.has(view)
      return {
        view,
        ...(view === 'settings' && s.view !== 'settings' ? { settingsFrom: s.view } : {}),
        selectedId: null,
        filter: {},
        customDates: false,
        navOpen: false,
        ...(dropApplied ? { query: '', appliedQuery: null, appliedView: null } : {}),
      }
    }),
  select: (selectedId) => set({ selectedId }),
  // Любая правка строки делает поиск «своим»: дальше он переходит между разделами, как набранный вручную.
  setQuery: (query) =>
    set((s) =>
      s.appliedQuery !== null && query !== s.appliedQuery ? { query, appliedQuery: null, appliedView: null } : { query },
    ),
  setFilter: (patch) => set((s) => ({ filter: { ...s.filter, ...patch } })),
  resetFilter: () => set({ filter: {}, customDates: false }),
  setDateRange: (range, custom = false) =>
    set((s) => {
      const filter = withoutDates(s.filter)
      if (range === null) return { filter, customDates: false }
      if (range.from !== undefined) filter.from = range.from
      if (range.to !== undefined) filter.to = range.to
      return { filter, customDates: !!custom && (range.from !== undefined || range.to !== undefined) }
    }),
  rollDatePreset: (prevNow, now) =>
    set((s) => {
      if (s.customDates) return s
      const preset = presetOf(s.filter.from, s.filter.to, prevNow)
      if (!preset || !Number.isFinite(now)) return s
      const next = relativeRange(preset, now)
      if (next.from === s.filter.from && next.to === s.filter.to) return s
      return { filter: { ...s.filter, ...next } }
    }),
  applyQuery: (query, view, home) =>
    set((s) => {
      const target = view ?? s.view
      const applied = query.trim() !== ''
      return {
        query,
        appliedQuery: applied ? query : null,
        appliedView: applied ? (home ?? target) : null,
        filter: {},
        customDates: false,
        selectedId: null,
        navOpen: false,
        view: target,
      }
    }),
  setSort: (sort) => set({ sort }),
  setLayout: (layout) => set({ layout }),
  setMdPreview: (mdPreview) => {
    writeMdPreview(mdPreview)
    set({ mdPreview })
  },
  openCapture: (draft) => set({ captureOpen: true, captureDraft: draft ?? null }),
  closeCapture: () => set({ captureOpen: false, captureDraft: null }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setNavOpen: (navOpen) => set({ navOpen }),
}))
