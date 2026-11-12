import { Icon, type IconName } from '@/components/icons'
import { toast } from 'sonner'
import { useScene } from '@/components/layout/ThemeProvider'
import { Switch } from '@/components/ui/switch'
import { setSetting } from '@/db/settings'
import { describeError } from '@/lib/errors'
import { FONT_LABEL, FONT_PREFS, SCENE_LABEL, SCENE_PREFS } from '@/lib/scene'
import { cn } from '@/lib/utils'
import type { FontPref, ScenePref, Settings } from '@/types'
import { radioGroupKeyDown } from './radioKeys'
import { Field, Section } from './Section'

interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: IconName
}

const THEME_OPTIONS: Array<SegmentedOption<Settings['theme']>> = [
  { value: 'system', label: 'Системная', icon: 'monitor' },
  { value: 'light', label: 'Светлая', icon: 'sun' },
  { value: 'dark', label: 'Тёмная', icon: 'moon' },
]
const SCENE_OPTIONS: Array<SegmentedOption<ScenePref>> = SCENE_PREFS.map((value) => ({ value, label: SCENE_LABEL[value] }))
const FONT_OPTIONS: Array<SegmentedOption<FontPref>> = FONT_PREFS.map((value) => ({ value, label: FONT_LABEL[value] }))

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string
  value: T
  options: ReadonlyArray<SegmentedOption<T>>
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={disabled ? undefined : radioGroupKeyDown}
      className={cn('inline-flex w-fit max-w-full flex-wrap rounded-lg bg-muted p-[3px] pixel:gap-1 pixel:bg-transparent pixel:p-0', disabled && 'opacity-50')}
    >
      {options.map(({ value: v, label: text, icon }) => {
        const active = value === v
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            aria-disabled={disabled || undefined}
            tabIndex={active ? 0 : -1}
            onClick={disabled ? undefined : () => onChange(v)}
            className={cn(
              'px-btn inline-flex h-7 items-center gap-1.5 rounded-md px-3 pixel:h-7.5 text-2sm font-medium text-muted-foreground transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              disabled ? 'cursor-default' : 'hover:text-foreground',
              active && 'bg-background text-foreground shadow-sm dark:bg-input/40',
            )}
          >
            {icon && <Icon name={icon} className="size-4" />}
            {text}
          </button>
        )
      })}
    </div>
  )
}

export function AppearanceSection({ settings }: { settings: Settings }) {
  const { resolvedScene, pixel, setScene, setFont } = useScene()
  const fail = (e: unknown) => toast.error(describeError(e))

  const chooseScene = (v: ScenePref) => {
    setScene(v)
    setSetting('scene', v).catch(fail)
  }
  const chooseTheme = (v: Settings['theme']) => {
    setSetting('theme', v).catch(fail)
  }
  const chooseFont = (v: FontPref) => {
    setFont(v)
    setSetting('font', v).catch(fail)
  }

  return (
    <Section
      id="appearance"
      title="Оформление"
      description="Сцена, тема и шрифт интерфейса. «Системная» тема следует настройке устройства."
    >
      <Field
        label="Сцена"
        hint={settings.scene === 'auto' ? `По времени года: сейчас «${SCENE_LABEL[resolvedScene]}».` : undefined}
      >
        <Segmented label="Сцена" value={settings.scene} options={SCENE_OPTIONS} onChange={chooseScene} />
      </Field>
      <Field label="Тема">
        <Segmented label="Тема" value={settings.theme} options={THEME_OPTIONS} onChange={chooseTheme} />
      </Field>
      <Field
        label="Шрифт текста"
        hint="Действует в пиксельных сценах. Логотип и заголовки разделов остаются пиксельными."
      >
        <Segmented
          label="Шрифт текста"
          value={settings.font}
          options={FONT_OPTIONS}
          onChange={chooseFont}
          disabled={!pixel}
        />
      </Field>
      <div className="flex flex-col gap-1.5 px-divider pixel:pt-2">
        <div className="flex items-center justify-between gap-3 pixel:gap-4 pixel:max-md:flex-wrap">
          <label htmlFor="ambient" className="text-2sm pixel:font-semibold">
            Живой фон
          </label>
          <Switch
            id="ambient"
            checked={settings.ambient}
            onCheckedChange={(v) => void setSetting('ambient', v).catch(fail)}
          />
        </div>
        <p className="text-xs text-muted-foreground">Листопад, лучи, снег, бабочки и светлячки на графе.</p>
      </div>
    </Section>
  )
}
