import { useEffect } from 'react'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppShell } from '@/components/layout/AppShell'
import { ThemeProvider } from '@/components/layout/ThemeProvider'
import { seedDemoData } from '@/db/seed'

// Модульный флаг: StrictMode монтирует эффект дважды, а засев должен случиться один раз.
let seeding: Promise<unknown> | undefined

export default function App() {
  useEffect(() => {
    seeding ??= seedDemoData().catch((e: unknown) => {
      toast.error(e instanceof Error ? e.message : 'Не удалось загрузить демоданные')
    })
  }, [])

  return (
    <ThemeProvider>
      <TooltipProvider delay={400}>
        <AppShell />
        <Toaster position="bottom-center" />
      </TooltipProvider>
    </ThemeProvider>
  )
}
