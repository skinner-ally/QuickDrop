import { Monitor, Moon, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { setSetting } from '@/db/settings'
import { describeError } from '@/lib/errors'
import { cn } from '@/lib/utils'
import type { Settings } from '@/types'
import { radioGroupKeyDown } from './radioKeys'
import { Section } from './Section'

const OPTIONS: Array<{ value: Settings['theme']; label: string; Icon: typeof Sun }> = [
  { value: 'system', label: 'Системная', Icon: Monitor },
  { value: 'light', label: 'Светлая', Icon: Sun },
  { value: 'dark', label: 'Тёмная', Icon: Moon },
]

export function AppearanceSection({ settings }: { settings: Settings }) {
  const choose = (v: Settings['theme']) => {
    setSetting('theme', v).catch((e: unknown) => toast.error(describeError(e)))
  }
  return (
    <Section id="appearance" title="Оформление" description="Тема интерфейса. «Системная» следует настройке устройства.">
      <div role="radiogroup" aria-label="Тема" onKeyDown={radioGroupKeyDown} className="inline-flex w-fit rounded-lg bg-muted p-[3px]">
        {OPTIONS.map(({ value, label, Icon }) => {
          const active = settings.theme === value
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              tabIndex={active ? 0 : -1}
              onClick={() => choose(value)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
                active && 'bg-background text-foreground shadow-sm dark:bg-input/40',
              )}
            >
              <Icon className="size-4" strokeWidth={1.75} aria-hidden />
              {label}
            </button>
          )
        })}
      </div>
    </Section>
  )
}
