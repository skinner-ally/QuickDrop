import { memo, type JSX } from 'react'
import type { IconName } from './names'
import { PixelIcon } from './PixelIcon'
import { LUCIDE } from './registry'
import { usePixel } from './usePixel'

export interface IconProps {
  name: IconName
  /** px. «Классика»: передаётся lucide только если задан (иначе размер, как сейчас, задаёт CSS). Пиксели: привязка к сетке, по умолчанию 16/20. */
  size?: number
  /** Размер только в пиксельных сценах (px, привязка к сетке). Не задан — берётся `size`. В «Классике» игнорируется. */
  pixelSize?: number
  className?: string
  /** Только «Классика». По умолчанию 1.75. */
  strokeWidth?: number
  /** Есть — role="img" и подпись; нет — aria-hidden. */
  'aria-label'?: string
}

function IconImpl({
  name,
  size,
  pixelSize,
  className,
  strokeWidth,
  'aria-label': ariaLabel,
}: IconProps): JSX.Element {
  const pixel = usePixel()
  if (pixel) {
    return <PixelIcon name={name} size={pixelSize ?? size} className={className} aria-label={ariaLabel} />
  }
  const Lucide = LUCIDE[name]
  return (
    <Lucide
      // undefined для lucide равносилен отсутствию пропа: остаётся его размер по умолчанию, а правит его CSS
      size={size}
      strokeWidth={strokeWidth ?? 1.75}
      className={className}
      {...(ariaLabel ? { role: 'img', 'aria-label': ariaLabel } : { 'aria-hidden': true })}
    />
  )
}

export const Icon = memo(IconImpl)
