import { useEffect } from 'react'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ErrorBoundary, StorageErrorFallback } from '@/components/layout/ErrorBoundary'
import { AppShell } from '@/components/layout/AppShell'
import { ThemeProvider } from '@/components/layout/ThemeProvider'
import { seedDemoData } from '@/db/seed'
import { describeError } from '@/lib/errors'

// Модульный флаг: StrictMode монтирует эффект дважды, а засев должен случиться один раз.
let seeding: Promise<unknown> | undefined

export default function App() {
  useEffect(() => {
    seeding ??= seedDemoData().catch((e: unknown) => {
      toast.error(describeError(e, 'Не удалось загрузить демоданные'))
    })
  }, [])

  return (
    // Граница выше ThemeProvider: он сам читает настройки из БД (useLiveQuery) и падает первым.
    <ErrorBoundary fallback={(error) => <StorageErrorFallback error={error} />}>
      <ThemeProvider>
        <TooltipProvider delay={400}>
          <AppShell />
          <Toaster position="bottom-center" />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}
