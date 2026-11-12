import { create, type StoreApi, type UseBoundStore } from 'zustand'

export interface ConfirmOptions {
  title: string
  description?: string
  /** По умолчанию «Подтвердить». */
  confirmLabel?: string
  /** По умолчанию «Отмена». */
  cancelLabel?: string
  destructive?: boolean
}

export interface ConfirmRequest extends ConfirmOptions {
  id: number
}

interface ConfirmState {
  request: ConfirmRequest | null
  /** Ответ на текущий вопрос; вопроса нет — ничего. */
  settle: (ok: boolean) => void
}

export const DEFAULT_CONFIRM_LABEL = 'Подтвердить'
export const DEFAULT_CANCEL_LABEL = 'Отмена'

let nextId = 1
/** Решение промиса текущего вопроса. Вне состояния: функции в zustand ни к чему подписчикам. */
let pending: ((ok: boolean) => void) | null = null

export const useConfirm: UseBoundStore<StoreApi<ConfirmState>> = create<ConfirmState>((set) => ({
  request: null,
  settle: (ok) => {
    const resolve = pending
    if (!resolve) return
    pending = null
    set({ request: null })
    resolve(ok)
  },
}))

/** Показывает вопрос (рисует ConfirmHost) и ждёт ответа. Новый вопрос поверх старого: старый получает false. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  const previous = pending
  pending = null
  previous?.(false)
  return new Promise<boolean>((resolve) => {
    pending = resolve
    useConfirm.setState({
      request: {
        ...options,
        confirmLabel: options.confirmLabel ?? DEFAULT_CONFIRM_LABEL,
        cancelLabel: options.cancelLabel ?? DEFAULT_CANCEL_LABEL,
        id: nextId++,
      },
    })
  })
}
