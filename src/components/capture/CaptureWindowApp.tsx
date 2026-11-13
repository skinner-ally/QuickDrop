import { useCallback, useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/icons'
import { ErrorBoundary, StorageErrorFallback } from '@/components/layout/ErrorBoundary'
import { ThemeProvider } from '@/components/layout/ThemeProvider'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  CAPTURE_BLUR_DELAY_MS,
  capturePointerDown,
  createBlurHider,
  hideCaptureWindow,
  hideOnBlur,
  initCaptureWindow,
  isCaptureWindowVisible,
  type BlurHider,
} from '@/lib/captureWindow'
import { openInMain } from '@/lib/desktop'
import { isTauri } from '@/lib/platform'
import type { Item } from '@/types'
import { CaptureForm } from './CaptureForm'
import type { SnapshotFn } from './CaptureForm'

/** Сохранённое мини-окно просто прячется: toast не нужен (запись появится во входящих главного окна). */
const noopSaved = () => {}

function CaptureWindow() {
  const inTauri = isTauri()
  // Вне Tauri (страница открыта в браузере на /capture.html) форма открыта сразу и не прячется.
  const [open, setOpen] = useState(!inTauri)
  /** Новый ключ — новая форма: вне Tauri так «скрытие» превращается в сброс формы. */
  const [formKey, setFormKey] = useState(0)
  const [shownTick, setShownTick] = useState(0)
  const snapshotRef = useRef<SnapshotFn | null>(null)
  const autoHideRef = useRef<(() => boolean) | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const blurRef = useRef<BlurHider | null>(null)
  const openRef = useRef(open)
  openRef.current = open

  /** Закрыть без опроса формы: размонтировать и спрятать окно. */
  const close = useCallback(() => {
    if (!inTauri) {
      setFormKey((k) => k + 1)
      return
    }
    setOpen(false)
    hideCaptureWindow().catch((err) => console.warn('[capture] не удалось спрятать окно', err))
  }, [inTauri])

  /** Esc, потеря фокуса, кнопка закрытия: форма может отказать (идёт сохранение, вопрос о файлах). */
  const requestClose = useCallback(() => {
    if (snapshotRef.current?.() === false) return
    close()
  }, [close])
  const requestCloseRef = useRef(requestClose)
  requestCloseRef.current = requestClose

  const onShown = useCallback(() => {
    setOpen(true)
    setShownTick((t) => t + 1)
  }, [])
  const onShownRef = useRef(onShown)
  onShownRef.current = onShown

  // Подписки окна и скрытие по потере фокуса.
  useEffect(() => {
    if (!inTauri) return
    // Пока зажата кнопка мыши (файл тащат из Проводника), окно не прячется.
    const blur = createBlurHider(
      () => {
        if (openRef.current) hideOnBlur(autoHideRef.current, requestCloseRef.current)
      },
      CAPTURE_BLUR_DELAY_MS,
      capturePointerDown,
    )
    blurRef.current = blur
    // Файл уже над окном: скрытие на паузе до броска или ухода курсора из окна. Слушатели окна в фазе
    // перехвата: форма останавливает всплытие drop. Счётчик — dragenter/dragleave приходят на каждый элемент.
    let dragDepth = 0
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      if (dragDepth++ === 0) blur.suspend()
    }
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e) || dragDepth === 0) return
      if (--dragDepth === 0) blur.resume()
    }
    const onDropEnd = () => {
      if (dragDepth === 0) return
      dragDepth = 0
      blur.resume()
    }
    window.addEventListener('dragenter', onDragEnter, true)
    window.addEventListener('dragleave', onDragLeave, true)
    window.addEventListener('drop', onDropEnd, true)
    window.addEventListener('dragend', onDropEnd, true)
    let cancelled = false
    let off: (() => void) | undefined
    initCaptureWindow({ onShown: () => onShownRef.current(), blur })
      .then(async (unlisten) => {
        if (cancelled) {
          unlisten()
          return
        }
        off = unlisten
        // Первое создание окна: показ мог случиться раньше подписки.
        if (await isCaptureWindowVisible()) onShownRef.current()
      })
      .catch((err) => console.warn('[capture] подписки окна не установлены', err))
    return () => {
      cancelled = true
      off?.()
      window.removeEventListener('dragenter', onDragEnter, true)
      window.removeEventListener('dragleave', onDragLeave, true)
      window.removeEventListener('drop', onDropEnd, true)
      window.removeEventListener('dragend', onDropEnd, true)
      blur.dispose()
      blurRef.current = null
    }
  }, [inTauri])

  const onFilePicker = useCallback((pickerOpen: boolean) => {
    if (pickerOpen) blurRef.current?.suspend()
    else blurRef.current?.resume()
  }, [])

  // Esc. В фазе перехвата запоминаем, был ли открыт выпадающий список (категория, теги, язык): он сам закроется
  // от этого Esc, окно — только от следующего. Затем в фазе всплытия закрываем окно, если никто не занял событие.
  useEffect(() => {
    let popupOpen = false
    const onCapture = (e: KeyboardEvent) => {
      if (e.key === 'Escape') popupOpen = !!document.querySelector('[aria-expanded="true"]')
    }
    const onBubble = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing || e.defaultPrevented || popupOpen) return
      e.preventDefault()
      requestCloseRef.current()
    }
    window.addEventListener('keydown', onCapture, true)
    window.addEventListener('keydown', onBubble)
    return () => {
      window.removeEventListener('keydown', onCapture, true)
      window.removeEventListener('keydown', onBubble)
    }
  }, [])

  // Повторный показ при уже открытой форме (её прячет Rust по тому же сочетанию): вернуть фокус в поле текста.
  useEffect(() => {
    if (!shownTick) return
    const id = requestAnimationFrame(() => frameRef.current?.querySelector('textarea')?.focus())
    return () => cancelAnimationFrame(id)
  }, [shownTick])

  const openItem = useCallback((item: Item) => void openInMain(item.id), [])

  return (
    <div className="h-dvh bg-popover pixel:bg-wood-dark">
      <div
        ref={frameRef}
        className="flex h-full min-h-0 flex-col border border-border bg-popover p-3 text-sm text-popover-foreground px-panel pixel:[--px-pad:12px]"
      >
        <header data-tauri-drag-region className="mb-2.5 flex shrink-0 items-center gap-2 select-none">
          <Icon name="sprout" pixelSize={20} className="pointer-events-none hidden pixel:block" />
          <h1 className="pointer-events-none min-w-0 flex-1 truncate font-heading text-sm font-medium pixel:text-2xl">
            Быстрая запись
          </h1>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Закрыть"
            title="Закрыть (Esc)"
            className="px-btn pixel:size-7.5"
            onClick={requestClose}
          >
            <Icon name="x" />
          </Button>
        </header>
        {open && (
          <CaptureForm
            key={formKey}
            variant="window"
            draft={null}
            snapshotRef={snapshotRef}
            autoHideRef={autoHideRef}
            onClose={close}
            onSaved={noopSaved}
            onOpenItem={openItem}
            onFilePicker={onFilePicker}
          />
        )}
      </div>
    </div>
  )
}

export function CaptureWindowApp() {
  return (
    // Граница выше ThemeProvider: он сам читает настройки из БД (useLiveQuery) и падает первым.
    <ErrorBoundary fallback={(error) => <StorageErrorFallback error={error} />}>
      <ThemeProvider>
        <TooltipProvider delay={400}>
          <CaptureWindow />
          <Toaster position="bottom-center" />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
