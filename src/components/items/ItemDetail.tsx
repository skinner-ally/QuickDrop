import { useEffect } from 'react'
import { Icon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useDayKey, useItem, useItemsWithTrash } from '@/hooks/useItems'
import { useSettings } from '@/db/settings'
import {
  actArchive,
  actPurgeAsk,
  actRestoreFromTrash,
  actToLibrary,
  actToggleFavorite,
  actUnarchive,
} from '@/lib/actions'
import { formatDateTime, TYPE_LABEL } from '@/lib/itemTitle'
import { trashPurgeNote } from '@/lib/trash'
import { cn } from '@/lib/utils'
import { useUi } from '@/store/ui'
import { DEFAULT_SETTINGS, type Item, type ItemSource, type ItemStatus, type ItemType } from '@/types'
import { CategoryBadge } from './CategoryBadge'
import { CategorySelect } from './CategorySelect'
import { AiSuggest, AiSummary } from './detail/AiSuggest'
import { ItemContent } from './detail/ItemContent'
import { LinkedItems } from './detail/LinkedItems'
import { saveItem, saveTags } from './detail/save'
import { TitleField } from './detail/TitleField'
import { ItemMenu } from './ItemMenu'
import { TagChip } from './TagChip'
import { TagInput } from './TagInput'
import { TypeIcon } from './TypeIcon'

const STATUS_LABEL: Record<ItemStatus, string> = {
  inbox: 'Входящие',
  library: 'База знаний',
  archive: 'Архив',
}

const SOURCE_LABEL: Record<ItemSource, string> = {
  manual: 'вручную',
  paste: 'вставка',
  drop: 'перетаскивание',
  import: 'импорт',
  demo: 'демо',
  extension: 'Из браузера',
  share: 'из «Поделиться»',
}

const SWITCHABLE: ItemType[] = ['text', 'idea', 'code']

function TypeSwitch({ item, readOnly }: { item: Item; readOnly?: boolean }) {
  const label = TYPE_LABEL[item.type]
  if (readOnly || !SWITCHABLE.includes(item.type)) {
    return (
      <div className="flex h-7 items-center gap-1.5 px-1.5 text-sm text-muted-foreground">
        <TypeIcon type={item.type} />
        <span>{label}</span>
      </div>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Тип записи: ${label}. Сменить`}
        className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-sm text-muted-foreground transition-colors outline-none select-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 aria-expanded:bg-muted px-btn px-btn-ghost pixel:h-7.5"
      >
        <TypeIcon type={item.type} />
        <span>{label}</span>
        <Icon name="chevron-down" size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-auto min-w-36">
        {SWITCHABLE.map((t) => (
          <DropdownMenuItem key={t} onClick={() => t !== item.type && void saveItem(item.id, { type: t })}>
            <TypeIcon type={t} />
            {TYPE_LABEL[t]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PrimaryAction({ item }: { item: Item }) {
  if (item.status === 'inbox') {
    return (
      <Button
        size="sm"
        className="bg-brand text-brand-foreground hover:bg-brand/90 pointer-coarse:h-9"
        onClick={() => void actToLibrary(item.id)}
      >
        В базу знаний
      </Button>
    )
  }
  if (item.status === 'library') {
    return (
      <Button size="sm" variant="outline" className="pointer-coarse:h-9" onClick={() => void actArchive(item.id)}>
        В архив
      </Button>
    )
  }
  return (
    <Button size="sm" variant="outline" className="pointer-coarse:h-9" onClick={() => void actUnarchive(item.id)}>
      Вернуть
    </Button>
  )
}

function TimeValue({ ts }: { ts: number }) {
  const text = formatDateTime(ts)
  if (!Number.isFinite(ts) || Number.isNaN(new Date(ts).getTime())) return <>{text}</>
  return <time dateTime={new Date(ts).toISOString()}>{text}</time>
}

function Meta({ item }: { item: Item }) {
  const rows: Array<[string, React.ReactNode]> = [
    ['Создано', <TimeValue ts={item.createdAt} />],
    ['Изменено', <TimeValue ts={item.updatedAt} />],
  ]
  if (item.processedAt) rows.push(['Обработано', <TimeValue ts={item.processedAt} />])
  if (item.deletedAt !== undefined) rows.push(['Удалено', <TimeValue ts={item.deletedAt} />])
  rows.push(['Источник', SOURCE_LABEL[item.source] ?? item.source])
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function TrashNote({ item }: { item: Item }) {
  const trashDays = useSettings()?.trashDays ?? DEFAULT_SETTINGS.trashDays
  useDayKey() // остаток дней пересчитывается при смене суток
  const deletedAt = item.deletedAt as number
  // Дата и остаток считаются от одного «сейчас» и по календарным суткам (см. trashPurgeNote).
  const purge = trashPurgeNote(deletedAt, trashDays, Date.now())
  return (
    <div
      role="note"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-muted/50 p-2 text-2sm px-well"
    >
      <p className="min-w-0 flex-1">
        Запись в корзине. Удалена {formatDateTime(deletedAt)}.{purge && ` ${purge}`}
      </p>
      <Button
        variant="ghost"
        size="sm"
        className="hover:text-destructive pointer-coarse:h-9"
        onClick={() => void actPurgeAsk(item.id)}
      >
        Удалить навсегда
      </Button>
    </div>
  )
}

function DetailBody({ item, onClose }: { item: Item; onClose: () => void }) {
  const trashed = item.deletedAt !== undefined
  return (
    <div className="@container flex h-full min-h-0 flex-col bg-background">
      <header className="sticky top-0 z-10 flex shrink-0 items-center gap-1 border-b border-border bg-background px-2 py-1.5 pixel:gap-1.5 pixel:border-b-2 pixel:px-0.5 pixel:pt-0.5 pixel:pb-2">
        <Button variant="ghost" size="icon-sm" aria-label="Назад" onClick={onClose} className="pointer-coarse:size-9 md:hidden px-btn pixel:size-7.5 pixel:max-md:size-9 pixel:pointer-coarse:size-9">
          <Icon name="arrow-left" className="size-4" />
        </Button>
        {/* Запас p-1 при -m-1: обводка фокуса выходит за кнопку на 2-4px и иначе срезается overflow-hidden. */}
        <div className="-m-1 flex min-w-0 flex-1 items-center gap-1 overflow-hidden p-1">
          <TypeSwitch item={item} readOnly={trashed} />
          <span className="hidden h-5 min-w-0 items-center rounded-md bg-muted px-1.5 text-xs text-muted-foreground @[26rem]:inline-flex px-chip pixel:h-auto pixel:min-h-6">
            <span className="truncate">{trashed ? 'В корзине' : STATUS_LABEL[item.status]}</span>
          </span>
        </div>
        {trashed ? (
          <Button size="sm" variant="outline" className="pointer-coarse:h-9" onClick={() => void actRestoreFromTrash(item.id)}>
            Восстановить
          </Button>
        ) : (
          <>
          <Button
            variant="ghost"
            size="icon-sm"
            className="pointer-coarse:size-9 px-btn pixel:size-7.5 pixel:max-md:size-9 pixel:pointer-coarse:size-9"
            aria-label={item.favorite ? 'Убрать из избранного' : 'В избранное'}
            aria-pressed={item.favorite === 1}
            onClick={() => void actToggleFavorite(item)}
          >
            <Icon name="star" className={cn('size-4', item.favorite === 1 && 'fill-gold text-gold')} />
          </Button>
          <PrimaryAction item={item} />
          </>
        )}
        <ItemMenu item={item} variant="detail" />
        <Button variant="ghost" size="icon-sm" aria-label="Закрыть" onClick={onClose} className="hidden pointer-coarse:size-9 md:inline-flex px-btn pixel:size-7.5 pixel:max-md:size-9 pixel:pointer-coarse:size-9">
          <Icon name="x" className="size-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex flex-col gap-5 px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pixel:gap-3.5 pixel:px-2 pixel:pt-2.5">
          {trashed && <TrashNote item={item} />}
          <TitleField item={item} readOnly={trashed} />
          <ItemContent item={item} readOnly={trashed} />
          <AiSummary item={item} />

          {trashed ? (
            (item.categoryId || item.tags.length > 0) && (
              <section className="flex flex-col gap-2" aria-label="Организация">
                {item.categoryId && (
                  <div>
                    <CategoryBadge categoryId={item.categoryId} size="md" />
                  </div>
                )}
                {item.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {item.tags.map((t) => (
                      <TagChip key={t} tag={t} />
                    ))}
                  </div>
                )}
              </section>
            )
          ) : (
            <section className="flex flex-col gap-2" aria-label="Организация">
              <CategorySelect
                allowCreate
                value={item.categoryId}
                onChange={(categoryId) => void saveItem(item.id, { categoryId })}
              />
              <TagInput
                value={item.tags}
                placeholder="Добавить теги"
                onChange={(tags) => void saveTags(item.id, item.tags, tags)}
              />
            </section>
          )}

          <LinkedItems item={item} readOnly={trashed} />
          {!trashed && <AiSuggest item={item} />}

          <div className="border-t border-border pt-3 pixel:border-t-2">
            <Meta item={item} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Панель подробностей записи: правка на месте, связи, AI-подсказки. */
export function ItemDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const item = useItem(id)
  const all = useItemsWithTrash()
  // «Не найдена» определяем по полному списку: useItem отдаёт undefined и пока грузится.
  const missing = all !== undefined && !all.some((i) => i.id === id)

  useEffect(() => {
    // Если список уже переключил выбор на соседнюю запись — панель не закрываем.
    if (missing && useUi.getState().selectedId === id) onClose()
  }, [missing, onClose, id])

  if (!item || item.id !== id) return <div className="h-full bg-background" aria-busy="true" />
  // key по id сбрасывает все локальные состояния правки (и сохраняет черновик в cleanup).
  return <DetailBody key={id} item={item} onClose={onClose} />
}
