import { Suspense, useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { InboxIcon, Paperclip, SearchX, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ErrorBoundary, lazyRetry, RetryFallback } from '@/components/layout/ErrorBoundary'
import { EmptyState } from '@/components/items/EmptyState'
import { FilterBar } from '@/components/items/FilterBar'
import { ItemList } from '@/components/items/ItemList'
import { useCounts, useVisibleItems } from '@/hooks/useItems'
import { createAndEnrich } from '@/lib/actions'
import { detectInput } from '@/lib/detect'
import { describeError } from '@/lib/errors'
import { useUi } from '@/store/ui'
import type { NewItemInput } from '@/types'

const loadTriage = () => import('@/components/items/TriageMode')
const triageLazy = lazyRetry(() => loadTriage(), (m) => m.TriageMode)
const TriageMode = triageLazy.Component

function waitingText(n: number): string {
  if (n === 0) return 'Всё разобрано'
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return `${n} запись ждёт разбора`
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} записи ждут разбора`
  return `${n} записей ждут разбора`
}

function inputFromText(text: string): NewItemInput {
  const d = detectInput(text)
  const base = { status: 'inbox', source: 'manual' } as const
  if (d.type === 'link') return { ...base, type: 'link', url: d.url }
  if (d.type === 'code') return { ...base, type: 'code', content: d.stripped ?? text, language: d.language }
  return { ...base, type: 'text', content: text }
}

/** Строка мгновенного добавления: Enter сохраняет, скрепка открывает полную панель. */
function QuickAdd() {
  const openCapture = useUi((s) => s.openCapture)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  async function submit() {
    const value = text.trim()
    if (!value || busy) return
    setBusy(true)
    try {
      await createAndEnrich(inputFromText(value))
      setText('')
    } catch (e) {
      toast.error(describeError(e, 'Не удалось сохранить запись'))
    } finally {
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    void submit()
  }

  // В однострочное поле многострочный текст не влезет — отдаём его полной панели добавления.
  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData('text')
    if (!pasted.includes('\n')) return
    e.preventDefault()
    openCapture({ text: (text ? text + ' ' : '') + pasted })
    setText('')
  }

  return (
    <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <Zap
          size={15}
          strokeWidth={1.75}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          readOnly={busy}
          aria-busy={busy}
          placeholder="Быстрая запись — Enter, чтобы сохранить"
          aria-label="Быстрая запись"
          enterKeyHint="done"
          className="h-9 pl-8"
        />
      </div>
      <Button
        variant="outline"
        size="icon-lg"
        onClick={() => openCapture(text.trim() ? { text } : undefined)}
        aria-label="Добавить файл или подробную запись"
      >
        <Paperclip strokeWidth={1.75} className="size-4" aria-hidden />
      </Button>
    </div>
  )
}

export function InboxView() {
  const { hits, total, loading } = useVisibleItems({ status: 'inbox' })
  const counts = useCounts()
  const query = useUi((s) => s.query)
  const setQuery = useUi((s) => s.setQuery)
  const filter = useUi((s) => s.filter)
  const resetFilter = useUi((s) => s.resetFilter)
  const [triage, setTriage] = useState(false)
  // После первого открытия остаётся смонтированным — чтобы работала анимация закрытия.
  const [triageUsed, setTriageUsed] = useState(false)
  if (triage && !triageUsed) setTriageUsed(true)

  // Подгружаем чанк разбора в простое — первое открытие не ждёт сети.
  useEffect(() => {
    const h = window.setTimeout(() => void loadTriage().catch(() => undefined), 1500)
    return () => window.clearTimeout(h)
  }, [])

  const narrowed = query.trim() !== '' || Object.values(filter).some((v) => v !== undefined)

  const noResults = (
    <EmptyState
      icon={SearchX}
      title="Ничего не найдено"
      description="Попробуйте изменить запрос или ослабить фильтры."
      action={
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            resetFilter()
            setQuery('')
          }}
        >
          Сбросить
        </Button>
      }
    />
  )

  const allClear = (
    <EmptyState
      icon={InboxIcon}
      title="Входящие разобраны"
      description={
        <>
          Новая запись попадёт сюда.{' '}
          <span className="pointer-coarse:hidden">
            Нажмите <kbd className="rounded border border-border px-1 font-sans text-xs">N</kbd>, чтобы быстро добавить.
          </span>
          <span className="hidden pointer-coarse:inline">Нажмите «Добавить», чтобы сохранить запись.</span>
        </>
      }
    />
  )

  return (
    <section
      aria-label="Входящие"
      className="flex min-h-0 flex-1 flex-col gap-3 px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">Входящие</h1>
            {counts.inbox > 0 && (
              <span className="rounded-full bg-brand-soft px-2 py-px text-xs font-medium text-brand tabular-nums">
                {counts.inbox}
              </span>
            )}
          </div>
          <p className="text-[13px] text-muted-foreground" aria-live="polite">
            {waitingText(counts.inbox)}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <Button size="sm" disabled={counts.inbox === 0} onClick={() => setTriage(true)}>
            Разобрать
          </Button>
        </div>
      </header>

      <QuickAdd />
      <FilterBar />

      {loading ? null : (
        // ItemList остаётся смонтированным и при пустой выдаче: он закрывает детали ушедшей записи.
        <ItemList
          hits={hits}
          variant="inbox"
          emptyState={hits.length === 0 && !(narrowed || total > 0) ? allClear : noResults}
        />
      )}

      {triageUsed && (
        <ErrorBoundary
          onReset={triageLazy.reset}
          fallback={(_e, reset) => <RetryFallback message="Не удалось загрузить режим разбора. Проверьте соединение." reset={reset} />}
        >
          <Suspense fallback={null}>
            <TriageMode open={triage} onClose={() => setTriage(false)} />
          </Suspense>
        </ErrorBoundary>
      )}
    </section>
  )
}
