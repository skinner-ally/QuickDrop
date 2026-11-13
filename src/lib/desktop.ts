import { toast } from 'sonner'
import { getSettings } from '@/db/settings'
import { dirsInUse } from '@/lib/backupUi'
import { invokeChunked, ipcError, type InvokeFn } from '@/lib/ipc'
import { isTauri } from '@/lib/platform'
import {
  isExtensionToken,
  tokenFromBytes,
  validateExtPort,
  type AutostartState,
  type ExtServerStatus,
} from '@/lib/shellUi'
import { useUi } from '@/store/ui'
import { DEFAULT_SETTINGS, type Settings } from '@/types'

export type { ExtServerStatus, AutostartState } from '@/lib/shellUi'

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

/** Прежнее поведение сочетания: поднять главное окно и открыть в нём диалог добавления. */
function captureInMainWindow(): void {
  void raiseWindow()
    .catch((err) => console.warn('[desktop] не удалось показать окно', err))
    .finally(() => useUi.getState().openCapture())
}

/**
 * Нажатие глобального сочетания. Из другой программы (главное окно не в фокусе) при включённом мини-окне
 * показывает или прячет мини-окно; иначе, а также если мини-окно не открылось, — прежний диалог.
 */
async function onGlobalShortcut(): Promise<void> {
  let mini = false
  try {
    mini = (await getSettings()).captureWindow && !document.hasFocus()
  } catch {
    /* настройки не прочитаны — как раньше */
  }
  if (mini) {
    try {
      await toggleCaptureWindow()
      return
    } catch (err) {
      console.warn('[desktop] мини-окно не открылось, открываем главное', err)
    }
  }
  captureInMainWindow()
}

/**
 * Сочетание, которое сейчас действительно зарегистрировано (null — никакого). Нужно для отката: после импорта
 * копии в настройках уже новое значение, и прежнее оттуда не узнать.
 */
let activeShortcut: string | null = null

async function registerShortcut(shortcut: string): Promise<void> {
  const { register, unregisterAll } = await import('@tauri-apps/plugin-global-shortcut')
  await unregisterAll()
  activeShortcut = null
  await register(shortcut, (e) => {
    if (e.state !== 'Pressed') return
    void onGlobalShortcut()
  })
  activeShortcut = shortcut
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

/** Открыть в главном окне запись по id (событие open-item от Rust: «Открыть» у дубля в мини-окне). */
async function openItemById(id: string): Promise<void> {
  try {
    // Динамически: actions.ts сам импортирует этот модуль.
    const [{ getItem }, { openItemInSection }] = await Promise.all([import('@/db/repo'), import('./actions')])
    const item = await getItem(id)
    if (!item) {
      toast.error('Запись не найдена')
      return
    }
    openItemInSection(item)
  } catch (err) {
    console.warn('[desktop] не удалось открыть запись', err)
  }
}

/**
 * События, адресованные главному окну (emit_to("main", …)). Подписка окна, а не глобальная: глобальный listen
 * получил бы и события, адресованные другим окнам.
 */
async function listenWindowEvents(): Promise<void> {
  const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  const win = getCurrentWebviewWindow()
  await win.listen('open-capture', () => useUi.getState().openCapture())
  await win.listen<{ id?: unknown } | null>('open-item', ({ payload }) => {
    const id = payload?.id
    if (typeof id === 'string' && id) void openItemById(id)
  })
}

/** Запуск приёма от расширения при старте; не запустился — toast со ссылкой на настройки. */
async function startExtensionServer(settings: Settings): Promise<void> {
  const status = await applyExtensionServer(settings)
  if (status.running) return
  toast.error('Приём от расширения не запущен', {
    description: status.error,
    duration: 10_000,
    action: { label: 'Настройки', onClick: () => useUi.getState().setView('settings') },
  })
}

/**
 * Инициализация desktop-оболочки главного окна: подписки окна, флаги трея и мини-окна, приём от расширения,
 * глобальное сочетание из настроек, сверка подтверждённых папок, автокопии. Вне Tauri ничего не делает.
 * Мини-окно её не вызывает.
 */
export async function initDesktop(): Promise<void> {
  if (!isTauri()) return
  void listenDownloads().catch((err) => console.warn('[desktop] не удалось подписаться на скачивания', err))
  void listenWindowEvents().catch((err) => console.warn('[desktop] не удалось подписаться на события окна', err))
  void reconcileApprovedDirs()
  // Динамический импорт: autoBackup.ts сам импортирует этот модуль.
  void import('./autoBackup')
    .then((m) => m.initAutoBackup())
    .catch((err) => console.warn('[desktop] не удалось запустить автоматическое копирование', err))
  let settings: Settings
  try {
    settings = await getSettings()
  } catch (err) {
    console.warn('[desktop] настройки не прочитаны', err)
    return
  }
  void applyShellOptions(settings)
  if (settings.extEnabled) {
    void startExtensionServer(settings).catch((err) =>
      console.warn('[desktop] не удалось запустить приём от расширения', err),
    )
  }
  const shortcut = settings.globalShortcut
  if (!shortcut) return
  try {
    await registerShortcut(shortcut)
  } catch (err) {
    console.warn('[desktop] не удалось зарегистрировать глобальное сочетание', err)
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

/**
 * Применить сочетание, уже записанное в настройки в обход поля (импорт копии с заменой). Совпадает с
 * действующим — ничего не делает. Не назначилось — возвращает действовавшее прежде и помечает новое
 * неприменённым (globalShortcutFailure), чтобы поле в настройках это показало. Не бросает.
 */
export async function reapplyGlobalShortcut(next: string): Promise<{ ok: boolean; error?: string }> {
  if (!isTauri()) return { ok: true }
  const value = typeof next === 'string' ? next.trim() : ''
  const prev = activeShortcut
  if (!value || value === prev) return { ok: true }
  try {
    await registerShortcut(value)
    failedShortcut = null
    return { ok: true }
  } catch (err) {
    console.warn('[desktop] сочетание из копии не зарегистрировано', err)
    if (prev) {
      try {
        await registerShortcut(prev)
      } catch {
        /* ignore */
      }
    }
    failedShortcut = value
    return {
      ok: false,
      error: `Сочетание ${value} из копии не назначено: занято другой программой или записано неверно`,
    }
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

/** Непустые строки списка папок (keep для команд Rust). */
function nonEmptyDirs(dirs: string[]): string[] {
  return Array.isArray(dirs) ? dirs.filter((d) => typeof d === 'string' && d.trim() !== '') : []
}

/**
 * Убирает папку из подтверждённых для записи (команда Rust forget_directory): после смены папки в настройках
 * прежняя больше не открыта для записи. keep — папки, оставшиеся в настройках: их Rust не отзывает, даже если
 * это та же папка, записанная иначе (сетевой диск и UNC, subst, ссылка). Вне Tauri, пустая строка, ошибка → false.
 * Не бросает.
 */
export async function forgetDirectory(dir: string, keep: string[] = []): Promise<boolean> {
  if (!isTauri() || typeof dir !== 'string' || !dir.trim()) return false
  try {
    const invoke = await desktopInvoke()
    return (await invoke<boolean>('forget_directory', { dir, keep: nonEmptyDirs(keep) })) === true
  } catch (err) {
    console.warn('[desktop] не удалось отозвать папку', err)
    return false
  }
}

/**
 * Оставляет подтверждёнными только папки из keep (команда Rust retain_directories; в отладочной сборке Rust
 * ничего не делает). true — что-то убрано. Вне Tauri и при ошибке → false. Не бросает.
 */
export async function retainDirectories(keep: string[]): Promise<boolean> {
  if (!isTauri()) return false
  try {
    const invoke = await desktopInvoke()
    return (await invoke<boolean>('retain_directories', { keep: nonEmptyDirs(keep) })) === true
  } catch (err) {
    console.warn('[desktop] не удалось сверить подтверждённые папки', err)
    return false
  }
}

/**
 * Сверка при запуске: подтверждёнными остаются только папки из настроек. Отзыв прежней папки при смене
 * настройки одноразовый — его сбой (или стёртые данные WebView) иначе оставил бы папку открытой навсегда.
 * Настройки не прочитались — ничего не убирает: пустой список отозвал бы и рабочие папки. Не бросает.
 */
export async function reconcileApprovedDirs(): Promise<boolean> {
  if (!isTauri()) return false
  let keep: string[]
  try {
    keep = dirsInUse(await getSettings())
  } catch (err) {
    console.warn('[desktop] сверка папок пропущена: настройки не прочитаны', err)
    return false
  }
  return retainDirectories(keep)
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

// ───────────────────────── этап 7: оболочка и приём от расширения ─────────────────────────

/** Новый токен расширения: 32 байта crypto.getRandomValues → base64url (43 символа). */
export function generateExtensionToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return tokenFromBytes(bytes)
}

/**
 * set_shell_options: флаги трея (крестик прячет окно) и мини-окна (Rust создаёт или убирает скрытое окно).
 * Не бросает; false — вне Tauri или отказ команды.
 */
export async function applyShellOptions(s: Pick<Settings, 'closeToTray' | 'captureWindow'>): Promise<boolean> {
  if (!isTauri()) return false
  try {
    const invoke = await desktopInvoke()
    await invoke('set_shell_options', {
      closeToTray: s.closeToTray === true,
      captureWindow: s.captureWindow === true,
    })
    return true
  } catch (err) {
    console.warn('[desktop] не удалось применить настройки окна', err)
    return false
  }
}

/** toggle_capture_window: показать мини-окно или спрятать видимое. true — показано. Бросает Error при отказе. */
export async function toggleCaptureWindow(): Promise<boolean> {
  const invoke = await desktopInvoke()
  try {
    return (await invoke<boolean>('toggle_capture_window')) === true
  } catch (e) {
    throw ipcError(e, 'Не удалось показать окно быстрой записи')
  }
}

/** show_main_window: показать и сфокусировать главное окно (в т.ч. спрятанное в трей). Не бросает. */
export async function showMainWindow(): Promise<void> {
  if (!isTauri()) return
  try {
    const invoke = await desktopInvoke()
    await invoke('show_main_window')
  } catch (err) {
    console.warn('[desktop] не удалось показать главное окно', err)
  }
}

/** open_in_main: показать главное окно и открыть в нём запись (вызывает мини-окно). Не бросает. */
export async function openInMain(id: string): Promise<void> {
  if (!isTauri() || typeof id !== 'string' || !id) return
  try {
    const invoke = await desktopInvoke()
    await invoke('open_in_main', { id })
  } catch (err) {
    console.warn('[desktop] не удалось открыть запись в главном окне', err)
  }
}

/** quit_app: завершить приложение целиком (в т.ч. из трея). Вне Tauri ничего не делает; отказ команды → Error. */
export async function quitApp(): Promise<void> {
  if (!isTauri()) return
  const invoke = await desktopInvoke()
  try {
    await invoke('quit_app')
  } catch (e) {
    throw ipcError(e, 'Не удалось завершить приложение')
  }
}

/** Состояние автозапуска из системы. Вне Tauri и при ошибке — { enabled: false, available: false, reason }. Не бросает. */
export async function getAutostart(): Promise<AutostartState> {
  if (!isTauri()) return { enabled: false, available: false, reason: DESKTOP_ONLY_MESSAGE }
  try {
    const invoke = await desktopInvoke()
    const r = await invoke<Partial<AutostartState> | null>('get_autostart')
    const state: AutostartState = { enabled: r?.enabled === true, available: r?.available === true }
    if (typeof r?.reason === 'string' && r.reason) state.reason = r.reason
    return state
  } catch (e) {
    return {
      enabled: false,
      available: false,
      reason: ipcError(e, 'Не удалось узнать состояние автозапуска').message,
    }
  }
}

/** set_autostart. Не бросает: отказ (в т.ч. вне Tauri и в отладочной сборке) → { ok: false, error }. */
export async function setAutostart(on: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!isTauri()) return { ok: false, error: DESKTOP_ONLY_MESSAGE }
  try {
    const invoke = await desktopInvoke()
    await invoke('set_autostart', { enabled: on === true })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: ipcError(e, 'Не удалось изменить автозапуск').message }
  }
}

const EXT_STOPPED: ExtServerStatus = { running: false, port: null }

/** Ответ Rust (ExtStatus) → ExtServerStatus без лишних полей. */
function extStatusFrom(r: unknown): ExtServerStatus {
  const v = (r ?? {}) as { running?: unknown; port?: unknown }
  return {
    running: v.running === true,
    port: typeof v.port === 'number' && Number.isInteger(v.port) ? v.port : null,
  }
}

/**
 * ext_server_apply: запустить, перезапустить с новым портом или токеном, остановить приём от расширения.
 * Вне Tauri, без годного токена или порта при extEnabled, при отказе команды — { running: false, port: null, error }:
 * негодный токен в Rust не уходит. Не бросает.
 */
export async function applyExtensionServer(
  s: Pick<Settings, 'extEnabled' | 'extPort' | 'extToken'>,
): Promise<ExtServerStatus> {
  if (!isTauri()) return { ...EXT_STOPPED, error: DESKTOP_ONLY_MESSAGE }
  const enabled = s.extEnabled === true
  const portOk = typeof s.extPort === 'number' && validateExtPort(String(s.extPort)) === null
  if (enabled) {
    if (!isExtensionToken(s.extToken)) return { ...EXT_STOPPED, error: 'Токен расширения не создан' }
    if (!portOk) return { ...EXT_STOPPED, error: 'Порт должен быть от 1024 до 65535' }
  }
  try {
    const invoke = await desktopInvoke()
    const r = await invoke<unknown>('ext_server_apply', {
      enabled,
      // Для остановки порт и токен не важны: токен при выключении не передаём вовсе.
      port: portOk ? s.extPort : DEFAULT_SETTINGS.extPort,
      token: enabled ? s.extToken : '',
    })
    return extStatusFrom(r)
  } catch (e) {
    return {
      ...EXT_STOPPED,
      error: ipcError(e, enabled ? 'Не удалось запустить приём от расширения' : 'Не удалось остановить приём от расширения')
        .message,
    }
  }
}

/** Остановить приём от расширения: порт и токен для остановки не нужны. Не бросает (см. applyExtensionServer). */
export function stopExtensionServer(): Promise<ExtServerStatus> {
  return applyExtensionServer({ extEnabled: false, extPort: DEFAULT_SETTINGS.extPort, extToken: '' })
}

/** ext_server_status. Вне Tauri и при отказе — { running: false, port: null, error }. Не бросает. */
export async function getExtServerStatus(): Promise<ExtServerStatus> {
  if (!isTauri()) return { ...EXT_STOPPED, error: DESKTOP_ONLY_MESSAGE }
  try {
    const invoke = await desktopInvoke()
    return extStatusFrom(await invoke<unknown>('ext_server_status'))
  } catch (e) {
    return { ...EXT_STOPPED, error: ipcError(e, 'Не удалось узнать состояние приёма').message }
  }
}

/**
 * extension_dir: путь к папке расширения Chrome, которую кладёт установщик (bundle.resources). Вне Tauri, без
 * папки (сборка без ресурсов) и при отказе команды — null. Не бросает.
 */
export async function getExtensionDir(): Promise<string | null> {
  if (!isTauri()) return null
  try {
    const invoke = await desktopInvoke()
    const dir = await invoke<unknown>('extension_dir')
    return typeof dir === 'string' && dir.trim() ? dir : null
  } catch (err) {
    console.warn('[desktop] папка расширения не найдена', err)
    return null
  }
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
