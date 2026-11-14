import type { ReactNode } from 'react'
import { Icon } from '@/components/icons'
import { cn } from '@/lib/utils'

export function NavButton({
  active,
  onClick,
  icon,
  label,
  count,
  accent,
  title,
  className,
}: {
  active?: boolean
  onClick: () => void
  icon: ReactNode
  label: string
  count?: number
  accent?: boolean
  title?: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-2sm outline-none transition-colors',
        'px-nav pixel:h-7 pixel:px-1.5 pixel:max-md:h-9.5',
        'hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        active ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'text-sidebar-foreground/85',
        className,
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <span
          className={cn(
            'text-xs tabular-nums',
            accent ? 'rounded-full bg-brand px-1.5 font-medium text-brand-foreground px-count' : 'text-muted-foreground',
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
}

export function SectionHeader({
  title,
  open,
  onToggle,
  action,
}: {
  title: string
  open: boolean
  onToggle: () => void
  action?: ReactNode
}) {
  return (
    <div className="mt-3 flex items-center justify-between pr-1 pl-2 pixel:mt-1.5 pixel:px-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center gap-1 rounded text-xs font-medium text-muted-foreground pixel:text-2sm pixel:font-semibold outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} className="size-3.5" />
        {title}
      </button>
      {action}
    </div>
  )
}
