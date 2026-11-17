import { describe, expect, it } from 'vitest'
import { sanitizeItem } from '@/lib/exportImport'
import { ideaStatusOf } from '@/types'
import type { Item, ItemFilter } from '@/types'
import { composeQuery, matchesFilter, parseQuery, searchItems, serializeFilter } from './index'

let seq = 0
function makeItem(patch: Partial<Item> = {}): Item {
  seq++
  return {
    id: `idea-${seq}`,
    type: 'idea',
    title: `Идея ${seq}`,
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

describe('статус идеи', () => {
  it('ideaStatusOf: у идеи без поля — «new», у других типов нет статуса', () => {
    expect(ideaStatusOf(makeItem())).toBe('new')
    expect(ideaStatusOf(makeItem({ ideaStatus: 'done' }))).toBe('done')
    expect(ideaStatusOf(makeItem({ type: 'text', ideaStatus: 'done' }))).toBeUndefined()
  })

  it('matchesFilter: любой из статусов; новая = без поля; не идеи не проходят', () => {
    const fresh = makeItem()
    const active = makeItem({ ideaStatus: 'active' })
    const note = makeItem({ type: 'text', ideaStatus: 'active' })
    const f = (ideaStatuses: ItemFilter['ideaStatuses']): ItemFilter => ({ ideaStatuses })

    expect(matchesFilter(fresh, f(['new']))).toBe(true)
    expect(matchesFilter(active, f(['new']))).toBe(false)
    expect(matchesFilter(active, f(['new', 'active']))).toBe(true)
    expect(matchesFilter(note, f(['active']))).toBe(false)
    // Пустой массив — без ограничения, как у types.
    expect(matchesFilter(note, f([]))).toBe(true)
  })

  it('parseQuery: idea: с русскими и английскими значениями, списком через запятую', () => {
    expect(parseQuery('idea:active').filter).toEqual({ ideaStatuses: ['active'] })
    expect(parseQuery('идея:сделана').filter).toEqual({ ideaStatuses: ['done'] })
    expect(parseQuery('idea:new,later').filter).toEqual({ ideaStatuses: ['new', 'later'] })
    expect(parseQuery('idea:"в работе"').filter).toEqual({ ideaStatuses: ['active'] })
  })

  it('parseQuery: неизвестное значение остаётся обычным текстом', () => {
    const q = parseQuery('idea:ничего')
    expect(q.filter).toEqual({})
    expect(q.text).toBe('idea:ничего')
  })

  it('serializeFilter обратен parseQuery', () => {
    const filter: ItemFilter = { types: ['idea'], ideaStatuses: ['active', 'later'] }
    const text = serializeFilter(filter, [])
    expect(text).toBe('type:idea idea:active,later')
    expect(parseQuery(text).filter).toEqual(filter)
  })

  it('searchItems: idea:done находит только сделанные идеи', () => {
    const done = makeItem({ ideaStatus: 'done', title: 'Готовая' })
    const fresh = makeItem({ title: 'Свежая' })
    const note = makeItem({ type: 'text', ideaStatus: 'done', title: 'Заметка' })
    const hits = searchItems([done, fresh, note], 'idea:done')
    expect(hits.map((h) => h.item.id)).toEqual([done.id])
  })

  it('sanitizeItem: допустимый статус сохраняется, «new» и мусор отбрасываются', () => {
    const raw = { ...makeItem(), ideaStatus: 'active' }
    expect(sanitizeItem(raw)!.ideaStatus).toBe('active')
    expect(sanitizeItem({ ...raw, ideaStatus: 'new' })!.ideaStatus).toBeUndefined()
    expect(sanitizeItem({ ...raw, ideaStatus: 'что-то' })!.ideaStatus).toBeUndefined()
    expect(sanitizeItem({ ...raw, ideaStatus: 5 })!.ideaStatus).toBeUndefined()
  })

  it('composeQuery: статусы панели и idea: строки пересекаются, как на экране', () => {
    const filter: ItemFilter = { types: ['idea'], ideaStatuses: ['done', 'active'] }
    // Общий статус — одно пересечение, оператор из строки убирается.
    expect(composeQuery('idea:active план', filter, [])).toBe('type:idea idea:active план')
    // Пересечения нет (на экране пусто) — как у типов, побеждает строка поиска.
    const q = composeQuery('idea:later', { types: ['idea'], ideaStatuses: ['done'] }, [])
    expect(parseQuery(q).filter.ideaStatuses).toEqual(['later'])
    // Без idea: в строке статусы панели пишутся как есть.
    expect(composeQuery('план', filter, [])).toBe('type:idea idea:done,active план')
  })
})
