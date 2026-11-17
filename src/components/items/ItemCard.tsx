import { memo, useContext, useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { Icon, type IconName } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  actArchive,
  actDelete,
  actPurgeAsk,
  actRestoreFromTrash,
  actToLibrary,
  actToggleFavorite,
  actUnarchive,
} from '@/lib/actions'
import { derivedTitleLine, displayTitle, formatBytes, formatDateTime, formatRelative } from '@/lib/itemTitle'
import { safeImageUrl } from '@/lib/normalize'
import { stripMarkdown } from '@/lib/plainText'
import { trashDaysLeft, trashLeftLabel } from '@/lib/trash'
import { useRemoteImagesAllowed } from './remoteImages'
import { cn } from '@/lib/utils'
import { makeSnippet } from '@/search'
import type { SearchHit } from '@/search'
import { IDEA_STATUS_LABEL, ideaStatusOf } from '@/types'
import type { Item } from '@/types'
import { CategoryBadge } from './CategoryBadge'
import { catBarStyle, catColorVar, useListCategory } from './categoryColor'
import { CodeView } from './CodeView'
import { FilePreview } from './FilePreview'
import { Highlighted } from './Highlighted'
import { ItemMenu } from './ItemMenu'
import { ocrMatchSnippet } from './ocrSnippet'
import { TagChip } from './TagChip'
import { useDayKey } from '@/hooks/useItems'
import { TrashDaysContext } from './trashContext'
import { TypeIcon } from './TypeIcon'

export type ItemVariant = 'inbox' | 'library' | 'favorites' | 'archive' | 'trash'

export interface ItemEntryProps {
  hit: SearchHit
  variant: ItemVariant
  /** Запись открыта в панели деталей. */
  open: boolean
  /** Отмечена чекбоксом. */
  checked: boolean
  /** На ней курсор из store/selection (единый источник для клавиатуры, фокуса и клика). */
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
  const allowed = useRemoteImagesAllowed()
  const safe = allowed ? safeImageUrl(src) : undefined
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
      const size = item.fileSize !== undefined ? formatBytes(item.fileSize) : ''
      // Найдено по распознанному тексту: показываем фрагмент с совпадением, иначе причина находки не видна.
      const found = ocrMatchSnippet(item, terms)
      if (found) return { lead: size || undefined, text: found }
      return { text: [item.fileName, size].filter(Boolean).join(' · ') }
    }
    default: {
      // Без своего заголовка в роли заголовка выступает производная строка (displayTitle) — в сниппете её
      // не повторяем. Её нет (одна разметка: «---», пустые пункты) — заголовок «Без названия», сниппет из всего текста.
      if (!searching && !item.title.trim() && item.content) {
        const line = derivedTitleLine(item)
        if (line === null) return { text: makeSnippet(item, terms) }
        const rest = item.content.split(/\r?\n/).slice(line.index + 1).join('\n')
        return { text: rest.trim() ? makeSnippet({ ...item, content: rest }, terms) : '' }
      }
      return { text: makeSnippet(item, terms) }
    }
  }
}

function QuickButton({
  label,
  icon,
  onClick,
  active,
  destructive,
  dense,
}: {
  label: string
  icon: IconName
  onClick: () => void
  active?: boolean
  destructive?: boolean
  /** Плотная группа в накладке карточки: без собственной рамки кнопок. */
  dense?: boolean
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
            className={cn(!dense && 'px-btn pixel:size-7.5 pixel:max-md:size-9', destructive && 'hover:text-destructive')}
          />
        }
      >
        <Icon name={icon} className={cn(active && 'fill-gold text-gold')} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** Быстрые действия по наведению/фокусу (меню «…» отдельно, оно управляет своей видимостью). */
function QuickActions({ item, variant, dense }: { item: Item; variant: ItemVariant; dense?: boolean }) {
  // Запись в корзине узнаётся по самой записи, а не по разделу: так же и в выдаче is:trash.
  if (item.deletedAt !== undefined) {
    return (
      <>
        <QuickButton dense={dense} label="Восстановить" icon="undo" onClick={() => void actRestoreFromTrash(item.id)} />
        <QuickButton dense={dense} label="Удалить навсегда" icon="trash" destructive onClick={() => void actPurgeAsk(item.id)} />
      </>
    )
  }
  if (variant === 'archive') {
    return (
      <>
        <QuickButton dense={dense} label="Вернуть" icon="archive-restore" onClick={() => void actUnarchive(item.id)} />
        <QuickButton dense={dense} label="Удалить" icon="trash" destructive onClick={() => void actDelete(item.id)} />
      </>
    )
  }
  return (
    <>
      {variant === 'inbox' && (
        <QuickButton dense={dense} label="В базу знаний" icon="check" onClick={() => void actToLibrary(item.id)} />
      )}
      <QuickButton dense={dense} label="В архив" icon="archive" onClick={() => void actArchive(item.id)} />
      <QuickButton
        dense={dense}
        label={item.favorite ? 'Убрать из избранного' : 'В избранное'}
        icon="star"
        active={item.favorite === 1}
        onClick={() => void actToggleFavorite(item)}
      />
    </>
  )
}

/** Статус идеи на карточке; «Новая» — состояние по умолчанию, его не показываем, чтобы не шуметь. */
function IdeaBadge({ item }: { item: Item }) {
  const status = ideaStatusOf(item)
  if (!status || status === 'new') return null
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-md bg-muted px-1.5 text-xs px-chip pixel:h-auto pixel:min-h-5',
        status === 'active' ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {IDEA_STATUS_LABEL[status]}
    </span>
  )
}

/** className — для обёртки: в строке в пиксельных сценах скрыт (там флажок), в карточке — золотая плашка с рамкой. */
function StarMark({ item, className }: { item: Item; className?: string }) {
  if (item.favorite !== 1) return null
  return (
    <span className={cn('inline-flex shrink-0', className)}>
      <Icon name="star" size={13} pixelSize={16} className="fill-gold text-gold pixel:text-gold-ink" aria-label="В избранном" />
    </span>
  )
}

/**
 * «удалено … · ещё N дн.» у записи в корзине. stacked — в колонке метаданных строки: в пиксельных сценах
 * две строки друг под другом, в «Классике» — одна.
 */
function TrashMeta({ item, stacked, className }: { item: Item; stacked?: boolean; className?: string }) {
  const trashDays = useContext(TrashDaysContext)
  const deletedAt = item.deletedAt ?? Number.NaN
  // Подписка на смену суток обходит memo строки: остаток («ещё N дн.») не застывает.
  useDayKey()
  const now = Date.now()
  const left = trashDaysLeft(item.deletedAt, trashDays, now)
  const leftText = trashLeftLabel(left)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-x-1 text-xs whitespace-nowrap text-muted-foreground',
        stacked && 'pixel:flex-col pixel:items-end pixel:gap-0',
        className,
      )}
      title={`Удалено: ${formatDateTime(deletedAt)}`}
    >
      <span>удалено {formatRelative(deletedAt, now)}</span>
      {leftText && (
        <>
          <span aria-hidden className={cn(stacked && 'pixel:hidden')}>
            ·
          </span>
          <span className={cn(left !== null && left <= 3 && 'text-destructive')}>{leftText}</span>
        </>
      )}
    </span>
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
    // Перенос в корзину и восстановление updatedAt не меняют.
    a.deletedAt === b.deletedAt &&
    // Распознавание updatedAt не меняет, а сниппет зависит от текста.
    a.ocrAt === b.ocrAt &&
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
  pixelSize,
}: {
  item: Item
  checked: boolean
  selecting: boolean
  onToggle: ItemEntryProps['onToggle']
  className?: string
  /** Размер значка типа в пиксельных сценах (в строке 30, в накладке карточки — по умолчанию). */
  pixelSize?: number
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
        pixelSize={pixelSize}
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
  'group relative scroll-mt-9 pixel:scroll-mt-11 scroll-mb-2 pixel:scroll-mb-3 cursor-default outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/60'

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
  const cat = useListCategory(item.categoryId)
  const trashed = item.deletedAt !== undefined

  return (
    <div
      role="listitem"
      aria-current={open ? 'true' : undefined}
      data-cursor={cursor ? 'true' : undefined}
      data-checked={checked ? 'true' : undefined}
      data-item-id={item.id}
      tabIndex={tabbable ? 0 : -1}
      onClick={(e) => onActivate(item.id, e)}
      className={cn(
        rowBase,
        'flex items-start gap-3 rounded-lg px-3 py-2 hover:bg-muted/60',
        'px-row pixel:items-stretch pixel:gap-0 pixel:p-0',
        open && 'bg-muted',
        checked && 'bg-brand-soft/60 hover:bg-brand-soft/70',
        cursor && 'bg-accent before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-brand',
      )}
    >
      <span
        className="hidden w-2.5 shrink-0 px-flag px-flag-l pixel:block"
        data-flag={item.favorite === 1 ? 'fav' : undefined}
        {...(item.favorite === 1 ? { role: 'img', 'aria-label': 'В избранном' } : { 'aria-hidden': true })}
      />
      <div
        className="contents px-catbar pixel:flex pixel:min-w-0 pixel:flex-1 pixel:items-start pixel:gap-2.5 pixel:px-2.5 pixel:pt-3 pixel:pb-2"
        style={catBarStyle(cat?.color)}
      >
        <LeadCell
          item={item}
          checked={checked}
          selecting={selecting}
          onToggle={onToggle}
          pixelSize={30}
          className="mt-0.5 pixel:size-7.5"
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1 md:flex-row md:items-center md:gap-3 pixel:md:flex-col pixel:md:items-stretch pixel:md:gap-1">
          <div className="min-w-0 flex-1">
            <div
              className={cn(
                'truncate text-sm font-medium pixel:font-semibold',
                trashed ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              <Highlighted text={title} terms={terms} />
            </div>
            {(snippet.text || snippet.lead) && (
              <div
                className={cn(
                  'flex min-w-0 items-center gap-1.5 text-2sm text-muted-foreground',
                  snippet.mono && 'font-mono text-xs',
                )}
              >
                {item.type === 'link' && (
                  <SafeImg
                    src={favicon}
                    className="size-3.5 shrink-0 rounded-sm"
                    fallback={<Icon name="link" size={13} className="shrink-0" />}
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

          <div className="flex min-w-0 flex-wrap items-center gap-1.5 md:shrink-0 md:flex-nowrap pixel:gap-1 pixel:md:flex-wrap">
            <IdeaBadge item={item} />
            <CategoryBadge categoryId={item.categoryId} className="pixel:md:hidden" />
            <TagsLine tags={item.tags} />
            {trashed ? (
              <TrashMeta item={item} className="md:hidden" />
            ) : (
              <>
                <StarMark item={item} className="md:hidden pixel:hidden" />
                <span className="text-xs text-muted-foreground md:hidden" title={formatDateTime(item.createdAt)}>
                  {formatRelative(item.createdAt)}
                </span>
              </>
            )}
          </div>
        </div>

        {item.type === 'image' && item.fileId && (
          <div className="size-10 shrink-0 overflow-hidden rounded-md border border-border pixel:border-2 pixel:border-wood-dark">
            <FilePreview item={item} variant="thumb" />
          </div>
        )}
        {linkImage && (
          <SafeImg
            src={linkImage}
            className="size-10 shrink-0 rounded-md border border-border object-cover pixel:border-2 pixel:border-wood-dark"
          />
        )}

        <div className="hidden shrink-0 items-center md:flex pixel:self-center" onClick={(e) => e.stopPropagation()}>
          <div className="grid items-center justify-items-end">
            <div className="col-start-1 row-start-1 flex items-center gap-2 transition-opacity pixel:flex-col pixel:items-end pixel:gap-0.5 pointer-fine:group-focus-within:pointer-events-none pointer-fine:group-focus-within:opacity-0 pointer-fine:group-hover:pointer-events-none pointer-fine:group-hover:opacity-0">
              <CategoryBadge categoryId={item.categoryId} className="hidden pixel:inline-flex" />
              {trashed ? (
                <TrashMeta item={item} stacked />
              ) : (
                <>
                  <StarMark item={item} className="pixel:hidden" />
                  <span className="text-xs whitespace-nowrap text-muted-foreground" title={formatDateTime(item.createdAt)}>
                    {formatRelative(item.createdAt)}
                  </span>
                </>
              )}
            </div>
            <div className="col-start-1 row-start-1 hidden items-center transition-opacity pixel:gap-1 pointer-fine:flex pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100">
              <QuickActions item={item} variant={variant} />
            </div>
          </div>
        </div>
        <div className="shrink-0 pixel:self-center" onClick={(e) => e.stopPropagation()}>
          <ItemMenu item={item} className="px-btn" />
        </div>
      </div>
      <span
        aria-hidden
        className="hidden w-2.5 shrink-0 px-flag px-flag-r pixel:block"
        data-flag={trashed ? 'trash' : item.status}
      />
    </div>
  )
}, propsEqual)

// ───────────────────────── карточка сетки ─────────────────────────

/**
 * Полоса над текстом карточки под накладку (галочка выбора слева, действия справа): накладка висит поверх верха
 * карточки и на картинке ничего не прячет, а на тексте закрывала бы первые строки и заголовок.
 */
function ControlsSpace() {
  // Высота — по накладке: на телефоне и сенсорном экране её кнопки крупнее.
  return (
    <div
      aria-hidden
      className="h-8 shrink-0 max-md:h-10 pointer-coarse:h-10 pixel:h-9 pixel:max-md:h-11 pixel:pointer-coarse:h-11"
    />
  )
}

function CardPreview({ item, terms }: { item: Item; terms: string[] }) {
  switch (item.type) {
    case 'image':
    case 'file':
      return item.fileId ? (
        <div className="h-32 overflow-hidden border-b border-border pixel:border-b-2">
          <FilePreview item={item} variant="thumb" />
        </div>
      ) : (
        <ControlsSpace />
      )
    case 'code':
      return (
        <>
          <ControlsSpace />
          {item.content && (
            <CodeView
              code={item.content}
              language={item.language}
              maxLines={6}
              bare
              className="rounded-none border-0 border-y pixel:border-y-2 pixel:border-[var(--paper-line)] pixel:bg-[var(--paper-2)]"
            />
          )}
        </>
      )
    case 'link': {
      const desc = item.linkMeta?.description?.trim()
      // Картинки нет или она не загрузилась — сверху текст: оставляем место под накладку.
      const textFallback = (
        <>
          <ControlsSpace />
          {desc && (
            <p className="line-clamp-4 px-3 pt-2.5 text-2sm text-muted-foreground">
              <Highlighted text={desc} terms={terms} />
            </p>
          )}
        </>
      )
      return (
        <SafeImg
          src={item.linkMeta?.image}
          className="h-32 w-full border-b border-border object-cover pixel:border-b-2"
          fallback={textFallback}
        />
      )
    }
    default:
      return (
        <>
          <ControlsSpace />
          {item.content && (
            <p className="line-clamp-6 px-3 pt-2.5 text-2sm break-words whitespace-pre-wrap text-muted-foreground">
              {/* Превью — без маркеров Markdown; запас 600 символов: снятая разметка укорачивает текст. */}
              <Highlighted text={stripMarkdown(item.content.slice(0, 600)).slice(0, 400)} terms={terms} />
            </p>
          )}
        </>
      )
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
  const ocrFound = ocrMatchSnippet(item, terms)
  const cat = useListCategory(item.categoryId)
  const trashed = item.deletedAt !== undefined

  return (
    <div
      role="listitem"
      aria-current={open ? 'true' : undefined}
      data-cursor={cursor ? 'true' : undefined}
      data-checked={checked ? 'true' : undefined}
      data-item-id={item.id}
      tabIndex={tabbable ? 0 : -1}
      onClick={(e) => onActivate(item.id, e)}
      className={cn(
        rowBase,
        'flex flex-col overflow-hidden rounded-lg border border-border bg-card hover:border-foreground/20 px-row',
        open && 'border-foreground/30 bg-muted/60',
        checked && 'border-brand/50 bg-brand-soft/40',
        cursor && 'border-brand bg-accent ring-1 ring-brand',
      )}
    >
      <span aria-hidden className="hidden h-1 shrink-0 pixel:block" style={{ background: catColorVar(cat?.color) }} />
      <CardPreview item={item} terms={terms} />

      <div className="flex flex-1 flex-col gap-1.5 px-3 py-2.5">
        <div
          className={cn(
            'line-clamp-2 text-sm font-medium break-words pixel:font-semibold',
            trashed ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          <Highlighted text={displayTitle(item)} terms={terms} />
        </div>
        {lead && <div className="truncate text-xs text-muted-foreground">{lead}</div>}
        {ocrFound && (
          <div className="line-clamp-2 text-xs break-words text-muted-foreground">
            <Highlighted text={ocrFound} terms={terms} />
          </div>
        )}
        <div className="mt-auto flex min-w-0 flex-wrap items-center gap-1.5 pt-1">
          <TypeIcon type={item.type} className="text-muted-foreground" />
          <IdeaBadge item={item} />
          <CategoryBadge categoryId={item.categoryId} />
          <TagsLine tags={item.tags} max={2} />
          <span className="ml-auto flex items-center gap-1.5">
            {trashed ? (
              <TrashMeta item={item} />
            ) : (
              <>
                <StarMark
                  item={item}
                  className="pixel:border-2 pixel:border-wood-dark pixel:bg-gold pixel:p-px pixel:text-gold-ink"
                />
                <span className="text-xs whitespace-nowrap text-muted-foreground" title={formatDateTime(item.createdAt)}>
                  {formatRelative(item.createdAt)}
                </span>
              </>
            )}
          </span>
        </div>
      </div>

      <LeadCell
        item={item}
        checked={checked}
        selecting={selecting}
        onToggle={onToggle}
        className={cn(
          'absolute top-2 left-2 size-6 rounded-md bg-card/90 shadow-xs ring-1 ring-border transition-opacity pixel:top-3 pixel:border-2 pixel:border-wood-dark pixel:bg-paper',
          !(selecting || checked) && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100',
        )}
      />
      <div
        className="absolute top-1.5 right-1.5 flex items-center rounded-md bg-card/90 shadow-xs ring-1 ring-border transition-opacity pixel:top-3 pixel:border-2 pixel:border-wood-dark pixel:bg-paper pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hidden items-center pointer-fine:flex">
          <QuickActions item={item} variant={variant} dense />
        </div>
        <ItemMenu item={item} />
      </div>
    </div>
  )
}, propsEqual)
