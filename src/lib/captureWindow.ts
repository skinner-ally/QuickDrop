/** Мини-окно быстрой записи (Tauri): скрытие и подписки окна. Вне Tauri ничего не делает. */

export const CAPTURE_WINDOW_LABEL = 'capture'
/** Задержка скрытия по потере фокуса: короткая потеря (смена фокуса внутри окна, системный диалог) не прячет окно. */
export const CAPTURE_BLUR_DELAY_MS = 150

/** Спрятать мини-окно (окно не уничтожается: следующий показ мгновенный). */
export async function hideCaptureWindow(): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().hide()
}

/**
 * Окно уже показано? Нужно один раз после подписки: при первом создании окна `capture-shown` мог прийти
 * раньше, чем страница успела подписаться. Не бросает.
 */
export async function isCaptureWindowVisible(): Promise<boolean> {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    return await getCurrentWindow().isVisible()
  } catch {
    return false
  }
}

export interface BlurHider {
  /** false — скрыть через delayMs, если фокус не вернулся и нет паузы; true — отменить ожидающее скрытие. */
  onFocusChange(focused: boolean): void
  /** Перед открытием системного диалога файла: он отнимает фокус, но окно скрывать нельзя. */
  suspend(): void
  /** После выбора файла или отмены; если фокус к окну так и не вернулся — скрытие планируется как обычно. */
  resume(): void
  dispose(): void
}

/**
 * Потеря фокуса мини-окном: сначала проверка без побочных эффектов (идёт сохранение, прикреплены файлы —
 * окно остаётся как есть), и только потом обычный запрос закрытия. Запрос закрытия у формы с файлами
 * переключает вопрос «Закрыть?»; от ухода в другую программу он не должен появляться и исчезать.
 * true — закрытие запрошено.
 */
export function hideOnBlur(canAutoHide: (() => boolean) | null | undefined, requestClose: () => void): boolean {
  if (canAutoHide && !canAutoHide()) return false
  requestClose()
  return true
}

/**
 * Зажата ли основная кнопка мыши (команда Rust `capture_pointer_down`; вне Windows всегда false). Пока зажата,
 * идёт перетаскивание: нажатие на файл в Проводнике отнимает у окна фокус раньше, чем файл донесён.
 * Ошибка — false (прежнее поведение). Не бросает.
 */
export async function capturePointerDown(): Promise<boolean> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return (await invoke<boolean>('capture_pointer_down')) === true
  } catch {
    return false
  }
}

/**
 * Чистая логика скрытия по потере фокуса (таймеры — setTimeout, в тесте поддельные). isPointerDown — если
 * задан, то пока он даёт true, скрытие откладывается ещё на delayMs (перетаскивание файла в окно).
 */
export function createBlurHider(
  hide: () => void,
  delayMs: number = CAPTURE_BLUR_DELAY_MS,
  isPointerDown?: () => Promise<boolean>,
): BlurHider {
  let timer: ReturnType<typeof setTimeout> | undefined
  let focused = true
  let paused = false
  let disposed = false
  /** Номер текущего ожидания: ответ isPointerDown, пришедший после отмены или перепланирования, не действует. */
  let seq = 0

  const cancel = () => {
    seq++
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }
  const stale = (n: number) => n !== seq || disposed || focused || paused
  const schedule = () => {
    cancel()
    const n = seq
    timer = setTimeout(() => {
      timer = undefined
      if (stale(n)) return
      if (!isPointerDown) {
        hide()
        return
      }
      void isPointerDown()
        .catch(() => false)
        .then((down) => {
          if (stale(n)) return
          if (down) schedule()
          else hide()
        })
    }, delayMs)
  }

  return {
    onFocusChange(f) {
      if (disposed) return
      focused = f
      if (f) cancel()
      else if (!paused) schedule()
    },
    suspend() {
      paused = true
      cancel()
    },
    resume() {
      paused = false
      // Событие фокуса из Rust приходит позже события поля файла: отложенная проверка это учитывает.
      if (!focused && !disposed) schedule()
    },
    dispose() {
      disposed = true
      cancel()
    },
  }
}

/**
 * Подписки окна: показ (`capture-shown` от Rust) и фокус. Подписка через само окно, а не глобальный `listen`:
 * глобальный получал бы и события, адресованные главному окну. Возвращает функцию отписки.
 */
export async function initCaptureWindow(handlers: {
  onShown(): void
  blur: Pick<BlurHider, 'onFocusChange'>
}): Promise<() => void> {
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  const win = getCurrentWebviewWindow()
  const offs: Array<() => void> = []
  try {
    offs.push(await win.listen('capture-shown', () => handlers.onShown()))
    offs.push(await win.onFocusChanged(({ payload }) => handlers.blur.onFocusChange(payload)))
  } catch (err) {
    for (const off of offs) off()
    throw err
  }
  return () => {
    for (const off of offs) off()
  }
}
