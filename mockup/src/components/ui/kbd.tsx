import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * Подсказка клавиши. tone="muted" — на обычном фоне, tone="inherit" — внутри цветной кнопки
 * (рамка и текст наследуют цвет родителя).
 */
export function Kbd({
  tone = 'muted',
  className,
  ...props
}: ComponentProps<'kbd'> & { tone?: 'muted' | 'inherit' }) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-mono text-[11px] leading-4 select-none',
        tone === 'muted'
          ? 'border-border bg-muted text-muted-foreground'
          : 'border-current/25 bg-transparent opacity-70',
        className,
      )}
      {...props}
    />
  )
}
