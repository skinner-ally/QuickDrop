import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { Icon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { listCategories } from '@/db/repo'
import { setSetting } from '@/db/settings'
import { getAllItemsSnapshot } from '@/hooks/useItems'
import {
  autoBackupDirChanged,
  autoBackupStatus,
  BACKUP_KEEP_MAX,
  BACKUP_KEEP_MIN,
  checkAutoBackup,
  forgetPrevDir,
  runBackupNow,
  subscribeAutoBackup,
} from '@/lib/autoBackup'
import { BACKUP_PERIOD_LABEL, backupResultMessage, DESKTOP_HINT, shouldForgetDir } from '@/lib/backupUi'
import { pickDirectory, revealInExplorer, type DirectoryPurpose } from '@/lib/desktop'
import { describeError } from '@/lib/errors'
import { exportDocsToDir, exportReportSummary, type ExportDirReport } from '@/lib/exportDir'
import { formatDateTime } from '@/lib/itemTitle'
import { isTauri } from '@/lib/platform'
import { BACKUP_PERIODS, type BackupPeriod, type Settings } from '@/types'
import { CommitInput, Row, Section } from './Section'

const fail = (e: unknown) => toast.error(describeError(e))

const PERIOD_ITEMS = BACKUP_PERIODS.map((value) => ({ value, label: BACKUP_PERIOD_LABEL[value] }))
const KEEP_ERROR = `Число от ${BACKUP_KEEP_MIN} до ${BACKUP_KEEP_MAX}`

function validateKeep(v: string): string | null {
  if (!/^\d+$/.test(v)) return KEEP_ERROR
  const n = Number(v)
  return n >= BACKUP_KEEP_MIN && n <= BACKUP_KEEP_MAX ? null : KEEP_ERROR
}

async function reveal(path: string) {
  if (!(await revealInExplorer(path))) toast.error('Не удалось открыть папку')
}

/** Строка выбора папки. Папка меняется только через системный диалог: Rust подтверждает её для записи. */
function DirRow({
  label,
  purpose,
  settingKey,
  dir,
  otherDir,
  onChanged,
  disabled,
}: {
  label: string
  purpose: DirectoryPurpose
  settingKey: 'backupDir' | 'mdExportDir'
  dir: string
  otherDir: string
  onChanged?: () => void
  /** Идёт экспорт или копия в эту папку: сменить её нельзя, иначе запись оборвётся. */
  disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)

  const apply = async (next: string) => {
    const prev = dir
    await setSetting(settingKey, next)
    // Прежнюю папку закрываем для записи после того, как новая настройка сохранена (Р17).
    if (shouldForgetDir(prev, next, otherDir)) void forgetPrevDir(prev)
  }

  const choose = async () => {
    setBusy(true)
    try {
      const picked = await pickDirectory({ purpose, defaultPath: dir || undefined })
      if (!picked) return
      await apply(picked)
      onChanged?.()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    setBusy(true)
    try {
      await apply('')
      onChanged?.()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Row className="flex-wrap">
      <div className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
        <span id={`${settingKey}-label`} className="text-2sm font-medium pixel:font-semibold">{label}</span>
        <span
          className={dir ? 'break-all font-mono text-xs' : 'text-xs text-muted-foreground'}
          title={dir || undefined}
          id={`${settingKey}-path`}
        >
          {dir || 'не выбрана'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          disabled={busy || disabled}
          aria-label={`Выбрать: ${label.toLowerCase()}`}
          aria-describedby={`${settingKey}-path`}
          onClick={() => void choose()}
        >
          <Icon name="folder" />
          Выбрать…
        </Button>
        {dir && (
          <>
            <Button variant="outline" aria-label={`Показать в проводнике: ${label.toLowerCase()}`} onClick={() => void reveal(dir)}>
              <Icon name="folder-open" />
              Показать в проводнике
            </Button>
            <Button
              variant="outline"
              disabled={busy || disabled}
              aria-label={`Сбросить: ${label.toLowerCase()}`}
              onClick={() => void reset()}
            >
              <Icon name="x" />
              Сбросить
            </Button>
          </>
        )}
      </div>
    </Row>
  )
}

function AutoBackupBlock({ settings }: { settings: Settings }) {
  const [running, setRunning] = useState(false)
  const { lastError, running: copying } = useSyncExternalStore(subscribeAutoBackup, autoBackupStatus)
  // Плановая копия тоже занимает папку: сменить её или запустить вторую копию, пока идёт запись, нельзя.
  const busy = running || copying

  const runNow = async () => {
    setRunning(true)
    try {
      const result = await runBackupNow()
      const msg = backupResultMessage(result)
      if (msg.kind === 'success') {
        const path = result.status === 'done' ? result.path : ''
        toast.success(msg.text, path ? { action: { label: 'Показать', onClick: () => void reveal(path) } } : undefined)
      } else if (msg.kind === 'error') toast.error(msg.text)
      else toast(msg.text)
    } catch (e) {
      fail(e)
    } finally {
      setRunning(false)
    }
  }

  const changePeriod = (v: string | null) => {
    if (!v || v === settings.backupEvery) return
    const next = v as BackupPeriod
    setSetting('backupEvery', next)
      .then(() => {
        if (next !== 'off' && settings.backupDir) void checkAutoBackup()
      })
      .catch(fail)
  }

  return (
    <>
      <DirRow
        label="Папка для копий"
        purpose="backup"
        settingKey="backupDir"
        dir={settings.backupDir}
        otherDir={settings.mdExportDir}
        onChanged={() => void autoBackupDirChanged()}
        disabled={busy}
      />

      <Row className="flex-wrap">
        <div className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
          <label htmlFor="backup-every" className="text-2sm font-medium pixel:font-semibold">
            Периодичность
          </label>
          {settings.backupEvery !== 'off' && !settings.backupDir && (
            <p className="text-xs text-muted-foreground">Выберите папку: без неё копии не создаются</p>
          )}
        </div>
        <Select value={settings.backupEvery} onValueChange={changePeriod} items={PERIOD_ITEMS}>
          <SelectTrigger id="backup-every" size="sm" className="text-2sm min-w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} align="end">
            {PERIOD_ITEMS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>

      <Row>
        <label htmlFor="backup-keep" className="min-w-0 flex-1 text-2sm font-medium pixel:font-semibold">
          Хранить копий
        </label>
        {/* Ошибка валидации длиннее поля: прижимаем её вправо и не переносим по словам. */}
        <div className="w-20 shrink-0 [&_p]:self-end [&_p]:whitespace-nowrap">
          <CommitInput
            id="backup-keep"
            type="number"
            value={String(settings.backupKeep)}
            validate={validateKeep}
            onCommit={(v) => setSetting('backupKeep', Number(v))}
          />
        </div>
      </Row>

      <Row className="flex-wrap">
        <div className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
          <p className="text-2sm">
            {settings.backupLastAt > 0
              ? `Последняя копия: ${formatDateTime(settings.backupLastAt)}`
              : 'Последняя копия: ещё не создавалась'}
          </p>
          {lastError && <p className="text-xs text-destructive">{lastError}</p>}
        </div>
        <Button variant="outline" disabled={busy} onClick={() => void runNow()}>
          <Icon name={busy ? 'loader' : 'download'} className={busy ? 'animate-spin' : undefined} />
          Сделать копию сейчас
        </Button>
      </Row>
    </>
  )
}

function MarkdownExportBlock({ settings }: { settings: Settings }) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [report, setReport] = useState<ExportDirReport | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Размонтирование секции во время экспорта останавливает его.
  useEffect(() => () => abortRef.current?.abort(), [])

  const dir = settings.mdExportDir

  const start = async () => {
    if (!dir || running) return
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setReport(null)
    setProgress({ done: 0, total: 0 })
    try {
      // Тяжёлый модуль грузится только по требованию.
      const { buildMarkdownExport } = await import('@/lib/markdownExport')
      const items = getAllItemsSnapshot() ?? []
      const entries = buildMarkdownExport(items, await listCategories())
      setProgress({ done: 0, total: entries.length })
      const result = await exportDocsToDir(dir, entries, {
        signal: controller.signal,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      setReport(result)
    } catch (e) {
      if (controller.signal.aborted) toast('Экспорт отменён')
      else fail(e)
    } finally {
      abortRef.current = null
      setRunning(false)
      setProgress(null)
    }
  }

  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <>
      <DirRow
        label="Папка для Markdown"
        purpose="export"
        settingKey="mdExportDir"
        dir={dir}
        otherDir={settings.backupDir}
        disabled={running}
      />
      <p className="text-xs text-muted-foreground">
        Каждая запись — файл .md, вложения — в папке attachments. Файлы с теми же именами перезаписываются, остальное в
        папке не трогается. Записи из корзины не выгружаются.
      </p>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={!dir || running} onClick={() => void start()}>
            <Icon name={running ? 'loader' : 'upload'} className={running ? 'animate-spin' : undefined} />
            Экспортировать в Markdown
          </Button>
          {running && (
            <Button variant="outline" onClick={() => abortRef.current?.abort()}>
              <Icon name="x" />
              Отмена
            </Button>
          )}
        </div>

        {running && progress && (
          <div className="flex flex-col gap-1" role="status">
            <p className="text-xs text-muted-foreground">
              Экспорт: {progress.done} из {progress.total}
            </p>
            <div
              className="h-1.5 w-full bg-muted pixel:h-2 pixel:border-2 pixel:border-wood-dark pixel:bg-paper-line"
              role="progressbar"
              aria-label="Ход экспорта"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div className="h-full bg-foreground pixel:bg-leaf" style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}

        {!running && report && (
          <div className="flex flex-col gap-1.5" role="status">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <p className={report.stopped || report.failed.length > 0 ? 'text-2sm text-destructive' : 'text-2sm'}>
                {exportReportSummary(report)}
              </p>
              <Button variant="outline" size="sm" onClick={() => void reveal(report.dir)}>
                <Icon name="folder-open" />
                Показать в проводнике
              </Button>
            </div>
            {report.failed.length > 0 && (
              <div className="flex flex-col gap-0.5">
                <p className="text-2sm text-destructive">Не записано: {report.failed.length}</p>
                {report.failed.slice(0, 5).map((f) => (
                  <p key={f.path} className="break-all text-xs text-muted-foreground">
                    {f.path}: {f.error}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

export function BackupSection({ settings }: { settings: Settings }) {
  // isTauri() читается при каждом рендере (см. спецификацию: проверка вёрстки в браузере).
  const desktop = isTauri()
  return (
    <Section id="backup" title="Копии и экспорт в папку">
      {desktop ? (
        <>
          <AutoBackupBlock settings={settings} />
          <MarkdownExportBlock settings={settings} />
        </>
      ) : (
        <p className="text-2sm text-muted-foreground">
          {DESKTOP_HINT}: автоматические резервные копии и экспорт всей базы в папку Markdown. В браузере копию можно
          сохранить кнопкой «Экспорт резервной копии», а отдельную запись — пунктом меню «Скачать как Markdown».
        </p>
      )}
    </Section>
  )
}
