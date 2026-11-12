import { toast } from 'sonner'
import { db } from '@/db/db'
import { getSettings, setSetting } from '@/db/settings'
import { dirsInUse, forgetUnusedDir } from '@/lib/backupUi'
import { forgetDirectory, listBackups, pruneBackups, saveBackupFile } from '@/lib/desktop'
import type { PruneResult, SavedFile } from '@/lib/desktop'
import { describeError } from '@/lib/errors'
import { exportBackup } from '@/lib/exportImport'
import { isTauri } from '@/lib/platform'
import { useUi } from '@/store/ui'
import type { Settings } from '@/types'

export const BACKUP_PERIOD_MS = { daily: 24 * 3600_000, weekly: 7 * 24 * 3600_000 } as const
export const BACKUP_CHECK_INTERVAL_MS = 3600_000
export const BACKUP_START_DELAY_MS = 30_000
export const BACKUP_KEEP_MIN = 1
export const BACKUP_KEEP_MAX = 100

const KEEP_DEFAULT = 10
/**
 * Плановая попытка после сбоя — не раньше очередной часовой проверки, в том числе при возврате к окну:
 * недоступная папка не должна каждый раз стоить полной выгрузки базы. Запас в минуту — чтобы часовой таймер
 * не промахнулся мимо порога на миллисекунды.
 */
const RETRY_PAUSE_MS = BACKUP_CHECK_INTERVAL_MS - 60_000

const pad = (n: number, width = 2): string => String(n).padStart(width, '0')

/** quickdrop-backup-YYYYMMDD-HHMMSS.json по локальному времени. */
export function autoBackupFileName(date: Date = new Date()): string {
  const day = `${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `quickdrop-backup-${day}-${time}.json`
}

/** Целое в [BACKUP_KEEP_MIN, BACKUP_KEEP_MAX]; не число → 10. */
export function clampKeep(keep: number): number {
  if (typeof keep !== 'number' || Number.isNaN(keep)) return KEEP_DEFAULT
  return Math.min(BACKUP_KEEP_MAX, Math.max(BACKUP_KEEP_MIN, Math.trunc(keep)))
}

export function isBackupDue(
  s: Pick<Settings, 'backupDir' | 'backupEvery' | 'backupLastAt'>,
  now: number,
): boolean {
  if (s.backupEvery === 'off' || s.backupDir.trim() === '') return false
  // backupLastAt в будущем — часы перевели назад: ждать «до того времени» нельзя.
  if (s.backupLastAt <= 0 || s.backupLastAt > now) return true
  return now - s.backupLastAt >= BACKUP_PERIOD_MS[s.backupEvery]
}

export type BackupSkipReason = 'not-desktop' | 'off' | 'no-dir' | 'not-due' | 'busy' | 'empty' | 'retry-later'
export type BackupRunResult =
  | { status: 'skipped'; reason: BackupSkipReason }
  | { status: 'done'; path: string; size: number; removed: number }
  | { status: 'failed'; error: string }

export interface AutoBackupStatus {
  running: boolean
  lastError: string | null
  lastPath: string | null
}

export interface AutoBackupDeps {
  isDesktop(): boolean
  now(): number
  getSettings(): Promise<Settings>
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>
  /** Число записей в базе, включая корзину (настоящая зависимость: `db.items.count()`). */
  countItems(): Promise<number>
  /** Папка доступна и подтверждена, иначе исключение с текстом Rust (настоящая зависимость: `listBackups`). */
  checkDir(dir: string): Promise<void>
  exportBackup(): Promise<Blob>
  saveBackupFile(dir: string, fileName: string, data: Blob): Promise<SavedFile>
  /** protect — имя только что сохранённой копии. */
  pruneBackups(dir: string, keep: number, protect: string): Promise<PruneResult>
  /** Сообщить о сбое планового запуска. */
  notifyError(message: string): void
}

export interface AutoBackup {
  /** Плановая проверка: запускает копию, только если пришёл срок. Никогда не бросает. */
  check(): Promise<BackupRunResult>
  /** «Создать копию сейчас»: срок и backupEvery не учитываются, папка обязательна. Никогда не бросает. */
  runNow(): Promise<BackupRunResult>
  /** Тот же объект, пока состояние не изменилось (годится для useSyncExternalStore). */
  status(): AutoBackupStatus
  /** Слушатель изменений status(); возвращает отписку. */
  subscribe(listener: () => void): () => void
  /** Резолвится, когда копия не идёт (в том числе повторно запущенная runNow). Никогда не отклоняется. */
  idle(): Promise<void>
  /** Снять паузу после сбоя и ошибку: пользователь сменил или заново выбрал папку. */
  resetFailure(): void
  /** После смены папки в настройках: дождаться идущей копии, снять паузу и ошибку, плановая проверка. */
  dirChanged(): Promise<BackupRunResult>
  /** Таймеры и слушатель видимости; возвращает функцию остановки. Повторный вызов — без второго набора таймеров. */
  start(): () => void
}

const skipped = (reason: BackupSkipReason): BackupRunResult => ({ status: 'skipped', reason })
const noop = (): void => {}

export function createAutoBackup(deps: AutoBackupDeps): AutoBackup {
  let running: Promise<BackupRunResult> | null = null
  let lastError: string | null = null
  let lastPath: string | null = null
  /** О текущей серии сбоев уже сообщили; сбрасывается успешной копией и resetFailure. */
  let notified = false
  /** Начало последнего неудачного запуска и его папка; сбрасывается успешной копией и resetFailure. */
  let failed: { at: number; dir: string } | null = null
  let stopTimers: (() => void) | null = null
  const listeners = new Set<() => void>()
  let snapshot: AutoBackupStatus = { running: false, lastError: null, lastPath: null }

  function status(): AutoBackupStatus {
    const isRunning = running !== null
    if (snapshot.running !== isRunning || snapshot.lastError !== lastError || snapshot.lastPath !== lastPath) {
      snapshot = { running: isRunning, lastError, lastPath }
    }
    return snapshot
  }

  function emit(): void {
    for (const listener of [...listeners]) {
      try {
        listener()
      } catch (err) {
        console.warn('[autoBackup] ошибка слушателя состояния', err)
      }
    }
  }

  /**
   * Пауза только для той же папки: после выбора другой папки копия идёт сразу, а повторный выбор той же
   * снимает паузу через dirChanged.
   */
  const pausedAfterFailure = (dir: string, now: number): boolean =>
    // now < at — часы перевели назад: паузу не растягиваем.
    failed !== null && failed.dir === dir && now >= failed.at && now - failed.at < RETRY_PAUSE_MS

  async function run(planned: boolean): Promise<BackupRunResult> {
    const now = deps.now()
    let dir = ''
    try {
      const settings = await deps.getSettings()
      dir = settings.backupDir.trim()
      if (planned) {
        if (settings.backupEvery === 'off') return skipped('off')
        if (!dir) return skipped('no-dir')
        if (!isBackupDue(settings, now)) return skipped('not-due')
        if (pausedAfterFailure(dir, now)) return skipped('retry-later')
        // После «Удалить все данные» пустые копии вытеснили бы рабочие при обрезке.
        if ((await deps.countItems()) === 0) return skipped('empty')
      } else if (!dir) {
        return skipped('no-dir')
      }

      // Отключённый диск или неподтверждённая папка выясняются до сборки копии (до 480 МБ в памяти).
      await deps.checkDir(dir)
      const blob = await deps.exportBackup()
      const fileName = autoBackupFileName(new Date(now))
      const saved = await deps.saveBackupFile(dir, fileName, blob)
      await deps.setSetting('backupLastAt', now)
      lastError = null
      lastPath = saved.path
      notified = false
      failed = null

      let removed = 0
      try {
        removed = (await deps.pruneBackups(dir, clampKeep(settings.backupKeep), fileName)).removed.length
      } catch (e) {
        // Копия уже сохранена: лишние старые файлы уберёт следующий запуск.
        console.warn('[autoBackup] не удалось удалить старые копии', e)
      }
      return { status: 'done', path: saved.path, size: saved.size, removed }
    } catch (e) {
      const error = describeError(e, 'Не удалось сохранить резервную копию')
      lastError = error
      failed = { at: now, dir }
      if (planned && !notified) {
        notified = true
        try {
          deps.notifyError(error)
        } catch (err) {
          console.warn('[autoBackup] не удалось показать сообщение', err)
        }
      }
      return { status: 'failed', error }
    }
  }

  function launch(planned: boolean): Promise<BackupRunResult> {
    const current: Promise<BackupRunResult> = run(planned).finally(() => {
      if (running === current) running = null
      emit()
    })
    running = current
    emit()
    return current
  }

  async function idle(): Promise<void> {
    // Цикл: runNow по итогу пропуска плановой проверки сразу запускает копию заново.
    while (running) await running.then(noop, noop)
  }

  function resetFailure(): void {
    failed = null
    notified = false
    if (lastError === null) return
    lastError = null
    emit()
  }

  async function dirChanged(): Promise<BackupRunResult> {
    // Сначала конец идущей копии: её сбой (в прежнюю папку) иначе вернул бы паузу и ошибку,
    // а проверка новой папки ушла бы в busy.
    await idle()
    resetFailure()
    return check()
  }

  function check(): Promise<BackupRunResult> {
    if (!deps.isDesktop()) return Promise.resolve(skipped('not-desktop'))
    if (running) return Promise.resolve(skipped('busy'))
    return launch(true)
  }

  function runNow(): Promise<BackupRunResult> {
    if (!deps.isDesktop()) return Promise.resolve(skipped('not-desktop'))
    if (!running) return launch(false)
    // Идущая плановая проверка может закончиться пропуском («срок не пришёл») — для явной команды
    // это не ответ: тогда запускаем копию сами. Иначе отдаём итог идущего запуска.
    return running.then((result) => (result.status === 'skipped' ? runNow() : result))
  }

  function start(): () => void {
    if (stopTimers) return stopTimers
    const tick = (): void => void check()
    const timeout = setTimeout(tick, BACKUP_START_DELAY_MS)
    const interval = setInterval(tick, BACKUP_CHECK_INTERVAL_MS)
    // После сна компьютера таймер может запоздать: проверяем при возврате к окну.
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') tick()
    }
    const hasDocument = typeof document !== 'undefined'
    if (hasDocument) document.addEventListener('visibilitychange', onVisibility)
    const stop = (): void => {
      clearTimeout(timeout)
      clearInterval(interval)
      if (hasDocument) document.removeEventListener('visibilitychange', onVisibility)
      if (stopTimers === stop) stopTimers = null
    }
    stopTimers = stop
    return stop
  }

  return {
    check,
    runNow,
    status,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    idle,
    resetFailure,
    dirChanged,
    start,
  }
}

let instance: AutoBackup | null = null

function autoBackup(): AutoBackup {
  instance ??= createAutoBackup({
    isDesktop: isTauri,
    now: () => Date.now(),
    getSettings,
    setSetting,
    countItems: () => db.items.count(),
    checkDir: async (dir) => {
      await listBackups(dir)
    },
    exportBackup: () => exportBackup(),
    saveBackupFile: (dir, fileName, data) => saveBackupFile(dir, fileName, data),
    pruneBackups,
    notifyError: (message) => {
      toast.error('Автоматическая копия не сохранена', {
        description: message,
        duration: 10_000,
        action: { label: 'Настройки', onClick: () => useUi.getState().setView('settings') },
      })
    },
  })
  return instance
}

/** Синглтон с настоящими зависимостями. */
export function initAutoBackup(): void {
  if (!isTauri()) return
  autoBackup().start()
}

export function runBackupNow(): Promise<BackupRunResult> {
  return autoBackup().runNow()
}

export function checkAutoBackup(): Promise<BackupRunResult> {
  return autoBackup().check()
}

export function autoBackupStatus(): AutoBackupStatus {
  return autoBackup().status()
}

/** Подписка на autoBackupStatus(): `useSyncExternalStore(subscribeAutoBackup, autoBackupStatus)`. */
export function subscribeAutoBackup(listener: () => void): () => void {
  return autoBackup().subscribe(listener)
}

/** Копия не идёт. Вне Tauri резолвится сразу. Никогда не отклоняется. */
export function autoBackupIdle(): Promise<void> {
  return autoBackup().idle()
}

/** Снять паузу после сбоя и ошибку под «Последняя копия». */
export function resetAutoBackupFailure(): void {
  autoBackup().resetFailure()
}

/**
 * Вызов после выбора или сброса папки для копий (вместо checkAutoBackup): дожидается идущей копии, снимает
 * паузу после сбоя — повторный выбор той же папки иначе молча откладывал копию до часа — и проверяет срок.
 */
export function autoBackupDirChanged(): Promise<BackupRunResult> {
  return autoBackup().dirChanged()
}

/**
 * Отзыв прежней папки (копий или Markdown) после того, как новая настройка сохранена: ждёт конца идущей копии,
 * keep — все папки, оставшиеся в настройках. true — Rust что-то убрал. Не бросает.
 */
export function forgetPrevDir(prev: string): Promise<boolean> {
  return forgetUnusedDir(prev, {
    idle: autoBackupIdle,
    currentDirs: async () => dirsInUse(await getSettings()),
    forget: forgetDirectory,
  })
}
