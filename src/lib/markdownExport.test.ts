import { describe, expect, it } from 'vitest'
import {
  buildMarkdownExport,
  itemToMarkdown,
  planMarkdownExport,
  safeFileName,
} from '@/lib/markdownExport'
import type { MdExportEntry } from '@/lib/markdownExport'
import type { Category, Item } from '@/types'

const T0 = Date.UTC(2026, 0, 15, 10, 0, 0)
const HOUR = 3_600_000

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

const CATEGORIES: Category[] = [
  { id: 'c1', name: 'Работа', color: 'blue', order: 0, createdAt: T0 },
  { id: 'c2', name: 'Дом: "уют"', color: 'green', order: 1, createdAt: T0 },
]

function render(item: Item, items: readonly Item[] = [item], categories: readonly Category[] = CATEGORIES) {
  return itemToMarkdown(item, { categories, items, plan: planMarkdownExport(items) })
}

function body(markdown: string): string {
  const end = markdown.indexOf('\n---\n', 4)
  return markdown.slice(end + 5)
}

// Правила safe_rel_path из src-tauri/src/backup.rs (spec-tauri, п. 1.3): Rust только отклоняет.
const RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL', 'CONIN$', 'CONOUT$',
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '¹', '²', '³'].flatMap((d) => [`COM${d}`, `LPT${d}`]),
])

function relPathProblem(rel: string): string | null {
  if (rel === '' || [...rel].length > 400) return 'длина пути'
  const path = rel.replace(/\\/g, '/')
  if (path.startsWith('/') || path.includes(':')) return 'структура пути'
  const parts = path.split('/')
  if (parts.length > 8) return 'глубина'
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') return 'компонент'
    // eslint-disable-next-line no-control-regex
    if (/[<>"|?*\u0000-\u001f]/.test(part)) return 'символ'
    if (/[. ]$/.test(part)) return 'окончание'
    if (part.length > 255) return 'длина имени'
    if (/\.qdpart$/i.test(part)) return 'qdpart'
    if (RESERVED.has(part.split('.')[0].trim().toUpperCase())) return 'зарезервированное имя'
  }
  return null
}

describe('safeFileName', () => {
  it.each([...'<>:"/\\|?*#^[]'])('запрещённый символ %s → пробел', (ch) => {
    expect(safeFileName(`a${ch}b`)).toBe('a b')
  })

  it.each([0, 1, 9, 10, 13, 27, 31, 127])('управляющий символ %i → пробел', (code) => {
    expect(safeFileName(`a${String.fromCharCode(code)}b`)).toBe('a b')
  })

  it('символы направления текста и невидимые символы удаляются', () => {
    expect(safeFileName('отчёт‮gnp.exe')).toBe('отчётgnp.exe')
    const invisible = [
      '؜', '​', '‎', '‏', '‪', '‫', '‬', '‭', '‮',
      '⁠', '⁦', '⁧', '⁨', '⁩', '﻿',
    ]
    for (const ch of invisible) expect(safeFileName(`a${ch}b.txt`), ch.codePointAt(0)!.toString(16)).toBe('ab.txt')
    // соединители нужны письменностям и эмодзи
    expect(safeFileName('a‌b‍c')).toBe('a‌b‍c')
  })

  it('пробелы схлопываются', () => {
    expect(safeFileName('a   b')).toBe('a b')
    expect(safeFileName('План: Q3/Q4?')).toBe('План Q3 Q4')
    expect(safeFileName('a<>:"/\\|?*b')).toBe('a b')
    expect(safeFileName('a\u00a0\u2028b')).toBe('a b')
  })

  it('обычные имена не меняются', () => {
    expect(safeFileName('Отчёт за 2025 (итог).pdf')).toBe('Отчёт за 2025 (итог).pdf')
    expect(safeFileName("ёлка & co, v1.0 — 100% 'ok'")).toBe("ёлка & co, v1.0 — 100% 'ok'")
    expect(safeFileName('привет 😀')).toBe('привет 😀')
  })

  it('NFC', () => {
    expect(safeFileName('и\u0306од')).toBe('йод')
    expect(safeFileName('e\u0301.txt')).toBe('\u00e9.txt')
  })

  it.each([
    ['CON', '_CON'],
    ['con', '_con'],
    ['con.txt', '_con.txt'],
    ['Prn.tar.gz', '_Prn.tar.gz'],
    ['AUX', '_AUX'],
    ['nul', '_nul'],
    ['LPT1', '_LPT1'],
    ['lpt9.doc', '_lpt9.doc'],
    ['COM1', '_COM1'],
    ['Com9', '_Com9'],
    ['COM¹', '_COM¹'],
    ['com².txt', '_com².txt'],
    ['LPT³', '_LPT³'],
    ['CONIN$', '_CONIN$'],
    ['conout$.log', '_conout$.log'],
    // Часть до первой точки сравнивается с обрезкой пробелов.
    ['CON .txt', '_CON .txt'],
    // Имя становится зарезервированным уже после очистки.
    ['CON:', '_CON'],
    ['aux.', '_aux'],
    [' .nul ', '_nul'],
    ['COM1?.txt', '_COM1 .txt'],
  ])('зарезервированное имя %j → %j', (raw, expected) => {
    expect(safeFileName(raw)).toBe(expected)
  })

  it.each(['CONSOLE', 'COM10', 'COM', 'LPT', 'CON1', 'NULL', 'my.con', 'a CON', 'CON-1.txt'])(
    'не зарезервировано: %s',
    (name) => {
      expect(safeFileName(name)).toBe(name)
    },
  )

  it('точки и пробелы по краям', () => {
    expect(safeFileName('  ..имя..  ')).toBe('имя')
    expect(safeFileName('.gitignore')).toBe('gitignore')
    expect(safeFileName('a. ')).toBe('a')
    expect(safeFileName('a . . .')).toBe('a')
    expect(safeFileName(' . a.b . ')).toBe('a.b')
    expect(safeFileName('имя?')).toBe('имя')
  })

  it('пусто → «Без названия»', () => {
    expect(safeFileName('')).toBe('Без названия')
    expect(safeFileName('   ')).toBe('Без названия')
    expect(safeFileName('. . .')).toBe('Без названия')
    expect(safeFileName('???')).toBe('Без названия')
    expect(safeFileName('\n\t')).toBe('Без названия')
  })

  it('окончание .qdpart', () => {
    expect(safeFileName('file.qdpart')).toBe('file.qdpart_')
    expect(safeFileName('FILE.QDPART')).toBe('FILE.QDPART_')
    expect(safeFileName('file.qdpart.')).toBe('file.qdpart_')
    expect(safeFileName('file.qdpart.txt')).toBe('file.qdpart.txt')
    expect(safeFileName(`${'a'.repeat(100)}.qdpart`)).toBe(`${'a'.repeat(72)}.qdpart_`)
  })

  it('длинное имя обрезается до maxLen', () => {
    expect(safeFileName('a'.repeat(200))).toBe('a'.repeat(80))
    expect(safeFileName('a'.repeat(80))).toBe('a'.repeat(80))
    expect(safeFileName('a'.repeat(200), 10)).toBe('a'.repeat(10))
    expect(safeFileName('я'.repeat(200), 72)).toBe('я'.repeat(72))
  })

  it('расширение при обрезке сохраняется', () => {
    expect(safeFileName(`${'a'.repeat(100)}.pdf`)).toBe(`${'a'.repeat(76)}.pdf`)
    expect(safeFileName(`${'a'.repeat(100)}.tar.gz`, 20)).toBe(`${'a'.repeat(17)}.gz`)
    expect(safeFileName(`${'a'.repeat(100)}.${'b'.repeat(10)}`, 30)).toBe(`${'a'.repeat(19)}.${'b'.repeat(10)}`)
    // Хвост длиннее 10 символов расширением не считается.
    expect(safeFileName(`${'a'.repeat(100)}.${'b'.repeat(11)}`, 30)).toBe('a'.repeat(30))
    expect(safeFileName(`${'a'.repeat(100)}. не расширение`, 30)).toBe('a'.repeat(30))
  })

  it('после обрезки снова убираются конечные точки и пробелы', () => {
    expect(safeFileName('aaaa bbbb', 5)).toBe('aaaa')
    expect(safeFileName('abc.. def', 5)).toBe('abc')
    expect(safeFileName(`${'a'.repeat(9)} ${'b'.repeat(30)}.txt`, 14)).toBe(`${'a'.repeat(9)}.txt`)
  })

  it('эмодзи на границе обрезки не разрывается', () => {
    expect(safeFileName(`${'a'.repeat(79)}😀b`)).toBe('a'.repeat(79))
    expect(safeFileName(`${'a'.repeat(78)}😀bbb`)).toBe(`${'a'.repeat(78)}😀`)
    expect(safeFileName(`${'a'.repeat(75)}😀😀.png`)).toBe(`${'a'.repeat(75)}.png`)
    expect(safeFileName('😀😀😀', 3)).toBe('😀')
    expect(safeFileName('😀😀😀', 4)).toBe('😀😀')
  })

  it('половина суррогатной пары заменяется пробелом', () => {
    expect(safeFileName('a\ud83db')).toBe('a b')
    expect(safeFileName('\ude00имя')).toBe('имя')
    expect(() => encodeURI(safeFileName('x\ud800'))).not.toThrow()
  })

  it('обрезка не выдаёт зарезервированное имя', () => {
    expect(safeFileName('CONSOLE', 3)).toBe('_CO')
    expect(safeFileName('nul.txt-and-more', 3)).toBe('_nu')
    expect(safeFileName('con.abcdefghijklmnop', 5)).toBe('_con')
  })

  it('результат всегда проходит safe_rel_path и укладывается в длину', () => {
    const nasty = [
      '', ' ', '.', '..', '...', '/', '\\', 'a/b\\c', '../../etc/passwd', 'C:\\Windows\\system32', 'a:b',
      'CON', 'con.', 'con .', 'NUL.txt', 'COM1', 'LPT¹.x', 'conin$', 'CONOUT$.', 'x.qdpart', 'x.QdPart ',
      'имя.', 'имя ', ' имя', '.имя', 'a\u0000b', 'a\tb', '<script>', '"quoted"', 'a|b', 'a?b*c', '#тег', '[[вики]]',
      'a^b', `${'я'.repeat(300)}`, `${'x'.repeat(300)}.pdf`, `${'😀'.repeat(100)}`, `con.${'x'.repeat(100)}`,
      `${'a'.repeat(79)}.`, `${'a'.repeat(79)} b`, `${'a'.repeat(70)}.qdpart.qdpart`, '\ud800', 'a\udfffb',
    ]
    for (const raw of nasty) {
      for (const max of [undefined, 72, 74, 12, 5]) {
        const name = safeFileName(raw, max)
        expect(relPathProblem(name), `${JSON.stringify(raw)} → ${JSON.stringify(name)}`).toBeNull()
        expect(relPathProblem(`${name}.md`), `${JSON.stringify(name)}.md`).toBeNull()
        expect(name.length).toBeGreaterThan(0)
        expect(name.length).toBeLessThanOrEqual(max ?? 80)
        expect(name).not.toMatch(/[\\/:#^[\]]/)
        expect(name).toBe(name.trim())
        expect(name.startsWith('.')).toBe(false)
        // Повторная очистка ничего не меняет.
        expect(safeFileName(name, max)).toBe(name)
      }
    }
  })
})

describe('planMarkdownExport', () => {
  it('имя заметки — очищенный производный заголовок', () => {
    const plan = planMarkdownExport([
      mk('a', { title: 'План: Q3/Q4?' }),
      mk('b', { content: 'Первая строка\nвторая', createdAt: T0 + 1 }),
      mk('c', { type: 'file', fileId: 'f', fileName: 'Договор.pdf', createdAt: T0 + 2 }),
      mk('d', { createdAt: T0 + 3 }),
    ])
    expect([...plan.notes]).toEqual([
      ['a', 'План Q3 Q4'],
      ['b', 'Первая строка'],
      ['c', 'Договор.pdf'],
      ['d', 'Без названия'],
    ])
    expect([...plan.attachments]).toEqual([['c', 'attachments/Договор.pdf']])
  })

  it('конечное «.md» в заголовке срезается: файл не «README.md.md», ссылка ведёт на свою запись', () => {
    const md = mk('m1', { title: 'README.md', createdAt: T0 })
    const plain = mk('m2', { title: 'README', createdAt: T0 + 1, links: ['m1'] })
    const entries = buildMarkdownExport([md, plain], [])
    expect(entries.map((e) => e.path)).toEqual(['README.md', 'README (2).md'])
    expect(entries[1].markdown).toContain('## Связанные\n\n- [[README]]\n')
    expect(entries[0].markdown).toContain('title: "README.md"')

    const plan = planMarkdownExport([
      mk('a', { title: 'Заметки.MD.md' }),
      mk('b', { title: '.md', createdAt: T0 + 1 }),
      mk('c', { type: 'file', fileId: 'f', fileName: 'notes.md', createdAt: T0 + 2 }),
    ])
    expect([...plan.notes.values()]).toEqual(['Заметки', 'Без названия', 'notes'])
    // имя вложения — как есть
    expect(plan.attachments.get('c')).toBe('attachments/notes.md')
  })

  it('совпадения имён без учёта регистра получают суффикс в порядке (createdAt, id)', () => {
    const items = [
      mk('z', { title: 'заметка', createdAt: T0 + 2000 }),
      mk('m', { title: 'ЗАМЕТКА', createdAt: T0 + 1000 }),
      mk('b', { title: 'Заметка', createdAt: T0 }),
      mk('a', { title: 'Заметка?', createdAt: T0 }),
    ]
    const plan = planMarkdownExport(items)
    expect(plan.notes.get('a')).toBe('Заметка')
    expect(plan.notes.get('b')).toBe('Заметка (2)')
    expect(plan.notes.get('m')).toBe('ЗАМЕТКА (3)')
    expect(plan.notes.get('z')).toBe('заметка (4)')
    // Порядок входа на имена не влияет.
    expect([...planMarkdownExport([...items].reverse()).notes].sort()).toEqual([...plan.notes].sort())
  })

  it('суффикс не совпадает с именем, которое уже занято', () => {
    const plan = planMarkdownExport([
      mk('a', { title: 'A', createdAt: T0 }),
      mk('b', { title: 'a (2)', createdAt: T0 + 1 }),
      mk('c', { title: 'A', createdAt: T0 + 2 }),
      mk('d', { title: 'A (2)', createdAt: T0 + 3 }),
      mk('e', { title: 'a', createdAt: T0 + 4 }),
    ])
    expect([...plan.notes.values()]).toEqual(['A', 'a (2)', 'A (3)', 'A (2) (2)', 'a (4)'])
  })

  it('записи из корзины в план не попадают', () => {
    const plan = planMarkdownExport([
      mk('a', { title: 'Тема', deletedAt: T0 + 5, createdAt: T0 }),
      mk('b', { title: 'Тема', createdAt: T0 + 1 }),
      mk('c', { type: 'image', fileId: 'f', fileName: 'x.png', deletedAt: T0 + 5 }),
    ])
    expect([...plan.notes]).toEqual([['b', 'Тема']])
    expect(plan.attachments.size).toBe(0)
  })

  it('вложения с одинаковым именем: суффикс перед расширением', () => {
    const plan = planMarkdownExport([
      mk('a', { type: 'image', fileId: 'f1', fileName: 'scan.png', createdAt: T0 }),
      mk('b', { type: 'image', fileId: 'f2', fileName: 'scan.png', createdAt: T0 + 1 }),
      mk('c', { type: 'file', fileId: 'f3', fileName: 'SCAN.PNG', createdAt: T0 + 2 }),
      mk('d', { type: 'file', fileId: 'f4', fileName: 'README', createdAt: T0 + 3 }),
      mk('e', { type: 'file', fileId: 'f5', fileName: 'readme', createdAt: T0 + 4 }),
      mk('f', { type: 'file', fileId: 'f6', fileName: 'archive.tar.gz', createdAt: T0 + 5 }),
      mk('g', { type: 'file', fileId: 'f7', fileName: 'archive.tar.gz', createdAt: T0 + 6 }),
    ])
    expect([...plan.attachments]).toEqual([
      ['a', 'attachments/scan.png'],
      ['b', 'attachments/scan (2).png'],
      ['c', 'attachments/SCAN (3).PNG'],
      ['d', 'attachments/README'],
      ['e', 'attachments/readme (2)'],
      ['f', 'attachments/archive.tar.gz'],
      ['g', 'attachments/archive.tar (2).gz'],
    ])
  })

  it('вложение есть только у file/image с fileId; имя файла очищается', () => {
    const plan = planMarkdownExport([
      mk('a', { type: 'file', fileName: 'нет-файла.pdf', createdAt: T0 }),
      mk('b', { type: 'text', fileId: 'f', fileName: 'лишнее.txt', createdAt: T0 + 1 }),
      mk('c', { type: 'image', fileId: 'f2', createdAt: T0 + 2 }),
      mk('d', { type: 'file', fileId: 'f3', fileName: 'con.txt', createdAt: T0 + 3 }),
      mk('e', { type: 'file', fileId: 'f4', fileName: '..\\..\\a:b?.exe', createdAt: T0 + 4 }),
      mk('f', { type: 'file', fileId: 'f5', fileName: 'часть.qdpart', createdAt: T0 + 5 }),
    ])
    expect([...plan.attachments]).toEqual([
      ['c', 'attachments/Без названия'],
      ['d', 'attachments/_con.txt'],
      ['e', 'attachments/a b .exe'],
      ['f', 'attachments/часть.qdpart_'],
    ])
  })

  it('длинные одинаковые имена: файл с суффиксом и расширением не длиннее 80 символов', () => {
    const items: Item[] = []
    for (let i = 0; i < 130; i++) {
      items.push(
        mk(`n${String(i).padStart(3, '0')}`, {
          type: 'file',
          title: `${'Ж'.repeat(100)}?`,
          fileId: `f${i}`,
          fileName: `${'y'.repeat(100)}.jpeg`,
          createdAt: T0 + i,
        }),
      )
    }
    const plan = planMarkdownExport(items)
    const notePaths = [...plan.notes.values()].map((name) => `${name}.md`)
    const filePaths = [...plan.attachments.values()]
    expect(notePaths).toHaveLength(130)
    expect(filePaths).toHaveLength(130)
    expect(notePaths[0]).toBe(`${'Ж'.repeat(72)}.md`)
    expect(notePaths[1]).toBe(`${'Ж'.repeat(72)} (2).md`)
    expect(notePaths[99]).toBe(`${'Ж'.repeat(71)} (100).md`)
    expect(filePaths[0]).toBe(`attachments/${'y'.repeat(69)}.jpeg`)
    expect(filePaths[129]).toBe(`attachments/${'y'.repeat(69)} (130).jpeg`)

    for (const path of [...notePaths, ...filePaths]) {
      expect(relPathProblem(path), path).toBeNull()
      const parts = path.split('/')
      expect(parts.length).toBeLessThanOrEqual(2)
      expect(parts[parts.length - 1].length).toBeLessThanOrEqual(80)
    }
    const fold = (s: string) => s.toLowerCase()
    expect(new Set(notePaths.map(fold)).size).toBe(130)
    expect(new Set(filePaths.map(fold)).size).toBe(130)
  })

  it('повтор id во входе учитывается один раз', () => {
    const item = mk('a', { title: 'Тема' })
    expect([...planMarkdownExport([item, item]).notes]).toEqual([['a', 'Тема']])
  })

  it('пустой вход', () => {
    const plan = planMarkdownExport([])
    expect(plan.notes.size).toBe(0)
    expect(plan.attachments.size).toBe(0)
  })
})

describe('itemToMarkdown', () => {
  it('text: шапка, заголовок, текст, «Связанные»', () => {
    const note = mk('a1', {
      title: 'План на квартал',
      content: 'Первый абзац.\n\nВторой абзац.\n',
      categoryId: 'c1',
      tags: ['работа', 'план'],
      favorite: 1,
      links: ['b1'],
      updatedAt: T0 + HOUR,
    })
    const idea = mk('b1', {
      type: 'idea',
      content: 'Идея без заголовка\nвторая строка',
      status: 'inbox',
      links: ['a1'],
      createdAt: T0 + 1000,
      updatedAt: T0 + 1000,
    })
    const items = [note, idea]

    expect(render(note, items)).toEqual({
      id: 'a1',
      path: 'План на квартал.md',
      attachments: [],
      markdown: [
        '---',
        'id: "a1"',
        'title: "План на квартал"',
        'type: "text"',
        'status: "library"',
        'category: "Работа"',
        'tags: ["работа", "план"]',
        'favorite: true',
        'created: "2026-01-15T10:00:00.000Z"',
        'updated: "2026-01-15T11:00:00.000Z"',
        'source: "quickdrop"',
        '---',
        '',
        '# План на квартал',
        '',
        'Первый абзац.',
        '',
        'Второй абзац.',
        '',
        '## Связанные',
        '',
        '- [[Идея без заголовка]]',
        '',
      ].join('\n'),
    })

    // idea без своего заголовка: строки «# …» нет, категории и избранного в шапке нет.
    expect(render(idea, items)).toEqual({
      id: 'b1',
      path: 'Идея без заголовка.md',
      attachments: [],
      markdown: [
        '---',
        'id: "b1"',
        'title: "Идея без заголовка"',
        'type: "idea"',
        'status: "inbox"',
        'tags: []',
        'created: "2026-01-15T10:00:01.000Z"',
        'updated: "2026-01-15T10:00:01.000Z"',
        'source: "quickdrop"',
        '---',
        '',
        'Идея без заголовка',
        'вторая строка',
        '',
        '## Связанные',
        '',
        '- [[План на квартал]]',
        '',
      ].join('\n'),
    })
  })

  it('link: ссылка, описание цитатой, комментарий', () => {
    const link = mk('l1', {
      type: 'link',
      url: 'https://example.com/a b?q=(1)',
      linkMeta: { title: 'Пример [сайт]', description: 'Описание\nстраницы', status: 'ok' },
      content: 'Мой комментарий',
      status: 'archive',
    })
    expect(render(link)).toEqual({
      id: 'l1',
      path: 'Пример сайт.md',
      attachments: [],
      markdown: [
        '---',
        'id: "l1"',
        'title: "Пример [сайт]"',
        'type: "link"',
        'status: "archive"',
        'tags: []',
        'url: "https://example.com/a b?q=(1)"',
        'created: "2026-01-15T10:00:00.000Z"',
        'updated: "2026-01-15T10:00:00.000Z"',
        'source: "quickdrop"',
        '---',
        '',
        '[Пример \\[сайт\\]](https://example.com/a%20b?q=%281%29)',
        '',
        '> Описание страницы',
        '',
        'Мой комментарий',
        '',
      ].join('\n'),
    })
  })

  it('link без описания и комментария — только ссылка', () => {
    const link = mk('l2', { type: 'link', title: 'Док', url: 'https://example.com/%D0%B0?x=1&y=2#top' })
    expect(body(render(link).markdown)).toBe('\n[Док](https://example.com/%D0%B0?x=1&y=2#top)\n')
  })

  it('code: блок с языком, ограда длиннее серий кавычек в коде', () => {
    const code = mk('k1', {
      type: 'code',
      title: 'Сниппет',
      language: 'ts',
      content: 'const a = `x`\n```\nвнутри [[План]]\n```\n',
      tags: ['код'],
    })
    const other = mk('p1', { title: 'План', createdAt: T0 + 1 })
    expect(render(code, [code, other])).toEqual({
      id: 'k1',
      path: 'Сниппет.md',
      attachments: [],
      markdown: [
        '---',
        'id: "k1"',
        'title: "Сниппет"',
        'type: "code"',
        'status: "library"',
        'tags: ["код"]',
        'created: "2026-01-15T10:00:00.000Z"',
        'updated: "2026-01-15T10:00:00.000Z"',
        'source: "quickdrop"',
        '---',
        '',
        '````ts',
        'const a = `x`',
        '```',
        'внутри [[План]]',
        '```',
        '````',
        '',
      ].join('\n'),
    })
  })

  it('code: ограда минимум из трёх кавычек, язык необязателен', () => {
    expect(body(render(mk('k2', { type: 'code', content: 'print(1)' })).markdown)).toBe('\n```\nprint(1)\n```\n')
    expect(body(render(mk('k3', { type: 'code', content: 'a `b` c', language: 'py' })).markdown)).toBe(
      '\n```py\na `b` c\n```\n',
    )
    expect(body(render(mk('k4', { type: 'code', content: 'x\n``````\ny' })).markdown)).toBe(
      '\n```````\nx\n``````\ny\n```````\n',
    )
    expect(body(render(mk('k5', { type: 'code', content: '  отступ сохранён\r\nстрока 2' })).markdown)).toBe(
      '\n```\n  отступ сохранён\nстрока 2\n```\n',
    )
  })

  it('image: комментарий, картинка, распознанный текст, вложение', () => {
    const image = mk('i1', {
      type: 'image',
      content: 'Подпись к фото',
      fileId: 'f1',
      fileName: 'Фото (1).png',
      mimeType: 'image/png',
      ocrText: 'Распознано\n\nстрока 2\n',
    })
    expect(render(image)).toEqual({
      id: 'i1',
      path: 'Фото (1).png.md',
      attachments: [{ path: 'attachments/Фото (1).png', fileId: 'f1', name: 'Фото (1).png' }],
      markdown: [
        '---',
        'id: "i1"',
        'title: "Фото (1).png"',
        'type: "image"',
        'status: "library"',
        'tags: []',
        'created: "2026-01-15T10:00:00.000Z"',
        'updated: "2026-01-15T10:00:00.000Z"',
        'source: "quickdrop"',
        '---',
        '',
        'Подпись к фото',
        '',
        '![Фото (1).png](attachments/%D0%A4%D0%BE%D1%82%D0%BE%20%281%29.png)',
        '',
        '## Распознанный текст',
        '',
        'Распознано',
        '',
        'строка 2',
        '',
      ].join('\n'),
    })
  })

  it('file: ссылка на вложение, «%» в имени кодируется', () => {
    const file = mk('f1', {
      type: 'file',
      title: 'Договор',
      fileId: 'file-1',
      fileName: 'contract 100%.pdf',
      ocrText: 'Текст договора',
      links: ['n1'],
    })
    const note = mk('n1', { title: 'Заметка', links: ['f1'], createdAt: T0 + 1 })
    expect(render(file, [file, note])).toEqual({
      id: 'f1',
      path: 'Договор.md',
      attachments: [{ path: 'attachments/contract 100%.pdf', fileId: 'file-1', name: 'contract 100%.pdf' }],
      markdown: [
        '---',
        'id: "f1"',
        'title: "Договор"',
        'type: "file"',
        'status: "library"',
        'tags: []',
        'created: "2026-01-15T10:00:00.000Z"',
        'updated: "2026-01-15T10:00:00.000Z"',
        'source: "quickdrop"',
        '---',
        '',
        '[contract 100%.pdf](attachments/contract%20100%25.pdf)',
        '',
        '## Распознанный текст',
        '',
        'Текст договора',
        '',
        '## Связанные',
        '',
        '- [[Заметка]]',
        '',
      ].join('\n'),
    })
  })

  it('file без fileId: ни ссылки, ни вложения', () => {
    const entry = render(mk('f2', { type: 'file', fileName: 'потерян.pdf', content: 'комментарий' }))
    expect(entry.attachments).toEqual([])
    expect(body(entry.markdown)).toBe('\nкомментарий\n')
  })

  it('имя вложения в ссылке — исходное, путь — очищенный и без совпадений', () => {
    const first = mk('a', { type: 'file', fileId: 'f1', fileName: 'отчёт [итог].pdf', createdAt: T0 })
    const second = mk('b', { type: 'file', fileId: 'f2', fileName: 'отчёт (итог).pdf', title: 'Второй', createdAt: T0 + 1 })
    const third = mk('c', { type: 'file', fileId: 'f3', fileName: 'ОТЧЁТ (ИТОГ).PDF', title: 'Третий', createdAt: T0 + 2 })
    const items = [first, second, third]
    expect(render(first, items).attachments).toEqual([
      { path: 'attachments/отчёт итог .pdf', fileId: 'f1', name: 'отчёт [итог].pdf' },
    ])
    expect(body(render(first, items).markdown)).toBe(
      `\n[отчёт \\[итог\\].pdf](${encodeURI('attachments/отчёт итог .pdf')})\n`,
    )
    expect(render(second, items).attachments[0].path).toBe('attachments/отчёт (итог).pdf')
    expect(render(third, items).attachments[0].path).toBe('attachments/ОТЧЁТ (ИТОГ) (2).PDF')
    expect(body(render(third, items).markdown)).toBe(
      `\n[ОТЧЁТ (ИТОГ).PDF](attachments/${encodeURI('ОТЧЁТ')}%20%28${encodeURI('ИТОГ')}%29%20%282%29.PDF)\n`,
    )
  })

  it('кавычки, обратная косая и перевод строки в заголовке', () => {
    const item = mk('q1', {
      title: 'Он сказал "да"\nи ушёл \\ конец',
      content: 'текст',
      categoryId: 'c2',
      tags: ['a"b', 'c\\d', 'тег: с, запятой'],
    })
    const entry = render(item)
    expect(entry.path).toBe('Он сказал да и ушёл конец.md')
    expect(entry.markdown).toBe(
      [
        '---',
        'id: "q1"',
        'title: "Он сказал \\"да\\" и ушёл \\\\ конец"',
        'type: "text"',
        'status: "library"',
        'category: "Дом: \\"уют\\""',
        'tags: ["a\\"b", "c\\\\d", "тег: с, запятой"]',
        'created: "2026-01-15T10:00:00.000Z"',
        'updated: "2026-01-15T10:00:00.000Z"',
        'source: "quickdrop"',
        '---',
        '',
        '# Он сказал "да" и ушёл \\ конец',
        '',
        'текст',
        '',
      ].join('\n'),
    )
  })

  it('шапка остаётся одной строкой на поле при любых переводах строк', () => {
    const item = mk('q2', {
      type: 'link',
      title: 'a\r\nb\u2028c\u0085d\te\u0000f',
      url: 'https://example.com/x',
      tags: ['x\ny'],
    })
    const { markdown } = render(item)
    const header = markdown.slice(0, markdown.indexOf('\n---\n', 4)).split('\n')
    expect(header).toEqual([
      '---',
      'id: "q2"',
      'title: "a b c d ef"',
      'type: "link"',
      'status: "library"',
      'tags: ["x y"]',
      'url: "https://example.com/x"',
      'created: "2026-01-15T10:00:00.000Z"',
      'updated: "2026-01-15T10:00:00.000Z"',
      'source: "quickdrop"',
    ])
    expect(body(markdown)).toBe('\n[a b c d ef](https://example.com/x)\n')
    // eslint-disable-next-line no-control-regex
    expect(markdown).not.toMatch(/[\u2028\u0085\u0000\r\t]/)
  })

  it('неизвестная категория, url не у ссылки и негодные даты в шапку не попадают', () => {
    const item = mk('q3', {
      title: 'Т',
      categoryId: 'нет-такой',
      url: 'https://example.com',
      createdAt: Number.NaN,
      updatedAt: 9e15,
    })
    const { markdown } = render(item)
    expect(markdown).not.toContain('category:')
    expect(markdown).not.toContain('url:')
    expect(markdown).not.toContain('created:')
    expect(markdown).not.toContain('updated:')
    expect(markdown).toContain('\nsource: "quickdrop"\n---\n')
  })

  it('вики-ссылки переписываются на имена файлов', () => {
    const target = mk('t1', { title: 'Ёлка: план?', createdAt: T0 })
    const plain = mk('t2', { title: 'Простая', createdAt: T0 + 1 })
    const trashed = mk('t3', { title: 'В корзине', deletedAt: T0 + 9, createdAt: T0 + 2 })
    const source = mk('s1', {
      title: 'Источник',
      createdAt: T0 + 3,
      content: [
        'См. [[елка: ПЛАН?]] и [[ёлка: план?|мой план]].',
        '[[Простая]], [[простая]], [[ Простая | Простая ]].',
        'Не трогаем: [[Нет такой]], [[В корзине]], [[Источник]], `[[Простая]]`.',
        '',
        '```',
        '[[Простая]]',
        '```',
      ].join('\n'),
    })
    const items = [target, plain, trashed, source]
    expect(planMarkdownExport(items).notes.get('t1')).toBe('Ёлка план')
    expect(body(render(source, items).markdown)).toBe(
      [
        '',
        '# Источник',
        '',
        'См. [[Ёлка план|елка: ПЛАН?]] и [[Ёлка план|мой план]].',
        '[[Простая]], [[Простая|простая]], [[Простая]].',
        'Не трогаем: [[Нет такой]], [[В корзине]], [[Источник]], `[[Простая]]`.',
        '',
        '```',
        '[[Простая]]',
        '```',
        '',
      ].join('\n'),
    )
  })

  it('ссылка через «\\|» в таблице переписывается тоже через «\\|»: ячейка не разрезается', () => {
    const target = mk('t1', { title: 'Ёлка: план?', createdAt: T0 })
    const source = mk('s1', {
      createdAt: T0 + 1,
      content: [
        '| Запись | Заметка |',
        '| --- | --- |',
        '| [[ёлка: план?\\|мой план]] | [[Ёлка: план?\\|Ёлка план]] |',
        '',
        'Вне таблицы: [[елка: план?|обычная]].',
      ].join('\n'),
    })
    const items = [target, source]
    const out = body(render(source, items).markdown)
    expect(out).toBe(
      [
        '',
        '| Запись | Заметка |',
        '| --- | --- |',
        '| [[Ёлка план\\|мой план]] | [[Ёлка план]] |',
        '',
        'Вне таблицы: [[Ёлка план|обычная]].',
        '',
      ].join('\n'),
    )
    // Ячейки делит только неэкранированная «|»: в строке по-прежнему две ячейки.
    const cells = (row: string) => row.split(/(?<!\\)\|/).slice(1, -1)
    const row = out.split('\n')[3]
    expect(cells(row)).toEqual([' [[Ёлка план\\|мой план]] ', ' [[Ёлка план]] '])
  })

  it('вики-ссылка без подписи в таблице получает подпись через «\\|»: строка таблицы не ломается', () => {
    const target = mk('t1', { title: 'Цель: план', createdAt: T0 })
    const twin = mk('t2', { title: 'Тема', createdAt: T0 + 1 })
    const twin2 = mk('t3', { title: 'тема', createdAt: T0 + 2 })
    const source = mk('s1', {
      createdAt: T0 + 3,
      content: [
        '| Запись | Ещё |',
        '|---|---|',
        '| [[цель: план]] | [[тема]] |',
        '| [[Тема]] | [[Цель: план\\|под\\|пись]] |',
        '',
        'Вне таблицы: [[цель: план]] и [[Цель: план|под\\|пись]].',
      ].join('\n'),
    })
    const items = [target, twin, twin2, source]
    expect(planMarkdownExport(items).notes.get('t1')).toBe('Цель план')
    const out = body(render(source, items).markdown)
    expect(out).toBe(
      [
        '',
        '| Запись | Ещё |',
        '|---|---|',
        '| [[Цель план\\|цель: план]] | [[Тема\\|тема]] |',
        '| [[Тема]] | [[Цель план\\|под\\|пись]] |',
        '',
        'Вне таблицы: [[Цель план|цель: план]] и [[Цель план|под|пись]].',
        '',
      ].join('\n'),
    )
    const cells = (row: string) => row.split(/(?<!\\)\|/).slice(1, -1)
    expect(cells(out.split('\n')[3])).toHaveLength(2)
    expect(cells(out.split('\n')[4])).toHaveLength(2)
  })

  it('индексная заметка из одних вики-ссылок не перехватывает их цель в экспорте', () => {
    const index = mk('b', { content: '- [[Проект А]]\n- [[Проект Б]]', status: 'inbox', createdAt: T0 })
    const a = mk('a', { title: 'Проект А', status: 'inbox', createdAt: T0 + 1000 })
    const c = mk('c', { title: 'Ссылки', content: 'см. [[Проект А]]', createdAt: T0 + 2000 })
    const items = [index, a, c]
    const plan = planMarkdownExport(items)
    // имя файла заметки — по displayTitle, но ссылки ведут к записи «Проект А»
    expect(plan.notes.get('b')).toBe('Проект А')
    expect(plan.notes.get('a')).toBe('Проект А (2)')
    expect(body(render(c, items).markdown)).toBe('\n# Ссылки\n\nсм. [[Проект А (2)|Проект А]]\n')
    expect(body(render(index, items).markdown)).toBe('\n- [[Проект А (2)|Проект А]]\n- [[Проект Б]]\n')
  })

  it('вики-ссылка на одноимённые записи ведёт к файлу победителя', () => {
    const inbox = mk('d1', { title: 'Дубль', status: 'inbox', createdAt: T0 })
    const library = mk('d2', { title: 'дубль', status: 'library', createdAt: T0 + 1 })
    const source = mk('s2', { content: 'см. [[ДУБЛЬ]]', createdAt: T0 + 2 })
    const items = [inbox, library, source]
    const plan = planMarkdownExport(items)
    expect(plan.notes.get('d1')).toBe('Дубль')
    expect(plan.notes.get('d2')).toBe('дубль (2)')
    expect(body(render(source, items).markdown)).toBe('\nсм. [[дубль (2)|ДУБЛЬ]]\n')
  })

  it('вики-ссылки переписываются и в комментарии к ссылке, но не в распознанном тексте', () => {
    const target = mk('t1', { title: 'Цель: 1' })
    const link = mk('l3', {
      type: 'link',
      title: 'Сайт',
      url: 'https://example.com',
      content: 'ср. [[цель: 1]]',
      ocrText: '[[цель: 1]]',
      createdAt: T0 + 1,
    })
    expect(body(render(link, [target, link]).markdown)).toBe(
      '\n[Сайт](https://example.com)\n\nср. [[Цель 1|цель: 1]]\n\n## Распознанный текст\n\n[[цель: 1]]\n',
    )
  })

  it('связь с записью из корзины и с неизвестной записью не выводится', () => {
    const ok = mk('ok', { title: 'Живая', createdAt: T0 + 1 })
    const trashed = mk('tr', { title: 'Удалённая', deletedAt: T0 + 9, createdAt: T0 + 2 })
    const both = mk('m1', { title: 'Обе', content: 'x', links: ['tr', 'ok', 'нет', 'ok', 'm1'] })
    const onlyTrashed = mk('m2', { title: 'Только корзина', content: 'x', links: ['tr'], createdAt: T0 + 3 })
    const items = [ok, trashed, both, onlyTrashed]
    expect(body(render(both, items).markdown)).toBe('\n# Обе\n\nx\n\n## Связанные\n\n- [[Живая]]\n')
    expect(body(render(onlyTrashed, items).markdown)).toBe('\n# Только корзина\n\nx\n')
  })

  it('«Связанные» ссылается на имена с суффиксами, в порядке item.links', () => {
    const a = mk('a', { title: 'Тема', createdAt: T0 })
    const b = mk('b', { title: 'тема', createdAt: T0 + 1 })
    const c = mk('c', { title: 'Итог: 2026', createdAt: T0 + 2, links: ['b', 'a'] })
    expect(body(render(c, [a, b, c]).markdown)).toBe('\n# Итог: 2026\n\n## Связанные\n\n- [[тема (2)]]\n- [[Тема]]\n')
  })

  it('незакрытый блок кода в тексте не поглощает разделы ниже', () => {
    const other = mk('o1', { title: 'Другая', createdAt: T0 + 1 })
    const item = mk('u1', { content: 'текст\n```js\nconst x = 1', ocrText: '~~~\nскан', links: ['o1'] })
    expect(body(render(item, [item, other]).markdown)).toBe(
      [
        '',
        'текст',
        '```js',
        'const x = 1',
        '```',
        '',
        '## Распознанный текст',
        '',
        '~~~',
        'скан',
        '~~~',
        '',
        '## Связанные',
        '',
        '- [[Другая]]',
        '',
      ].join('\n'),
    )
  })

  it('незакрытый блок кода в пункте списка закрывается внутри пункта', () => {
    const other = mk('o1', { title: 'Другая', createdAt: T0 + 1 })
    for (const [content, close] of [
      ['1. шаг\n   ```\n   код', '   ```'],
      ['- шаг\n  ```\n  код', '  ```'],
    ]) {
      const item = mk('u2', { content, links: ['o1'] })
      // Ограда без отступа завершила бы пункт и открыла новый блок кода, поглотив «Связанные».
      expect(body(render(item, [item, other]).markdown)).toBe(
        ['', content, close, '', '## Связанные', '', '- [[Другая]]', ''].join('\n'),
      )
    }
  })

  it('CRLF и пустые строки по краям текста убираются', () => {
    const item = mk('w1', { title: 'Т', content: '\r\n\r\n  первая\r\nвторая  \r\n\r\n' })
    expect(body(render(item).markdown)).toBe('\n# Т\n\n  первая\nвторая\n')
  })

  it('пустая запись: только шапка', () => {
    const entry = render(mk('e1'))
    expect(entry.path).toBe('Без названия.md')
    expect(entry.markdown).toBe(
      [
        '---',
        'id: "e1"',
        'title: "Без названия"',
        'type: "text"',
        'status: "library"',
        'tags: []',
        'created: "2026-01-15T10:00:00.000Z"',
        'updated: "2026-01-15T10:00:00.000Z"',
        'source: "quickdrop"',
        '---',
        '',
      ].join('\n'),
    )
  })

  it('запись вне плана (корзина) получает имя с суффиксом из id и не совпадает с заметкой плана', () => {
    const trashed = mk('x1', { title: 'CON', deletedAt: T0 })
    const entry = itemToMarkdown(trashed, { categories: [], items: [trashed], plan: planMarkdownExport([trashed]) })
    expect(entry.path).toBe('_CON (x1).md')

    const live = mk('a1', { title: 'План' })
    const gone = mk('3f2c9a1e-77b0-4c1d-9e2f-000000000000', { title: 'План', deletedAt: T0 })
    const items = [live, gone]
    const plan = planMarkdownExport(items)
    const paths = items.map((item) => itemToMarkdown(item, { categories: [], items, plan }).path)
    expect(paths).toEqual(['План.md', 'План (3f2c9a1e).md'])
    expect(relPathProblem(paths[1])).toBeNull()

    const long = mk('b1', { title: 'д'.repeat(200), deletedAt: T0 })
    const longPath = itemToMarkdown(long, { categories: [], items: [long], plan: planMarkdownExport([long]) }).path
    expect(longPath.endsWith(' (b1).md')).toBe(true)
    expect(longPath.length).toBeLessThanOrEqual(80)
  })
})

describe('buildMarkdownExport', () => {
  const items = [
    mk('c', { title: 'Третья', createdAt: T0 + 2, links: ['a', 't'] }),
    mk('t', { title: 'Корзина', createdAt: T0 + 1, deletedAt: T0 + 5, links: ['c'] }),
    mk('b', { type: 'image', fileId: 'f1', fileName: 'pic.png', createdAt: T0 + 1 }),
    mk('a', { title: 'Первая', content: 'см. [[третья]]', categoryId: 'c1', createdAt: T0, links: ['c'] }),
    mk('d', { type: 'file', fileId: 'f2', fileName: 'PIC.png', title: 'первая', createdAt: T0 + 3 }),
  ]

  it('план + запись на каждую запись без корзины, в порядке (createdAt, id)', () => {
    const entries = buildMarkdownExport(items, CATEGORIES)
    expect(entries.map((e) => [e.id, e.path])).toEqual([
      ['a', 'Первая.md'],
      ['b', 'pic.png.md'],
      ['c', 'Третья.md'],
      ['d', 'первая (2).md'],
    ])
    expect(entries.map((e) => e.attachments)).toEqual([
      [],
      [{ path: 'attachments/pic.png', fileId: 'f1', name: 'pic.png' }],
      [],
      [{ path: 'attachments/PIC (2).png', fileId: 'f2', name: 'PIC.png' }],
    ])

    const plan = planMarkdownExport(items)
    for (const entry of entries) {
      const item = items.find((i) => i.id === entry.id)!
      expect(entry).toEqual(itemToMarkdown(item, { categories: CATEGORIES, items, plan }))
    }

    expect(body(entries[0].markdown)).toBe('\n# Первая\n\nсм. [[Третья|третья]]\n\n## Связанные\n\n- [[Третья]]\n')
    expect(entries[0].markdown).toContain('\ncategory: "Работа"\n')
    expect(body(entries[2].markdown)).toBe('\n# Третья\n\n## Связанные\n\n- [[Первая]]\n')
    // Заголовок «# …» — только у text/idea.
    expect(body(entries[3].markdown)).toBe('\n[PIC.png](attachments/PIC%20%282%29.png)\n')
  })

  it('все пути уникальны, проходят safe_rel_path, не глубже двух уровней', () => {
    const many = [
      ...items,
      mk('r1', { title: 'CON', createdAt: T0 + 10 }),
      mk('r2', { title: '../../secret', createdAt: T0 + 11 }),
      mk('r3', { title: 'C:\\Users\\x', createdAt: T0 + 12 }),
      mk('r4', { type: 'file', fileId: 'f9', fileName: 'nul.qdpart', title: '...', createdAt: T0 + 13 }),
      mk('r5', { title: `${'длинный заголовок '.repeat(20)}`, createdAt: T0 + 14 }),
      mk('r6', { type: 'image', fileId: 'f10', fileName: `${'😀'.repeat(60)}.png`, createdAt: T0 + 15 }),
    ]
    const entries = buildMarkdownExport(many, [])
    const paths = entries.flatMap((e) => [e.path, ...e.attachments.map((a) => a.path)])
    expect(new Set(paths.map((p) => p.toLowerCase())).size).toBe(paths.length)
    for (const path of paths) {
      expect(relPathProblem(path), path).toBeNull()
      const parts = path.split('/')
      expect(parts.length).toBeLessThanOrEqual(2)
      expect(parts[parts.length - 1].length).toBeLessThanOrEqual(80)
    }
    for (const entry of entries) {
      expect(entry.path.endsWith('.md')).toBe(true)
      expect(entry.path).not.toContain('/')
      for (const a of entry.attachments) expect(a.path.startsWith('attachments/')).toBe(true)
    }
    expect(entries.find((e) => e.id === 'r1')?.path).toBe('_CON.md')
    expect(entries.find((e) => e.id === 'r2')?.path).toBe('secret.md')
    expect(entries.find((e) => e.id === 'r3')?.path).toBe('C Users x.md')
    expect(entries.find((e) => e.id === 'r4')?.attachments[0].path).toBe('attachments/_nul.qdpart_')
  })

  it('форма записи совместима с ExportDoc из exportDir (spec-tauri, п. 1.8)', () => {
    interface ExportAttachment { path: string; blob?: Blob; fileId?: string }
    interface ExportDoc { path: string; markdown: string; attachments?: readonly ExportAttachment[] }
    const entries: MdExportEntry[] = buildMarkdownExport(items, CATEGORIES)
    const docs: readonly ExportDoc[] = entries
    expect(docs).toHaveLength(4)
  })

  it('пустой вход и вход из одной корзины', () => {
    expect(buildMarkdownExport([], [])).toEqual([])
    expect(buildMarkdownExport([mk('t', { deletedAt: T0 })], [])).toEqual([])
  })
})
