import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from '@/components/icons'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { setSetting, setSettings } from '@/db/settings'
import { aiBaseUrlError, aiHostLabel, recognizeImage, suggestForItem, visionAvailability } from '@/lib/ai'
import { describeError } from '@/lib/errors'
import type { Item, Settings } from '@/types'
import { aiEnabledPatch } from './aiPatch'
import { CommitInput, Field, Row, Section } from './Section'

const PRESETS = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
]

function stubItem(): Item {
  const now = Date.now()
  return {
    id: 'settings-test',
    type: 'text',
    title: '',
    content: 'Проверка подключения: заметка про то, как настроить резервное копирование.',
    categoryId: null,
    tags: [],
    links: [],
    status: 'inbox',
    favorite: 0,
    source: 'manual',
    createdAt: now,
    updatedAt: now,
  }
}

const required = (v: string) => (v ? null : 'Поле не может быть пустым')

const PROBE_TEXT = 'QuickDrop 2468'
const PROBE_DIGITS = '2468'

/**
 * Проверочная картинка для «Проверить распознавание»: белый фон, чёрный текст (≈480×160). Цвета здесь —
 * содержимое картинки, которую читает модель, а не оформление интерфейса: читаемость важнее темы.
 */
function makeProbeImage(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = 480
    canvas.height = 160
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      reject(new Error('Не удалось подготовить проверочную картинку'))
      return
    }
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = 'black'
    ctx.font = 'bold 48px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(PROBE_TEXT, canvas.width / 2, canvas.height / 2)
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Не удалось подготовить проверочную картинку'))),
      'image/png',
    )
  })
}

export function AiSection({ settings }: { settings: Settings }) {
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [probing, setProbing] = useState(false)
  const [probeResult, setProbeResult] = useState<{ ok: boolean; text: string } | null>(null)
  const probeAbort = useRef<AbortController | null>(null)
  const ocrHintId = useId()
  const autoHintId = useId()

  // Закрыли настройки посреди проверки — запрос с картинкой прерывается.
  useEffect(() => () => probeAbort.current?.abort(), [])

  const blocked = visionAvailability(settings)
  const host = aiHostLabel(settings.aiBaseUrl)

  const applyPreset = async (p: (typeof PRESETS)[number]) => {
    try {
      await setSetting('aiBaseUrl', p.baseUrl)
      await setSetting('aiModel', p.model)
    } catch (e) {
      toast.error(describeError(e))
    }
  }

  const test = async () => {
    setTesting(true)
    setResult(null)
    try {
      const meta = await suggestForItem(stubItem(), { ...settings, aiEnabled: true })
      setResult({
        ok: true,
        text: meta.suggestedTitle
          ? `Подключение работает. Ответ модели: «${meta.suggestedTitle}»`
          : 'Подключение работает',
      })
    } catch (e) {
      setResult({ ok: false, text: describeError(e, 'Не удалось подключиться') })
    } finally {
      setTesting(false)
    }
  }

  const probe = async () => {
    probeAbort.current?.abort()
    const ctrl = new AbortController()
    probeAbort.current = ctrl
    setProbing(true)
    setProbeResult(null)
    try {
      const image = await makeProbeImage()
      // Отправляется только проверочная картинка. aiEnabled: true — проверка работает и пока помощник выключен.
      const reply = await recognizeImage(image, { ...settings, aiEnabled: true }, ctrl.signal)
      if (ctrl.signal.aborted) return
      const found = reply.text.replace(/\D/g, '').includes(PROBE_DIGITS)
      setProbeResult(
        found
          ? { ok: true, text: `Распознавание работает (модель ${reply.model})` }
          : { ok: false, text: 'Модель ответила, но текст не прочитала' },
      )
    } catch (e) {
      if (ctrl.signal.aborted) return
      setProbeResult({ ok: false, text: describeError(e, 'Не удалось проверить распознавание') })
    } finally {
      if (probeAbort.current === ctrl) {
        probeAbort.current = null
        setProbing(false)
      }
    }
  }

  const setAutoOcr = (on: boolean) => {
    // Включение запоминает момент: автоматически распознаются только записи, добавленные после него.
    const save = on ? setSettings({ aiAutoOcr: true, aiAutoOcrSince: Date.now() }) : setSetting('aiAutoOcr', false)
    void save.catch((e: unknown) => toast.error(describeError(e)))
  }

  const setAiEnabled = (on: boolean) => {
    void setSettings(aiEnabledPatch(settings, on, Date.now())).catch((e: unknown) => toast.error(describeError(e)))
  }

  return (
    <Section
      id="ai"
      title="ИИ-помощник (необязательно)"
      description="Предлагает заголовок, краткое описание и теги для записи; по желанию распознаёт текст на картинках и сканах PDF. Работает с любым OpenAI-совместимым API."
    >
      <Row>
        <label htmlFor="ai-enabled" className="text-2sm pixel:font-semibold">
          Включить ИИ-помощника
        </label>
        <Switch
          id="ai-enabled"
          checked={settings.aiEnabled}
          onCheckedChange={setAiEnabled}
        />
      </Row>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Пресеты:</span>
        {PRESETS.map((p) => (
          <Button key={p.name} variant="outline" size="sm" onClick={() => void applyPreset(p)}>
            {p.name}
          </Button>
        ))}
      </div>

      <Field label="Адрес API" htmlFor="ai-base">
        <CommitInput
          id="ai-base"
          value={settings.aiBaseUrl}
          validate={aiBaseUrlError}
          onCommit={(v) => setSetting('aiBaseUrl', v)}
        />
      </Field>
      <Field label="Модель" htmlFor="ai-model">
        <CommitInput
          id="ai-model"
          value={settings.aiModel}
          validate={required}
          onCommit={(v) => setSetting('aiModel', v)}
        />
      </Field>
      <Field
        label="API-ключ"
        htmlFor="ai-key"
        hint="Ключ хранится только локально в этом браузере или приложении и не попадает в резервную копию. Запросы уходят напрямую провайдеру и содержат текст записи, а при распознавании — изображение."
      >
        <CommitInput
          id="ai-key"
          type={showKey ? 'text' : 'password'}
          value={settings.aiApiKey}
          onCommit={(v) => setSetting('aiApiKey', v)}
          trailing={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={showKey ? 'Скрыть ключ' : 'Показать ключ'}
              aria-pressed={showKey}
              onClick={() => setShowKey((s) => !s)}
            >
              <Icon name={showKey ? 'eye-off' : 'eye'} />
            </Button>
          }
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => void test()} disabled={testing || !settings.aiApiKey.trim()}>
          {testing && <Icon name="loader" className="animate-spin" />}
          Проверить подключение
        </Button>
        {result && (
          <p role="status" className={result.ok ? 'text-2sm text-muted-foreground' : 'text-2sm text-destructive'}>
            {result.text}
          </p>
        )}
      </div>

      <div
        role="group"
        aria-labelledby="ai-ocr-title"
        className="flex flex-col gap-3 border-t pt-4 px-divider pixel:gap-2 pixel:pt-2"
      >
        <h3 id="ai-ocr-title" className="text-2sm font-medium pixel:font-semibold">
          Распознавание текста
        </h3>
        <p className="text-2sm text-muted-foreground">
          Текст на картинках и сканах PDF распознаёт модель со зрением. При распознавании изображение (у PDF — первые
          5 страниц в виде картинок) отправляется на адрес API: {host}. Пока ИИ-помощник выключен, записи и их
          изображения не отправляются, а добавленное за это время потом автоматически не распознаётся — только
          кнопкой в подробностях записи. Кнопки проверки ниже отправляют только проверочные данные.
        </p>

        <Field
          label="Модель для распознавания"
          htmlFor="ai-vision-model"
          hint="Пусто — используется основная модель. Нужна модель, которая принимает изображения."
        >
          <CommitInput
            id="ai-vision-model"
            value={settings.aiVisionModel}
            placeholder={settings.aiModel}
            onCommit={(v) => setSetting('aiVisionModel', v.trim())}
          />
        </Field>

        <Row>
          <label htmlFor="ai-auto-ocr" className="text-2sm pixel:font-semibold">
            Распознавать автоматически
          </label>
          <Switch
            id="ai-auto-ocr"
            checked={settings.aiAutoOcr}
            // Включённую настройку можно выключить всегда; включить — только когда распознавание доступно.
            disabled={blocked !== null && !settings.aiAutoOcr}
            aria-describedby={autoHintId}
            onCheckedChange={setAutoOcr}
          />
        </Row>
        <p id={autoHintId} className="text-xs text-muted-foreground">
          Новые картинки и сканы PDF будут отправляться на {host} сразу после добавления, без вопроса. Записи,
          добавленные раньше, не трогаются: их можно распознать кнопкой в подробностях записи.
          {blocked !== null ? ` Сейчас недоступно: ${blocked}.` : ''}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={() => void probe()}
            disabled={probing || !settings.aiApiKey.trim()}
            aria-describedby={ocrHintId}
          >
            {probing && <Icon name="loader" className="animate-spin" />}
            Проверить распознавание
          </Button>
          {probeResult && (
            <p role="status" className={probeResult.ok ? 'text-2sm text-muted-foreground' : 'text-2sm text-destructive'}>
              {probeResult.text}
            </p>
          )}
        </div>
        <p id={ocrHintId} className="text-xs text-muted-foreground">
          Отправляется только проверочная картинка с надписью «{PROBE_TEXT}» на {host}.
        </p>
      </div>
    </Section>
  )
}
