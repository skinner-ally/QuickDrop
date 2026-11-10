/**
 * Сравнение нажатой клавиши с физической (по e.code — работает в любой раскладке).
 * Если e.code пустой (экранные клавиатуры, часть IME/виртуальных устройств), используем
 * запасной вариант — e.key (без учёта регистра).
 */
export function matchKey(e: { code: string; key: string }, code: string, key?: string): boolean {
  if (e.code) return e.code === code
  return key !== undefined && e.key.toLowerCase() === key.toLowerCase()
}
