import { afterEach, describe, expect, it, vi } from 'vitest'

const desktopMocks = vi.hoisted(() => ({
  forgetDirectory: vi.fn(async (_dir: string, _keep?: string[]): Promise<boolean> => true),
}))
vi.mock('@/lib/desktop', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./desktop')>()),
  forgetDirectory: desktopMocks.forgetDirectory,
}))

import {
  BACKUP_CHECK_INTERVAL_MS,
  BACKUP_KEEP_MAX,
  BACKUP_KEEP_MIN,
  BACKUP_PERIOD_MS,
  BACKUP_START_DELAY_MS,
  autoBackupDirChanged,
  autoBackupFileName,
  autoBackupIdle,
  autoBackupStatus,
  checkAutoBackup,
  clampKeep,
  createAutoBackup,
  forgetPrevDir,
  initAutoBackup,
  isBackupDue,
  resetAutoBackupFailure,
  runBackupNow,
  subscribeAutoBackup,
} from './autoBackup'
import type { AutoBackupDeps, BackupRunResult } from './autoBackup'
import type { PruneResult, SavedFile } from './desktop'
import { setSettings } from '@/db/settings'
import { DEFAULT_SETTINGS } from '@/types'
import type { Settings } from '@/types'

const DIR = 'D:\\Резервные копии'
const NOW = new Date(2026, 10, 11, 9, 30, 5).getTime()
const NOW_NAME = 'quickdrop-backup-20261111-093005.json'
const DAY = BACKUP_PERIOD_MS.daily

function setup(overrides: Partial<Settings> = {}) {
  const settings: Settings = { ...DEFAULT_SETTINGS, backupDir: DIR, backupEvery: 'daily', ...overrides }
  const state = { desktop: true, now: NOW }
  const order: string[] = []
  const blob = new Blob(['{"version":3}'])
  const mocks = {
    isDesktop: vi.fn(() => state.desktop),
    now: vi.fn(() => state.now),
    getSettings: vi.fn(async (): Promise<Settings> => ({ ...settings })),
    setSetting: vi.fn(async (key: keyof Settings, value: unknown): Promise<void> => {
      order.push('setSetting')
      ;(settings as unknown as Record<string, unknown>)[key] = value
    }),
    countItems: vi.fn(async () => 7),
    checkDir: vi.fn(async (_dir: string): Promise<void> => {
      order.push('checkDir')
    }),
    exportBackup: vi.fn(async (): Promise<Blob> => {
      order.push('exportBackup')
      return blob
    }),
    saveBackupFile: vi.fn(async (dir: string, fileName: string, data: Blob): Promise<SavedFile> => {
      order.push('saveBackupFile')
      return { path: `${dir}\\${fileName}`, size: data.size, done: true }
    }),
    pruneBackups: vi.fn(async (_dir: string, _keep: number, _protect: string): Promise<PruneResult> => {
      order.push('pruneBackups')
      return { removed: ['old-1', 'old-2'], failed: [] }
    }),
    notifyError: vi.fn((_message: string): void => {}),
  }
  const deps: AutoBackupDeps = mocks
  return { backup: createAutoBackup(deps), mocks, settings, state, order, blob }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('autoBackupFileName', () => {
  it('формат quickdrop-backup-YYYYMMDD-HHMMSS.json', () => {
    expect(autoBackupFileName(new Date(NOW))).toBe(NOW_NAME)
    expect(autoBackupFileName()).toMatch(/^quickdrop-backup-\d{8}-\d{6}\.json$/)
  })

  it('дополняет нулями и берёт локальное время', () => {
    expect(autoBackupFileName(new Date(2026, 0, 5, 7, 8, 9))).toBe('quickdrop-backup-20260105-070809.json')
    expect(autoBackupFileName(new Date(2026, 11, 31, 23, 59, 59))).toBe('quickdrop-backup-20261231-235959.json')
    expect(autoBackupFileName(new Date(2027, 0, 1, 0, 0, 0))).toBe('quickdrop-backup-20270101-000000.json')
  })

  it('не совпадает с именем ручного экспорта', () => {
    expect(autoBackupFileName(new Date(NOW))).not.toMatch(/^quickdrop-backup-\d{4}-\d{2}-\d{2}\.json$/)
  })
})

describe('clampKeep', () => {
  it('приводит к целому в допустимых границах', () => {
    expect(clampKeep(0)).toBe(BACKUP_KEEP_MIN)
    expect(clampKeep(-5)).toBe(BACKUP_KEEP_MIN)
    expect(clampKeep(3.7)).toBe(3)
    expect(clampKeep(1000)).toBe(BACKUP_KEEP_MAX)
    expect(clampKeep(Infinity)).toBe(BACKUP_KEEP_MAX)
    expect(clampKeep(1)).toBe(1)
    expect(clampKeep(10)).toBe(10)
    expect(clampKeep(100)).toBe(100)
  })

  it('не число — 10', () => {
    expect(clampKeep(NaN)).toBe(10)
    expect(clampKeep('5' as unknown as number)).toBe(10)
    expect(clampKeep(undefined as unknown as number)).toBe(10)
  })
})

describe('isBackupDue', () => {
  const base = { backupDir: DIR, backupEvery: 'daily', backupLastAt: NOW - DAY } as const

  it('выключено или нет папки — не пора', () => {
    expect(isBackupDue({ ...base, backupEvery: 'off', backupLastAt: 0 }, NOW)).toBe(false)
    expect(isBackupDue({ ...base, backupDir: '', backupLastAt: 0 }, NOW)).toBe(false)
    expect(isBackupDue({ ...base, backupDir: '   ', backupLastAt: 0 }, NOW)).toBe(false)
  })

  it('копий ещё не было — пора', () => {
    expect(isBackupDue({ ...base, backupLastAt: 0 }, NOW)).toBe(true)
  })

  it('граница периода', () => {
    expect(isBackupDue({ ...base, backupLastAt: NOW - DAY }, NOW)).toBe(true)
    expect(isBackupDue({ ...base, backupLastAt: NOW - DAY + 1 }, NOW)).toBe(false)
    expect(isBackupDue({ ...base, backupLastAt: NOW - DAY - 1 }, NOW)).toBe(true)
  })

  it('последняя копия «в будущем» (часы перевели назад) — пора', () => {
    expect(isBackupDue({ ...base, backupLastAt: NOW + 1 }, NOW)).toBe(true)
  })

  it('еженедельно', () => {
    const week = BACKUP_PERIOD_MS.weekly
    expect(isBackupDue({ ...base, backupEvery: 'weekly', backupLastAt: NOW - DAY }, NOW)).toBe(false)
    expect(isBackupDue({ ...base, backupEvery: 'weekly', backupLastAt: NOW - week + 1 }, NOW)).toBe(false)
    expect(isBackupDue({ ...base, backupEvery: 'weekly', backupLastAt: NOW - week }, NOW)).toBe(true)
  })
})

describe('check', () => {
  it('вне Tauri зависимости не вызываются', async () => {
    const { backup, mocks, state } = setup()
    state.desktop = false
    expect(await backup.check()).toEqual({ status: 'skipped', reason: 'not-desktop' })
    expect(await backup.runNow()).toEqual({ status: 'skipped', reason: 'not-desktop' })
    expect(mocks.getSettings).not.toHaveBeenCalled()
    expect(mocks.countItems).not.toHaveBeenCalled()
    expect(mocks.exportBackup).not.toHaveBeenCalled()
    expect(mocks.saveBackupFile).not.toHaveBeenCalled()
    expect(mocks.setSetting).not.toHaveBeenCalled()
    expect(mocks.pruneBackups).not.toHaveBeenCalled()
    expect(mocks.notifyError).not.toHaveBeenCalled()
  })

  it('причины пропуска: off, no-dir, not-due', async () => {
    const off = setup({ backupEvery: 'off' })
    expect(await off.backup.check()).toEqual({ status: 'skipped', reason: 'off' })
    const noDir = setup({ backupDir: '  ' })
    expect(await noDir.backup.check()).toEqual({ status: 'skipped', reason: 'no-dir' })
    const notDue = setup({ backupLastAt: NOW - DAY + 1 })
    expect(await notDue.backup.check()).toEqual({ status: 'skipped', reason: 'not-due' })
    for (const { mocks } of [off, noDir, notDue]) {
      expect(mocks.countItems).not.toHaveBeenCalled()
      expect(mocks.exportBackup).not.toHaveBeenCalled()
      expect(mocks.setSetting).not.toHaveBeenCalled()
      expect(mocks.notifyError).not.toHaveBeenCalled()
    }
  })

  it('пришёл срок: порядок вызовов и аргументы', async () => {
    const { backup, mocks, order, blob, settings } = setup({ backupKeep: 250, backupLastAt: NOW - DAY })
    const result = await backup.check()
    expect(order).toEqual(['checkDir', 'exportBackup', 'saveBackupFile', 'setSetting', 'pruneBackups'])
    expect(mocks.checkDir).toHaveBeenCalledExactlyOnceWith(DIR)
    expect(mocks.saveBackupFile).toHaveBeenCalledExactlyOnceWith(DIR, NOW_NAME, blob)
    expect(mocks.setSetting).toHaveBeenCalledExactlyOnceWith('backupLastAt', NOW)
    // имя новой копии защищает её от обрезки, даже если по имени она не последняя
    expect(mocks.pruneBackups).toHaveBeenCalledExactlyOnceWith(DIR, BACKUP_KEEP_MAX, NOW_NAME)
    expect(result).toEqual({ status: 'done', path: `${DIR}\\${NOW_NAME}`, size: blob.size, removed: 2 })
    expect(settings.backupLastAt).toBe(NOW)
    expect(mocks.notifyError).not.toHaveBeenCalled()
    expect(backup.status()).toEqual({ running: false, lastError: null, lastPath: `${DIR}\\${NOW_NAME}` })
  })

  it('после копии следующая проверка ждёт период', async () => {
    const { backup, mocks, state } = setup()
    expect((await backup.check()).status).toBe('done')
    state.now = NOW + DAY - 1
    expect(await backup.check()).toEqual({ status: 'skipped', reason: 'not-due' })
    state.now = NOW + DAY
    expect((await backup.check()).status).toBe('done')
    expect(mocks.exportBackup).toHaveBeenCalledTimes(2)
  })

  it('пустая база по расписанию не копируется', async () => {
    const { backup, mocks } = setup()
    mocks.countItems.mockResolvedValue(0)
    expect(await backup.check()).toEqual({ status: 'skipped', reason: 'empty' })
    expect(mocks.exportBackup).not.toHaveBeenCalled()
    expect(mocks.saveBackupFile).not.toHaveBeenCalled()
    expect(mocks.setSetting).not.toHaveBeenCalled()
    expect(mocks.pruneBackups).not.toHaveBeenCalled()
    expect(mocks.notifyError).not.toHaveBeenCalled()
    expect(backup.status().lastError).toBeNull()
  })

  it('сбой exportBackup: failed, backupLastAt не записан', async () => {
    const { backup, mocks } = setup()
    mocks.exportBackup.mockRejectedValueOnce(new Error('Резервная копия слишком большая'))
    expect(await backup.check()).toEqual({ status: 'failed', error: 'Резервная копия слишком большая' })
    expect(mocks.saveBackupFile).not.toHaveBeenCalled()
    expect(mocks.setSetting).not.toHaveBeenCalled()
    expect(mocks.pruneBackups).not.toHaveBeenCalled()
    expect(backup.status()).toEqual({ running: false, lastError: 'Резервная копия слишком большая', lastPath: null })
  })

  it('сбой saveBackupFile: notifyError один раз на серию сбоев, после успеха срабатывает снова', async () => {
    const { backup, mocks, state } = setup()
    const diskFull = new Error('Не удалось сохранить копию: на диске не осталось места')
    mocks.saveBackupFile.mockRejectedValueOnce(diskFull).mockRejectedValueOnce(diskFull)

    expect(await backup.check()).toEqual({ status: 'failed', error: diskFull.message })
    state.now += BACKUP_CHECK_INTERVAL_MS
    expect(await backup.check()).toEqual({ status: 'failed', error: diskFull.message })
    expect(mocks.notifyError).toHaveBeenCalledExactlyOnceWith(diskFull.message)
    expect(mocks.setSetting).not.toHaveBeenCalled()

    // срок не сдвинулся: следующая часовая проверка делает копию
    state.now += BACKUP_CHECK_INTERVAL_MS
    expect((await backup.check()).status).toBe('done')
    expect(backup.status().lastError).toBeNull()
    expect(mocks.notifyError).toHaveBeenCalledTimes(1)

    mocks.saveBackupFile.mockRejectedValueOnce('не Error')
    mocks.getSettings.mockResolvedValueOnce({ ...DEFAULT_SETTINGS, backupDir: DIR, backupEvery: 'daily' })
    expect(await backup.check()).toEqual({ status: 'failed', error: 'Не удалось сохранить резервную копию' })
    expect(mocks.notifyError).toHaveBeenCalledTimes(2)
    expect(mocks.notifyError).toHaveBeenLastCalledWith('Не удалось сохранить резервную копию')
  })

  it('сбой чтения настроек и подсчёта записей — failed, не исключение', async () => {
    const { backup, mocks, state } = setup()
    mocks.getSettings.mockRejectedValueOnce(new Error('База недоступна'))
    expect(await backup.check()).toEqual({ status: 'failed', error: 'База недоступна' })
    state.now += BACKUP_CHECK_INTERVAL_MS
    mocks.countItems.mockRejectedValueOnce(new Error('Сбой подсчёта'))
    expect(await backup.check()).toEqual({ status: 'failed', error: 'Сбой подсчёта' })
    expect(mocks.exportBackup).not.toHaveBeenCalled()
    expect(mocks.notifyError).toHaveBeenCalledTimes(1)
  })

  it('недоступная папка выясняется до выгрузки базы', async () => {
    const { backup, mocks } = setup()
    const diskGone = 'Папка не найдена: D:\\Резервные копии. Проверьте, что диск подключён'
    mocks.checkDir.mockRejectedValueOnce(new Error(diskGone))
    expect(await backup.check()).toEqual({ status: 'failed', error: diskGone })
    expect(mocks.exportBackup).not.toHaveBeenCalled()
    expect(mocks.saveBackupFile).not.toHaveBeenCalled()
    expect(mocks.setSetting).not.toHaveBeenCalled()
    expect(mocks.notifyError).toHaveBeenCalledExactlyOnceWith(diskGone)
  })

  it('после сбоя плановые попытки — не чаще часовой проверки', async () => {
    const { backup, mocks, state } = setup()
    mocks.saveBackupFile.mockRejectedValue(new Error('Не удалось сохранить копию: нет доступа'))
    expect((await backup.check()).status).toBe('failed')

    // возврат к окну и проверки в течение часа не повторяют выгрузку
    for (const later of [0, 1, 30 * 60_000, BACKUP_CHECK_INTERVAL_MS - 60_001]) {
      state.now = NOW + later
      expect(await backup.check()).toEqual({ status: 'skipped', reason: 'retry-later' })
    }
    expect(mocks.exportBackup).toHaveBeenCalledTimes(1)
    expect(mocks.saveBackupFile).toHaveBeenCalledTimes(1)
    expect(mocks.notifyError).toHaveBeenCalledTimes(1)

    // часовой таймер, сработавший чуть раньше часа, — уже новая попытка
    state.now = NOW + BACKUP_CHECK_INTERVAL_MS - 1000
    expect((await backup.check()).status).toBe('failed')
    expect(mocks.exportBackup).toHaveBeenCalledTimes(2)
    expect(mocks.notifyError).toHaveBeenCalledTimes(1)
  })

  it('после выбора другой папки пауза не действует', async () => {
    const { backup, mocks, settings } = setup()
    mocks.checkDir.mockRejectedValueOnce(new Error('Папка не найдена: D:\\Резервные копии. Проверьте, что диск подключён'))
    expect((await backup.check()).status).toBe('failed')
    settings.backupDir = 'E:\\Копии'
    expect((await backup.check()).status).toBe('done')
    expect(mocks.saveBackupFile).toHaveBeenCalledExactlyOnceWith('E:\\Копии', NOW_NAME, expect.any(Blob))
  })

  it('часы перевели назад после сбоя — попытка не откладывается', async () => {
    const { backup, mocks, state } = setup()
    mocks.saveBackupFile.mockRejectedValueOnce(new Error('сбой'))
    expect((await backup.check()).status).toBe('failed')
    state.now = NOW - 5 * 60_000
    expect((await backup.check()).status).toBe('done')
    expect(mocks.exportBackup).toHaveBeenCalledTimes(2)
  })

  it('успешная копия снимает паузу', async () => {
    const { backup, mocks, state, settings } = setup()
    mocks.saveBackupFile.mockRejectedValueOnce(new Error('сбой'))
    expect((await backup.check()).status).toBe('failed')
    state.now = NOW + BACKUP_CHECK_INTERVAL_MS
    expect((await backup.check()).status).toBe('done')
    // следующий срок пришёл сразу (например, сменили папку): паузы после успеха нет
    settings.backupLastAt = 0
    state.now += 1000
    expect((await backup.check()).status).toBe('done')
    expect(mocks.exportBackup).toHaveBeenCalledTimes(3)
  })

  it('частые возвраты к окну при отключённом диске: одна выгрузка и одно сообщение', async () => {
    vi.useFakeTimers()
    const listeners = new Set<() => void>()
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: (_type: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_type: string, fn: () => void) => listeners.delete(fn),
    })
    const { backup, mocks, state } = setup()
    mocks.saveBackupFile.mockRejectedValue(new Error('Не удалось сохранить копию: папка или файл не найдены'))
    const stop = backup.start()
    await vi.advanceTimersByTimeAsync(BACKUP_START_DELAY_MS)
    for (let i = 0; i < 5; i += 1) {
      state.now += 10_000
      listeners.forEach((fn) => fn())
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(mocks.exportBackup).toHaveBeenCalledTimes(1)
    expect(mocks.notifyError).toHaveBeenCalledTimes(1)
    stop()
  })

  it('сбой записи backupLastAt — failed', async () => {
    const { backup, mocks } = setup()
    mocks.setSetting.mockRejectedValueOnce(new Error('Сбой записи настроек'))
    expect(await backup.check()).toEqual({ status: 'failed', error: 'Сбой записи настроек' })
    expect(mocks.pruneBackups).not.toHaveBeenCalled()
  })

  it('исключение notifyError не ломает проверку', async () => {
    const { backup, mocks } = setup()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.exportBackup.mockRejectedValueOnce(new Error('сбой'))
    mocks.notifyError.mockImplementationOnce(() => {
      throw new Error('toast недоступен')
    })
    expect(await backup.check()).toEqual({ status: 'failed', error: 'сбой' })
  })

  it('сбой pruneBackups — копия считается сделанной', async () => {
    const { backup, mocks } = setup()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.pruneBackups.mockRejectedValueOnce(new Error('Не удалось удалить старые копии: нет доступа'))
    const result = await backup.check()
    expect(result).toMatchObject({ status: 'done', removed: 0 })
    expect(mocks.setSetting).toHaveBeenCalledExactlyOnceWith('backupLastAt', NOW)
    expect(mocks.notifyError).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(backup.status().lastError).toBeNull()
  })

  it('два check() одновременно: копия одна, второй — busy', async () => {
    const { backup, mocks, blob } = setup()
    const gate = deferred<Blob>()
    mocks.exportBackup.mockReturnValueOnce(gate.promise)
    const first = backup.check()
    const second = backup.check()
    expect(await second).toEqual({ status: 'skipped', reason: 'busy' })
    expect(backup.status().running).toBe(true)
    gate.resolve(blob)
    expect((await first).status).toBe('done')
    expect(mocks.exportBackup).toHaveBeenCalledTimes(1)
    expect(mocks.getSettings).toHaveBeenCalledTimes(1)
    expect(backup.status().running).toBe(false)
  })
})

describe('runNow', () => {
  it('выполняется при backupEvery off и не глядя на срок', async () => {
    const { backup, mocks, blob } = setup({ backupEvery: 'off', backupLastAt: NOW - 1000, backupKeep: 3 })
    const result = await backup.runNow()
    expect(result).toEqual({ status: 'done', path: `${DIR}\\${NOW_NAME}`, size: blob.size, removed: 2 })
    expect(mocks.saveBackupFile).toHaveBeenCalledExactlyOnceWith(DIR, NOW_NAME, blob)
    expect(mocks.setSetting).toHaveBeenCalledExactlyOnceWith('backupLastAt', NOW)
    expect(mocks.pruneBackups).toHaveBeenCalledExactlyOnceWith(DIR, 3, NOW_NAME)
  })

  it('недоступная папка — failed без выгрузки базы', async () => {
    const { backup, mocks } = setup()
    mocks.checkDir.mockRejectedValueOnce(new Error('Папка не подтверждена: выберите её заново в настройках'))
    expect(await backup.runNow()).toEqual({
      status: 'failed',
      error: 'Папка не подтверждена: выберите её заново в настройках',
    })
    expect(mocks.exportBackup).not.toHaveBeenCalled()
  })

  it('не ждёт паузы после планового сбоя и снимает её при успехе', async () => {
    const { backup, mocks, state, settings } = setup()
    mocks.saveBackupFile.mockRejectedValueOnce(new Error('сбой'))
    expect((await backup.check()).status).toBe('failed')
    state.now = NOW + 1000
    expect(await backup.check()).toEqual({ status: 'skipped', reason: 'retry-later' })
    expect((await backup.runNow()).status).toBe('done')
    settings.backupLastAt = 0
    expect((await backup.check()).status).toBe('done')
    expect(mocks.exportBackup).toHaveBeenCalledTimes(3)
  })

  it('без папки — skipped/no-dir', async () => {
    const { backup, mocks } = setup({ backupDir: '' })
    expect(await backup.runNow()).toEqual({ status: 'skipped', reason: 'no-dir' })
    expect(mocks.exportBackup).not.toHaveBeenCalled()
  })

  it('пустую базу копирует: это явная команда', async () => {
    const { backup, mocks } = setup()
    mocks.countItems.mockResolvedValue(0)
    expect((await backup.runNow()).status).toBe('done')
    expect(mocks.exportBackup).toHaveBeenCalledTimes(1)
    expect(mocks.countItems).not.toHaveBeenCalled()
  })

  it('сбой: failed без notifyError; плановая попытка — через час, и она сообщает', async () => {
    const { backup, mocks, state } = setup()
    mocks.saveBackupFile.mockRejectedValue(new Error('Папка не подтверждена: выберите её заново в настройках'))
    const result = await backup.runNow()
    expect(result).toEqual({ status: 'failed', error: 'Папка не подтверждена: выберите её заново в настройках' })
    expect(mocks.notifyError).not.toHaveBeenCalled()
    expect(mocks.setSetting).not.toHaveBeenCalled()
    expect(backup.status().lastError).toBe('Папка не подтверждена: выберите её заново в настройках')

    // о сбое явной команды пользователь уже знает: сразу плановая проверка его не повторяет
    expect(await backup.check()).toEqual({ status: 'skipped', reason: 'retry-later' })
    expect(mocks.exportBackup).toHaveBeenCalledTimes(1)

    state.now += BACKUP_CHECK_INTERVAL_MS
    expect((await backup.check()).status).toBe('failed')
    expect(mocks.notifyError).toHaveBeenCalledTimes(1)
  })

  it('во время запуска возвращает тот же результат', async () => {
    const { backup, mocks, blob } = setup()
    const gate = deferred<Blob>()
    mocks.exportBackup.mockReturnValueOnce(gate.promise)
    const first = backup.runNow()
    const second = backup.runNow()
    const planned = backup.check()
    gate.resolve(blob)
    const result = await first
    expect(result.status).toBe('done')
    expect(await second).toBe(result)
    expect(await planned).toEqual({ status: 'skipped', reason: 'busy' })
    expect(mocks.exportBackup).toHaveBeenCalledTimes(1)
  })

  it('во время плановой копии возвращает её результат', async () => {
    const { backup, mocks, blob } = setup()
    const gate = deferred<Blob>()
    mocks.exportBackup.mockReturnValueOnce(gate.promise)
    const planned = backup.check()
    const manual = backup.runNow()
    gate.resolve(blob)
    expect(await manual).toBe(await planned)
    expect(mocks.exportBackup).toHaveBeenCalledTimes(1)
  })

  it('плановая проверка, закончившаяся пропуском, не отменяет явную команду', async () => {
    const { backup, mocks } = setup({ backupLastAt: NOW - 1000 })
    const planned = backup.check()
    const manual = backup.runNow()
    expect(await planned).toEqual({ status: 'skipped', reason: 'not-due' })
    expect((await manual).status).toBe('done')
    expect(mocks.exportBackup).toHaveBeenCalledTimes(1)
  })
})

/** Дать отработать микрозадачам и таймерам нулевой задержки. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('idle', () => {
  it('без запуска резолвится сразу', async () => {
    const { backup, mocks } = setup()
    await expect(backup.idle()).resolves.toBeUndefined()
    expect(mocks.getSettings).not.toHaveBeenCalled()
  })

  it('во время копии ждёт её конца', async () => {
    const { backup, mocks, blob } = setup()
    const gate = deferred<Blob>()
    mocks.exportBackup.mockReturnValueOnce(gate.promise)
    const run = backup.runNow()
    let idle = false
    const waiting = backup.idle().then(() => {
      idle = true
    })
    await flush()
    expect(idle).toBe(false)
    gate.resolve(blob)
    await waiting
    expect((await run).status).toBe('done')
    expect(backup.status().running).toBe(false)
  })

  it('после неудачного запуска резолвится, а не отклоняется', async () => {
    const { backup, mocks } = setup()
    const gate = deferred<Blob>()
    mocks.exportBackup.mockReturnValueOnce(gate.promise)
    const run = backup.check()
    const waiting = backup.idle()
    gate.reject(new Error('Резервная копия слишком большая'))
    await expect(waiting).resolves.toBeUndefined()
    expect((await run).status).toBe('failed')
  })

  it('ждёт и копию, которую runNow запустил после пропуска плановой проверки', async () => {
    const { backup, mocks, blob } = setup({ backupLastAt: NOW - 1000 })
    const gate = deferred<Blob>()
    mocks.exportBackup.mockReturnValueOnce(gate.promise)
    const planned = backup.check()
    const manual = backup.runNow()
    let idle = false
    const waiting = backup.idle().then(() => {
      idle = true
    })
    expect(await planned).toEqual({ status: 'skipped', reason: 'not-due' })
    await flush()
    expect(mocks.exportBackup).toHaveBeenCalledTimes(1)
    expect(idle).toBe(false)
    gate.resolve(blob)
    await waiting
    expect((await manual).status).toBe('done')
  })
})

describe('resetFailure и dirChanged', () => {
  it('resetFailure снимает паузу и ошибку, о новом сбое снова сообщается', async () => {
    const { backup, mocks, state } = setup()
    const notApproved = new Error('Папка не подтверждена: выберите её заново в настройках')
    mocks.checkDir.mockRejectedValueOnce(notApproved).mockRejectedValueOnce(notApproved)
    expect((await backup.check()).status).toBe('failed')
    state.now = NOW + 1000
    expect(await backup.check()).toEqual({ status: 'skipped', reason: 'retry-later' })

    backup.resetFailure()
    expect(backup.status().lastError).toBeNull()
    expect((await backup.check()).status).toBe('failed')
    expect(mocks.notifyError).toHaveBeenCalledTimes(2)
  })

  it('повторный выбор той же папки после сбоя: копия сразу, а не через час', async () => {
    const { backup, mocks, state } = setup()
    mocks.checkDir.mockRejectedValueOnce(new Error('Папка не подтверждена: выберите её заново в настройках'))
    expect((await backup.check()).status).toBe('failed')
    state.now = NOW + 5000
    const result = await backup.dirChanged()
    expect(result.status).toBe('done')
    expect(mocks.saveBackupFile).toHaveBeenCalledExactlyOnceWith(DIR, expect.any(String), expect.any(Blob))
    expect(backup.status().lastError).toBeNull()
  })

  it('во время копии ждёт её конца: проверка новой папки не уходит в busy, сбой прежней не держит паузу', async () => {
    const { backup, mocks, settings } = setup()
    const gate = deferred<Blob>()
    mocks.exportBackup.mockReturnValueOnce(gate.promise)
    const running = backup.runNow()
    await flush()
    // пользователь выбрал новую папку, пока копия шла в прежнюю
    settings.backupDir = 'E:\\Копии'
    const changed = backup.dirChanged()
    gate.reject(new Error('Папка не подтверждена: выберите её заново в настройках'))
    expect((await running).status).toBe('failed')
    expect(await changed).toMatchObject({ status: 'done', path: `E:\\Копии\\${NOW_NAME}` })
    expect(backup.status().lastError).toBeNull()
  })

  it('вне Tauri ничего не запускает', async () => {
    const { backup, mocks, state } = setup()
    state.desktop = false
    expect(await backup.dirChanged()).toEqual({ status: 'skipped', reason: 'not-desktop' })
    expect(mocks.getSettings).not.toHaveBeenCalled()
  })
})

describe('status и subscribe', () => {
  it('status() — тот же объект, пока состояние не изменилось; слушатель — на начало и конец копии', async () => {
    const { backup, mocks, blob } = setup()
    const listener = vi.fn()
    const unsubscribe = backup.subscribe(listener)
    const initial = backup.status()
    expect(backup.status()).toBe(initial)

    const gate = deferred<Blob>()
    mocks.exportBackup.mockReturnValueOnce(gate.promise)
    const run = backup.runNow()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(backup.status()).toEqual({ running: true, lastError: null, lastPath: null })
    expect(backup.status()).toBe(backup.status())

    gate.resolve(blob)
    await run
    expect(listener).toHaveBeenCalledTimes(2)
    const after = backup.status()
    expect(after).toEqual({ running: false, lastError: null, lastPath: `${DIR}\\${NOW_NAME}` })
    expect(backup.status()).toBe(after)

    unsubscribe()
    await backup.runNow()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('resetFailure оповещает, только если ошибка была', async () => {
    const { backup, mocks } = setup()
    const listener = vi.fn()
    backup.subscribe(listener)
    backup.resetFailure()
    expect(listener).not.toHaveBeenCalled()

    mocks.exportBackup.mockRejectedValueOnce(new Error('сбой'))
    await backup.runNow()
    listener.mockClear()
    backup.resetFailure()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(backup.status().lastError).toBeNull()
  })

  it('исключение слушателя не ломает копию', async () => {
    const { backup } = setup()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    backup.subscribe(() => {
      throw new Error('слушатель')
    })
    expect((await backup.runNow()).status).toBe('done')
  })
})

describe('start', () => {
  it('проверка через BACKUP_START_DELAY_MS и каждый BACKUP_CHECK_INTERVAL_MS', async () => {
    vi.useFakeTimers()
    const { backup, mocks } = setup({ backupEvery: 'off' })
    const stop = backup.start()
    expect(mocks.getSettings).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(BACKUP_START_DELAY_MS - 1)
    expect(mocks.getSettings).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.getSettings).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(BACKUP_CHECK_INTERVAL_MS - BACKUP_START_DELAY_MS)
    expect(mocks.getSettings).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(BACKUP_CHECK_INTERVAL_MS * 3)
    expect(mocks.getSettings).toHaveBeenCalledTimes(5)

    stop()
    await vi.advanceTimersByTimeAsync(BACKUP_CHECK_INTERVAL_MS * 3)
    expect(mocks.getSettings).toHaveBeenCalledTimes(5)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('остановка до первой проверки снимает и её', async () => {
    vi.useFakeTimers()
    const { backup, mocks } = setup()
    backup.start()()
    await vi.advanceTimersByTimeAsync(BACKUP_CHECK_INTERVAL_MS * 2)
    expect(mocks.getSettings).not.toHaveBeenCalled()
  })

  it('повторный start не создаёт второй набор таймеров', async () => {
    vi.useFakeTimers()
    const { backup, mocks } = setup({ backupEvery: 'off' })
    const stop = backup.start()
    expect(backup.start()).toBe(stop)
    expect(vi.getTimerCount()).toBe(2)
    await vi.advanceTimersByTimeAsync(BACKUP_START_DELAY_MS)
    expect(mocks.getSettings).toHaveBeenCalledTimes(1)
    stop()
    // после остановки расписание можно запустить заново
    const again = backup.start()
    expect(again).not.toBe(stop)
    expect(vi.getTimerCount()).toBe(2)
    again()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('плановая проверка по таймеру делает копию', async () => {
    vi.useFakeTimers()
    const { backup, mocks } = setup()
    const stop = backup.start()
    await vi.advanceTimersByTimeAsync(BACKUP_START_DELAY_MS)
    expect(mocks.saveBackupFile).toHaveBeenCalledExactlyOnceWith(DIR, NOW_NAME, expect.any(Blob))
    stop()
  })

  it('возврат к окну запускает проверку; после остановки слушатель снят', async () => {
    vi.useFakeTimers()
    const listeners = new Set<() => void>()
    const doc = {
      visibilityState: 'hidden',
      addEventListener: vi.fn((type: string, fn: () => void) => {
        if (type === 'visibilitychange') listeners.add(fn)
      }),
      removeEventListener: vi.fn((type: string, fn: () => void) => {
        if (type === 'visibilitychange') listeners.delete(fn)
      }),
    }
    vi.stubGlobal('document', doc)
    const { backup, mocks } = setup({ backupEvery: 'off' })
    const stop = backup.start()
    expect(listeners.size).toBe(1)

    listeners.forEach((fn) => fn())
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.getSettings).not.toHaveBeenCalled()

    doc.visibilityState = 'visible'
    listeners.forEach((fn) => fn())
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.getSettings).toHaveBeenCalledTimes(1)

    stop()
    expect(listeners.size).toBe(0)
  })
})

describe('синглтон вне Tauri', () => {
  it('ничего не запускает и ничего не пишет', async () => {
    vi.useFakeTimers()
    initAutoBackup()
    initAutoBackup()
    expect(vi.getTimerCount()).toBe(0)
    const skipped: BackupRunResult = { status: 'skipped', reason: 'not-desktop' }
    expect(await checkAutoBackup()).toEqual(skipped)
    expect(await runBackupNow()).toEqual(skipped)
    expect(await autoBackupDirChanged()).toEqual(skipped)
    await expect(autoBackupIdle()).resolves.toBeUndefined()
    resetAutoBackupFailure()
    const unsubscribe = subscribeAutoBackup(() => {})
    unsubscribe()
    expect(autoBackupStatus()).toEqual({ running: false, lastError: null, lastPath: null })
  })
})

describe('forgetPrevDir', () => {
  afterEach(async () => {
    desktopMocks.forgetDirectory.mockClear()
    await setSettings({ backupDir: '', mdExportDir: '' })
  })

  it('keep — папки, оставшиеся в настройках после смены', async () => {
    await setSettings({ backupDir: '\\\\nas\\share\\QuickDrop', mdExportDir: 'E:\\Vault' })
    expect(await forgetPrevDir('Z:\\QuickDrop')).toBe(true)
    expect(desktopMocks.forgetDirectory).toHaveBeenCalledExactlyOnceWith('Z:\\QuickDrop', [
      '\\\\nas\\share\\QuickDrop',
      'E:\\Vault',
    ])
  })

  it('папка всё ещё в настройках — не отзывается', async () => {
    await setSettings({ backupDir: 'D:\\Копии', mdExportDir: '' })
    expect(await forgetPrevDir('d:\\копии\\')).toBe(false)
    expect(await forgetPrevDir('')).toBe(false)
    expect(desktopMocks.forgetDirectory).not.toHaveBeenCalled()
  })
})
