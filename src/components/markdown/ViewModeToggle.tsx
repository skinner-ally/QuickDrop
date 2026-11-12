import type { ReactElement } from 'react'
import { Icon, type IconName } from '@/components/icons'
import { cn } from '@/lib/utils'
import { useUi } from '@/store/ui'

const MODES: ReadonlyArray<readonly [preview: boolean, icon: IconName, label: string]> = [
  [true, 'eye', 'Просмотр'],
  [false, 'code', 'Исходник'],
]

/** Переключатель «Просмотр / Исходник» (useUi.mdPreview) — один на всё приложение. */
export function ViewModeToggle({ className }: { className?: string }): ReactElement {
  const mdPreview = useUi((s) => s.mdPreview)
  const setMdPreview = useUi((s) => s.setMdPreview)
  return (
    <div
      role="group"
      aria-label="Вид текста"
      className={cn(
        'flex shrink-0 rounded-lg border border-border p-0.5 dark:border-input pixel:gap-1 pixel:border-0 pixel:p-0',
        className,
      )}
    >
      {MODES.map(([preview, icon, label]) => {
        const on = mdPreview === preview
        return (
          <button
            key={label}
            type="button"
            aria-pressed={on}
            onClick={() => setMdPreview(preview)}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs transition-colors outline-none pointer-coarse:h-9 focus-visible:ring-2 focus-visible:ring-ring/60 px-btn pixel:h-7.5 pixel:max-md:h-9 pixel:pointer-coarse:h-9',
              on ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon name={icon} size={14} />
            {label}
          </button>
        )
      })}
    </div>
  )
}
