import { useRef } from 'react'
import { toast } from 'sonner'
import { Icon } from '@/components/icons'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { openItemInSection } from '@/lib/actions'
import { useUi } from '@/store/ui'
import { CaptureForm } from './CaptureForm'
import type { SnapshotFn } from './CaptureForm'

function notifySaved(ids: string[], toLibrary: boolean) {
  const first = ids[0]
  const message =
    ids.length > 1
      ? `Сохранено записей: ${ids.length}`
      : toLibrary
        ? 'Сохранено в базу знаний'
        : 'Сохранено во входящие'
  toast.success(message, {
    action: { label: 'Открыть', onClick: () => useUi.getState().select(first) },
  })
}

export function QuickCapture() {
  const open = useUi((s) => s.captureOpen)
  const draft = useUi((s) => s.captureDraft)
  const closeCapture = useUi((s) => s.closeCapture)
  const snapshotRef = useRef<SnapshotFn | null>(null)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return
        if (snapshotRef.current?.() === false) return
        closeCapture()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="top-[max(0.5rem,env(safe-area-inset-top))] max-h-[calc(100dvh-1rem)] w-full max-w-[calc(100%-1rem)] translate-y-0 gap-0 overflow-y-auto p-2.5 sm:top-[12vh] sm:max-w-[640px] sm:p-3 pixel:flex pixel:flex-col pixel:overflow-hidden"
        data-skin="panel"
      >
        <DialogTitle className="sr-only font-heading pixel:not-sr-only pixel:mb-2.5 pixel:flex pixel:items-center pixel:gap-2 pixel:text-2xl">
          <Icon name="sprout" pixelSize={20} className="hidden pixel:block" />
          Быстрая запись
        </DialogTitle>
        <CaptureForm
          variant="dialog"
          draft={draft}
          snapshotRef={snapshotRef}
          onClose={closeCapture}
          onSaved={notifySaved}
          onOpenItem={openItemInSection}
        />
      </DialogContent>
    </Dialog>
  )
}
