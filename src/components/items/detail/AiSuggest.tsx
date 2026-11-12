import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/icons'
import { toast } from 'sonner'
import { TagChip } from '@/components/items/TagChip'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/db/settings'
import { suggestForItem } from '@/lib/ai'
import { describeError } from '@/lib/errors'
import { normalizeTag } from '@/lib/normalize'
import type { AiMeta, Item } from '@/types'
import { saveItem, saveTags } from './save'

/** «Кратко» — уже сохранённое описание; показывается независимо от настроек AI. */
export function AiSummary({ item }: { item: Item }) {
  const summary = item.ai?.summary?.trim()
  if (!summary) return null
  return (
    <section aria-label="Кратко" className="rounded-lg bg-muted/50 px-3 py-2">
      <h3 className="mb-0.5 text-xs font-medium text-muted-foreground">Кратко</h3>
      <p className="text-sm leading-relaxed whitespace-pre-wrap">{summary}</p>
    </section>
  )
}

/** Предложение заголовка и тегов от LLM. Рендерится только при включённом AI. */
export function AiSuggest({ item }: { item: Item }) {
  const settings = useSettings()
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<AiMeta | null>(null)
  const abortRef = useRef<AbortController | null>(null)

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
      if (!ctrl.signal.aborted) setResult(meta)
    } catch (e) {
      if (!ctrl.signal.aborted) toast.error(describeError(e, 'Не удалось получить подсказку'))
    } finally {
      if (abortRef.current === ctrl) setPending(false)
    }
  }

  const newTags = (result?.suggestedTags ?? []).map(normalizeTag).filter((t) => t && !item.tags.includes(t))
  const title = result?.suggestedTitle?.trim()
  const summary = result?.summary?.trim()
  const hasResult = !!result && (title || summary || newTags.length > 0)

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
        <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-3">
          {title && (
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted-foreground">Заголовок</div>
                <div className="text-sm break-words">{title}</div>
              </div>
              <Button
                size="xs"
                variant="outline"
                disabled={title === item.title.trim()}
                onClick={() => void saveItem(item.id, { title })}
              >
                Применить
              </Button>
            </div>
          )}
          {summary && (
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted-foreground">Описание</div>
                <div className="text-sm leading-relaxed break-words">{summary}</div>
              </div>
              <Button
                size="xs"
                variant="outline"
                disabled={summary === item.ai?.summary?.trim()}
                onClick={() =>
                  void saveItem(item.id, {
                    ai: { ...item.ai, summary, model: result.model, generatedAt: result.generatedAt ?? Date.now() },
                  })
                }
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
