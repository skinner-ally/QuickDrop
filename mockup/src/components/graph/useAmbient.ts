import { useEffect, useState, useSyncExternalStore } from 'react'
import { useScene } from '@/components/layout/ThemeProvider'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { createAmbientController } from '@/lib/ambient/controller'

function subscribeVisibility(cb: () => void): () => void {
  document.addEventListener('visibilitychange', cb)
  return () => document.removeEventListener('visibilitychange', cb)
}

const isVisible = (): boolean => document.visibilityState === 'visible'

/**
 * Живой фон графа (spec-stage6 §6.3): режим по условиям — сцена графа есть, «Живой фон» включён, сцена не «Классика»,
 * окно видно, нет prefers-reduced-motion. stage === null — фона нет (раздел ушёл или данные ещё не загружены).
 * Режим пишется в data-ambient-mode сцены (приёмка, отладка).
 */
export function useAmbient(stage: HTMLElement | null): void {
  const { resolvedScene, pixel, ambient } = useScene()
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, () => true)
  const [controller] = useState(() => createAmbientController())

  useEffect(() => {
    controller.update({ stage: stage !== null, visible, reducedMotion, enabled: ambient, pixel, scene: resolvedScene })
    if (stage) stage.dataset.ambientMode = controller.mode
  }, [controller, stage, visible, reducedMotion, ambient, pixel, resolvedScene])

  useEffect(() => {
    if (!stage) return
    return () => {
      delete stage.dataset.ambientMode
    }
  }, [stage])

  // Уход из раздела: слой снимается, память кэша плиток освобождается.
  useEffect(() => () => controller.dispose(), [controller])
}
