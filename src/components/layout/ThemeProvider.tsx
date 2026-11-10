import { useEffect, useRef, type ReactNode } from 'react'
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes'
import { useSettings } from '@/db/settings'

const THEME_COLOR = { light: '#f7f5f1', dark: '#1a1816' } as const

/** Настройка theme из БД — источник истины: при её изменении переключаем next-themes. */
function ThemeSync() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const saved = useSettings()?.theme
  // В next-themes setTheme меняет идентичность при каждой смене темы; держим его в ref,
  // иначе эффект сработает со старым saved и откатит локальное переключение до записи в БД.
  const setThemeRef = useRef(setTheme)
  setThemeRef.current = setTheme
  const themeRef = useRef(theme)
  themeRef.current = theme

  useEffect(() => {
    if (saved && saved !== themeRef.current) setThemeRef.current(saved)
  }, [saved])

  // theme-color следует теме приложения, а не ОС: оставляем один meta без media.
  useEffect(() => {
    const metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))
    let meta = metas[0]
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'theme-color'
      document.head.appendChild(meta)
    }
    for (const m of metas.slice(1)) m.remove()
    meta.removeAttribute('media')
    meta.content = resolvedTheme === 'dark' ? THEME_COLOR.dark : THEME_COLOR.light
  }, [resolvedTheme])

  return null
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <ThemeSync />
      {children}
    </NextThemesProvider>
  )
}
