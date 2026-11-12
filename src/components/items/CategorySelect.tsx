import { useState } from 'react'
import { Icon } from '@/components/icons'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createCategory } from '@/db/repo'
import { useCategories } from '@/hooks/useItems'
import { describeError } from '@/lib/errors'
import { categoryNameKey } from '@/lib/normalize'
import { cn } from '@/lib/utils'
import { CategoryDot } from './CategoryBadge'

const NONE = '__none__'
const CREATE = '__create__'

export function CategorySelect({
  value,
  onChange,
  allowCreate,
  className,
  placeholder = 'Без категории',
}: {
  value: string | null
  onChange: (id: string | null) => void
  allowCreate?: boolean
  className?: string
  placeholder?: string
}) {
  const categories = useCategories()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const current = value ? categories.find((c) => c.id === value) : undefined

  const name = search.trim()
  const canCreate =
    !!allowCreate && name !== '' && !categories.some((c) => categoryNameKey(c.name) === categoryNameKey(name))

  function close(next: boolean) {
    setOpen(next)
    if (!next) setSearch('')
  }

  function choose(id: string | null) {
    onChange(id)
    close(false)
  }

  async function create() {
    try {
      const cat = await createCategory(name)
      choose(cat.id)
    } catch (e) {
      toast.error(describeError(e, 'Не удалось создать категорию'))
    }
  }

  return (
    <Popover open={open} onOpenChange={close}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Категория"
            className={cn('w-full justify-between font-normal', className)}
          />
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          {current ? (
            <>
              <CategoryDot color={current.color} />
              <span className="truncate">{current.name}</span>
            </>
          ) : (
            <span className="truncate text-muted-foreground">{placeholder}</span>
          )}
        </span>
        <Icon name="chevrons-up-down" size={14} className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-0">
        <Command>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder={allowCreate ? 'Найти или создать' : 'Найти категорию'}
            aria-label="Поиск категории"
          />
          <CommandList>
            <CommandEmpty>Ничего не найдено</CommandEmpty>
            <CommandGroup>
              <CommandItem value={NONE} keywords={['без категории']} onSelect={() => choose(null)}>
                <span className="text-muted-foreground">Без категории</span>
                {!value && <Icon name="check" size={14} className="ml-auto" />}
              </CommandItem>
              {categories.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`cat:${c.id}`}
                  keywords={[c.name]}
                  onSelect={() => choose(c.id)}
                >
                  <CategoryDot color={c.color} />
                  <span className="truncate">{c.name}</span>
                  {c.id === value && <Icon name="check" size={14} className="ml-auto" />}
                </CommandItem>
              ))}
              {canCreate && (
                <CommandItem value={CREATE} forceMount onSelect={() => void create()}>
                  <Icon name="plus" size={14} />
                  <span className="truncate">Создать «{name}»</span>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
