import type { Settings } from '@/types'

/**
 * Что записать при переключении «Включить ИИ-помощника». Если автораспознавание было включено раньше, при
 * включении ИИ момент aiAutoOcrSince сдвигается: записи, добавленные, пока помощник был выключен, не уходят
 * в сеть задним числом (иначе возврат ИИ молча отправил бы накопленное).
 */
export function aiEnabledPatch(
  settings: Pick<Settings, 'aiAutoOcr'>,
  on: boolean,
  now: number,
): Partial<Pick<Settings, 'aiEnabled' | 'aiAutoOcrSince'>> {
  return on && settings.aiAutoOcr ? { aiEnabled: true, aiAutoOcrSince: now } : { aiEnabled: on }
}
