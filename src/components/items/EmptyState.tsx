import type { ReactElement, ReactNode } from 'react'
import { ICON_NAMES, Icon, type IconName } from '@/components/icons'
import { cn } from '@/lib/utils'

/** icon — либо имя значка, либо готовый элемент. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: IconName | ReactElement
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  const iconNode: ReactNode = typeof icon === 'string' ? ((ICON_NAMES as readonly string[]).includes(icon) ? <Icon name={icon as IconName} size={20} /> : null) : icon
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-16 text-center', className)}>
      {iconNode && (
        <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {iconNode}
        </div>
      )}
      <div className="flex max-w-sm flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {description && <p className="text-2sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}
