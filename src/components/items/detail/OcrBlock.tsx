import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useSettings } from '@/db/settings'
import { useOcrJob, useOcrNote } from '@/hooks/useOcr'
import { actCancelRecognize, actClearOcrText, actRecognize, actSaveOcrText, copyText } from '@/lib/actions'
import { aiHostLabel, visionAvailability } from '@/lib/ai'
import type { Item } from '@/types'
import { ContentEditor } from './ContentEditor'
import { charsLabel, isBlankOcrDraft, ocrBlockView, ocrNetworkLine, visibleOcrText, type OcrNetwork } from './ocrView'

/** Высота 36 px на телефоне (касание). */
const BTN = 'pointer-coarse:h-9'

/** Строка о сети: стоит рядом с кнопкой, которая отправляет изображение, и привязана к ней через aria-describedby. */
function NetworkLine({ id, network, host }: { id: string; network: OcrNetwork; host: string }) {
  return (
    <p id={id} className="text-xs text-muted-foreground">
      {ocrNetworkLine(network, host)}
    </p>
  )
}

/**
 * Распознанный текст вложения (картинка, PDF): состояние задачи, ошибка, кнопка запуска или сам текст.
 * Выбор состояния — `ocrBlockView` (таблица спецификации §4.2). readOnly — запись в корзине.
 */
export function OcrBlock({ item, readOnly }: { item: Item; readOnly?: boolean }) {
  const settings = useSettings()
  const job = useOcrJob(item.id)
  const note = useOcrNote(item.id)
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [editing, setEditing] = useState(false)
  const bodyId = useId()
  const hintId = useId()

  // Пока настройки читаются, ИИ считается недоступным: кнопка с отправкой не мелькнёт раньше строки о сети.
  const aiBlocked = settings ? visionAvailability(settings) !== null : true
  const host = settings ? aiHostLabel(settings.aiBaseUrl) : ''
  const view = ocrBlockView(item, job, note, aiBlocked, readOnly)

  // После ручного распознавания раздел раскрывается сам: пользователь ждал именно этого текста.
  // Признак — смена ocrAt за время ручной задачи (неудача и «текста нет» раздел не открывают).
  const manualFrom = useRef<{ at: number } | null>(null)
  useEffect(() => {
    if (job) {
      if (job.manual && !manualFrom.current) manualFrom.current = { at: item.ocrAt ?? 0 }
      return
    }
    const from = manualFrom.current
    if (!from) return
    if (item.ocrText && (item.ocrAt ?? 0) !== from.at) {
      manualFrom.current = null
      setOpen(true)
    } else if (note) {
      manualFrom.current = null
    }
  }, [job, note, item.ocrText, item.ocrAt])

  if (view.kind === 'none') return null

  const run = () => void actRecognize(item)

  switch (view.kind) {
    case 'job':
      return (
        <div data-slot="ocr-block" className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <div role="status" aria-live="polite" className="flex items-center gap-1.5 text-2sm text-muted-foreground">
            <Icon name="loader" className="size-4 shrink-0 animate-spin" />
            <span>{view.label}</span>
          </div>
          {view.cancellable && (
            <Button variant="ghost" size="xs" className={BTN} onClick={() => actCancelRecognize(item.id)}>
              Отменить
            </Button>
          )}
        </div>
      )

    case 'failed':
      return (
        <div data-slot="ocr-block" className="flex flex-col items-start gap-1.5">
          <p role="alert" className="flex items-start gap-1.5 text-2sm text-destructive">
            <Icon name="alert" className="mt-0.5 size-4 shrink-0" />
            <span className="min-w-0 break-words">{view.error}</span>
          </p>
          {view.retry && (
            <>
              <Button
                variant="outline"
                size="sm"
                className={BTN}
                onClick={run}
                aria-describedby={view.retry.network ? hintId : undefined}
              >
                <Icon name="refresh" />
                Повторить
              </Button>
              {view.retry.network && <NetworkLine id={hintId} network={view.retry.network} host={host} />}
            </>
          )}
        </div>
      )

    case 'empty':
      return (
        <div data-slot="ocr-block" className="flex flex-col items-start gap-1.5">
          <p className="text-2sm text-muted-foreground">Текст не найден</p>
          <Button variant="outline" size="sm" className={BTN} onClick={run} aria-describedby={hintId}>
            <Icon name="refresh" />
            Распознать заново
          </Button>
          <NetworkLine id={hintId} network={view.network} host={host} />
        </div>
      )

    case 'start':
      return (
        <div data-slot="ocr-block" className="flex flex-col items-start gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className={BTN}
            onClick={run}
            aria-describedby={view.network ? hintId : undefined}
          >
            <Icon name={view.label === 'Извлечь текст' ? 'file-text' : 'scan-text'} />
            {view.label}
          </Button>
          {view.network && <NetworkLine id={hintId} network={view.network} host={host} />}
        </div>
      )

    case 'note':
      return (
        <p data-slot="ocr-block" className="text-xs text-muted-foreground">
          {view.text}
        </p>
      )

    case 'text': {
      const text = item.ocrText ?? ''
      const shown = visibleOcrText(text, showAll)
      const toolbar = (
        <div className="flex flex-wrap items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            className={`text-muted-foreground ${BTN}`}
            onClick={() => void copyText(text)}
            aria-label="Копировать распознанный текст"
          >
            <Icon name="copy" className="size-4" />
            Копировать
          </Button>
          {!view.readOnly && (
            <Button
              variant="ghost"
              size="xs"
              className={`text-muted-foreground ${BTN}`}
              onClick={() => void actClearOcrText(item)}
              aria-label="Очистить распознанный текст"
            >
              <Icon name="x" className="size-4" />
              Очистить
            </Button>
          )}
          {view.rerun && (
            <Button
              variant="ghost"
              size="xs"
              className={`text-muted-foreground ${BTN}`}
              onClick={run}
              aria-describedby={view.rerun.network ? hintId : undefined}
            >
              <Icon name="refresh" className="size-4" />
              {view.rerun.label}
            </Button>
          )}
        </div>
      )
      return (
        <div data-slot="ocr-block" className="flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={open ? bodyId : undefined}
            className="flex w-full items-center gap-1.5 rounded-md py-1 text-left text-2sm font-medium outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/60 pointer-coarse:min-h-9"
          >
            <Icon name={open ? 'chevron-down' : 'chevron-right'} className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">Распознанный текст</span>
            <span className="shrink-0 text-xs font-normal text-muted-foreground">{charsLabel(view.length)}</span>
          </button>
          {open && (
            <div id={bodyId} className="flex flex-col gap-1.5">
              <ContentEditor
                label="Распознанный текст"
                placeholder="Текста нет"
                value={text}
                // Стёртый целиком текст не пишется автосохранением (поле исчезло бы посреди правки и без «Отменить»):
                // false откатывает базу автосохранения, а очистка идёт при выходе из правки — с toast «Отменить».
                onSave={(v) => (isBlankOcrDraft(v) ? false : actSaveOcrText(item.id, v))}
                onCommitted={(v) => {
                  if (isBlankOcrDraft(v)) void actClearOcrText(item)
                }}
                onEditingChange={setEditing}
                readOnly={!view.canEdit}
                toolbar={toolbar}
                renderView={() => (
                  <>
                    <div
                      role="region"
                      aria-label="Распознанный текст"
                      tabIndex={0}
                      className="max-h-80 overflow-auto text-2sm break-words whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-ring/60 pixel:p-1 pixel:-m-1"
                    >
                      {shown}
                    </div>
                    {view.tooLong && !showAll && (
                      <Button variant="ghost" size="xs" className={`mt-1 ${BTN}`} onClick={() => setShowAll(true)}>
                        Показать весь текст
                      </Button>
                    )}
                  </>
                )}
              />
              {/* В правке кнопки «Распознать заново» нет — строка о ней тоже не нужна. */}
              {!editing && view.rerun?.network && <NetworkLine id={hintId} network={view.rerun.network} host={host} />}
            </div>
          )}
        </div>
      )
    }
  }
}
