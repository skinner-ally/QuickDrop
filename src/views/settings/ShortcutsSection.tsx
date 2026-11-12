import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { setSetting } from '@/db/settings'
import { applyGlobalShortcut, globalShortcutFailure } from '@/lib/desktop'
import { isTauri, modKey } from '@/lib/platform'
import type { Settings } from '@/types'
import { CommitInput, Field, Section } from './Section'

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border bg-muted px-1 font-mono text-2xs text-foreground/80">
      {children}
    </kbd>
  )
}

function Keys({ keys }: { keys: string[][] }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {keys.map((combo, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <span className="text-xs text-muted-foreground">или</span>}
          <span className="flex items-center gap-0.5">
            {combo.map((k, j) => (
              <Kbd key={j}>{k}</Kbd>
            ))}
          </span>
        </span>
      ))}
    </span>
  )
}

export function ShortcutsSection({ settings }: { settings: Settings }) {
  const mod = modKey()
  const rows: Array<{ keys: string[][]; label: string }> = [
    { keys: [[mod, 'Shift', 'Space'], ['Alt', 'N'], ['N']], label: 'Быстрая запись (N, кроме полей ввода)' },
    { keys: [[mod, 'K'], ['/']], label: 'Поиск' },
    { keys: [['1'], ['2'], ['3'], ['4'], ['5']], label: 'Разделы: Входящие, База знаний, Избранное, Архив, Граф' },
    { keys: [['Esc']], label: 'Закрыть панель или детали' },
    { keys: [[mod, 'V']], label: 'Добавить содержимое буфера (вне полей ввода)' },
    { keys: [['J'], ['K']], label: 'В списке: вниз и вверх' },
    { keys: [['E']], label: 'В списке: в базу знаний' },
    { keys: [['A']], label: 'В списке: в архив' },
    { keys: [['F']], label: 'В списке: в избранное' },
    { keys: [['Enter']], label: 'В списке: открыть' },
    { keys: [['Del']], label: 'В списке: в корзину' },
    { keys: [['E']], label: 'В корзине: восстановить' },
    { keys: [['Del']], label: 'В корзине: удалить навсегда' },
    { keys: [['←'], ['↑'], ['↓'], ['→']], label: 'На графе: переход между записями' },
    { keys: [['Tab']], label: 'На графе: по связям записи (после последней — дальше по странице)' },
    { keys: [['Enter']], label: 'На графе: открыть запись' },
    { keys: [['E']], label: 'На графе: категория' },
    { keys: [['L']], label: 'На графе: связать с другой записью' },
    { keys: [['A']], label: 'На графе: в архив или из архива' },
    { keys: [['F']], label: 'На графе: в избранное' },
    { keys: [['Del']], label: 'На графе: в корзину или убрать выбранную связь' },
    { keys: [['Esc']], label: 'На графе: снять курсор' },
    { keys: [['+'], ['−']], label: 'На графе: масштаб' },
    { keys: [['0']], label: 'На графе: весь граф' },
    { keys: [['Shift', '←↑↓→']], label: 'На графе: сдвиг' },
  ]
  return (
    <Section
      id="shortcuts"
      title="Горячие клавиши"
      description="Работают внутри открытого приложения. Файлы можно перетащить в окно, чтобы добавить их. На графе колесо мыши меняет масштаб, перетаскивание фона сдвигает вид."
    >
      <ul className="divide-y rounded-lg border px-well pixel:divide-y-2">
        {rows.map((r) => (
          <li
            key={r.label}
            className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
          >
            <span className="text-2sm">{r.label}</span>
            <Keys keys={r.keys} />
          </li>
        ))}
      </ul>

      {isTauri() ? (
        <Field
          label="Глобальное сочетание"
          htmlFor="global-shortcut"
          hint={
            // Сочетание из настроек не зарегистрировалось при запуске — поле не должно выглядеть рабочим.
            globalShortcutFailure() === settings.globalShortcut ? (
              <span className="text-destructive">
                Сочетание {settings.globalShortcut} не назначено: скорее всего, его заняла другая программа. Укажите
                другое.
              </span>
            ) : (
              'Поднимает окно и открывает добавление из любого приложения. Формат: CommandOrControl+Shift+Space.'
            )
          }
        >
          <CommitInput
            id="global-shortcut"
            value={settings.globalShortcut}
            validate={(v) => (v ? null : 'Укажите сочетание клавиш')}
            onCommit={async (v) => {
              const res = await applyGlobalShortcut(v)
              if (res.ok) {
                await setSetting('globalShortcut', v)
                toast.success('Глобальное сочетание применено')
              } else {
                toast.error(res.error ?? 'Сочетание занято другой программой')
              }
            }}
          />
        </Field>
      ) : (
        <p className="text-xs text-muted-foreground">
          Глобальная клавиша, работающая из любого приложения, доступна в настольной версии.
        </p>
      )}
    </Section>
  )
}
