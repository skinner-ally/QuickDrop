import { useEffect, useState } from 'react'

/** Значение, отстающее на delayMs после последнего изменения. */
export function useDebounced<T>(value: T, delayMs: number): T {
  // Обёртки () => value: значение-функцию React иначе принял бы за инициализатор или функцию обновления.
  const [debounced, setDebounced] = useState<T>(() => value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(() => value), Math.max(0, delayMs))
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
