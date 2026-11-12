import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, type IconName } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CategoryDot } from '@/components/items/CategoryBadge'
import { SaveSearchButton } from '@/components/items/SaveSearchButton'
import { isUnfinishedDate } from '@/components/items/periodInput'
import { TypeIcon } from '@/components/items/TypeIcon'
import { useAllTags, useCategories, useDayKey, useLegendCounts } from '@/hooks/useItems'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { customDateRange, DATE_PRESETS, formatDateRange, formatDateToken, presetOf, relativeRange } from '@/lib/dates'
import { TYPE_LABEL_PLURAL } from '@/lib/itemTitle'
import { cn } from '@/lib/utils'
import { useGraph } from '@/store/graph'
import { useUi } from '@/store/ui'
import { ITEM_TYPES, type ItemType, type SortMode } from '@/types'
import { radioGroupKeyDown } from '@/views/settings/radioKeys'

const focusRing = 'outline-none focus-visible:ring-2 focus-visible:ring-ring/60'

const SORT_ITEMS: Array<{ value: SortMode; label: string }> = [
  { value: 'newest', label: 'Сначала новые' },
  { value: 'oldest', label: 'Сначала старые' },
  { value: 'updated', label: 'Недавно изменённые' },
  { value: 'title', label: 'По названию' },
]

const CAT_ALL = '__all'
const CAT_NONE = '__none'

function FilterButton({
  icon,
  label,
  active,
  ...props
}: { icon: IconName; label: string; active?: boolean } & React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn(
        'shrink-0 px-btn pixel:max-md:h-9 pixel:pointer-coarse:h-9',
        active && 'border-foreground/30 bg-muted',
      )}
      data-on={active ? 'true' : undefined}
      {...props}
    >
      <Icon name={icon} />
      {label}
    </Button>
  )
}

function TypeChips() {
  const types = useUi((s) => s.filter.types)
  const setFilter = useUi((s) => s.setFilter)

  const toggle = (t: ItemType) => {
    const cur = types ?? []
    const next = cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]
    setFilter({ types: next.length ? next : undefined })
  }

  return (
    <div role="group" aria-label="Тип записи" className="flex shrink-0 items-center gap-1">
      {ITEM_TYPES.map((t) => {
        const on = !!types?.includes(t)
        return (
          <button
            key={t}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(t)}
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-2sm pointer-coarse:h-9 transition-colors px-chip pixel:px-1.5',
              on
                ? 'border-foreground/30 bg-muted text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              focusRing,
            )}
          >
            <TypeIcon type={t} className="size-3.5" />
            {TYPE_LABEL_PLURAL[t]}
          </button>
        )
      })}
    </div>
  )
}

function CategoryFilter() {
  const categories = useCategories()
  const categoryId = useUi((s) => s.filter.categoryId)
  const setFilter = useUi((s) => s.setFilter)

  const value = categoryId === undefined ? CAT_ALL : categoryId === null ? CAT_NONE : categoryId
  const current = categories.find((c) => c.id === categoryId)
  const label =
    categoryId === undefined ? 'Категория' : categoryId === null ? 'Без категории' : (current?.name ?? 'Категория')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <FilterButton
            icon="folder"
            label={label}
            active={categoryId !== undefined}
            aria-label="Фильтр по категории"
          />
        }
      />
      <DropdownMenuContent className="w-56">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) =>
            setFilter({
              categoryId: v === CAT_ALL ? undefined : v === CAT_NONE ? null : (v as string),
            })
          }
        >
          <DropdownMenuRadioItem value={CAT_ALL}>Все категории</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value={CAT_NONE}>Без категории</DropdownMenuRadioItem>
          {categories.length > 0 && <DropdownMenuSeparator />}
          {categories.map((c) => (
            <DropdownMenuRadioItem key={c.id} value={c.id}>
              <CategoryDot color={c.color} />
              <span className="truncate">{c.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TagsFilter({ graph }: { graph: boolean }) {
  const listTags = useAllTags()
  const showArchive = useGraph((s) => s.showArchive)
  // В «Графе» числа те же, что у легенды боковой панели: по записям, из которых построена сцена.
  const legendTags = useLegendCounts(graph, showArchive).tags
  const allTags = graph ? legendTags : listTags
  const tags = useUi((s) => s.filter.tags)
  const setFilter = useUi((s) => s.setFilter)
  const [search, setSearch] = useState('')

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase().replace(/^#/, '')
    return q ? allTags.filter((t) => t.tag.includes(q)) : allTags
  }, [allTags, search])

  const toggle = (tag: string) => {
    const cur = tags ?? []
    const next = cur.includes(tag) ? cur.filter((x) => x !== tag) : [...cur, tag]
    setFilter({ tags: next.length ? next : undefined })
  }

  const count = tags?.length ?? 0
  return (
    <Popover onOpenChange={(open) => !open && setSearch('')}>
      <PopoverTrigger
        render={
          <FilterButton
            icon="tag"
            label={count ? `Теги: ${count}` : 'Теги'}
            active={count > 0}
            aria-label="Фильтр по тегам"
          />
        }
      />
      <PopoverContent align="start" className="w-64 gap-2 p-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Найти тег"
          aria-label="Найти тег"
          className="h-7 text-2sm pointer-coarse:h-9"
        />
        <div className="max-h-64 overflow-y-auto" role="group" aria-label="Теги">
          {shown.length === 0 ? (
            <p className="px-1.5 py-3 text-center text-2sm text-muted-foreground">
              {allTags.length === 0 ? 'Тегов пока нет' : 'Тег не найден'}
            </p>
          ) : (
            shown.map(({ tag, count: n }) => (
              <label
                key={tag}
                className="flex cursor-default items-center gap-2 rounded-md px-1.5 py-1 text-2sm hover:bg-muted px-nav"
              >
                <Checkbox checked={!!tags?.includes(tag)} onCheckedChange={() => toggle(tag)} />
                <span className="min-w-0 flex-1 truncate">#{tag}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{n}</span>
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Подпись периода: быстрый вариант — его именем, свой период — датами; null — период не задан. */
function periodLabel(from: number | undefined, to: number | undefined, custom: boolean): string | null {
  if (from === undefined && to === undefined) return null
  const preset = custom ? null : presetOf(from, to, Date.now())
  if (preset) return DATE_PRESETS.find((p) => p.id === preset)?.label ?? null
  return formatDateRange(from, to) || null
}

const dateField = (ts: number | undefined, custom: boolean) => (custom && ts !== undefined ? formatDateToken(ts) : '')

function PeriodFilter() {
  const from = useUi((s) => s.filter.from)
  const to = useUi((s) => s.filter.to)
  const customDates = useUi((s) => s.customDates)
  const setDateRange = useUi((s) => s.setDateRange)

  const [a, setA] = useState(() => dateField(from, customDates))
  const [b, setB] = useState(() => dateField(to, customDates))
  const [error, setError] = useState<string | null>(null)
  // Поля следуют за фильтром (быстрый период, чип «Период», сброс): пересчёт при смене значения, а не в эффекте.
  const syncKey = `${from ?? ''}|${to ?? ''}|${customDates}`
  const [seenKey, setSeenKey] = useState(syncKey)
  if (seenKey !== syncKey) {
    setSeenKey(syncKey)
    setA(dateField(from, customDates))
    setB(dateField(to, customDates))
    setError(null)
  }

  const hasDates = from !== undefined || to !== undefined
  const preset = !customDates ? presetOf(from, to, Date.now()) : null
  const label = periodLabel(from, to, customDates)

  const edit = (nextA: string, nextB: string) => {
    setA(nextA)
    setB(nextB)
    // Год ещё набирают: не ругаемся и не трогаем фильтр.
    if (isUnfinishedDate(nextA) || isUnfinishedDate(nextB)) {
      setError(null)
      return
    }
    const r = customDateRange(nextA, nextB)
    if (!r.ok) {
      setError(r.error)
      return
    }
    setError(null)
    if (r.range === null) setDateRange(null)
    else setDateRange(r.range, true)
  }

  const options: Array<{
    id: string
    label: string
    checked: boolean
    apply: () => void
  }> = [
    {
      id: 'all',
      label: 'Всё время',
      checked: !hasDates,
      apply: () => setDateRange(null),
    },
    ...DATE_PRESETS.map((p) => ({
      id: p.id,
      label: p.label,
      checked: preset === p.id,
      apply: () => setDateRange(relativeRange(p.id, Date.now())),
    })),
  ]
  const tabbable = options.some((o) => o.checked) ? options.findIndex((o) => o.checked) : 0

  // При открытии поля сверяются с фильтром: неприменённый ввод и старая ошибка не переживают закрытие.
  const resync = (open: boolean) => {
    if (!open) return
    setA(dateField(from, customDates))
    setB(dateField(to, customDates))
    setError(null)
  }

  return (
    <Popover onOpenChange={resync}>
      <PopoverTrigger
        render={
          <FilterButton icon="calendar" label={label ?? 'Период'} active={hasDates} aria-label="Фильтр по периоду" />
        }
      />
      <PopoverContent align="start" className="w-64 gap-2 p-2">
        <div role="radiogroup" aria-label="Период" onKeyDown={radioGroupKeyDown} className="flex flex-col">
          {options.map((o, i) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={o.checked}
              data-on={o.checked ? 'true' : undefined}
              tabIndex={i === tabbable ? 0 : -1}
              onClick={o.apply}
              className={cn(
                'flex w-full cursor-default items-center gap-2 rounded-md px-1.5 py-1 text-left text-2sm hover:bg-muted px-nav pointer-coarse:min-h-9',
                o.checked && 'font-medium',
                focusRing,
              )}
            >
              <span className="flex size-3.5 shrink-0 items-center justify-center">
                {o.checked && <Icon name="check" size={14} />}
              </span>
              {o.label}
            </button>
          ))}
        </div>
        <div aria-hidden className="h-px bg-border pixel:h-0.5" />
        <div className="flex flex-col gap-1.5">
          <p className="px-1.5 text-xs text-muted-foreground">Свой период</p>
          <div className="flex items-center gap-2">
            <span aria-hidden className="w-5 shrink-0 text-right text-xs text-muted-foreground">
              С
            </span>
            <Input
              type="date"
              min="1970-01-01"
              max="2999-12-31"
              value={a}
              onChange={(e) => edit(e.target.value, b)}
              aria-label="С даты"
              aria-invalid={error ? true : undefined}
              className="h-7 min-w-0 flex-1 text-2sm pointer-coarse:h-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <span aria-hidden className="w-5 shrink-0 text-right text-xs text-muted-foreground">
              По
            </span>
            <Input
              type="date"
              min="1970-01-01"
              max="2999-12-31"
              value={b}
              onChange={(e) => edit(a, e.target.value)}
              aria-label="По дату"
              aria-invalid={error ? true : undefined}
              className="h-7 min-w-0 flex-1 text-2sm pointer-coarse:h-9"
            />
          </div>
          {error && (
            <p role="alert" className="px-1.5 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ActiveChip({
  label,
  onRemove,
  children,
}: {
  label: string
  onRemove: () => void
  children?: React.ReactNode
}) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-muted pr-0.5 pl-2 text-xs text-foreground px-chip pixel:h-auto pixel:min-h-6">
      {children}
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Убрать фильтр: ${label}`}
        className={cn(
          'flex size-5 items-center justify-center rounded pointer-coarse:size-8 text-muted-foreground transition-colors hover:text-foreground',
          focusRing,
        )}
      >
        <Icon name="x" size={12} />
      </button>
    </span>
  )
}

/**
 * mode: 'list' — списки (сортировка и вид справа); 'graph' — экран графа: сортировки и вида нет, остальное то же.
 */
export function FilterBar({ className, mode = 'list' }: { className?: string; mode?: 'list' | 'graph' }) {
  const filter = useUi((s) => s.filter)
  const sort = useUi((s) => s.sort)
  const layout = useUi((s) => s.layout)
  const query = useUi((s) => s.query)
  const customDates = useUi((s) => s.customDates)
  const setFilter = useUi((s) => s.setFilter)
  const setDateRange = useUi((s) => s.setDateRange)
  const resetFilter = useUi((s) => s.resetFilter)
  const setSort = useUi((s) => s.setSort)
  const setLayout = useUi((s) => s.setLayout)
  const categories = useCategories()
  const isDesktop = useIsDesktop()

  // Быстрый период («Сегодня», «За неделю») после полуночи переезжает на новые сутки.
  const dayKey = useDayKey()
  const seenDay = useRef(dayKey)
  useEffect(() => {
    if (seenDay.current === dayKey) return
    useUi.getState().rollDatePreset(seenDay.current, dayKey)
    seenDay.current = dayKey
  }, [dayKey])

  const period = periodLabel(filter.from, filter.to, customDates)
  const cat = categories.find((c) => c.id === filter.categoryId)
  const hasActive =
    !!filter.types?.length ||
    filter.categoryId !== undefined ||
    !!filter.tags?.length ||
    !!filter.untagged ||
    filter.from !== undefined ||
    filter.to !== undefined

  const showSort = mode === 'list'
  const sortBlock = (
    <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2 md:ml-0">
      <Select value={sort} onValueChange={(v) => v && setSort(v as SortMode)} items={SORT_ITEMS}>
        <SelectTrigger size="sm" aria-label="Сортировка" className="text-2sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} align="end" className="min-w-44">
          {SORT_ITEMS.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div
        role="group"
        aria-label="Вид списка"
        className="flex rounded-lg border border-border p-0.5 dark:border-input pixel:gap-1 pixel:border-0 pixel:p-0"
      >
        {(
          [
            ['list', 'list', 'Список'],
            ['grid', 'grid', 'Карточки'],
          ] as const
        ).map(([mode, icon, label]) => (
          <button
            key={mode}
            type="button"
            aria-label={label}
            aria-pressed={layout === mode}
            onClick={() => setLayout(mode)}
            className={cn(
              'flex size-6 items-center justify-center rounded-md transition-colors pointer-coarse:size-9 px-btn pixel:size-7.5 pixel:max-md:size-9 pixel:pointer-coarse:size-9',
              layout === mode ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
              focusRing,
            )}
          >
            <Icon name={icon} size={14} />
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center gap-1.5">
        <div className="no-scrollbar min-w-0 flex-1 -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0 pixel:-mx-2.5 pixel:-my-1 pixel:px-2.5 pixel:py-1 pixel:md:-mx-1 pixel:md:px-1">
          <TypeChips />
          <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border pixel:w-0.5" />
          <CategoryFilter />
          <TagsFilter graph={mode === 'graph'} />
          <button
            type="button"
            aria-pressed={!!filter.untagged}
            onClick={() => setFilter({ untagged: filter.untagged ? undefined : true })}
            className={cn(
              'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-2sm pointer-coarse:h-9 transition-colors px-chip',
              filter.untagged
                ? 'border-foreground/30 bg-muted text-foreground'
                : 'border-border text-foreground hover:bg-muted dark:border-input',
              focusRing,
            )}
          >
            {filter.untagged && <Icon name="check" size={14} />}
            Без тегов и категории
          </button>
          <PeriodFilter />
          {showSort && !isDesktop && sortBlock}
        </div>
        {showSort && isDesktop && sortBlock}
      </div>

      {(hasActive || query.trim() !== '') && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Активные фильтры">
          {filter.types?.map((t) => (
            <ActiveChip
              key={t}
              label={TYPE_LABEL_PLURAL[t]}
              onRemove={() => {
                const next = (filter.types ?? []).filter((x) => x !== t)
                setFilter({ types: next.length ? next : undefined })
              }}
            />
          ))}
          {filter.categoryId !== undefined && (
            <ActiveChip
              label={filter.categoryId === null ? 'Без категории' : (cat?.name ?? 'Категория')}
              onRemove={() => setFilter({ categoryId: undefined })}
            >
              {cat && <CategoryDot color={cat.color} />}
            </ActiveChip>
          )}
          {filter.tags?.map((tag) => (
            <ActiveChip
              key={tag}
              label={`#${tag}`}
              onRemove={() => {
                const next = (filter.tags ?? []).filter((x) => x !== tag)
                setFilter({ tags: next.length ? next : undefined })
              }}
            />
          ))}
          {filter.untagged && (
            <ActiveChip label="Без тегов и категории" onRemove={() => setFilter({ untagged: undefined })} />
          )}
          {period && <ActiveChip label={`Период: ${period}`} onRemove={() => setDateRange(null)} />}
          <SaveSearchButton />
          {hasActive && (
            <Button variant="ghost" size="xs" onClick={resetFilter} className="text-muted-foreground">
              Сбросить фильтры
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
