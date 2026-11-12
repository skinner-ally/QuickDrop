import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { describe, expect, it } from 'vitest'
import {
  isMarkdownFile,
  mdUrlTransform,
  MD_RENDER_MAX,
  openableLinkUrl,
  parseWikiHref,
  remarkSoftBreaks,
  remarkWikiLinks,
  toggleTaskAt,
  wikiHref,
  WIKI_SCHEME,
} from './markdown'
import { parseWikiLinks } from './wikiLinks'

/** Отрисовка тем же набором плагинов, что у MarkdownView, но с простыми зондами вместо компонентов проекта. */
function render(source: string, components: Components = {}): string {
  return renderToStaticMarkup(
    createElement(
      Markdown,
      { remarkPlugins: [remarkGfm, remarkWikiLinks, remarkSoftBreaks], urlTransform: mdUrlTransform, components },
      source,
    ),
  )
}

/** Позиции пунктов-задач в исходнике, как их видит компонент li. */
function taskOffsets(source: string): number[] {
  const offsets: number[] = []
  render(source, {
    li: ({ node, className, children }) => {
      if (className?.includes('task-list-item')) {
        const offset = node?.position?.start.offset
        if (offset !== undefined) offsets.push(offset)
      }
      return createElement('li', { className }, children)
    },
  })
  return offsets
}

/** Флажки задач в исходнике по порядку: true — отмечена. */
function checks(source: string): boolean[] {
  return [...source.matchAll(/\[([ xX])\]/g)].map((m) => m[1] !== ' ')
}

/** href всех ссылок, которые получил зонд a, и их текст. */
function links(source: string): Array<{ href: string | undefined; text: string }> {
  const out: Array<{ href: string | undefined; text: string }> = []
  const html = render(source, {
    a: ({ href, children }) => {
      out.push({ href, text: '' })
      return createElement('a', { href, 'data-probe': out.length - 1 }, children)
    },
  })
  // Текст ссылки — из разметки: дети зонда могут быть элементами.
  for (const m of html.matchAll(/<a[^>]*data-probe="(\d+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    out[Number(m[1])].text = m[2].replace(/<[^>]+>/g, '')
  }
  return out
}

describe('toggleTaskAt', () => {
  function toggleEach(source: string): string[] {
    return taskOffsets(source).map((offset) => {
      const next = toggleTaskAt(source, offset)
      expect(next).not.toBeNull()
      return next as string
    })
  }

  it('переключает ровно свой флажок в простом списке', () => {
    const source = '- [ ] один\n- [x] два\n- [X] три\n'
    const results = toggleEach(source)
    expect(results).toHaveLength(3)
    expect(checks(results[0])).toEqual([true, true, true])
    expect(checks(results[1])).toEqual([false, false, true])
    expect(checks(results[2])).toEqual([false, true, false])
    // Всё, кроме флажка, — байт в байт.
    expect(results[0]).toBe('- [x] один\n- [x] два\n- [X] три\n')
  })

  it('вложенные списки, звёздочка и плюс', () => {
    const source = '* [ ] верх\n  * [X] вложенный\n    + [ ] глубже\n* [x] второй\n'
    const offsets = taskOffsets(source)
    expect(offsets).toHaveLength(4)
    const flags = checks(source)
    offsets.forEach((offset, i) => {
      const expected = [...flags]
      expected[i] = !expected[i]
      expect(checks(toggleTaskAt(source, offset) as string)).toEqual(expected)
    })
  })

  it('цитата и нумерованный список', () => {
    const source = '> - [ ] в цитате\n> - [x] ещё\n\n1. [ ] первый\n2) [x] второй\n10. [ ] десятый\n'
    const offsets = taskOffsets(source)
    expect(offsets).toHaveLength(5)
    const flags = checks(source)
    offsets.forEach((offset, i) => {
      const expected = [...flags]
      expected[i] = !expected[i]
      expect(checks(toggleTaskAt(source, offset) as string)).toEqual(expected)
    })
  })

  it('CRLF сохраняется', () => {
    const source = '- [ ] один\r\n- [x] два\r\n\r\nтекст\r\n'
    const offsets = taskOffsets(source)
    expect(offsets).toHaveLength(2)
    expect(toggleTaskAt(source, offsets[0])).toBe('- [x] один\r\n- [x] два\r\n\r\nтекст\r\n')
    expect(toggleTaskAt(source, offsets[1])).toBe('- [ ] один\r\n- [ ] два\r\n\r\nтекст\r\n')
  })

  it('пункты в ограде кода и пустые «- [ ]» задачами не являются', () => {
    const source = '```\n- [ ] в коде\n```\n\n- [ ]\n- [ ] \n- [ ] настоящая\n'
    const offsets = taskOffsets(source)
    expect(offsets).toHaveLength(1)
    const next = toggleTaskAt(source, offsets[0]) as string
    expect(next).toBe('```\n- [ ] в коде\n```\n\n- [ ]\n- [ ] \n- [x] настоящая\n')
  })

  it('неверный offset → null', () => {
    const source = '- [ ] задача\nпросто текст\n'
    expect(toggleTaskAt(source, 2)).toBeNull()
    expect(toggleTaskAt(source, source.indexOf('просто'))).toBeNull()
    expect(toggleTaskAt(source, -1)).toBeNull()
    expect(toggleTaskAt(source, source.length)).toBeNull()
    expect(toggleTaskAt(source, 1.5)).toBeNull()
    expect(toggleTaskAt('', 0)).toBeNull()
    expect(toggleTaskAt('- [?] нет', 0)).toBeNull()
  })

  it('offset с отступом перед маркером', () => {
    expect(toggleTaskAt('  - [ ] a', 0)).toBe('  - [x] a')
    expect(toggleTaskAt('-\t[x] a', 0)).toBe('-\t[ ] a')
  })

  /**
   * Каждая задача, которую нарисовал просмотр, переключается одним символом — своим флажком:
   * у разных задач флажки разные, строка с notTask не меняется никогда.
   */
  function expectEachToggles(source: string, count: number, notTask?: string): void {
    const offsets = taskOffsets(source)
    expect(offsets).toHaveLength(count)
    const changed = offsets.map((offset) => {
      const next = toggleTaskAt(source, offset)
      expect(next).not.toBeNull()
      expect((next as string).length).toBe(source.length)
      const diff: number[] = []
      for (let i = 0; i < source.length; i++) if ((next as string)[i] !== source[i]) diff.push(i)
      expect(diff).toHaveLength(1)
      expect(source[diff[0] - 1]).toBe('[')
      expect(source[diff[0] + 1]).toBe(']')
      // флажок — в строке своего пункта или на следующей
      expect(diff[0]).toBeGreaterThan(offset)
      if (notTask) {
        const lineStart = source.lastIndexOf('\n', diff[0]) + 1
        const lineEnd = source.indexOf('\n', diff[0])
        expect(source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)).not.toContain(notTask)
      }
      return diff[0]
    })
    expect(new Set(changed).size).toBe(count)
  }

  it('BOM в начале текста: позиции разбора без него, флажок всё равно находится', () => {
    const source = '﻿- [ ] a\n- [x] b\n'
    expectEachToggles(source, 2)
    expect(toggleTaskAt(source, taskOffsets(source)[0])).toBe('﻿- [x] a\n- [x] b\n')
    expectEachToggles('﻿текст\n\n- [ ] a\n', 1)
    // offset за последним символом — не задача и с BOM
    expect(toggleTaskAt('﻿- [ ] a', 8)).toBeNull()
  })

  it('флажок на следующей строке после маркера', () => {
    expectEachToggles('-\n  [ ] текст\n- [x] второй\n', 2)
    expectEachToggles('1.\n   [x] текст\n', 1)
    expectEachToggles('-\r\n  [ ] текст\r\n', 1)
    expectEachToggles('> -\n>   [ ] в цитате\n', 1)
    expect(toggleTaskAt('-\n  [ ] текст', 0)).toBe('-\n  [x] текст')
  })

  it('вложенные списки с CRLF, цитата в пункте, код в пункте', () => {
    expectEachToggles('- [ ] a\r\n  - [x] b\r\n    - [ ] c\r\n', 3)
    expectEachToggles('- [ ] a\n\n  > - [x] в цитате\n\n- [ ] b\n', 3)
    // ограда кода внутри пункта: «- [ ]» в ней — не задача
    expectEachToggles('- [ ] a\n  ```\n  - [ ] не задача\n  ```\n- [x] b\n', 2, 'не задача')
    // код с отступом: тоже не задача
    expectEachToggles('текст\n\n    - [ ] не задача\n\n- [ ] задача\n', 1, 'не задача')
  })

  it('пункт без флажка и флажок не в начале — не задача', () => {
    const source = '- просто [ ] текст\n-\n\n  [ ] после пустой строки\n'
    expect(taskOffsets(source)).toEqual([])
    expect(toggleTaskAt(source, 0)).toBeNull()
    expect(toggleTaskAt(source, source.indexOf('-\n'))).toBeNull()
  })
})

describe('вики-ссылки', () => {
  it('wikiHref ↔ parseWikiHref', () => {
    for (const target of ['План', 'c++', 'a (b) [c]', 'x/y?z#w', '100% & ё', 'пробел в конце ']) {
      expect(wikiHref(target).startsWith(WIKI_SCHEME)).toBe(true)
      expect(parseWikiHref(wikiHref(target))).toBe(target)
    }
    expect(parseWikiHref(undefined)).toBeNull()
    expect(parseWikiHref('https://example.com')).toBeNull()
    expect(parseWikiHref(`${WIKI_SCHEME}%E0%A4%A`)).toBeNull()
    expect(parseWikiHref(WIKI_SCHEME)).toBeNull()
  })

  it('простая и с подписью', () => {
    expect(links('см. [[План на год]] тут')).toEqual([{ href: wikiHref('План на год'), text: 'План на год' }])
    expect(links('[[  Цель  |  Подпись ]]')).toEqual([{ href: wikiHref('Цель'), text: 'Подпись' }])
    expect(links('[[Цель|]]')).toEqual([{ href: wikiHref('Цель'), text: 'Цель' }])
  })

  it('несколько в строке и текст между ними сохраняется', () => {
    const html = render('до [[a]] между [[b|бэ]] после')
    expect(links('до [[a]] между [[b|бэ]] после')).toEqual([
      { href: wikiHref('a'), text: 'a' },
      { href: wikiHref('b'), text: 'бэ' },
    ])
    expect(html.replace(/<[^>]+>/g, '')).toBe('до a между бэ после')
  })

  it('в таблице через \\| — одна ячейка, цель и подпись', () => {
    const source = '| Запись | Ещё |\n| --- | --- |\n| [[x\\|y]] | 2 |\n'
    const html = render(source)
    expect(html.match(/<td>/g)).toHaveLength(2)
    expect(links(source)).toEqual([{ href: wikiHref('x'), text: 'y' }])
  })

  it('\\| в абзаце тоже разделяет цель и подпись', () => {
    expect(links('[[p\\|q]]')).toEqual([{ href: wikiHref('p'), text: 'q' }])
  })

  it('не в коде и не внутри обычной ссылки', () => {
    expect(links('`[[a]]`')).toEqual([])
    expect(links('```\n[[a]]\n```')).toEqual([])
    expect(links('    [[a]]')).toEqual([])
    expect(links('[текст [[a]] ещё](https://example.com)')).toEqual([
      { href: 'https://example.com', text: 'текст [[a]] ещё' },
    ])
  })

  it('пустая, слишком длинная и с переводом строки — не ссылки', () => {
    expect(links('[[]] [[  ]] [[|x]]')).toEqual([])
    expect(links(`[[${'a'.repeat(201)}]]`)).toEqual([])
    expect(links(`[[${'a'.repeat(200)}]]`)).toHaveLength(1)
    expect(links('[[a\nb]]')).toEqual([])
  })

  describe('просмотр и parseWikiLinks видят одни и те же ссылки', () => {
    /** Цели вики-ссылок, которые нарисовал просмотр. */
    const viewTargets = (source: string) =>
      links(source)
        .map((l) => parseWikiHref(l.href))
        .filter((t): t is string => t !== null)
    const parsedTargets = (source: string) => parseWikiLinks(source).map((l) => l.target)

    it.each([
      // код с отступом — с учётом пунктов списка
      'текст\n\n    [[a]]',
      '\t[[a]]',
      '\n\n    [[a]]',
      'x\n    [[a]]',
      '# H\n    [[a]]',
      '***\n    [[a]]',
      'H\n===\n    [[a]]',
      '    x\n\n    [[a]]\n\n[[b]]',
      '- a\n\n    [[b]]',
      '- a\n\n      [[c]]',
      '- a\n\n\t[[b]]',
      '- a\n\n\t\t[[c]]',
      '1. x\n\n   [[a]]',
      '1. x\n\n       [[b]]',
      '* a\n\n     [[a]]',
      '-    a\n\n     [[a]]',
      '1)  a\n\n    [[a]]',
      '- a\n  - b\n\n  text\n\n    [[a]]',
      '- a\n  - b\n\n      [[a]]',
      '- a\n  - b\n\n        [[a]]',
      '- a\n- b\n\n  [[a]]\n\nend\n\n    [[b]]',
      // HTML-блоки и строчный HTML
      '<div>\n[[a]]\n</div>\n\n[[b]]',
      '<div>[[a]]</div>\n\n[[b]]',
      '  <div>\n[[a]]',
      'a\n<div>\n[[b]]',
      '<custom-el attr="1">\n[[a]]\n\n[[b]]',
      'para\n<x-foo>\n[[a]]',
      '<custom-el> text\n[[a]]',
      '<!--\n[[a]]\n-->\n[[b]]',
      '<script>\n[[a]]\n</script> tail [[b]]\n[[c]]',
      '<?php [[a]] ?>\n[[b]]',
      '<!DOCTYPE html>\n[[a]]',
      '<![CDATA[\n[[a]]\n]]>\n[[b]]',
      '<span>[[a]]</span>',
      'текст <!-- [[a]] --> и [[b]]',
      '<https://x.com/[[a]]> [[b]]',
      // определения и обычные ссылки
      '[[a]]\n\n[a]: https://x.com',
      '[x]\n\n[[x]]\n\n[x]: https://e.com',
      '[a]: [[b]]\n\n[[c]]',
      '[[a]][x]\n\n[x]: https://e.com',
      '[[a]][]',
      '[[a|b]]: https://x',
      '[[a]](https://x.com)',
      '[[a]]()',
      '[[a]](<x y>)',
      '[[a]] (x)',
      '[текст [[a]] ещё](https://example.com)',
      '[текст `код` [[a]]](https://e.com) [[b]]',
      // автоссылки
      '[[https://example.com]]',
      '[[https://localhost]]',
      '[[http://a_b.c]]',
      '[[https://192.168.0.1]]',
      '[[www.x]]',
      '[[awww.x.com]]',
      '[[user@example.com]]',
      '[[a.b@c]]',
      '[[a@b.c-]]',
      '[[см. www.x.com]]',
      '[[a|https://x.com]]',
      '[[ftp://e.com]]',
      'https://x.com/[[a]]',
      'https://x.com/ [[a]]',
      'см https://x.com[[a]]',
      'a@b.com[[a]]',
      // экранирование и сущности
      String.raw`[[C\#]]`,
      String.raw`[[a\]]`,
      String.raw`\[[a]]`,
      String.raw`\[\[a]]`,
      String.raw`[[a\\|b]]`,
      String.raw`[[a\|b\|c]]`,
      '[[a&amp;b]]',
      '[[a&hellip;b]]',
      '[[&#35;1]] [[&#x23;2]]',
      '[[a&nbsp;b]]',
      '[[a&amp b]]',
      // таблицы
      '| x | y |\n|---|---|\n| [[a|b]] | z |',
      '| x | y |\n|---|---|\n' + String.raw`| [[a\|b\|c]] | z |`,
      'para\n| x | y |\n|---|---|\n| [[a|b]] | z |',
      'x | y\n--|--\n[[a|b]] | z',
      '| x | y |\n|---|---|\n| r |\n[[a|b]]',
      '| x | y |\n|---|---|\n\n[[a|b]]',
      '- | x | y |\n  |---|---|\n  | [[a|b]] | z |',
      '> | x | y |\n> |---|---|\n> | [[a|b]] | z |',
      '| x |\n|---|---|\n| [[a|b]] | z |',
      '| x | y |\n|---|---|\n# h\n[[a|b]]',
      '| x | y |\n|---|---|\n> q [[a|b]]',
      // разметка вокруг, сноски, задачи
      '*[[a]]* **[[b|c]]** ~~[[d]]~~',
      '# [[a]]\n\nH [[b]]\n---',
      '- [ ] [[a]]\n- [x] [[b|c]]',
      '![alt [[a]]](https://e.com/i.png) [[b]]',
      '[x [[a]] y][r] [[b]]\n\n[r]: https://e.com',
      'текст[^1]\n\n[^1]: [[a]]',
      'текст[^1]\n\n[^1]: сноска\n\n    продолжение [[a]]',
      'www.x.com[[a]]',
      '[[a]]https://x.com',
      String.raw`\\[[a]]`,
      '- a\n\n  <div>\n  [[b]]\n\n[[c]]',
      '<span>[[a]]</span> <!-- [[b]] --> <a title="[[c]]">x</a>',
      '[[a@b.c1]] [[https://localhost]]',
      'https://x.com[[a]][[b]]',
      '> \t[[a]]',
      '> текст\n[[a]]',
      '> ```\n> код\n\n[[a]]',
      '1. ```\n\n[[a]]',
      '- ```\n  [[a]]\n  ```\n[[b]]',
      '* \n\n\t[[a]]',
      'текст\n2. [[a]]\n\n    [[b]]',
      '﻿    [[a]]\n\n[[b]]',
      '﻿# [[a]]\n    [[b]]',
      '1. > ```[[b|c]]> * text',
      // прежние случаи
      'а `код` [[один]]\n\n```\n[[нет]]\n```\nхвост [[два|2]] конец [[три]]',
      '- пункт\n  ```\n  [[a]]\n  ```\n[[b]]',
      '> ```\n> [[a]]\n> ```\n[[b]]',
      '```js\r\n\r\n[[a]]\r\n```\r\n[[b]]\r\n',
      // вики-ссылка сразу после адреса обычной ссылки или картинки
      '[сайт](https://example.com)[[Заметка]]',
      '![](https://example.com/p.png)[[Заметка]]',
      'Источник: [док](https://example.com/doc)→[[Проект]]',
      '[сайт](https://example.com/a_b),[[Заметка]]',
      '|[сайт](https://example.com)|[[Заметка]]|\n|-|-|',
      '[сайт](www.example.com)[[Заметка]]',
      '[![](https://a.com/i.png)](https://b.com)[[Заметка]]',
      'https://q.ru/x[сайт](https://example.com)[[З]]',
      // сноски: пробелы, табы и длинные имена
      'т[^1]\n\n[^1]:   [[a]]',
      'т[^1]\n\n[^1]:\t\t[[a]]',
      'т[^note]\n\n[^note]: [[a]]',
      'т[^1]\n\n> [^1]:   [[a]]',
      // экранированная первая «[» не открывает ссылку
      '\\[[A]](u)',
    ])('%j', (source) => {
      expect(parsedTargets(source)).toEqual(viewTargets(source))
    })
  })

  it('c++ и скобки в цели доходят до компонента и разбираются обратно', () => {
    for (const target of ['c++', 'f(x)', 'a (b) c', 'Вопрос?', 'a & b', '50%']) {
      const [link] = links(`[[${target}]]`)
      expect(parseWikiHref(link.href)).toBe(target)
    }
  })
})

describe('переносы строк', () => {
  // После br mdast-util-to-hast сам добавляет «\n» — в разметке это пробельный символ, на вид не влияет.
  it('«а\\nб» → два текста и br', () => {
    expect(render('а\nб')).toBe('<p>а<br/>\nб</p>')
    expect(render('а\r\nб\r\nв')).toBe('<p>а<br/>\nб<br/>\nв</p>')
  })

  it('в коде перевод строки остаётся', () => {
    expect(render('```\nа\nб\n```')).toBe('<pre><code>а\nб\n</code></pre>')
    expect(render('`а\nб`')).toBe('<p><code>а б</code></p>')
  })

  it('внутри обычной ссылки и вики-ссылки', () => {
    expect(render('[а\nб](https://e.com)')).toBe('<p><a href="https://e.com">а<br/>\nб</a></p>')
    expect(render('[[a]]\nб')).toBe(`<p><a href="${wikiHref('a')}">a</a><br/>\nб</p>`)
  })
})

describe('безопасность', () => {
  it('небезопасные и относительные адреса → пустой href', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'mailto:a@b.c', '/relative', 'page.html']) {
      expect(links(`[x](${url})`)).toEqual([{ href: '', text: 'x' }])
    }
    expect(links('[x](https://e.com/a?b=1)')).toEqual([{ href: 'https://e.com/a?b=1', text: 'x' }])
    expect(links('[x](HTTP://E.com)')).toEqual([{ href: 'HTTP://E.com', text: 'x' }])
  })

  it('адреса, которые не откроются, ссылкой не становятся: ftp и схема без «//»', () => {
    // ftp не открывают ни браузеры, ни окно Tauri; «https:host» браузер считает относительным адресом.
    for (const url of ['ftp://e.com/f', 'https:evil.com', 'https:/evil.com', 'http:e.com/a']) {
      expect(links(`[x](${url})`)).toEqual([{ href: '', text: 'x' }])
    }
    expect(links('<ftp://e.com/f>')).toEqual([{ href: '', text: 'ftp://e.com/f' }])
  })

  it('openableLinkUrl', () => {
    expect(openableLinkUrl(' https://e.com/a ')).toBe('https://e.com/a')
    expect(openableLinkUrl('http://localhost:3000')).toBe('http://localhost:3000')
    for (const url of ['ftp://e.com', 'https:e.com', 'javascript:alert(1)', 'mailto:a@b.c', '', '  ', 'e.com', undefined, 42]) {
      expect(openableLinkUrl(url)).toBeUndefined()
    }
  })

  it('сырой HTML — текст, тегов script/img/iframe нет', () => {
    const html = render('<script>alert(1)</script>\n\nтекст <img src=x onerror="alert(1)"> и <iframe src="https://e.com"></iframe>')
    expect(html).not.toMatch(/<(script|img|iframe)\b/i)
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img src=x onerror=')
  })

  it('src картинки проходит только http/https', () => {
    const seen: Array<string | undefined> = []
    const html = render('![a](https://e.com/a.png) ![b](javascript:alert(1)) ![c](data:image/png;base64,AAA) ![d](ftp://e.com/d.png)', {
      img: ({ src, alt }) => {
        seen.push(typeof src === 'string' ? src : undefined)
        return createElement('span', null, alt)
      },
    })
    expect(seen).toEqual(['https://e.com/a.png', '', '', ''])
    expect(html).not.toMatch(/<img\b/i)
  })

  it('mdUrlTransform: вики, якоря и прочие ключи', () => {
    expect(mdUrlTransform(wikiHref('x'), 'href')).toBe(wikiHref('x'))
    expect(mdUrlTransform('#user-content-fn-1', 'href')).toBe('#user-content-fn-1')
    expect(mdUrlTransform(wikiHref('x'), 'src')).toBe('')
    expect(mdUrlTransform('https://e.com', 'cite')).toBe('')
    expect(mdUrlTransform('https://e.com', 'src')).toBe('https://e.com')
  })

  it('сноски: якорные адреса доходят до ссылок', () => {
    const hrefs = links('текст[^1]\n\n[^1]: сноска').map((l) => l.href)
    expect(hrefs.some((h) => h?.startsWith('#user-content-fn'))).toBe(true)
    expect(hrefs.some((h) => h?.startsWith('#user-content-fnref'))).toBe(true)
  })
})

describe('isMarkdownFile', () => {
  it('по расширению и по типу', () => {
    expect(isMarkdownFile({ fileName: 'notes.md' })).toBe(true)
    expect(isMarkdownFile({ fileName: 'README.MD' })).toBe(true)
    expect(isMarkdownFile({ fileName: 'a.markdown' })).toBe(true)
    expect(isMarkdownFile({ fileName: 'a.mdown' })).toBe(true)
    expect(isMarkdownFile({ fileName: 'a.txt', mimeType: 'text/markdown; charset=utf-8' })).toBe(true)
    expect(isMarkdownFile({ mimeType: 'text/x-markdown' })).toBe(true)
    expect(isMarkdownFile({ fileName: 'a.mdx' })).toBe(false)
    expect(isMarkdownFile({ fileName: 'md' })).toBe(false)
    expect(isMarkdownFile({ fileName: 'a.txt', mimeType: 'text/plain' })).toBe(false)
    expect(isMarkdownFile({})).toBe(false)
  })
})

it('MD_RENDER_MAX — сто тысяч символов', () => {
  expect(MD_RENDER_MAX).toBe(100_000)
})
