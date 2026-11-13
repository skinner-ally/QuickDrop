import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AutoTextarea } from './AutoTextarea'
import { useAutosave } from './autosave'

/** Пауза набора до автосохранения; blur, Ctrl+Enter и уход со страницы сохраняют сразу. */
const AUTOSAVE_DELAY = 800

/** Что просмотр может сделать с текстом, не открывая правку (например, отметить задачу). */
export interface ContentViewApi {
  /** Заменить текст целиком и сразу сохранить. */
  change: (next: string) => void
}

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
  readOnly,
  toolbar,
  onCommitted,
  onEditingChange,
}: {
  value: string
  onSave: (value: string) => unknown
  renderView: (value: string, api: ContentViewApi) => React.ReactNode
  placeholder: string
  mono?: boolean
  label: string
  /** Нет перехода в правку и кнопки «Изменить»; пустое значение — ничего не рисуется. */
  readOnly?: boolean
  /** Справа в строке под текстом (рядом с «Изменить»); только при непустом значении. */
  toolbar?: React.ReactNode
  /** Выход из правки с изменённым текстом: blur, Ctrl/⌘+Enter, размонтирование во время правки (Esc и тот же текст — нет). */
  onCommitted?: (value: string) => void
  /** Поле правки открыто или закрыто (при размонтировании — false). */
  onEditingChange?: (editing: boolean) => void
}) {
  const [editing, setEditing] = useState(false)
  const { value, setValue, flush } = useAutosave(saved, onSave, AUTOSAVE_DELAY)
  const ref = useRef<HTMLTextAreaElement>(null)
  // Значение на входе в правку: Esc откатывает к нему, даже если таймер уже автосохранил часть набранного.
  const originRef = useRef(saved)
  // Правка идёт: ref, а не состояние — выход из правки (Esc, а за ним blur при размонтировании поля)
  // должен сообщить onCommitted ровно один раз.
  const editingRef = useRef(false)
  const valueRef = useRef(value)
  const committedRef = useRef(onCommitted)
  useEffect(() => {
    valueRef.current = value
    committedRef.current = onCommitted
  })

  const change = useCallback(
    (next: string) => {
      setValue(next)
      flush()
    },
    [setValue, flush],
  )
  const api = useMemo<ContentViewApi>(() => ({ change }), [change])

  const finish = useCallback(
    (current: string) => {
      if (!editingRef.current) return
      editingRef.current = false
      flush()
      setEditing(false)
      // Текст не менялся (в том числе Esc): связи не пересоздаются — иначе убранная в «Связанных» вернулась бы.
      if (current !== originRef.current) committedRef.current?.(current)
    },
    [flush],
  )

  const editingChangeRef = useRef(onEditingChange)
  useEffect(() => {
    editingChangeRef.current = onEditingChange
  })
  useEffect(() => {
    editingChangeRef.current?.(editing && !readOnly)
  }, [editing, readOnly])
  useEffect(() => () => editingChangeRef.current?.(false), [])

  useEffect(() => {
    if (!editing) return
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  // Запись стала только для чтения посреди правки (например, ушла в корзину) — правка завершается.
  useEffect(() => {
    if (readOnly) finish(valueRef.current)
  }, [readOnly, finish])

  // Панель закрыли или сменили запись во время правки: связи по [[…]] создаются и в этом случае.
  // useAutosave уже сохранил текст своей очисткой (она объявлена раньше и выполняется первой).
  useEffect(
    () => () => {
      if (!editingRef.current) return
      editingRef.current = false
      flush()
      if (valueRef.current !== originRef.current) committedRef.current?.(valueRef.current)
    },
    [flush],
  )

  function beginEdit() {
    originRef.current = value
    editingRef.current = true
    setEditing(true)
  }

  function startEdit(e: React.MouseEvent) {
    // кнопка, ссылка или флажок задачи внутри просмотра (напр. «Копировать», вики-ссылка)
    if ((e.target as HTMLElement).closest('button, a, input, [role="checkbox"]')) return
    if (window.getSelection()?.toString()) return // выделяют текст — не переходим в правку
    beginEdit()
  }

  if (editing && !readOnly) {
    return (
      <AutoTextarea
        ref={ref}
        value={value}
        aria-label={label}
        placeholder={placeholder}
        spellCheck={!mono}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            setValue(originRef.current)
            finish(originRef.current)
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            finish(value)
          }
        }}
        className={cn('min-h-24 resize-none', mono && 'font-mono text-xs leading-relaxed md:text-xs')}
      />
    )
  }

  const filled = value.trim() !== ''
  if (readOnly && !filled) return null

  const editButton = (className: string) => (
    <Button
      variant="ghost"
      size="xs"
      onClick={beginEdit}
      aria-label={`Изменить: ${label}`}
      className={className}
    >
      <Icon name="pencil" className="size-4" />
      Изменить
    </Button>
  )

  return (
    <div className="group/content relative">
      <div
        onClick={readOnly ? undefined : startEdit}
        className={cn(
          '-mx-1 rounded-md px-1 py-0.5',
          !readOnly && 'cursor-text hover:bg-muted/40',
          !mono && 'px-well pixel:mx-0 pixel:p-2',
        )}
      >
        {filled ? renderView(value, api) : <div className="text-sm text-muted-foreground">{placeholder}</div>}
      </div>
      {toolbar && filled ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {!readOnly && editButton('text-muted-foreground')}
          <div className="ml-auto">{toolbar}</div>
        </div>
      ) : (
        !readOnly && editButton('mt-1 text-muted-foreground')
      )}
    </div>
  )
}
