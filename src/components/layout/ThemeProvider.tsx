import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSettings } from '@/db/settings'

export type Theme = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'qd-theme'
const THEME_COLOR = { light: '#FBFAF8', dark: '#1a1816' } as const

function isTheme(v: unknown): v is Theme {
  return v === 'system' || v === 'light' || v === 'dark'
}

function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return isTheme(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

function resolve(theme: Theme): ResolvedTheme {
  return theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme
}

function applyToDocument(resolved: ResolvedTheme): void {
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
}

// Применяем сохранённую тему синхронно при загрузке модуля — до первого рендера, без мигания.
const initialTheme: Theme = typeof document !== 'undefined' ? readStored() : 'system'
if (typeof document !== 'undefined') applyToDocument(resolve(initialTheme))

interface ThemeContextValue {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme нужно вызывать внутри ThemeProvider')
  return ctx
}

/** Настройка theme из БД — источник истины: при её изменении переключаем тему. */
function ThemeSync() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const saved = useSettings()?.theme
  const themeRef = useRef(theme)
  themeRef.current = theme

  useEffect(() => {
    if (saved && saved !== themeRef.current) setTheme(saved)
  }, [saved, setTheme])

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
    meta.content = THEME_COLOR[resolvedTheme]
  }, [resolvedTheme])

  return null
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const onChange = () => setSystemDark(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolvedTheme: ResolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  useEffect(() => {
    applyToDocument(resolvedTheme)
  }, [resolvedTheme])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // хранилище недоступно (приватный режим) — тема живёт до перезагрузки
    }
  }, [])

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme])

  return (
    <ThemeContext.Provider value={value}>
      <ThemeSync />
      {children}
    </ThemeContext.Provider>
  )
}
