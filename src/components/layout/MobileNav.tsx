import { Icon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { useSelection } from '@/store/selection'
import { useUi } from '@/store/ui'
import { Sidebar } from './Sidebar'

/** Мобильная навигация: боковое меню в Sheet и плавающая кнопка «Добавить». */
export function MobileNav() {
  const navOpen = useUi((s) => s.navOpen)
  const setNavOpen = useUi((s) => s.setNavOpen)
  const openCapture = useUi((s) => s.openCapture)
  const selecting = useSelection((s) => s.ids.size > 0)
  const hideFab = useUi((s) => s.selectedId !== null || s.captureOpen || s.paletteOpen) || selecting

  return (
    <>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-[280px] max-w-[85vw] gap-0 bg-sidebar p-0 sm:max-w-[280px] pixel:w-[min(290px,86vw)]"
        >
          <SheetTitle className="sr-only">Меню</SheetTitle>
          <SheetDescription className="sr-only">Разделы, категории и теги</SheetDescription>
          <div className="h-full min-h-0 px-panel px-sheet pixel:[--px-sheet-pad:14px]">
            <Sidebar />
          </div>
        </SheetContent>
      </Sheet>
      {!hideFab && (
        <Button
          aria-label="Добавить запись"
          onClick={() => openCapture()}
          className="fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 h-12 gap-1.5 rounded-full bg-brand px-5 text-md text-brand-foreground shadow-md hover:bg-brand/90 px-fab pixel:right-[calc(1rem+env(safe-area-inset-right))] pixel:bottom-[calc(1rem+env(safe-area-inset-bottom))] pixel:size-14 pixel:p-0"
        >
          <Icon name="plus" size={20} pixelSize={24} className="size-5" />
          <span className="pixel:sr-only">Добавить</span>
        </Button>
      )}
    </>
  )
}
