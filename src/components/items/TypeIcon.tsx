import { AlignLeft, Code2, Image, Lightbulb, Link2, Paperclip, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ItemType } from '@/types'

export const TYPE_ICONS: Record<ItemType, LucideIcon> = {
  text: AlignLeft,
  link: Link2,
  code: Code2,
  idea: Lightbulb,
  file: Paperclip,
  image: Image,
}

export function TypeIcon({ type, className }: { type: ItemType; className?: string }) {
  const Icon = TYPE_ICONS[type]
  return <Icon size={16} strokeWidth={1.75} aria-hidden className={cn('shrink-0', className)} />
}
