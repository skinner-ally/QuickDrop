import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Icon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { setSetting, setSettings } from '@/db/settings'
import { copyText } from '@/lib/actions'
import {
  applyExtensionServer,
  applyGlobalShortcut,
  applyShellOptions,
  generateExtensionToken,
  getAutostart,
  getExtensionDir,
  getExtServerStatus,
  globalShortcutFailure,
  revealInExplorer,
  setAutostart,
  type AutostartState,
  type ExtServerStatus,
} from '@/lib/desktop'
import { describeError } from '@/lib/errors'
import { isTauri } from '@/lib/platform'
import {
  EXTENSION_DIR_SOURCE_HINT,
  EXTENSION_INSTALL_STEPS,
  EXTENSION_UPDATE_HINT,
  extensionManifestPath,
  extStatusText,
  globalShortcutHint,
  isExtensionToken,
  maskToken,
  portRejectedText,
  QUICK_CAPTURE_DESKTOP_HINT,
  validateExtPort,
} from '@/lib/shellUi'
import { confirmDialog } from '@/store/confirm'
import type { Settings } from '@/types'
import { CommitInput, Field, Row, Section } from './Section'

const fail = (e: unknown) => toast.error(describeError(e))

/** Строка «подпись и подсказка слева, переключатель справа». */
function SwitchRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string
  label: string
  hint?: ReactNode
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <Row>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <label htmlFor={id} className="text-2sm pixel:font-semibold">
          {label}
        </label>
        {hint && (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onCheckedChange={onChange}
      />
    </Row>
  )
}

function ExtensionBlock({ settings }: { settings: Settings }) {
  const [status, setStatus] = useState<ExtServerStatus | undefined>()
  const [busy, setBusy] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const show = useCallback((s: ExtServerStatus) => {
    if (alive.current) setStatus(s)
  }, [])

  // Состояние сервера — из Rust при показе секции: оно не хранится в настройках.
  useEffect(() => {
    let cancelled = false
    void getExtServerStatus().then((s) => {
      if (!cancelled) setStatus(s)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const token = settings.extToken
  const hasToken = isExtensionToken(token)
  const st = extStatusText(settings.extEnabled, status)

  const toggleEnabled = async (on: boolean) => {
    setBusy(true)
    try {
      if (on) {
        let next = token
        if (!isExtensionToken(next)) {
          next = generateExtensionToken()
          // Созданный токен сохраняется, даже если сервер не запустится: повторное включение возьмёт его же.
          await setSetting('extToken', next)
        }
        const res = await applyExtensionServer({ extEnabled: true, extPort: settings.extPort, extToken: next })
        show(res)
        if (!res.running) {
          toast.error(res.error?.trim() || 'Не удалось запустить приём от расширения')
          return
        }
        await setSettings({ extToken: next, extEnabled: true })
      } else {
        await setSetting('extEnabled', false)
        const res = await applyExtensionServer({ ...settings, extEnabled: false })
        show(res)
        if (res.error) toast.error(res.error)
      }
    } catch (e) {
      fail(e)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const commitPort = async (v: string) => {
    const port = Number(v)
    if (settings.extEnabled) {
      // Сервер перезапускается на новом порту; при отказе в настройках остаётся прежний порт.
      const res = await applyExtensionServer({ ...settings, extPort: port })
      if (!res.running) {
        // Rust при отказе нового порта оставляет прежний сервер: состояние — из Rust, ошибка — под полем.
        show(await getExtServerStatus())
        throw new Error(portRejectedText(res.error, settings.extPort))
      }
      show(res)
    }
    await setSetting('extPort', port)
  }

  const renewToken = async () => {
    if (hasToken) {
      const ok = await confirmDialog({
        title: 'Сменить токен?',
        description: 'Расширение перестанет сохранять записи, пока в его настройках не указан новый токен.',
        confirmLabel: 'Сменить',
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      const next = generateExtensionToken()
      if (settings.extEnabled) {
        const res = await applyExtensionServer({ ...settings, extToken: next })
        show(res)
        if (!res.running) {
          toast.error(res.error?.trim() || 'Не удалось перезапустить приём с новым токеном')
          return
        }
      }
      await setSetting('extToken', next)
    } catch (e) {
      fail(e)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  return (
    <>
      <h3 className="text-2sm font-medium pixel:font-semibold">Расширение для Chrome</h3>

      <SwitchRow
        id="ext-enabled"
        label="Принимать записи от расширения"
        hint="QuickDrop слушает только этот компьютер (127.0.0.1) и только пока приём включён. Работает, пока приложение запущено"
        checked={settings.extEnabled}
        disabled={busy}
        onChange={(v) => void toggleEnabled(v)}
      />

      <Row>
        <span className="text-2sm">Состояние</span>
        <p role="status" className={st.error ? 'text-2sm text-destructive' : 'text-2sm text-muted-foreground'}>
          {st.text}
        </p>
      </Row>

      <Field label="Порт" htmlFor="ext-port">
        <CommitInput
          id="ext-port"
          value={String(settings.extPort)}
          validate={validateExtPort}
          onCommit={commitPort}
          inlineCommitError
        />
      </Field>

      <Field
        label="Токен"
        htmlFor="ext-token"
        hint="Токен хранится только на этом компьютере и не попадает в резервную копию. Пока QuickDrop закрыт или приём выключен, порт может занять другая программа и получить от расширения токен и отправляемое. На компьютере с несколькими пользователями выберите нестандартный порт и не пользуйтесь расширением, когда QuickDrop закрыт"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            id="ext-token"
            readOnly
            value={hasToken && showToken ? token : maskToken(hasToken ? token : '')}
            autoComplete="off"
            spellCheck={false}
            className="min-w-48 flex-1 font-mono"
          />
          <Button
            variant="outline"
            disabled={!hasToken}
            aria-pressed={showToken}
            onClick={() => setShowToken((s) => !s)}
          >
            <Icon name={showToken ? 'eye-off' : 'eye'} />
            {showToken ? 'Скрыть' : 'Показать'}
          </Button>
          <Button variant="outline" disabled={!hasToken} onClick={() => void copyText(token, 'Токен скопирован')}>
            <Icon name="copy" />
            Скопировать
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void renewToken()}>
            <Icon name="refresh" />
            Сменить
          </Button>
        </div>
      </Field>

      <div className="flex flex-col gap-1.5 px-divider pixel:pt-2">
        <h4 className="text-2sm font-medium pixel:font-semibold">Установка расширения</h4>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-2sm">
          {EXTENSION_INSTALL_STEPS.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>

      <ExtensionDirRow />
    </>
  )
}

/** Путь к папке расширения из установщика; без неё — где взять папку в исходниках. */
function ExtensionDirRow() {
  // undefined — путь ещё не получен из Rust, null — папки нет.
  const [dir, setDir] = useState<string | null | undefined>()

  useEffect(() => {
    let cancelled = false
    void getExtensionDir().then((d) => {
      if (!cancelled) setDir(d)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (dir === undefined) return null
  if (dir === null) {
    return (
      <Row>
        <p className="text-xs text-muted-foreground">{EXTENSION_DIR_SOURCE_HINT}</p>
      </Row>
    )
  }

  const reveal = async () => {
    if (!(await revealInExplorer(extensionManifestPath(dir)))) toast.error('Не удалось открыть папку')
  }

  return (
    <Row className="flex-wrap">
      <div className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
        <span className="text-2sm font-medium pixel:font-semibold">Папка расширения</span>
        <span id="ext-dir-path" className="select-all break-all font-mono text-xs" title={dir}>
          {dir}
        </span>
        <span className="text-xs text-muted-foreground">{EXTENSION_UPDATE_HINT}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" aria-describedby="ext-dir-path" onClick={() => void reveal()}>
          <Icon name="folder-open" />
          Показать папку
        </Button>
        <Button
          variant="outline"
          aria-describedby="ext-dir-path"
          onClick={() => void copyText(dir, 'Путь к папке скопирован')}
        >
          <Icon name="copy" />
          Копировать путь
        </Button>
      </div>
    </Row>
  )
}

function DesktopBlock({ settings }: { settings: Settings }) {
  const [autostart, setAutostartState] = useState<AutostartState | undefined>()
  const [autostartBusy, setAutostartBusy] = useState(false)
  const alive = useRef(true)
  // globalShortcutFailure — переменная модуля, не реактивна: после повтора перерисовываем вручную.
  const [, rerender] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // Автозапуск читается из системы при показе секции.
  useEffect(() => {
    let cancelled = false
    void getAutostart().then((s) => {
      if (!cancelled) setAutostartState(s)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Флаг сохранён всегда; если Rust отказал, он применится при следующем запуске (initDesktop).
  const changeShell = async (patch: Partial<Pick<Settings, 'closeToTray' | 'captureWindow'>>) => {
    try {
      await setSettings(patch)
      const ok = await applyShellOptions({ ...settings, ...patch })
      if (!ok) toast.error('Не удалось применить настройку сразу: она вступит в силу при следующем запуске')
    } catch (e) {
      fail(e)
    }
  }

  const changeAutostart = async (on: boolean) => {
    setAutostartBusy(true)
    try {
      const res = await setAutostart(on)
      if (!res.ok) toast.error(res.error?.trim() || 'Не удалось изменить автозапуск')
      const next = await getAutostart()
      if (alive.current) setAutostartState(next)
    } finally {
      if (alive.current) setAutostartBusy(false)
    }
  }

  // Enter в поле с тем же значением ничего не делает (CommitInput), поэтому у неназначенного сочетания своя кнопка.
  const retryShortcut = async () => {
    const res = await applyGlobalShortcut(settings.globalShortcut)
    if (res.ok) toast.success('Сочетание назначено')
    else toast.error(res.error ?? 'Сочетание занято другой программой')
    if (alive.current) rerender()
  }

  const shortcutFailed = globalShortcutFailure() === settings.globalShortcut

  return (
    <>
      <SwitchRow
        id="capture-window"
        label="Мини-окно быстрой записи"
        hint="Глобальное сочетание открывает маленькое окно поверх других программ. Выключено — поднимается главное окно QuickDrop"
        checked={settings.captureWindow}
        onChange={(v) => void changeShell({ captureWindow: v })}
      />

      <Field
        label="Глобальное сочетание"
        htmlFor="global-shortcut"
        hint={
          // Сочетание из настроек не зарегистрировалось при запуске — поле не должно выглядеть рабочим.
          shortcutFailed ? (
            <span className="text-destructive">
              Сочетание {settings.globalShortcut} не назначено: скорее всего, его заняла другая программа. Освободите
              его и нажмите «Повторить» или укажите другое.{' '}
              <Button variant="link" size="sm" className="h-auto p-0 align-baseline" onClick={() => void retryShortcut()}>
                Повторить
              </Button>
            </span>
          ) : (
            globalShortcutHint(settings.captureWindow)
          )
        }
      >
        <CommitInput
          id="global-shortcut"
          value={settings.globalShortcut}
          validate={(v) => (v ? null : 'Укажите сочетание клавиш')}
          inlineCommitError
          onCommit={async (v) => {
            const res = await applyGlobalShortcut(v)
            // Отказ — исключение: иначе поле показало бы «Сохранено», а ошибку — лишь всплывающим сообщением.
            if (!res.ok) throw new Error(res.error ?? 'Сочетание занято другой программой')
            await setSetting('globalShortcut', v)
          }}
        />
      </Field>

      <SwitchRow
        id="close-to-tray"
        label="Сворачивать в трей при закрытии"
        hint="Крестик прячет окно в трей, QuickDrop продолжает работать: действуют сочетание и приём от расширения. Выйти — через значок в трее"
        checked={settings.closeToTray}
        onChange={(v) => void changeShell({ closeToTray: v })}
      />

      <SwitchRow
        id="autostart"
        label="Запускать вместе с системой"
        hint={
          autostart && !autostart.available ? (
            <>
              QuickDrop стартует свёрнутым в трей.{' '}
              <span className="text-destructive">{autostart.reason?.trim() || 'Недоступно'}</span>
            </>
          ) : (
            'QuickDrop стартует свёрнутым в трей'
          )
        }
        checked={autostart?.enabled === true}
        disabled={!autostart || !autostart.available || autostartBusy}
        onChange={(v) => void changeAutostart(v)}
      />

      <ExtensionBlock settings={settings} />
    </>
  )
}

export function QuickCaptureSection({ settings }: { settings: Settings }) {
  return (
    <Section
      id="quick-capture"
      title="Быстрый захват"
      description="Мини-окно по глобальному сочетанию, значок в трее, запуск вместе с системой и приём записей от расширения браузера"
    >
      {isTauri() ? (
        <DesktopBlock settings={settings} />
      ) : (
        <p className="text-xs text-muted-foreground">{QUICK_CAPTURE_DESKTOP_HINT}</p>
      )}
    </Section>
  )
}
