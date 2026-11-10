import type { Item } from '@/types'
import { displayTitle } from '@/lib/itemTitle'
import { cn } from '@/lib/utils'
import { AutoTextarea } from './AutoTextarea'
import { useAutosave } from './autosave'
import { saveItem } from './save'

/** Заголовок, редактируемый на месте. */
export function TitleField({ item }: { item: Item }) {
  const { value, setValue, flush, revert } = useAutosave(
    item.title,
    (title) => saveItem(item.id, { title: title.trim() }),
    700,
    (v) => v.trim(),
  )

  return (
    <AutoTextarea
      value={value}
      aria-label="Заголовок"
      placeholder={displayTitle({ ...item, title: '' })}
      onChange={(e) => setValue(e.target.value.replace(/\r?\n/g, ' '))}
      onBlur={flush}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          flush()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          revert()
          e.currentTarget.blur()
        }
      }}
      className={cn(
        'min-h-0 resize-none rounded-md border-0 bg-transparent px-1 py-0.5 -mx-1 text-lg leading-snug font-semibold shadow-none',
        'placeholder:text-muted-foreground hover:bg-muted/50 focus-visible:bg-transparent focus-visible:ring-2 focus-visible:ring-ring/50 md:text-lg dark:bg-transparent',
      )}
    />
  )
}
