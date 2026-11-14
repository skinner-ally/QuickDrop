import { useUi } from '@/store/ui'

/** Поле ввода: input, textarea, select, contenteditable. */
export function isEditableTarget(el: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

// Только реально открытые слои (Base UI ставит data-open, при закрытии — data-ending-style):
// контейнер списка записей (role="listbox") есть всегда.
const OPEN_OVERLAY =
  '[role="dialog"][data-open]:not([data-ending-style]), [role="alertdialog"][data-open]:not([data-ending-style]), [role="menu"][data-open]:not([data-ending-style]), [role="listbox"][data-open]:not([data-ending-style]), [data-slot="popover-content"][data-open]:not([data-ending-style])'

/** Открыт диалог, меню, поповер, список выбора (Base UI) либо быстрая запись / палитра / мобильное меню. */
export function overlayOpen(): boolean {
  const s = useUi.getState()
  if (s.captureOpen || s.paletteOpen || s.navOpen) return true
  if (typeof document === 'undefined') return false
  return !!document.querySelector(OPEN_OVERLAY)
}

/**
 * На какую ноду графа действуют клавиши записи (E / A / F / L / Del): запись, открытая в панели деталей, важнее
 * курсора — её могли открыть извне (палитра, связанные записи), не сдвинув курсор. Открытой записи нет в сцене
 * (скрытый архив, корзина) — курсор. null — действовать не на что.
 */
export function graphKeyTarget(
  selectedId: string | null,
  cursorId: string | null,
  inScene: { has(id: string): boolean },
): string | null {
  if (selectedId !== null && inScene.has(selectedId)) return selectedId
  if (cursorId !== null && inScene.has(cursorId)) return cursorId
  return null
}

/** Открыт модальный лист деталей (телефон). */
export function detailSheetOpen(): boolean {
  if (typeof document === 'undefined') return false
  return !!document.querySelector('[data-detail-sheet]')
}
