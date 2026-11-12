/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Через fs: vitest отдаёт ?raw у css пустым. Путь от корня проекта — тесты запускаются из него.
const css = readFileSync('src/styles/markdown.css', 'utf-8')

describe('markdown.css', () => {
  it('отступ внутри li/blockquote/td не задаётся любому соседу (только блочным)', () => {
    expect(css).not.toMatch(/:is\(li, blockquote, td\) > \* \+ \*\s*[,{]/)
  })

  it('у .qd-md нет overflow-wrap: anywhere (ломает прокрутку таблиц)', () => {
    expect(css).not.toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('высота строки пиксельных сцен лежит в слое: утилита leading-* её перекрывает', () => {
    // с отступом — значит внутри @layer components; вне слоя правило стояло бы в начале строки
    expect(css).toMatch(/^[ \t]+\.pixel \.qd-md \{ line-height: inherit; \}/m)
    expect(css).not.toMatch(/^\.pixel \.qd-md \{ line-height/m)
  })
})
