import { memo, useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { Archive, ArchiveRestore, Check, Link2, Star, Trash2, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { actArchive, actDelete, actToLibrary, actToggleFavorite, actUnarchive } from '@/lib/actions'
import { displayTitle, formatBytes, formatDateTime, formatRelative } from '@/lib/itemTitle'
import { safeImageUrl } from '@/lib/normalize'
import { cn } from '@/lib/utils'
import { makeSnippet } from '@/search'
import type { SearchHit } from '@/search'
import type { Item } from '@/types'
import { CategoryBadge } from './CategoryBadge'
import { CodeView } from './CodeView'
import { FilePreview } from './FilePreview'
import { Highlighted } from './Highlighted'
import { ItemMenu } from './ItemMenu'
import { TagChip } from './TagChip'
import { TypeIcon } from './TypeIcon'

export type ItemVariant = 'inbox' | 'library' | 'favorites' | 'archive'

export interface ItemEntryProps {
  hit: SearchHit
  variant: ItemVariant
  /** Запись открыта в панели деталей. */
  open: boolean
  /** Отмечена чекбоксом. */
  checked: boolean
  /** На ней клавиатурный курсор (показывается только при навигации с клавиатуры). */
  cursor: boolean
  /** Хоть что-то выбрано: чекбоксы видны у всех строк. */
  selecting: boolean
  /** Единственная строка списка в порядке Tab. */
  tabbable: boolean
  onActivate: (id: string, e: MouseEvent) => void
  onToggle: (id: string, e: MouseEvent) => void
}

// ───────────────────────── общие кусочки ─────────────────────────

function domainOf(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Картинка по внешнему адресу: только http/https, при ошибке загрузки скрывается (или показывает fallback). */
function SafeImg({
  src,
  className,
  fallback = null,
}: {
  src: string | undefined
  className?: string
  fallback?: ReactNode
}) {
  const safe = safeImageUrl(src)
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [safe])
  if (!safe || failed) return <>{fallback}</>
  return (
    <img
      src={safe}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  )
}

interface Snippet {
  lead?: string
  text: string
  mono?: boolean
}

function firstLine(s: string): string {
  return s.split(/\r?\n/).find((l) => l.trim() !== '')?.trim() ?? ''
}

function snippetOf(item: Item, terms: string[]): Snippet {
  const searching = terms.length > 0
  switch (item.type) {
    case 'link': {
      const desc = searching
        ? makeSnippet(item, terms)
        : item.linkMeta?.description?.trim() || makeSnippet(item, terms)
      return { lead: domainOf(item.url), text: desc }
    }
    case 'code':
      return { text: searching ? makeSnippet(item, terms) : firstLine(item.content ?? ''), mono: true }
    case 'file':
    case 'image': {
      const meta = [item.fileName, item.fileSize !== undefined ? formatBytes(item.fileSize) : ''].filter(Boolean)
      return { text: meta.join(' · ') }
    }
    default: {
      // Без своего заголовка в роли заголовка выступает первая строка — в сниппете её не повторяем.
      if (!searching && !item.title.trim() && item.content) {
        const lines = item.content.split(/\r?\n/)
        const i = lines.findIndex((l) => l.trim() !== '')
        const rest = lines.slice(i + 1).join('\n')
        return { text: rest.trim() ? makeSnippet({ ...item, content: rest }, terms) : '' }
      }
      return { text: makeSnippet(item, terms) }
    }
  }
}

function QuickButton({
  label,
  icon: Icon,
  onClick,
  active,
  destructive,
}: {
  label: string
  icon: LucideIcon
  onClick: () => void
  active?: boolean
  destructive?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={label}
            aria-pressed={active}
            onClick={(e) => {
              e.stopPropagation()
              onClick()
            }}
            className={cn(destructive && 'hover:text-destructive')}
          />
        }
      >
        <Icon
          strokeWidth={1.75}
          aria-hidden
          className={cn(active && 'fill-[var(--cat-amber)] text-[var(--cat-amber)]')}
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Быстрые действия по наведению/фокусу (меню «…» отдельно, оно управляет своей видимостью). */
function QuickActions({ item, variant }: { item: Item; variant: ItemVariant }) {
  if (variant === 'archive') {
    return (
      <>
        <QuickButton label="Вернуть" icon={ArchiveRestore} onClick={() => void actUnarchive(item.id)} />
        <QuickButton label="Удалить" icon={Trash2} destructive onClick={() => void actDelete(item.id)} />
      </>
    )
  }
  return (
    <>
      {variant === 'inbox' && (
        <QuickButton label="В базу знаний" icon={Check} onClick={() => void actToLibrary(item.id)} />
      )}
      <QuickButton label="В архив" icon={Archive} onClick={() => void actArchive(item.id)} />
      <QuickButton
        label={item.favorite ? 'Убрать из избранного' : 'В избранное'}
        icon={Star}
        active={item.favorite === 1}
        onClick={() => void actToggleFavorite(item)}
      />
    </>
  )
}

function StarMark({ item }: { item: Item }) {
  if (item.favorite !== 1) return null
  return (
    <Star
      size={13}
      strokeWidth={1.75}
      className="shrink-0 fill-[var(--cat-amber)] text-[var(--cat-amber)]"
      aria-label="В избранном"
    />
  )
}

function TagsLine({ tags, max = 3 }: { tags: string[]; max?: number }) {
  if (tags.length === 0) return null
  const rest = tags.length - max
  return (
    <>
      {tags.slice(0, max).map((t) => (
        <TagChip key={t} tag={t} />
      ))}
      {rest > 0 && <span className="text-xs text-muted-foreground">+{rest}</span>}
    </>
  )
}

function sameTerms(a: string[], b: string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  return a.every((t, i) => t === b[i])
}

/**
 * liveQuery отдаёт новые объекты для всех записей на любую мутацию, поэтому сравнение по ссылке
 * не работает. Запись меняется вместе с updatedAt; links правятся без него (обратные ссылки при удалении).
 */
function sameItem(a: Item, b: Item): boolean {
  if (a === b) return true
  return (
    a.id === b.id &&
    a.updatedAt === b.updatedAt &&
    a.links.length === b.links.length &&
    a.links.every((l, i) => l === b.links[i])
  )
}

function propsEqual(a: ItemEntryProps, b: ItemEntryProps): boolean {
  return (
    sameItem(a.hit.item, b.hit.item) &&
    sameTerms(a.hit.terms, b.hit.terms) &&
    a.variant === b.variant &&
    a.open === b.open &&
    a.checked === b.checked &&
    a.cursor === b.cursor &&
    a.selecting === b.selecting &&
    a.tabbable === b.tabbable &&
    a.onActivate === b.onActivate &&
    a.onToggle === b.onToggle
  )
}

/** Левая ячейка: иконка типа, по наведению (или когда что-то выбрано) — чекбокс. */
function LeadCell({
  item,
  checked,
  selecting,
  onToggle,
  className,
}: {
  item: Item
  checked: boolean
  selecting: boolean
  onToggle: ItemEntryProps['onToggle']
  className?: string
}) {
  const show = selecting || checked
  return (
    <div
      className={cn('relative flex size-5 shrink-0 cursor-pointer items-center justify-center', className)}
      onClick={(e) => {
        e.stopPropagation()
        onToggle(item.id, e)
      }}
    >
      <TypeIcon
        type={item.type}
        className={cn(
          'text-muted-foreground transition-opacity',
          show ? 'opacity-0' : 'group-hover:opacity-0 group-focus-within:opacity-0 pointer-coarse:opacity-0',
        )}
      />
      <Checkbox
        checked={checked}
        tabIndex={show ? 0 : -1}
        aria-label={checked ? 'Снять выбор с записи' : 'Выбрать запись'}
        className={cn(
          'absolute transition-opacity',
          show
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
        )}
      />
    </div>
  )
}

const rowBase =
  'group relative scroll-mt-9 scroll-mb-2 cursor-default outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60'

// ───────────────────────── строка списка ─────────────────────────

export const ItemRow = memo(function ItemRow({
  hit,
  variant,
  open,
  checked,
  cursor,
  selecting,
  tabbable,
  onActivate,
  onToggle,
}: ItemEntryProps) {
  const { item, terms } = hit
  const snippet = snippetOf(item, terms)
  const title = displayTitle(item)
  const linkImage = item.type === 'link' ? item.linkMeta?.image : undefined
  const favicon = item.type === 'link' ? item.linkMeta?.favicon : undefined

  return (
    <div
      role="listitem"
      aria-current={open ? 'true' : undefined}
      data-item-id={item.id}
      tabIndex={tabbable ? 0 : -1}
      onClick={(e) => onActivate(item.id, e)}
      className={cn(
        rowBase,
        'flex items-start gap-3 rounded-lg px-3 py-2 hover:bg-muted/60',
        open && 'bg-muted',
        checked && 'bg-brand-soft/60 hover:bg-brand-soft/70',
        cursor && 'ring-2 ring-brand/60 ring-inset',
      )}
    >
      <LeadCell item={item} checked={checked} selecting={selecting} onToggle={onToggle} className="mt-0.5" />

      <div className="flex min-w-0 flex-1 flex-col gap-1 md:flex-row md:items-center md:gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">
            <Highlighted text={title} terms={terms} />
          </div>
          {(snippet.text || snippet.lead) && (
            <div
              className={cn(
                'flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground',
                snippet.mono && 'font-mono text-xs',
              )}
            >
              {item.type === 'link' && (
                <SafeImg
                  src={favicon}
                  className="size-3.5 shrink-0 rounded-sm"
                  fallback={<Link2 size={13} strokeWidth={1.75} className="shrink-0" aria-hidden />}
                />
              )}
              {snippet.lead && <span className="shrink-0 text-foreground/70">{snippet.lead}</span>}
              {snippet.lead && snippet.text && <span aria-hidden>·</span>}
              <span className="truncate">
                <Highlighted text={snippet.text} terms={terms} />
              </span>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-1.5 md:shrink-0 md:flex-nowrap">
          <CategoryBadge categoryId={item.categoryId} />
          <TagsLine tags={item.tags} />
          <span className="md:hidden">
            <StarMark item={item} />
          </span>
          <span className="text-xs text-muted-foreground md:hidden">{formatRelative(item.createdAt)}</span>
        </div>
      </div>

      {item.type === 'image' && item.fileId && (
        <div className="size-10 shrink-0 overflow-hidden rounded-md border border-border">
          <FilePreview item={item} variant="thumb" />
        </div>
      )}
      {linkImage && (
        <SafeImg src={linkImage} className="size-10 shrink-0 rounded-md border border-border object-cover" />
      )}

      <div className="hidden shrink-0 items-center md:flex" onClick={(e) => e.stopPropagation()}>
        <div className="grid items-center justify-items-end">
          <div className="col-start-1 row-start-1 flex items-center gap-2 transition-opacity pointer-fine:group-focus-within:opacity-0 pointer-fine:group-hover:opacity-0">
            <StarMark item={item} />
            <span className="text-xs whitespace-nowrap text-muted-foreground" title={formatDateTime(item.createdAt)}>
              {formatRelative(item.createdAt)}
            </span>
          </div>
          <div className="col-start-1 row-start-1 hidden items-center transition-opacity pointer-fine:flex pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100">
            <QuickActions item={item} variant={variant} />
          </div>
        </div>
      </div>
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <ItemMenu item={item} />
      </div>
    </div>
  )
}, propsEqual)

// ───────────────────────── карточка сетки ─────────────────────────

function CardPreview({ item, terms }: { item: Item; terms: string[] }) {
  switch (item.type) {
    case 'image':
    case 'file':
      return item.fileId ? (
        <div className="h-32 overflow-hidden border-b border-border">
          <FilePreview item={item} variant="thumb" />
        </div>
      ) : null
    case 'code':
      return item.content ? (
        <CodeView
          code={item.content}
          language={item.language}
          maxLines={6}
          className="rounded-none border-0 border-b"
        />
      ) : null
    case 'link': {
      const desc = item.linkMeta?.description?.trim()
      const textFallback = desc ? (
        <p className="line-clamp-4 px-3 pt-2.5 text-[13px] text-muted-foreground">
          <Highlighted text={desc} terms={terms} />
        </p>
      ) : null
      return (
        <SafeImg
          src={item.linkMeta?.image}
          className="h-32 w-full border-b border-border object-cover"
          fallback={textFallback}
        />
      )
    }
    default:
      return item.content ? (
        <p className="line-clamp-6 px-3 pt-2.5 text-[13px] break-words whitespace-pre-wrap text-muted-foreground">
          <Highlighted text={item.content.slice(0, 400)} terms={terms} />
        </p>
      ) : null
  }
}

export const ItemCard = memo(function ItemCard({
  hit,
  variant,
  open,
  checked,
  cursor,
  selecting,
  tabbable,
  onActivate,
  onToggle,
}: ItemEntryProps) {
  const { item, terms } = hit
  const lead = item.type === 'link' ? domainOf(item.url) : ''

  return (
    <div
      role="listitem"
      aria-current={open ? 'true' : undefined}
      data-item-id={item.id}
      tabIndex={tabbable ? 0 : -1}
      onClick={(e) => onActivate(item.id, e)}
      className={cn(
        rowBase,
        'flex flex-col overflow-hidden rounded-lg border border-border bg-card hover:border-foreground/20',
        open && 'border-foreground/30 bg-muted/60',
        checked && 'border-brand/50 bg-brand-soft/40',
        cursor && 'ring-2 ring-brand/60',
      )}
    >
      <CardPreview item={item} terms={terms} />

      <div className="flex flex-1 flex-col gap-1.5 px-3 py-2.5">
        <div className="line-clamp-2 text-sm font-medium break-words text-foreground">
          <Highlighted text={displayTitle(item)} terms={terms} />
        </div>
        {lead && <div className="truncate text-xs text-muted-foreground">{lead}</div>}
        <div className="mt-auto flex min-w-0 flex-wrap items-center gap-1.5 pt-1">
          <TypeIcon type={item.type} className="text-muted-foreground" />
          <CategoryBadge categoryId={item.categoryId} />
          <TagsLine tags={item.tags} max={2} />
          <span className="ml-auto flex items-center gap-1.5">
            <StarMark item={item} />
            <span className="text-xs whitespace-nowrap text-muted-foreground" title={formatDateTime(item.createdAt)}>
              {formatRelative(item.createdAt)}
            </span>
          </span>
        </div>
      </div>

      <LeadCell
        item={item}
        checked={checked}
        selecting={selecting}
        onToggle={onToggle}
        className={cn(
          'absolute top-2 left-2 size-6 rounded-md bg-card/90 shadow-xs ring-1 ring-border transition-opacity',
          !(selecting || checked) && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100',
        )}
      />
      <div
        className="absolute top-1.5 right-1.5 flex items-center rounded-md bg-card/90 shadow-xs ring-1 ring-border transition-opacity pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hidden items-center pointer-fine:flex">
          <QuickActions item={item} variant={variant} />
        </div>
        <ItemMenu item={item} />
      </div>
    </div>
  )
}, propsEqual)
