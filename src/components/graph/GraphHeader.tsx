export interface GraphHeaderProps {
  /** Нод в сцене (с учётом переключателя «Архив»). */
  total: number
  /** Нод, проходящих отбор. */
  matched: number
  /** Связей между нодами сцены. */
  links: number
  /** Задан ли отбор (поиск или фильтры). */
  filtered: boolean
}

/** Заголовок раздела «Граф»: по образцу заголовка ItemsView. */
export function GraphHeader({ total, matched, links, filtered }: GraphHeaderProps) {
  return (
    <header className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-2">
        <h1 className="shrink-0 font-heading text-lg font-semibold tracking-tight pixel:text-2xl pixel:tracking-normal">Граф</h1>
        {/* Счётчик не рвётся на две строки, когда колонка узкая (открыта панель деталей): раньше сжимается подсказка клавиш. */}
        {total > 0 && (
          <span className="shrink-0 text-2sm whitespace-nowrap text-muted-foreground tabular-nums" aria-live="polite">
            {filtered ? `подходит ${matched} из ${total}` : `${total} · связей: ${links}`}
          </span>
        )}
        <span className="ml-auto hidden min-w-0 shrink truncate text-2sm text-muted-foreground pixel:lg:pointer-fine:inline">
          Колесо — масштаб · E — категория · L — связь · 0 — весь граф
        </span>
      </div>
    </header>
  )
}
