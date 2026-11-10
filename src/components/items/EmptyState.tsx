import { isValidElement, type ElementType, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** icon — либо иконка lucide (компонент), либо готовый элемент. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ElementType | ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  let iconNode: ReactNode = null
  if (isValidElement(icon)) iconNode = icon
  else if (icon && (typeof icon === 'function' || typeof icon === 'object')) {
    const Icon = icon as ElementType
    iconNode = <Icon size={20} strokeWidth={1.75} aria-hidden />
  }
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-16 text-center', className)}>
      {iconNode && (
        <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {iconNode}
        </div>
      )}
      <div className="flex max-w-sm flex-col gap-1">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {description && <p className="text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}
