import { describe, expect, it } from 'vitest'
import { QuickDropDB } from './db'
import type { Item } from '@/types'

function link(id: string, over: Partial<Item> = {}): Item {
  return {
    id,
    type: 'link',
    title: '',
    content: '',
    url: `https://${id}.example`,
    categoryId: null,
    tags: [],
    links: [],
    status: 'inbox',
    favorite: 0,
    source: 'manual',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

describe('открытие базы', () => {
  it('прерванная прошлой сессией загрузка метаданных не висит вечно', async () => {
    const name = `quickdrop-open-${crypto.randomUUID()}`
    const first = new QuickDropDB(name)
    await first.items.bulkPut([
      link('a', { linkMeta: { status: 'pending' } }),
      link('b', { linkMeta: { status: 'pending', title: 'B', fetchedAt: 5 } }),
      link('c', { linkMeta: { status: 'ok', title: 'C' } }),
    ])
    first.close()

    // Новый запуск приложения.
    const next = new QuickDropDB(name)
    const byId = new Map((await next.items.toArray()).map((i) => [i.id, i]))
    expect(byId.get('a')!.linkMeta).toEqual({ status: 'failed' })
    expect(byId.get('b')!.linkMeta).toEqual({ status: 'ok', title: 'B', fetchedAt: 5 })
    expect(byId.get('c')!.linkMeta).toEqual({ status: 'ok', title: 'C' })
    // техническая починка, а не правка пользователя
    expect(byId.get('a')!.updatedAt).toBe(1)
    await next.delete()
  })
})
