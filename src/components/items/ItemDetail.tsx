import { useEffect } from 'react'
import { Icon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAllItems, useItem } from '@/hooks/useItems'
import { actArchive, actToLibrary, actToggleFavorite, actUnarchive } from '@/lib/actions'
import { formatDateTime, TYPE_LABEL } from '@/lib/itemTitle'
import { cn } from '@/lib/utils'
import { useUi } from '@/store/ui'
import type { Item, ItemSource, ItemStatus, ItemType } from '@/types'
import { CategorySelect } from './CategorySelect'
import { AiSuggest, AiSummary } from './detail/AiSuggest'
import { ItemContent } from './detail/ItemContent'
import { LinkedItems } from './detail/LinkedItems'
import { saveItem, saveTags } from './detail/save'
import { TitleField } from './detail/TitleField'
import { ItemMenu } from './ItemMenu'
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
}

const SWITCHABLE: ItemType[] = ['text', 'idea', 'code']

function TypeSwitch({ item }: { item: Item }) {
  const label = TYPE_LABEL[item.type]
  if (!SWITCHABLE.includes(item.type)) {
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
        className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-sm text-muted-foreground transition-colors outline-none select-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 aria-expanded:bg-muted"
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
        className="bg-brand text-brand-foreground hover:bg-brand/90"
        onClick={() => void actToLibrary(item.id)}
      >
        В базу знаний
      </Button>
    )
  }
  if (item.status === 'library') {
    return (
      <Button size="sm" variant="outline" onClick={() => void actArchive(item.id)}>
        В архив
      </Button>
    )
  }
  return (
    <Button size="sm" variant="outline" onClick={() => void actUnarchive(item.id)}>
      Вернуть
    </Button>
  )
}

function Meta({ item }: { item: Item }) {
  const rows: Array<[string, string]> = [
    ['Создано', formatDateTime(item.createdAt)],
    ['Изменено', formatDateTime(item.updatedAt)],
  ]
  if (item.processedAt) rows.push(['Обработано', formatDateTime(item.processedAt)])
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

function DetailBody({ item, onClose }: { item: Item; onClose: () => void }) {
  return (
    <div className="@container flex h-full min-h-0 flex-col bg-background">
      <header className="sticky top-0 z-10 flex shrink-0 items-center gap-1 border-b border-border bg-background px-2 py-1.5">
        <Button variant="ghost" size="icon-sm" aria-label="Назад" onClick={onClose} className="pointer-coarse:size-9 md:hidden">
          <Icon name="arrow-left" className="size-4" />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <TypeSwitch item={item} />
          <span className="hidden h-5 items-center rounded-md bg-muted px-1.5 text-xs text-muted-foreground @sm:inline-flex">
            {STATUS_LABEL[item.status]}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="pointer-coarse:size-9"
          aria-label={item.favorite ? 'Убрать из избранного' : 'В избранное'}
          aria-pressed={item.favorite === 1}
          onClick={() => void actToggleFavorite(item)}
        >
          {/* pixel:text-inherit: в пиксельных сценах нажатая кнопка сама золотая, значок берёт её цвет текста */}
          <Icon name="star" className={cn('size-4', item.favorite === 1 && 'fill-gold text-gold pixel:text-inherit')} />
        </Button>
        <PrimaryAction item={item} />
        <ItemMenu item={item} variant="detail" />
        <Button variant="ghost" size="icon-sm" aria-label="Закрыть" onClick={onClose} className="hidden pointer-coarse:size-9 md:inline-flex">
          <Icon name="x" className="size-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex flex-col gap-5 px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <TitleField item={item} />
          <ItemContent item={item} />
          <AiSummary item={item} />

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

          <LinkedItems item={item} />
          <AiSuggest item={item} />

          <div className="border-t border-border pt-3">
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
  const all = useAllItems()
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
