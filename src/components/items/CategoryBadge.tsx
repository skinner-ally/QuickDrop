import { createContext, useContext } from 'react'
import { useCategories } from '@/hooks/useItems'
import { cn } from '@/lib/utils'
import type { Category, CategoryColor } from '@/types'

export function CategoryDot({ color, className }: { color: CategoryColor; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-2 shrink-0 rounded-full', className)}
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
        'inline-flex max-w-full items-center gap-1.5 rounded-md font-medium text-foreground',
        size === 'sm' ? 'h-5 px-1.5 text-xs' : 'h-6 px-2 text-[13px]',
        className,
      )}
      style={{ background: `var(--cat-${cat.color}-soft)` }}
    >
      <CategoryDot color={cat.color} />
      <span className="truncate">{cat.name}</span>
    </span>
  )
}
