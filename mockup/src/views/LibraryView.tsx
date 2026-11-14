import { EmptyState } from '@/components/items/EmptyState'
import { Button } from '@/components/ui/button'
import { useUi } from '@/store/ui'
import { ItemsView } from './ItemsView'

export function LibraryView() {
  const setView = useUi((s) => s.setView)
  return (
    <ItemsView
      title="База знаний"
      base={{ status: 'library' }}
      variant="library"
      emptyState={
        <EmptyState
          icon="library"
          title="Здесь появятся разобранные записи"
          description="Разбирайте входящие: записи, перенесённые в базу знаний, остаются здесь навсегда."
          action={
            <Button variant="outline" size="sm" onClick={() => setView('inbox')}>
              Перейти во входящие
            </Button>
          }
        />
      }
    />
  )
}
