import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BackupSkipReason } from './autoBackup'
import {
  BACKUP_PERIOD_LABEL,
  DESKTOP_HINT,
  backupResultMessage,
  dirsInUse,
  forgetUnusedDir,
  sameDir,
  shouldForgetDir,
} from './backupUi'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('BACKUP_PERIOD_LABEL', () => {
  it('подписи периодичности', () => {
    expect(BACKUP_PERIOD_LABEL).toEqual({ off: 'Выключено', daily: 'Каждый день', weekly: 'Каждую неделю' })
    expect(DESKTOP_HINT).toBe('Доступно в приложении для Windows')
  })
})

describe('backupResultMessage', () => {
  it('done: имя файла из пути с любым разделителем', () => {
    expect(
      backupResultMessage({
        status: 'done',
        path: 'D:\\Копии\\quickdrop-backup-20261112-150000.json',
        size: 10,
        removed: 0,
      }),
    ).toEqual({ kind: 'success', text: 'Копия сохранена: quickdrop-backup-20261112-150000.json' })
    expect(
      backupResultMessage({ status: 'done', path: '/Users/me/Копии/quickdrop-backup-1.json', size: 1, removed: 2 }),
    ).toEqual({ kind: 'success', text: 'Копия сохранена: quickdrop-backup-1.json, старых копий удалено: 2' })
    expect(backupResultMessage({ status: 'done', path: 'quickdrop-backup-2.json', size: 1, removed: 0 }).text).toBe(
      'Копия сохранена: quickdrop-backup-2.json',
    )
    expect(backupResultMessage({ status: 'done', path: '', size: 1, removed: 0 }).text).toBe('Копия сохранена')
  })

  it('failed: текст ошибки', () => {
    expect(backupResultMessage({ status: 'failed', error: 'Не удалось сохранить копию: нет места' })).toEqual({
      kind: 'error',
      text: 'Не удалось сохранить копию: нет места',
    })
    expect(backupResultMessage({ status: 'failed', error: '' })).toEqual({
      kind: 'error',
      text: 'Не удалось сохранить копию',
    })
  })

  it('skipped: каждая причина', () => {
    const cases: Array<[BackupSkipReason, 'error' | 'info', string]> = [
      ['no-dir', 'error', 'Сначала выберите папку для копий'],
      ['not-desktop', 'info', DESKTOP_HINT],
      ['empty', 'info', 'База пуста — копировать нечего'],
      ['retry-later', 'info', 'Недавняя попытка не удалась. Повторите позже или выберите другую папку'],
      ['busy', 'info', 'Копия уже создаётся'],
      ['off', 'info', 'Автоматические копии выключены'],
      ['not-due', 'info', 'Срок очередной копии ещё не подошёл'],
    ]
    for (const [reason, kind, text] of cases) {
      expect(backupResultMessage({ status: 'skipped', reason }), reason).toEqual({ kind, text })
    }
  })
})

describe('sameDir', () => {
  it('регистр, хвостовые разделители и пробелы по краям не важны', () => {
    expect(sameDir('D:\\Копии', 'd:\\копии\\')).toBe(true)
    expect(sameDir('  D:\\Копии  ', 'D:\\Копии')).toBe(true)
    expect(sameDir('D:/Копии/', 'D:\\Копии')).toBe(true)
    expect(sameDir('/Users/me/Backups/', '/users/me/backups')).toBe(true)
  })

  it('разные папки и пустые строки', () => {
    expect(sameDir('D:\\Копии', 'D:\\Копии 2')).toBe(false)
    expect(sameDir('D:\\Копии', 'D:\\Копии\\Вложенная')).toBe(false)
    expect(sameDir('', '')).toBe(false)
    expect(sameDir('  ', '')).toBe(false)
    expect(sameDir('D:\\Копии', '')).toBe(false)
  })

  it('корень диска не превращается в пустую строку', () => {
    expect(sameDir('C:\\', 'c:/')).toBe(true)
    expect(sameDir('/', '/')).toBe(true)
    expect(sameDir('/', '')).toBe(false)
    expect(sameDir('C:\\', 'D:\\')).toBe(false)
  })
})

describe('shouldForgetDir', () => {
  it('прежняя папка отзывается, если её сменили и она не занята другой настройкой', () => {
    expect(shouldForgetDir('D:\\Старая', 'D:\\Новая', 'E:\\Экспорт')).toBe(true)
    // сброс настройки — тоже смена
    expect(shouldForgetDir('D:\\Старая', '', '')).toBe(true)
  })

  it('не отзывается: пусто, та же папка, папка другой настройки', () => {
    expect(shouldForgetDir('', 'D:\\Новая', '')).toBe(false)
    expect(shouldForgetDir('   ', 'D:\\Новая', '')).toBe(false)
    expect(shouldForgetDir('D:\\Копии', 'd:\\копии\\', '')).toBe(false)
    expect(shouldForgetDir('D:\\Общая', 'D:\\Новая', 'D:\\общая')).toBe(false)
  })
})

describe('dirsInUse', () => {
  it('непустые папки обеих настроек как есть', () => {
    expect(dirsInUse({ backupDir: 'D:\\Копии', mdExportDir: 'E:\\Vault' })).toEqual(['D:\\Копии', 'E:\\Vault'])
    expect(dirsInUse({ backupDir: '', mdExportDir: 'E:\\Vault' })).toEqual(['E:\\Vault'])
    expect(dirsInUse({ backupDir: '  ', mdExportDir: '' })).toEqual([])
  })
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('forgetUnusedDir', () => {
  const setup = (dirs: string[]) => {
    const order: string[] = []
    const deps = {
      idle: vi.fn(async () => {
        order.push('idle')
      }),
      currentDirs: vi.fn(async () => {
        order.push('currentDirs')
        return dirs
      }),
      forget: vi.fn(async (_dir: string, _keep: string[]) => {
        order.push('forget')
        return true
      }),
    }
    return { deps, order }
  }

  it('после конца копии отзывает prev, keep — папки из настроек', async () => {
    // Z: и \\nas\share — одна и та же папка: Rust не тронет запись новой благодаря keep
    const { deps, order } = setup(['\\\\nas\\share\\QuickDrop', '', 'E:\\Vault'])
    expect(await forgetUnusedDir('Z:\\QuickDrop', deps)).toBe(true)
    expect(order).toEqual(['idle', 'currentDirs', 'forget'])
    expect(deps.forget).toHaveBeenCalledExactlyOnceWith('Z:\\QuickDrop', ['\\\\nas\\share\\QuickDrop', 'E:\\Vault'])
  })

  it('пока копия идёт, отзыва нет', async () => {
    const { deps } = setup(['E:\\Новая'])
    const gate = deferred()
    deps.idle.mockReturnValueOnce(gate.promise)
    const pending = forgetUnusedDir('D:\\Старая', deps)
    await Promise.resolve()
    await Promise.resolve()
    expect(deps.currentDirs).not.toHaveBeenCalled()
    expect(deps.forget).not.toHaveBeenCalled()
    gate.resolve()
    expect(await pending).toBe(true)
    expect(deps.forget).toHaveBeenCalledExactlyOnceWith('D:\\Старая', ['E:\\Новая'])
  })

  it('prev снова в настройках (вернули, пока шла копия) — не отзывается', async () => {
    const { deps } = setup(['d:\\старая\\', 'E:\\Vault'])
    expect(await forgetUnusedDir('D:\\Старая', deps)).toBe(false)
    expect(deps.forget).not.toHaveBeenCalled()
  })

  it('пустая prev — ничего не делает', async () => {
    const { deps } = setup([])
    expect(await forgetUnusedDir('  ', deps)).toBe(false)
    expect(deps.idle).not.toHaveBeenCalled()
    expect(deps.forget).not.toHaveBeenCalled()
  })

  it('настройки не прочитаны — не отзывает и не бросает', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { deps } = setup([])
    deps.currentDirs.mockRejectedValueOnce(new Error('База недоступна'))
    expect(await forgetUnusedDir('D:\\Старая', deps)).toBe(false)
    expect(deps.forget).not.toHaveBeenCalled()
  })

  it('сбой ожидания не отменяет отзыв; сбой отзыва — false', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { deps } = setup(['E:\\Новая'])
    deps.idle.mockRejectedValueOnce(new Error('сбой'))
    expect(await forgetUnusedDir('D:\\Старая', deps)).toBe(true)
    deps.forget.mockRejectedValueOnce(new Error('IPC'))
    expect(await forgetUnusedDir('D:\\Старая', deps)).toBe(false)
  })
})
