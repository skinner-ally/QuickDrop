import { Icon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { actRelayoutGraph } from '@/lib/actions'
import { GRAPH_ZOOM_MAX, GRAPH_ZOOM_MIN, useGraph } from '@/store/graph'

// Обычная кнопка панели: 28 px на ПК, 36 px на телефоне и при грубом указателе. Пиксельные размеры кратны 2 px.
const BTN =
  'px-btn aria-pressed:bg-muted aria-pressed:text-foreground max-md:size-9 pointer-coarse:size-9 pixel:size-7.5 pixel:max-md:size-9 pixel:pointer-coarse:size-9'

/** «12,5 %», «100 %»: неразрывный пробел, чтобы процент не отрывался от числа. */
function formatZoom(zoom: number): string {
  const percent = zoom * 100
  return `${Number.isInteger(percent) ? String(percent) : percent.toLocaleString('ru-RU')} %`
}

/** Плавающая панель в левом нижнем углу сцены: масштаб, «Весь граф», «Разложить заново», переключатель «Архив». */
export function GraphToolbar() {
  const zoom = useGraph((s) => s.camera.zoom)
  const showArchive = useGraph((s) => s.showArchive)
  const zoomStep = useGraph((s) => s.zoomStep)
  const fitAll = useGraph((s) => s.fitAll)
  const setShowArchive = useGraph((s) => s.setShowArchive)

  return (
    <div
      data-graph-ui
      role="toolbar"
      aria-label="Управление графом"
      className="absolute bottom-2 left-2 z-10 flex items-center gap-1 pixel:gap-1.5"
    >
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className={BTN}
        aria-label="Уменьшить"
        title="Уменьшить"
        disabled={zoom <= GRAPH_ZOOM_MIN}
        onClick={() => zoomStep(-1)}
      >
        <Icon name="minus" className="size-4" />
      </Button>
      {/* Ширина постоянная: от «12,5 %» до «200 %» кнопки рядом не прыгают. */}
      <span
        aria-live="polite"
        title="Масштаб"
        className="px-chip inline-flex h-7 min-w-14 items-center justify-center rounded-md border bg-background px-1.5 text-xs text-foreground tabular-nums max-md:h-9 pointer-coarse:h-9 pixel:h-7.5 pixel:max-md:h-9 pixel:pointer-coarse:h-9"
      >
        {formatZoom(zoom)}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className={BTN}
        aria-label="Увеличить"
        title="Увеличить"
        disabled={zoom >= GRAPH_ZOOM_MAX}
        onClick={() => zoomStep(1)}
      >
        <Icon name="plus" className="size-4" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className={BTN}
        aria-label="Весь граф"
        title="Весь граф (0)"
        onClick={fitAll}
      >
        <Icon name="maximize" className="size-4" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className={BTN}
        aria-label="Разложить заново"
        title="Разложить заново"
        onClick={() => void actRelayoutGraph()}
      >
        <Icon name="layout" className="size-4" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className={BTN}
        aria-label="Показывать архив"
        aria-pressed={showArchive}
        title="Показывать архив"
        onClick={() => setShowArchive(!showArchive)}
      >
        <Icon name={showArchive ? 'eye' : 'eye-off'} className="size-4" />
      </Button>
    </div>
  )
}
