import { EmptyState } from '@/components/items/EmptyState'
import { ItemsView } from './ItemsView'

export function ArchiveView() {
  return (
    <ItemsView
      title="Архив"
      subtitle="Записи в архиве не показываются в поиске по базе, но не удаляются"
      base={{ status: 'archive' }}
      variant="archive"
      emptyState={
        <EmptyState
          icon="archive"
          title="Архив пуст"
          description="Сюда попадают записи, которые больше не нужны на виду. Их можно вернуть в любой момент."
        />
      }
    />
  )
}
