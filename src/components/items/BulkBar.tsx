import { useState } from 'react'
import { Archive, ArchiveRestore, BookMarked, Tag, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { addTags, setCategory } from '@/db/repo'
import { actArchive, actDelete, actToLibrary, actUnarchive } from '@/lib/actions'
import { useSelection } from '@/store/selection'
import { CategorySelect } from './CategorySelect'
import { TagInput } from './TagInput'
import type { ItemVariant } from './ItemCard'

function plural(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'запись'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'записи'
  return 'записей'
}

function errMsg(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Что-то пошло не так'
}

/** Панель массовых действий: показывается, когда выбрана хотя бы одна запись. */
export function BulkBar({ variant }: { variant: ItemVariant }) {
  const selected = useSelection((s) => s.ids)
  const clear = useSelection((s) => s.clear)
  const [tags, setTags] = useState<string[]>([])
  const [tagsOpen, setTagsOpen] = useState(false)

  if (selected.size === 0) return null
  const ids = [...selected]

  async function applyCategory(categoryId: string | null) {
    try {
      await setCategory(ids, categoryId)
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  async function applyTags() {
    if (tags.length === 0) return
    try {
      await addTags(ids, tags)
      setTags([])
      setTagsOpen(false)
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  return (
    <div
      role="toolbar"
      aria-label="Действия с выбранными записями"
      className="pointer-events-none sticky bottom-3 z-20 mt-3 flex justify-center px-2 pb-[env(safe-area-inset-bottom)]"
    >
      <div className="pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-md">
        <span className="px-2 text-[13px] font-medium whitespace-nowrap" aria-live="polite">
          {selected.size} {plural(selected.size)}
        </span>
        <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden />

        {variant === 'inbox' && (
          <Button variant="ghost" size="sm" className="pointer-coarse:h-9" onClick={() => void actToLibrary(ids)} aria-label="В базу знаний">
            <BookMarked strokeWidth={1.75} className="size-4" aria-hidden />
            <span className="hidden sm:inline">В базу знаний</span>
          </Button>
        )}
        {variant === 'archive' ? (
          <Button variant="ghost" size="sm" className="pointer-coarse:h-9" onClick={() => void actUnarchive(ids)} aria-label="Вернуть из архива">
            <ArchiveRestore strokeWidth={1.75} className="size-4" aria-hidden />
            <span className="hidden sm:inline">Вернуть</span>
          </Button>
        ) : (
          <Button variant="ghost" size="sm" className="pointer-coarse:h-9" onClick={() => void actArchive(ids)} aria-label="В архив">
            <Archive strokeWidth={1.75} className="size-4" aria-hidden />
            <span className="hidden sm:inline">В архив</span>
          </Button>
        )}

        <CategorySelect
          value={null}
          onChange={(id) => void applyCategory(id)}
          allowCreate
          placeholder="Категория"
          className="h-7 w-auto min-w-28 text-[0.8rem]"
        />

        <Popover open={tagsOpen} onOpenChange={setTagsOpen}>
          <PopoverTrigger render={<Button variant="ghost" size="sm" className="pointer-coarse:h-9" aria-label="Добавить теги" />}>
            <Tag strokeWidth={1.75} className="size-4" aria-hidden />
            <span className="hidden sm:inline">Теги</span>
          </PopoverTrigger>
          <PopoverContent side="top" align="center" className="w-80">
            <TagInput value={tags} onChange={setTags} placeholder="Теги для выбранных записей" autoFocus />
            <div className="flex justify-end">
              <Button size="sm" disabled={tags.length === 0} onClick={() => void applyTags()}>
                Добавить
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        <Button
          variant="ghost"
          size="sm"
          className="pointer-coarse:h-9 hover:text-destructive"
          onClick={() => void actDelete(ids)}
          aria-label="Удалить выбранные"
        >
          <Trash2 strokeWidth={1.75} className="size-4" aria-hidden />
          <span className="hidden sm:inline">Удалить</span>
        </Button>

        <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden />
        <Button variant="ghost" size="icon-sm" className="pointer-coarse:size-9" onClick={clear} aria-label="Снять выбор">
          <X strokeWidth={1.75} className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  )
}
