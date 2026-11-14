import { useSyncExternalStore } from 'react'

// Сцену узнаём по классу на <html>, а не из контекста: значок обязан работать и вне ThemeProvider
// (экран ошибки). Наблюдатель один на всё приложение — значков на странице сотни.
const listeners = new Set<() => void>()
let observer: MutationObserver | undefined

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  if (!observer) {
    observer = new MutationObserver(() => {
      for (const listener of listeners) listener()
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  }
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0) {
      observer?.disconnect()
      observer = undefined
    }
  }
}

const getSnapshot = () => document.documentElement.classList.contains('pixel')
const getServerSnapshot = () => false

/** true в пиксельных сценах (класс `pixel` на <html>). */
export function usePixel(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
