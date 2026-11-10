import { beforeEach, describe, expect, it } from 'vitest'
import type { Category, Item } from '@/types'
import { matchesFilter as repoMatchesFilter } from '@/db/repo'
import {
  getSearchIndexStats,
  highlight,
  makeSnippet,
  matchesFilter,
  parseQuery,
  prepareSearchIndex,
  resetSearchIndex,
  searchItems,
} from './index'

let seq = 0
function makeItem(patch: Partial<Item> = {}): Item {
  seq++
  return {
    id: `item-${seq}`,
    type: 'text',
    title: '',
    content: '',
    categoryId: null,
    tags: [],
    links: [],
    status: 'inbox',
    favorite: 0,
    source: 'manual',
    createdAt: 1_000_000 + seq,
    updatedAt: 1_000_000 + seq,
    ...patch,
  }
}

const cat = (id: string, name: string, order = 0): Category => ({
  id,
  name,
  color: 'blue',
  order,
  createdAt: 0,
})

const ids = (hits: { item: Item }[]) => hits.map((h) => h.item.id)
const joined = (parts: { text: string }[]) => parts.map((p) => p.text).join('')
const hitTexts = (parts: { text: string; hit: boolean }[]) => parts.filter((p) => p.hit).map((p) => p.text)

beforeEach(() => resetSearchIndex())

describe('parseQuery', () => {
  it('простой текст без операторов', () => {
    expect(parseQuery('  react   хуки ')).toEqual({ text: 'react хуки', phrases: [], filter: {} })
    expect(parseQuery('')).toEqual({ text: '', phrases: [], filter: {} })
  })

  it('tag: и #: несколько тегов, нормализация, без дублей', () => {
    const q = parseQuery('tag:React #JS #react tag:web,css #"мой тег" #заметки,')
    expect(q.filter.tags).toEqual(['react', 'js', 'web', 'css', 'мой-тег', 'заметки'])
    expect(q.text).toBe('')
  })

  it('type: английские значения, русские синонимы, перечисление через запятую', () => {
    expect(parseQuery('type:link').filter.types).toEqual(['link'])
    expect(parseQuery('type:ссылка type:Код').filter.types).toEqual(['link', 'code'])
    expect(parseQuery('type:текст,идея,файл').filter.types).toEqual(['text', 'idea', 'file'])
    expect(parseQuery('type:изображение').filter.types).toEqual(['image'])
    expect(parseQuery('type:картинка').filter.types).toEqual(['image'])
    expect(parseQuery('тип:ссылка').filter.types).toEqual(['link'])
  })

  it('неизвестное значение type: остаётся текстом', () => {
    const q = parseQuery('type:pdf отчёт')
    expect(q.filter.types).toBeUndefined()
    expect(q.text).toBe('type:pdf отчёт')
  })

  it('is: избранное, статусы, без тегов', () => {
    expect(parseQuery('is:fav').filter).toEqual({ favorite: true })
    expect(parseQuery('is:favorite').filter).toEqual({ favorite: true })
    expect(parseQuery('is:inbox').filter).toEqual({ status: 'inbox' })
    expect(parseQuery('is:library').filter).toEqual({ status: 'library' })
    expect(parseQuery('is:archive').filter).toEqual({ status: 'archive' })
    expect(parseQuery('is:inbox is:archive').filter).toEqual({ status: ['inbox', 'archive'] })
    expect(parseQuery('is:untagged').filter).toEqual({ untagged: true })
    expect(parseQuery('IS:FAV').filter).toEqual({ favorite: true })
  })

  it('has:file → файлы и изображения, объединяется с type:', () => {
    expect(parseQuery('has:file').filter.types).toEqual(['file', 'image'])
    expect(parseQuery('type:link has:file').filter.types).toEqual(['link', 'file', 'image'])
  })

  it('cat: простое имя и в кавычках', () => {
    expect(parseQuery('cat:работа').categoryName).toBe('работа')
    expect(parseQuery('cat:"мои проекты" дизайн')).toEqual({
      text: 'дизайн',
      phrases: [],
      filter: {},
      categoryName: 'мои проекты',
    })
    expect(parseQuery('cat:«Мои  проекты»').categoryName).toBe('Мои проекты')
    expect(parseQuery('react').categoryName).toBeUndefined()
  })

  it('точные фразы в кавычках', () => {
    const q = parseQuery('"быстрый   поиск" индекс «точная фраза»')
    expect(q.phrases).toEqual(['быстрый поиск', 'точная фраза'])
    expect(q.text).toBe('индекс')
  })

  it('незакрытая кавычка — фраза до конца строки', () => {
    expect(parseQuery('foo "bar baz').phrases).toEqual(['bar baz'])
    expect(parseQuery('foo "bar baz').text).toBe('foo')
  })

  it('URL, время и неизвестные операторы остаются текстом', () => {
    const q = parseQuery('https://example.com/a?b=c 10:30 note: foo:bar')
    expect(q.text).toBe('https://example.com/a?b=c 10:30 note: foo:bar')
    expect(q.filter).toEqual({})
  })

  it('оператор без значения (в процессе набора) игнорируется', () => {
    expect(parseQuery('react tag:')).toEqual({ text: 'react', phrases: [], filter: {} })
    expect(parseQuery('# type: is:')).toEqual({ text: '', phrases: [], filter: {} })
  })

  it('прототипные ключи не считаются операторами', () => {
    expect(parseQuery('constructor:x type:toString').text).toBe('constructor:x type:toString')
  })

  it('смешанный ввод', () => {
    const q = parseQuery('react #js type:код is:fav "use effect" cat:"Мои проекты" хуки is:library has:file')
    expect(q).toEqual({
      text: 'react хуки',
      phrases: ['use effect'],
      filter: { tags: ['js'], types: ['code', 'file', 'image'], favorite: true, status: 'library' },
      categoryName: 'Мои проекты',
    })
  })
})

describe('matchesFilter', () => {
  const base = makeItem({ status: 'library', tags: ['a', 'b'], categoryId: 'c1', favorite: 1, createdAt: 100 })

  it('статус значением и массивом', () => {
    expect(matchesFilter(base, { status: 'library' })).toBe(true)
    expect(matchesFilter(base, { status: 'inbox' })).toBe(false)
    expect(matchesFilter(base, { status: ['inbox', 'library'] })).toBe(true)
    expect(matchesFilter(base, { status: [] })).toBe(true)
  })

  it('категория: id, null = без категории', () => {
    expect(matchesFilter(base, { categoryId: 'c1' })).toBe(true)
    expect(matchesFilter(base, { categoryId: null })).toBe(false)
    expect(matchesFilter(makeItem(), { categoryId: null })).toBe(true)
  })

  it('теги (все), избранное, без тегов, диапазон дат, типы', () => {
    expect(matchesFilter(base, { tags: ['a', 'b'] })).toBe(true)
    expect(matchesFilter(base, { tags: ['a', 'x'] })).toBe(false)
    expect(matchesFilter(base, { favorite: true })).toBe(true)
    // favorite — галочка: false значит «не фильтровать», как и в repo.matchesFilter.
    expect(matchesFilter(base, { favorite: false })).toBe(true)
    expect(matchesFilter(makeItem(), { favorite: true })).toBe(false)
    expect(matchesFilter(base, { untagged: true })).toBe(false)
    expect(matchesFilter(makeItem(), { untagged: true })).toBe(true)
    expect(matchesFilter(makeItem({ categoryId: 'c1' }), { untagged: true })).toBe(false)
    expect(matchesFilter(base, { from: 100, to: 100 })).toBe(true)
    expect(matchesFilter(base, { from: 101 })).toBe(false)
    expect(matchesFilter(base, { to: 99 })).toBe(false)
    expect(matchesFilter(base, { types: ['text', 'code'] })).toBe(true)
    expect(matchesFilter(base, { types: ['link'] })).toBe(false)
  })

  it('одна реализация с repo: теги фильтра нормализуются, пустые пропускаются, ё = е', () => {
    expect(matchesFilter).toBe(repoMatchesFilter)
    const item = makeItem({ tags: ['react', 'отчёты'] })
    expect(matchesFilter(item, { tags: ['React'] })).toBe(true)
    expect(matchesFilter(item, { tags: ['#react'] })).toBe(true)
    expect(matchesFilter(item, { tags: [''] })).toBe(true)
    expect(matchesFilter(item, { tags: ['отчеты'] })).toBe(true)
    expect(matchesFilter(makeItem({ tags: ['отчеты'] }), { tags: ['Отчёты'] })).toBe(true)
    expect(matchesFilter(item, { tags: ['отчет'] })).toBe(false)
  })

  it('запись без tags/categoryId (повреждённая) не роняет фильтр', () => {
    const broken = { ...makeItem(), tags: undefined, categoryId: undefined } as unknown as Item
    expect(matchesFilter(broken, { tags: ['a'] })).toBe(false)
    expect(matchesFilter(broken, { untagged: true, categoryId: null })).toBe(true)
  })
})

describe('searchItems — текст', () => {
  const prog = makeItem({ title: 'Программирование на Rust', content: 'Заметки о владении и заимствовании' })
  const tree = makeItem({ title: 'Ёлка на Новый год', content: 'Купить гирлянду' })
  const tree2 = makeItem({ title: 'Еловые ветки', content: 'ёжик в тумане' })
  const link = makeItem({
    type: 'link',
    url: 'https://github.com/lucaong/minisearch',
    linkMeta: { status: 'ok', title: 'MiniSearch library', description: 'Tiny full-text search engine', siteName: 'GitHub' },
  })
  const code = makeItem({ type: 'code', language: 'typescript', content: 'const items = useLiveQuery(() => db.items.toArray())\nconst snake_case_name = 1' })
  const file = makeItem({ type: 'file', fileName: 'Отчёт_квартал.pdf', content: '' })
  const all = [prog, tree, tree2, link, code, file]

  it('префиксный поиск по-русски, без учёта регистра', () => {
    expect(ids(searchItems(all, 'прогр'))).toEqual([prog.id])
    expect(ids(searchItems(all, 'ПРОГРАММ'))).toEqual([prog.id])
    expect(ids(searchItems(all, 'заимств'))).toEqual([prog.id])
  })

  it('опечатки (fuzzy) для слов от 4 букв', () => {
    expect(ids(searchItems(all, 'програмирование'))).toEqual([prog.id])
    expect(ids(searchItems(all, 'гирлянди'))).toEqual([tree.id])
  })

  it('ё = е в обе стороны', () => {
    expect(ids(searchItems(all, 'елка'))).toEqual([tree.id])
    expect(ids(searchItems(all, 'ёлка'))).toEqual([tree.id])
    expect(ids(searchItems(all, 'еловые'))).toEqual([tree2.id])
    expect(ids(searchItems(all, 'ежик'))).toEqual([tree2.id])
  })

  it('все слова обязательны (AND)', () => {
    expect(ids(searchItems(all, 'ёлка гирлянду'))).toEqual([tree.id])
    expect(searchItems(all, 'ёлка rust')).toEqual([])
  })

  it('ищет по url, метаданным ссылки, имени файла, языку', () => {
    expect(ids(searchItems(all, 'github.com'))).toEqual([link.id])
    expect(ids(searchItems(all, 'lucaong'))).toEqual([link.id])
    expect(ids(searchItems(all, 'tiny engine'))).toEqual([link.id])
    expect(ids(searchItems(all, 'отчет'))).toEqual([file.id])
    expect(ids(searchItems(all, 'квартал pdf'))).toEqual([file.id])
    expect(ids(searchItems(all, 'typescript'))).toEqual([code.id])
  })

  it('код: camelCase и snake_case', () => {
    expect(ids(searchItems(all, 'useLiveQuery'))).toEqual([code.id])
    expect(ids(searchItems(all, 'livequery'))).toEqual([code.id])
    expect(ids(searchItems(all, 'query'))).toEqual([code.id])
    expect(ids(searchItems(all, 'snake_case_name'))).toEqual([code.id])
  })

  it('ищет по тегам и имени категории', () => {
    const cats = [cat('c-work', 'Работа')]
    const a = makeItem({ title: 'Созвон', tags: ['встречи'] })
    const b = makeItem({ title: 'Отчёт', categoryId: 'c-work' })
    expect(ids(searchItems([a, b], 'встреч', cats))).toEqual([a.id])
    expect(ids(searchItems([a, b], 'работа', cats))).toEqual([b.id])
  })

  it('совпадение в заголовке весит больше, чем в тексте', () => {
    const inContent = makeItem({ title: 'Разное', content: 'немного про кофе и чай' })
    const inTitle = makeItem({ title: 'Кофе', content: 'обжарка зерна' })
    const hits = searchItems([inContent, inTitle], 'кофе')
    expect(ids(hits)).toEqual([inTitle.id, inContent.id])
    expect(hits[0].score).toBeGreaterThan(hits[1].score)
  })

  it('terms: совпавшие термины документа + слова запроса', () => {
    const [hit] = searchItems(all, 'прогр')
    expect(hit.terms).toContain('программирование')
    expect(hit.terms).toContain('прогр')
    const [fuzzy] = searchItems(all, 'програмирование')
    expect(fuzzy.terms).toContain('программирование')
  })

  it('пустой текст — все записи, score 0, terms [], исходный порядок', () => {
    const hits = searchItems(all, '   ')
    expect(ids(hits)).toEqual(ids(all.map((item) => ({ item }))))
    expect(hits.every((h) => h.score === 0 && h.terms.length === 0)).toBe(true)
    // Только пунктуация — тоже «пустой» текст.
    expect(searchItems(all, '!!! ---')).toHaveLength(all.length)
  })
})

describe('searchItems — фильтры, категории, фразы', () => {
  const cats = [cat('c1', 'Мои проекты'), cat('c2', 'Ёжики')]
  const a = makeItem({ type: 'link', title: 'React docs', url: 'https://react.dev', status: 'library', favorite: 1, tags: ['react', 'docs'], categoryId: 'c1' })
  const b = makeItem({ type: 'text', title: 'React хуки', content: 'Быстрый  поиск по\nиндексу', status: 'inbox', tags: ['react'] })
  const c = makeItem({ type: 'image', title: 'Скриншот', fileName: 'shot.png', status: 'archive', categoryId: 'c2' })
  const d = makeItem({ type: 'file', title: 'Договор', fileName: 'contract.pdf', status: 'library' })
  const all = [a, b, c, d]

  it('#тег и tag: следуют правилу ё = е, как и текстовый поиск', () => {
    const r = makeItem({ title: 'Топ клиентов', tags: ['sql', 'отчёты'] })
    const list = [r, b]
    expect(ids(searchItems(list, 'отчеты'))).toEqual([r.id])
    expect(ids(searchItems(list, '#отчеты'))).toEqual([r.id])
    expect(ids(searchItems(list, 'tag:отчеты'))).toEqual([r.id])
    expect(ids(searchItems(list, '#Отчёты'))).toEqual([r.id])
  })

  it('операторы без текста фильтруют', () => {
    expect(ids(searchItems(all, 'type:link'))).toEqual([a.id])
    expect(ids(searchItems(all, 'is:fav'))).toEqual([a.id])
    expect(ids(searchItems(all, '#react'))).toEqual([a.id, b.id])
    expect(ids(searchItems(all, 'tag:react tag:docs'))).toEqual([a.id])
    expect(ids(searchItems(all, 'has:file'))).toEqual([c.id, d.id])
    expect(ids(searchItems(all, 'is:inbox is:archive'))).toEqual([b.id, c.id])
    expect(ids(searchItems(all, 'is:untagged'))).toEqual([d.id])
  })

  it('фильтры + текст', () => {
    expect(ids(searchItems(all, 'react type:text'))).toEqual([b.id])
    expect(ids(searchItems(all, 'react is:library'))).toEqual([a.id])
    expect(searchItems(all, 'react is:archive')).toEqual([])
  })

  it('cat: по имени без учёта регистра, ё/е и дефисов; неизвестная — ничего', () => {
    expect(ids(searchItems(all, 'cat:"мои проекты"', cats))).toEqual([a.id])
    expect(ids(searchItems(all, 'cat:мои-проекты', cats))).toEqual([a.id])
    expect(ids(searchItems(all, 'cat:ежики', cats))).toEqual([c.id])
    expect(searchItems(all, 'cat:несуществующая', cats)).toEqual([])
    expect(searchItems(all, 'cat:работа')).toEqual([])
    expect(ids(searchItems(all, 'cat:none', cats))).toEqual([b.id, d.id])
  })

  it('точные фразы: подстрока, регистр и пробелы не важны, ё=е', () => {
    expect(ids(searchItems(all, '"быстрый поиск"'))).toEqual([b.id])
    expect(ids(searchItems(all, '"БЫСТРЫЙ ПОИСК ПО ИНДЕКСУ"'))).toEqual([b.id])
    expect(ids(searchItems(all, '"ыстрый пои"'))).toEqual([b.id])
    expect(searchItems(all, '"поиск быстрый"')).toEqual([])
    expect(ids(searchItems(all, '"ежики"', cats))).toEqual([c.id])
  })

  it('фраза + текст + фильтр', () => {
    expect(ids(searchItems(all, 'react "быстрый поиск" is:inbox'))).toEqual([b.id])
    expect(searchItems(all, 'react "быстрый поиск" is:library')).toEqual([])
    const [hit] = searchItems(all, '"быстрый поиск"')
    expect(hit.score).toBe(0)
    expect(hit.terms).toEqual(['быстрый', 'поиск'])
  })

  it('фраза не склеивается из соседних полей', () => {
    const x = makeItem({ title: 'альфа', content: 'бета' })
    expect(searchItems([x], '"альфа бета"')).toEqual([])
  })
})

describe('searchItems — инкрементальный кэш индекса', () => {
  it('изменение, удаление и добавление записей применяются точечно', () => {
    const a = makeItem({ title: 'Первая заметка про котов' })
    const b = makeItem({ title: 'Вторая заметка про собак' })
    const c = makeItem({ title: 'Третья заметка про птиц' })
    let items = [a, b, c]

    expect(ids(searchItems(items, 'заметка'))).toHaveLength(3)
    expect(getSearchIndexStats()).toMatchObject({ size: 3, rebuilt: true })

    // Повторный поиск по тем же данным ничего не переиндексирует.
    searchItems(items, 'котов')
    expect(getSearchIndexStats()).toMatchObject({ size: 3, added: 0, replaced: 0, discarded: 0, rebuilt: false })

    // Изменили запись (новый updatedAt).
    const b2 = { ...b, title: 'Вторая заметка про хомяков', updatedAt: b.updatedAt + 10 }
    items = [a, b2, c]
    expect(ids(searchItems(items, 'хомяков'))).toEqual([b.id])
    expect(getSearchIndexStats()).toMatchObject({ size: 3, added: 0, replaced: 1, discarded: 0, rebuilt: false })
    expect(searchItems(items, 'собак')).toEqual([])
    // Результат ссылается на актуальный объект записи.
    expect(searchItems(items, 'хомяков')[0].item).toBe(b2)

    // Удалили запись.
    items = [a, b2]
    expect(searchItems(items, 'птиц')).toEqual([])
    expect(getSearchIndexStats()).toMatchObject({ size: 2, added: 0, replaced: 0, discarded: 1, rebuilt: false })

    // Добавили запись.
    const d = makeItem({ title: 'Четвёртая заметка про рыб' })
    items = [a, b2, d]
    expect(ids(searchItems(items, 'рыб'))).toEqual([d.id])
    expect(getSearchIndexStats()).toMatchObject({ size: 3, added: 1, replaced: 0, discarded: 0, rebuilt: false })
  })

  it('без смены updatedAt запись не переиндексируется (сравнение по id+updatedAt)', () => {
    const a = makeItem({ title: 'Старый заголовок' })
    searchItems([a], 'старый')
    const same = { ...a, title: 'Новый заголовок' }
    searchItems([same], 'новый')
    expect(getSearchIndexStats()).toMatchObject({ replaced: 0, added: 0 })
  })

  it('переименование категории переиндексирует только её записи', () => {
    const a = makeItem({ title: 'Задача', categoryId: 'c1' })
    const b = makeItem({ title: 'Задача', categoryId: 'c2' })
    const v1 = [cat('c1', 'Работа'), cat('c2', 'Дом')]
    expect(ids(searchItems([a, b], 'работа', v1))).toEqual([a.id])

    const v2 = [cat('c1', 'Офис'), cat('c2', 'Дом')]
    expect(ids(searchItems([a, b], 'офис', v2))).toEqual([a.id])
    expect(getSearchIndexStats()).toMatchObject({ replaced: 1, added: 0, discarded: 0 })
    expect(searchItems([a, b], 'работа', v2)).toEqual([])
  })

  it('фразы видят изменённые данные', () => {
    const a = makeItem({ content: 'красная машина' })
    expect(ids(searchItems([a], '"красная машина"'))).toEqual([a.id])
    const a2 = { ...a, content: 'синяя машина', updatedAt: a.updatedAt + 1 }
    expect(searchItems([a2], '"красная машина"')).toEqual([])
    expect(ids(searchItems([a2], '"синяя машина"'))).toEqual([a.id])
  })

  it('prepareSearchIndex строит индекс заранее, поиск потом ничего не добавляет', () => {
    const a = makeItem({ title: 'Заранее' })
    prepareSearchIndex([a])
    expect(getSearchIndexStats()).toMatchObject({ size: 1, rebuilt: true })
    expect(ids(searchItems([a], 'заранее'))).toEqual([a.id])
    expect(getSearchIndexStats()).toMatchObject({ added: 0, replaced: 0, rebuilt: false })
  })

  it('дубликаты id во входных данных не ломают индекс', () => {
    const a = makeItem({ title: 'Дубль' })
    expect(ids(searchItems([a, a], 'дубль'))).toEqual([a.id])
  })

  it('within сужает выдачу, а индекс остаётся синхронизирован со всеми записями', () => {
    const all = Array.from({ length: 120 }, (_, i) =>
      makeItem({ title: `react заметка ${i}`, status: i < 20 ? 'inbox' : 'library' }),
    )
    const inbox = all.filter((it) => it.status === 'inbox')
    const library = all.filter((it) => it.status === 'library')

    prepareSearchIndex(all)
    expect(getSearchIndexStats()).toMatchObject({ size: 120, rebuilt: true })

    expect(searchItems(all, 'react', [], { within: inbox })).toHaveLength(20)
    expect(getSearchIndexStats()).toMatchObject({ size: 120, added: 0, replaced: 0, discarded: 0, rebuilt: false })

    // Смена раздела: индекс не трогается вовсе.
    expect(searchItems(all, 'react', [], { within: library })).toHaveLength(100)
    expect(getSearchIndexStats()).toMatchObject({ size: 120, added: 0, replaced: 0, discarded: 0, rebuilt: false })

    // Фразы тоже ищутся внутри within.
    expect(ids(searchItems(all, '"заметка 5"', [], { within: inbox }))).toEqual([all[5].id])
  })

  it('within без текста сохраняет свой порядок', () => {
    const a = makeItem({ title: 'a' })
    const b = makeItem({ title: 'b' })
    const c = makeItem({ title: 'c' })
    expect(ids(searchItems([a, b, c], '', [], { within: [c, a] }))).toEqual([c.id, a.id])
    expect(ids(searchItems([a, b, c], '!!!', [], { within: [c, a] }))).toEqual([c.id, a.id])
  })
})

describe('highlight', () => {
  it('выделяет префикс слова, сохраняя исходный текст', () => {
    expect(highlight('Hello world', ['wor'])).toEqual([
      { text: 'Hello ', hit: false },
      { text: 'wor', hit: true },
      { text: 'ld', hit: false },
    ])
  })

  it('регистр и ё/е не важны, найденное — в исходном написании', () => {
    // «ёлочка» не начинается с «елк» — не выделяется.
    const parts = highlight('Ёлка и ЕЛКА, ёлочка', ['елк'])
    expect(hitTexts(parts)).toEqual(['Ёлк', 'ЕЛК'])
    expect(joined(parts)).toBe('Ёлка и ЕЛКА, ёлочка')
    expect(hitTexts(highlight('Ежик', ['ЁЖ']))).toEqual(['Еж'])
  })

  it('совпадение только с начала слова', () => {
    expect(highlight('проспект', ['спект'])).toEqual([{ text: 'проспект', hit: false }])
  })

  it('самый длинный термин побеждает, соседние совпадения склеиваются', () => {
    const parts = highlight('Программирование и прогулка', ['прог', 'программирование'])
    expect(hitTexts(parts)).toEqual(['Программирование', 'прог'])
    expect(joined(parts)).toBe('Программирование и прогулка')
  })

  it('части camelCase и URL', () => {
    expect(hitTexts(highlight('const x = useLiveQuery()', ['query']))).toEqual(['Query'])
    expect(hitTexts(highlight('https://github.com/lucaong', ['github', 'luca']))).toEqual(['github', 'luca'])
  })

  it('без терминов — один фрагмент; пустой текст — пусто', () => {
    expect(highlight('текст', [])).toEqual([{ text: 'текст', hit: false }])
    expect(highlight('текст', ['', '  '])).toEqual([{ text: 'текст', hit: false }])
    expect(highlight('', ['a'])).toEqual([])
  })

  it('NFD-текст (macOS) подсвечивается и сохраняется', () => {
    const nfd = 'Йод и ёж'.normalize('NFD')
    const parts = highlight(nfd, ['йод', 'еж'])
    expect(joined(parts)).toBe(nfd)
    expect(hitTexts(parts).map((t) => t.normalize('NFC'))).toEqual(['Йод', 'ёж'])
  })
})

describe('makeSnippet', () => {
  const long =
    'Начало длинного текста. ' +
    'Здесь много вводных слов, которые не относятся к делу и нужны только для объёма. '.repeat(4) +
    'А вот тут встречается   важное\n\nсловосочетание про индексацию. ' +
    'Дальше снова идёт наполнение текста без какого-либо смысла, чтобы фрагмент обрезался. '.repeat(3)

  it('короткий content целиком, пробелы схлопнуты', () => {
    const item = makeItem({ content: '  Строка 1\n\n   строка   2  ' })
    expect(makeSnippet(item, [])).toBe('Строка 1 строка 2')
  })

  it('окно вокруг первого совпадения с многоточиями', () => {
    const item = makeItem({ content: long })
    const s = makeSnippet(item, ['индексац'], 120)
    expect(s.length).toBeLessThanOrEqual(120)
    expect(s.startsWith('…')).toBe(true)
    expect(s.endsWith('…')).toBe(true)
    expect(s).toContain('индексацию')
    expect(s).toContain('важное словосочетание')
  })

  it('без совпадений — начало текста', () => {
    const item = makeItem({ content: long })
    const s = makeSnippet(item, ['отсутствует'])
    expect(s.startsWith('Начало длинного текста.')).toBe(true)
    expect(s.endsWith('…')).toBe(true)
    expect(s.length).toBeLessThanOrEqual(160)
  })

  it('совпадение в начале — без ведущего многоточия', () => {
    const item = makeItem({ content: long })
    const s = makeSnippet(item, ['начало'], 80)
    expect(s.startsWith('Начало')).toBe(true)
    expect(s.length).toBeLessThanOrEqual(80)
  })

  it('берёт описание ссылки, если в content нет совпадения или он пуст', () => {
    const link = makeItem({
      type: 'link',
      content: 'мой комментарий',
      linkMeta: { status: 'ok', description: 'Официальная документация по React и хукам' },
    })
    expect(makeSnippet(link, ['хук'])).toBe('Официальная документация по React и хукам')
    expect(makeSnippet(link, ['коммент'])).toBe('мой комментарий')
    const empty = makeItem({ type: 'link', linkMeta: { status: 'ok', description: 'Описание' } })
    expect(makeSnippet(empty, [])).toBe('Описание')
    expect(makeSnippet(makeItem({ type: 'file' }), ['x'])).toBe('')
  })
})

describe('производительность', () => {
  it('5000 записей: поиск после прогрева быстрее 500 мс (цель < 100 мс)', () => {
    const words = [
      'проект', 'задача', 'встреча', 'идея', 'статья', 'ссылка', 'документация', 'программирование',
      'дизайн', 'интерфейс', 'поиск', 'индекс', 'заметка', 'рецепт', 'путешествие', 'книга', 'фильм',
      'react', 'typescript', 'rust', 'database', 'search', 'design', 'travel', 'music', 'ёлка', 'кофе',
    ]
    let rnd = 42
    const next = () => {
      rnd = (rnd * 1103515245 + 12345) % 2147483648
      return rnd
    }
    const phrase = (n: number) => Array.from({ length: n }, () => words[next() % words.length]).join(' ')
    const types = ['text', 'link', 'code', 'idea', 'file', 'image'] as const
    const items: Item[] = Array.from({ length: 5000 }, (_, i) =>
      makeItem({
        type: types[i % types.length],
        title: phrase(4) + ` №${i}`,
        content: phrase(40),
        tags: [words[next() % words.length], words[next() % words.length]],
        url: i % 6 === 1 ? `https://example${i}.com/${phrase(2).replace(/ /g, '/')}` : undefined,
        status: (['inbox', 'library', 'archive'] as const)[i % 3],
      }),
    )

    searchItems(items, 'прогрев') // построение индекса
    const queries = ['програм', 'проект встреча', 'рецепт is:inbox', 'typescript type:code', 'документаця', 'елка кофе']
    const t0 = performance.now()
    for (const q of queries) searchItems(items, q)
    const avg = (performance.now() - t0) / queries.length
    expect(avg).toBeLessThan(500)
    expect(searchItems(items, 'програм').length).toBeGreaterThan(0)
  })
})
