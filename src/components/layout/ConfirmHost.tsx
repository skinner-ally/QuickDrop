import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useConfirm, type ConfirmRequest } from '@/store/confirm'

/**
 * Вопрос-подтверждение внутри приложения (confirmDialog из store/confirm). window.confirm не годится:
 * в Tauri его подменяет плагин, который возвращает промис и не ждёт ответа.
 */
export function ConfirmHost() {
  const request = useConfirm((s) => s.request)
  const settle = useConfirm((s) => s.settle)
  // Последний вопрос держим до конца анимации закрытия, иначе диалог схлопнулся бы пустым.
  const [shown, setShown] = useState<ConfirmRequest | null>(request)
  if (request && request !== shown) setShown(request)
  const current = request ?? shown
  // Фокус — на «Отмена»: Enter по ошибке не должен удалить навсегда.
  const cancelRef = useRef<HTMLButtonElement>(null)

  return (
    <Dialog
      open={!!request}
      onOpenChange={(open) => {
        if (!open) settle(false)
      }}
    >
      <DialogContent showCloseButton={false} initialFocus={cancelRef}>
        <DialogHeader>
          <DialogTitle>{current?.title}</DialogTitle>
          {current?.description && <DialogDescription>{current.description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button ref={cancelRef} variant="outline" className="pointer-coarse:h-9" onClick={() => settle(false)}>
            {current?.cancelLabel}
          </Button>
          <Button variant={current?.destructive ? 'destructive' : 'default'} className="pointer-coarse:h-9" onClick={() => settle(true)}>
            {current?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
