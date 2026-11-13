/**
 * Строки и проверки для настольной оболочки этапа 7: мини-окно, трей, автозапуск, приём от расширения.
 * Чистый модуль без импортов Tauri и БД — тестируется в node.
 */

/** Состояние локального сервера приёма от расширения (команда Rust ext_server_status / ext_server_apply). */
export interface ExtServerStatus {
  running: boolean
  port: number | null
  /** Почему сервер не запущен (текст для пользователя). */
  error?: string
}

/** Автозапуск вместе с системой: читается из системы, в Settings не хранится. */
export interface AutostartState {
  enabled: boolean
  /** false — настроить нельзя (вне Tauri, отладочная сборка, ошибка); причина — в reason. */
  available: boolean
  reason?: string
}

export const EXT_PORT_MIN = 1024
export const EXT_PORT_MAX = 65535

/** Длина токена: 32 байта в base64url без '='. */
export const EXT_TOKEN_LENGTH = 43

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

/** Годный токен расширения: ровно 43 символа base64url (то же проверяет Rust перед запуском сервера). */
export function isExtensionToken(v: unknown): v is string {
  return typeof v === 'string' && TOKEN_RE.test(v)
}

/** Байты → base64url без '='. 32 байта → 43 символа. */
export function tokenFromBytes(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const PORT_ERROR = `Число от ${EXT_PORT_MIN} до ${EXT_PORT_MAX}`

/** Проверка поля «Порт»: null — годится, иначе текст ошибки. */
export function validateExtPort(v: string): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!/^\d{1,5}$/.test(s)) return PORT_ERROR
  const n = Number(s)
  return n >= EXT_PORT_MIN && n <= EXT_PORT_MAX ? null : PORT_ERROR
}

const MASK = '••••••••'

/** Токен для показа: точки и последние 4 символа; пусто → «не создан». */
export function maskToken(token: string): string {
  if (typeof token !== 'string' || token === '') return 'не создан'
  // Короткую (негодную) строку не раскрываем даже частично.
  if (token.length < 8) return MASK
  return MASK + token.slice(-4)
}

/** Строка состояния приёма от расширения в настройках. */
export function extStatusText(enabled: boolean, status?: ExtServerStatus): { text: string; error: boolean } {
  if (!enabled) return { text: 'Выключено', error: false }
  if (!status) return { text: 'Проверяем…', error: false }
  if (status.running) {
    return {
      text: status.port != null ? `Принимает записи на 127.0.0.1:${status.port}` : 'Принимает записи на 127.0.0.1',
      error: false,
    }
  }
  return { text: status.error?.trim() || 'Приём не запущен', error: true }
}

export const QUICK_CAPTURE_DESKTOP_HINT =
  'Мини-окно, значок в трее, автозапуск и приём записей от расширения браузера работают в приложении для Windows.'

/**
 * Ошибка под полем порта, когда новый порт не открылся. Настройка остаётся прежней; реальное состояние
 * приёма показывает строка «Состояние» (Rust при отказе нового порта прежний сервер не закрывает).
 */
export function portRejectedText(error: string | undefined, oldPort: number): string {
  const reason = (error?.trim() || 'Не удалось открыть порт').replace(/[.\s]+$/, '')
  return `${reason}. Порт не изменён: ${oldPort}`
}

/** Подсказка к полю глобального сочетания: что оно делает, зависит от переключателя мини-окна. */
export function globalShortcutHint(captureWindow: boolean): string {
  return captureWindow
    ? 'Из любой программы открывает мини-окно быстрой записи, повторное нажатие прячет его. Формат: CommandOrControl+Shift+Space.'
    : 'Из любой программы поднимает окно QuickDrop и открывает добавление. Формат: CommandOrControl+Shift+Space.'
}

// Установщик папку extension пока не содержит: она лежит в исходниках QuickDrop (README, «Быстрый захват»).
export const EXTENSION_INSTALL_STEPS: readonly string[] = [
  'Откройте в Chrome страницу chrome://extensions и включите «Режим разработчика»',
  'Нажмите «Загрузить распакованное расширение» и выберите папку extension из исходников QuickDrop (в установщик она не входит)',
  'Откройте настройки расширения: значок QuickDrop → «Настройки»',
  'Вставьте туда порт и токен из этого раздела и нажмите «Сохранить»',
  'Нажмите «Проверить соединение» — должно появиться «Соединение есть»',
]
