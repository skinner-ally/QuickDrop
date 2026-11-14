import type { BackupRunResult, BackupSkipReason } from '@/lib/autoBackup'
import type { BackupPeriod, Settings } from '@/types'

/** Итог действия для toast: вид и текст. */
export type UiMessage = { kind: 'success' | 'error' | 'info'; text: string }

export const DESKTOP_HINT = 'Доступно в приложении для Windows'

export const BACKUP_PERIOD_LABEL: Record<BackupPeriod, string> = {
  off: 'Выключено',
  daily: 'Каждый день',
  weekly: 'Каждую неделю',
}

const SKIP_MESSAGE: Record<BackupSkipReason, UiMessage> = {
  'no-dir': { kind: 'error', text: 'Сначала выберите папку для копий' },
  'not-desktop': { kind: 'info', text: DESKTOP_HINT },
  empty: { kind: 'info', text: 'База пуста — копировать нечего' },
  'retry-later': { kind: 'info', text: 'Недавняя попытка не удалась. Повторите позже или выберите другую папку' },
  busy: { kind: 'info', text: 'Копия уже создаётся' },
  off: { kind: 'info', text: 'Автоматические копии выключены' },
  'not-due': { kind: 'info', text: 'Срок очередной копии ещё не подошёл' },
}

/** Имя файла — часть пути после последнего «/» или «\». */
function baseName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

export function backupResultMessage(result: BackupRunResult): UiMessage {
  switch (result.status) {
    case 'done': {
      const name = baseName(result.path ?? '').trim()
      let text = name ? `Копия сохранена: ${name}` : 'Копия сохранена'
      if (result.removed > 0) text += `, старых копий удалено: ${result.removed}`
      return { kind: 'success', text }
    }
    case 'failed':
      return { kind: 'error', text: result.error?.trim() || 'Не удалось сохранить копию' }
    case 'skipped':
      return SKIP_MESSAGE[result.reason] ?? { kind: 'info', text: 'Копия не создана' }
  }
}

/**
 * Ключ сравнения папок: пробелы по краям, хвостовые разделители и регистр не важны; «/» и «\» считаются одним
 * разделителем (Windows понимает оба). Ошибиться в сторону «одна и та же» безопаснее: иначе отозвали бы папку,
 * в которую ещё пишет другая настройка.
 */
function dirKey(dir: string): string {
  const unified = (dir ?? '').trim().replace(/\\/g, '/').toLowerCase()
  if (!unified) return ''
  const stripped = unified.replace(/\/+$/, '')
  // Корень («/», «C:/») хвостовой разделитель сохраняет: иначе «/» стал бы пустой строкой.
  return stripped === '' || /^[a-z]:$/.test(stripped) ? `${stripped}/` : stripped
}

/** Одна и та же папка: без учёта регистра, хвостовых разделителей и пробелов по краям; пустые не равны ничему. */
export function sameDir(a: string, b: string): boolean {
  const ka = dirKey(a)
  return ka !== '' && ka === dirKey(b)
}

/** Отзывать ли прежнюю папку: она непуста, отличается от новой и не занята другой настройкой. */
export function shouldForgetDir(prev: string, next: string, other: string): boolean {
  return dirKey(prev) !== '' && !sameDir(prev, next) && !sameDir(prev, other)
}

/**
 * Папки, которые сейчас значатся в настройках (непустые строки как есть): keep для forgetDirectory
 * и список для сверки подтверждённых папок при запуске.
 */
export function dirsInUse(settings: Pick<Settings, 'backupDir' | 'mdExportDir'>): string[] {
  return [settings.backupDir, settings.mdExportDir].filter((d) => typeof d === 'string' && d.trim() !== '')
}

export interface ForgetDirDeps {
  /** Конец идущей записи в папки (плановая копия). Отзыв посреди записи оборвал бы её ошибкой. */
  idle(): Promise<void>
  /** Папки в настройках на момент отзыва. */
  currentDirs(): Promise<string[]>
  forget(dir: string, keep: string[]): Promise<boolean>
}

/**
 * Отзыв прежней папки после смены настройки: ждёт конца идущей записи, затем убирает prev из подтверждённых,
 * сохраняя все папки, оставшиеся в настройках (keep). Настройки читаются после ожидания: пока шла копия,
 * папку могли сменить снова — в том числе вернуть prev, и тогда её отзывать нельзя. Не бросает.
 */
export async function forgetUnusedDir(prev: string, deps: ForgetDirDeps): Promise<boolean> {
  if (dirKey(prev) === '') return false
  try {
    await deps.idle()
  } catch (err) {
    console.warn('[backupUi] ожидание конца копии не удалось', err)
  }
  try {
    const keep = (await deps.currentDirs()).filter((d) => typeof d === 'string' && d.trim() !== '')
    if (keep.some((d) => sameDir(d, prev))) return false
    return await deps.forget(prev, keep)
  } catch (err) {
    // Без настроек keep не собрать; не отозванную папку уберёт сверка при следующем запуске.
    console.warn('[backupUi] не удалось отозвать папку', err)
    return false
  }
}
