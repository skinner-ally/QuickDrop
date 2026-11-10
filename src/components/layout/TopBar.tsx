import { Menu, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { modKey } from '@/lib/platform'
import { useUi } from '@/store/ui'

export function TopBar({ mobile }: { mobile: boolean }) {
  const query = useUi((s) => s.query)
  const setQuery = useUi((s) => s.setQuery)
  const setNavOpen = useUi((s) => s.setNavOpen)

  const onChange = (value: string) => {
    setQuery(value)
    // Поиск работает по записям, а не по настройкам.
    const ui = useUi.getState()
    if (value && ui.view === 'settings') ui.setView('library')
  }

  return (
    <header className="box-content flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3 pt-[env(safe-area-inset-top)]">
      {mobile && (
        <Button variant="ghost" size="icon" aria-label="Открыть меню" onClick={() => setNavOpen(true)}>
          <Menu strokeWidth={1.75} />
        </Button>
      )}
      <div className="relative min-w-0 flex-1">
        <Search
          aria-hidden
          strokeWidth={1.75}
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          data-search-input
          type="search"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            e.stopPropagation()
            if (query) setQuery('')
            else e.currentTarget.blur()
          }}
          placeholder="Поиск… попробуйте tag:идеи type:ссылка"
          aria-label="Поиск по записям"
          autoComplete="off"
          spellCheck={false}
          className="h-8 w-full rounded-lg border border-input bg-surface pr-16 pl-8 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm [&::-webkit-search-cancel-button]:hidden"
        />
        <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center">
          {query ? (
            <Button variant="ghost" size="icon-xs" aria-label="Очистить поиск" onClick={() => setQuery('')}>
              <X strokeWidth={1.75} />
            </Button>
          ) : (
            !mobile && (
              <Kbd className="pointer-events-none">{modKey()} K</Kbd>
            )
          )}
        </div>
      </div>
    </header>
  )
}
