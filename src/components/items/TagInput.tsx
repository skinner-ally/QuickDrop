import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAllTags } from '@/hooks/useItems'
import { normalizeTag, normalizeTags, tagKey } from '@/lib/normalize'
import { cn } from '@/lib/utils'
import { TagChip } from './TagChip'

const MAX_SUGGESTIONS = 8

export function TagInput({
  value,
  onChange,
  placeholder = 'Добавить тег',
  autoFocus,
  className,
}: {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
}) {
  const allTags = useAllTags()
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(-1)

  const typed = normalizeTag(text)
  const typedKey = tagKey(text)
  const taken = useMemo(() => new Set(value.map(tagKey)), [value])

  const suggestions = useMemo(() => {
    const free = allTags.filter((t) => !taken.has(tagKey(t.tag)))
    if (!typedKey) return free.slice(0, MAX_SUGGESTIONS)
    const starts = free.filter((t) => tagKey(t.tag).startsWith(typedKey))
    const inside = free.filter((t) => !tagKey(t.tag).startsWith(typedKey) && tagKey(t.tag).includes(typedKey))
    return [...starts, ...inside].slice(0, MAX_SUGGESTIONS)
  }, [allTags, taken, typedKey])

  const canCreate = typed !== '' && !taken.has(typedKey) && !suggestions.some((s) => tagKey(s.tag) === typedKey)
  const optionCount = suggestions.length + (canCreate ? 1 : 0)
  const open = focused && optionCount > 0
  const rootRef = useRef<HTMLDivElement>(null)
  const [flipUp, setFlipUp] = useState(false)

  // Список подсказок не должен обрезаться прокручиваемым предком (например, диалогом):
  // если снизу не хватает места, а сверху больше — раскрываем вверх.
  useLayoutEffect(() => {
    if (!open) return
    const root = rootRef.current
    if (!root) return
    let bound = window.innerHeight
    let top = 0
    for (let el = root.parentElement; el; el = el.parentElement) {
      const o = getComputedStyle(el).overflowY
      if (o === 'auto' || o === 'scroll' || o === 'hidden') {
        const r = el.getBoundingClientRect()
        bound = r.bottom
        top = r.top
        break
      }
    }
    const rect = root.getBoundingClientRect()
    const below = bound - rect.bottom
    const above = rect.top - top
    setFlipUp(below < 232 && above > below)
  }, [open, optionCount])

  function add(raw: string[]) {
    const fresh = normalizeTags(raw).filter((t) => !taken.has(tagKey(t)))
    const unique = fresh.filter((t, i) => fresh.findIndex((x) => tagKey(x) === tagKey(t)) === i)
    if (unique.length) onChange([...value, ...unique])
  }

  function commitCurrent(): boolean {
    if (active >= 0 && active < suggestions.length) {
      add([suggestions[active].tag])
    } else if (typed) {
      add([typed])
    } else {
      return false
    }
    setText('')
    setActive(-1)
    return true
  }

  function handleChange(next: string) {
    // Запятая, пробел и вставка «a, b, c» режут ввод на теги; хвост остаётся в поле.
    if (/[,\s]/.test(next)) {
      const parts = next.split(/[,\s]+/)
      const tail = parts.pop() ?? ''
      add(parts)
      setText(tail)
    } else {
      setText(next)
    }
    setActive(-1)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return
    switch (e.key) {
      case 'Enter':
        if (commitCurrent()) {
          e.preventDefault()
          e.stopPropagation()
        }
        break
      case 'Tab':
        if (!e.shiftKey && (typed || active >= 0) && commitCurrent()) e.preventDefault()
        break
      case 'Backspace':
        if (text === '' && value.length > 0) onChange(value.slice(0, -1))
        break
      case 'ArrowDown':
        if (optionCount > 0) {
          e.preventDefault()
          setActive((a) => (a + 1) % optionCount)
        }
        break
      case 'ArrowUp':
        if (optionCount > 0) {
          e.preventDefault()
          setActive((a) => (a <= 0 ? optionCount - 1 : a - 1))
        }
        break
      case 'Escape':
        if (open) {
          e.preventDefault()
          e.stopPropagation()
          setFocused(false)
        }
        break
    }
  }

  function pick(index: number) {
    if (index < suggestions.length) add([suggestions[index].tag])
    else add([typed])
    setText('')
    setActive(-1)
    inputRef.current?.focus()
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <div
        onClick={() => inputRef.current?.focus()}
        className="flex min-h-8 flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-1.5 py-1 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30"
      >
        {value.map((tag) => (
          <TagChip key={tag} tag={tag} onRemove={() => onChange(value.filter((t) => t !== tag))} />
        ))}
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            // Набранный, но не подтверждённый текст не должен теряться (например, при клике на «Сохранить»).
            if (typed) {
              add([typed])
              setText('')
              setActive(-1)
            }
          }}
          autoFocus={autoFocus}
          placeholder={value.length === 0 ? placeholder : ''}
          aria-label="Теги"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className="h-5 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Подсказки тегов"
          // mousedown не должен забирать фокус у поля — иначе подсказки закроются раньше клика
          onMouseDown={(e) => e.preventDefault()}
          className={cn(
            'absolute right-0 left-0 z-50 max-h-56 overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10',
            flipUp ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          {suggestions.map((s, i) => (
            <li
              key={s.tag}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={active === i}
              onClick={() => pick(i)}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex cursor-default items-center gap-2 rounded-md px-2 py-1 text-sm',
                active === i && 'bg-muted',
              )}
            >
              <span className="min-w-0 flex-1 truncate">#{s.tag}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{s.count}</span>
            </li>
          ))}
          {canCreate && (
            <li
              id={`${listId}-${suggestions.length}`}
              role="option"
              aria-selected={active === suggestions.length}
              onClick={() => pick(suggestions.length)}
              onMouseEnter={() => setActive(suggestions.length)}
              className={cn(
                'flex cursor-default items-center gap-2 rounded-md px-2 py-1 text-sm',
                active === suggestions.length && 'bg-muted',
              )}
            >
              <span className="min-w-0 flex-1 truncate">Создать «#{typed}»</span>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
