import { useMemo, useState, type ReactNode } from 'react'
import { Icon, type IconName } from '@/components/icons'
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
import { useScene } from '@/components/layout/ThemeProvider'
import { CategoryDot } from '@/components/items/CategoryBadge'
import { TypeIcon } from '@/components/items/TypeIcon'
import { setSetting } from '@/db/settings'
import { useAllItems, useAllTags, useCategories, useItemsWithTrash, useSavedSearches, useTrashCount } from '@/hooks/useItems'
import { actApplySearch, actEmptyTrashAsk, actSaveCurrentSearch, openItemInSection } from '@/lib/actions'
import { describeError } from '@/lib/errors'
import { displayTitle } from '@/lib/itemTitle'
import { isNarrowed } from '@/lib/savedSearch'
import { fold, makeSnippet, searchItems } from '@/search'
import { useUi, type View } from '@/store/ui'
import type { Item, ItemStatus, ScenePref, Settings } from '@/types'

const MAX_HITS = 12
const MAX_RECENT = 6
const MAX_MATCHES = 5

const STATUS_LABEL: Record<ItemStatus, string> = {
  inbox: 'Входящие',
  library: 'База знаний',
  archive: 'Архив',
}

interface PaletteAction {
  id: string
  label: string
  icon: IconName
  run: () => void
  shortcut?: string
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1 font-sans text-2xs leading-4 text-muted-foreground">
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
  const { setScene } = useScene()

  const items = useAllItems()
  // Индекс поиска синхронизируется с полным набором (с корзиной); выдача сужается через within
  const itemsWithTrash = useItemsWithTrash()
  const categories = useCategories()
  const allTags = useAllTags()
  const savedSearches = useSavedSearches()
  const trashCount = useTrashCount()
  const uiQuery = useUi((s) => s.query)
  const uiFilter = useUi((s) => s.filter)
  const canSaveSearch = isNarrowed(uiQuery, uiFilter)

  const trimmed = input.trim()

  const close = () => {
    setPaletteOpen(false)
    setInput('')
  }

  const openItem = (item: Item) => {
    openItemInSection(item)
    close()
  }

  const setTheme = (theme: Settings['theme']) => {
    close()
    setSetting('theme', theme).catch((e: unknown) => toast.error(describeError(e)))
  }

  const pickScene = (scene: ScenePref) => {
    close()
    setScene(scene)
    setSetting('scene', scene).catch((e: unknown) => toast.error(describeError(e)))
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
        icon: 'plus',
        run: () => {
          close()
          useUi.getState().openCapture()
        },
      },
      { id: 'go-inbox', label: 'Перейти: Входящие', icon: 'inbox', run: () => go('inbox') },
      { id: 'go-library', label: 'Перейти: База знаний', icon: 'library', run: () => go('library') },
      { id: 'go-favorites', label: 'Перейти: Избранное', icon: 'star', run: () => go('favorites') },
      { id: 'go-archive', label: 'Перейти: Архив', icon: 'archive', run: () => go('archive') },
      { id: 'go-trash', label: 'Перейти: Корзина', icon: 'trash', run: () => go('trash') },
      ...(trashCount > 0
        ? [
            {
              id: 'empty-trash',
              label: 'Очистить корзину',
              icon: 'trash' as const,
              run: () => {
                close()
                void actEmptyTrashAsk()
              },
            },
          ]
        : []),
      ...(canSaveSearch
        ? [
            {
              id: 'save-search',
              label: 'Сохранить текущий поиск',
              icon: 'bookmark' as const,
              run: () => {
                close()
                void actSaveCurrentSearch()
              },
            },
          ]
        : []),
      // Заглушка этапа 5: «Перейти: Граф» добавится здесь.
      { id: 'go-settings', label: 'Перейти: Настройки', icon: 'settings', run: () => go('settings') },
      { id: 'theme-light', label: 'Тема: светлая', icon: 'sun', run: () => setTheme('light') },
      { id: 'theme-dark', label: 'Тема: тёмная', icon: 'moon', run: () => setTheme('dark') },
      { id: 'theme-system', label: 'Тема: как в системе', icon: 'monitor', run: () => setTheme('system') },
      { id: 'scene-auto', label: 'Сцена: по календарю', icon: 'sprout', run: () => pickScene('auto') },
      { id: 'scene-meadow', label: 'Сцена: Луг', icon: 'sprout', run: () => pickScene('meadow') },
      { id: 'scene-autumn', label: 'Сцена: Осень', icon: 'sprout', run: () => pickScene('autumn') },
      { id: 'scene-paper', label: 'Сцена: Бумага', icon: 'sprout', run: () => pickScene('paper') },
      { id: 'scene-winter', label: 'Сцена: Зима', icon: 'sprout', run: () => pickScene('winter') },
      { id: 'scene-classic', label: 'Сцена: Классика', icon: 'sprout', run: () => pickScene('classic') },
    ],
    // close/go/setTheme зависят только от стабильных zustand-действий и setInput
    [setScene, trashCount, canSaveSearch],
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
    const hits = searchItems(itemsWithTrash ?? items, trimmed, categories, { within: items })
      .slice(0, MAX_HITS)
      .map((h) => ({ item: h.item, snippet: makeSnippet(h.item, h.terms, 90) }))
    return { hits, recent: false }
  }, [items, itemsWithTrash, categories, trimmed])

  const needle = fold(trimmed)
  const shownActions = trimmed ? actions.filter((a) => fold(a.label).includes(needle)) : actions
  const shownSearches = (trimmed ? savedSearches.filter((q) => fold(q.name).includes(needle)) : savedSearches).slice(
    0,
    trimmed ? MAX_HITS : 5,
  )
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
      <Command shouldFilter={false} loop label="Палитра команд" className="pixel:p-0">
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
                  <Icon name={a.icon} />
                  {a.label}
                  {a.shortcut && <CommandShortcut>{a.shortcut}</CommandShortcut>}
                </CommandItem>
              ))}
              {trimmed && (
                <CommandItem value="action-search-library" onSelect={() => toLibrary({}, trimmed)}>
                  <Icon name="search" />
                  <span className="truncate">Искать «{trimmed}» в базе знаний</span>
                </CommandItem>
              )}
            </CommandGroup>
          )}

          {shownSearches.length > 0 && (
            <CommandGroup heading="Поиски">
              {shownSearches.map((q) => (
                <CommandItem
                  key={q.id}
                  value={`search-${q.id}`}
                  onSelect={() => {
                    actApplySearch(q)
                    close()
                  }}
                >
                  <Icon name="bookmark" />
                  <span className="truncate">{q.name}</span>
                  <span className="ml-auto max-w-[50%] truncate text-xs text-muted-foreground">{q.query}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {matchedCategories.length > 0 && (
            <CommandGroup heading="Категории">
              {matchedCategories.map((c) => (
                <CommandItem key={c.id} value={`cat-${c.id}`} onSelect={() => toLibrary({ categoryId: c.id })}>
                  <Icon name="folder" />
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
                  <Icon name="hash" />
                  <span className="truncate">{t.tag}</span>
                  <span className="ml-auto text-xs text-muted-foreground tabular-nums">{t.count}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          <CommandEmpty>Ничего не найдено</CommandEmpty>
        </CommandList>
        <div className="hidden items-center gap-3 border-t border-border px-3 py-1.5 text-xs pixel:border-t-2 pixel:px-1 text-muted-foreground sm:flex">
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
