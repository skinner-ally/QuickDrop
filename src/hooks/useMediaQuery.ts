import { useSyncExternalStore } from 'react'

/** Подписка на CSS media query. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', cb)
      return () => mql.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** Десктопная раскладка: от 768px. */
export const useIsDesktop = (): boolean => useMediaQuery('(min-width: 768px)')
