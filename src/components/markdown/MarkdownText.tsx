import { Suspense, useEffect, useState, type ReactElement } from 'react'
import { AutoLinkText } from '@/components/items/detail/AutoLinkText'
import { ErrorBoundary, lazyRetry } from '@/components/layout/ErrorBoundary'
import { MD_RENDER_MAX } from '@/lib/markdown'
// Только тип: обычный импорт склеил бы тяжёлый чанк MarkdownView (react-markdown, remark-gfm) с основным.
import type { MarkdownViewProps } from './MarkdownView'

/** Чанк не загрузился (а не сбой отрисовки): React.lazy запоминает отказ, для повтора нужен новый lazy. */
let loadFailed = false
const loadView = () =>
  import('./MarkdownView').then(
    (m) => {
      loadFailed = false
      return m
    },
    (e: unknown) => {
      loadFailed = true
      throw e
    },
  )
const view = lazyRetry(() => loadView(), (m) => m.MarkdownView)

// Догрузка в простое: к первому открытию записи просмотр уже готов.
if (typeof window !== 'undefined') window.setTimeout(() => void loadView().catch(() => undefined), 2500)

export type MarkdownTextProps = MarkdownViewProps

function Plain({ source, className }: { source: string; className?: string }) {
  return className ? (
    <div className={className}>
      <AutoLinkText text={source} />
    </div>
  ) : (
    <AutoLinkText text={source} />
  )
}

/** Запасной вид после сбоя; сообщает, на каком тексте случился сбой. */
function Failed({ source, className, onShown }: { source: string; className?: string; onShown: (source: string) => void }) {
  useEffect(() => {
    // Не загрузился чанк — следующая граница (после смены текста) попробует загрузить его заново.
    if (loadFailed) {
      loadFailed = false
      view.reset()
    }
    onShown(source)
  }, [source, onShown])
  return <Plain source={source} className={className} />
}

/**
 * Markdown с ленивой загрузкой. Пока грузится, при сбое и при тексте длиннее MD_RENDER_MAX — обычный текст
 * со ссылками (AutoLinkText).
 */
export function MarkdownText(props: MarkdownTextProps): ReactElement {
  const { source, className } = props
  // Текст, на котором граница поймала сбой, и номер границы: ErrorBoundary сам не сбрасывается, а
  // исправленный текст иначе так и остался бы исходником. Сменился текст после сбоя — новая граница.
  const [failedAt, setFailedAt] = useState<string | null>(null)
  const [epoch, setEpoch] = useState(0)
  if (failedAt !== null && failedAt !== source) {
    setFailedAt(null)
    setEpoch((n) => n + 1)
  }

  if (source.length > MD_RENDER_MAX) {
    return (
      <>
        <p className="mb-1 text-xs text-muted-foreground">Текст слишком длинный для просмотра с разметкой — показан исходник</p>
        <Plain source={source} className={className} />
      </>
    )
  }
  return (
    <ErrorBoundary
      key={epoch}
      fallback={() => <Failed source={source} className={className} onShown={setFailedAt} />}
    >
      <Suspense fallback={<Plain source={source} className={className} />}>
        <view.Component {...props} />
      </Suspense>
    </ErrorBoundary>
  )
}
