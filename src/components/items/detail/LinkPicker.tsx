import { useMemo, useState } from 'react'
import { Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { TypeIcon } from '@/components/items/TypeIcon'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { linkItems } from '@/db/repo'
import { useAllItems, useCategories } from '@/hooks/useItems'
import { displayTitle } from '@/lib/itemTitle'
import { searchItems } from '@/search'
import type { Item } from '@/types'

const LIMIT = 8

/** Поповер выбора записи для связи: поиск, при пустом запросе — недавние. */
export function LinkPicker({ item }: { item: Item }) {
  const all = useAllItems()
  const categories = useCategories()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const candidates = useMemo(() => {
    if (!open) return []
    const skip = new Set([item.id, ...item.links])
    const pool = (all ?? []).filter((i) => !skip.has(i.id))
    if (!query.trim()) return [...pool].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, LIMIT)
    return searchItems(pool, query, categories)
      .slice(0, LIMIT)
      .map((h) => h.item)
  }, [open, all, categories, item.id, item.links, query])

  async function pick(other: Item) {
    setOpen(false)
    setQuery('')
    try {
      await linkItems(item.id, other.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось связать записи')
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setQuery('')
      }}
    >
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <Link2 strokeWidth={1.75} className="size-4" aria-hidden />
        Связать…
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] gap-0 p-0">
        <Command shouldFilter={false} className="p-0">
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Найти запись"
            aria-label="Поиск записи для связи"
          />
          <CommandList>
            <CommandEmpty>Ничего не найдено</CommandEmpty>
            <CommandGroup heading={query.trim() ? undefined : 'Недавние'}>
              {candidates.map((c) => (
                <CommandItem key={c.id} value={c.id} onSelect={() => void pick(c)}>
                  <TypeIcon type={c.type} className="text-muted-foreground" />
                  <span className="truncate">{displayTitle(c)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
