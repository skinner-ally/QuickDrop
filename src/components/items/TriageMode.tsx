import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Archive,
  ArrowLeft,
  ArrowRight,
  BookMarked,
  CircleCheck,
  ExternalLink,
  Link2,
  Sparkles,
  Star,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { updateItem, setCategory } from '@/db/repo'
import { useSettings } from '@/db/settings'
import { useAllItems } from '@/hooks/useItems'
import { suggestForItem } from '@/lib/ai'
import { actArchive, actDelete, actOpen, actToLibrary, actToggleFavorite } from '@/lib/actions'
import { displayTitle } from '@/lib/itemTitle'
import { normalizeTags, safeImageUrl, safeLinkUrl } from '@/lib/normalize'
import { cn } from '@/lib/utils'
import type { AiMeta, Item } from '@/types'
import { CategorySelect } from './CategorySelect'
import { CodeView } from './CodeView'
import { FilePreview } from './FilePreview'
import { TagChip } from './TagChip'
import { TagInput } from './TagInput'
import { TypeIcon } from './TypeIcon'

type Decision = 'library' | 'archive' | 'deleted'

function errMsg(e: unknown): string {
  return e instanceof Error && e.message ? e.message : 'Что-то пошло не так'
}

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  const role = el.getAttribute('role')
  // Кнопка-combobox (CategorySelect) вводом не считается: после выбора фокус остаётся на ней.
  if (role === 'combobox') return tag !== 'BUTTON'
  return role === 'textbox' || role === 'searchbox' || role === 'listbox' || role === 'menu'
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="ml-1 hidden rounded border border-current/25 px-1 font-sans text-[11px] leading-4 opacity-70 md:inline-block">
      {children}
    </kbd>
  )
}

function domainOf(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// ───────────────────────── содержимое записи ─────────────────────────

function LinkImage({ src }: { src: string | undefined }) {
  const safe = safeImageUrl(src)
  const [failed, setFailed] = useState(false)
  if (!safe || failed) return null
  return (
    <img
      src={safe}
      alt=""
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(true)}
      className="max-h-56 w-full rounded-lg border border-border object-cover"
    />
  )
}

function ItemBody({ item }: { item: Item }) {
  const comment = item.content?.trim()
  switch (item.type) {
    case 'code':
      return <CodeView code={item.content} language={item.language} />
    case 'image':
    case 'file':
      return (
        <div className="flex flex-col gap-3">
          <FilePreview item={item} variant="full" />
          {comment && <p className="text-sm whitespace-pre-wrap text-muted-foreground">{item.content}</p>}
        </div>
      )
    case 'link': {
      const href = safeLinkUrl(item.url)
      return (
        <div className="flex flex-col gap-3">
          <LinkImage key={item.id} src={item.linkMeta?.image} />
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link2 size={14} strokeWidth={1.75} className="shrink-0" aria-hidden />
            <span className="truncate">{domainOf(item.url)}</span>
            {href && (
              <Button variant="ghost" size="xs" onClick={() => actOpen(item)} aria-label="Открыть ссылку">
                <ExternalLink aria-hidden />
                Открыть
              </Button>
            )}
          </div>
          {item.linkMeta?.description && <p className="text-sm text-foreground/80">{item.linkMeta.description}</p>}
          {comment && <p className="text-sm whitespace-pre-wrap text-muted-foreground">{item.content}</p>}
        </div>
      )
    }
    default:
      return comment ? (
        <p className="text-[15px] leading-relaxed break-words whitespace-pre-wrap text-foreground/90">{item.content}</p>
      ) : null
  }
}

// ───────────────────────── редактор заголовка ─────────────────────────

/** Заголовок сохраняется по blur/Enter и при смене записи (key={id} размонтирует поле). */
function TitleField({ item }: { item: Item }) {
  const [draft, setDraft] = useState(item.title)
  const draftRef = useRef(draft)
  const savedRef = useRef(item.title)
  draftRef.current = draft

  const flush = useCallback(async () => {
    const next = draftRef.current.trim()
    if (next === savedRef.current.trim()) return
    savedRef.current = next
    try {
      await updateItem(item.id, { title: next })
    } catch (e) {
      toast.error(errMsg(e))
    }
  }, [item.id])

  // Если заголовок изменили снаружи (подсказка ИИ), поле подхватывает его.
  useEffect(() => {
    if (item.title !== savedRef.current) {
      savedRef.current = item.title
      setDraft(item.title)
    }
  }, [item.title])

  useEffect(() => () => void flush(), [flush])

  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void flush()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          void flush()
          e.currentTarget.blur()
        }
      }}
      placeholder={displayTitle({ ...item, title: '' })}
      aria-label="Заголовок записи"
      className="h-10 border-transparent bg-transparent px-2 text-lg font-medium shadow-none hover:border-input md:text-lg"
    />
  )
}

// ───────────────────────── подсказки ИИ ─────────────────────────

function AiSuggest({ item }: { item: Item }) {
  const settings = useSettings()
  const [loading, setLoading] = useState(false)
  const [meta, setMeta] = useState<AiMeta | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  if (!settings?.aiEnabled) return null

  async function run() {
    if (!settings) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    try {
      const result = await suggestForItem(item, settings, ctrl.signal)
      if (!ctrl.signal.aborted) setMeta(result)
    } catch (e) {
      if (!ctrl.signal.aborted) toast.error(errMsg(e))
    } finally {
      if (!ctrl.signal.aborted) setLoading(false)
    }
  }

  async function acceptTitle(title: string) {
    try {
      await updateItem(item.id, { title })
      setMeta((m) => (m ? { ...m, suggestedTitle: undefined } : m))
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  async function acceptTag(tag: string) {
    try {
      await updateItem(item.id, { tags: normalizeTags([...item.tags, tag]) })
      setMeta((m) => (m ? { ...m, suggestedTags: m.suggestedTags?.filter((t) => t !== tag) } : m))
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  const title = meta?.suggestedTitle?.trim()
  const tags = (meta?.suggestedTags ?? []).filter((t) => !item.tags.includes(t))

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => void run()} disabled={loading}>
        <Sparkles aria-hidden />
        {loading ? 'Думаю…' : 'Предложить теги'}
      </Button>
      {title && (
        <button
          type="button"
          onClick={() => void acceptTitle(title)}
          className="inline-flex h-6 max-w-full items-center rounded-md bg-muted px-2 text-[13px] text-foreground outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/60"
          aria-label={`Принять заголовок: ${title}`}
        >
          <span className="truncate">Заголовок: {title}</span>
        </button>
      )}
      {tags.map((t) => (
        <TagChip key={t} tag={t} onClick={() => void acceptTag(t)} />
      ))}
    </div>
  )
}

// ───────────────────────── большая кнопка действия ─────────────────────────

function ActionButton({
  label,
  hint,
  icon: Icon,
  onClick,
  primary,
  destructive,
  active,
}: {
  label: string
  hint: string
  icon: LucideIcon
  onClick: () => void
  primary?: boolean
  destructive?: boolean
  active?: boolean
}) {
  return (
    <Button
      variant={primary ? 'default' : destructive ? 'destructive' : 'outline'}
      size="lg"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-10 px-3.5 text-sm',
        primary && 'bg-brand text-brand-foreground hover:bg-brand/90',
      )}
    >
      <Icon strokeWidth={1.75} aria-hidden className={cn(active && 'fill-[var(--cat-amber)] text-[var(--cat-amber)]')} />
      {label}
      <Kbd>{hint}</Kbd>
    </Button>
  )
}

// ───────────────────────── сам режим ─────────────────────────

function TriageBody({ onClose }: { onClose: () => void }) {
  const all = useAllItems()
  // Очередь фиксируется при открытии: записи, которые уже разобрали, из неё не пропадают (можно вернуться «Назад»).
  const [queue, setQueue] = useState<string[] | null>(null)
  const [index, setIndex] = useState(0)
  const [decisions, setDecisions] = useState<ReadonlyMap<string, Decision>>(() => new Map())

  useEffect(() => {
    if (queue !== null || !all) return
    setQueue(
      all
        .filter((i) => i.status === 'inbox')
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((i) => i.id),
    )
  }, [all, queue])

  const byId = useMemo(() => new Map((all ?? []).map((i) => [i.id, i])), [all])
  const total = queue?.length ?? 0
  const item = queue ? byId.get(queue[index] ?? '') : undefined
  const finished = queue !== null && index >= total

  /** Ближайшая существующая запись в направлении dir; за концом очереди — экран «Всё разобрано». */
  const step = useCallback(
    (dir: 1 | -1) => {
      if (!queue) return
      setIndex((cur) => {
        let i = cur + dir
        while (i >= 0 && i < queue.length && !byId.has(queue[i])) i += dir
        if (i < 0) return cur
        return Math.min(i, queue.length)
      })
    },
    [queue, byId],
  )

  // Запись исчезла (удалена снаружи) — идём дальше.
  useEffect(() => {
    if (queue && all && !finished && !item) step(1)
  }, [queue, all, finished, item, step])

  const decide = useCallback(
    (decision: Decision) => {
      if (!item) return
      const id = item.id
      const run =
        decision === 'library' ? actToLibrary([id]) : decision === 'archive' ? actArchive([id]) : actDelete([id])
      void run
      setDecisions((m) => new Map(m).set(id, decision))
      step(1)
    },
    [item, step],
  )

  // ── клавиатура ──
  const handlers = useRef({ decide, step, item })
  handlers.current = { decide, step, item }
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing) return
      const { decide: act, step: go, item: cur } = handlers.current
      if (!cur) return

      // Ctrl/⌘+Enter работает и из полей ввода.
      if ((e.ctrlKey || e.metaKey) && e.code === 'Enter') {
        e.preventDefault()
        act('library')
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTyping(e.target)) return
      // Пока открыт выпадающий список или меню, клавиши принадлежат им.
      if (document.querySelector('[role="listbox"][data-open], [role="menu"][data-open], [data-slot="popover-content"][data-open]'))
        return

      if (e.repeat && ['KeyE', 'KeyA', 'KeyF', 'Delete', 'Backspace'].includes(e.code)) {
        e.preventDefault()
        return
      }

      switch (e.code) {
        case 'KeyE':
          e.preventDefault()
          act('library')
          break
        case 'KeyA':
          e.preventDefault()
          act('archive')
          break
        case 'Delete':
        case 'Backspace':
          e.preventDefault()
          act('deleted')
          break
        case 'ArrowRight':
        case 'KeyS':
          e.preventDefault()
          go(1)
          break
        case 'ArrowLeft':
          e.preventDefault()
          go(-1)
          break
        case 'KeyF':
          e.preventDefault()
          void actToggleFavorite(cur)
          break
        default:
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (queue === null) {
    return <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Загрузка…</div>
  }

  if (finished) {
    let toLibrary = 0
    let toArchive = 0
    let deleted = 0
    for (const d of decisions.values()) {
      if (d === 'library') toLibrary++
      else if (d === 'archive') toArchive++
      else deleted++
    }
    const skipped = Math.max(0, total - decisions.size)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <CircleCheck size={24} strokeWidth={1.5} aria-hidden />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-medium">{total === 0 ? 'Входящие пусты' : 'Всё разобрано'}</h2>
          <p className="text-[13px] text-muted-foreground">
            {total === 0 ? 'Разбирать пока нечего.' : 'Входящие просмотрены до конца.'}
          </p>
        </div>
        {total > 0 && (
          <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm">
            <dt className="text-left text-muted-foreground">В базу знаний</dt>
            <dd className="text-right font-medium tabular-nums">{toLibrary}</dd>
            <dt className="text-left text-muted-foreground">В архив</dt>
            <dd className="text-right font-medium tabular-nums">{toArchive}</dd>
            <dt className="text-left text-muted-foreground">Удалено</dt>
            <dd className="text-right font-medium tabular-nums">{deleted}</dd>
            {skipped > 0 && (
              <>
                <dt className="text-left text-muted-foreground">Пропущено</dt>
                <dd className="text-right font-medium tabular-nums">{skipped}</dd>
              </>
            )}
          </dl>
        )}
        <Button onClick={onClose} className="bg-brand text-brand-foreground hover:bg-brand/90">
          Готово
        </Button>
      </div>
    )
  }

  if (!item) return <div className="flex-1" />

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2.5 pr-12 text-[13px] text-muted-foreground">
        <TypeIcon type={item.type} />
        <span className="tabular-nums" aria-live="polite">
          {index + 1} из {total}
        </span>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full bg-brand transition-[width] duration-150" style={{ width: `${(index / total) * 100}%` }} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6 md:py-10">
          <TitleField key={item.id} item={item} />
          <div className="px-2">
            <ItemBody item={item} />
          </div>

          <div className="flex flex-col gap-3 border-t border-border px-2 pt-5">
            <div className="grid gap-3 sm:grid-cols-[14rem_1fr] sm:items-start">
              <CategorySelect
                value={item.categoryId}
                allowCreate
                onChange={(id) => {
                  setCategory([item.id], id).catch((e: unknown) => toast.error(errMsg(e)))
                }}
              />
              <TagInput
                value={item.tags}
                onChange={(tags) => {
                  updateItem(item.id, { tags }).catch((e: unknown) => toast.error(errMsg(e)))
                }}
              />
            </div>
            <AiSuggest key={item.id} item={item} />
          </div>
        </div>
      </div>

      <div className="border-t border-border bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-2">
          <ActionButton primary label="В базу знаний" hint="E" icon={BookMarked} onClick={() => decide('library')} />
          <ActionButton label="В архив" hint="A" icon={Archive} onClick={() => decide('archive')} />
          <ActionButton label="Пропустить" hint="→" icon={ArrowRight} onClick={() => step(1)} />
          <ActionButton label="Назад" hint="←" icon={ArrowLeft} onClick={() => step(-1)} />
          <ActionButton
            label="Избранное"
            hint="F"
            icon={Star}
            active={item.favorite === 1}
            onClick={() => void actToggleFavorite(item)}
          />
          <ActionButton destructive label="Удалить" hint="Del" icon={Trash2} onClick={() => decide('deleted')} />
        </div>
      </div>
    </div>
  )
}

/** Полноэкранный режим последовательного разбора входящих. */
export function TriageMode({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Фокус при открытии — на контейнер, а не в поле заголовка: иначе буквенные клавиши молчали бы.
  const focusRef = useRef<HTMLDivElement>(null)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        showCloseButton
        initialFocus={focusRef}
        className="top-0 left-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-background p-0 sm:max-w-none"
      >
        <DialogTitle className="sr-only">Разбор входящих</DialogTitle>
        <DialogDescription className="sr-only">
          Записи показываются по одной: в базу знаний, в архив, пропустить или удалить.
        </DialogDescription>
        <div ref={focusRef} tabIndex={-1} className="flex min-h-0 flex-1 flex-col outline-none">
          {open && <TriageBody onClose={onClose} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}
