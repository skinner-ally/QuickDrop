import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { setSetting } from '@/db/settings'
import { describeError } from '@/lib/errors'
import { isTauri } from '@/lib/platform'
import type { Settings } from '@/types'
import { CommitInput, Field, Row, Section } from './Section'

export function validateProxy(v: string): string | null {
  if (!v) return null
  if (!v.startsWith('https://')) return 'Адрес прокси должен начинаться с https://'
  if (!v.includes('{url}')) return 'В шаблоне должен быть {url}: сюда подставляется адрес ссылки'
  return null
}

export function LinksSection({ settings }: { settings: Settings }) {
  return (
    <Section id="links" title="Ссылки" description="Как QuickDrop подписывает добавленные ссылки.">
      <Row>
        <label htmlFor="auto-title" className="text-[13px]">
          Автоматически подтягивать заголовок страницы
        </label>
        <Switch
          id="auto-title"
          checked={settings.autoFetchLinkTitle}
          onCheckedChange={(v) =>
            void setSetting('autoFetchLinkTitle', v).catch((e: unknown) => toast.error(describeError(e)))
          }
        />
      </Row>
      <Field
        label="CORS-прокси для веб-версии"
        htmlFor="link-proxy"
        hint={
          <>
            В браузере большинство сайтов не отдают страницу из-за CORS, поэтому заголовок берётся из адреса.
            {isTauri() ? ' В этом настольном приложении' : ' В настольном приложении'} заголовки извлекаются напрямую,
            прокси не нужен. Прокси увидит адреса ваших ссылок, поэтому по умолчанию он выключен. Шаблон вида
            https://proxy.example/?u={'{url}'}.
          </>
        }
      >
        <CommitInput
          id="link-proxy"
          value={settings.linkProxyUrl}
          placeholder="https://proxy.example/?u={url}"
          validate={validateProxy}
          onCommit={(v) => setSetting('linkProxyUrl', v)}
        />
      </Field>
    </Section>
  )
}
