import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { groupByDay, type DayEntry } from './dayGroups'
import { NO_DATE } from './itemTitle'

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m, d, h, min).getTime()
/** Среда, 11 ноября 2026, 15:30 по местному времени. */
const NOW = at(2026, 10, 11, 15, 30)

type Row = { id: string; ts: number }
const row = (id: string, ts: number): Row => ({ id, ts })
const group = (rows: Row[], now = NOW) => groupByDay(rows, (r) => r.ts, now)

/** Компактный вид: заголовки — подписью в квадратных скобках, строки — id. */
const shape = (entries: DayEntry<Row>[]) => entries.map((e) => (e.kind === 'header' ? `[${e.label}]` : e.row.id))

describe('groupByDay', () => {
  it('сегодня, вчера и дата; заголовок — перед первой строкой суток', () => {
    const entries = group([
      row('a', at(2026, 10, 11, 14, 0)),
      row('b', at(2026, 10, 11, 0, 0)),
      row('c', at(2026, 10, 10, 23, 59)),
      row('d', at(2026, 10, 9, 8, 0)),
      row('e', at(2026, 10, 9, 7, 0)),
    ])
    expect(shape(entries)).toEqual(['[Сегодня]', 'a', 'b', '[Вчера]', 'c', '[9 ноября]', 'd', 'e'])
  })

  it('год в подписи — только для другого года', () => {
    const entries = group([row('a', at(2026, 0, 1, 9)), row('b', at(2025, 11, 31, 9))])
    expect(shape(entries)).toEqual(['[1 января]', 'a', '[31 декабря 2025]', 'b'])
  })

  it('ключи: порядковый номер и начало суток', () => {
    const entries = group([row('a', at(2026, 10, 11, 9)), row('b', at(2026, 10, 10, 9))])
    const keys = entries.flatMap((e) => (e.kind === 'header' ? [e.key] : []))
    expect(keys).toEqual([`d-0-${at(2026, 10, 11)}`, `d-1-${at(2026, 10, 10)}`])
  })

  it('сутки, встретившиеся не подряд, — два заголовка с разными ключами', () => {
    const entries = group([
      row('a', at(2026, 10, 11, 9)),
      row('b', at(2026, 10, 5, 9)),
      row('c', at(2026, 10, 11, 10)),
    ])
    expect(shape(entries)).toEqual(['[Сегодня]', 'a', '[5 ноября]', 'b', '[Сегодня]', 'c'])
    const keys = entries.flatMap((e) => (e.kind === 'header' ? [e.key] : []))
    expect(new Set(keys).size).toBe(3)
  })

  it('дозагрузка строк в конец не меняет прежние ключи', () => {
    const rows = [row('a', at(2026, 10, 11, 9)), row('b', at(2026, 10, 10, 9)), row('c', at(2026, 10, 1, 9))]
    const keysOf = (entries: DayEntry<Row>[]) => entries.flatMap((e) => (e.kind === 'header' ? [e.key] : []))
    const first = keysOf(group(rows.slice(0, 2)))
    const more = keysOf(group(rows))
    expect(more.slice(0, first.length)).toEqual(first)
  })

  it('пустой список — пусто', () => {
    expect(group([])).toEqual([])
  })

  it('негодная отметка — своя группа с заглушкой', () => {
    const entries = group([
      row('bad1', Number.NaN),
      row('bad2', 9e15),
      row('ok', at(2026, 10, 11, 9)),
      row('bad3', undefined as unknown as number),
    ])
    expect(shape(entries)).toEqual([`[${NO_DATE}]`, 'bad1', 'bad2', '[Сегодня]', 'ok', `[${NO_DATE}]`, 'bad3'])
    const keys = entries.flatMap((e) => (e.kind === 'header' ? [e.key] : []))
    expect(keys[0]).toBe('d-0-none')
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('строки идут как есть и в том же порядке', () => {
    const rows = [row('a', at(2026, 10, 11, 9)), row('b', at(2026, 10, 11, 8))]
    const entries = group(rows)
    expect(entries.filter((e) => e.kind === 'row').map((e) => (e.kind === 'row' ? e.row : null))).toEqual(rows)
    expect(entries[1]).toEqual({ kind: 'row', row: rows[0] })
  })

  it('полночь: 00:00:00.000 — новые сутки, 23:59:59.999 — прежние', () => {
    const midnight = at(2026, 10, 11)
    const entries = group([row('a', midnight + 1), row('b', midnight), row('c', midnight - 1), row('d', at(2026, 10, 10))])
    expect(shape(entries)).toEqual(['[Сегодня]', 'a', 'b', '[Вчера]', 'c', 'd'])
  })

  it('now ровно в полночь: «Сегодня» — новые сутки, вчерашние до последней миллисекунды — «Вчера»', () => {
    const midnight = at(2026, 10, 12)
    const entries = group([row('a', midnight), row('b', midnight - 1), row('c', at(2026, 10, 10, 23, 59))], midnight)
    expect(shape(entries)).toEqual(['[Сегодня]', 'a', '[Вчера]', 'b', '[10 ноября]', 'c'])
  })

  it('негодное now: строки группируются по суткам, подпись — заглушка', () => {
    const entries = group([row('a', at(2026, 10, 11, 9)), row('b', at(2026, 10, 11, 8)), row('c', at(2026, 10, 10))], Number.NaN)
    expect(shape(entries)).toEqual([`[${NO_DATE}]`, 'a', 'b', `[${NO_DATE}]`, 'c'])
    const keys = entries.flatMap((e) => (e.kind === 'header' ? [e.key] : []))
    expect(keys).toEqual([`d-0-${at(2026, 10, 11)}`, `d-1-${at(2026, 10, 10)}`])
  })
})

describe('groupByDay при переводе часов (Europe/Berlin)', () => {
  const prevTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  beforeAll(() => {
    vi.stubEnv('TZ', 'Europe/Berlin')
  })
  afterAll(() => {
    // Снятие переменной пояс не возвращает: сначала явно прежний пояс, затем прежнее значение TZ.
    vi.stubEnv('TZ', prevTz)
    vi.unstubAllEnvs()
  })

  it('сутки в 23 и 25 часов не склеиваются и не делятся', () => {
    expect(new Date(2026, 2, 29, 12).getTimezoneOffset()).toBe(-120)
    const spring = group(
      [
        row('a', at(2026, 2, 30, 0, 0)),
        row('b', at(2026, 2, 29, 23, 30)),
        row('c', at(2026, 2, 29, 3, 0)),
        row('d', at(2026, 2, 29, 0, 0)),
        row('e', at(2026, 2, 28, 23, 59)),
      ],
      at(2026, 2, 30, 10),
    )
    expect(shape(spring)).toEqual(['[Сегодня]', 'a', '[Вчера]', 'b', 'c', 'd', '[28 марта]', 'e'])

    const autumn = group(
      [row('a', at(2026, 9, 25, 23, 30)), row('b', at(2026, 9, 25, 2, 30)), row('c', at(2026, 9, 24, 23, 59))],
      at(2026, 9, 26, 0, 30),
    )
    expect(shape(autumn)).toEqual(['[Вчера]', 'a', 'b', '[24 октября]', 'c'])
  })
})
