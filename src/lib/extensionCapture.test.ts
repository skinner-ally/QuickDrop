import { describe, expect, it } from 'vitest'
import {
  EXT_ERR_BAD_URL,
  EXT_ERR_EMPTY_TEXT,
  EXT_ERR_FORMAT,
  EXT_ERR_LONG_TEXT,
  EXT_ERR_LONG_URL,
  EXT_ERR_NO_URL,
  EXT_TEXT_MAX,
  EXT_TITLE_MAX,
  EXT_URL_MAX,
  extensionMessageToInput,
  parseExtensionMessage,
} from './extensionCapture'

const urlOfLength = (n: number): string => {
  const head = 'https://example.com/'
  return head + 'a'.repeat(n - head.length)
}

describe('parseExtensionMessage: формат', () => {
  it('не объект, неверная версия или вид → «Неизвестный формат»', () => {
    const bad: unknown[] = [
      null,
      undefined,
      'строка',
      42,
      [],
      [{ v: 1, kind: 'page', url: 'https://a.ru' }],
      new Date(),
      { kind: 'page', url: 'https://a.ru' },
      { v: '1', kind: 'page', url: 'https://a.ru' },
      { v: 2, kind: 'page', url: 'https://a.ru' },
      { v: 1, kind: 'tab', url: 'https://a.ru' },
      { v: 1, url: 'https://a.ru' },
      { v: 1, kind: 'toString', url: 'https://a.ru' },
    ]
    for (const raw of bad) expect(() => parseExtensionMessage(raw), String(raw)).toThrow(EXT_ERR_FORMAT)
  })

  it('поля из прототипа не засчитываются', () => {
    const raw = Object.create({ v: 1, kind: 'page', url: 'https://a.ru' }) as object
    expect(() => parseExtensionMessage(raw)).toThrow(EXT_ERR_FORMAT)
  })

  it('лишние поля отбрасываются', () => {
    const msg = parseExtensionMessage({
      v: 1,
      kind: 'page',
      url: 'https://example.com/a',
      title: 'Пример',
      text: 'у страницы текста нет',
      status: 'library',
      favorite: true,
      __proto__x: 1,
    })
    expect(msg).toEqual({ v: 1, kind: 'page', url: 'https://example.com/a', title: 'Пример' })
  })

  it('JSON с ключом __proto__ не меняет прототип результата', () => {
    const raw: unknown = JSON.parse('{"v":1,"kind":"page","url":"https://a.ru/","__proto__":{"x":1}}')
    const msg = parseExtensionMessage(raw)
    expect(Object.getPrototypeOf(msg)).toBe(Object.prototype)
    expect(msg).toEqual({ v: 1, kind: 'page', url: 'https://a.ru/' })
  })
})

describe('parseExtensionMessage: адрес', () => {
  it('page и link требуют адрес', () => {
    for (const kind of ['page', 'link'] as const) {
      expect(() => parseExtensionMessage({ v: 1, kind })).toThrow(EXT_ERR_NO_URL)
      expect(() => parseExtensionMessage({ v: 1, kind, url: '   ' })).toThrow(EXT_ERR_NO_URL)
      expect(() => parseExtensionMessage({ v: 1, kind, url: 123 })).toThrow(EXT_ERR_NO_URL)
    }
  })

  it('только http и https', () => {
    for (const url of [
      'chrome://extensions',
      'file:///C:/secret.txt',
      'javascript:alert(1)',
      'data:text/html,<b>x</b>',
      'ftp://example.com/a',
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop/popup.html',
      'about:blank',
      'не адрес',
      'example.com',
    ]) {
      expect(() => parseExtensionMessage({ v: 1, kind: 'page', url }), url).toThrow(EXT_ERR_BAD_URL)
    }
    expect(parseExtensionMessage({ v: 1, kind: 'link', url: '  HTTP://Example.COM/a b ' }).url).toBe(
      'http://example.com/a%20b',
    )
  })

  it('граница длины адреса', () => {
    const ok = urlOfLength(EXT_URL_MAX)
    expect(parseExtensionMessage({ v: 1, kind: 'page', url: ok }).url).toBe(ok)
    expect(() => parseExtensionMessage({ v: 1, kind: 'page', url: urlOfLength(EXT_URL_MAX + 1) })).toThrow(
      EXT_ERR_LONG_URL,
    )
    // После кодирования кириллицы адрес длиннее предела — тоже отказ.
    const cyr = 'https://example.com/' + 'я'.repeat(EXT_URL_MAX - 30)
    expect(() => parseExtensionMessage({ v: 1, kind: 'page', url: cyr })).toThrow(EXT_ERR_LONG_URL)
  })

  it('у выделения негодный или отсутствующий адрес отбрасывается', () => {
    expect(parseExtensionMessage({ v: 1, kind: 'selection', text: 'abc', url: 'file:///x' })).toEqual({
      v: 1,
      kind: 'selection',
      text: 'abc',
    })
    expect(parseExtensionMessage({ v: 1, kind: 'selection', text: 'abc' })).toEqual({
      v: 1,
      kind: 'selection',
      text: 'abc',
    })
    expect(
      parseExtensionMessage({ v: 1, kind: 'selection', text: 'abc', url: urlOfLength(EXT_URL_MAX + 1) }).url,
    ).toBeUndefined()
  })
})

describe('parseExtensionMessage: заголовок', () => {
  it('управляющие символы убираются, пробельные схлопываются', () => {
    const msg = parseExtensionMessage({
      v: 1,
      kind: 'page',
      url: 'https://a.ru',
      title: '  Первая\nвторая\t\tстрока\u0007\u0000  конец ',
    })
    expect(msg.title).toBe('Первая вторая строка конец')
  })

  it('не строка или пустой — отбрасывается', () => {
    for (const title of [42, null, { a: 1 }, ['x'], '   ', '\u0001\u0002']) {
      expect(parseExtensionMessage({ v: 1, kind: 'page', url: 'https://a.ru', title }).title).toBeUndefined()
    }
  })

  it('обрезается до предела и не рвёт суррогатную пару', () => {
    const long = 'а'.repeat(EXT_TITLE_MAX + 50)
    expect(parseExtensionMessage({ v: 1, kind: 'page', url: 'https://a.ru', title: long }).title).toBe(
      'а'.repeat(EXT_TITLE_MAX),
    )
    const emoji = 'x'.repeat(EXT_TITLE_MAX - 1) + '😀'
    const t = parseExtensionMessage({ v: 1, kind: 'page', url: 'https://a.ru', title: emoji }).title
    expect(t).toBe('x'.repeat(EXT_TITLE_MAX - 1))
  })
})

describe('parseExtensionMessage: выделенный текст', () => {
  it('обязателен и не пуст', () => {
    expect(() => parseExtensionMessage({ v: 1, kind: 'selection' })).toThrow(EXT_ERR_EMPTY_TEXT)
    expect(() => parseExtensionMessage({ v: 1, kind: 'selection', text: ' \n\t ' })).toThrow(EXT_ERR_EMPTY_TEXT)
    expect(() => parseExtensionMessage({ v: 1, kind: 'selection', text: 5 })).toThrow(EXT_ERR_EMPTY_TEXT)
    expect(() => parseExtensionMessage({ v: 1, kind: 'selection', text: '\u0000' })).toThrow(EXT_ERR_EMPTY_TEXT)
  })

  it('граница длины', () => {
    const ok = 'б'.repeat(EXT_TEXT_MAX)
    expect(parseExtensionMessage({ v: 1, kind: 'selection', text: ok }).text).toHaveLength(EXT_TEXT_MAX)
    expect(() => parseExtensionMessage({ v: 1, kind: 'selection', text: ok + 'б' })).toThrow(EXT_ERR_LONG_TEXT)
    // \r\n считается одним символом: предел — по нормализованному тексту.
    const crlf = 'a\r\n'.repeat(EXT_TEXT_MAX / 2)
    expect(parseExtensionMessage({ v: 1, kind: 'selection', text: crlf }).text).toHaveLength(EXT_TEXT_MAX)
  })

  it('переносы нормализуются, NUL убирается', () => {
    const msg = parseExtensionMessage({ v: 1, kind: 'selection', text: 'а\r\nб\rв\0г' })
    expect(msg.text).toBe('а\nб\nвг')
  })

  it('у page и link текст не сохраняется', () => {
    expect(parseExtensionMessage({ v: 1, kind: 'link', url: 'https://a.ru', text: 'x' }).text).toBeUndefined()
  })
})

describe('extensionMessageToInput', () => {
  it('page → ссылка с заголовком', () => {
    expect(
      extensionMessageToInput(parseExtensionMessage({ v: 1, kind: 'page', url: 'https://a.ru/x', title: 'Стр' })),
    ).toEqual({ type: 'link', url: 'https://a.ru/x', title: 'Стр', status: 'inbox', source: 'extension' })
  })

  it('link → ссылка без заголовка', () => {
    expect(extensionMessageToInput(parseExtensionMessage({ v: 1, kind: 'link', url: 'https://a.ru/y' }))).toEqual({
      type: 'link',
      url: 'https://a.ru/y',
      status: 'inbox',
      source: 'extension',
    })
  })

  it('page без адреса (в обход разбора) — ошибка', () => {
    expect(() => extensionMessageToInput({ v: 1, kind: 'page' })).toThrow(EXT_ERR_NO_URL)
  })

  it('выделение-текст → текст со строкой источника, без заголовка', () => {
    const input = extensionMessageToInput(
      parseExtensionMessage({
        v: 1,
        kind: 'selection',
        url: 'https://news.example/a',
        title: 'Новость',
        text: '  Важная мысль из статьи про то, как всё устроено.  ',
      }),
    )
    expect(input).toEqual({
      type: 'text',
      content: 'Важная мысль из статьи про то, как всё устроено.\n\nИсточник: https://news.example/a',
      status: 'inbox',
      source: 'extension',
    })
  })

  it('выделение без адреса источника — без строки «Источник»', () => {
    const input = extensionMessageToInput(parseExtensionMessage({ v: 1, kind: 'selection', text: 'Просто заметка' }))
    expect(input.content).toBe('Просто заметка')
  })

  it('ссылка в выделении → запись-ссылка', () => {
    const input = extensionMessageToInput(
      parseExtensionMessage({
        v: 1,
        kind: 'selection',
        url: 'https://page.example/',
        title: 'Страница',
        text: ' github.com/owner/repo ',
      }),
    )
    expect(input).toEqual({ type: 'link', url: 'https://github.com/owner/repo', status: 'inbox', source: 'extension' })
  })

  it('код в выделении → код с названием страницы, без источника', () => {
    const code = 'const x = 1;\nfunction sum(a, b) {\n  return a + b;\n}\nconsole.log(sum(x, 2));'
    const input = extensionMessageToInput(
      parseExtensionMessage({ v: 1, kind: 'selection', url: 'https://docs.example/js', title: 'Документация', text: code }),
    )
    expect(input.type).toBe('code')
    expect(input.title).toBe('Документация')
    expect(input.content).toBe(code)
    expect(input.content).not.toContain('Источник')
    expect(input.language).toBe('js')
    expect(input).toMatchObject({ status: 'inbox', source: 'extension' })
  })

  it('fenced-блок в выделении → содержимое без обёртки', () => {
    const input = extensionMessageToInput(
      parseExtensionMessage({ v: 1, kind: 'selection', text: '```python\nprint("hi")\n```' }),
    )
    expect(input).toEqual({
      type: 'code',
      content: 'print("hi")',
      language: 'python',
      status: 'inbox',
      source: 'extension',
    })
  })
})
