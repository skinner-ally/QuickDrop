import { describe, expect, it } from 'vitest'
import {
  buildTitleIndex,
  mayHaveWikiLinks,
  parseWikiLinks,
  resolveWikiLink,
  unclosedFence,
  wikiKey,
  wikiLinkTargets,
} from '@/lib/wikiLinks'
import type { Item } from '@/types'

const T0 = Date.UTC(2026, 0, 15, 10, 0, 0)

function mk(id: string, over: Partial<Item> = {}): Item {
  return {
    id,
    type: 'text',
    title: '',
    content: '',
    categoryId: null,
    tags: [],
    links: [],
    status: 'library',
    favorite: 0,
    source: 'manual',
    createdAt: T0,
    updatedAt: T0,
    ...over,
  }
}

const targets = (text: string) => parseWikiLinks(text).map((l) => l.target)

describe('parseWikiLinks', () => {
  it('разбирает обе формы', () => {
    const text = 'см. [[Запись]] и [[Другая запись|подпись]]'
    expect(parseWikiLinks(text)).toEqual([
      { raw: '[[Запись]]', target: 'Запись', label: 'Запись', start: 4, end: 14 },
      { raw: '[[Другая запись|подпись]]', target: 'Другая запись', label: 'подпись', start: 17, end: 42 },
    ])
  })

  it('обрезает пробелы у цели и подписи, raw остаётся исходным', () => {
    expect(parseWikiLinks('[[  Мой отчёт  |  смотри тут  ]]')).toEqual([
      { raw: '[[  Мой отчёт  |  смотри тут  ]]', target: 'Мой отчёт', label: 'смотри тут', start: 0, end: 32 },
    ])
  })

  it('пустая подпись равна цели, лишние «|» остаются в подписи', () => {
    expect(parseWikiLinks('[[a|]]')[0]).toMatchObject({ target: 'a', label: 'a' })
    expect(parseWikiLinks('[[a|  ]]')[0]).toMatchObject({ target: 'a', label: 'a' })
    expect(parseWikiLinks('[[a|b|c]]')[0]).toMatchObject({ target: 'a', label: 'b|c' })
  })

  it('«\\|» (запись в таблице Markdown): обратная косая черта к цели не относится', () => {
    expect(parseWikiLinks('| [[План\\|подпись]] |')).toEqual([
      { raw: '[[План\\|подпись]]', target: 'План', label: 'подпись', start: 2, end: 19 },
    ])
    expect(parseWikiLinks('[[ План \\| подпись ]]')[0]).toMatchObject({ target: 'План', label: 'подпись' })
    // без подписи — подпись равна цели
    expect(parseWikiLinks('[[План\\|]]')[0]).toMatchObject({ target: 'План', label: 'План' })
    // «\|» в подписи — экранированная «|», как её видит просмотр
    expect(parseWikiLinks('[[a\\|b\\|c]]')[0]).toMatchObject({ target: 'a', label: 'b|c' })
    expect(parseWikiLinks('[[a|b\\|c]]')[0]).toMatchObject({ target: 'a', label: 'b|c' })
    // «\]» — экранированная скобка: в просмотре текст «[[a]]», цель «a»
    expect(parseWikiLinks('[[a\\]]')[0]).toMatchObject({ target: 'a', raw: '[[a\\]]' })
    expect(parseWikiLinks('[[\\|подпись]]')).toEqual([])
    expect(wikiLinkTargets('| [[Альфа\\|первая]] |', [mk('a', { title: 'Альфа' })])).toEqual(['a'])
  })

  it('«\\\\|» — экранированная косая черта перед «|»: цель без неё, как в просмотре', () => {
    expect(parseWikiLinks(String.raw`[[a\\|b]]`)).toEqual([
      { raw: String.raw`[[a\\|b]]`, target: 'a', label: 'b', start: 0, end: 9 },
    ])
  })

  it('экранирование и сущности снимаются, позиции — по исходнику', () => {
    expect(targets(String.raw`[[C\#]] [[a\_b]]`)).toEqual(['C#', 'a_b'])
    expect(targets('[[R&amp;D]] [[&#35;1]] [[&#x23;2]] [[a&nbsp;b]] [[a&hellip;]]')).toEqual([
      'R&D',
      '#1',
      '#2',
      'a b',
      'a…',
    ])
    // неизвестная сущность и «&» без «;» остаются как есть
    expect(targets('[[a&nosuch;b]] [[a&amp b]]')).toEqual(['a&nosuch;b', 'a&amp b'])
    const text = String.raw`до \[[a]] и [[b\]] после`
    const links = parseWikiLinks(text)
    expect(links.map((l) => [l.target, l.raw])).toEqual([
      ['a', String.raw`\[[a]]`],
      ['b', String.raw`[[b\]]`],
    ])
    for (const link of links) expect(text.slice(link.start, link.end)).toBe(link.raw)
  })

  it('пустая цель — не ссылка', () => {
    expect(parseWikiLinks('[[]]')).toEqual([])
    expect(parseWikiLinks('[[   ]]')).toEqual([])
    expect(parseWikiLinks('[[|подпись]]')).toEqual([])
    expect(parseWikiLinks('[[  |подпись]]')).toEqual([])
  })

  it('перевод строки внутри — не ссылка', () => {
    expect(parseWikiLinks('[[a\nb]]')).toEqual([])
    expect(parseWikiLinks('[[a\r\nb]]')).toEqual([])
    expect(parseWikiLinks('[[a|b\nc]]')).toEqual([])
  })

  it('скобки внутри — не ссылка; разбирается только самая внутренняя пара', () => {
    expect(parseWikiLinks('[[a[b]]]')).toEqual([])
    expect(parseWikiLinks('[[a]b]]')).toEqual([])
    expect(parseWikiLinks('[[a|b[c]]]')).toEqual([])
    expect(parseWikiLinks('[a]] и [[b]')).toEqual([])
    expect(parseWikiLinks('[[[a]]]')).toEqual([{ raw: '[[a]]', target: 'a', label: 'a', start: 1, end: 6 }])
    expect(targets('[[внешняя [[внутренняя]] часть]]')).toEqual(['внутренняя'])
  })

  it('цель длиннее 200 символов — не ссылка', () => {
    expect(targets(`[[${'я'.repeat(200)}]]`)).toEqual(['я'.repeat(200)])
    expect(targets(`[[${'я'.repeat(201)}]]`)).toEqual([])
    // Предел считается после обрезки пробелов и только по цели.
    expect(targets(`[[  ${'я'.repeat(200)}  |${'п'.repeat(300)}]]`)).toEqual(['я'.repeat(200)])
  })

  it('позиции указывают на исходный текст', () => {
    const text = 'а `код` [[один]]\n\n```\n[[нет]]\n```\nхвост [[два|2]] конец [[три]]'
    const links = parseWikiLinks(text)
    expect(links.map((l) => l.target)).toEqual(['один', 'два', 'три'])
    for (const link of links) expect(text.slice(link.start, link.end)).toBe(link.raw)
  })

  it('текст без ссылок', () => {
    expect(parseWikiLinks('')).toEqual([])
    expect(parseWikiLinks('обычный [текст] и [ссылка](https://example.com)')).toEqual([])
  })

  describe('код', () => {
    it('инлайн-код не разбирается', () => {
      expect(targets('до `[[a]]` после [[b]]')).toEqual(['b'])
      expect(targets('`` [[a]] ` [[b]] `` [[c]]')).toEqual(['c'])
      expect(targets('[[a]] `x` [[b]] `y` [[c]]')).toEqual(['a', 'b', 'c'])
    })

    it('непарная обратная кавычка кодом не считается', () => {
      expect(targets('цена 5` и [[a]]')).toEqual(['a'])
      expect(targets('`` [[a]] `')).toEqual(['a'])
    })

    it('инлайн-код не выходит за пределы абзаца', () => {
      expect(targets('начало ` тут\n\n[[a]] и ` конец')).toEqual(['a'])
      expect(targets('начало ` тут\n[[a]] и ` конец')).toEqual([])
    })

    it('экранированная кавычка код не открывает', () => {
      expect(targets('\\`[[a]]\\`')).toEqual(['a'])
      expect(targets('\\\\`[[a]]`')).toEqual([])
    })

    it('ссылка, задевающая код, — не ссылка', () => {
      expect(targets('[[a `b` c]]')).toEqual([])
      expect(targets('[[a `b]] c`')).toEqual([])
    })

    it('ограды ``` и ~~~', () => {
      expect(targets('[[a]]\n```\n[[b]]\n```\n[[c]]')).toEqual(['a', 'c'])
      expect(targets('[[a]]\n~~~\n[[b]]\n~~~\n[[c]]')).toEqual(['a', 'c'])
      expect(targets('```js\nconst x = "[[b]]"\n\n[[c]]\n```\n[[d]]')).toEqual(['d'])
    })

    it('ограду закрывает только такая же, не короче открывающей', () => {
      expect(targets('```\n~~~\n[[a]]\n```\n[[b]]')).toEqual(['b'])
      expect(targets('````\n```\n[[a]]\n````\n[[b]]')).toEqual(['b'])
      expect(targets('```\n[[a]]\n`````\n[[b]]')).toEqual(['b'])
      // Строка с текстом после кавычек ограду не закрывает.
      expect(targets('```\n[[a]]\n``` nope\n[[b]]\n```\n[[c]]')).toEqual(['c'])
    })

    it('незакрытая ограда тянется до конца текста', () => {
      expect(targets('[[a]]\n```\n[[b]]\n\n[[c]]')).toEqual(['a'])
    })

    it('ограда с отступом, в цитате и с CRLF', () => {
      expect(targets('- пункт\n  ```\n  [[a]]\n  ```\n[[b]]')).toEqual(['b'])
      expect(targets('> ```\n> [[a]]\n> ```\n[[b]]')).toEqual(['b'])
      expect(targets('```js\r\n\r\n[[a]]\r\n```\r\n[[b]]\r\n')).toEqual(['b'])
    })

    it('три кавычки в середине строки — инлайн-код, а не ограда', () => {
      expect(targets('слово ```[[a]]``` и [[b]]\n\n[[c]]')).toEqual(['b', 'c'])
      expect(targets('```[[a]]``` и [[b]]\n\n[[c]]')).toEqual(['b', 'c'])
    })

    it('код с отступом: после пустой строки, с учётом пунктов списка', () => {
      expect(targets('текст\n\n    [[a]]\n\n[[b]]')).toEqual(['b'])
      expect(targets('\t[[a]]')).toEqual([])
      // продолжение абзаца, а не код
      expect(targets('текст\n    [[a]]')).toEqual(['a'])
      // после заголовка код возможен и без пустой строки
      expect(targets('# Заголовок\n    [[a]]')).toEqual([])
      // в пункте списка код начинается с отступа содержимого + 4
      expect(targets('- пункт\n\n    [[a]]')).toEqual(['a'])
      expect(targets('- пункт\n\n      [[a]]')).toEqual([])
      expect(targets('1. пункт\n\n       [[a]]')).toEqual([])
      expect(targets('- a\n  - b\n\n      [[a]]\n\n        [[c]]')).toEqual(['a'])
      // пункт кончился — отступ снова считается от края
      expect(targets('- a\n\nтекст\n\n    [[a]]')).toEqual([])
      // пустой в строке маркера пункт закрывает пустая строка
      expect(targets('* \n\n\t[[a]]')).toEqual([])
    })

    it('ограда в строке маркера пункта и её конец вместе с пунктом', () => {
      expect(targets('- ```\n  [[a]]\n  ```\n[[b]]')).toEqual(['b'])
      // строка без отступа завершает пункт, а с ним и незакрытую ограду
      expect(targets('1. ```\n\n[[a]]')).toEqual(['a'])
      expect(unclosedFence('- ```\n  код')).toBe('  ```')
    })

    it('цитата: код с отступом внутри, ограда кончается вместе с цитатой', () => {
      expect(targets('> q\n>\n>     [[a]]')).toEqual([])
      expect(targets('> \t[[a]]')).toEqual(['a'])
      expect(targets('> ```\n> код\n\n[[a]]')).toEqual(['a'])
      // «ленивое» продолжение абзаца цитаты
      expect(targets('> текст\n[[a]]')).toEqual(['a'])
    })
  })

  describe('как в просмотре Markdown', () => {
    it('HTML-блоки и строчный HTML', () => {
      expect(targets('<div>\n[[a]]\n</div>\n\n[[b]]')).toEqual(['b'])
      expect(targets('<!--\n[[a]]\n-->\n[[b]]')).toEqual(['b'])
      expect(targets('<pre>\n[[a]]\n</pre>\n[[b]]')).toEqual(['b'])
      // тег на отдельной строке не прерывает абзац
      expect(targets('абзац\n<x-tag>\n[[a]]')).toEqual(['a'])
      // строчный HTML: текст между тегами — обычный, внутри тега и комментария — нет
      expect(targets('<span>[[a]]</span> <!-- [[b]] --> <a title="[[c]]">x</a>')).toEqual(['a'])
      expect(targets('<https://x.com/[[a]]> [[b]]')).toEqual(['b'])
    })

    it('определения и обычные ссылки', () => {
      // [[a]] при определении [a]: … — обычная ссылка в скобках
      expect(targets('[[a]] [[b]]\n\n[a]: https://x.com')).toEqual(['b'])
      expect(targets('[a]: [[b]]\n\n[[c]]')).toEqual(['c'])
      expect(targets('[[a]][x] [[b]]\n\n[x]: https://e.com')).toEqual(['b'])
      expect(targets('[[a]](https://x.com) [[b]] (c)')).toEqual(['b'])
      expect(targets('[текст [[a]] ещё](https://e.com) и [[b]]')).toEqual(['b'])
      expect(targets('![alt [[a]]](https://e.com/i.png)')).toEqual([])
      // сноска — не определение ссылки
      expect(targets('текст[^1]\n\n[^1]: [[a]]')).toEqual(['a'])
    })

    it('автоссылки GFM', () => {
      expect(targets('[[https://example.com]] [[www.x.com]] [[user@example.com]] [[a|https://x.com]]')).toEqual([])
      // без точки в домене, с «_» в домене и почта с цифрой в конце — не автоссылки
      expect(targets('[[https://localhost]] [[http://a_b.c]] [[a@b.c1]]')).toEqual([
        'https://localhost',
        'http://a_b.c',
        'a@b.c1',
      ])
      // адрес вплотную перед [[…]] забирает её в себя; после пробела — нет
      expect(targets('https://x.com/[[a]] и https://x.com/ [[b]]')).toEqual(['b'])
      // «]» перед «[» обрывает адрес — вторая ссылка цела
      expect(targets('https://x.com[[a]][[b]]')).toEqual(['b'])
    })

    it('вики-ссылка вплотную после адреса обычной ссылки или картинки', () => {
      expect(targets('[сайт](https://example.com)[[Заметка]]')).toEqual(['Заметка'])
      expect(targets('![](https://example.com/p.png)[[Заметка]]')).toEqual(['Заметка'])
      expect(targets('Источник: [док](https://example.com/doc)→[[Проект]]')).toEqual(['Проект'])
      expect(targets('[сайт](https://example.com/a_b),[[Заметка]]')).toEqual(['Заметка'])
      expect(targets('|[сайт](https://example.com)|[[Заметка]]|\n|-|-|')).toEqual(['Заметка'])
      expect(targets('[сайт](www.example.com)[[Заметка]]')).toEqual(['Заметка'])
      expect(targets('[![](https://a.com/i.png)](https://b.com)[[Заметка]]')).toEqual(['Заметка'])
      // адрес перед ссылкой забирает её «[»: «(https://…» становится автоссылкой
      expect(targets('https://q.ru/x[сайт](https://example.com)[[З]]')).toEqual([])
    })

    it('сноски: любые пробелы после метки и длинные имена', () => {
      expect(targets('т[^1]\n\n[^1]:   [[a]]')).toEqual(['a'])
      expect(targets('т[^1]\n\n[^1]:        [[a]]')).toEqual(['a'])
      expect(targets('т[^1]\n\n[^1]:\t\t[[a]]')).toEqual(['a'])
      expect(targets('т[^note]\n\n[^note]: [[a]]')).toEqual(['a'])
      expect(targets('т[^источник]\n\n[^источник]: см. [[a]]')).toEqual(['a'])
      expect(targets('т[^1]\n\n> [^1]:   [[a]]')).toEqual(['a'])
      expect(targets('т[^1]\n\n[^1]:   - [[a]]')).toEqual(['a'])
      // ограда в первой строке сноски — код, как в просмотре
      expect(targets('т[^note]\n\n[^note]: ```\n    [[a]]\n    ```')).toEqual([])
    })

    it('экранированная «[» перед [[…]] не делает хвост «(…)» ссылкой', () => {
      expect(targets('\\[[A]](u)')).toEqual(['A'])
      expect(mayHaveWikiLinks('\\[\\[A]]')).toBe(true)
      expect(mayHaveWikiLinks('просто текст')).toBe(false)
    })

    it('таблицы: голая «|» режет ячейку, ссылка помечается inTable', () => {
      const table = '| x | y |\n|---|---|\n'
      expect(targets(table + '| [[a|b]] | z |')).toEqual([])
      expect(parseWikiLinks(table + '| [[a\\|b]] | z |')).toEqual([
        { raw: '[[a\\|b]]', target: 'a', label: 'b', start: 22, end: 30, inTable: true },
      ])
      expect(parseWikiLinks(table + '| [[a]] |\n\n[[b|c]]').map((l) => [l.target, l.inTable])).toEqual([
        ['a', true],
        ['b', undefined],
      ])
      // число ячеек заголовка и разделителя не совпало — не таблица
      expect(targets('| x |\n|---|---|\n| [[a|b]] |')).toEqual(['a'])
      // таблица в цитате и в пункте списка
      expect(targets('> | x | y |\n> |---|---|\n> | [[a|b]] | z |')).toEqual([])
      expect(targets('- | x | y |\n  |---|---|\n  | [[a|b]] | z |')).toEqual([])
    })
  })
})

describe('unclosedFence', () => {
  it('возвращает ограду, которой нужно закрыть текст', () => {
    expect(unclosedFence('текст\n```js\nкод')).toBe('```')
    expect(unclosedFence('~~~~\nкод')).toBe('~~~~')
    expect(unclosedFence('```\nкод\n```')).toBeNull()
    expect(unclosedFence('без кода `a`')).toBeNull()
    expect(unclosedFence('> ```\n> код')).toBeNull()
  })

  it('ограда пункта списка закрывается с тем же отступом — внутри пункта', () => {
    expect(unclosedFence('1. шаг\n   ```\n   код')).toBe('   ```')
    expect(unclosedFence('- шаг\n  ~~~~\n  код')).toBe('  ~~~~')
    expect(unclosedFence('текст\n ```js\nкод')).toBe(' ```')
    // от 4 пробелов — ограда глубже в пункте, её закроет конец пункта
    expect(unclosedFence('- шаг\n    ```\n    код')).toBeNull()
  })
})

describe('wikiKey', () => {
  it('регистр, ё/е и пробелы не важны', () => {
    expect(wikiKey('  Мой   ОТЧЁТ\tза год ')).toBe('мой отчет за год')
    expect(wikiKey('Ёлка')).toBe(wikiKey('ЕЛКА'))
    expect(wikiKey('ёж')).toBe(wikiKey('Еж'))
    expect(wikiKey('React Hooks')).toBe(wikiKey('react  hooks'))
    expect(wikiKey('план')).not.toBe(wikiKey('планы'))
    expect(wikiKey('   ')).toBe('')
  })
})

describe('buildTitleIndex', () => {
  it('ключ — производный заголовок записи', () => {
    const titled = mk('a', { title: 'Мой Отчёт' })
    const byContent = mk('b', { content: '\nПервая строка\nвторая' })
    const byMeta = mk('c', { type: 'link', url: 'https://example.com', linkMeta: { title: 'Сайт', status: 'ok' } })
    const byFile = mk('d', { type: 'file', fileId: 'f', fileName: 'Договор.pdf' })
    const index = buildTitleIndex([titled, byContent, byMeta, byFile])
    expect(index.get('мой отчет')).toBe(titled)
    expect(index.get('первая строка')).toBe(byContent)
    expect(index.get('сайт')).toBe(byMeta)
    expect(index.get('договор.pdf')).toBe(byFile)
    expect(index.size).toBe(4)
  })

  it('записи в корзине пропускаются', () => {
    const trashed = mk('a', { title: 'План', deletedAt: T0 })
    expect(buildTitleIndex([trashed]).size).toBe(0)
    const alive = mk('b', { title: 'план', status: 'archive', createdAt: T0 + 5000 })
    expect(buildTitleIndex([trashed, alive]).get('план')).toBe(alive)
  })

  it('при одинаковом заголовке: library → inbox → archive', () => {
    const archive = mk('a', { title: 'Тема', status: 'archive', createdAt: T0 })
    const inbox = mk('b', { title: 'ТЕМА', status: 'inbox', createdAt: T0 + 1 })
    const library = mk('c', { title: 'тема', status: 'library', createdAt: T0 + 2 })
    expect(buildTitleIndex([archive, inbox, library]).get('тема')).toBe(library)
    expect(buildTitleIndex([library, inbox, archive]).get('тема')).toBe(library)
    expect(buildTitleIndex([archive, inbox]).get('тема')).toBe(inbox)
    expect(buildTitleIndex([inbox, archive]).get('тема')).toBe(inbox)
  })

  describe('заголовок из строки с вики-ссылкой в индекс не попадает', () => {
    it('индексная заметка «- [[Проект А]]» не перехватывает цель у записи «Проект А»', () => {
      const b = mk('b', { content: '- [[Проект А]]\n- [[Проект Б]]', status: 'inbox', createdAt: T0 })
      const a = mk('a', { title: 'Проект А', status: 'inbox', createdAt: T0 + 1000 })
      expect(buildTitleIndex([a, b]).get('проект а')).toBe(a)
      expect(wikiLinkTargets(b.content, [a, b], 'b')).toEqual(['a'])
      expect(wikiLinkTargets('см. [[Проект А]]', [a, b], 'c')).toEqual(['a'])
    })

    it('заголовок «# [[Проект А]]» в базе знаний не перебивает запись из входящих без своего заголовка', () => {
      const b = mk('b', { content: '# [[Проект А]]\nтекст', status: 'library', createdAt: T0 })
      const a = mk('a', { content: 'Проект А\nописание', status: 'inbox', createdAt: T0 + 1000 })
      expect(wikiLinkTargets(b.content, [a, b], 'b')).toEqual(['a'])
      expect(wikiLinkTargets('см. [[Проект А]]', [a, b], 'c')).toEqual(['a'])
      // без строки маркера и в коде с отступом — то же
      const plain = mk('p', { content: '[[Проект А]]\nзаметки', createdAt: T0 - 1 })
      const code = mk('q', { content: '    [[Проект А]]', createdAt: T0 - 2 })
      expect(wikiLinkTargets('[[Проект А]]', [a, b, plain, code], 'c')).toEqual(['a'])
    })

    it('подпись вики-ссылки не становится чужим заголовком', () => {
      const b = mk('b', { content: '[[Проект А|проект]]', createdAt: T0 })
      const target = mk('t', { title: 'Проект', status: 'inbox', createdAt: T0 + 1000 })
      expect(buildTitleIndex([b, target]).get('проект')).toBe(target)
      expect(wikiLinkTargets('[[Проект]]', [b, target], 'c')).toEqual(['t'])
    })

    it('прочая разметка в первой строке заголовок не отменяет', () => {
      const plan = mk('p', { content: '**План** на год' })
      const code = mk('c', { type: 'code', content: '[[x]] = 1' })
      const index = buildTitleIndex([plan, code])
      expect(index.get('план на год')).toBe(plan)
      expect(index.get('[[x]] = 1')).toBe(code)
    })
  })

  it('затем более ранняя createdAt, затем меньший id', () => {
    const late = mk('a', { title: 'Тема', createdAt: T0 + 10 })
    const early = mk('z', { title: 'Тема', createdAt: T0 })
    expect(buildTitleIndex([late, early]).get('тема')).toBe(early)
    expect(buildTitleIndex([early, late]).get('тема')).toBe(early)

    const x = mk('x', { title: 'Тема' })
    const y = mk('y', { title: 'Тема' })
    expect(buildTitleIndex([y, x]).get('тема')).toBe(x)
    expect(buildTitleIndex([x, y]).get('тема')).toBe(x)
  })
})

describe('resolveWikiLink', () => {
  const report = mk('a', { title: 'Отчёт за Год' })
  const index = buildTitleIndex([report, mk('b', { title: 'Ёлка' })])

  it('сопоставляет без учёта регистра, ё/е и лишних пробелов', () => {
    expect(resolveWikiLink('отчет за год', index)).toBe(report)
    expect(resolveWikiLink('ОТЧЁТ   ЗА ГОД', index)).toBe(report)
    expect(resolveWikiLink(' елка ', index)?.id).toBe('b')
    expect(resolveWikiLink('ЁЛКА', index)?.id).toBe('b')
  })

  it('неизвестная цель и сама запись — undefined', () => {
    expect(resolveWikiLink('нет такой', index)).toBeUndefined()
    expect(resolveWikiLink('', index)).toBeUndefined()
    expect(resolveWikiLink('отчёт за год', index, 'a')).toBeUndefined()
    expect(resolveWikiLink('отчёт за год', index, 'b')).toBe(report)
  })
})

describe('wikiLinkTargets', () => {
  const items = [
    mk('a', { title: 'Альфа' }),
    mk('b', { title: 'Бета' }),
    mk('c', { title: 'Ёлка' }),
    mk('t', { title: 'Удалённая', deletedAt: T0 }),
  ]

  it('уникальные id в порядке появления', () => {
    const text = '[[бета]], [[АЛЬФА|первая]], снова [[Бета]] и [[елка]]'
    expect(wikiLinkTargets(text, items)).toEqual(['b', 'a', 'c'])
  })

  it('без selfId, корзины, неизвестных и кода', () => {
    const text = '[[Альфа]] [[Бета]] [[Удалённая]] [[Нет такой]] `[[Ёлка]]`'
    expect(wikiLinkTargets(text, items, 'a')).toEqual(['b'])
    expect(wikiLinkTargets(text, items)).toEqual(['a', 'b'])
  })

  it('текст без ссылок и пустой список записей', () => {
    expect(wikiLinkTargets('просто текст', items)).toEqual([])
    expect(wikiLinkTargets('[[Альфа]]', [])).toEqual([])
  })

  it('ссылка на собственный заголовок не уводит к одноимённой записи', () => {
    const twins = [mk('x', { title: 'Тема' }), mk('y', { title: 'Тема' })]
    expect(wikiLinkTargets('[[Тема]]', twins, 'x')).toEqual([])
    expect(wikiLinkTargets('[[Тема]]', twins, 'y')).toEqual(['x'])
  })
})
