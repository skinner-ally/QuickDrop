import { useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createCategory, deleteCategory, updateCategory } from '@/db/repo'
import { useAllItems, useCategories } from '@/hooks/useItems'
import { describeError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { CATEGORY_COLORS, type Category, type CategoryColor } from '@/types'
import { radioGroupKeyDown } from './radioKeys'
import { Section } from './Section'

const COLOR_LABEL: Record<CategoryColor, string> = {
  slate: 'Серый',
  red: 'Красный',
  orange: 'Оранжевый',
  amber: 'Янтарный',
  green: 'Зелёный',
  teal: 'Бирюзовый',
  blue: 'Синий',
  violet: 'Фиолетовый',
  pink: 'Розовый',
}

const fail = (e: unknown) => toast.error(describeError(e))

function ColorPicker({
  value,
  onChange,
  label,
}: {
  value: CategoryColor
  onChange: (c: CategoryColor) => void
  label: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`${label}: ${COLOR_LABEL[value]}`}
        className="flex size-7 shrink-0 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="size-3.5 rounded-full" style={{ background: `var(--cat-${value})` }} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto">
        <div role="radiogroup" aria-label="Цвет" onKeyDown={radioGroupKeyDown} className="grid grid-cols-5 gap-1.5">
          {CATEGORY_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === value}
              tabIndex={c === value ? 0 : -1}
              aria-label={COLOR_LABEL[c]}
              title={COLOR_LABEL[c]}
              onClick={() => {
                onChange(c)
                setOpen(false)
              }}
              className={cn(
                'flex size-7 items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                c === value && 'ring-2 ring-foreground/60',
              )}
            >
              <span className="size-5 rounded-full" style={{ background: `var(--cat-${c})` }} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function NameInput({ category }: { category: Category }) {
  const [draft, setDraft] = useState(category.name)
  const [prev, setPrev] = useState(category.name)
  if (prev !== category.name) {
    setPrev(category.name)
    setDraft(category.name)
  }
  const cancelled = useRef(false)
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false
      setDraft(category.name)
      return
    }
    const v = draft.trim()
    if (!v || v === category.name) {
      setDraft(category.name)
      return
    }
    updateCategory(category.id, { name: v }).catch((e) => {
      setDraft(category.name)
      fail(e)
    })
  }
  return (
    <Input
      value={draft}
      aria-label={`Название категории «${category.name}»`}
      maxLength={40}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          cancelled.current = true
          e.currentTarget.blur()
        }
      }}
      className="h-7 border-transparent bg-transparent px-1.5 hover:border-input dark:bg-transparent"
    />
  )
}

export function CategoriesSection() {
  const categories = useCategories()
  const items = useAllItems()
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState<CategoryColor | null>(null)
  const [toDelete, setToDelete] = useState<Category | null>(null)

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const it of items ?? []) if (it.categoryId) m.set(it.categoryId, (m.get(it.categoryId) ?? 0) + 1)
    return m
  }, [items])

  const move = async (index: number, dir: -1 | 1) => {
    const a = categories[index]
    const b = categories[index + dir]
    if (!a || !b) return
    try {
      if (a.order !== b.order) {
        await updateCategory(a.id, { order: b.order })
        await updateCategory(b.id, { order: a.order })
      } else {
        // Одинаковый order: сдвигаем перемещаемую на полшага за соседа.
        await updateCategory(a.id, { order: b.order + dir * 0.5 })
      }
    } catch (e) {
      fail(e)
    }
  }

  const color = newColor ?? CATEGORY_COLORS[categories.length % CATEGORY_COLORS.length]

  const add = async () => {
    const name = newName.trim()
    if (!name) return
    try {
      await createCategory(name, color)
      setNewName('')
      setNewColor(null)
    } catch (e) {
      fail(e)
    }
  }

  const confirmDelete = async () => {
    if (!toDelete) return
    try {
      await deleteCategory(toDelete.id)
      setToDelete(null)
    } catch (e) {
      fail(e)
    }
  }

  return (
    <Section id="categories" title="Категории" description="Цвет, название и порядок. Изменения применяются сразу.">
      {categories.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Категорий пока нет.</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {categories.map((c, i) => (
            <li key={c.id} className="flex items-center gap-1 px-1.5 py-1">
              <ColorPicker
                value={c.color}
                label={`Цвет категории «${c.name}»`}
                onChange={(col) => updateCategory(c.id, { color: col }).catch(fail)}
              />
              <div className="min-w-0 flex-1">
                <NameInput category={c} />
              </div>
              <span
                className="w-8 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
                title="Записей в категории"
              >
                {counts.get(c.id) ?? 0}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Переместить «${c.name}» вверх`}
                disabled={i === 0}
                onClick={() => void move(i, -1)}
              >
                <ArrowUp strokeWidth={1.75} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Переместить «${c.name}» вниз`}
                disabled={i === categories.length - 1}
                onClick={() => void move(i, 1)}
              >
                <ArrowDown strokeWidth={1.75} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Удалить категорию «${c.name}»`}
                onClick={() => setToDelete(c)}
              >
                <Trash2 strokeWidth={1.75} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          void add()
        }}
      >
        <ColorPicker value={color} label="Цвет новой категории" onChange={setNewColor} />
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Новая категория"
          aria-label="Название новой категории"
          maxLength={40}
        />
        <Button type="submit" variant="outline" disabled={!newName.trim()}>
          <Plus strokeWidth={1.75} />
          Добавить
        </Button>
      </form>

      <Dialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Удалить категорию «{toDelete?.name}»?</DialogTitle>
            <DialogDescription>Записи останутся, но потеряют категорию.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  )
}
