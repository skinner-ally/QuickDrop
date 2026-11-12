import { newId } from '@/lib/id'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ClipboardEvent, DragEvent, KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { Icon } from '@/components/icons'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TypeIcon } from '@/components/items/TypeIcon'
import { CategorySelect } from '@/components/items/CategorySelect'
import { TagInput } from '@/components/items/TagInput'
import { MAX_FILE_SIZE, listCategories } from '@/db/repo'
import { createAndEnrich } from '@/lib/actions'
import { pastedFiles } from '@/lib/clipboard'
import { LANGUAGES, detectFileType, detectInput, isUrl, normalizeUrl } from '@/lib/detect'
import { describeError } from '@/lib/errors'
import { formatBytes, TYPE_LABEL } from '@/lib/itemTitle'
import { isMac } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { useUi } from '@/store/ui'
import type { CaptureDraft } from '@/store/ui'
import { ITEM_TYPES } from '@/types'
import type { ItemSource, ItemType, NewItemInput } from '@/types'

const DRAFT_KEY = 'quickdrop:capture-draft'
/** Пауза ввода, после которой черновик пишется в sessionStorage. */
const DRAFT_DELAY = 400
/** Выше этого размера ввод разбирается не чаще раза в 300 мс. */
const BIG_INPUT = 200 * 1024

const LANGUAGE_ITEMS = LANGUAGES.map((l) => ({ value: l.id, label: l.label }))

interface DraftSnapshot {
  text: string
  title: string
  tags: string[]
  categoryId: string | null
  manualType: ItemType | null
}

interface FileEntry {
  id: string
  file: File
  source: ItemSource
}

function readDraft(): DraftSnapshot | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as Partial<DraftSnapshot>
    if (typeof d.text !== 'string' || !d.text.trim()) return null
    return {
      text: d.text,
      title: typeof d.title === 'string' ? d.title : '',
      tags: Array.isArray(d.tags) ? d.tags.filter((t): t is string => typeof t === 'string') : [],
      categoryId: typeof d.categoryId === 'string' ? d.categoryId : null,
      manualType: ITEM_TYPES.includes(d.manualType as ItemType) ? (d.manualType as ItemType) : null,
    }
  } catch {
    return null
  }
}

function writeDraft(d: DraftSnapshot | null): void {
  try {
    if (d) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d))
    else sessionStorage.removeItem(DRAFT_KEY)
  } catch {
    // sessionStorage может быть недоступен — черновик необязателен
  }
}

const COARSE_QUERY = '(pointer: coarse)'

/** Сенсорный ввод (телефон): там нет Shift+Enter, поэтому Enter в тексте — всегда перенос строки. */
function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const mq = window.matchMedia(COARSE_QUERY)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(COARSE_QUERY).matches,
    () => false,
  )
}

function makeEntry(file: File, source: ItemSource): FileEntry {
  return { id: newId(), file, source }
}

/** Файлы, которые можно добавить: слишком большие отсеиваются сразу с ошибкой. */
function acceptFiles(list: File[], source: ItemSource): FileEntry[] {
  const out: FileEntry[] = []
  for (const f of list) {
    if (f.size > MAX_FILE_SIZE) {
      toast.error(`Файл «${f.name}» больше ${formatBytes(MAX_FILE_SIZE)}`)
      continue
    }
    out.push(makeEntry(f, source))
  }
  return out
}

function FileRow({ entry, onRemove }: { entry: FileEntry; onRemove: () => void }) {
  const isImage = detectFileType(entry.file) === 'image'
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!isImage) return
    const u = URL.createObjectURL(entry.file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [entry.file, isImage])

  return (
    <li className="flex items-center gap-2 rounded-lg border bg-card p-1.5 pr-1 px-well">
      <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground pixel:bg-paper-line">
        {isImage && url ? (
          <img src={url} alt="" className="size-full object-cover" />
        ) : (
          <TypeIcon type={isImage ? 'image' : 'file'} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-2sm">{entry.file.name}</div>
        <div className="text-xs text-muted-foreground">{formatBytes(entry.file.size)}</div>
      </div>
      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Убрать файл ${entry.file.name}`} className="px-btn pixel:size-7.5 pixel:max-md:size-9" onClick={onRemove}>
        <Icon name="x" />
      </Button>
    </li>
  )
}

/** Черновик с необязательным источником (ждёт поля source в CaptureDraft, см. store/ui.ts). */
type DraftWithSource = CaptureDraft & { source?: ItemSource }

/** Возвращает false, если закрывать панель сейчас нельзя или пользователь отказался. */
type SnapshotFn = () => boolean

function CaptureForm({ snapshotRef }: { snapshotRef: { current: SnapshotFn | null } }) {
  const closeCapture = useUi((s) => s.closeCapture)
  const draft = useUi((s) => s.captureDraft)
  const coarse = useCoarsePointer()

  // Начальное состояние берётся один раз при открытии (форма монтируется вместе с диалогом).
  const [initial] = useState(() => {
    const d = useUi.getState().captureDraft
    const hasDraft = !!d && (!!d.text || !!d.files?.length || !!d.type)
    const restored = hasDraft ? null : readDraft()
    const dType = d?.type && d.type !== 'file' && d.type !== 'image' ? d.type : null
    // Открыто с внешним содержимым (вставка, перетаскивание) поверх сохранённого черновика: его не затираем.
    const preserved = hasDraft && readDraft() !== null
    return { d, restored, dType, preserved }
  })

  const [text, setText] = useState(initial.d?.text ?? initial.restored?.text ?? '')
  const [manualType, setManualType] = useState<ItemType | null>(initial.dType ?? initial.restored?.manualType ?? null)
  const [manualLang, setManualLang] = useState<string | null>(null)
  const [title, setTitle] = useState(initial.restored?.title ?? '')
  const [categoryId, setCategoryId] = useState<string | null>(initial.restored?.categoryId ?? null)
  const [tags, setTags] = useState<string[]>(initial.restored?.tags ?? [])
  const [files, setFiles] = useState<FileEntry[]>(() => acceptFiles(initial.d?.files ?? [], (initial.d as DraftWithSource | null)?.source ?? 'drop'))
  const [toLibrary, setToLibrary] = useState(false)
  const [favorite, setFavorite] = useState(false)
  const [saving, setSaving] = useState(false)
  const [restored, setRestored] = useState(!!initial.restored)
  const [dragging, setDragging] = useState(false)
  /** Показан вопрос «Закрыть без прикреплённых файлов?» (вместо window.confirm: в Tauri он асинхронный). */
  const [confirmClose, setConfirmClose] = useState(false)

  const stayRef = useRef<HTMLButtonElement>(null)
  const textSource = useRef<ItemSource>(initial.d?.text ? ((initial.d as DraftWithSource).source ?? 'paste') : 'manual')
  const textRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const savingRef = useRef(false)
  /** Запись сохранена и панель закрывается: черновик уже очищен, писать его снова нельзя. */
  const doneRef = useRef(false)
  const appliedDraft = useRef(initial.d)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Разбор ввода: для очень больших текстов — не чаще раза в 300 мс.
  const big = text.length > BIG_INPUT
  const [slowText, setSlowText] = useState(text)
  useEffect(() => {
    if (!big) return
    const t = setTimeout(() => setSlowText(text), 300)
    return () => clearTimeout(t)
  }, [text, big])
  const detectSource = big ? slowText : text
  const det = useMemo(() => detectInput(detectSource), [detectSource])

  const hasFiles = files.length > 0
  const effType: ItemType = manualType ?? det.type
  const linkUrl =
    effType === 'link' && !hasFiles
      ? (det.url ?? (isUrl(text.trim()) ? normalizeUrl(text.trim()) : undefined))
      : undefined
  const language = manualLang ?? det.language ?? null
  const isCode = effType === 'code' && !hasFiles
  const hasText = text.trim() !== ''
  const canSave = (hasText || hasFiles) && !saving

  const fileTypes = useMemo(() => new Set(files.map((f) => detectFileType(f.file))), [files])

  // Черновик пишется по мере ввода и при уходе со страницы, а не только при закрытии панели:
  // перезагрузка после обновления приложения или закрытие вкладки не теряют набранное.
  // Открыто с внешним содержимым поверх сохранённого черновика — его не трогаем (как и при закрытии).
  const draftRef = useRef<DraftSnapshot | null>(null)
  const persistDraft = useCallback(() => {
    if (initial.preserved || savingRef.current || doneRef.current) return
    writeDraft(draftRef.current)
  }, [initial.preserved])

  useEffect(() => {
    draftRef.current = text.trim() ? { text, title, tags, categoryId, manualType } : null
    const t = window.setTimeout(persistDraft, DRAFT_DELAY)
    return () => window.clearTimeout(t)
  }, [text, title, tags, categoryId, manualType, persistDraft])

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') persistDraft()
    }
    window.addEventListener('pagehide', persistDraft)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', persistDraft)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [persistDraft])

  // Заголовок ссылки подтягивает createAndEnrich после сохранения: до сохранения сетевых запросов нет.

  // Повторное openCapture(draft) при уже открытой панели — дополняем содержимое.
  useEffect(() => {
    if (!draft || draft === appliedDraft.current) return
    appliedDraft.current = draft
    if (draft.text) {
      setText((prev) => (prev.trim() ? `${prev}\n${draft.text}` : draft.text!))
      textSource.current = (draft as DraftWithSource).source ?? 'paste'
    }
    if (draft.type && draft.type !== 'file' && draft.type !== 'image') setManualType(draft.type)
    if (draft.files?.length) setFiles((prev) => [...prev, ...acceptFiles(draft.files!, (draft as DraftWithSource).source ?? 'drop')])
    setRestored(false)
  }, [draft])

  // Закрытие панели (Esc, клик вне) сохраняет черновик — родитель вызывает это перед closeCapture.
  useEffect(() => {
    snapshotRef.current = () => {
      // Пока идёт сохранение, закрытие дало бы дубль при следующем открытии.
      if (savingRef.current) return false
      // Файлы в черновик (sessionStorage) не попадают: не теряем их молча.
      if (hasFiles) {
        // Первая попытка закрыть показывает вопрос, повторная (Esc, клик вне) — «Остаться».
        // Повторная попытка — это «Остаться»: фокус в поле до того, как кнопка исчезнет.
        if (confirmClose) textRef.current?.focus()
        setConfirmClose(!confirmClose)
        return false
      }
      if (!initial.preserved) writeDraft(hasText ? { text, title, tags, categoryId, manualType } : null)
      return true
    }
    return () => {
      snapshotRef.current = null
    }
  })

  // Список файлов изменился — прежний вопрос неактуален.
  useEffect(() => {
    if (document.activeElement === stayRef.current) textRef.current?.focus()
    setConfirmClose(false)
  }, [files])

  useEffect(() => {
    if (confirmClose) stayRef.current?.focus()
  }, [confirmClose])

  /** «Закрыть» в вопросе: файлы теряются, текстовый черновик сохраняется как при обычном закрытии. */
  function closeWithoutFiles() {
    if (savingRef.current) return
    if (!initial.preserved) writeDraft(hasText ? { text, title, tags, categoryId, manualType } : null)
    closeCapture()
  }

  const addFiles = useCallback((list: File[], source: ItemSource) => {
    const entries = acceptFiles(list, source)
    if (entries.length) setFiles((prev) => [...prev, ...entries])
  }, [])

  function onTextChange(value: string) {
    setText(value)
    if (value === '') {
      setManualType(null)
      setManualLang(null)
      textSource.current = 'manual'
    }
  }

  function clearDraft() {
    writeDraft(null)
    setRestored(false)
    setText('')
    setTitle('')
    setTags([])
    setCategoryId(null)
    setManualType(null)
    setManualLang(null)
    textRef.current?.focus()
  }

  function buildInput(base: NewItemInput): NewItemInput {
    const fresh = detectInput(text)
    const type: ItemType = manualType ?? fresh.type
    const raw = text.trim()
    if (type === 'link') {
      const url = fresh.url ?? (isUrl(raw) ? normalizeUrl(raw) : undefined)
      if (!url) throw new Error('Не похоже на ссылку — выберите другой тип или поправьте адрес')
      return { ...base, type: 'link', url, content: '' }
    }
    if (type === 'code') {
      const code = (fresh.stripped ?? text).replace(/\s+$/, '')
      const lang = manualLang ?? fresh.language
      return { ...base, type: 'code', content: code, ...(lang ? { language: lang } : {}) }
    }
    return { ...base, type, content: raw }
  }

  async function save(keepOpen: boolean) {
    if (savingRef.current || !(hasText || hasFiles)) return
    savingRef.current = true
    setSaving(true)
    const base: NewItemInput = {
      type: 'text',
      title: title.trim() || undefined,
      categoryId,
      tags,
      status: toLibrary ? 'library' : 'inbox',
      favorite,
      source: textSource.current,
    }
    const createdIds: string[] = []
    try {
      // Категорию могли удалить, пока форма была закрыта или открыта в другой вкладке.
      if (categoryId && !(await listCategories()).some((c) => c.id === categoryId)) {
        base.categoryId = null
        if (mountedRef.current) setCategoryId(null)
      }
      if (hasFiles) {
        const done = new Set<string>()
        try {
          for (const entry of files) {
            const item = await createAndEnrich({
              ...base,
              type: detectFileType(entry.file),
              content: text.trim(),
              file: entry.file,
              fileName: entry.file.name,
              source: entry.source,
            })
            createdIds.push(item.id)
            done.add(entry.id)
          }
        } catch (e) {
          // уже сохранённые файлы убираем из списка, чтобы повтор не создал дубликаты
          if (done.size) setFiles((prev) => prev.filter((f) => !done.has(f.id)))
          throw e
        }
      } else {
        const item = await createAndEnrich(buildInput(base))
        createdIds.push(item.id)
      }
    } catch (e) {
      toast.error(describeError(e, 'Не удалось сохранить'))
      if (createdIds.length) notifySaved(createdIds, toLibrary)
      savingRef.current = false
      setSaving(false)
      return
    }

    notifySaved(createdIds, toLibrary)
    // Черновик очищаем до проверки монтирования: панель могли закрыть во время сохранения.
    if (!initial.preserved) writeDraft(null)
    // Панель могли закрыть (и открыть заново), пока шло сохранение: новую форму не трогаем.
    if (!mountedRef.current) return
    savingRef.current = false
    setSaving(false)
    if (keepOpen) {
      setText('')
      setTitle('')
      setFiles([])
      setManualType(null)
      setManualLang(null)
      setFavorite(false)
      setRestored(false)
      textSource.current = 'manual'
      textRef.current?.focus()
    } else {
      doneRef.current = true
      closeCapture()
    }
  }

  function cancel() {
    if (snapshotRef.current?.() === false) return
    closeCapture()
  }

  const plainEnterSaves = !coarse && !isCode && !text.includes('\n')

  function onTextKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    if (e.ctrlKey || e.metaKey) return // обрабатывает контейнер
    if (e.shiftKey || e.altKey || !plainEnterSaves) return
    e.preventDefault()
    void save(false)
  }

  function onTitleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.ctrlKey || e.metaKey) return
    e.preventDefault()
    void save(false)
  }

  function onContainerKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void save(e.shiftKey)
    }
  }

  function onPaste(e: ClipboardEvent<HTMLDivElement>) {
    // Текст + растровая копия из офисной программы — текст: такую вставку отдаём полю как есть.
    const pasted = e.clipboardData ? pastedFiles(e.clipboardData) : []
    if (pasted.length) {
      e.preventDefault()
      e.stopPropagation()
      addFiles(pasted, 'paste')
      return
    }
    if (e.target === textRef.current && !textRef.current?.value) textSource.current = 'paste'
  }

  const hasFilesDrag = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    if (!hasFilesDrag(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragging(true)
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    if (!hasFilesDrag(e)) return
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    addFiles(Array.from(e.dataTransfer.files), 'drop')
  }

  function onTypeClick(t: ItemType) {
    if (t === 'file' || t === 'image') {
      fileInputRef.current?.click()
      return
    }
    if (hasFiles) return
    setManualType((cur) => (cur === t ? null : t))
  }

  const mod = isMac() ? '⌘' : 'Ctrl'
  const saveHint = coarse ? null : plainEnterSaves && !hasFiles ? '↵' : `${mod}↵`
  return (
    <div
      className="relative flex flex-col gap-2.5 pixel:-m-1 pixel:min-h-0 pixel:overflow-y-auto pixel:p-1"
      onKeyDown={onContainerKeyDown}
      onPaste={onPaste}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="pointer-events-none absolute -inset-1 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-ring bg-popover/90 text-sm pixel:bg-paper text-muted-foreground">
          Отпустите, чтобы добавить файлы
        </div>
      )}

      <Textarea
        ref={textRef}
        autoFocus
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onKeyDown={onTextKeyDown}
        placeholder="Вставьте ссылку, текст, код или идею…"
        aria-label="Содержимое записи"
        spellCheck={!isCode}
        enterKeyHint={coarse ? 'enter' : undefined}
        className={cn(
          'max-h-[34dvh] min-h-24 resize-none overflow-y-auto sm:max-h-[45dvh]',
          isCode && 'font-mono text-2sm',
        )}
      />

      {linkUrl && (
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <TypeIcon type="link" className="size-3.5" />
          <span className="truncate font-mono">{linkUrl}</span>
        </div>
      )}

      {isCode && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Язык</span>
          <Select
            items={LANGUAGE_ITEMS}
            value={language}
            onValueChange={(v) => setManualLang(v)}
          >
            <SelectTrigger size="sm" className="min-w-36" aria-label="Язык кода">
              <SelectValue placeholder="Не определён" />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} className="max-h-72">
              {LANGUAGES.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Тип записи">
        {ITEM_TYPES.map((t) => {
          const active = hasFiles ? (t === 'file' || t === 'image') && fileTypes.has(t) : t === effType
          const disabled = hasFiles && t !== 'file' && t !== 'image'
          return (
            <button
              key={t}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              onClick={() => onTypeClick(t)}
              title={t === 'file' || t === 'image' ? 'Прикрепить файл' : manualType === t ? 'Вернуть автоопределение' : undefined}
              className={cn(
                'px-chip pixel:px-1.5 inline-flex h-7 items-center gap-1.5 rounded-md border border-transparent px-2 text-xs text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40',
                active && 'border-border bg-muted font-medium text-foreground',
              )}
            >
              <TypeIcon type={t} className="size-3.5" />
              {TYPE_LABEL[t]}
            </button>
          )
        })}
        <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
          {manualType && !hasFiles ? (
            <button
              type="button"
              className="underline-offset-2 outline-none hover:underline focus-visible:underline"
              onClick={() => setManualType(null)}
            >
              Тип выбран вручную · авто
            </button>
          ) : (
            'Тип определяется автоматически'
          )}
        </span>
      </div>

      {hasFiles && (
        <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
          {files.map((f) => (
            <FileRow key={f.id} entry={f} onRemove={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))} />
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onTitleKeyDown}
          placeholder="Заголовок (необязательно)"
          aria-label="Заголовок"
          className="sm:min-w-0 sm:flex-[1.2]"
        />
        <div className="flex min-w-0 gap-1.5 sm:flex-[1.4]">
          <CategorySelect value={categoryId} onChange={setCategoryId} allowCreate className="min-w-0 flex-1" />
          <TagInput value={tags} onChange={setTags} placeholder="Теги" className="min-w-0 flex-1" />
        </div>
      </div>

      {confirmClose && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-muted/50 p-2 text-2sm px-well"
        >
          <span className="min-w-0 flex-1">Прикреплённые файлы не сохранятся. Закрыть?</span>
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="outline" size="sm" onClick={closeWithoutFiles}>
              Закрыть
            </Button>
            <Button ref={stayRef} type="button" size="sm" onClick={() => { textRef.current?.focus(); setConfirmClose(false) }}>
              Остаться
            </Button>
          </div>
        </div>
      )}

      {restored && (
        <div className="text-xs text-muted-foreground">
          Черновик восстановлен ·{' '}
          <button type="button" className="underline underline-offset-2 outline-none hover:text-foreground focus-visible:text-foreground" onClick={clearDraft}>
            Очистить
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-0.5">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            addFiles(Array.from(e.target.files ?? []), 'manual')
            e.target.value = ''
          }}
        />
        <Button type="button" variant="ghost" size="icon" aria-label="Прикрепить файлы" title="Прикрепить файлы" className="px-btn pixel:size-7.5 pixel:max-md:size-9" onClick={() => fileInputRef.current?.click()}>
          <Icon name="paperclip" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="В избранное"
          aria-pressed={favorite}
          title="В избранное"
          onClick={() => setFavorite((v) => !v)}
          className={cn('px-btn pixel:size-7.5 pixel:max-md:size-9', favorite && 'text-foreground')}
        >
          <Icon name="star" className={cn(favorite && 'fill-current')} />
        </Button>
        <label className="flex cursor-pointer items-center gap-2 text-2sm text-muted-foreground select-none">
          <Switch size="sm" checked={toLibrary} onCheckedChange={setToLibrary} aria-label="Сразу в базу знаний" />
          Сразу в базу знаний
        </label>

        <div className="ml-auto flex items-center gap-1.5">
          <Button type="button" variant="ghost" className="md:hidden" onClick={cancel}>
            Отмена
          </Button>
          <span className="hidden text-xs text-muted-foreground md:inline">{mod}+⇧+↵ — и добавить ещё</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Сохранить и добавить ещё"
            title={`Сохранить и добавить ещё (${mod}+Shift+Enter)`}
            disabled={!canSave}
            className="px-btn pixel:size-7.5 pixel:max-md:size-9"
            onClick={() => void save(true)}
          >
            <Icon name="plus" />
          </Button>
          <Button
            type="button"
            disabled={!canSave}
            onClick={() => void save(false)}
            className="bg-brand px-3 text-brand-foreground hover:bg-brand/90"
          >
            {saving && <Icon name="loader" strokeWidth={2} className="animate-spin motion-reduce:animate-none" />}
            Сохранить
            {saveHint && (
              <kbd className="ml-1 rounded bg-brand-foreground/15 px-1 font-sans text-2xs leading-4">{saveHint}</kbd>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

function notifySaved(ids: string[], toLibrary: boolean) {
  const first = ids[0]
  const message =
    ids.length > 1
      ? `Сохранено записей: ${ids.length}`
      : toLibrary
        ? 'Сохранено в базу знаний'
        : 'Сохранено во входящие'
  toast.success(message, {
    action: { label: 'Открыть', onClick: () => useUi.getState().select(first) },
  })
}

export function QuickCapture() {
  const open = useUi((s) => s.captureOpen)
  const closeCapture = useUi((s) => s.closeCapture)
  const snapshotRef = useRef<SnapshotFn | null>(null)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return
        if (snapshotRef.current?.() === false) return
        closeCapture()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="top-[max(0.5rem,env(safe-area-inset-top))] max-h-[calc(100dvh-1rem)] w-full max-w-[calc(100%-1rem)] translate-y-0 gap-0 overflow-y-auto p-2.5 sm:top-[12vh] sm:max-w-[640px] sm:p-3 pixel:flex pixel:flex-col pixel:overflow-hidden"
        data-skin="panel"
      >
        <DialogTitle className="sr-only font-heading pixel:not-sr-only pixel:mb-2.5 pixel:flex pixel:items-center pixel:gap-2 pixel:text-2xl">
          <Icon name="sprout" pixelSize={20} className="hidden pixel:block" />
          Быстрая запись
        </DialogTitle>
        <CaptureForm snapshotRef={snapshotRef} />
      </DialogContent>
    </Dialog>
  )
}
