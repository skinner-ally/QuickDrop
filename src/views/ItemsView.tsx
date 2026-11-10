import type { ReactNode } from 'react'
import { SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/items/EmptyState'
import { FilterBar } from '@/components/items/FilterBar'
import { ItemList } from '@/components/items/ItemList'
import { useVisibleItems } from '@/hooks/useItems'
import { useUi } from '@/store/ui'
import type { ItemFilter } from '@/types'

export interface ItemsViewProps {
  title: string
  subtitle?: string
  /** Фильтр раздела (статус и т.п.). */
  base: ItemFilter
  variant: 'inbox' | 'library' | 'favorites' | 'archive'
  /** Показывается, когда в разделе вообще нет записей. */
  emptyState: ReactNode
}

/** Общая основа разделов: заголовок, счётчик, панель фильтров и список. */
export function ItemsView({ title, subtitle, base, variant, emptyState }: ItemsViewProps) {
  const { hits, total, loading } = useVisibleItems(base)
  const layout = useUi((s) => s.layout)
  const query = useUi((s) => s.query)
  const filter = useUi((s) => s.filter)
  const resetFilter = useUi((s) => s.resetFilter)
  const setQuery = useUi((s) => s.setQuery)

  const narrowed = query.trim() !== '' || Object.values(filter).some((v) => v !== undefined)

  const noResults = (
    <EmptyState
      icon={SearchX}
      title="Ничего не найдено"
      description="Попробуйте изменить запрос или ослабить фильтры."
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            resetFilter()
            setQuery('')
          }}
        >
          Сбросить фильтры
        </Button>
      }
    />
  )

  return (
    <section
      aria-label={title}
      className="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-6"
    >
      <header className="flex flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {!loading && total > 0 && (
            <span className="text-[13px] text-muted-foreground tabular-nums" aria-live="polite">
              {hits.length} из {total}
            </span>
          )}
        </div>
        {subtitle && <p className="text-[13px] text-muted-foreground">{subtitle}</p>}
      </header>

      <FilterBar />

      {loading ? null : hits.length === 0 ? (
        narrowed || total > 0 ? noResults : emptyState
      ) : (
        <ItemList hits={hits} variant={variant} layout={layout} />
      )}
    </section>
  )
}
