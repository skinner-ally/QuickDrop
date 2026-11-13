import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
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
  focusCaptureWindow,
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

/**
 * Обычное «Сохранить» прячет окно (toast гасит close), поэтому подтверждение нужно, только когда окно остаётся
 * открытым («Сохранить и добавить ещё»): иначе не видно, сохранилось ли что-то или поля просто сбросились.
 * Без кнопки «Открыть»: она увела бы фокус в главное окно.
 */
function notifyWindowSaved(ids: string[], toLibrary: boolean) {
  toast.success(
    ids.length > 1 ? `Сохранено записей: ${ids.length}` : toLibrary ? 'Сохранено в базу знаний' : 'Сохранено во входящие',
  )
}

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
  /** Окно сейчас в фокусе (по событиям Rust) и был ли бросок в него без фокуса: тогда окно не прячется само. */
  const focusedRef = useRef(true)
  const droppedUnfocusedRef = useRef(false)

  /** Закрыть без опроса формы: размонтировать и спрятать окно. */
  const close = useCallback(() => {
    // sonner останавливает таймер у скрытого окна: toast не должен дожидаться следующего показа.
    toast.dismiss()
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
    droppedUnfocusedRef.current = false
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
        // Бросок текста или ссылки из другой программы фокус окну не отдаёт: без этой отметки окно исчезло бы
        // прямо после броска. Отметка снимается фокусом окна и новым показом.
        if (openRef.current && !droppedUnfocusedRef.current) hideOnBlur(autoHideRef.current, requestCloseRef.current)
      },
      CAPTURE_BLUR_DELAY_MS,
      capturePointerDown,
    )
    blurRef.current = blur
    // Файл, текст или ссылка уже над окном: скрытие на паузе до броска или ухода курсора из окна. Слушатели окна
    // в фазе перехвата: форма останавливает всплытие drop. Счётчик — dragenter/dragleave приходят на каждый элемент.
    let dragDepth = 0
    const onDragEnter = () => {
      if (dragDepth++ === 0) blur.suspend()
    }
    const onDragLeave = () => {
      if (dragDepth === 0) return
      if (--dragDepth === 0) blur.resume()
    }
    const onDropEnd = (e: Event) => {
      if (e.type === 'drop' && !focusedRef.current) {
        // Бросок текста или ссылки фокус окну не даёт: без него Enter и Esc не работают. Флаг — страховка от скрытия.
        droppedUnfocusedRef.current = true
        void focusCaptureWindow()
      }
      if (dragDepth === 0) return
      dragDepth = 0
      blur.resume()
    }
    const focusAware = {
      onFocusChange(f: boolean) {
        focusedRef.current = f
        if (f) droppedUnfocusedRef.current = false
        blur.onFocusChange(f)
      },
    }
    window.addEventListener('dragenter', onDragEnter, true)
    window.addEventListener('dragleave', onDragLeave, true)
    window.addEventListener('drop', onDropEnd, true)
    window.addEventListener('dragend', onDropEnd, true)
    let cancelled = false
    let off: (() => void) | undefined
    initCaptureWindow({ onShown: () => onShownRef.current(), blur: focusAware })
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
            onSaved={notifyWindowSaved}
            onOpenItem={openItem}
            onFilePicker={onFilePicker}
          />
        )}
      </div>
    </div>
  )
}

/**
 * Заглушка при сбое хранилища. Шапка и обработчики окна вместе с деревом размонтированы, а окно без рамки и поверх
 * всех, поэтому заглушка сама даёт «Закрыть» и Esc, а новый показ окна пробует отрисовать дерево заново.
 * Не зависит ни от БД, ни от ThemeProvider.
 */
function CaptureErrorFallback({ error, reset }: { error: Error; reset: () => void }) {
  const close = useCallback(() => {
    if (isTauri()) hideCaptureWindow().catch((err) => console.warn('[capture] не удалось спрятать окно', err))
    else reset()
  }, [reset])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    let off: (() => void) | undefined
    let cancelled = false
    if (isTauri()) {
      void import('@tauri-apps/api/webviewWindow')
        .then(({ getCurrentWebviewWindow }) => getCurrentWebviewWindow().listen('capture-shown', () => reset()))
        .then((unlisten) => {
          if (cancelled) unlisten()
          else off = unlisten
        })
        .catch((err) => console.warn('[capture] подписка на показ окна не установлена', err))
    }
    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKey)
      off?.()
    }
  }, [close, reset])
  return (
    <div className="relative">
      <div data-tauri-drag-region className="absolute inset-x-0 top-0 z-10 h-9" />
      <button
        type="button"
        aria-label="Закрыть"
        title="Закрыть (Esc)"
        className="absolute top-1.5 right-2 z-20 h-7 rounded-lg border bg-background px-2.5 text-sm px-btn"
        onClick={close}
      >
        Закрыть
      </button>
      <StorageErrorFallback error={error} />
    </div>
  )
}

export function CaptureWindowApp() {
  return (
    // Граница выше ThemeProvider: он сам читает настройки из БД (useLiveQuery) и падает первым.
    <ErrorBoundary fallback={(error, reset) => <CaptureErrorFallback error={error} reset={reset} />}>
      <ThemeProvider>
        <TooltipProvider delay={400}>
          <CaptureWindow />
          <Toaster position="bottom-center" />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
