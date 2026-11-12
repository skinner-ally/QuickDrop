import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EmptyState } from './EmptyState'

describe('EmptyState', () => {
  it('неизвестное имя значка не роняет отрисовку', () => {
    // @ts-expect-error опечатка в имени — компилятор её ловит
    const html = renderToStaticMarkup(createElement(EmptyState, { icon: 'serach-x', title: 'Пусто' }))
    expect(html).toContain('Пусто')
    expect(html).not.toContain('<svg')
  })

  it('известное имя рисует значок', () => {
    const html = renderToStaticMarkup(createElement(EmptyState, { icon: 'inbox', title: 'Пусто' }))
    expect(html).toContain('<svg')
  })
})
