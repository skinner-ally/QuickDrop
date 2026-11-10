import { useMemo, useState } from 'react'
import {
  CalendarDays,
  Check,
  Folder,
  LayoutGrid,
  List,
  Tag,
  X,
  type LucideIcon,
} from 'lucide-react'
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
import { TypeIcon } from '@/components/items/TypeIcon'
import { useAllTags, useCategories } from '@/hooks/useItems'
import { TYPE_LABEL_PLURAL } from '@/lib/itemTitle'
import { cn } from '@/lib/utils'
import { useUi } from '@/store/ui'
import { ITEM_TYPES, type ItemType, type SortMode } from '@/types'

const focusRing = 'outline-none focus-visible:ring-2 focus-visible:ring-ring/60'

const SORT_ITEMS: Array<{ value: SortMode; label: string }> = [
  { value: 'newest', label: 'Сначала новые' },
  { value: 'oldest', label: 'Сначала старые' },
  { value: 'updated', label: 'Недавно изменённые' },
  { value: 'title', label: 'По названию' },
]

type PeriodKey = 'all' | 'today' | '7d' | '30d'
const PERIODS: Array<{ key: PeriodKey; label: string; days: number | null }> = [
  { key: 'all', label: 'Всё время', days: null },
  { key: 'today', label: 'Сегодня', days: 0 },
  { key: '7d', label: '7 дней', days: 6 },
  { key: '30d', label: '30 дней', days: 29 },
]

/** Начало дня за `daysBack` дней до сегодняшнего. */
function periodStart(daysBack: number): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - daysBack)
  return d.getTime()
}

function currentPeriod(from: number | undefined): PeriodKey | undefined {
  if (from === undefined) return 'all'
  return PERIODS.find((p) => p.days !== null && periodStart(p.days) === from)?.key
}

const CAT_ALL = '__all'
const CAT_NONE = '__none'

function FilterButton({
  icon: Icon,
  label,
  active,
  ...props
}: { icon: LucideIcon; label: string; active?: boolean } & React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn('shrink-0', active && 'border-foreground/30 bg-muted')}
      {...props}
    >
      <Icon strokeWidth={1.75} aria-hidden />
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
              'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[13px] pointer-coarse:h-9 transition-colors',
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
          <FilterButton icon={Folder} label={label} active={categoryId !== undefined} aria-label="Фильтр по категории" />
        }
      />
      <DropdownMenuContent className="w-56">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) =>
            setFilter({ categoryId: v === CAT_ALL ? undefined : v === CAT_NONE ? null : (v as string) })
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

function TagsFilter() {
  const allTags = useAllTags()
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
            icon={Tag}
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
          className="h-7 text-[13px] pointer-coarse:h-9"
        />
        <div className="max-h-64 overflow-y-auto" role="group" aria-label="Теги">
          {shown.length === 0 ? (
            <p className="px-1.5 py-3 text-center text-[13px] text-muted-foreground">
              {allTags.length === 0 ? 'Тегов пока нет' : 'Тег не найден'}
            </p>
          ) : (
            shown.map(({ tag, count: n }) => (
              <label
                key={tag}
                className="flex cursor-default items-center gap-2 rounded-md px-1.5 py-1 text-[13px] hover:bg-muted"
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

function PeriodFilter() {
  const from = useUi((s) => s.filter.from)
  const setFilter = useUi((s) => s.setFilter)
  const key = currentPeriod(from)
  const label = PERIODS.find((p) => p.key === key)?.label
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <FilterButton
            icon={CalendarDays}
            label={key && key !== 'all' ? (label ?? 'Период') : 'Период'}
            active={from !== undefined}
            aria-label="Фильтр по периоду"
          />
        }
      />
      <DropdownMenuContent className="w-44">
        <DropdownMenuRadioGroup
          value={key ?? ''}
          onValueChange={(v) => {
            const p = PERIODS.find((x) => x.key === v)
            if (p) setFilter({ from: p.days === null ? undefined : periodStart(p.days) })
          }}
        >
          {PERIODS.map((p) => (
            <DropdownMenuRadioItem key={p.key} value={p.key}>
              {p.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-muted pr-0.5 pl-2 text-xs text-foreground">
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
        <X size={12} strokeWidth={1.75} aria-hidden />
      </button>
    </span>
  )
}

export function FilterBar({ className }: { className?: string }) {
  const filter = useUi((s) => s.filter)
  const sort = useUi((s) => s.sort)
  const layout = useUi((s) => s.layout)
  const setFilter = useUi((s) => s.setFilter)
  const resetFilter = useUi((s) => s.resetFilter)
  const setSort = useUi((s) => s.setSort)
  const setLayout = useUi((s) => s.setLayout)
  const categories = useCategories()

  const period = currentPeriod(filter.from)
  const cat = categories.find((c) => c.id === filter.categoryId)
  const hasActive =
    !!filter.types?.length ||
    filter.categoryId !== undefined ||
    !!filter.tags?.length ||
    !!filter.untagged ||
    filter.from !== undefined ||
    filter.to !== undefined

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="no-scrollbar -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0">
        <TypeChips />
        <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border" />
        <CategoryFilter />
        <TagsFilter />
        <button
          type="button"
          aria-pressed={!!filter.untagged}
          onClick={() => setFilter({ untagged: filter.untagged ? undefined : true })}
          className={cn(
            'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] pointer-coarse:h-9 transition-colors',
            filter.untagged
              ? 'border-foreground/30 bg-muted text-foreground'
              : 'border-border text-foreground hover:bg-muted dark:border-input',
            focusRing,
          )}
        >
          {filter.untagged && <Check size={14} strokeWidth={1.75} aria-hidden />}
          Без тегов и категории
        </button>
        <PeriodFilter />
        <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
          <Select value={sort} onValueChange={(v) => v && setSort(v as SortMode)} items={SORT_ITEMS}>
            <SelectTrigger size="sm" aria-label="Сортировка" className="text-[13px]">
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
            className="flex rounded-lg border border-border p-0.5 dark:border-input"
          >
            {(
              [
                ['list', List, 'Список'],
                ['grid', LayoutGrid, 'Карточки'],
              ] as const
            ).map(([mode, Icon, label]) => (
              <button
                key={mode}
                type="button"
                aria-label={label}
                aria-pressed={layout === mode}
                onClick={() => setLayout(mode)}
                className={cn(
                  'flex size-6 items-center justify-center rounded-md transition-colors pointer-coarse:size-9',
                  layout === mode ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                  focusRing,
                )}
              >
                <Icon size={14} strokeWidth={1.75} aria-hidden />
              </button>
            ))}
          </div>
        </div>
      </div>

      {hasActive && (
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
          {filter.from !== undefined && (
            <ActiveChip
              label={PERIODS.find((p) => p.key === period)?.label ?? 'Свой период'}
              onRemove={() => setFilter({ from: undefined })}
            />
          )}
          {filter.to !== undefined && <ActiveChip label="До даты" onRemove={() => setFilter({ to: undefined })} />}
          <Button variant="ghost" size="xs" onClick={resetFilter} className="text-muted-foreground">
            Сбросить фильтры
          </Button>
        </div>
      )}
    </div>
  )
}
