import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '@/components/icons'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { clearAllData, seedDemoData } from '@/db/seed'
import { setSetting, useSettings } from '@/db/settings'
import { useAllItems, useTrashedItems } from '@/hooks/useItems'
import { actEmptyTrashAsk, saveBlob } from '@/lib/actions'
import { describeError } from '@/lib/errors'
import { backupFileName, exportBackup, importBackup, type ImportMode, type ImportReport } from '@/lib/exportImport'
import { formatBytes } from '@/lib/itemTitle'
import { TRASH_DAYS_OPTIONS, trashDaysLabel } from '@/lib/trash'
import { Row, Section, saved } from './Section'

const fail = (e: unknown) => toast.error(describeError(e))

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border px-3 py-2 px-well">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-2sm font-medium tabular-nums">{value}</dd>
    </div>
  )
}

function reportText(r: ImportReport): string {
  let text = `Записей: ${r.items}${r.trashed > 0 ? ` (в корзине: ${r.trashed})` : ''}, файлов: ${r.files}, категорий: ${r.categories}`
  if (r.positions > 0) text += `, положений на графе: ${r.positions}`
  if (r.searches > 0) text += `, сохранённых поисков: ${r.searches}`
  return `${text}, пропущено: ${r.skipped}`
}

export function DataSection() {
  const items = useAllItems()
  const trashed = useTrashedItems()
  const settings = useSettings()
  const fileInput = useRef<HTMLInputElement>(null)

  const [usage, setUsage] = useState<{ usage?: number; quota?: number } | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [report, setReport] = useState<ImportReport | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [confirmWord, setConfirmWord] = useState('')

  const stats = useMemo(() => {
    const list = items ?? []
    let files = 0
    let bytes = 0
    for (const it of list) {
      if (it.fileId) {
        files++
        bytes += it.fileSize ?? 0
      }
    }
    return {
      total: list.length,
      inbox: list.filter((i) => i.status === 'inbox').length,
      library: list.filter((i) => i.status === 'library').length,
      archive: list.filter((i) => i.status === 'archive').length,
      files,
      bytes,
    }
  }, [items])

  const trash = useMemo(() => {
    let bytes = 0
    for (const it of trashed ?? []) if (it.fileId) bytes += it.fileSize ?? 0
    return { count: trashed?.length ?? 0, bytes }
  }, [trashed])

  // Текущее значение вне списка (например, из импортированной копии) показывается дополнительным пунктом.
  const trashOptions = useMemo(() => {
    const days = settings?.trashDays
    const list = days !== undefined && !TRASH_DAYS_OPTIONS.includes(days) ? [...TRASH_DAYS_OPTIONS, days] : [...TRASH_DAYS_OPTIONS]
    return list.map((d) => ({ value: String(d), label: trashDaysLabel(d) }))
  }, [settings?.trashDays])

  const changeTrashDays = (v: string | null) => {
    const n = Number(v)
    if (v === null || !Number.isFinite(n) || n === settings?.trashDays) return
    setSetting('trashDays', n).then(saved, fail)
  }

  const refreshStorage = () => {
    const s = typeof navigator !== 'undefined' ? navigator.storage : undefined
    if (!s) return
    s.estimate?.().then(setUsage, () => {})
    s.persisted?.().then(setPersisted, () => {})
  }
  // Пересчёт и при изменении корзины: оценка браузера обновляется не мгновенно, поэтому ещё раз через секунду.
  useEffect(refreshStorage, [trash.count])
  useEffect(() => {
    const t = setTimeout(refreshStorage, 1200)
    return () => clearTimeout(t)
  }, [trash.count])

  const persist = async () => {
    try {
      const ok = (await navigator.storage?.persist?.()) ?? false
      setPersisted(ok)
      if (ok) toast.success('Хранилище защищено от автоматической очистки', { duration: 2000 })
      else toast.error('Браузер не разрешил защиту хранилища. Установите приложение на главный экран и попробуйте снова.')
    } catch (e) {
      fail(e)
    }
  }

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name)
    try {
      await fn()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }

  const doExport = () =>
    run('export', async () => {
      const blob = await exportBackup()
      saveBlob(blob, backupFileName())
      toast.success('Резервная копия сохранена', { duration: 2000 })
    })

  const doImport = (mode: ImportMode) => {
    const file = importFile
    if (!file) return
    setImportFile(null)
    void run('import', async () => {
      const r = await importBackup(file, mode)
      setReport(r)
    })
  }

  const doSeed = () =>
    run('seed', async () => {
      const ok = await seedDemoData(true)
      toast.success(ok ? 'Демоданные загружены' : 'Демоданные не загружены', { duration: 2000 })
    })

  const doClear = () =>
    run('clear', async () => {
      await clearAllData()
      setClearOpen(false)
      setConfirmWord('')
      toast.success('Все данные удалены', { duration: 2000 })
    })

  const canClear = confirmWord.trim().toLowerCase() === 'удалить'
  const hasStorageApi = typeof navigator !== 'undefined' && !!navigator.storage

  return (
    <Section
      id="data"
      title="Данные"
      description="Данные хранятся локально на этом устройстве (IndexedDB) и между устройствами не синхронизируются. Для переноса используйте экспорт и импорт."
    >
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Записей всего" value={String(stats.total)} />
        <Stat label="Входящие" value={String(stats.inbox)} />
        <Stat label="База знаний" value={String(stats.library)} />
        <Stat label="Архив" value={String(stats.archive)} />
        <Stat label="В корзине" value={trash.count > 0 ? `${trash.count}, ${formatBytes(trash.bytes)}` : '0'} />
        <Stat label="Файлов" value={`${stats.files}, ${formatBytes(stats.bytes)}`} />
        <Stat
          label="Занято в хранилище"
          value={usage?.usage != null ? `${formatBytes(usage.usage)}${usage.quota ? ` из ${formatBytes(usage.quota)}` : ''}` : 'нет данных'}
        />
      </dl>

      <Row className="flex-wrap">
        <div className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
          <label htmlFor="trash-days" className="text-2sm font-medium pixel:font-semibold">
            Хранить удалённое
          </label>
          <p className="text-xs text-muted-foreground">Записи старше срока удаляются при запуске и раз в 6 часов</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {settings && (
            <Select value={String(settings.trashDays)} onValueChange={changeTrashDays} items={trashOptions}>
              <SelectTrigger id="trash-days" size="sm" className="text-2sm min-w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false} align="end">
                {trashOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" disabled={trash.count === 0} onClick={() => void actEmptyTrashAsk()}>
            <Icon name="trash" />
            Очистить корзину
          </Button>
        </div>
      </Row>

      {hasStorageApi && (
        <Row className="flex-wrap">
          <p className="min-w-0 flex-1 basis-60 text-xs text-muted-foreground">
            {persisted
              ? 'Хранилище защищено: браузер не удалит данные автоматически.'
              : 'Без защиты браузер, особенно Safari на iPhone, может удалить данные при нехватке места или после долгого простоя.'}
          </p>
          <Button variant="outline" onClick={() => void persist()} disabled={persisted === true}>
            <Icon name="shield-check" />
            {persisted ? 'Защищено' : 'Защитить хранилище от очистки'}
          </Button>
        </Row>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void doExport()} disabled={busy !== null}>
          <Icon name="download" />
          Экспорт резервной копии
        </Button>
        <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={busy !== null}>
          <Icon name="upload" />
          Импорт
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          aria-label="Файл резервной копии"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) setImportFile(f)
          }}
        />
        <Button variant="outline" onClick={() => void doSeed()} disabled={busy !== null}>
          <Icon name="refresh" />
          Загрузить демоданные заново
        </Button>
        <Button variant="destructive" onClick={() => setClearOpen(true)} disabled={busy !== null}>
          <Icon name="trash" />
          Удалить все данные
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        В копию не попадают API-ключ и настройки, определяющие сетевые запросы (AI, прокси, заголовки ссылок).
      </p>

      <Dialog open={importFile !== null} onOpenChange={(o) => !o && setImportFile(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Импорт резервной копии</DialogTitle>
            <DialogDescription>
              Файл: {importFile?.name}. «Объединить» добавит записи к текущим. «Заменить всё» сначала удалит все
              текущие записи, файлы и категории, это нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportFile(null)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={() => doImport('replace')}>
              Заменить всё
            </Button>
            <Button onClick={() => doImport('merge')}>Объединить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={report !== null} onOpenChange={(o) => !o && setReport(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Импорт завершён</DialogTitle>
            <DialogDescription>{report && reportText(report)}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReport(null)}>
              Закрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={clearOpen}
        onOpenChange={(o) => {
          setClearOpen(o)
          if (!o) setConfirmWord('')
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Удалить все данные?</DialogTitle>
            <DialogDescription>
              Все записи, файлы и категории, а также ключ API, настройки ИИ-помощника и адрес прокси будут удалены с
              этого устройства без возможности восстановления. Сначала сделайте экспорт, если данные нужны. Для
              подтверждения введите слово «удалить».
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (canClear) void doClear()
            }}
          >
            <Input
              value={confirmWord}
              onChange={(e) => setConfirmWord(e.target.value)}
              placeholder="удалить"
              aria-label="Подтверждение: введите слово «удалить»"
              autoComplete="off"
            />
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClearOpen(false)}>
              Отмена
            </Button>
            <Button variant="destructive" disabled={!canClear || busy !== null} onClick={() => void doClear()}>
              Удалить всё
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Section>
  )
}
