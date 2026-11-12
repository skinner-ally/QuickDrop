import { useMemo, useState, type ReactNode } from 'react'
import { matchKey } from '@/lib/keys'
import { Icon, usePixel, type IconName } from '@/components/icons'
import { useTheme } from '@/components/layout/ThemeProvider'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { CategoryDot } from '@/components/items/CategoryBadge'
import { createCategory } from '@/db/repo'
import { setSetting, useSettings } from '@/db/settings'
import { computeAllTags, useAllItems, useCategories, useCounts } from '@/hooks/useItems'
import { describeError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { useUi, type View } from '@/store/ui'
import { CATEGORY_COLORS, type Settings } from '@/types'

const TOP_TAGS = 12

// Порядок совпадает с клавишами 1–4 (useHotkeys.VIEW_BY_DIGIT).
const NAV_ITEMS: Array<{
  view: View
  label: string
  icon: IconName
  count: 'inbox' | 'library' | 'favorites' | 'archive'
}> = [
  { view: 'inbox', label: 'Входящие', icon: 'inbox', count: 'inbox' },
  { view: 'library', label: 'База знаний', icon: 'library', count: 'library' },
  { view: 'favorites', label: 'Избранное', icon: 'star', count: 'favorites' },
  { view: 'archive', label: 'Архив', icon: 'archive', count: 'archive' },
  // этап 5: { view: 'graph', label: 'Граф', icon: 'graph' } (клавиша 5)
  // этап 4: { view: 'trash', label: 'Корзина', icon: 'trash' } (последним, без цифры)
]

function NavButton({
  active,
  onClick,
  icon,
  label,
  count,
  accent,
}: {
  active?: boolean
  onClick: () => void
  icon: ReactNode
  label: string
  count?: number
  accent?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-2sm outline-none transition-colors',
        'px-nav pixel:h-7 pixel:px-1.5 pixel:max-md:h-9.5',
        'hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        active ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'text-sidebar-foreground/85',
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

function SectionHeader({
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

const THEME_CYCLE: Settings['theme'][] = ['system', 'light', 'dark']
const THEME_LABEL: Record<Settings['theme'], string> = {
  system: 'Системная тема',
  light: 'Светлая тема',
  dark: 'Тёмная тема',
}

function ThemeToggle() {
  const { setTheme } = useTheme()
  const current = useSettings()?.theme ?? 'system'
  const themeIcon: IconName = current === 'dark' ? 'moon' : current === 'light' ? 'sun' : 'monitor'
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length]
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="px-btn pixel:size-7.5 pixel:max-md:size-9"
      aria-label={`${THEME_LABEL[current]}. Переключить: ${THEME_LABEL[next].toLowerCase()}`}
      title={THEME_LABEL[current]}
      onClick={() => {
        setTheme(next)
        setSetting('theme', next).catch((e: unknown) => toast.error(describeError(e)))
      }}
    >
      <Icon name={themeIcon} />
    </Button>
  )
}

function NewCategory({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const categories = useCategories()

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return onDone()
    try {
      await createCategory(trimmed, CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length])
      onDone()
    } catch (e) {
      toast.error(describeError(e, 'Не удалось создать категорию'))
    }
  }

  return (
    <input
      autoFocus
      value={name}
      onChange={(e) => setName(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          void submit()
        } else if (matchKey(e, 'Escape', 'Escape')) {
          e.preventDefault()
          e.stopPropagation()
          onDone()
        }
      }}
      onBlur={() => void submit()}
      placeholder="Название категории"
      aria-label="Название новой категории"
      className="mx-1 my-0.5 h-7 w-[calc(100%-0.5rem)] px-field pixel:h-7.5 rounded-md border border-input bg-background px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 md:text-2sm"
    />
  )
}

export function Sidebar() {
  const view = useUi((s) => s.view)
  const filter = useUi((s) => s.filter)
  const setView = useUi((s) => s.setView)
  const setFilter = useUi((s) => s.setFilter)
  const resetFilter = useUi((s) => s.resetFilter)
  const openCapture = useUi((s) => s.openCapture)
  const pixel = usePixel()

  const counts = useCounts()
  const categories = useCategories()
  const items = useAllItems()

  const [catsOpen, setCatsOpen] = useState(true)
  const [tagsOpen, setTagsOpen] = useState(true)
  const [allTags, setAllTags] = useState(false)
  const [creating, setCreating] = useState(false)

  // Клик по категории/тегу открывает «Базу знаний», поэтому и считаем только её записи.
  const libraryItems = useMemo(() => (items ?? []).filter((it) => it.status === 'library'), [items])
  const tags = useMemo(() => computeAllTags(libraryItems), [libraryItems])

  const perCategory = useMemo(() => {
    const map = new Map<string | null, number>()
    for (const it of libraryItems) {
      map.set(it.categoryId, (map.get(it.categoryId) ?? 0) + 1)
    }
    return map
  }, [libraryItems])

  const go = (v: View) => setView(v)
  const inLibrary = view === 'library'
  const plainLibrary = inLibrary && filter.categoryId === undefined && !filter.tags?.length

  const toggleCategory = (id: string | null) => {
    if (inLibrary && filter.categoryId === id) {
      resetFilter()
      return
    }
    setView('library')
    setFilter({ categoryId: id })
  }

  const toggleTag = (tag: string) => {
    if (inLibrary && filter.tags?.length === 1 && filter.tags[0] === tag) {
      resetFilter()
      return
    }
    setView('library')
    setFilter({ tags: [tag] })
  }

  const shownTags = allTags ? tags : tags.slice(0, TOP_TAGS)

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar pt-[env(safe-area-inset-top)] text-sidebar-foreground pixel:gap-2.5 pixel:bg-transparent pixel:pt-0">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2 pixel:p-0">
        <span className="flex size-6 items-center justify-center rounded-md bg-brand text-brand-foreground pixel:hidden" aria-hidden>
          <svg
            viewBox="0 0 16 16"
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3.5 13.5h9" />
          </svg>
        </span>
        <Icon name="sprout" pixelSize={20} className="hidden pixel:block" />
        <span className="text-md font-semibold tracking-tight font-heading pixel:text-2xl pixel:tracking-normal">QuickDrop</span>
      </div>

      <div className="px-3 pb-2 pixel:p-0">
        <Button
          className="h-9 w-full justify-between bg-brand px-3 text-brand-foreground hover:bg-brand/90 pixel:h-9.5 pixel:justify-center pixel:gap-1.5"
          onClick={() => openCapture()}
        >
          <span className="flex items-center gap-1.5">
            <Icon name="plus" />
            Добавить
          </span>
          <Kbd tone="inherit">N</Kbd>
        </Button>
      </div>

      <nav aria-label="Основная навигация" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pixel:-m-1 pixel:p-1">
        <div className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <NavButton
              key={item.view}
              active={item.view === 'library' ? plainLibrary : view === item.view}
              onClick={() => go(item.view)}
              icon={<Icon name={item.icon} className="size-4" />}
              label={item.label}
              count={counts[item.count]}
              accent={item.view === 'inbox' && counts.inbox > 0}
            />
          ))}
        </div>

        <SectionHeader
          title="Категории"
          open={catsOpen}
          onToggle={() => setCatsOpen((o) => !o)}
          action={
            <Button
              variant="ghost"
              size="icon-xs"
              className="px-btn pixel:size-7.5 pixel:max-md:size-9"
              aria-label="Создать категорию"
              title="Создать категорию"
              onClick={() => {
                setCatsOpen(true)
                setCreating(true)
              }}
            >
              <Icon name="plus" />
            </Button>
          }
        />
        {catsOpen && (
          <div className="mt-0.5 flex flex-col gap-0.5">
            {categories.map((c) => (
              <NavButton
                key={c.id}
                active={inLibrary && filter.categoryId === c.id}
                onClick={() => toggleCategory(c.id)}
                icon={<CategoryDot color={c.color} className="size-2.5" />}
                label={c.name}
                count={perCategory.get(c.id) ?? 0}
              />
            ))}
            <NavButton
              active={inLibrary && filter.categoryId === null}
              onClick={() => toggleCategory(null)}
              icon={<span aria-hidden className="size-2.5 rounded-full border border-muted-foreground/50 px-sw pixel:bg-(--cat-none)" />}
              label="Без категории"
              count={perCategory.get(null) ?? 0}
            />
            {creating && <NewCategory onDone={() => setCreating(false)} />}
          </div>
        )}

        {tags.length > 0 && (
          <>
            <SectionHeader title="Теги" open={tagsOpen} onToggle={() => setTagsOpen((o) => !o)} />
            {tagsOpen && (
              <div className="mt-0.5 flex flex-col gap-0.5">
                {pixel ? (
                  <div className="flex flex-wrap gap-1">
                    {shownTags.map(({ tag, count }) => (
                      <button
                        key={tag}
                        type="button"
                        aria-pressed={inLibrary && filter.tags?.length === 1 && filter.tags[0] === tag}
                        title={`Записей: ${count}`}
                        onClick={() => toggleTag(tag)}
                        className="px-chip inline-flex min-h-6 items-center px-1.5 text-xs max-md:min-h-9 max-md:px-2"
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                ) : (
                  shownTags.map(({ tag, count }) => (
                    <NavButton
                      key={tag}
                      active={inLibrary && filter.tags?.length === 1 && filter.tags[0] === tag}
                      onClick={() => toggleTag(tag)}
                      icon={
                        <span aria-hidden className="text-muted-foreground">
                          #
                        </span>
                      }
                      label={tag}
                      count={count}
                    />
                  ))
                )}
                {tags.length > TOP_TAGS && (
                  <button
                    type="button"
                    onClick={() => setAllTags((v) => !v)}
                    className="h-7 rounded-md px-2 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                  >
                    {allTags ? 'Скрыть' : `Показать все (${tags.length})`}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </nav>

      <div className="flex items-center gap-1 border-t border-sidebar-border px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pixel:gap-1.5 pixel:border-t-0 pixel:p-0">
        <div className="min-w-0 flex-1">
          <NavButton
            active={view === 'settings'}
            onClick={() => go('settings')}
            icon={<Icon name="settings" className="size-4" />}
            label="Настройки"
          />
        </div>
        <ThemeToggle />
      </div>
    </div>
  )
}
