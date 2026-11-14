// Перезагрузка после обновления service worker (src/pwa.ts): не уничтожать набранный текст.

/** Типы input, в которые не вводят текст: фокус на них не мешает перезагрузке. */
const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'])

/** Открытые модальные окна Base UI: в них бывают формы с несохранённым вводом. */
const OPEN_DIALOG =
  '[role="dialog"][data-open]:not([data-ending-style]), [role="alertdialog"][data-open]:not([data-ending-style])'

/** Элемент принимает текстовый ввод. */
export function isTextEntry(el: Element | null | undefined): boolean {
  if (!el) return false
  if ((el as HTMLElement).isContentEditable) return true
  if (el.tagName === 'TEXTAREA') return true
  if (el.tagName === 'INPUT') return !NON_TEXT_INPUTS.has(((el as HTMLInputElement).type || 'text').toLowerCase())
  return false
}

/** Пользователь что-то набирает или держит открытой форму: перезагрузка потеряет ввод. */
export function isUserBusy(doc: Pick<Document, 'activeElement' | 'querySelector'>, captureOpen: boolean): boolean {
  return captureOpen || isTextEntry(doc.activeElement) || doc.querySelector(OPEN_DIALOG) !== null
}

export interface ReloadGateDeps {
  isBusy: () => boolean
  isHidden: () => boolean
  reload: () => void
  /** Перезагрузка отложена: предложить обновиться вручную. */
  onDeferred: () => void
}

export interface ReloadGate {
  /** Новая версия взяла управление страницей. */
  request: () => void
  /** Повторная попытка отложенной перезагрузки; вызывать при смене видимости страницы. */
  retry: () => void
  readonly pending: boolean
}

/**
 * Если пользователь ничего не вводит — перезагрузить сразу (старые чанки после деплоя уже недоступны).
 * Иначе отложить до момента, когда страница скрыта и ввода нет: перезагрузка по закрытию панели
 * или потере фокуса оборвала бы фоновую запись в IndexedDB и подгрузку метаданных ссылки.
 */
export function createReloadGate(deps: ReloadGateDeps): ReloadGate {
  let pending = false
  const reload = () => {
    pending = false
    deps.reload()
  }
  return {
    request() {
      if (pending) return
      if (!deps.isBusy()) {
        reload()
        return
      }
      pending = true
      deps.onDeferred()
    },
    retry() {
      if (pending && deps.isHidden() && !deps.isBusy()) reload()
    },
    get pending() {
      return pending
    },
  }
}
