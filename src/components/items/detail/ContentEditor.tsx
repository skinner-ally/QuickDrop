import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AutoTextarea } from './AutoTextarea'
import { useAutosave } from './autosave'

/** Пауза набора до автосохранения; blur, Ctrl+Enter и уход со страницы сохраняют сразу. */
const AUTOSAVE_DELAY = 800

/**
 * Просмотр + режим правки. Клик/кнопка «Изменить» → textarea;
 * Ctrl/⌘+Enter или blur — сохранить, Esc — отменить.
 */
export function ContentEditor({
  value: saved,
  onSave,
  renderView,
  placeholder,
  mono,
  label,
}: {
  value: string
  onSave: (value: string) => unknown
  renderView: (value: string) => React.ReactNode
  placeholder: string
  mono?: boolean
  label: string
}) {
  const [editing, setEditing] = useState(false)
  const { value, setValue, flush } = useAutosave(saved, onSave, AUTOSAVE_DELAY)
  const ref = useRef<HTMLTextAreaElement>(null)
  // Значение на входе в правку: Esc откатывает к нему, даже если таймер уже автосохранил часть набранного.
  const originRef = useRef(saved)

  useEffect(() => {
    if (!editing) return
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  function startEdit(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('button, a')) return // кнопка/ссылка внутри просмотра (напр. «Копировать»)
    if (window.getSelection()?.toString()) return // выделяют текст — не переходим в правку
    originRef.current = value
    setEditing(true)
  }

  if (editing) {
    return (
      <AutoTextarea
        ref={ref}
        value={value}
        aria-label={label}
        placeholder={placeholder}
        spellCheck={!mono}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          flush()
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            setValue(originRef.current)
            flush()
            setEditing(false)
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            flush()
            setEditing(false)
          }
        }}
        className={cn('min-h-24 resize-none', mono && 'font-mono text-xs leading-relaxed md:text-xs')}
      />
    )
  }

  return (
    <div className="group/content relative">
      <div
        onClick={startEdit}
        className="-mx-1 cursor-text rounded-md px-1 py-0.5 hover:bg-muted/40"
      >
        {value.trim() ? (
          renderView(value)
        ) : (
          <div className="text-sm text-muted-foreground">{placeholder}</div>
        )}
      </div>
      <Button
        variant="ghost"
        size="xs"
        onClick={() => {
          originRef.current = value
          setEditing(true)
        }}
        aria-label={`Изменить: ${label}`}
        className="mt-1 text-muted-foreground"
      >
        <Icon name="pencil" className="size-4" />
        Изменить
      </Button>
    </div>
  )
}
