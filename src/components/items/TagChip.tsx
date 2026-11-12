import { Icon } from '@/components/icons'
import { cn } from '@/lib/utils'

const focusRing = 'outline-none focus-visible:ring-2 focus-visible:ring-ring/60'

export function TagChip({
  tag,
  onRemove,
  onClick,
  active,
  className,
}: {
  tag: string
  onRemove?: () => void
  onClick?: () => void
  active?: boolean
  className?: string
}) {
  const label = `#${tag}`
  return (
    <span
      className={cn(
        'inline-flex h-5 max-w-full items-center rounded-md text-xs leading-none',
        active ? 'bg-brand-soft text-foreground' : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {onClick ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onClick()
          }}
          aria-pressed={active}
          className={cn(
            'h-full min-w-0 truncate rounded-md px-1.5 transition-colors hover:text-foreground',
            onRemove && 'rounded-r-none pr-1',
            focusRing,
          )}
        >
          {label}
        </button>
      ) : (
        <span className={cn('min-w-0 truncate px-1.5', onRemove && 'pr-1')}>{label}</span>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Убрать тег ${tag}`}
          className={cn(
            'relative flex h-full items-center rounded-md rounded-l-none pr-1 pl-0.5 pointer-coarse:after:absolute pointer-coarse:after:-inset-2 text-muted-foreground transition-colors hover:text-foreground',
            focusRing,
          )}
        >
          <Icon name="x" size={12} />
        </button>
      )}
    </span>
  )
}
