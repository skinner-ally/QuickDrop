import { Fragment, useEffect, useRef } from 'react'
import type { GraphOverlayProps } from '@/components/graph/GraphOverlay'
import { Icon } from '@/components/icons'
import { itemActionList } from '@/components/items/ItemMenu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { smiteFromScene } from '@/lib/graph/smite'
import { useGraph } from '@/store/graph'
import { useUi } from '@/store/ui'
import type { Item } from '@/types'

/**
 * Меню ноды (правая кнопка, долгое касание, Shift+F10). Якорь — невидимый квадрат 1×1 в точке menu.x, menu.y
 * (CSS-пиксели сцены). Корень смонтирован всегда: иначе закрытие не успевало бы вернуть фокус.
 */
export function GraphNodeMenu({ scene, items }: GraphOverlayProps) {
  const menu = useGraph((s) => s.menu)
  const item = menu ? items.get(menu.id) : undefined
  const inScene = menu ? scene.byId.has(menu.id) : false
  const open = menu !== null && item !== undefined && inScene

  // Последние значения нужны, пока меню закрывается (анимация): состояние уже сброшено, содержимое ещё на экране.
  const lastItem = useRef<Item | undefined>(undefined)
  const lastPos = useRef({ x: 0, y: 0 })
  if (open && menu && item) {
    lastItem.current = item
    lastPos.current = { x: menu.x, y: menu.y }
  }
  const shown = open ? item : lastItem.current

  // Запись исчезла, пока меню было открыто: состояние сбрасывается (open уже false).
  const stale = menu !== null && !open
  useEffect(() => {
    if (stale) useGraph.getState().openMenu(null)
  }, [stale])

  const id = shown?.id
  const actions = shown ? itemActionList(shown) : []
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (!next) useGraph.getState().openMenu(null)
      }}
    >
      <DropdownMenuTrigger
        nativeButton={false}
        tabIndex={-1}
        render={
          <span
            aria-label="Действия с записью"
            className="pointer-events-none absolute size-px"
            style={{ left: lastPos.current.x, top: lastPos.current.y }}
          />
        }
      />
      <DropdownMenuContent
        align="start"
        sideOffset={2}
        className="min-w-52"
        data-graph-ui
        onClick={stop}
        onKeyDown={stop}
        // «Категория…» отдаёт фокус списку категорий; остальные пункты — сцене графа.
        finalFocus={() =>
          useGraph.getState().pickerFor !== null ? false : (document.querySelector<HTMLElement>('[data-graph-stage]') ?? true)
        }
      >
        {id !== undefined && (
          <>
            <DropdownMenuItem onClick={() => useUi.getState().select(id)}>
              <Icon name="folder-open" />
              Открыть
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => useGraph.getState().openPicker(id)}>
              <Icon name="tag" />
              Категория…
              <DropdownMenuShortcut className="pointer-coarse:hidden">E</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => useGraph.getState().setLinkFrom(id)}>
              <Icon name="link" />
              Связать с…
              <DropdownMenuShortcut className="pointer-coarse:hidden">L</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {actions.map((a) => (
              <Fragment key={a.id}>
                {a.destructive && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  variant={a.destructive ? 'destructive' : 'default'}
                  // «Удалить» на графе — сцена казни ноды (lib/graph/smite)
                  onClick={() => (a.id === 'delete' ? smiteFromScene([id], scene) : a.run())}
                >
                  <Icon name={a.icon} />
                  {a.label}
                  {/* В графе «E» — категория: подсказка «E» у «В базу знаний» и «Восстановить» была бы неверной. */}
                  {a.shortcut && a.shortcut !== 'E' && (
                    <DropdownMenuShortcut className="pointer-coarse:hidden">{a.shortcut}</DropdownMenuShortcut>
                  )}
                </DropdownMenuItem>
              </Fragment>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
