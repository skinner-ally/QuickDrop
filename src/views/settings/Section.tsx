import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { createCommitter, type CommitDeps, type Committer } from './commitInput'

export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3 border-t pt-6 px-panel-thin pixel:gap-1.5 pixel:[--px-pad:10px]">
      <header className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="text-md font-medium pixel:text-2sm pixel:font-semibold pixel:text-muted-foreground">
          {title}
        </h2>
        {description && <p className="text-2sm text-muted-foreground">{description}</p>}
      </header>
      <div className="flex flex-col gap-3 pixel:gap-2">{children}</div>
    </section>
  )
}

/** Подпись + контрол. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  hint?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-1.5 px-divider pixel:pt-2', className)}>
      <label htmlFor={htmlFor} className="text-2sm font-medium pixel:font-semibold">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** Строка «текст слева, действие справа». */
export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex items-center justify-between gap-3 px-divider pixel:gap-4 pixel:pt-2 pixel:max-md:flex-wrap', className)}>{children}</div>
}

export function saved() {
  toast.success('Сохранено', { duration: 1200 })
}

/**
 * Поле с локальным черновиком: сохраняет по Enter и при потере фокуса, если значение валидно.
 * validate возвращает текст ошибки или null.
 */
export function CommitInput({
  id,
  value,
  onCommit,
  validate,
  type = 'text',
  placeholder,
  trailing,
  inlineCommitError = false,
}: {
  id?: string
  value: string
  onCommit: (v: string) => Promise<void> | void
  validate?: (v: string) => string | null
  type?: string
  placeholder?: string
  trailing?: ReactNode
  /**
   * Отказ onCommit показывать под полем (как ошибку проверки), а не всплывающим сообщением. Для полей, где
   * отказ — частый и ожидаемый исход (порт занят, сочетание занято): сообщение не исчезает, пока поле не исправят.
   */
  inlineCommitError?: boolean
}) {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const deps = useRef<CommitDeps | null>(null)
  deps.current = { onCommit, validate, inlineCommitError, setError, saved, toastError: (m) => toast.error(m) }
  const committer = useRef<Committer | null>(null)
  committer.current ??= createCommitter(() => deps.current!)
  useEffect(() => {
    setDraft(value)
    setError(null)
    committer.current?.reset()
  }, [value])

  /** force — Enter: осознанный повтор отвергнутого значения (порт или сочетание освободили). */
  const commit = (force = false) => committer.current!.commit(draft, value, force)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <Input
          id={id}
          type={type}
          value={draft}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setDraft(e.target.value)
            committer.current?.reset()
          }}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit(true)
            if (e.key === 'Escape') {
              setDraft(value)
              setError(null)
              committer.current?.reset()
            }
          }}
        />
        {trailing}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
