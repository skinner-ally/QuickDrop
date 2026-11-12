import { describe, expect, it } from 'vitest'
import { graphKeyTarget } from './hotkeyGuards'

describe('graphKeyTarget', () => {
  const scene = new Map([
    ['a', 0],
    ['b', 1],
  ])

  it('запись, открытая в панели деталей, важнее курсора', () => {
    expect(graphKeyTarget('b', 'a', scene)).toBe('b')
  })

  it('панель закрыта — курсор', () => {
    expect(graphKeyTarget(null, 'a', scene)).toBe('a')
  })

  it('открытой записи нет в сцене (скрытый архив) — курсор', () => {
    expect(graphKeyTarget('hidden', 'a', scene)).toBe('a')
  })

  it('ни выбора, ни курсора в сцене — null', () => {
    expect(graphKeyTarget(null, null, scene)).toBeNull()
    expect(graphKeyTarget('x', 'y', scene)).toBeNull()
  })
})
