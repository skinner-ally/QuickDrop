import { describe, expect, it } from 'vitest'
import { findDuplicateLinkIn, linkKey, sameLink } from './dedupe'
import type { Item } from '@/types'

function makeLink(over: Partial<Item> = {}): Item {
  return {
    id: crypto.randomUUID(),
    type: 'link',
    title: '',
    content: '',
    url: 'https://example.com/a',
    categoryId: null,
    tags: [],
    links: [],
    status: 'inbox',
    favorite: 0,
    source: 'manual',
    createdAt: 1000,
    updatedAt: 1000,
    ...over,
  }
}

describe('linkKey', () => {
  it('собирает ключ: хост, нестандартный порт, путь, запрос, маршрут', () => {
    expect(linkKey('HTTPS://WWW.Example.com:8080/Path/?b=2&utm_source=x&a=1#frag')).toBe(
      'example.com:8080/Path?a=1&b=2',
    )
    expect(linkKey('https://example.com/')).toBe('example.com')
    expect(linkKey('  example.com/docs  ')).toBe('example.com/docs')
    expect(linkKey('ftp://ftp.example.com/pub/')).toBe('ftp://ftp.example.com/pub')
    expect(linkKey('https://app.example.com/#/inbox')).toBe('app.example.com#/inbox')
    expect(linkKey('https://app.example.com/x#!/page')).toBe('app.example.com/x#!/page')
    expect(linkKey('localhost:3000/a')).toBe('localhost:3000/a')
    expect(linkKey('http://[::1]:5173/')).toBe('[::1]:5173')
  })

  it('null — не http/https/ftp-адрес', () => {
    for (const raw of [
      '',
      '   ',
      'mailto:a@b.c',
      'tel:+123456',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,hi',
      'chrome://settings',
      'http://',
      'not a url',
      'C:\\Users\\me\\file.txt',
    ]) {
      expect(linkKey(raw), raw).toBeNull()
    }
  })
})

describe('sameLink', () => {
  const same: Array<[string, string, string]> = [
    ['регистр хоста', 'https://Example.COM/a', 'https://example.com/a'],
    ['www.', 'https://www.example.com/a', 'https://example.com/a'],
    ['http и https', 'http://example.com/a', 'https://example.com/a'],
    ['конечный /', 'https://example.com/a/', 'https://example.com/a'],
    ['несколько конечных /', 'https://example.com/a//', 'https://example.com/a'],
    ['корень', 'https://example.com/', 'https://example.com'],
    ['фрагмент', 'https://example.com/a#section-2', 'https://example.com/a'],
    ['utm_*', 'https://example.com/a?utm_source=news&utm_medium=email&utm_campaign=x', 'https://example.com/a'],
    ['utm_* в другом регистре', 'https://example.com/a?UTM_Source=news', 'https://example.com/a'],
    ['слежение рядом со значимым параметром', 'https://example.com/a?id=5&fbclid=abc', 'https://example.com/a?id=5'],
    ['порядок параметров', 'https://example.com/a?b=2&a=1', 'https://example.com/a?a=1&b=2'],
    ['кодирование пробела в значении', 'https://example.com/a?q=a%20b', 'https://example.com/a?q=a+b'],
    ['порт https по умолчанию', 'https://example.com:443/a', 'https://example.com/a'],
    ['порт http по умолчанию', 'http://example.com:80/a', 'http://example.com/a'],
    ['порт ftp по умолчанию', 'ftp://example.com:21/a', 'ftp://example.com/a'],
    ['адрес без схемы', 'example.com/a', 'https://example.com/a'],
    ['адрес без схемы с www', 'www.example.com/a', 'http://example.com/a/'],
    ['логин и пароль', 'https://user:secret@example.com/a', 'https://example.com/a'],
    ['точка в конце хоста', 'https://example.com./a', 'https://example.com/a'],
    ['пробелы по краям', '  https://example.com/a \n', 'https://example.com/a'],
    ['всё сразу', 'HTTP://WWW.Example.com:80/a/?utm_term=z&y=2&x=1#top', 'https://example.com/a?x=1&y=2'],
  ]
  it.each(same)('одинаковые: %s', (_name, a, b) => {
    expect(sameLink(a, b)).toBe(true)
    expect(sameLink(b, a)).toBe(true)
  })

  it('каждый параметр слежения отбрасывается', () => {
    const names = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
      'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'ysclid', 'mc_cid', 'mc_eid',
      '_ga', '_gl', 'igshid', 'igsh', 'ref_src', 'ref_url', '_hsenc', '_hsmi', 'mkt_tok',
    ]
    for (const name of names) {
      expect(sameLink(`https://example.com/a?${name}=1`, 'https://example.com/a'), name).toBe(true)
      expect(sameLink(`https://example.com/a?${name.toUpperCase()}=1&id=7`, 'https://example.com/a?id=7'), name).toBe(true)
    }
  })

  const different: Array<[string, string, string]> = [
    ['путь', 'https://example.com/a', 'https://example.com/b'],
    ['значимый параметр', 'https://example.com/a?id=1', 'https://example.com/a?id=2'],
    ['параметр есть и нет', 'https://example.com/a?id=1', 'https://example.com/a'],
    ['параметр, похожий на слежение', 'https://example.com/a?ref=1', 'https://example.com/a'],
    ['маршрут #/', 'https://example.com/#/inbox', 'https://example.com/#/library'],
    ['маршрут #/ и без него', 'https://example.com/#/inbox', 'https://example.com/'],
    ['маршрут #!', 'https://example.com/#!/a', 'https://example.com/#!/b'],
    ['регистр пути', 'https://example.com/Docs', 'https://example.com/docs'],
    ['нестандартный порт', 'https://example.com:8080/a', 'https://example.com/a'],
    ['разные порты', 'http://localhost:3000', 'http://localhost:5173'],
    ['ftp и https', 'ftp://example.com/a', 'https://example.com/a'],
    ['поддомен', 'https://m.example.com/a', 'https://example.com/a'],
    ['порядок значений одного параметра', 'https://example.com/a?t=1&t=2', 'https://example.com/a?t=2&t=1'],
    ['короткий адрес YouTube', 'https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
  ]
  it.each(different)('разные: %s', (_name, a, b) => {
    expect(sameLink(a, b)).toBe(false)
    expect(sameLink(b, a)).toBe(false)
  })

  it('не-адреса не равны ничему, в том числе друг другу', () => {
    expect(sameLink('', '')).toBe(false)
    expect(sameLink('mailto:a@b.c', 'mailto:a@b.c')).toBe(false)
    expect(sameLink('https://example.com', 'мусор без адреса')).toBe(false)
  })
})

describe('findDuplicateLinkIn', () => {
  it('находит запись по нормализованному адресу', () => {
    const a = makeLink({ url: 'https://www.example.com/a/?utm_source=x' })
    const other = makeLink({ url: 'https://example.com/b' })
    expect(findDuplicateLinkIn([other, a], 'http://example.com/a')).toBe(a)
    expect(findDuplicateLinkIn([other, a], 'example.com/c')).toBeUndefined()
    expect(findDuplicateLinkIn([], 'example.com/a')).toBeUndefined()
    expect(findDuplicateLinkIn([a], 'mailto:a@b.c')).toBeUndefined()
    expect(findDuplicateLinkIn([a], '')).toBeUndefined()
  })

  it('сначала не архивная, затем самая новая', () => {
    const archivedNew = makeLink({ status: 'archive', createdAt: 9000 })
    const libraryOld = makeLink({ status: 'library', createdAt: 1000 })
    const inboxNew = makeLink({ status: 'inbox', createdAt: 5000 })
    expect(findDuplicateLinkIn([archivedNew, libraryOld], 'example.com/a')).toBe(libraryOld)
    expect(findDuplicateLinkIn([archivedNew, libraryOld, inboxNew], 'example.com/a')).toBe(inboxNew)
    expect(findDuplicateLinkIn([inboxNew, libraryOld, archivedNew], 'example.com/a')).toBe(inboxNew)
    // Есть только архивные — возвращается новейшая из них.
    const archivedOld = makeLink({ status: 'archive', createdAt: 100 })
    expect(findDuplicateLinkIn([archivedOld, archivedNew], 'example.com/a')).toBe(archivedNew)
  })

  it('при равных датах результат не зависит от порядка списка', () => {
    const x = makeLink({ id: 'a-1' })
    const y = makeLink({ id: 'b-2' })
    expect(findDuplicateLinkIn([x, y], 'example.com/a')).toBe(x)
    expect(findDuplicateLinkIn([y, x], 'example.com/a')).toBe(x)
  })

  it('пропускает корзину, excludeId и записи без адреса', () => {
    const trashed = makeLink({ deletedAt: 5000, createdAt: 9000 })
    const self = makeLink({ createdAt: 8000 })
    const noUrl = makeLink({ url: undefined })
    const note = makeLink({ type: 'text', content: 'https://example.com/a' })
    const broken = makeLink({ url: 'not a url' })
    const older = makeLink({ createdAt: 10 })
    expect(findDuplicateLinkIn([trashed, self, noUrl, note, broken], 'example.com/a', self.id)).toBeUndefined()
    expect(findDuplicateLinkIn([trashed, self, older], 'example.com/a', self.id)).toBe(older)
    expect(findDuplicateLinkIn([trashed, self, older], 'example.com/a')).toBe(self)
  })
})
