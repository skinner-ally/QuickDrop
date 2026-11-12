import type { JSX } from 'react'
import { cn } from '@/lib/utils'
import { compileIcon, snapIconSize, type CompiledIcon } from './compile'
import type { IconName } from './names'
import { PIXEL_ICONS } from './pixel'
import { PALETTE } from './pixel/palette'

const compiled = new Map<IconName, CompiledIcon>()

function getCompiled(name: IconName): CompiledIcon {
  let icon = compiled.get(name)
  if (!icon) {
    icon = compileIcon(PIXEL_ICONS[name], PALETTE)
    compiled.set(name, icon)
  }
  return icon
}

export function PixelIcon({
  name,
  size,
  className,
  'aria-label': ariaLabel,
}: {
  name: IconName
  size?: number
  className?: string
  'aria-label'?: string
}): JSX.Element {
  const icon = getCompiled(name)
  const px = snapIconSize(icon.grid, size)
  return (
    <svg
      className={cn('px-icon shrink-0', className)}
      viewBox={`0 0 ${icon.grid} ${icon.grid}`}
      shapeRendering="crispEdges"
      // размер — inline: он сильнее size-* и правил ui/button, значок всегда остаётся на сетке
      style={{ width: px, height: px }}
      focusable="false"
      {...(ariaLabel ? { role: 'img', 'aria-label': ariaLabel } : { 'aria-hidden': true })}
    >
      {icon.layers.map((layer) => (
        // fill через style: в атрибуте var() ненадёжен
        <path key={layer.fill} d={layer.d} style={{ fill: layer.fill }} />
      ))}
    </svg>
  )
}
