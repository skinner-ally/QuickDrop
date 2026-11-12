// Уведомление MIT pixelfx в сборке (код pixelfx попадает только в чанк графа через живой фон).
// Шапку /*! … */ из math.ts минимизатор Vite срезает, поэтому носитель текста в dist — файл из public/licenses.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const text = (rel: string): string => readFileSync(root + rel, 'utf8').replace(/\r\n/g, '\n')
const PUBLIC_COPY = 'public/licenses/pixelfx-LICENSE.txt'

describe('лицензия pixelfx в сборке', () => {
  it('копия в public есть и совпадает с src/lib/pixelfx/LICENSE', () => {
    expect(existsSync(root + PUBLIC_COPY)).toBe(true)
    const copy = text(PUBLIC_COPY)
    expect(copy).toContain('Permission is hereby granted')
    expect(copy).toBe(text('src/lib/pixelfx/LICENSE'))
  })

  it('PWA кэширует txt и не подменяет /licenses/ оболочкой приложения', () => {
    const cfg = text('vite.config.ts')
    const glob = /globPatterns:\s*\[\s*'([^']+)'/.exec(cfg)?.[1] ?? ''
    expect(glob).toMatch(/[{,]txt[,}]/)
    expect(cfg).toMatch(/navigateFallbackDenylist:\s*\[[^\]]*\/licenses\\\//)
  })
})
