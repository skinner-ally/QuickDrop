import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { QuickDropDB } from './db'
import { takeLegacyGridUpgraded } from '@/lib/legacyGrid'
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

  it('база версии 2: положения нод переносятся на сетку 48, остальное не меняется', async () => {
    const name = `quickdrop-v2-${crypto.randomUUID()}`
    const v2 = new Dexie(name)
    // Схема — как в version(1) + version(2) класса QuickDropDB.
    v2.version(1).stores({
      items: 'id, type, status, favorite, categoryId, *tags, *links, createdAt, updatedAt, [status+createdAt]',
      files: 'id, itemId',
      categories: 'id, order',
      meta: 'key',
    })
    v2.version(2).stores({
      items:
        'id, type, status, favorite, categoryId, *tags, *links, createdAt, updatedAt, [status+createdAt], deletedAt',
      positions: 'id',
      searches: 'id, order',
    })
    const items = [link('a', { links: ['b'] }), link('b', { links: ['a'], deletedAt: 7 })]
    await v2.table('items').bulkPut(items)
    await v2.table('positions').bulkPut([
      { id: 'a', x: 64, y: -32 },
      { id: 'b', x: 0, y: 96 },
      // не на сетке (перетащено до привязки) и у самого предела координат
      { id: 'c', x: 17, y: -999_999 },
    ])
    v2.close()

    const next = new QuickDropDB(name)
    await next.open()
    expect(next.verno).toBe(3)
    // камеру графа после переноса один раз вписывают заново
    expect(takeLegacyGridUpgraded()).toBe(true)
    expect(takeLegacyGridUpgraded()).toBe(false)
    expect(await next.positions.orderBy('id').toArray()).toEqual([
      { id: 'a', x: 96, y: -48 },
      { id: 'b', x: 0, y: 144 },
      { id: 'c', x: 26, y: -1_000_000 },
    ])
    expect(await next.items.orderBy('id').toArray()).toEqual(items)
    await next.delete()
  })

  it('база версии 1 открывается как нынешняя без потери данных', async () => {
    const name = `quickdrop-v1-${crypto.randomUUID()}`
    const items = [
      link('a', { tags: ['x'], links: ['b'], status: 'library', favorite: 1, createdAt: 10, updatedAt: 20 }),
      link('b', { links: ['a'], linkMeta: { status: 'ok', title: 'B' } }),
    ]

    // Схема — как в version(1) класса QuickDropDB.
    const v1 = new Dexie(name)
    v1.version(1).stores({
      items:
        'id, type, status, favorite, categoryId, *tags, *links, createdAt, updatedAt, [status+createdAt]',
      files: 'id, itemId',
      categories: 'id, order',
      meta: 'key',
    })
    await v1.table('items').bulkPut(items)
    await v1.table('meta').put({ key: 'theme', value: 'dark' })
    expect(v1.verno).toBe(1)
    v1.close()

    const next = new QuickDropDB(name)
    await next.open()
    expect(next.verno).toBe(3)
    expect(await next.items.orderBy('id').toArray()).toEqual(items)
    expect(await next.meta.get('theme')).toEqual({ key: 'theme', value: 'dark' })
    expect(await next.files.count()).toBe(0)
    expect(await next.categories.count()).toBe(0)
    expect(await next.positions.toArray()).toEqual([])
    expect(await next.searches.toArray()).toEqual([])

    // Записи без deletedAt в индекс не попадают: корзина пуста, пока поле не появится.
    expect(await next.items.where('deletedAt').above(0).count()).toBe(0)
    await next.items.update('a', { deletedAt: 5 })
    expect(await next.items.where('deletedAt').above(0).count()).toBe(1)
    expect(await next.items.where('deletedAt').above(0).primaryKeys()).toEqual(['a'])

    await next.delete()
  })
})
