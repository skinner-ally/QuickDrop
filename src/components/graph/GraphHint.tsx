import { Button } from '@/components/ui/button'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useGraph } from '@/store/graph'

/**
 * Как связать записи — тем способом, который работает при этом указателе и этой ширине окна. Значок связи у
 * выбранной записи есть только в окне от 1100 px (ниже запись открывается листом поверх сцены) и не для касания.
 */
function linkText(coarse: boolean, wide: boolean): string {
  if (coarse) return 'Чтобы связать записи, удерживайте запись, выберите «Связать с…» и коснитесь второй записи.'
  if (wide) {
    return 'Чтобы связать записи, потяните значок связи у выбранной записи к другой или перетащите запись на другую с зажатым Shift.'
  }
  return 'Чтобы связать записи, нажмите на запись правой кнопкой, выберите «Связать с…» и щёлкните вторую запись; можно и перетащить запись на другую с зажатым Shift.'
}

/** Первая подсказка на графе: закрывается кнопкой и больше не появляется (localStorage в сторе). */
export function GraphHint() {
  const hintSeen = useGraph((s) => s.hintSeen)
  const dismissHint = useGraph((s) => s.dismissHint)
  // Подсказка лежит в той же полосе, что строка режима связи и список категорий, и закрывала бы их (в том числе «Отмена»).
  const busy = useGraph((s) => s.linkFrom !== null || s.pickerFor !== null)
  const coarse = useMediaQuery('(pointer: coarse)')
  const wide = useMediaQuery('(min-width: 1100px)')
  if (hintSeen || busy) return null

  return (
    <div
      data-graph-ui
      role="note"
      className="px-pop absolute top-2 left-2 z-10 max-w-xs rounded-lg border bg-popover p-3 text-2sm text-popover-foreground shadow-md"
    >
      <p>
        {coarse
          ? 'Двигайте граф пальцем, масштаб — двумя пальцами. Касание открывает запись. '
          : 'Двигайте граф, перетаскивая фон; колесо меняет масштаб. Клик по записи открывает её, перетаскивание — переносит. '}
        {linkText(coarse, wide)}
      </p>
      <div className="mt-2 flex justify-end">
        <Button type="button" variant="outline" size="sm" className="px-btn pointer-coarse:h-9" onClick={dismissHint}>
          Понятно
        </Button>
      </div>
    </div>
  )
}
