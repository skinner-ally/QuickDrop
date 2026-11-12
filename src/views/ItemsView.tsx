import type { ReactNode } from 'react'
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

const KEY_HINT: Record<ItemsViewProps['variant'], string> = {
  inbox: 'J/K — выбор · E — в базу знаний · F — избранное · A — архив',
  library: 'J/K — выбор · Enter — открыть · F — избранное · A — архив',
  favorites: 'J/K — выбор · Enter — открыть · F — избранное · A — архив',
  archive: 'J/K — выбор · Enter — открыть · E — вернуть · Del — удалить',
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
      icon="search-x"
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
      className="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-6 pixel:gap-2.5 pixel:px-2.5 pixel:pt-2.5 pixel:md:px-2.5"
    >
      <header className="flex flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <h1 className="font-heading text-lg font-semibold tracking-tight pixel:text-2xl pixel:tracking-normal">{title}</h1>
          {!loading && total > 0 && (
            <span className="text-2sm text-muted-foreground tabular-nums" aria-live="polite">
              {hits.length} из {total}
            </span>
          )}
          <span className="ml-auto hidden min-w-0 truncate text-2sm text-muted-foreground pixel:lg:pointer-fine:inline">
            {KEY_HINT[variant]}
          </span>
        </div>
        {subtitle && <p className="text-2sm text-muted-foreground">{subtitle}</p>}
      </header>

      <FilterBar />

      {loading ? null : (
        // ItemList остаётся смонтированным и при пустой выдаче: он закрывает детали ушедшей записи.
        <ItemList
          hits={hits}
          variant={variant}
          layout={layout}
          emptyState={hits.length === 0 ? (narrowed || total > 0 ? noResults : emptyState) : undefined}
        />
      )}
    </section>
  )
}
