import { useMemo, useState, type ReactNode } from 'react'
import {
  Archive,
  Folder,
  Hash,
  Inbox,
  Library,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings as SettingsIcon,
  Star,
  Sun,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandInput,
  Command,
  CommandShortcut,
} from '@/components/ui/command'
import { CategoryDot } from '@/components/items/CategoryBadge'
import { TypeIcon } from '@/components/items/TypeIcon'
import { setSetting } from '@/db/settings'
import { useAllItems, useAllTags, useCategories } from '@/hooks/useItems'
import { displayTitle } from '@/lib/itemTitle'
import { fold, makeSnippet, searchItems } from '@/search'
import { useUi, type View } from '@/store/ui'
import type { Item, ItemStatus, Settings } from '@/types'

const MAX_HITS = 12
const MAX_RECENT = 6
const MAX_MATCHES = 5

const STATUS_LABEL: Record<ItemStatus, string> = {
  inbox: 'Входящие',
  library: 'База знаний',
  archive: 'Архив',
}

const STATUS_VIEW: Record<ItemStatus, View> = {
  inbox: 'inbox',
  library: 'library',
  archive: 'archive',
}

interface PaletteAction {
  id: string
  label: string
  icon: LucideIcon
  run: () => void
  shortcut?: string
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1 font-sans text-[11px] leading-4 text-muted-foreground">
      {children}
    </kbd>
  )
}

function ItemRow({ item, snippet, onSelect }: { item: Item; snippet: string; onSelect: () => void }) {
  return (
    <CommandItem value={`item-${item.id}`} onSelect={onSelect} className="items-start gap-2.5">
      <TypeIcon type={item.type} className="mt-0.5 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{displayTitle(item)}</span>
        {snippet && <span className="truncate text-xs text-muted-foreground">{snippet}</span>}
      </span>
      <span className="mt-0.5 shrink-0 text-xs text-muted-foreground">{STATUS_LABEL[item.status]}</span>
    </CommandItem>
  )
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen)
  const setPaletteOpen = useUi((s) => s.setPaletteOpen)
  const [input, setInput] = useState('')

  const items = useAllItems()
  const categories = useCategories()
  const allTags = useAllTags()

  const trimmed = input.trim()

  const close = () => {
    setPaletteOpen(false)
    setInput('')
  }

  const openItem = (item: Item) => {
    const ui = useUi.getState()
    // setView сбрасывает selectedId, поэтому select — строго после него.
    ui.setView(STATUS_VIEW[item.status])
    ui.select(item.id)
    close()
  }

  const setTheme = (theme: Settings['theme']) => {
    close()
    setSetting('theme', theme).catch((e: unknown) => toast.error(e instanceof Error ? e.message : String(e)))
  }

  const go = (view: View) => {
    useUi.getState().setView(view)
    close()
  }

  const actions = useMemo<PaletteAction[]>(
    () => [
      {
        id: 'new',
        label: 'Новая запись',
        icon: Plus,
        run: () => {
          close()
          useUi.getState().openCapture()
        },
      },
      { id: 'go-inbox', label: 'Перейти: Входящие', icon: Inbox, run: () => go('inbox') },
      { id: 'go-library', label: 'Перейти: База знаний', icon: Library, run: () => go('library') },
      { id: 'go-favorites', label: 'Перейти: Избранное', icon: Star, run: () => go('favorites') },
      { id: 'go-archive', label: 'Перейти: Архив', icon: Archive, run: () => go('archive') },
      { id: 'go-settings', label: 'Перейти: Настройки', icon: SettingsIcon, run: () => go('settings') },
      { id: 'theme-light', label: 'Тема: светлая', icon: Sun, run: () => setTheme('light') },
      { id: 'theme-dark', label: 'Тема: тёмная', icon: Moon, run: () => setTheme('dark') },
      { id: 'theme-system', label: 'Тема: как в системе', icon: Monitor, run: () => setTheme('system') },
    ],
    // close/go/setTheme зависят только от стабильных zustand-действий и setInput
    [],
  )

  const results = useMemo(() => {
    if (!items) return { hits: [] as Array<{ item: Item; snippet: string }>, recent: false }
    if (!trimmed) {
      const recent = items
        .filter((i) => i.status !== 'archive')
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, MAX_RECENT)
        .map((item) => ({ item, snippet: makeSnippet(item, [], 90) }))
      return { hits: recent, recent: true }
    }
    const hits = searchItems(items, trimmed, categories)
      .slice(0, MAX_HITS)
      .map((h) => ({ item: h.item, snippet: makeSnippet(h.item, h.terms, 90) }))
    return { hits, recent: false }
  }, [items, categories, trimmed])

  const needle = fold(trimmed)
  const shownActions = trimmed ? actions.filter((a) => fold(a.label).includes(needle)) : actions
  const matchedCategories = trimmed
    ? categories.filter((c) => fold(c.name).includes(needle)).slice(0, MAX_MATCHES)
    : []
  const matchedTags = trimmed
    ? allTags.filter((t) => fold(t.tag).includes(needle.replace(/^#/, ''))).slice(0, MAX_MATCHES)
    : []

  const toLibrary = (patch: Parameters<ReturnType<typeof useUi.getState>['setFilter']>[0], query = '') => {
    const ui = useUi.getState()
    ui.setView('library')
    ui.setQuery(query)
    ui.setFilter(patch)
    close()
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        setPaletteOpen(o)
        if (!o) setInput('')
      }}
      title="Палитра команд"
      description="Поиск записей и быстрые действия"
      className="sm:max-w-xl"
    >
      <Command shouldFilter={false} loop label="Палитра команд">
        <CommandInput
          value={input}
          onValueChange={setInput}
          placeholder="Найти запись или выполнить действие"
          aria-label="Поиск записей и действий"
        />
        <CommandList className="max-h-[min(24rem,60vh)]">
          {results.hits.length > 0 && (
            <CommandGroup heading={results.recent ? 'Недавние записи' : 'Записи'}>
              {results.hits.map(({ item, snippet }) => (
                <ItemRow key={item.id} item={item} snippet={snippet} onSelect={() => openItem(item)} />
              ))}
            </CommandGroup>
          )}

          {(shownActions.length > 0 || trimmed) && (
            <CommandGroup heading="Действия">
              {shownActions.map((a) => (
                <CommandItem key={a.id} value={`action-${a.id}`} onSelect={a.run}>
                  <a.icon strokeWidth={1.75} aria-hidden />
                  {a.label}
                  {a.shortcut && <CommandShortcut>{a.shortcut}</CommandShortcut>}
                </CommandItem>
              ))}
              {trimmed && (
                <CommandItem value="action-search-library" onSelect={() => toLibrary({}, trimmed)}>
                  <Search strokeWidth={1.75} aria-hidden />
                  <span className="truncate">Искать «{trimmed}» в базе знаний</span>
                </CommandItem>
              )}
            </CommandGroup>
          )}

          {matchedCategories.length > 0 && (
            <CommandGroup heading="Категории">
              {matchedCategories.map((c) => (
                <CommandItem key={c.id} value={`cat-${c.id}`} onSelect={() => toLibrary({ categoryId: c.id })}>
                  <Folder strokeWidth={1.75} aria-hidden />
                  <span className="truncate">{c.name}</span>
                  <CategoryDot color={c.color} className="ml-auto" />
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {matchedTags.length > 0 && (
            <CommandGroup heading="Теги">
              {matchedTags.map((t) => (
                <CommandItem key={t.tag} value={`tag-${t.tag}`} onSelect={() => toLibrary({ tags: [t.tag] })}>
                  <Hash strokeWidth={1.75} aria-hidden />
                  <span className="truncate">{t.tag}</span>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">{t.count}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          <CommandEmpty>Ничего не найдено</CommandEmpty>
        </CommandList>
        <div className="hidden items-center gap-3 border-t border-border px-3 py-1.5 text-xs text-muted-foreground sm:flex">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> выбрать
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Enter</Kbd> открыть
          </span>
          <span className="flex items-center gap-1">
            <Kbd>Esc</Kbd> закрыть
          </span>
        </div>
      </Command>
    </CommandDialog>
  )
}
