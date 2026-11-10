import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, RefreshCw, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { clearAllData, seedDemoData } from '@/db/seed'
import { useAllItems } from '@/hooks/useItems'
import { saveBlob } from '@/lib/actions'
import { describeError } from '@/lib/errors'
import { backupFileName, exportBackup, importBackup, type ImportMode, type ImportReport } from '@/lib/exportImport'
import { formatBytes } from '@/lib/itemTitle'
import { Row, Section } from './Section'

const fail = (e: unknown) => toast.error(describeError(e))

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-[13px] font-medium tabular-nums">{value}</dd>
    </div>
  )
}

function reportText(r: ImportReport): string {
  return `Записей: ${r.items}, файлов: ${r.files}, категорий: ${r.categories}, пропущено: ${r.skipped}`
}

export function DataSection() {
  const items = useAllItems()
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

  const refreshStorage = () => {
    const s = typeof navigator !== 'undefined' ? navigator.storage : undefined
    if (!s) return
    s.estimate?.().then(setUsage, () => {})
    s.persisted?.().then(setPersisted, () => {})
  }
  useEffect(refreshStorage, [])

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
        <Stat label="Файлов" value={`${stats.files}, ${formatBytes(stats.bytes)}`} />
        <Stat
          label="Занято в хранилище"
          value={usage?.usage != null ? `${formatBytes(usage.usage)}${usage.quota ? ` из ${formatBytes(usage.quota)}` : ''}` : 'нет данных'}
        />
      </dl>

      {hasStorageApi && (
        <Row className="flex-wrap">
          <p className="min-w-0 flex-1 basis-60 text-xs text-muted-foreground">
            {persisted
              ? 'Хранилище защищено: браузер не удалит данные автоматически.'
              : 'Без защиты браузер, особенно Safari на iPhone, может удалить данные при нехватке места или после долгого простоя.'}
          </p>
          <Button variant="outline" onClick={() => void persist()} disabled={persisted === true}>
            <ShieldCheck strokeWidth={1.75} />
            {persisted ? 'Защищено' : 'Защитить хранилище от очистки'}
          </Button>
        </Row>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void doExport()} disabled={busy !== null}>
          <Download strokeWidth={1.75} />
          Экспорт резервной копии
        </Button>
        <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={busy !== null}>
          <Upload strokeWidth={1.75} />
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
          <RefreshCw strokeWidth={1.75} />
          Загрузить демоданные заново
        </Button>
        <Button variant="destructive" onClick={() => setClearOpen(true)} disabled={busy !== null}>
          <Trash2 strokeWidth={1.75} />
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
