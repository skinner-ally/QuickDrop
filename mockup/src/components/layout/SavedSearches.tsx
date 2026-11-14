import { useState } from 'react'
import { Icon } from '@/components/icons'
import { NavButton, SectionHeader } from '@/components/layout/NavButton'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSavedSearches } from '@/hooks/useItems'
import { actApplySearch, actDeleteSearch, actMoveSearch, actRenameSearch } from '@/lib/actions'
import { matchKey } from '@/lib/keys'
import { isSavedSearchActive } from '@/lib/savedSearch'
import { cn } from '@/lib/utils'
import { useUi } from '@/store/ui'
import { SAVED_SEARCH_NAME_MAX, type SavedSearch } from '@/types'

/** Поле переименования на месте строки (образец — NewCategory в Sidebar). */
function RenameField({ search, onDone }: { search: SavedSearch; onDone: () => void }) {
  const [name, setName] = useState(search.name)
  // Enter и Esc завершают работу сами; blur после них не должен отправлять второй раз.
  const [finished, setFinished] = useState(false)

  const submit = async () => {
    if (finished) return
    const trimmed = name.trim()
    if (!trimmed || trimmed === search.name) {
      setFinished(true)
      onDone()
      return
    }
    setFinished(true)
    if (await actRenameSearch(search.id, trimmed)) {
      onDone()
    } else {
      // Ошибка (например, имя занято): поле остаётся, toast уже показан.
      setFinished(false)
    }
  }

  return (
    <input
      autoFocus
      value={name}
      maxLength={SAVED_SEARCH_NAME_MAX}
      onChange={(e) => setName(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          void submit()
        } else if (matchKey(e, 'Escape', 'Escape')) {
          e.preventDefault()
          e.stopPropagation()
          setFinished(true)
          onDone()
        }
      }}
      onBlur={() => void submit()}
      aria-label="Название поиска"
      className="mx-1 my-0.5 h-7 w-[calc(100%-0.5rem)] px-field pixel:h-7.5 rounded-md border border-input bg-background px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 md:text-2sm"
    />
  )
}

function SearchRow({
  search,
  index,
  total,
  active,
  renaming,
  onRename,
  onRenameDone,
}: {
  search: SavedSearch
  index: number
  total: number
  active: boolean
  renaming: boolean
  onRename: () => void
  onRenameDone: () => void
}) {
  if (renaming) return <RenameField search={search} onDone={onRenameDone} />
  return (
    <div className="group/ss relative flex items-center">
      <NavButton
        active={active}
        onClick={() => actApplySearch(search)}
        icon={<Icon name="bookmark" className="size-4" />}
        label={search.name}
        title={search.query}
        // Место под кнопку «…»; в пиксельных сценах отдельно — pixel:px-1.5 у NavButton специфичнее pr-*.
        className="pr-8 pointer-coarse:pr-10 pixel:pr-9 pixel:max-md:pr-10"
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Действия с поиском «${search.name}»`}
              className={cn(
                'absolute right-0.5 px-btn pixel:size-7.5 pixel:max-md:size-9 pointer-coarse:size-9',
                'pointer-fine:opacity-0 pointer-fine:group-hover/ss:opacity-100 pointer-fine:group-focus-within/ss:opacity-100 pointer-fine:focus-visible:opacity-100 aria-expanded:opacity-100',
              )}
            />
          }
        >
          <Icon name="more" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onClick={onRename}>
            <Icon name="pencil" />
            Переименовать
          </DropdownMenuItem>
          <DropdownMenuItem disabled={index === 0} onClick={() => void actMoveSearch(search.id, -1)}>
            <Icon name="arrow-up" />
            Выше
          </DropdownMenuItem>
          <DropdownMenuItem disabled={index === total - 1} onClick={() => void actMoveSearch(search.id, 1)}>
            <Icon name="arrow-down" />
            Ниже
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => void actDeleteSearch(search)}>
            <Icon name="trash" />
            Удалить
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function SavedSearches() {
  const searches = useSavedSearches()
  const query = useUi((s) => s.query)
  const filter = useUi((s) => s.filter)
  const view = useUi((s) => s.view)
  const [open, setOpen] = useState(true)
  const [renamingId, setRenamingId] = useState<string | null>(null)

  if (searches.length === 0) return null

  return (
    <>
      <SectionHeader title="Поиски" open={open} onToggle={() => setOpen((o) => !o)} />
      {open && (
        <div className="mt-0.5 flex flex-col gap-0.5">
          {searches.map((s, i) => (
            <SearchRow
              key={s.id}
              search={s}
              index={i}
              total={searches.length}
              active={isSavedSearchActive(s, { view, query, filter })}
              renaming={renamingId === s.id}
              onRename={() => setRenamingId(s.id)}
              onRenameDone={() => setRenamingId(null)}
            />
          ))}
        </div>
      )}
    </>
  )
}
