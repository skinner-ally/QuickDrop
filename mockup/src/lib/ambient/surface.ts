/**
 * Поверхность движка фона на отдельном canvas (spec-stage6 §6.1): растр Uint32Array выгружается putImageData,
 * затем сводится в back/front через drawImage. Модуль трогает DOM только при создании поверхности.
 */

import type { Surface } from '@/lib/ambient/engine'

/**
 * onRestored — контекст canvas восстановлен после потери (сброс драйвера, падение GPU-процесса WebView2): ускоренный
 * canvas при этом очищен, хотя кэш считает плитку готовой. Слушается только `contextrestored`: перерисовка по
 * `contextlost` ушла бы в ещё не восстановленный контекст.
 */
export function createCanvasSurface(w: number, h: number, onRestored?: () => void): Surface {
  const canvas = document.createElement('canvas')
  const cw = Math.max(0, Math.floor(w))
  const ch = Math.max(0, Math.floor(h))
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  const restored = onRestored ? () => onRestored() : null
  if (restored) canvas.addEventListener('contextrestored', restored)
  return {
    source: canvas,
    w: cw,
    h: ch,
    put: (data) => {
      if (!ctx || cw === 0 || ch === 0 || data.length < cw * ch) return
      const bytes = new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, cw * ch * 4)
      ctx.putImageData(new ImageData(bytes, cw, ch), 0, 0)
    },
    // Нулевой размер сразу отдаёт память растра, не дожидаясь сборщика мусора.
    release: () => {
      if (restored) canvas.removeEventListener('contextrestored', restored)
      canvas.width = 0
      canvas.height = 0
    },
  }
}
