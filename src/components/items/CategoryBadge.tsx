import { createContext, useContext, type CSSProperties } from 'react'
import { useCategories } from '@/hooks/useItems'
import { cn } from '@/lib/utils'
import type { Category, CategoryColor } from '@/types'

export function CategoryDot({ color, className }: { color: CategoryColor; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('px-sw inline-block size-2 shrink-0 rounded-full pixel:size-2.5', className)}
      style={{ background: `var(--cat-${color})` }}
    />
  )
}

/** Общий список категорий: ItemList читает его один раз, а не по подписке на каждую строку. */
export const CategoriesContext = createContext<Category[] | null>(null)

type BadgeProps = {
  categoryId: string | null | undefined
  size?: 'sm' | 'md'
  className?: string
}

export function CategoryBadge(props: BadgeProps) {
  const shared = useContext(CategoriesContext)
  return shared ? <BadgeView {...props} categories={shared} /> : <LiveBadge {...props} />
}

function LiveBadge(props: BadgeProps) {
  return <BadgeView {...props} categories={useCategories()} />
}

function BadgeView({
  categoryId,
  size = 'sm',
  className,
  categories,
}: BadgeProps & { categories: Category[] }) {
  const cat = categoryId ? categories.find((c) => c.id === categoryId) : undefined
  if (!cat) return null
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-md bg-(--cat-bg) font-medium text-foreground pixel:h-auto pixel:bg-transparent pixel:px-0 pixel:font-normal',
        size === 'sm' ? 'h-5 px-1.5 text-xs pixel:min-h-5' : 'h-6 px-2 text-2sm pixel:min-h-6',
        className,
      )}
      style={{ '--cat-bg': `var(--cat-${cat.color}-soft)` } as CSSProperties}
    >
      <CategoryDot color={cat.color} />
      <span className="truncate">{cat.name}</span>
    </span>
  )
}
