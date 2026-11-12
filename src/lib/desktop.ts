import { toast } from 'sonner'
import { getSettings } from '@/db/settings'
import { invokeChunked, ipcError, type InvokeFn } from '@/lib/ipc'
import { isTauri } from '@/lib/platform'
import { useUi } from '@/store/ui'

/** Сочетание из настроек, которое не удалось зарегистрировать при запуске (занято другой программой). */
let failedShortcut: string | null = null

/**
 * Глобальное сочетание из настроек не действует: при запуске его не удалось зарегистрировать.
 * Поле в «Настройки → Горячие клавиши» может показать это значение как неприменённое.
 */
export function globalShortcutFailure(): string | null {
  return failedShortcut
}

/** Показать и сфокусировать главное окно. */
async function raiseWindow(): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  await win.unminimize()
  await win.show()
  await win.setFocus()
}

async function registerShortcut(shortcut: string): Promise<void> {
  const { register, unregisterAll } = await import('@tauri-apps/plugin-global-shortcut')
  await unregisterAll()
  await register(shortcut, (e) => {
    if (e.state !== 'Pressed') return
    void raiseWindow()
      .catch((err) => console.warn('[desktop] не удалось показать окно', err))
      .finally(() => useUi.getState().openCapture())
  })
}

/** Итог скачивания из Rust (lib.rs, событие download-finished). */
interface DownloadFinished {
  name: string | null
  success: boolean
}

/**
 * В macOS скачивание (экспорт копии, «Скачать») идёт без системного интерфейса прямо в «Загрузки»:
 * Rust сообщает итог, а мы показываем, куда сохранён файл. В Windows WebView2 показывает свою панель
 * загрузок, и событие не приходит.
 */
async function listenDownloads(): Promise<void> {
  const { listen } = await import('@tauri-apps/api/event')
  await listen<DownloadFinished>('download-finished', ({ payload }) => {
    if (payload.success) {
      toast.success(payload.name ? `Сохранено в «Загрузки»: ${payload.name}` : 'Файл сохранён в «Загрузки»')
    } else {
      toast.error(payload.name ? `Не удалось сохранить ${payload.name}` : 'Не удалось сохранить файл')
    }
  })
}

/** Инициализация desktop-оболочки: глобальное сочетание из настроек. Вне Tauri ничего не делает. */
export async function initDesktop(): Promise<void> {
  if (!isTauri()) return
  void listenDownloads().catch((err) => console.warn('[desktop] не удалось подписаться на скачивания', err))
  // Динамический импорт: autoBackup.ts сам импортирует этот модуль.
  void import('./autoBackup')
    .then((m) => m.initAutoBackup())
    .catch((err) => console.warn('[desktop] не удалось запустить автоматическое копирование', err))
  let shortcut = ''
  try {
    shortcut = (await getSettings()).globalShortcut
    if (shortcut) await registerShortcut(shortcut)
  } catch (err) {
    console.warn('[desktop] не удалось зарегистрировать глобальное сочетание', err)
    if (!shortcut) return
    failedShortcut = shortcut
    toast.error(`Сочетание ${shortcut} не назначено`, {
      description: 'Скорее всего, его заняла другая программа. Выберите другое в настройках.',
      duration: 10_000,
      action: { label: 'Настройки', onClick: () => useUi.getState().setView('settings') },
    })
  }
}

/** Перерегистрация глобального сочетания при изменении настройки. */
export async function applyGlobalShortcut(shortcut: string): Promise<{ ok: boolean; error?: string }> {
  if (!isTauri()) return { ok: false, error: 'Доступно только в настольной версии' }
  const value = shortcut.trim()
  if (!value) return { ok: false, error: 'Укажите сочетание клавиш' }
  try {
    await registerShortcut(value)
    failedShortcut = null
    return { ok: true }
  } catch (err) {
    console.warn('[desktop] сочетание не зарегистрировано', err)
    // Не оставляем приложение без сочетания: пробуем вернуть прежнее
    try {
      const { globalShortcut } = await getSettings()
      if (globalShortcut && globalShortcut !== value) {
        await registerShortcut(globalShortcut)
        failedShortcut = null
      }
    } catch {
      /* ignore */
    }
    return { ok: false, error: 'Сочетание занято другой программой или записано неверно' }
  }
}

/** Открыть ссылку в системном браузере (только http/https). Вне Tauri возвращает false. */
export async function openExternal(url: string): Promise<boolean> {
  if (!isTauri()) return false
  try {
    if (!/^https?:\/\//i.test(url)) return false
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
    return true
  } catch (err) {
    console.warn('[desktop] не удалось открыть ссылку', err)
    return false
  }
}

export interface SavedFile {
  path: string
  size: number
  done: boolean
}

export interface BackupEntry {
  name: string
  size: number
  modifiedAt: number
}

export interface PruneResult {
  removed: string[]
  failed: string[]
}

export const DESKTOP_ONLY_MESSAGE = 'Доступно только в настольной версии'

async function desktopInvoke(): Promise<InvokeFn> {
  if (!isTauri()) throw new Error(DESKTOP_ONLY_MESSAGE)
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke
}

/** Назначение папки: по нему Rust выбирает заголовок диалога (свой текст веб-слой не передаёт). */
export type DirectoryPurpose = 'backup' | 'export'

/**
 * Системный диалог выбора папки; папка запоминается как разрешённая для записи. Вне Tauri и при отмене — null.
 * defaultPath действует, только если папка уже подтверждена (обычно — текущее значение настройки).
 */
export async function pickDirectory(
  options: { purpose?: DirectoryPurpose; defaultPath?: string } = {},
): Promise<string | null> {
  if (!isTauri()) return null
  try {
    const invoke = await desktopInvoke()
    const picked = await invoke<string | null>('pick_directory', {
      purpose: options.purpose ?? null,
      defaultPath: options.defaultPath ?? null,
    })
    return picked ?? null
  } catch (e) {
    throw ipcError(e, 'Не удалось выбрать папку')
  }
}

/** Атомарная запись автокопии. fileName — только quickdrop-backup-YYYYMMDD-HHMMSS.json. */
export async function saveBackupFile(
  dir: string,
  fileName: string,
  data: Blob,
  signal?: AbortSignal,
): Promise<SavedFile> {
  const invoke = await desktopInvoke()
  return invokeChunked<SavedFile>(invoke, 'save_backup', { dir, fileName }, data, {
    fallback: 'Не удалось сохранить копию',
    signal,
  })
}

/**
 * Оставляет keep последних автокопий этой установки (копии другого компьютера в общей папке не трогает).
 * protect — только что сохранённая копия: остаётся, даже если по имени не последняя (часы сдвинуты назад).
 */
export async function pruneBackups(dir: string, keep: number, protect?: string): Promise<PruneResult> {
  const invoke = await desktopInvoke()
  try {
    return await invoke<PruneResult>('prune_backups', { dir, keep, protect: protect ?? null })
  } catch (e) {
    throw ipcError(e, 'Не удалось удалить старые копии')
  }
}

export async function listBackups(dir: string): Promise<BackupEntry[]> {
  const invoke = await desktopInvoke()
  try {
    return await invoke<BackupEntry[]>('list_backups', { dir })
  } catch (e) {
    throw ipcError(e, 'Не удалось прочитать папку')
  }
}

/** Запись файла экспорта: relPath относительный, разделитель '/'. Строка пишется как UTF-8 без BOM. */
export async function writeExportFile(
  dir: string,
  relPath: string,
  data: Blob | string,
  signal?: AbortSignal,
): Promise<SavedFile> {
  const invoke = await desktopInvoke()
  const blob = typeof data === 'string' ? new Blob([data]) : data
  return invokeChunked<SavedFile>(invoke, 'write_export_file', { dir, relPath }, blob, {
    fallback: 'Не удалось записать файл',
    signal,
    // Остаток .qdpart экспорта никто, кроме этой команды, не уберёт: write_export_file такие имена отклоняет.
    discard: () => invoke<boolean>('discard_export_part', { dir, relPath }),
  })
}

/** Показать файл или папку в проводнике. false — вне Tauri или не удалось. Никогда не бросает. */
export async function revealInExplorer(path: string): Promise<boolean> {
  if (!isTauri() || !path) return false
  try {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
    await revealItemInDir(path)
    return true
  } catch (err) {
    console.warn('[desktop] не удалось показать в проводнике', err)
    return false
  }
}
