import { Suspense, useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { Upload } from 'lucide-react'
import { QuickCapture } from '@/components/capture/QuickCapture'
import { Button } from '@/components/ui/button'
import { useHotkeys } from '@/hooks/useHotkeys'
import { useIsDesktop, useMediaQuery } from '@/hooks/useMediaQuery'
import { useUi, type View } from '@/store/ui'
import { ArchiveView } from '@/views/ArchiveView'
import { FavoritesView } from '@/views/FavoritesView'
import { InboxView } from '@/views/InboxView'
import { LibraryView } from '@/views/LibraryView'
import { ErrorBoundary, lazyRetry, RetryFallback } from './ErrorBoundary'
import { MobileNav } from './MobileNav'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'

// Редко нужные части грузятся отдельными чанками, чтобы основной оставался лёгким.
const settingsLazy = lazyRetry(() => import('@/views/SettingsView'), (m) => m.SettingsView)
const paletteLazy = lazyRetry(() => import('@/components/palette/CommandPalette'), (m) => m.CommandPalette)
const SettingsView = settingsLazy.Component
const CommandPalette = paletteLazy.Component

const loadDetail = () => import('@/components/items/ItemDetail')
const detailLazy = lazyRetry(() => loadDetail(), (m) => m.ItemDetail)
const ItemDetail = detailLazy.Component
// Панель деталей нужна почти сразу — догружаем её в простое, чтобы первое открытие не ждало сети.
if (typeof window !== 'undefined') window.setTimeout(() => void loadDetail().catch(() => undefined), 1500)

const VIEWS: View[] = ['inbox', 'library', 'favorites', 'archive', 'settings']

function viewFromHash(): View | null {
  const name = window.location.hash.replace(/^#\/?/, '')
  return (VIEWS as string[]).includes(name) ? (name as View) : null
}

/** Начальный раздел из адреса — вызывается до первого рендера (main.tsx). */
export function applyInitialHash(): void {
  const v = viewFromHash()
  if (v) useUi.getState().setView(v)
}

/** Раздел ⇄ location.hash: работают «назад» и перезагрузка. */
function useHashSync() {
  const view = useUi((s) => s.view)

  useEffect(() => {
    if (viewFromHash() !== view) window.location.hash = `#/${view}`
  }, [view])

  useEffect(() => {
    const onHash = () => {
      const v = viewFromHash()
      if (v && v !== useUi.getState().view) useUi.getState().setView(v)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
}

function ActiveView({ view }: { view: View }) {
  switch (view) {
    case 'inbox':
      return <InboxView />
    case 'library':
      return <LibraryView />
    case 'favorites':
      return <FavoritesView />
    case 'archive':
      return <ArchiveView />
    case 'settings':
      return (
        <ErrorBoundary
          onReset={settingsLazy.reset}
          fallback={(_e, reset) => <RetryFallback message="Не удалось загрузить настройки. Проверьте соединение." reset={reset} />}
        >
          <Suspense fallback={null}>
            <SettingsView />
          </Suspense>
        </ErrorBoundary>
      )
  }
}

/**
 * Сбой отрисовки раздела (например, повреждённая запись из чужой копии): боковая панель и настройки
 * остаются доступны — оттуда можно сделать экспорт или удалить данные.
 */
function ViewErrorFallback({ view, reset }: { view: View; reset: () => void }) {
  const setView = useUi((s) => s.setView)
  return (
    <div role="alert" className="flex max-w-md flex-col items-start gap-2 p-6 text-sm">
      <p className="font-medium">Не удалось показать раздел</p>
      <p className="text-muted-foreground">
        Возможно, среди записей есть повреждённая. Попробуйте ещё раз или откройте настройки: там можно сделать
        экспорт или удалить данные.
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={reset}>
          Повторить
        </Button>
        {view !== 'settings' && (
          <Button variant="outline" size="sm" onClick={() => setView('settings')}>
            Открыть настройки
          </Button>
        )}
      </div>
    </div>
  )
}

/** Панель деталей: возвращает фокус на строку при закрытии; в модальном режиме ещё и забирает фокус. */
function DetailPane({ id, modal, children }: { id: string; modal: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    if (modal) ref.current?.focus()
    return () => {
      requestAnimationFrame(() => {
        const active = document.activeElement
        if (active && active !== document.body) return // фокус уже где-то осознанно
        // Открыли другую запись (а не закрыли панель) — старую строку не трогаем.
        const open = useUi.getState().selectedId
        if (open !== null && open !== id) return
        const row = document.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"]`)
        if (row) row.focus()
        else if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
      })
    }
  }, [id, modal])
  return (
    <div ref={ref} tabIndex={-1} className="h-full outline-none">
      {children}
    </div>
  )
}

/** Делает фон недоступным для табуляции, кликов и скринридера, пока открыт модальный лист. */
function useInert(refs: RefObject<HTMLElement | null>[], inert: boolean) {
  useEffect(() => {
    if (!inert) return
    const els = refs.map((r) => r.current).filter((el): el is HTMLElement => !!el)
    for (const el of els) el.setAttribute('inert', '')
    return () => {
      for (const el of els) el.removeAttribute('inert')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inert])
}

export function AppShell() {
  const desktop = useIsDesktop()
  // Боковая панель деталей — только когда списку остаётся достаточно места.
  const wide = useMediaQuery('(min-width: 1100px)')
  const view = useUi((s) => s.view)
  const selectedId = useUi((s) => s.selectedId)
  const select = useUi((s) => s.select)
  const { dragging } = useHotkeys()
  useHashSync()

  const sideRef = useRef<HTMLElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)
  const sideDetail = desktop && wide
  const modalDetail = !!selectedId && !sideDetail
  useInert([sideRef, columnRef], modalDetail)

  const detail = selectedId ? (
    <DetailPane key={selectedId} id={selectedId} modal={modalDetail}>
      <ErrorBoundary
        onReset={detailLazy.reset}
        fallback={(_e, reset) => <RetryFallback message="Не удалось загрузить подробности записи. Проверьте соединение." reset={reset} />}
      >
        <Suspense fallback={null}>
          <ItemDetail id={selectedId} onClose={() => select(null)} />
        </Suspense>
      </ErrorBoundary>
    </DetailPane>
  ) : null

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] text-foreground">
      {desktop && (
        <aside ref={sideRef} className="w-[232px] shrink-0 border-r border-sidebar-border bg-sidebar">
          <Sidebar />
        </aside>
      )}

      <div ref={columnRef} className="flex min-w-0 flex-1 flex-col">
        <TopBar mobile={!desktop} />
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)] max-md:pb-[calc(env(safe-area-inset-bottom)+5rem)]">
          {/* key: при переходе в другой раздел граница сбрасывается сама. */}
          <ErrorBoundary key={view} fallback={(_e, reset) => <ViewErrorFallback view={view} reset={reset} />}>
            <ActiveView view={view} />
          </ErrorBoundary>
        </main>
      </div>

      {sideDetail && detail && (
        <aside aria-label="Подробности записи" className="h-full w-[460px] shrink-0 overflow-y-auto border-l bg-background">
          {detail}
        </aside>
      )}

      {!desktop && <MobileNav />}

      {modalDetail && detail && (
        <>
          {desktop && (
            <div aria-hidden className="fixed inset-0 z-40 bg-black/20" onClick={() => select(null)} />
          )}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Подробности записи"
            data-detail-sheet
            className="fixed inset-0 z-40 overflow-y-auto bg-background pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:left-auto md:w-[min(460px,100%)] md:border-l md:shadow-xl"
          >
            {detail}
          </div>
        </>
      )}

      <QuickCapture />
      <ErrorBoundary onReset={paletteLazy.reset} fallback={() => null}>
        <Suspense fallback={null}>
          <CommandPalette />
        </Suspense>
      </ErrorBoundary>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-background/80 p-6">
          <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-brand px-10 py-8 text-brand">
            <Upload className="size-6" strokeWidth={1.75} />
            <span className="text-sm font-medium">Отпустите, чтобы добавить</span>
          </div>
        </div>
      )}
    </div>
  )
}
