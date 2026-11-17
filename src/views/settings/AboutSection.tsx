import { isTauri } from '@/lib/platform'
import { Section } from './Section'

export function AboutSection() {
  const version = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '0.2.3'
  return (
    <Section id="about" title="О приложении">
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-2sm">
        <dt className="text-muted-foreground">Название</dt>
        <dd>QuickDrop</dd>
        <dt className="text-muted-foreground">Версия</dt>
        <dd className="tabular-nums">{version}</dd>
        <dt className="text-muted-foreground">Платформа</dt>
        <dd>{isTauri() ? 'Настольное приложение' : 'Веб'}</dd>
      </dl>
      <p className="text-2sm text-muted-foreground">
        Одно место, куда мгновенно сбрасываются текст, ссылки, код, идеи и файлы. Разбирать их можно потом.
      </p>
    </Section>
  )
}
