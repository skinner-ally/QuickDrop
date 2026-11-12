import { Icon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { matchKey } from '@/lib/keys'
import { modKey } from '@/lib/platform'
import { useUi } from '@/store/ui'

export function TopBar({ mobile }: { mobile: boolean }) {
  const query = useUi((s) => s.query)
  const setQuery = useUi((s) => s.setQuery)
  const setNavOpen = useUi((s) => s.setNavOpen)
  const setPaletteOpen = useUi((s) => s.setPaletteOpen)

  const onChange = (value: string) => {
    setQuery(value)
    // Поиск работает по записям, а не по настройкам.
    const ui = useUi.getState()
    if (value && ui.view === 'settings') ui.setView('library')
  }

  return (
    <header className="box-content flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3 pt-[env(safe-area-inset-top)] px-panel pixel:box-border pixel:h-auto pixel:gap-2.5 pixel:[--px-pad:10px_12px] pixel:max-md:[--px-pad:8px]">
      {mobile && (
        <Button variant="ghost" size="icon" className="px-btn pixel:size-9" aria-label="Открыть меню" onClick={() => setNavOpen(true)}>
          <Icon name="menu" />
        </Button>
      )}
      <div className="relative min-w-0 flex-1 pixel:md:max-w-[420px]">
        <Icon
          name="search"
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          data-search-input
          type="search"
          value={query}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (!matchKey(e, 'Escape', 'Escape')) return
            e.stopPropagation()
            if (query) setQuery('')
            else e.currentTarget.blur()
          }}
          placeholder="Поиск… попробуйте tag:идеи type:ссылка"
          aria-label="Поиск по записям"
          autoComplete="off"
          spellCheck={false}
          className="h-8 px-field pixel:h-7.5 pixel:max-md:h-9 w-full rounded-lg border border-input bg-surface pr-16 pl-8 text-base outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm [&::-webkit-search-cancel-button]:hidden"
        />
        <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center">
          {query ? (
            <Button variant="ghost" size="icon-xs" aria-label="Очистить поиск" onClick={() => setQuery('')}>
              <Icon name="x" />
            </Button>
          ) : (
            !mobile && (
              <Kbd className="pointer-events-none pixel:hidden">{modKey()} K</Kbd>
            )
          )}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="hidden pixel:h-7.5 pixel:min-[1000px]:inline-flex"
        onClick={() => setPaletteOpen(true)}
      >
        Команды
        <Kbd className="max-[1240px]:hidden">{modKey()} K</Kbd>
      </Button>
      <div data-topbar-slot className="ml-auto flex shrink-0 items-center gap-1 empty:hidden" />
    </header>
  )
}
