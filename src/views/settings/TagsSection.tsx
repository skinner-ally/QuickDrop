import { useMemo, useState } from 'react'
import { Check, Pencil, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { deleteTag, normalizeTag, renameTag } from '@/db/repo'
import { useAllTags } from '@/hooks/useItems'
import { describeError } from '@/lib/errors'
import { Section } from './Section'

const fail = (e: unknown) => toast.error(describeError(e))

export function TagsSection() {
  const tags = useAllTags()
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [toDelete, setToDelete] = useState<{ tag: string; count: number } | null>(null)

  const filtered = useMemo(() => {
    const s = normalizeTag(q)
    return s ? tags.filter((t) => t.tag.includes(s)) : tags
  }, [tags, q])

  const target = normalizeTag(draft)
  const merges = editing !== null && target !== '' && target !== editing && tags.some((t) => t.tag === target)

  const commit = async () => {
    if (editing === null) return
    const from = editing
    if (!target || target === from) {
      setEditing(null)
      return
    }
    try {
      await renameTag(from, target)
      setEditing(null)
      toast.success(merges ? `Теги объединены: #${target}` : `Тег переименован: #${target}`, { duration: 1500 })
    } catch (e) {
      fail(e)
    }
  }

  const confirmDelete = async () => {
    if (!toDelete) return
    try {
      await deleteTag(toDelete.tag)
      setToDelete(null)
    } catch (e) {
      fail(e)
    }
  }

  return (
    <Section id="tags" title="Теги" description="Теги хранятся в записях. Переименование действует на все записи.">
      {tags.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Тегов пока нет.</p>
      ) : (
        <>
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              strokeWidth={1.75}
              aria-hidden
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Найти тег"
              aria-label="Поиск по тегам"
              className="pl-8"
            />
          </div>
          {filtered.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">Ничего не найдено.</p>
          ) : (
            <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
              {filtered.map(({ tag, count }) => (
                <li key={tag} className="flex flex-col gap-1 px-2 py-1">
                  {editing === tag ? (
                    <>
                      <form
                        className="flex items-center gap-1"
                        onSubmit={(e) => {
                          e.preventDefault()
                          void commit()
                        }}
                      >
                        <span className="text-muted-foreground">#</span>
                        <Input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => e.key === 'Escape' && setEditing(null)}
                          aria-label={`Новое имя тега #${tag}`}
                          className="h-7"
                        />
                        <Button type="submit" variant="ghost" size="icon-sm" aria-label="Сохранить">
                          <Check strokeWidth={1.75} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Отменить"
                          onClick={() => setEditing(null)}
                        >
                          <X strokeWidth={1.75} />
                        </Button>
                      </form>
                      {merges && (
                        <p className="text-xs text-muted-foreground">
                          Тег #{target} уже есть: записи будут объединены под ним, без дублей.
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="flex items-center gap-1">
                      <span className="min-w-0 flex-1 truncate text-[13px]">
                        <span className="text-muted-foreground">#</span>
                        {tag}
                      </span>
                      <span
                        className="w-8 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
                        title="Записей с тегом"
                      >
                        {count}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Переименовать тег #${tag}`}
                        onClick={() => {
                          setEditing(tag)
                          setDraft(tag)
                        }}
                      >
                        <Pencil strokeWidth={1.75} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Удалить тег #${tag}`}
                        onClick={() => setToDelete({ tag, count })}
                      >
                        <Trash2 strokeWidth={1.75} />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Dialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Удалить тег #{toDelete?.tag}?</DialogTitle>
            <DialogDescription>
              Тег будет убран у записей ({toDelete?.count}). Сами записи останутся.
            </DialogDescription>
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
