import type { GraphOverlayProps } from '@/components/graph/GraphOverlay'
import { STATUS_LABEL } from '@/components/graph/GraphTooltip'
import { TYPE_LABEL } from '@/lib/itemTitle'
import { useGraph } from '@/store/graph'
import { useUi } from '@/store/ui'

export const GRAPH_A11Y_HELP_ID = 'graph-a11y-help'

const HELP =
  'Стрелки — переход между записями, Tab — по связям записи (после последней связи фокус уходит дальше по странице), Enter — открыть, Esc — снять курсор, Shift+F10 — действия с записью, E — категория, L — связать, A — в архив, F — избранное, Delete — в корзину, плюс и минус — масштаб, ноль — весь граф.'

/**
 * Для экранного диктора: справка по клавишам (на неё ссылается aria-describedby сцены) и одна «живая» строка
 * с описанием ноды под курсором клавиатуры. Списка из тысяч скрытых элементов нет.
 */
export function GraphA11y({ scene, items, categories }: GraphOverlayProps) {
  const cursorId = useGraph((s) => s.cursorId)
  const selectedId = useUi((s) => s.selectedId)
  const targetId = cursorId ?? selectedId
  const linking = useGraph((s) => s.linkFrom !== null)

  const index = targetId !== null ? scene.byId.get(targetId) : undefined
  const item = targetId !== null ? items.get(targetId) : undefined
  let text = ''
  if (index !== undefined && item) {
    const node = scene.nodes[index]
    const category = item.categoryId ? categories.find((c) => c.id === item.categoryId) : undefined
    text =
      `${node.title}. ${TYPE_LABEL[item.type]}. ` +
      `Категория: ${category ? category.name : 'без категории'}. ${STATUS_LABEL[item.status]}. ` +
      `Связей: ${node.links.length}.`
  }
  if (linking) text = text ? `Выберите запись для связи. ${text}` : 'Выберите запись для связи'

  return (
    <>
      <p id={GRAPH_A11Y_HELP_ID} className="sr-only">
        {HELP}
      </p>
      <div aria-live="polite" className="sr-only">
        {text}
      </div>
    </>
  )
}
