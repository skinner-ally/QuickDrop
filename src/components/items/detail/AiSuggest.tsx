import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/icons'
import { toast } from 'sonner'
import { TagChip } from '@/components/items/TagChip'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { getItem } from '@/db/repo'
import { useSettings } from '@/db/settings'
import { suggestForItem } from '@/lib/ai'
import { describeError } from '@/lib/errors'
import { normalizeTag } from '@/lib/normalize'
import type { AiMeta, Item, ItemPatch } from '@/types'
import { saveItem, saveTags } from './save'

/** «Кратко» — уже сохранённое описание; показывается независимо от настроек AI. */
export function AiSummary({ item }: { item: Item }) {
  const summary = item.ai?.summary?.trim()
  if (!summary) return null
  return (
    <section aria-label="Кратко" className="rounded-lg bg-muted/50 px-3 py-2 px-well">
      <h3 className="mb-0.5 text-xs font-medium text-muted-foreground pixel:text-2sm pixel:font-semibold">Кратко</h3>
      <p className="text-sm leading-relaxed whitespace-pre-wrap">{summary}</p>
    </section>
  )
}

/**
 * Предложение заголовка, описания и тегов от LLM. Рендерится только при включённом AI.
 * Заголовок и описание сохраняются сразу, как только пришёл ответ (с «Отменить»); их можно поправить
 * в полях ниже, и «Сохранить» оживает только после такой ручной правки. Теги добавляются щелчком.
 */
export function AiSuggest({ item }: { item: Item }) {
  const settings = useSettings()
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<AiMeta | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const savedTitle = item.title.trim()
  const savedSummary = item.ai?.summary?.trim() ?? ''
  const [titleDraft, setTitleDraft] = useState(savedTitle)
  const [summaryDraft, setSummaryDraft] = useState(savedSummary)
  // Запись изменили в другом месте (поле заголовка, автосохранение) — поля догоняют сохранённое значение.
  const [seenTitle, setSeenTitle] = useState(savedTitle)
  const [seenSummary, setSeenSummary] = useState(savedSummary)
  if (seenTitle !== savedTitle) {
    setSeenTitle(savedTitle)
    setTitleDraft(savedTitle)
  }
  if (seenSummary !== savedSummary) {
    setSeenSummary(savedSummary)
    setSummaryDraft(savedSummary)
  }

  // Запрос отменяется при смене записи (key={id} размонтирует компонент) и закрытии панели.
  useEffect(() => () => abortRef.current?.abort(), [])

  if (!settings?.aiEnabled || !settings.aiApiKey.trim()) return null

  async function run() {
    if (!settings) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPending(true)
    try {
      const meta = await suggestForItem(item, settings, ctrl.signal)
      if (ctrl.signal.aborted) return
      setResult(meta)
      await autoSave(meta)
    } catch (e) {
      if (!ctrl.signal.aborted) toast.error(describeError(e, 'Не удалось получить подсказку'))
    } finally {
      if (abortRef.current === ctrl) setPending(false)
    }
  }

  /**
   * Сохраняет предложенные заголовок и описание одной записью; прежние значения возвращает «Отменить».
   * Сверка — со свежей записью из базы: пока шёл запрос, заголовок могли поправить, и снимок рендера устарел.
   */
  async function autoSave(meta: AiMeta) {
    const current = await getItem(item.id)
    if (!current || current.deletedAt !== undefined) return
    const title = meta.suggestedTitle?.trim()
    const summary = meta.summary?.trim()
    const patch: ItemPatch = {}
    const undo: ItemPatch = {}
    if (title && title !== current.title.trim()) {
      patch.title = title
      undo.title = current.title
    }
    if (summary && summary !== current.ai?.summary?.trim()) {
      patch.ai = { ...current.ai, summary, model: meta.model, generatedAt: meta.generatedAt ?? Date.now() }
      undo.ai = current.ai
    }
    if (!Object.keys(patch).length) return
    if (!(await saveItem(item.id, patch))) return
    toast('Заголовок и описание сохранены', {
      action: { label: 'Отменить', onClick: () => void saveItem(item.id, undo) },
    })
  }

  const hasTitle = !!result?.suggestedTitle?.trim()
  const hasSummary = !!result?.summary?.trim()
  const newTags = (result?.suggestedTags ?? []).map(normalizeTag).filter((t) => t && !item.tags.includes(t))
  const hasResult = !!result && (hasTitle || hasSummary || newTags.length > 0)
  const titleDirty = hasTitle && titleDraft.trim() !== savedTitle
  const summaryDirty = hasSummary && summaryDraft.trim() !== savedSummary

  // Ручная правка полей: только то, что действительно изменилось. Пустое описание убирает блок «Кратко».
  async function saveEdits() {
    const patch: ItemPatch = {}
    if (titleDirty) patch.title = titleDraft.trim()
    if (summaryDirty) {
      const text = summaryDraft.trim()
      if (text) patch.ai = { ...item.ai, summary: text }
      else {
        const { summary: _dropped, ...rest } = item.ai ?? {}
        patch.ai = Object.keys(rest).length ? rest : undefined
      }
    }
    await saveItem(item.id, patch)
  }

  return (
    <section className="flex flex-col gap-2" aria-label="ИИ-помощник">
      <div>
        <Button variant="outline" size="sm" disabled={pending} onClick={() => void run()}>
          {pending ? <Icon name="loader" className="size-4 animate-spin" /> : <Icon name="sparkles" className="size-4" />}
          Предложить заголовок и теги
        </Button>
      </div>

      {result && !hasResult && <p className="text-xs text-muted-foreground">Нечего предложить</p>}

      {hasResult && result && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3 px-well">
          {(hasTitle || hasSummary) && (
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {hasTitle && (
                  <div>
                    <label htmlFor="ai-title" className="mb-0.5 block text-xs text-muted-foreground">
                      Заголовок
                    </label>
                    <Input id="ai-title" value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} />
                  </div>
                )}
                {hasSummary && (
                  <div>
                    <label htmlFor="ai-summary" className="mb-0.5 block text-xs text-muted-foreground">
                      Описание
                    </label>
                    <Textarea
                      id="ai-summary"
                      value={summaryDraft}
                      onChange={(e) => setSummaryDraft(e.target.value)}
                      rows={2}
                      className="field-sizing-content max-h-40 min-h-0 resize-none overflow-y-auto text-2sm"
                    />
                  </div>
                )}
              </div>
              <Button
                size="xs"
                variant="outline"
                className="mt-4"
                disabled={!titleDirty && !summaryDirty}
                onClick={() => void saveEdits()}
              >
                Сохранить
              </Button>
            </div>
          )}
          {newTags.length > 0 && (
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Теги — нажмите, чтобы добавить</div>
              <div className="flex flex-wrap gap-1">
                {newTags.map((t) => (
                  <TagChip key={t} tag={t} onClick={() => void saveTags(item.id, item.tags, [...item.tags, t])} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
