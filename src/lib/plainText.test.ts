import { describe, expect, it } from 'vitest'
import { stripMarkdown } from './plainText'

describe('stripMarkdown — что убирает', () => {
  it('маркеры заголовков в начале строки', () => {
    expect(stripMarkdown('# Заголовок')).toBe('Заголовок')
    expect(stripMarkdown('### Третий уровень')).toBe('Третий уровень')
    expect(stripMarkdown('  ## С отступом')).toBe('С отступом')
    expect(stripMarkdown('текст\n## Раздел\nещё')).toBe('текст\nРаздел\nещё')
  })

  it('маркеры цитат, в том числе вложенных', () => {
    expect(stripMarkdown('> цитата')).toBe('цитата')
    expect(stripMarkdown('>> вложенная')).toBe('вложенная')
    expect(stripMarkdown('> > через пробел')).toBe('через пробел')
    expect(stripMarkdown('> # заголовок в цитате')).toBe('заголовок в цитате')
    expect(stripMarkdown('> - пункт в цитате')).toBe('пункт в цитате')
  })

  it('маркеры списков', () => {
    expect(stripMarkdown('- один\n* два\n+ три')).toBe('один\nдва\nтри')
    expect(stripMarkdown('1. первый\n2. второй\n12. двенадцатый')).toBe('первый\nвторой\nдвенадцатый')
    // Отступ вложенного пункта остаётся: сниппет всё равно схлопывает пробелы.
    expect(stripMarkdown('- а\n  - вложенный')).toBe('а\n  вложенный')
  })

  it('чекбоксы после маркера списка', () => {
    expect(stripMarkdown('- [ ] дело')).toBe('дело')
    expect(stripMarkdown('- [x] готово')).toBe('готово')
    expect(stripMarkdown('* [X] тоже готово')).toBe('тоже готово')
    expect(stripMarkdown('1. [ ] по номеру')).toBe('по номеру')
    // Без маркера списка квадратные скобки — обычный текст.
    expect(stripMarkdown('[ ] без маркера')).toBe('[ ] без маркера')
  })

  it('строки-ограды блока кода, содержимое остаётся как есть', () => {
    expect(stripMarkdown('до\n```ts\nconst a = `x` * 2 // **не жирный**\n# не заголовок\n```\nпосле')).toBe(
      'до\nconst a = `x` * 2 // **не жирный**\n# не заголовок\nпосле',
    )
    expect(stripMarkdown('~~~\n- не список\n~~~')).toBe('- не список')
    // Ограда из четырёх кавычек закрывается только такой же или длиннее.
    expect(stripMarkdown('````\n```\nвнутри\n```\n````\n**снаружи**')).toBe('```\nвнутри\n```\nснаружи')
    // Незакрытая ограда: всё до конца — код.
    expect(stripMarkdown('```\n**код**')).toBe('**код**')
  })

  it('обратные кавычки инлайн-кода; разметка внутри кода не трогается', () => {
    expect(stripMarkdown('вызов `foo_bar_baz()` тут')).toBe('вызов foo_bar_baz() тут')
    expect(stripMarkdown('`*не курсив*` и *курсив*')).toBe('*не курсив* и курсив')
    expect(stripMarkdown('``a`b``')).toBe('a`b')
    expect(stripMarkdown('```код в строке```')).toBe('код в строке')
    expect(stripMarkdown('`_a_` `__b__`')).toBe('_a_ __b__')
  })

  it('картинки и ссылки', () => {
    expect(stripMarkdown('![альт](https://a.b/i.png)')).toBe('альт')
    expect(stripMarkdown('![альт](img.png "подпись")')).toBe('альт')
    expect(stripMarkdown('см. [текст ссылки](https://a.b/c_d_e) далее')).toBe('см. текст ссылки далее')
    expect(stripMarkdown('[вики](https://ru.wikipedia.org/wiki/Тест_(значения))')).toBe('вики')
    expect(stripMarkdown('[![значок](badge.svg)](https://a.b)')).toBe('значок')
    expect(stripMarkdown('[раз](a) и [два](b)')).toBe('раз и два')
  })

  it('вики-ссылки', () => {
    expect(stripMarkdown('см. [[Запись]]')).toBe('см. Запись')
    expect(stripMarkdown('см. [[Запись|подпись]]')).toBe('см. подпись')
    expect(stripMarkdown('[[ Запись | ]]')).toBe('Запись')
    expect(stripMarkdown('[[Одна]] и [[Другая|вторая]]')).toBe('Одна и вторая')
  })

  it('парные маркеры выделения', () => {
    expect(stripMarkdown('**жирный**')).toBe('жирный')
    expect(stripMarkdown('__жирный__')).toBe('жирный')
    expect(stripMarkdown('~~зачёркнутый~~')).toBe('зачёркнутый')
    expect(stripMarkdown('*курсив*')).toBe('курсив')
    expect(stripMarkdown('_курсив_')).toBe('курсив')
    expect(stripMarkdown('***оба***')).toBe('оба')
    expect(stripMarkdown('это **очень** важно и _точно_ так, а ~~это~~ нет')).toBe('это очень важно и точно так, а это нет')
    expect(stripMarkdown('**два слова** и *ещё два*')).toBe('два слова и ещё два')
    expect(stripMarkdown('**жирный с _курсивом_ внутри**')).toBe('жирный с курсивом внутри')
  })

  it('документ целиком', () => {
    const md = [
      '# План',
      '',
      '- [x] **Сделать** _поиск_',
      '- [ ] Прочитать [статью](https://example.com/a_b) и [[Заметка|заметку]]',
      '',
      '> Цитата с `кодом`',
      '',
      '```js',
      'const x = a * b * c',
      '```',
    ].join('\n')
    expect(stripMarkdown(md)).toBe(
      ['План', '', 'Сделать поиск', 'Прочитать статью и заметку', '', 'Цитата с кодом', '', 'const x = a * b * c'].join('\n'),
    )
  })

  it('переводы строк \\r\\n сохраняются', () => {
    expect(stripMarkdown('# Заголовок\r\n**текст**\r\n```\r\nкод\r\n```\r\nконец')).toBe('Заголовок\r\nтекст\r\nкод\r\nконец')
  })
})

describe('stripMarkdown — что не трогает', () => {
  it('обычный текст возвращается как есть', () => {
    for (const plain of [
      '',
      'Обычный текст без разметки.',
      'Первая строка\nВторая строка — с тире, 100% и e-mail: a@b.ru',
      'Цена: 5 руб. (со скидкой)',
      '-5 градусов, 1.5 литра',
      '2026. Год был долгим',
    ]) {
      expect(stripMarkdown(plain), JSON.stringify(plain)).toBe(plain)
    }
  })

  it('арифметика и одиночные звёздочки', () => {
    expect(stripMarkdown('2 * 3 * 4')).toBe('2 * 3 * 4')
    expect(stripMarkdown('одна * звезда')).toBe('одна * звезда')
    expect(stripMarkdown('сноска* в тексте')).toBe('сноска* в тексте')
    expect(stripMarkdown('** не жирный **')).toBe('** не жирный **')
    expect(stripMarkdown('a ** b')).toBe('a ** b')
  })

  it('подчёркивания внутри слов', () => {
    expect(stripMarkdown('snake_case_name')).toBe('snake_case_name')
    expect(stripMarkdown('a_b')).toBe('a_b')
    expect(stripMarkdown('file_name_here.txt и user_name@mail.ru')).toBe('file_name_here.txt и user_name@mail.ru')
    expect(stripMarkdown('одно _ подчёркивание')).toBe('одно _ подчёркивание')
    expect(stripMarkdown('_без пары')).toBe('_без пары')
    expect(stripMarkdown('слово_с_подчёркиванием и MAX_ITEM_COUNT')).toBe('слово_с_подчёркиванием и MAX_ITEM_COUNT')
  })

  it('адреса', () => {
    expect(stripMarkdown('https://example.com/a_b_c/d_e')).toBe('https://example.com/a_b_c/d_e')
    expect(stripMarkdown('https://a.b/x*y*z и *курсив*')).toBe('https://a.b/x*y*z и курсив')
    expect(stripMarkdown('см. https://a.b/_x_/__y__ и _курсив_')).toBe('см. https://a.b/_x_/__y__ и курсив')
    expect(stripMarkdown('ftp://host/a_b_ и ~~нет~~')).toBe('ftp://host/a_b_ и нет')
    // Курсив вокруг адреса снимается, сам адрес цел.
    expect(stripMarkdown('*https://a.b/x_y*')).toBe('https://a.b/x_y')
  })

  it('решётка без пробела, знак «больше» и скобки в тексте', () => {
    expect(stripMarkdown('#тег в начале строки')).toBe('#тег в начале строки')
    expect(stripMarkdown('C# и F#')).toBe('C# и F#')
    expect(stripMarkdown('a > b и b < c')).toBe('a > b и b < c')
    expect(stripMarkdown('массив[0] и (скобки)')).toBe('массив[0] и (скобки)')
    expect(stripMarkdown('[не ссылка] (отдельно)')).toBe('[не ссылка] (отдельно)')
  })

  it('служебные символы в тексте не ломают восстановление кода и адресов', () => {
    expect(stripMarkdown('a\u0000b `x_y_z` https://a.b/c_d_e **ж**')).toBe('a\u0000b x_y_z https://a.b/c_d_e ж')
    expect(stripMarkdown('\u0000 https://a.b/`x_y`')).toBe('\u0000 https://a.b/x_y')
    expect(stripMarkdown('0 `1` 2 `3` 4')).toBe('0 1 2 3 4')
  })

  it('сверхдлинная строка (лог, минифицированный код) остаётся как есть', () => {
    const long = '*a* '.repeat(2000)
    expect(stripMarkdown(long)).toBe(long)
  })
})
