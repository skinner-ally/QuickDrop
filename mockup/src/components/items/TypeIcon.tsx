import { Icon, type IconName } from '@/components/icons'
import { cn } from '@/lib/utils'
import type { ItemType } from '@/types'

export const TYPE_ICON_NAME: Record<ItemType, IconName> = {
  text: 'type-text',
  link: 'type-link',
  code: 'type-code',
  idea: 'type-idea',
  file: 'type-file',
  image: 'type-image',
}

export function TypeIcon({
  type,
  className,
  size,
  pixelSize,
}: {
  type: ItemType
  className?: string
  size?: number
  pixelSize?: number
}) {
  return <Icon name={TYPE_ICON_NAME[type]} size={size ?? 16} pixelSize={pixelSize} className={cn('shrink-0', className)} />
}
