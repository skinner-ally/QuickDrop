import { EmptyState } from '@/components/items/EmptyState'
import { ItemsView } from './ItemsView'

export function FavoritesView() {
  return (
    <ItemsView
      title="Избранное"
      base={{ favorite: true, status: ['inbox', 'library'] }}
      variant="favorites"
      emptyState={
        <EmptyState
          icon="star"
          title="Избранного пока нет"
          description={
            <>
              Отмечайте звёздочкой записи, к которым нужен быстрый доступ
              <span className="pointer-coarse:hidden">, или нажмите F в списке</span>.
            </>
          }
        />
      }
    />
  )
}
