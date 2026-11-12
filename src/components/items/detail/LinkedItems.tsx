import { useMemo } from 'react'
import { Icon } from '@/components/icons'
import { toast } from 'sonner'
import { TypeIcon } from '@/components/items/TypeIcon'
import { Button } from '@/components/ui/button'
import { linkItems, unlinkItems } from '@/db/repo'
import { useAllItems, useLinkedItems } from '@/hooks/useItems'
import { describeError } from '@/lib/errors'
import { displayTitle } from '@/lib/itemTitle'
import { useUi } from '@/store/ui'
import type { Item } from '@/types'
import { LinkPicker } from './LinkPicker'

async function run(fn: () => Promise<void>, fallback: string) {
  try {
    await fn()
  } catch (e) {
    toast.error(describeError(e, fallback))
  }
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-medium text-muted-foreground pixel:text-2sm pixel:font-semibold">{children}</h3>
}

/** Связанные записи и подсказки «Похожие» (по общим тегам). */
export function LinkedItems({ item }: { item: Item }) {
  const select = useUi((s) => s.select)
  const linked = useLinkedItems(item)
  const all = useAllItems()

  const similar = useMemo(() => {
    if (!all || item.tags.length === 0) return []
    const mine = new Set(item.tags)
    const skip = new Set([item.id, ...item.links])
    return all
      .filter((i) => !skip.has(i.id))
      .map((i) => ({ i, n: i.tags.filter((t) => mine.has(t)).length }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n || b.i.updatedAt - a.i.updatedAt)
      .slice(0, 3)
      .map((x) => x.i)
  }, [all, item.id, item.links, item.tags])

  return (
    <section className="flex flex-col gap-2" aria-label="Связанные записи">
      <div className="flex items-center justify-between gap-2">
        <SectionTitle>Связанные записи</SectionTitle>
        <LinkPicker item={item} />
      </div>

      {linked.length === 0 ? (
        <p className="text-xs text-muted-foreground">Связей пока нет</p>
      ) : (
        <ul className="flex flex-col">
          {linked.map((l) => (
            <li key={l.id} className="group/link flex items-center gap-1 rounded-md px-nav hover:bg-muted/50">
              <button
                type="button"
                onClick={() => select(l.id)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <TypeIcon type={l.type} className="text-muted-foreground" />
                <span className="truncate">{displayTitle(l)}</span>
              </button>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Убрать связь: ${displayTitle(l)}`}
                onClick={() => void run(() => unlinkItems(item.id, l.id), 'Не удалось убрать связь')}
                className="text-muted-foreground"
              >
                <Icon name="x" className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {similar.length > 0 && (
        <div className="mt-1 flex flex-col gap-1">
          <SectionTitle>Похожие</SectionTitle>
          <ul className="flex flex-col">
            {similar.map((s) => (
              <li key={s.id} className="flex items-center gap-1 rounded-md px-nav hover:bg-muted/50">
                <button
                  type="button"
                  onClick={() => select(s.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <TypeIcon type={s.type} />
                  <span className="truncate">{displayTitle(s)}</span>
                </button>
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={`Связать с: ${displayTitle(s)}`}
                  onClick={() => void run(() => linkItems(item.id, s.id), 'Не удалось связать записи')}
                  className="text-muted-foreground"
                >
                  <Icon name="plus" className="size-4" />
                  Связать
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
