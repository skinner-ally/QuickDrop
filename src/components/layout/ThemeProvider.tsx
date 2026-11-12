import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSettings } from '@/db/settings'
import { THEME_COLOR, isFontPref, isPixelScene, isScenePref, resolveScene, sceneClasses, seasonScene } from '@/lib/scene'
import type { Scene } from '@/lib/scene'
import type { FontPref, ScenePref, Settings } from '@/types'

export type Theme = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'qd-theme'
const SCENE_KEY = 'qd-scene'
const FONT_KEY = 'qd-font'

function isTheme(v: unknown): v is Theme {
  return v === 'system' || v === 'light' || v === 'dark'
}

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeKey(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // хранилище недоступно (приватный режим) — выбор живёт до перезагрузки
  }
}

function readStored(): Theme {
  const v = readKey(STORAGE_KEY)
  return isTheme(v) ? v : 'system'
}

function readStoredScene(): ScenePref {
  const v = readKey(SCENE_KEY)
  return isScenePref(v) ? v : 'auto'
}

function readStoredFont(): FontPref {
  const v = readKey(FONT_KEY)
  return isFontPref(v) ? v : 'round'
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

function resolve(theme: Theme): ResolvedTheme {
  return theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme
}

function applyToDocument(resolved: ResolvedTheme, scene: Scene, font: FontPref): void {
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.style.colorScheme = resolved
  const next = sceneClasses(scene, font)
  const stale = Array.from(root.classList).filter(
    (c) => (c === 'pixel' || c.startsWith('sc-') || c.startsWith('ft-')) && !next.includes(c),
  )
  if (stale.length) root.classList.remove(...stale)
  root.classList.add(...next)
}

// Применяем сохранённые тему, сцену и шрифт синхронно при загрузке модуля — до первого рендера, без мигания.
const hasDocument = typeof document !== 'undefined'
const initialTheme: Theme = hasDocument ? readStored() : 'system'
const initialScene: ScenePref = hasDocument ? readStoredScene() : 'auto'
const initialFont: FontPref = hasDocument ? readStoredFont() : 'round'
if (hasDocument) applyToDocument(resolve(initialTheme), resolveScene(initialScene), initialFont)

interface ThemeContextValue {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

export interface SceneContextValue {
  /** Выбор пользователя. */
  scene: ScenePref
  /** Фактическая сцена ('auto' раскрыт по календарю). */
  resolvedScene: Scene
  /** resolvedScene !== 'classic'. */
  pixel: boolean
  font: FontPref
  /** settings.ambient; пока настройки читаются — true. */
  ambient: boolean
  setScene: (scene: ScenePref) => void
  setFont: (font: FontPref) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const SceneContext = createContext<SceneContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme нужно вызывать внутри ThemeProvider')
  return ctx
}

export function useScene(): SceneContextValue {
  const ctx = useContext(SceneContext)
  if (!ctx) throw new Error('useScene нужно вызывать внутри ThemeProvider')
  return ctx
}

/** Настройки theme / scene / font из БД — источник истины: при их изменении переключаем оформление. */
function ThemeSync({ settings }: { settings: Settings | undefined }) {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const { scene, font, resolvedScene, setScene, setFont } = useScene()
  const saved = settings?.theme
  const savedScene = settings?.scene
  const savedFont = settings?.font
  const themeRef = useRef(theme)
  themeRef.current = theme
  const sceneRef = useRef(scene)
  sceneRef.current = scene
  const fontRef = useRef(font)
  fontRef.current = font

  useEffect(() => {
    if (saved && saved !== themeRef.current) setTheme(saved)
  }, [saved, setTheme])

  useEffect(() => {
    if (isScenePref(savedScene) && savedScene !== sceneRef.current) setScene(savedScene)
  }, [savedScene, setScene])

  useEffect(() => {
    if (isFontPref(savedFont) && savedFont !== fontRef.current) setFont(savedFont)
  }, [savedFont, setFont])

  // theme-color следует оформлению приложения, а не ОС: оставляем один meta без media.
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
    meta.content = THEME_COLOR[resolvedScene][resolvedTheme]
  }, [resolvedScene, resolvedTheme])

  return null
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)
  const [scene, setSceneState] = useState<ScenePref>(initialScene)
  const [font, setFontState] = useState<FontPref>(initialFont)
  const [now, setNow] = useState(() => new Date())
  const settings = useSettings()

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const onChange = () => setSystemDark(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Смена времени года подхватывается без перезапуска: дату перечитываем, когда к окну возвращаются.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      const next = new Date()
      // пока сезон тот же, состояние не трогаем — иначе каждый возврат в окно перерисовывал бы провайдер
      setNow((prev) => (seasonScene(prev) === seasonScene(next) ? prev : next))
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  const resolvedTheme: ResolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
  const resolvedScene = resolveScene(scene, now)

  useEffect(() => {
    applyToDocument(resolvedTheme, resolvedScene, font)
  }, [resolvedTheme, resolvedScene, font])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    writeKey(STORAGE_KEY, next)
  }, [])

  const setScene = useCallback((next: ScenePref) => {
    setSceneState(next)
    writeKey(SCENE_KEY, next)
  }, [])

  const setFont = useCallback((next: FontPref) => {
    setFontState(next)
    writeKey(FONT_KEY, next)
  }, [])

  const ambient = settings?.ambient ?? true

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme])
  const sceneValue = useMemo<SceneContextValue>(
    () => ({ scene, resolvedScene, pixel: isPixelScene(resolvedScene), font, ambient, setScene, setFont }),
    [scene, resolvedScene, font, ambient, setScene, setFont],
  )

  return (
    <ThemeContext.Provider value={value}>
      <SceneContext.Provider value={sceneValue}>
        <ThemeSync settings={settings} />
        {children}
      </SceneContext.Provider>
    </ThemeContext.Provider>
  )
}
