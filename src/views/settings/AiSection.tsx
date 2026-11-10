import { useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { setSetting } from '@/db/settings'
import { suggestForItem } from '@/lib/ai'
import type { Item, Settings } from '@/types'
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
const urlCheck = (v: string) => (/^https?:\/\//.test(v) ? null : 'Адрес должен начинаться с http:// или https://')

export function AiSection({ settings }: { settings: Settings }) {
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const applyPreset = async (p: (typeof PRESETS)[number]) => {
    try {
      await setSetting('aiBaseUrl', p.baseUrl)
      await setSetting('aiModel', p.model)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
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
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <Section
      id="ai"
      title="ИИ-помощник (необязательно)"
      description="Предлагает заголовок, краткое описание и теги для записи. Работает с любым OpenAI-совместимым API."
    >
      <Row>
        <label htmlFor="ai-enabled" className="text-[13px]">
          Включить ИИ-помощника
        </label>
        <Switch
          id="ai-enabled"
          checked={settings.aiEnabled}
          onCheckedChange={(v) => void setSetting('aiEnabled', v).catch((e: Error) => toast.error(e.message))}
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
          validate={urlCheck}
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
        hint="Ключ хранится только локально в этом браузере или приложении и не попадает в резервную копию. Запросы уходят напрямую провайдеру и содержат текст записи."
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
              {showKey ? <EyeOff strokeWidth={1.75} /> : <Eye strokeWidth={1.75} />}
            </Button>
          }
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => void test()} disabled={testing || !settings.aiApiKey.trim()}>
          {testing && <Loader2 className="animate-spin" strokeWidth={1.75} />}
          Проверить подключение
        </Button>
        {result && (
          <p role="status" className={result.ok ? 'text-[13px] text-muted-foreground' : 'text-[13px] text-destructive'}>
            {result.text}
          </p>
        )}
      </div>
    </Section>
  )
}
