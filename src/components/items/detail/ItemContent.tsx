import { CodeView } from '@/components/items/CodeView'
import { MarkdownText } from '@/components/markdown/MarkdownText'
import { ViewModeToggle } from '@/components/markdown/ViewModeToggle'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { actApplyWikiLinks } from '@/lib/actions'
import { LANGUAGES } from '@/lib/detect'
import { useUi } from '@/store/ui'
import type { Item } from '@/types'
import { AutoLinkText } from './AutoLinkText'
import { ContentEditor } from './ContentEditor'
import { FileBlock } from './FileBlock'
import { LinkCard } from './LinkCard'
import { OcrBlock } from './OcrBlock'
import { saveItem } from './save'

const PLAIN = '__plain'

function LanguageSelect({ item }: { item: Item }) {
  const current = item.language && LANGUAGES.some((l) => l.id === item.language) ? item.language : PLAIN
  return (
    <Select
      value={current}
      onValueChange={(v) => {
        if (v) void saveItem(item.id, { language: v === PLAIN ? undefined : v })
      }}
    >
      <SelectTrigger size="sm" aria-label="Язык кода" className="w-40">
        <SelectValue>
          {(v: string) => (v === PLAIN ? 'Без подсветки' : (LANGUAGES.find((l) => l.id === v)?.label ?? v))}
        </SelectValue>
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start" className="max-h-72 w-auto min-w-40">
        <SelectItem value={PLAIN}>Без подсветки</SelectItem>
        {LANGUAGES.map((l) => (
          <SelectItem key={l.id} value={l.id}>
            {l.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const saveContent = (item: Item) => (content: string) => saveItem(item.id, { content })

/**
 * Текст с разметкой: отрисованный Markdown или исходник — по общему переключателю «Просмотр / Исходник».
 * Связи по [[…]] создаются при выходе из правки, а не на каждом автосохранении: иначе при наборе
 * «[[План на год]]» появилась бы связь с «План».
 */
function MarkdownContent({
  item,
  readOnly,
  label,
  placeholder,
  density,
}: {
  item: Item
  readOnly?: boolean
  label: string
  placeholder: string
  density?: 'compact'
}) {
  const mdPreview = useUi((s) => s.mdPreview)
  return (
    <ContentEditor
      label={label}
      placeholder={placeholder}
      value={item.content}
      onSave={saveContent(item)}
      readOnly={readOnly}
      toolbar={<ViewModeToggle />}
      onCommitted={(v) => void actApplyWikiLinks(item.id, v)}
      renderView={(v, api) =>
        mdPreview ? (
          <MarkdownText source={v} selfId={item.id} density={density} onChange={readOnly ? undefined : api.change} />
        ) : (
          <AutoLinkText text={v} />
        )
      }
    />
  )
}

/** Блок содержимого — зависит от типа записи. readOnly — запись в корзине: только просмотр. */
export function ItemContent({ item, readOnly }: { item: Item; readOnly?: boolean }) {
  switch (item.type) {
    case 'code':
      return (
        <div className="flex flex-col gap-2">
          {!readOnly && (
            <div className="flex items-center gap-2">
              <LanguageSelect item={item} />
            </div>
          )}
          <ContentEditor
            label="Код"
            mono
            placeholder="Вставьте код"
            value={item.content}
            onSave={saveContent(item)}
            readOnly={readOnly}
            renderView={(v) => <CodeView code={v} language={item.language} />}
          />
        </div>
      )
    case 'link':
      return (
        <div className="flex flex-col gap-3">
          <LinkCard item={item} readOnly={readOnly} />
          <MarkdownContent
            item={item}
            readOnly={readOnly}
            label="Заметка"
            placeholder="Добавить заметку…"
            density="compact"
          />
        </div>
      )
    case 'file':
    case 'image':
      return (
        <div className="flex flex-col gap-3">
          <FileBlock item={item} />
          <OcrBlock key={item.id} item={item} readOnly={readOnly} />
          <MarkdownContent
            item={item}
            readOnly={readOnly}
            label="Заметка"
            placeholder="Добавить заметку…"
            density="compact"
          />
        </div>
      )
    default:
      return <MarkdownContent item={item} readOnly={readOnly} label="Текст" placeholder="Добавьте текст…" />
  }
}
