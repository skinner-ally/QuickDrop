import { GraphA11y } from '@/components/graph/GraphA11y'
import { GraphCategoryPicker } from '@/components/graph/GraphCategoryPicker'
import { GraphLabels } from '@/components/graph/GraphLabels'
import { GraphLinkTools } from '@/components/graph/GraphLinkTools'
import { GraphNodeMenu } from '@/components/graph/GraphNodeMenu'
import { GraphTooltip } from '@/components/graph/GraphTooltip'
import type { GraphScene } from '@/lib/graph/types'
import type { Category, Item } from '@/types'

export interface GraphOverlayProps {
  scene: GraphScene
  /** Записи графа по id (для подсказки, меню, выбора категории и описания диктору). */
  items: ReadonlyMap<string, Item>
  categories: readonly Category[]
}

/**
 * DOM-слой поверх canvas: подписи, подсказка, меню ноды, выбор категории, ручка и плашка связи, строка для диктора.
 * overflow-clip, а не hidden: слой не скролл-контейнер, и focus() внутри не сдвинет подписи относительно canvas.
 * Сам слой не ловит указатель; интерактивные дети включают его себе (`pointer-events-auto`, `data-graph-ui`).
 */
export function GraphOverlay(props: GraphOverlayProps) {
  return (
    <div data-graph-overlay className="pointer-events-none absolute inset-0 overflow-clip">
      <GraphLabels {...props} />
      <GraphLinkTools {...props} />
      <GraphTooltip {...props} />
      <GraphCategoryPicker {...props} />
      <GraphNodeMenu {...props} />
      <GraphA11y {...props} />
    </div>
  )
}
