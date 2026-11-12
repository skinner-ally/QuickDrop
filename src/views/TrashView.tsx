import { useMemo } from 'react'
import { Icon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/items/EmptyState'
import { ItemList } from '@/components/items/ItemList'
import { useSettings } from '@/db/settings'
import { useTrashCount, useVisibleItems } from '@/hooks/useItems'
import { actEmptyTrashAsk } from '@/lib/actions'
import { trashDaysLabel } from '@/lib/trash'
import { parseQuery, queryWords } from '@/search'
import { useUi } from '@/store/ui'
import { DEFAULT_SETTINGS } from '@/types'

const KEY_HINT = 'J/K — выбор · Enter — открыть · E — восстановить · Del — удалить навсегда'

/**
 * Раздел «Корзина»: без панели фильтров, только список; порядок — по дате удаления (новые сверху),
 * пока в строке поиска нет слов (со словами — по релевантности). SortMode не расширяется.
 */
export function TrashView() {
  const { hits, total, loading } = useVisibleItems({ trashed: true })
  const query = useUi((s) => s.query)
  const filter = useUi((s) => s.filter)
  const setQuery = useUi((s) => s.setQuery)
  const resetFilter = useUi((s) => s.resetFilter)
  const setView = useUi((s) => s.setView)
  const settings = useSettings()
  const trashDays = settings?.trashDays ?? DEFAULT_SETTINGS.trashDays
  const trashCount = useTrashCount()

  const hasWords = useMemo(() => queryWords(parseQuery(query).text).length > 0, [query])
  const ordered = useMemo(
    () => (hasWords ? hits : [...hits].sort((a, b) => (b.item.deletedAt ?? 0) - (a.item.deletedAt ?? 0))),
    [hits, hasWords],
  )

  const autoPurge = trashDays > 0
  const narrowed = query.trim() !== '' || Object.values(filter).some((v) => v !== undefined)

  const emptyState = (
    <EmptyState
      icon="trash"
      title="Корзина пуста"
      description={
        autoPurge
          ? `Удалённые записи лежат здесь ${trashDaysLabel(trashDays)}, затем удаляются окончательно.`
          : 'Удалённые записи лежат здесь, пока вы не очистите корзину.'
      }
    />
  )

  const noResults = (
    <EmptyState
      icon="search-x"
      title="Ничего не найдено"
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            // Панели фильтров в корзине нет — сбрасываем и их, чтобы не остаться с невидимым отбором.
            resetFilter()
            setQuery('')
          }}
        >
          Сбросить поиск
        </Button>
      }
    />
  )

  return (
    <section
      aria-label="Корзина"
      className="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-6 pixel:gap-2.5 pixel:px-2.5 pixel:pt-2.5 pixel:md:px-2.5"
    >
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <h1 className="font-heading text-lg font-semibold tracking-tight pixel:text-2xl pixel:tracking-normal">Корзина</h1>
            {!loading && total > 0 && (
              <span className="shrink-0 text-2sm whitespace-nowrap text-muted-foreground tabular-nums" aria-live="polite">
                {hits.length} из {total}
              </span>
            )}
            <span className="ml-auto hidden min-w-0 truncate text-2sm text-muted-foreground pixel:lg:pointer-fine:inline">
              {KEY_HINT}
            </span>
          </div>
          {/* Пока настройки не прочитаны, срок неизвестен — пояснение не показываем, чтобы не мигало. */}
          {settings && (
            <p className="flex flex-wrap items-baseline gap-x-2 text-2sm text-muted-foreground">
              <span>
                {autoPurge
                  ? `Записи удаляются окончательно через ${trashDaysLabel(trashDays)} после удаления`
                  : 'Автоочистка выключена'}
              </span>
              <button
                type="button"
                className="rounded-sm text-foreground underline underline-offset-2 outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:py-2.5"
                onClick={() => setView('settings')}
              >
                Изменить срок
              </button>
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 hover:text-destructive pointer-coarse:h-9"
          disabled={trashCount === 0}
          onClick={() => void actEmptyTrashAsk()}
        >
          <Icon name="trash" />
          Очистить корзину
        </Button>
      </header>

      {loading ? null : (
        // ItemList остаётся смонтированным и при пустой выдаче: он закрывает детали ушедшей записи.
        <ItemList
          hits={ordered}
          variant="trash"
          layout="list"
          emptyState={hits.length === 0 ? (narrowed || total > 0 ? noResults : emptyState) : undefined}
        />
      )}
    </section>
  )
}
