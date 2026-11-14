import type { PixelMap } from '../compile'
import type { IconName } from '../names'
import { FILE_PIXELS } from './files'
import { TYPE_PIXELS } from './type'
import { UI_PIXELS } from './ui'

/** Карты пикселей всех значков. Полноту проверяет тип, отсутствие лишних ключей — тест. */
export const PIXEL_ICONS: Record<IconName, PixelMap> = {
  ...TYPE_PIXELS,
  ...UI_PIXELS,
  ...FILE_PIXELS,
}
