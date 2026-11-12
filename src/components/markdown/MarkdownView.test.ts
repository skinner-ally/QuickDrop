import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownView } from './MarkdownView'

const render = (source: string, onChange?: (s: string) => void) =>
  renderToStaticMarkup(createElement(MarkdownView, { source, onChange }))

const labels = (html: string) => Array.from(html.matchAll(/aria-label="([^"]*)"/g), (m) => m[1])

describe('MarkdownView: подпись флажков задач', () => {
  const src = '- [ ] купить хлеб\n  - [ ] вложенная\n- [x] позвонить'

  it('кликабельные: подпись из текста пункта без подпунктов', () => {
    const l = labels(render(src, () => {}))
    expect(l).toEqual(['купить хлеб', 'вложенная', 'позвонить'])
  })

  it('только для чтения: те же подписи и aria-readonly', () => {
    const html = render(src)
    expect(labels(html)).toEqual(['купить хлеб', 'вложенная', 'позвонить'])
    expect(html).toContain('aria-readonly="true"')
  })

  it('длинный текст обрезается до 120 символов с многоточием', () => {
    const l = labels(render('- [ ] ' + 'я'.repeat(200), () => {}))
    expect(l[0].length).toBeLessThanOrEqual(120)
    expect(l[0].endsWith('…')).toBe(true)
  })
})
