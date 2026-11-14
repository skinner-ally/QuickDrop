/**
 * Цвета графа. Canvas не знает CSS-переменных, поэтому цвета берутся из вычисленных переменных `--graph-*` и
 * `--cat-*` (их значения задают сцены: styles/scenes.css, «Классика» — index.css). В компонентах графа цветов нет.
 */

import { GRAPH_COLOR_KEYS } from '@/lib/graph/types'
import type { GraphColorKey, GraphTheme } from '@/lib/graph/types'

export { GRAPH_COLOR_KEYS }

const clampByte = (n: number): number => (Number.isFinite(n) ? Math.min(255, Math.max(0, Math.round(n))) : 0)

// Порядок байтов Uint32Array поверх ImageData зависит от платформы; проверяется один раз.
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1

/** RGBA → число для Uint32Array поверх ImageData: байты в памяти идут как r, g, b, a на любой платформе. */
export function packRgba(r: number, g: number, b: number, a: number): number {
  const R = clampByte(r)
  const G = clampByte(g)
  const B = clampByte(b)
  const A = clampByte(a)
  return LITTLE_ENDIAN
    ? ((A << 24) | (B << 16) | (G << 8) | R) >>> 0
    : ((R << 24) | (G << 16) | (B << 8) | A) >>> 0
}

/** Чтение цветов: откуда брать значения. Вынесено ради теста соответствия «поле темы ← переменная» без DOM. */
export interface GraphColorReader {
  /** Вычисленный цвет переменной (`--graph-sel` и т.п.) строкой, годной для fillStyle / strokeStyle. */
  css: (cssVar: string) => string
  /** Байты r, g, b, a цвета, заданного строкой. */
  rgba: (css: string) => readonly [number, number, number, number]
}

/** Собирает тему по таблице соответствия переменных (spec-stage5 §3.7). */
export function composeGraphTheme(pixel: boolean, read: GraphColorReader): GraphTheme {
  const css = (v: string): string => read.css(v)
  // Прозрачный цвет (альфа 0) — «этого элемента нет».
  const optional = (v: string): string | null => {
    const c = read.css(v)
    return read.rgba(c)[3] === 0 ? null : c
  }
  const packed = (v: string): number => {
    const [r, g, b, a] = read.rgba(read.css(v))
    return packRgba(r, g, b, a)
  }

  // Относительная яркость по WCAG и контраст двух цветов.
  const lum = (v: string): number => {
    const [r, g, b] = read.rgba(read.css(v)).map((c) => {
      const s = c / 255
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const contrast = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  const ground = lum('--graph-bg')
  const thinVar = contrast(lum('--graph-link'), ground) > contrast(lum('--graph-link-edge'), ground) ? '--graph-link' : '--graph-link-edge'

  const cat = {} as Record<GraphColorKey, string>
  for (const key of GRAPH_COLOR_KEYS) cat[key] = css(`--cat-${key}`)

  return {
    pixel,
    cat,
    nodeEdge: optional('--graph-node-edge'),
    shadow: optional('--graph-shadow'),
    inbox: css('--graph-inbox'),
    inboxEdge: css('--graph-inbox-edge'),
    fav: css('--graph-fav'),
    favEdge: css('--graph-fav-edge'),
    sel: css('--graph-sel'),
    selEdge: optional('--graph-sel-edge'),
    hover: css('--graph-hover'),
    link: packed('--graph-link'),
    linkAlt: packed('--graph-link-alt'),
    linkEdge: packed('--graph-link-edge'),
    linkThin: packed(thinVar),
    linkHot: packed('--graph-link-hot'),
    linkCss: css('--graph-link'),
    linkHotCss: css('--graph-link-hot'),
  }
}

/**
 * Читает цвета графа из вычисленных CSS-переменных элемента. Только в браузере.
 * Каждый цвет разрешается скрытым span внутри root (`color: var(--имя)`; так раскрываются var() и color-mix()),
 * а для буфера связей строка переводится в байты заливкой точки на служебном canvas 1×1.
 */
export function readGraphTheme(root: HTMLElement): GraphTheme {
  const doc = root.ownerDocument
  const pixel = doc.documentElement.classList.contains('pixel')

  const probe = doc.createElement('span')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none'
  root.appendChild(probe)

  const canvas = doc.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const bytes = new Map<string, readonly [number, number, number, number]>()

  const reader: GraphColorReader = {
    css(cssVar) {
      probe.style.color = ''
      probe.style.color = `var(${cssVar})`
      return getComputedStyle(probe).color
    },
    rgba(css) {
      const hit = bytes.get(css)
      if (hit) return hit
      let out: readonly [number, number, number, number]
      if (ctx) {
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillStyle = css
        ctx.fillRect(0, 0, 1, 1)
        const d = ctx.getImageData(0, 0, 1, 1).data
        out = [d[0], d[1], d[2], d[3]]
      } else {
        // Без 2D-контекста (в браузере не бывает) — хотя бы отличаем прозрачное от непрозрачного.
        out = css === 'transparent' || css === 'rgba(0, 0, 0, 0)' ? [0, 0, 0, 0] : [0, 0, 0, 255]
      }
      bytes.set(css, out)
      return out
    },
  }

  try {
    return composeGraphTheme(pixel, reader)
  } finally {
    probe.remove()
    canvas.width = 0
    canvas.height = 0
  }
}

/** Смена сцены, темы или шрифта (класс на <html>) → cb. Возвращает отписку. Вне браузера — пустая отписка. */
export function subscribeGraphTheme(cb: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
  const observer = new MutationObserver(() => cb())
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}
