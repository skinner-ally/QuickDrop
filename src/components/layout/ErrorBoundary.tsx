import { Component, createElement, lazy, type ComponentType, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  /** Что показать при ошибке; reset сбрасывает границу и рендерит детей заново. */
  fallback: (error: Error, reset: () => void) => ReactNode
  /** Вызывается при сбросе (например, чтобы пересоздать lazy-компонент). */
  onReset?: () => void
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Классовая граница ошибок: React пока не даёт хуков для этого. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('QuickDrop: ошибка отрисовки', error, info.componentStack)
  }

  reset = (): void => {
    this.props.onReset?.()
    this.setState({ error: null })
  }

  render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error, this.reset) : this.props.children
  }
}

/** Фолбэк верхнего уровня: не зависит ни от БД, ни от ThemeProvider, ни от Toaster. */
export function StorageErrorFallback({ error }: { error: Error }) {
  return (
    <div role="alert" className="flex min-h-dvh w-full items-center justify-center bg-background p-6 text-foreground">
      <div className="flex max-w-md flex-col gap-3">
        <h1 className="text-lg font-semibold tracking-tight">Не удалось открыть локальное хранилище</h1>
        <p className="text-sm text-muted-foreground">
          Проверьте, что в браузере разрешено хранение данных сайта (не приватный режим, cookie не заблокированы) и на
          диске есть место.
        </p>
        <p className="font-mono text-xs break-words text-muted-foreground">
          {error.name}: {error.message}
        </p>
        <div>
          <button
            type="button"
            className="h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"
            onClick={() => window.location.reload()}
          >
            Перезагрузить
          </button>
        </div>
      </div>
    </div>
  )
}

/** Небольшой фолбэк для сбоя загрузки ленивого куска интерфейса. */
export function RetryFallback({ message, reset }: { message: string; reset: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-2 p-4 text-sm">
      <p className="text-muted-foreground">{message}</p>
      <button type="button" className="h-8 rounded-lg border px-3 text-sm font-medium" onClick={reset}>
        Повторить
      </button>
    </div>
  )
}

/**
 * React.lazy кеширует отказ, поэтому для «Повторить» нужен новый lazy-компонент:
 * reset() пересоздаёт его. Сам import() повторяется один раз после короткой паузы.
 */
export function lazyRetry<M, P extends object>(importer: () => Promise<M>, pick: (m: M) => ComponentType<P>) {
  const load = async (): Promise<{ default: ComponentType<P> }> => {
    let m: M
    try {
      m = await importer()
    } catch {
      await new Promise((r) => window.setTimeout(r, 400))
      m = await importer()
    }
    return { default: pick(m) }
  }
  let Inner = lazy(load)
  const reset = (): void => {
    Inner = lazy(load)
  }
  const Component = (props: P) => createElement(Inner as ComponentType<P>, props)
  return { Component, reset }
}
