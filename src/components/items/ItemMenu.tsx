import { Fragment } from 'react'
import {
  Archive,
  ArchiveRestore,
  BookMarked,
  Copy,
  Download,
  ExternalLink,
  Inbox,
  MoreHorizontal,
  Star,
  StarOff,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  actArchive,
  actCopy,
  actDelete,
  actDownload,
  actOpen,
  actToInbox,
  actToLibrary,
  actToggleFavorite,
  actUnarchive,
} from '@/lib/actions'
import { safeLinkUrl } from '@/lib/normalize'
import { cn } from '@/lib/utils'
import type { Item } from '@/types'

export interface ItemAction {
  id: string
  label: string
  icon: LucideIcon
  run: () => void
  destructive?: boolean
  /** Подсказка клавиши в списке (E, A, F, Del). */
  shortcut?: string
}

/** Действия над записью с учётом её статуса и типа — общий список для меню, палитры и деталей. */
export function itemActionList(item: Item): ItemAction[] {
  const list: ItemAction[] = []
  if (item.type === 'link' && safeLinkUrl(item.url)) {
    list.push({ id: 'open', label: 'Открыть ссылку', icon: ExternalLink, run: () => actOpen(item) })
  }
  list.push({ id: 'copy', label: 'Копировать', icon: Copy, run: () => void actCopy(item) })
  list.push(
    item.favorite
      ? { id: 'favorite', label: 'Убрать из избранного', icon: StarOff, run: () => void actToggleFavorite(item), shortcut: 'F' }
      : { id: 'favorite', label: 'В избранное', icon: Star, run: () => void actToggleFavorite(item), shortcut: 'F' },
  )
  if (item.status === 'inbox') {
    list.push({ id: 'to-library', label: 'В базу знаний', icon: BookMarked, run: () => void actToLibrary(item.id), shortcut: 'E' })
  } else if (item.status === 'library') {
    list.push({ id: 'to-inbox', label: 'Вернуть во входящие', icon: Inbox, run: () => void actToInbox(item.id) })
  }
  if (item.status === 'archive') {
    list.push({ id: 'unarchive', label: 'Вернуть из архива', icon: ArchiveRestore, run: () => void actUnarchive(item.id), shortcut: 'A' })
  } else {
    list.push({ id: 'archive', label: 'В архив', icon: Archive, run: () => void actArchive(item.id), shortcut: 'A' })
  }
  if ((item.type === 'file' || item.type === 'image') && item.fileId) {
    list.push({ id: 'download', label: 'Скачать', icon: Download, run: () => void actDownload(item) })
  }
  list.push({ id: 'delete', label: 'Удалить', icon: Trash2, run: () => void actDelete(item.id), destructive: true, shortcut: 'Del' })
  return list
}

export function ItemMenu({
  item,
  variant = 'card',
  className,
}: {
  item: Item
  /** card — кнопка проявляется при наведении на карточку (group), detail — всегда видна. */
  variant?: 'card' | 'detail' | (string & {})
  className?: string
}) {
  const actions = itemActionList(item)
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  const card = variant !== 'detail'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size={card ? 'icon-xs' : 'icon-sm'}
            aria-label="Действия с записью"
            onClick={stop}
            className={cn(
              'pointer-coarse:size-9',
              card &&
                'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100 pointer-fine:focus-visible:opacity-100 aria-expanded:opacity-100',
              className,
            )}
          />
        }
      >
        <MoreHorizontal strokeWidth={1.75} aria-hidden />
      </DropdownMenuTrigger>
      {/* Меню рендерится в портале, но события React всплывают к карточке — гасим их здесь. */}
      <DropdownMenuContent align="end" className="min-w-52" onClick={stop} onKeyDown={stop}>
        {actions.map((a) => (
          <Fragment key={a.id}>
            {a.destructive && <DropdownMenuSeparator />}
            <DropdownMenuItem variant={a.destructive ? 'destructive' : 'default'} onClick={() => a.run()}>
              <a.icon strokeWidth={1.75} aria-hidden />
              {a.label}
              {a.shortcut && <DropdownMenuShortcut className="pointer-coarse:hidden">{a.shortcut}</DropdownMenuShortcut>}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
