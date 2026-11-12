import { useEffect, useState } from 'react'
import { useUi, type View } from '@/store/ui'
import { pastedFiles } from '@/lib/clipboard'
import { matchKey } from '@/lib/keys'
import { isMac } from '@/lib/platform'

const VIEW_BY_DIGIT: Record<string, View> = {
  Digit1: 'inbox',
  Digit2: 'library',
  Digit3: 'favorites',
  Digit4: 'archive',
  Digit5: 'graph',
}

function viewByDigit(e: KeyboardEvent): View | undefined {
  for (const [code, view] of Object.entries(VIEW_BY_DIGIT)) {
    if (matchKey(e, code, code.replace('Digit', ''))) return view
  }
  return undefined
}

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

const OPEN_OVERLAY =
  '[role="dialog"][data-open]:not([data-ending-style]), [role="alertdialog"][data-open]:not([data-ending-style]), [role="menu"][data-open]:not([data-ending-style]), [role="listbox"][data-open]:not([data-ending-style]), [data-slot="popover-content"][data-open]:not([data-ending-style])'

/** Открыт ли диалог/поповер/меню (Base UI рендерит их с role). */
function overlayOpen(): boolean {
  const s = useUi.getState()
  if (s.captureOpen || s.paletteOpen || s.navOpen) return true
  // Только реально открытые слои: контейнер списка записей (role="listbox") есть всегда.
  return !!document.querySelector(OPEN_OVERLAY)
}

function hasFiles(dt: DataTransfer | null): boolean {
  return !!dt && Array.from(dt.types).includes('Files')
}

/**
 * Глобальные клавиши, вставка из буфера и drag&drop.
 * Сочетания проверяются по e.code, чтобы работать в любой раскладке.
 * Возвращает признак «над окном тащат файлы» для оверлея.
 */
export function useHotkeys(): { dragging: boolean } {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ui = useUi.getState()
      // На Mac модификатор — только ⌘: Ctrl+K в полях ввода — «удалить до конца строки».
      const mac = isMac()
      const mod = mac ? e.metaKey : e.ctrlKey || e.metaKey

      if (mod && e.shiftKey && matchKey(e, 'Space', ' ')) {
        e.preventDefault()
        ui.openCapture()
        return
      }
      // На Mac Option+N — мёртвая клавиша (ñ): в полях ввода её не перехватываем.
      if (e.altKey && !mod && !e.shiftKey && matchKey(e, 'KeyN', 'n') && !(mac && isEditable(e.target))) {
        e.preventDefault()
        ui.openCapture()
        return
      }
      if (mod && !e.shiftKey && !e.altKey && matchKey(e, 'KeyK', 'k')) {
        e.preventDefault()
        ui.setPaletteOpen(true)
        return
      }

      if (e.defaultPrevented || e.isComposing) return
      const plain = !mod && !e.altKey && !e.shiftKey

      if (matchKey(e, 'Escape', 'Escape')) {
        if (!ui.selectedId || overlayOpen()) return
        if (isEditable(e.target)) {
          // Первый Esc мог закрыть подсказки поля (defaultPrevented уже отсёк). Иначе снимаем фокус,
          // чтобы следующий Esc закрыл панель.
          if (e.target instanceof HTMLElement) e.target.blur()
          return
        }
        // preventDefault: список по тому же Esc не должен ещё и снимать отметки.
        e.preventDefault()
        ui.select(null)
        return
      }

      if (!plain || isEditable(e.target) || overlayOpen()) return

      const digitView = viewByDigit(e)
      if (matchKey(e, 'KeyN', 'n')) {
        e.preventDefault()
        ui.openCapture()
      } else if (matchKey(e, 'Slash', '/')) {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('[data-search-input]')?.focus()
      } else if (digitView) {
        e.preventDefault()
        ui.setView(digitView)
      }
    }

    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || isEditable(e.target) || overlayOpen() || !e.clipboardData) return
      // Текст + растровая копия из офисной программы — это текст (см. isRichTextPaste).
      const files = pastedFiles(e.clipboardData)
      if (files.length) {
        e.preventDefault()
        useUi.getState().openCapture({ files, source: 'paste' })
        return
      }
      const text = e.clipboardData.getData('text/plain')
      if (text.trim()) {
        e.preventDefault()
        useUi.getState().openCapture({ text, source: 'paste' })
      }
    }

    // Счётчик: dragenter/dragleave срабатывают на каждом вложенном элементе.
    let depth = 0
    // Перетаскивание началось внутри документа (выделенный текст, ссылка) — это не внешний drop.
    let internalDrag = false
    const onDragStart = () => {
      internalDrag = true
    }
    // drop может перехватить форма (stopPropagation) — сбрасываем счётчик в фазе capture.
    const onDropCapture = () => {
      depth = 0
      setDragging(false)
    }
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return
      depth++
      if (!useUi.getState().captureOpen) setDragging(true)
    }
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e.dataTransfer) || !isEditable(e.target)) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      depth = 0
      setDragging(false)
      const internal = internalDrag
      internalDrag = false
      if (e.defaultPrevented || !e.dataTransfer) return
      const dt = e.dataTransfer
      const files = Array.from(dt.files)
      if (files.length) {
        // Файл на странице не должен открываться браузером; панель сама разберёт drop.
        e.preventDefault()
        // Открытая форма дополняет список файлов по captureDraft; drop мимо формы не должен теряться.
        useUi.getState().openCapture({ files, source: 'drop' })
        return
      }
      if (internal || isEditable(e.target) || useUi.getState().captureOpen) return
      const text = dt.getData('text/uri-list') || dt.getData('text/plain')
      if (text.trim()) {
        e.preventDefault()
        useUi.getState().openCapture({ text: text.split('\n').find((l) => l && !l.startsWith('#')) ?? text, source: 'drop' })
      }
    }
    const onDragEnd = () => {
      internalDrag = false
      depth = 0
      setDragging(false)
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('paste', onPaste)
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    document.addEventListener('drop', onDropCapture, true)
    document.addEventListener('dragstart', onDragStart)
    document.addEventListener('dragend', onDragEnd)

    // Глобальную клавишу Tauri целиком обрабатывает src/lib/desktop.ts (register → raiseWindow → openCapture).
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('paste', onPaste)
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('drop', onDrop)
      document.removeEventListener('drop', onDropCapture, true)
      document.removeEventListener('dragstart', onDragStart)
      document.removeEventListener('dragend', onDragEnd)
    }
  }, [])

  return { dragging }
}
