import { describe, expect, it } from 'vitest'
import { MAX_GRAPH_COORD, MAX_OCR_TEXT, cleanOcrText, sanitizePoint, searchNameKey } from './normalize'

describe('cleanOcrText', () => {
  it('переводы строк приводятся к \\n', () => {
    expect(cleanOcrText('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })

  it('управляющие символы убираются, \\n и \\t остаются', () => {
    expect(cleanOcrText('a\u0000b\u0007c\u001fd\u007fe\u0085f\u009fg')).toBe('abcdefg')
    expect(cleanOcrText('кол1\tкол2\nстрока\u000b2\u000c')).toBe('кол1\tкол2\nстрока2')
  })

  it('обычный текст, кириллица и эмодзи не портятся', () => {
    const text = 'Счёт № 12 — «Ёлка»\n\tитого: 1 500 ₽ 🙂'
    expect(cleanOcrText(text)).toBe(text)
  })

  it('три и больше пустых строк подряд сжимаются до двух', () => {
    expect(cleanOcrText('a\n\nb')).toBe('a\n\nb')
    expect(cleanOcrText('a\n\n\nb')).toBe('a\n\n\nb')
    expect(cleanOcrText('a\n\n\n\nb')).toBe('a\n\n\nb')
    expect(cleanOcrText('a\n\n\n\n\n\n\nb')).toBe('a\n\n\nb')
    // строка из пробелов — тоже пустая; пустые строки, оставшиеся после управляющих символов, — тоже
    expect(cleanOcrText('a\n \n\t\n  \n\nb')).toBe('a\n\n\nb')
    expect(cleanOcrText('a\r\n\u0000\r\n\u0001\r\n\u0002\r\nb')).toBe('a\n\n\nb')
  })

  it('пробелы и пустые строки по краям обрезаются', () => {
    expect(cleanOcrText('  \n\n текст \n\n  ')).toBe('текст')
    expect(cleanOcrText(' \r\n\t\u0000 ')).toBe('')
    expect(cleanOcrText('')).toBe('')
  })

  it('обрезается до MAX_OCR_TEXT', () => {
    expect(cleanOcrText('a'.repeat(MAX_OCR_TEXT))).toHaveLength(MAX_OCR_TEXT)
    const cut = cleanOcrText('a'.repeat(MAX_OCR_TEXT + 500))
    expect(cut).toBe('a'.repeat(MAX_OCR_TEXT))
  })

  it('обрезка не оставляет половину суррогатной пары и хвостовые пробелы', () => {
    const emoji = cleanOcrText(`${'a'.repeat(MAX_OCR_TEXT - 1)}🙂хвост`)
    expect(emoji).toBe('a'.repeat(MAX_OCR_TEXT - 1))
    const spaces = cleanOcrText(`${'a'.repeat(MAX_OCR_TEXT - 3)}   хвост`)
    expect(spaces).toBe('a'.repeat(MAX_OCR_TEXT - 3))
  })

  it('идемпотентна', () => {
    const samples = [
      'a\r\n\r\n\r\n\r\n\r\nb\u0000 \n',
      `${'слово \n'.repeat(MAX_OCR_TEXT / 5)}`,
      `${'a'.repeat(MAX_OCR_TEXT - 1)}🙂`,
    ]
    for (const s of samples) {
      const once = cleanOcrText(s)
      expect(cleanOcrText(once)).toBe(once)
    }
  })
})

describe('sanitizePoint', () => {
  it('годная точка возвращается новой, без посторонних полей', () => {
    const raw = { id: 'a', x: 10, y: -20, extra: true }
    const point = sanitizePoint(raw)
    expect(point).toEqual({ x: 10, y: -20 })
    expect(point).not.toBe(raw)
    expect(Object.keys(point!)).toEqual(['x', 'y'])
  })

  it('координаты округляются до целого', () => {
    expect(sanitizePoint({ x: 1.4, y: 1.5 })).toEqual({ x: 1, y: 2 })
    expect(sanitizePoint({ x: -1.4, y: -1.6 })).toEqual({ x: -1, y: -2 })
  })

  it('минус ноль превращается в ноль', () => {
    const point = sanitizePoint({ x: -0, y: -0.4 })!
    expect(Object.is(point.x, 0)).toBe(true)
    expect(Object.is(point.y, 0)).toBe(true)
  })

  it('NaN, бесконечность и нечисловые координаты не годятся', () => {
    expect(sanitizePoint({ x: NaN, y: 0 })).toBeNull()
    expect(sanitizePoint({ x: 0, y: Infinity })).toBeNull()
    expect(sanitizePoint({ x: -Infinity, y: 0 })).toBeNull()
    expect(sanitizePoint({ x: '5', y: 0 })).toBeNull()
    expect(sanitizePoint({ x: 0, y: '0' })).toBeNull()
    expect(sanitizePoint({ x: null, y: 0 })).toBeNull()
    expect(sanitizePoint({ x: 1 })).toBeNull()
    expect(sanitizePoint({ y: 1 })).toBeNull()
    expect(sanitizePoint({})).toBeNull()
  })

  it('не объект не годится', () => {
    for (const raw of [null, undefined, 5, '1,2', true, [1, 2], () => {}]) {
      expect(sanitizePoint(raw)).toBeNull()
    }
  })

  it('координата по модулю не больше MAX_GRAPH_COORD', () => {
    expect(sanitizePoint({ x: MAX_GRAPH_COORD, y: -MAX_GRAPH_COORD })).toEqual({
      x: MAX_GRAPH_COORD,
      y: -MAX_GRAPH_COORD,
    })
    expect(sanitizePoint({ x: MAX_GRAPH_COORD + 1, y: 0 })).toBeNull()
    expect(sanitizePoint({ x: 0, y: -MAX_GRAPH_COORD - 1 })).toBeNull()
    expect(sanitizePoint({ x: 1e300, y: 0 })).toBeNull()
    // предел проверяется после округления
    expect(sanitizePoint({ x: MAX_GRAPH_COORD + 0.4, y: 0 })).toEqual({ x: MAX_GRAPH_COORD, y: 0 })
    expect(sanitizePoint({ x: MAX_GRAPH_COORD + 0.5, y: 0 })).toBeNull()
  })
})

describe('searchNameKey', () => {
  it('регистр, ё/е и лишние пробелы не различаются', () => {
    expect(searchNameKey('  Мои   Отчёты ')).toBe('мои отчеты')
    expect(searchNameKey('мои отчеты')).toBe('мои отчеты')
    expect(searchNameKey('МОИ\tОТЧЁТЫ\n')).toBe('мои отчеты')
  })

  it('дефисы и подчёркивания значимы (в отличие от имён категорий)', () => {
    expect(searchNameKey('to-do')).toBe('to-do')
    expect(searchNameKey('to-do')).not.toBe(searchNameKey('to do'))
    expect(searchNameKey('a_b')).not.toBe(searchNameKey('a b'))
  })

  it('пустое и пробельное имя дают пустой ключ', () => {
    expect(searchNameKey('')).toBe('')
    expect(searchNameKey(' \t ')).toBe('')
  })

  it('идемпотентна', () => {
    const key = searchNameKey('  Ёлка   2026 ')
    expect(searchNameKey(key)).toBe(key)
  })
})
