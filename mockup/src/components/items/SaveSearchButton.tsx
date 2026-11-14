import { useState } from 'react'
import { Icon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useCategories, useSavedSearches } from '@/hooks/useItems'
import { actSaveCurrentSearch } from '@/lib/actions'
import { alreadySavedText, currentSearchQuery, findSavedByQuery, suggestSearchName } from '@/lib/savedSearch'
import { useUi } from '@/store/ui'
import { SAVED_SEARCH_NAME_MAX, type SavedSearch } from '@/types'

/**
 * Содержимое поповера. Монтируется при открытии, поэтому имя по умолчанию считается заново каждый раз.
 * Список поисков приходит пропсом: хук внутри формы на первом кадре отдаёт пустой список, и занятое имя не заметно.
 */
function SaveForm({ query, searches, onSaved }: { query: string; searches: SavedSearch[]; onSaved: () => void }) {
  const existing = findSavedByQuery(searches, query)
  const [name, setName] = useState(() => suggestSearchName(query, searches.map((s) => s.name)))
  const [busy, setBusy] = useState(false)

  async function save() {
    if (busy || existing || !name.trim()) return
    setBusy(true)
    try {
      // Ошибку показывает сам actSaveCurrentSearch (toast): поповер остаётся открытым.
      const saved = await actSaveCurrentSearch(name.trim())
      if (saved) onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="font-mono text-xs break-all text-muted-foreground">{query}</p>
      {existing ? (
        <>
          <p className="text-2sm">{alreadySavedText(existing.name)}</p>
          <Button size="sm" className="pointer-coarse:h-9" disabled>
            Сохранить
          </Button>
        </>
      ) : (
        <>
          <Input
            autoFocus
            value={name}
            maxLength={SAVED_SEARCH_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
              e.preventDefault()
              void save()
            }}
            aria-label="Название поиска"
            className="h-7 text-2sm pointer-coarse:h-9"
          />
          <Button size="sm" className="pointer-coarse:h-9" disabled={busy || !name.trim()} onClick={() => void save()}>
            Сохранить
          </Button>
        </>
      )}
    </>
  )
}

/** Кнопка строки активного отбора: сохраняет поиск, фильтры и раздел одной строкой запроса. */
export function SaveSearchButton() {
  const view = useUi((s) => s.view)
  const query = useUi((s) => s.query)
  const filter = useUi((s) => s.filter)
  const customDates = useUi((s) => s.customDates)
  const categories = useCategories()
  const searches = useSavedSearches()
  const [open, setOpen] = useState(false)

  const text = currentSearchQuery({ view, query, filter, customDates }, categories)
  if (!text) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="xs" className="shrink-0 text-muted-foreground pointer-coarse:h-9" />}
      >
        <Icon name="bookmark" />
        Сохранить поиск
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 gap-2 p-2">
        <SaveForm query={text} searches={searches} onSaved={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}
