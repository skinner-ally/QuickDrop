import { CodeView } from '@/components/items/CodeView'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { LANGUAGES } from '@/lib/detect'
import type { Item } from '@/types'
import { AutoLinkText } from './AutoLinkText'
import { ContentEditor } from './ContentEditor'
import { FileBlock } from './FileBlock'
import { LinkCard } from './LinkCard'
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

/** Блок содержимого — зависит от типа записи. */
export function ItemContent({ item }: { item: Item }) {
  switch (item.type) {
    case 'code':
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <LanguageSelect item={item} />
          </div>
          <ContentEditor
            label="Код"
            mono
            placeholder="Вставьте код"
            value={item.content}
            onSave={saveContent(item)}
            renderView={(v) => <CodeView code={v} language={item.language} />}
          />
        </div>
      )
    case 'link':
      return (
        <div className="flex flex-col gap-3">
          <LinkCard item={item} />
          <ContentEditor
            label="Заметка"
            placeholder="Добавить заметку…"
            value={item.content}
            onSave={saveContent(item)}
            renderView={(v) => <AutoLinkText text={v} />}
          />
        </div>
      )
    case 'file':
    case 'image':
      return (
        <div className="flex flex-col gap-3">
          <FileBlock item={item} />
          <ContentEditor
            label="Заметка"
            placeholder="Добавить заметку…"
            value={item.content}
            onSave={saveContent(item)}
            renderView={(v) => <AutoLinkText text={v} />}
          />
        </div>
      )
    default:
      return (
        <ContentEditor
          label="Текст"
          placeholder="Добавьте текст…"
          value={item.content}
          onSave={saveContent(item)}
          renderView={(v) => <AutoLinkText text={v} />}
        />
      )
  }
}
