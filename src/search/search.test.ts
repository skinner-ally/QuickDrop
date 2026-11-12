import { beforeEach, describe, expect, it } from 'vitest'
import type { Category, Item, ItemFilter } from '@/types'
import { matchesFilter as repoMatchesFilter } from '@/db/repo'
import { endOfDay, relativeRange, startOfDay } from '@/lib/dates'
import {
  composeQuery,
  getSearchIndexStats,
  highlight,
  isSearchIndexReady,
  makeSnippet,
  matchesFilter,
  matchesFilterIgnoringTrash,
  parseQuery,
  prepareSearchIndex,
  prepareSearchIndexAsync,
  resetSearchIndex,
  resolveQueryFilter,
  searchItems,
  serializeFilter,
  renameQueryOperators,
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

  it('prepareSearchIndexAsync строит индекс порциями, поиск по тому же набору берёт готовый', async () => {
    const cats = [cat('c1', 'Работа')]
    const big = 'слово '.repeat(15_000)
    const items = [
      ...Array.from({ length: 250 }, (_, i) => makeItem({ title: `заметка ${i}`, categoryId: i % 2 ? 'c1' : null })),
      ...Array.from({ length: 5 }, () => makeItem({ type: 'file', ocrText: `${big} редкое`, ocrAt: 5 })),
    ]
    const pending = prepareSearchIndexAsync(items, cats)
    // Порции идут с передачей управления: синхронно индекс не готов.
    expect(isSearchIndexReady()).toBe(false)
    expect(prepareSearchIndexAsync(items, cats)).toBe(pending)
    await pending
    expect(isSearchIndexReady()).toBe(true)
    expect(getSearchIndexStats()).toMatchObject({ size: 255, rebuilt: true })

    expect(searchItems(items, 'работа заметка', cats)).toHaveLength(125)
    expect(getSearchIndexStats()).toMatchObject({ size: 255, added: 0, replaced: 0, discarded: 0, rebuilt: false })
    expect(searchItems(items, 'редкое', cats)).toHaveLength(5)
    await prepareSearchIndexAsync(items, cats)
    expect(getSearchIndexStats()).toMatchObject({ rebuilt: false })
  })

  it('prepareSearchIndexAsync: сброс или поиск во время построения — построенный заранее индекс не ставится', async () => {
    const items = Array.from({ length: 300 }, (_, i) => makeItem({ title: `кот ${i}` }))
    const reset = prepareSearchIndexAsync(items)
    resetSearchIndex()
    await reset
    expect(isSearchIndexReady()).toBe(false)

    const raced = prepareSearchIndexAsync(items)
    const fresh = [makeItem({ title: 'пёс' })]
    expect(ids(searchItems(fresh, 'пёс'))).toEqual([fresh[0].id])
    await raced
    expect(getSearchIndexStats().size).toBe(1)
    expect(searchItems(fresh, 'кот')).toEqual([])
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

// ───────────────────────── даты, корзина, сериализация фильтра, распознанный текст ─────────────────────────

// Ожидаемые значения строятся через new Date(y, m, d): тесты не зависят от часового пояса.
const at = (y: number, m: number, d: number, h = 0, min = 0, s = 0, ms = 0) =>
  new Date(y, m, d, h, min, s, ms).getTime()
const dayOf = (y: number, m: number, d: number) => ({ from: at(y, m, d), to: at(y, m, d + 1) - 1 })
/** Среда, 11 ноября 2026, 15:30 по местному времени. */
const NOW = at(2026, 10, 11, 15, 30)

describe('parseQuery — даты', () => {
  it('каждый формат даты-литерала', () => {
    const nov5 = dayOf(2026, 10, 5)
    for (const q of [
      'date:2026-11-05',
      'date:2026-11-5',
      'date:05.11.2026',
      'date:5.11.2026',
      'дата:2026-11-05',
      'DATE:2026-11-05',
      'date:"2026-11-05"',
    ]) {
      expect(parseQuery(q, NOW), q).toEqual({ text: '', phrases: [], filter: nov5 })
    }
    const nov = { from: at(2026, 10, 1), to: at(2026, 11, 1) - 1 }
    expect(parseQuery('date:2026-11', NOW).filter).toEqual(nov)
    expect(parseQuery('date:11.2026', NOW).filter).toEqual(nov)
    expect(parseQuery('date:2026', NOW).filter).toEqual({ from: at(2026, 0, 1), to: at(2027, 0, 1) - 1 })
  })

  it('периоды считаются от now, по-английски и по-русски', () => {
    const end = at(2026, 10, 12) - 1
    const cases: Array<[string[], { from: number; to: number }]> = [
      [['today', 'сегодня', 'Today'], dayOf(2026, 10, 11)],
      [['yesterday', 'вчера'], dayOf(2026, 10, 10)],
      [['week', 'неделя'], { from: at(2026, 10, 5), to: end }],
      [['month', 'месяц'], { from: at(2026, 9, 13), to: end }],
      [['year', 'год'], { from: at(2025, 10, 12), to: end }],
    ]
    for (const [names, range] of cases) {
      for (const name of names) expect(parseQuery(`date:${name}`, NOW).filter, name).toEqual(range)
    }
    // Другое «сейчас» — другой отрезок.
    expect(parseQuery('date:today', at(2027, 0, 1, 0, 0)).filter).toEqual(dayOf(2027, 0, 1))
    expect(parseQuery('date:yesterday', at(2027, 0, 1, 0, 0)).filter).toEqual(dayOf(2026, 11, 31))
  })

  it('now по умолчанию — текущее время', () => {
    const before = Date.now()
    const { from, to } = parseQuery('date:today').filter
    const after = Date.now()
    expect([startOfDay(before), startOfDay(after)]).toContain(from)
    expect([endOfDay(before), endOfDay(after)]).toContain(to)
  })

  it('after: и before: включают указанный день, месяц, год', () => {
    for (const key of ['after', 'since', 'после', 'AFTER']) {
      expect(parseQuery(`${key}:2026-11-05`, NOW), key).toEqual({ text: '', phrases: [], filter: { from: at(2026, 10, 5) } })
    }
    for (const key of ['before', 'until', 'до', 'Before']) {
      expect(parseQuery(`${key}:2026-11-05`, NOW), key).toEqual({ text: '', phrases: [], filter: { to: at(2026, 10, 6) - 1 } })
    }
    expect(parseQuery('after:2026-11', NOW).filter).toEqual({ from: at(2026, 10, 1) })
    expect(parseQuery('before:11.2026', NOW).filter).toEqual({ to: at(2026, 11, 1) - 1 })
    expect(parseQuery('after:2026', NOW).filter).toEqual({ from: at(2026, 0, 1) })
    expect(parseQuery('before:2026', NOW).filter).toEqual({ to: at(2027, 0, 1) - 1 })
    // Периоды: after — с начала периода, before — по его конец.
    expect(parseQuery('after:week', NOW).filter).toEqual({ from: at(2026, 10, 5) })
    expect(parseQuery('before:вчера', NOW).filter).toEqual({ to: at(2026, 10, 11) - 1 })
    expect(parseQuery('после:сегодня', NOW).filter).toEqual({ from: at(2026, 10, 11) })
  })

  it('диапазон A..B: от начала A до конца B', () => {
    expect(parseQuery('date:2026-11-01..2026-11-05', NOW).filter).toEqual({ from: at(2026, 10, 1), to: at(2026, 10, 6) - 1 })
    expect(parseQuery('date:01.11.2026..2026-12', NOW).filter).toEqual({ from: at(2026, 10, 1), to: at(2027, 0, 1) - 1 })
    expect(parseQuery('date:2025..2026', NOW).filter).toEqual({ from: at(2025, 0, 1), to: at(2027, 0, 1) - 1 })
  })

  it('несколько операторов дат пересекаются', () => {
    expect(parseQuery('date:2026-11 after:2026-11-03 before:2026-11-08', NOW).filter).toEqual({
      from: at(2026, 10, 3),
      to: at(2026, 10, 9) - 1,
    })
    expect(parseQuery('date:2026-11 date:2026-11-20..2026-12-10', NOW).filter).toEqual({
      from: at(2026, 10, 20),
      to: at(2026, 11, 1) - 1,
    })
    expect(
      parseQuery('after:2026-11-03 after:2026-11-01 before:2026-11-20 before:2026-11-25', NOW).filter,
    ).toEqual({ from: at(2026, 10, 3), to: at(2026, 10, 21) - 1 })
    // Пустое пересечение остаётся как есть — по такому фильтру ничего не найдётся.
    const empty = parseQuery('after:2026-11-10 before:2026-11-05', NOW).filter
    expect(empty).toEqual({ from: at(2026, 10, 10), to: at(2026, 10, 6) - 1 })
    expect(empty.from).toBeGreaterThan(empty.to ?? 0)
  })

  it('неверная дата остаётся текстом и не трогает фильтр', () => {
    for (const bad of [
      'date:2026-13-45',
      'date:31.02.2026',
      'date:foo',
      'date:a,b',
      'date:2026-11-05,2026-11-06',
      'date:2026-11-10..2026-11-05',
      'date:week..today',
      'date:1969',
      'date:26-11-05',
      'after:2026-11-01..2026-11-05',
      'before:2026-11-01..2026-11-05',
      'after:nope',
      'до:31.11.2026',
    ]) {
      expect(parseQuery(bad, NOW), bad).toEqual({ text: bad, phrases: [], filter: {} })
    }
    expect(parseQuery('react date:foo #js', NOW)).toEqual({ text: 'react date:foo', phrases: [], filter: { tags: ['js'] } })
    // Верный оператор рядом с неверным продолжает действовать.
    expect(parseQuery('date:2026-11-05 date:31.02.2026 after:foo', NOW)).toEqual({
      text: 'date:31.02.2026 after:foo',
      phrases: [],
      filter: dayOf(2026, 10, 5),
    })
  })

  it('оператор даты без значения игнорируется', () => {
    expect(parseQuery('react date: after: before: дата: до:', NOW)).toEqual({ text: 'react', phrases: [], filter: {} })
  })

  it('даты сочетаются с остальными операторами', () => {
    expect(parseQuery('отчёт #js is:library date:2026-11 type:link "точная фраза"', NOW)).toEqual({
      text: 'отчёт',
      phrases: ['точная фраза'],
      filter: { status: 'library', types: ['link'], tags: ['js'], from: at(2026, 10, 1), to: at(2026, 11, 1) - 1 },
    })
  })
})

describe('parseQuery — корзина', () => {
  it('is:trash и синонимы', () => {
    for (const name of ['trash', 'trashed', 'deleted', 'bin', 'корзина', 'удаленные', 'удалённые', 'TRASH', 'Корзина']) {
      expect(parseQuery(`is:${name}`), name).toEqual({ text: '', phrases: [], filter: { trashed: true } })
    }
    expect(parseQuery('is:trash is:inbox react')).toEqual({
      text: 'react',
      phrases: [],
      filter: { status: 'inbox', trashed: true },
    })
    expect(parseQuery('is:trash,fav').filter).toEqual({ favorite: true, trashed: true })
    expect(parseQuery('react is:inbox').filter.trashed).toBeUndefined()
  })
})

describe('resolveQueryFilter', () => {
  const cats = [cat('c1', 'Работа'), cat('c2', 'Мои проекты')]

  it('копия фильтра запроса + categoryId по имени из cat:', () => {
    const parsed = parseQuery('is:fav #js')
    const filter = resolveQueryFilter(parsed, cats)
    expect(filter).toEqual({ favorite: true, tags: ['js'] })
    expect(filter).not.toBe(parsed.filter)

    expect(resolveQueryFilter(parseQuery('cat:работа'), cats)).toEqual({ categoryId: 'c1' })
    expect(resolveQueryFilter(parseQuery('cat:"мои проекты" is:trash'), cats)).toEqual({ categoryId: 'c2', trashed: true })
    expect(resolveQueryFilter(parseQuery('cat:none type:code'), cats)).toEqual({ categoryId: null, types: ['code'] })
    expect(resolveQueryFilter(parseQuery('cat:"без категории"'), cats)).toEqual({ categoryId: null })
  })

  it('неизвестная категория — null', () => {
    expect(resolveQueryFilter(parseQuery('cat:несуществующая is:fav'), cats)).toBeNull()
    expect(resolveQueryFilter(parseQuery('cat:работа'), [])).toBeNull()
  })
})

describe('serializeFilter', () => {
  const cats = [
    cat('c1', 'Работа'),
    cat('c2', 'Мои проекты'),
    cat('c3', 'Проект "Альфа"'),
    cat('c4', 'Дом, быт'),
    cat('c5', 'a"b»c'),
  ]
  const ser = (f: ItemFilter, categories: Category[] = cats) => serializeFilter(f, categories, NOW)
  const roundTrip = (f: ItemFilter, categories: Category[] = cats) =>
    resolveQueryFilter(parseQuery(ser(f, categories), NOW), categories)

  it('пустой фильтр и «не фильтрующие» значения — пустая строка', () => {
    expect(ser({})).toBe('')
    expect(ser({ status: [], types: [], tags: [], favorite: false, untagged: false, trashed: false })).toBe('')
    expect(ser({ categoryId: undefined, from: undefined, to: undefined })).toBe('')
  })

  it('статус: значение и массив', () => {
    expect(ser({ status: 'inbox' })).toBe('is:inbox')
    expect(ser({ status: ['inbox', 'archive'] })).toBe('is:inbox is:archive')
    expect(ser({ status: ['library'] })).toBe('is:library')
  })

  it('избранное, без тегов, корзина', () => {
    expect(ser({ favorite: true })).toBe('is:fav')
    expect(ser({ untagged: true })).toBe('is:untagged')
    expect(ser({ trashed: true })).toBe('is:trash')
  })

  it('типы — канонические id в порядке массива', () => {
    expect(ser({ types: ['link', 'code'] })).toBe('type:link,code')
    expect(ser({ types: ['image'] })).toBe('type:image')
    expect(ser({ types: ['file', 'image'] })).toBe('type:file,image')
  })

  it('категория: имя, кавычки при пробеле, запятой и кавычке', () => {
    expect(ser({ categoryId: 'c1' })).toBe('cat:Работа')
    expect(ser({ categoryId: 'c2' })).toBe('cat:"Мои проекты"')
    expect(ser({ categoryId: 'c3' })).toBe('cat:«Проект "Альфа"»')
    expect(ser({ categoryId: 'c4' })).toBe('cat:"Дом, быт"')
    expect(ser({ categoryId: 'c5' })).toBe('cat:“a"b»c”')
  })

  it('«без категории»: cat:none либо первое псевдоимя, не занятое категорией', () => {
    expect(ser({ categoryId: null })).toBe('cat:none')
    const taken = [cat('n1', 'None')]
    expect(ser({ categoryId: null }, taken)).toBe('cat:нет')
    taken.push(cat('n2', 'Нет'))
    expect(ser({ categoryId: null }, taken)).toBe('cat:без')
    taken.push(cat('n3', 'БЕЗ'))
    expect(ser({ categoryId: null }, taken)).toBe('cat:"без категории"')
    // Сама категория с таким именем записывается по имени и находится первой.
    expect(ser({ categoryId: 'n1' }, taken)).toBe('cat:None')
    expect(roundTrip({ categoryId: 'n1' }, taken)).toEqual({ categoryId: 'n1' })
    expect(roundTrip({ categoryId: null }, taken)).toEqual({ categoryId: null })
    expect(roundTrip({ categoryId: null }, [cat('n1', 'None')])).toEqual({ categoryId: null })
  })

  it('неизвестная категория пропускается, остальное сохраняется', () => {
    expect(ser({ categoryId: 'нет-такой', favorite: true })).toBe('is:fav')
    expect(serializeFilter({ categoryId: 'c1' }, [], NOW)).toBe('')
  })

  it('теги: #тег, кавычки при хвостовой пунктуации и кавычке, нормализация', () => {
    expect(ser({ tags: ['react', 'c++'] })).toBe('#react #c++')
    expect(ser({ tags: ['v1.'] })).toBe('#"v1."')
    expect(ser({ tags: ['что?', 'x)'] })).toBe('#"что?" #"x)"')
    expect(ser({ tags: ['a"b'] })).toBe('#«a"b»')
    expect(ser({ tags: ['React', '#react', '  ', 'мой тег'] })).toBe('#react #мой-тег')
  })

  it('даты: относительный период, сутки, диапазон, одна граница', () => {
    for (const period of ['today', 'yesterday', 'week', 'month', 'year'] as const) {
      expect(ser(relativeRange(period, NOW)), period).toBe(`date:${period}`)
    }
    expect(ser(dayOf(2026, 10, 5))).toBe('date:2026-11-05')
    expect(ser({ from: at(2026, 10, 5, 8), to: at(2026, 10, 5, 20) })).toBe('date:2026-11-05')
    expect(ser({ from: at(2026, 10, 1), to: at(2026, 10, 6) - 1 })).toBe('date:2026-11-01..2026-11-05')
    expect(ser({ from: at(2026, 10, 5, 13, 30) })).toBe('after:2026-11-05')
    expect(ser({ to: at(2026, 10, 5, 13, 30) })).toBe('before:2026-11-05')
    expect(ser({ from: at(2026, 0, 1) })).toBe('after:2026-01-01')
    // Пустое пересечение диапазоном не записать (A..B с A > B — неверная дата).
    expect(ser({ from: at(2026, 10, 10), to: at(2026, 10, 6) - 1 })).toBe('after:2026-11-10 before:2026-11-05')
  })

  it('относительность определяется по now', () => {
    const nov11 = dayOf(2026, 10, 11)
    expect(serializeFilter(nov11, cats, NOW)).toBe('date:today')
    expect(serializeFilter(nov11, cats, at(2026, 10, 12, 9))).toBe('date:yesterday')
    expect(serializeFilter(nov11, cats, at(2026, 10, 20))).toBe('date:2026-11-11')
    // Сохранённый «за неделю» остаётся относительным: позже он даёт уже другую неделю.
    const later = at(2026, 11, 1, 8)
    expect(resolveQueryFilter(parseQuery(ser(relativeRange('week', NOW)), later), cats)).toEqual(relativeRange('week', later))
  })

  it('relativeDates: false — свой диапазон, совпавший с периодом, остаётся датами', () => {
    const fixed = { relativeDates: false }
    // NOW — 11.11.2026: выбранный в календаре день совпадает с «сегодня»
    expect(serializeFilter(relativeRange('today', NOW), cats, NOW, fixed)).toBe('date:2026-11-11')
    expect(serializeFilter(relativeRange('week', NOW), cats, NOW, fixed)).toBe('date:2026-11-05..2026-11-11')
    // назавтра сохранённый поиск показывает те же сутки
    const saved = composeQuery('конференция', relativeRange('today', NOW), cats, NOW, fixed)
    expect(saved).toBe('date:2026-11-11 конференция')
    expect(resolveQueryFilter(parseQuery(saved, at(2026, 10, 12, 9)), cats)).toEqual(relativeRange('today', NOW))
    // по умолчанию — как раньше
    expect(serializeFilter(relativeRange('today', NOW), cats, NOW, {})).toBe('date:today')
  })

  it('порядок частей: статус, избранное, без тегов, корзина, типы, категория, теги, даты', () => {
    expect(
      ser({
        from: at(2026, 10, 5),
        tags: ['a', 'b'],
        categoryId: 'c1',
        types: ['link', 'code'],
        trashed: true,
        untagged: true,
        favorite: true,
        status: ['library', 'archive'],
      }),
    ).toBe('is:library is:archive is:fav is:untagged is:trash type:link,code cat:Работа #a #b after:2026-11-05')
  })

  it('круг: serializeFilter → parseQuery → resolveQueryFilter возвращает тот же фильтр', () => {
    const filters: ItemFilter[] = [
      {},
      { status: 'inbox' },
      { status: ['inbox', 'library'] },
      { favorite: true },
      { untagged: true },
      { trashed: true },
      { types: ['link'] },
      { types: ['file', 'image', 'code'] },
      { categoryId: null },
      { categoryId: 'c1' },
      { categoryId: 'c2' },
      { categoryId: 'c3' },
      { categoryId: 'c4' },
      { categoryId: 'c5' },
      { tags: ['react'] },
      { tags: ['v1.', 'мой-тег', 'a"b', 'c++', 'что?', 'x)', 'отчёты'] },
      // Даты по границам суток.
      dayOf(2026, 10, 5),
      { from: at(2026, 10, 1), to: at(2026, 10, 6) - 1 },
      { from: at(2025, 11, 31), to: at(2026, 0, 2) - 1 },
      { from: at(2026, 10, 5) },
      { to: at(2026, 10, 6) - 1 },
      { from: at(2026, 10, 10), to: at(2026, 10, 6) - 1 },
      relativeRange('today', NOW),
      relativeRange('yesterday', NOW),
      relativeRange('week', NOW),
      relativeRange('month', NOW),
      relativeRange('year', NOW),
      {
        status: ['library', 'archive'],
        favorite: true,
        trashed: true,
        types: ['link', 'code'],
        categoryId: 'c3',
        tags: ['react', 'v1.'],
        from: at(2026, 10, 1),
        to: at(2026, 10, 6) - 1,
      },
      { status: 'inbox', untagged: true, categoryId: null, ...relativeRange('month', NOW) },
    ]
    for (const f of filters) expect(roundTrip(f), ser(f)).toEqual(f)
  })

  it('точность дат — сутки: границы расширяются, диапазон не сужается', () => {
    expect(roundTrip({ from: at(2026, 10, 5, 13, 30), to: at(2026, 10, 8, 9, 15) })).toEqual({
      from: at(2026, 10, 5),
      to: at(2026, 10, 9) - 1,
    })
    expect(roundTrip({ from: at(2026, 10, 5, 23, 59, 59, 999) })).toEqual({ from: at(2026, 10, 5) })
    expect(roundTrip({ to: at(2026, 10, 5, 0, 0) })).toEqual({ to: at(2026, 10, 6) - 1 })
  })
})

describe('composeQuery', () => {
  const cats = [cat('c1', 'Работа'), cat('c2', 'Дом')]

  it('операторы фильтра + строка поиска через пробел', () => {
    expect(composeQuery('  react "точная фраза"  ', { status: 'library', tags: ['js'] }, cats, NOW)).toBe(
      'is:library #js react "точная фраза"',
    )
    expect(composeQuery('react', {}, cats, NOW)).toBe('react')
    expect(composeQuery('   ', { favorite: true }, cats, NOW)).toBe('is:fav')
    expect(composeQuery('', {}, cats)).toBe('')
    expect(composeQuery('отчёт', relativeRange('month', NOW), cats, NOW)).toBe('date:month отчёт')
  })

  it('разбирается обратно в те же фильтр и текст', () => {
    const filter: ItemFilter = { types: ['code'], categoryId: 'c1', from: at(2026, 10, 5) }
    const parsed = parseQuery(composeQuery('react "use effect" хуки', filter, cats, NOW), NOW)
    expect(parsed.text).toBe('react хуки')
    expect(parsed.phrases).toEqual(['use effect'])
    expect(resolveQueryFilter(parsed, cats)).toEqual(filter)
  })

  it('категория из строки поиска сильнее категории фильтра (известное ограничение)', () => {
    const q = composeQuery('cat:Дом', { categoryId: 'c1' }, cats, NOW)
    expect(q).toBe('cat:Работа cat:Дом')
    expect(resolveQueryFilter(parseQuery(q, NOW), cats)).toEqual({ categoryId: 'c2' })
  })

  it('типы фильтра и строки поиска пересекаются, как на экране', () => {
    const q = composeQuery('api type:link,code "точная  фраза" has:file', { types: ['code', 'image'] }, cats, NOW)
    expect(q).toBe('type:code,image api "точная  фраза"')
    const parsed = parseQuery(q, NOW)
    expect(parsed.filter.types).toEqual(['code', 'image'])
    expect(parsed.text).toBe('api')
    expect(parsed.phrases).toEqual(['точная фраза'])

    // has:file = файл или картинка: с фильтром «Файл» остаётся только файл
    expect(composeQuery('отчёт has:file', { types: ['file'], tags: ['q4'] }, cats, NOW)).toBe('type:file #q4 отчёт')
    // нераспознанный type: — обычный текст, не трогается
    expect(composeQuery('type:нечто', { types: ['code'] }, cats, NOW)).toBe('type:code type:нечто')
  })

  it('пустое пересечение типов: побеждают типы строки поиска (известное ограничение)', () => {
    const q = composeQuery('type:link api', { types: ['code'] }, cats, NOW)
    expect(q).toBe('type:link api')
    expect(parseQuery(q, NOW).filter.types).toEqual(['link'])
  })
})

describe('matchesFilter — корзина', () => {
  const live = makeItem({ status: 'library', tags: ['a'] })
  const gone = makeItem({ status: 'library', tags: ['a'], deletedAt: 5 })

  it('trashed: true — только корзина, иначе — только вне корзины', () => {
    expect(matchesFilter(live, {})).toBe(true)
    expect(matchesFilter(live, { trashed: false })).toBe(true)
    expect(matchesFilter(live, { trashed: true })).toBe(false)
    expect(matchesFilter(gone, {})).toBe(false)
    expect(matchesFilter(gone, { trashed: false })).toBe(false)
    expect(matchesFilter(gone, { trashed: true })).toBe(true)
    // Остальные условия действуют и в корзине.
    expect(matchesFilter(gone, { status: 'library', tags: ['a'] })).toBe(false)
    expect(matchesFilter(gone, { trashed: true, status: 'library', tags: ['a'] })).toBe(true)
    expect(matchesFilter(gone, { trashed: true, status: 'inbox' })).toBe(false)
  })

  it('matchesFilterIgnoringTrash проверяет всё, кроме корзины', () => {
    expect(matchesFilterIgnoringTrash(gone, {})).toBe(true)
    expect(matchesFilterIgnoringTrash(gone, { trashed: false })).toBe(true)
    expect(matchesFilterIgnoringTrash(live, { trashed: true })).toBe(true)
    expect(matchesFilterIgnoringTrash(gone, { tags: ['a'], status: 'library' })).toBe(true)
    expect(matchesFilterIgnoringTrash(gone, { status: 'inbox' })).toBe(false)
    expect(matchesFilterIgnoringTrash(live, { trashed: true, tags: ['нет'] })).toBe(false)
  })
})

describe('searchItems — корзина', () => {
  const live = makeItem({ title: 'Заметка про кота', content: 'живая запись' })
  const gone = makeItem({ title: 'Заметка про кота', content: 'удалённая запись', deletedAt: 5 })
  const goneLib = makeItem({ title: 'Старый отчёт', status: 'library', deletedAt: 6 })
  const all = [live, gone, goneLib]

  it('по умолчанию корзина скрыта: текст, фраза, пустой запрос, фильтры', () => {
    expect(ids(searchItems(all, 'заметка'))).toEqual([live.id])
    expect(ids(searchItems(all, '"про кота"'))).toEqual([live.id])
    expect(ids(searchItems(all, ''))).toEqual([live.id])
    expect(searchItems(all, 'отчет')).toEqual([])
    expect(searchItems(all, '"удаленная запись"')).toEqual([])
    expect(searchItems(all, 'is:library')).toEqual([])
    expect(ids(searchItems(all, 'заметка', [], { trash: false }))).toEqual([live.id])
    // В индексе при этом все записи: вход в корзину его не перестраивает.
    expect(getSearchIndexStats().size).toBe(3)
  })

  it('trash: true — только корзина', () => {
    expect(ids(searchItems(all, 'заметка', [], { trash: true }))).toEqual([gone.id])
    expect(ids(searchItems(all, '', [], { trash: true }))).toEqual([gone.id, goneLib.id])
    expect(ids(searchItems(all, '"удаленная запись"', [], { trash: true }))).toEqual([gone.id])
    expect(ids(searchItems(all, 'is:library', [], { trash: true }))).toEqual([goneLib.id])
  })

  it("trash: 'any' — корзина не проверяется", () => {
    expect(ids(searchItems(all, 'заметка', [], { trash: 'any' })).sort()).toEqual([live.id, gone.id].sort())
    expect(ids(searchItems(all, '', [], { trash: 'any' }))).toEqual([live.id, gone.id, goneLib.id])
    // within уже отобран вызывающим — is:trash в запросе его не пересматривает.
    expect(ids(searchItems(all, 'is:trash', [], { trash: 'any', within: [live] }))).toEqual([live.id])
    expect(ids(searchItems(all, 'отчет', [], { trash: 'any', within: [goneLib] }))).toEqual([goneLib.id])
  })

  it('is:trash в запросе ищет в корзине', () => {
    expect(ids(searchItems(all, 'is:trash'))).toEqual([gone.id, goneLib.id])
    expect(ids(searchItems(all, 'заметка is:trash'))).toEqual([gone.id])
    expect(ids(searchItems(all, 'is:корзина is:library'))).toEqual([goneLib.id])
    expect(ids(searchItems(all, 'is:trash "удаленная запись"'))).toEqual([gone.id])
    // Запрос сильнее параметра по умолчанию.
    expect(ids(searchItems(all, 'is:trash', [], { trash: false }))).toEqual([gone.id, goneLib.id])
    // within без корзины + is:trash — пусто.
    expect(searchItems(all, 'is:trash', [], { within: [live] })).toEqual([])
  })

  it('перенос в корзину и обратно не переиндексирует запись (updatedAt не меняется)', () => {
    const a = makeItem({ title: 'Черновик' })
    const untouched = { size: 1, added: 0, replaced: 0, discarded: 0, rebuilt: false }
    expect(ids(searchItems([a], 'черновик'))).toEqual([a.id])

    const inTrash: Item = { ...a, deletedAt: 10 }
    expect(searchItems([inTrash], 'черновик')).toEqual([])
    expect(getSearchIndexStats()).toMatchObject(untouched)
    expect(ids(searchItems([inTrash], 'черновик is:trash'))).toEqual([a.id])
    expect(getSearchIndexStats()).toMatchObject(untouched)

    expect(ids(searchItems([a], 'черновик'))).toEqual([a.id])
    expect(getSearchIndexStats()).toMatchObject(untouched)
  })
})

describe('searchItems — даты', () => {
  const prev = makeItem({ title: 'конец четвёртого дня', createdAt: at(2026, 10, 4, 23, 59, 59, 999) })
  const dayStart = makeItem({ title: 'начало пятого дня', createdAt: at(2026, 10, 5) })
  const dayEnd = makeItem({ title: 'конец пятого дня', createdAt: at(2026, 10, 5, 23, 59, 59, 999) })
  const next = makeItem({ title: 'начало шестого дня', createdAt: at(2026, 10, 6) })
  const today = makeItem({ title: 'сегодняшняя', createdAt: at(2026, 10, 11, 9) })
  const all = [prev, dayStart, dayEnd, next, today]

  it('границы суток включительно', () => {
    expect(ids(searchItems(all, 'date:2026-11-05'))).toEqual([dayStart.id, dayEnd.id])
    expect(ids(searchItems(all, 'date:05.11.2026'))).toEqual([dayStart.id, dayEnd.id])
    expect(ids(searchItems(all, 'after:2026-11-05'))).toEqual([dayStart.id, dayEnd.id, next.id, today.id])
    expect(ids(searchItems(all, 'before:2026-11-05'))).toEqual([prev.id, dayStart.id, dayEnd.id])
    expect(ids(searchItems(all, 'date:2026-11-04..2026-11-05'))).toEqual([prev.id, dayStart.id, dayEnd.id])
    expect(ids(searchItems(all, 'date:2026-11'))).toHaveLength(5)
    expect(searchItems(all, 'date:2026-10')).toEqual([])
    expect(searchItems(all, 'after:2026-11-10 before:2026-11-05')).toEqual([])
  })

  it('дата + текст', () => {
    expect(ids(searchItems(all, 'начало date:2026-11-05'))).toEqual([dayStart.id])
    expect(ids(searchItems(all, 'начало after:2026-11-05')).sort()).toEqual([dayStart.id, next.id].sort())
    expect(ids(searchItems(all, '"пятого дня" before:2026-11-05'))).toEqual([dayStart.id, dayEnd.id])
  })

  it('относительные даты считаются от options.now', () => {
    expect(ids(searchItems(all, 'date:today', [], { now: NOW }))).toEqual([today.id])
    expect(ids(searchItems(all, 'date:week', [], { now: NOW }))).toEqual([dayStart.id, dayEnd.id, next.id, today.id])
    expect(ids(searchItems(all, 'date:yesterday', [], { now: at(2026, 10, 6, 12) }))).toEqual([dayStart.id, dayEnd.id])
    expect(ids(searchItems(all, 'date:вчера', [], { now: at(2026, 10, 7) }))).toEqual([next.id])
    expect(ids(searchItems(all, 'after:вчера', [], { now: at(2026, 10, 7) }))).toEqual([next.id, today.id])
  })

  it('неверная дата ищется как обычный текст', () => {
    const odd = makeItem({ title: 'оператор date:foo в заметке' })
    expect(ids(searchItems([...all, odd], 'date:foo'))).toEqual([odd.id])
  })
})

describe('searchItems — распознанный текст', () => {
  const pdf = makeItem({
    type: 'file',
    fileName: 'scan.pdf',
    ocrText: 'Договор аренды нежилого помещения\n\nСтраница вторая: обязанности арендатора',
    ocrAt: 500,
  })
  const note = makeItem({ title: 'Аренда', content: 'позвонить насчёт квартиры' })
  const all = [pdf, note]

  it('ищет по ocrText: слова, префиксы, ё/е, вместе с другими полями', () => {
    expect(ids(searchItems(all, 'нежилого'))).toEqual([pdf.id])
    expect(ids(searchItems(all, 'обязанн'))).toEqual([pdf.id])
    expect(ids(searchItems(all, 'ДОГОВОР помещения'))).toEqual([pdf.id])
    expect(ids(searchItems(all, 'scan обязанности'))).toEqual([pdf.id])
    expect(ids(searchItems(all, 'нежилого type:file'))).toEqual([pdf.id])
    expect(searchItems(all, 'нежилого type:text')).toEqual([])
  })

  it('заголовок весит больше распознанного текста', () => {
    expect(ids(searchItems(all, 'аренд'))).toEqual([note.id, pdf.id])
  })

  it('точная фраза ищется и в ocrText, переводы строк не мешают', () => {
    expect(ids(searchItems(all, '"аренды нежилого"'))).toEqual([pdf.id])
    expect(ids(searchItems(all, '"помещения страница вторая"'))).toEqual([pdf.id])
    // Фраза не склеивается из имени файла и распознанного текста.
    expect(searchItems(all, '"pdf договор"')).toEqual([])
  })

  it('смена ocrAt без смены updatedAt переиндексирует запись', () => {
    const a = makeItem({ type: 'file', fileName: 'a.pdf' })
    const other = makeItem({ title: 'Соседняя запись' })
    expect(searchItems([a, other], 'договор')).toEqual([])
    expect(getSearchIndexStats()).toMatchObject({ size: 2, rebuilt: true })

    // repo.setOcrText: текст появился, updatedAt прежний.
    const a2: Item = { ...a, ocrText: 'Договор поставки', ocrAt: 100 }
    expect(ids(searchItems([a2, other], 'договор'))).toEqual([a.id])
    expect(getSearchIndexStats()).toMatchObject({ size: 2, added: 0, replaced: 1, discarded: 0, rebuilt: false })
    expect(ids(searchItems([a2, other], '"договор поставки"'))).toEqual([a.id])
    expect(getSearchIndexStats()).toMatchObject({ size: 2, added: 0, replaced: 0, discarded: 0, rebuilt: false })

    // Повторное распознавание дало другой текст.
    const a3: Item = { ...a2, ocrText: 'Счёт на оплату', ocrAt: 200 }
    expect(searchItems([a3, other], 'договор')).toEqual([])
    expect(getSearchIndexStats()).toMatchObject({ size: 2, added: 0, replaced: 1, discarded: 0, rebuilt: false })
    expect(ids(searchItems([a3, other], 'счет'))).toEqual([a.id])
    expect(searchItems([a3, other], '"договор поставки"')).toEqual([])
    expect(ids(searchItems([a3, other], '"счет на оплату"'))).toEqual([a.id])

    // Текста не нашлось: поле убрано, отметка «пробовали» новая.
    const a4: Item = { ...a3, ocrText: undefined, ocrAt: 300 }
    expect(searchItems([a4, other], 'счет')).toEqual([])
    expect(getSearchIndexStats()).toMatchObject({ size: 2, added: 0, replaced: 1, discarded: 0, rebuilt: false })

    // Та же отметка и тот же updatedAt — запись не трогается.
    searchItems([{ ...a4 }, other], 'счет')
    expect(getSearchIndexStats()).toMatchObject({ size: 2, added: 0, replaced: 0, discarded: 0, rebuilt: false })
  })
})

describe('makeSnippet — распознанный текст и Markdown', () => {
  const ocr = 'Договор аренды нежилого помещения. Арендатор обязуется вносить плату ежемесячно.'

  it('совпадение только в ocrText', () => {
    const item = makeItem({ type: 'file', fileName: 'scan.pdf', content: 'Скан из почты', ocrText: ocr })
    expect(makeSnippet(item, ['арендатор'])).toBe(ocr)
    const s = makeSnippet(item, ['плату'], 40)
    expect(s).toContain('плату')
    expect(s.startsWith('…')).toBe(true)
    expect(s.length).toBeLessThanOrEqual(40)
    // Совпадение в content берётся первым.
    expect(makeSnippet(item, ['скан'])).toBe('Скан из почты')
    // Совпадений нет нигде — начало первого непустого источника.
    expect(makeSnippet(item, ['отсутствует'])).toBe('Скан из почты')
  })

  it('порядок источников: content, описание ссылки, ocrText', () => {
    const link = makeItem({
      type: 'link',
      content: 'мой комментарий',
      linkMeta: { status: 'ok', description: 'Описание страницы про аренду' },
      ocrText: 'Текст про аренду из вложения',
    })
    expect(makeSnippet(link, ['аренду'])).toBe('Описание страницы про аренду')
    expect(makeSnippet(link, ['вложения'])).toBe('Текст про аренду из вложения')
    expect(makeSnippet(link, ['комментарий'])).toBe('мой комментарий')
    expect(makeSnippet(link, [])).toBe('мой комментарий')
  })

  it('запись без content — начало ocrText', () => {
    const item = makeItem({ type: 'image', fileName: 'photo.jpg', ocrText: '  Первая строка\n\nвторая   строка  ' })
    expect(makeSnippet(item, [])).toBe('Первая строка вторая строка')
    expect(makeSnippet(item, ['отсутствует'])).toBe('Первая строка вторая строка')

    const long = makeSnippet(makeItem({ type: 'file', ocrText: 'слово '.repeat(200) }), [], 50)
    expect(long.startsWith('слово слово')).toBe(true)
    expect(long.endsWith('…')).toBe(true)
    expect(long.length).toBeLessThanOrEqual(50)
  })

  it('совпадение далеко в длинном распознанном тексте', () => {
    const item = makeItem({
      type: 'file',
      ocrText: 'слово '.repeat(5000) + 'иголка в стоге сена ' + 'хвост '.repeat(5000),
    })
    const s = makeSnippet(item, ['иголк'], 100)
    expect(s).toContain('иголка в стоге сена')
    expect(s.startsWith('…')).toBe(true)
    expect(s.endsWith('…')).toBe(true)
    expect(s.length).toBeLessThanOrEqual(100)
  })

  it('разметка Markdown убрана у текста, идеи и ссылки', () => {
    const md = '# Заголовок\n\n- **Важный** пункт со [ссылкой](https://example.com/x_y) и `кодом`\n> цитата'
    const plain = 'Заголовок Важный пункт со ссылкой и кодом цитата'
    for (const type of ['text', 'idea', 'link'] as const) {
      expect(makeSnippet(makeItem({ type, content: md }), []), type).toBe(plain)
    }
    // Совпадение ищется уже в очищенном тексте.
    expect(makeSnippet(makeItem({ content: md }), ['важный'])).toBe(plain)
    // Адрес из разметки ссылки в сниппет не попадает.
    expect(makeSnippet(makeItem({ content: md }), ['example'])).toBe(plain)
    // Обычный текст остаётся собой.
    expect(makeSnippet(makeItem({ content: 'snake_case_name и 2 * 3 * 4' }), [])).toBe('snake_case_name и 2 * 3 * 4')
  })

  it('длинный текст: начало то же, что у короткого с тем же началом', () => {
    const line = (i: number) => `- **Важный** пункт со [ссылкой](https://example.com/x_y) и \`кодом\` ${i}`
    const lines = Array.from({ length: 600 }, (_, i) => line(i))
    const long = makeItem({ content: lines.join('\n') })
    const short = makeItem({ content: lines.slice(0, 12).join('\n') })
    for (const terms of [[], ['отсутствует']]) {
      const s = makeSnippet(long, terms, 80)
      expect(s).toBe(makeSnippet(short, terms, 80))
      expect(s.startsWith('Важный пункт со ссылкой и кодом 0 Важный')).toBe(true)
      expect(s.endsWith('…')).toBe(true)
    }
    // Одна сверхдлинная строка и текст после тысяч пустых строк тоже находят своё начало.
    expect(makeSnippet(makeItem({ content: 'слово '.repeat(3000) }), [], 30)).toBe('слово слово слово слово слово…')
    expect(makeSnippet(makeItem({ content: '\n'.repeat(6000) + '**текст** в конце' }), [])).toBe('текст в конце')
    expect(makeSnippet(makeItem({ type: 'file', ocrText: ' '.repeat(6000) + 'текст в конце' }), [])).toBe('текст в конце')
    // Совпадение за пределами головы находится.
    expect(makeSnippet(long, ['599'], 80)).toContain('кодом 599')
  })

  it('у кода разметка сохраняется', () => {
    const code = 'const a = `x` * 2 // **не жирный**\n# не заголовок\n- [ ] не список'
    const item = makeItem({ type: 'code', content: code })
    expect(makeSnippet(item, [])).toBe('const a = `x` * 2 // **не жирный** # не заголовок - [ ] не список')
    expect(makeSnippet(item, ['жирный'])).toContain('**не жирный**')
  })
})

describe('renameQueryOperators', () => {
  const tag = { tag: { from: 'работа', to: 'work' } }
  it('переписывает tag: и #, включая кавычки и хвостовую пунктуацию', () => {
    expect(renameQueryOperators('tag:работа', tag)).toBe('tag:work')
    expect(renameQueryOperators('#работа, слово "работа"', tag)).toBe('#work, слово "работа"')
    expect(renameQueryOperators('tag:"работа" tag:a,работа', tag)).toBe('tag:work tag:a,work')
    expect(renameQueryOperators('tag:работать #Работа', tag)).toBe('tag:работать #work')
    expect(renameQueryOperators('tag:работа', { tag: { from: 'работа', to: 'a.' } })).toBe('tag:"a."')
  })
  it('переписывает cat: по ключу имени и не трогает остальное', () => {
    const cat = { category: { fromKey: 'мои проекты', to: 'Дела' } }
    expect(renameQueryOperators('cat:"Мои проекты"  x', cat)).toBe('cat:Дела  x')
    expect(renameQueryOperators('cat:мои-проекты', cat)).toBe('cat:Дела')
    expect(renameQueryOperators('cat:Другая', cat)).toBe('cat:Другая')
    expect(renameQueryOperators('cat:Дом', { category: { fromKey: 'дом', to: 'Мой дом' } })).toBe('cat:"Мой дом"')
  })
})
