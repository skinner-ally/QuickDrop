/** Запущены ли мы внутри оболочки Tauri (desktop), а не в обычном браузере. */
export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** Страница мини-окна быстрой записи (capture.html), а не главное окно. */
export const isCaptureWindow = (): boolean =>
  typeof location !== 'undefined' && /\/capture\.html$/.test(location.pathname)

export const isMac =(): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** Подпись модификатора для подсказок горячих клавиш. */
export const modKey = (): string => (isMac() ? '⌘' : 'Ctrl')
