import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { clearAllData, seedDemoData } from '@/db/seed'
import { ITEM_TYPES, type Item } from '@/types'

async function reset() {
  await db.items.clear()
  await db.files.clear()
  await db.categories.clear()
  await db.meta.clear()
}

describe('seedDemoData', () => {
  beforeEach(reset)

  it('засевает ожидаемое количество записей', async () => {
    expect(await seedDemoData()).toBe(true)
    const items = await db.items.toArray()
    expect(items.length).toBeGreaterThanOrEqual(28)
    expect(items.length).toBeLessThanOrEqual(34)
    const by = (s: string) => items.filter((i) => i.status === s)
    expect(by('inbox').length).toBe(10)
    expect(by('library').length).toBe(16)
    expect(by('archive').length).toBe(4)
    for (const t of ITEM_TYPES) expect(items.some((i) => i.type === t)).toBe(true)
    expect(await db.categories.count()).toBe(5)
    expect((await db.meta.get('seeded'))?.value).toBe(true)
    expect(items.every((i) => i.source === 'demo')).toBe(true)
  })

  it('соблюдает инварианты', async () => {
    await seedDemoData()
    const items = await db.items.toArray()
    const byId = new Map(items.map((i) => [i.id, i]))
    const catIds = new Set((await db.categories.toArray()).map((c) => c.id))
    const files = new Map((await db.files.toArray()).map((f) => [f.id, f]))
    for (const i of items) {
      expect(i.tags).toEqual([...new Set(i.tags.map((t) => t.toLowerCase()))])
      expect([0, 1]).toContain(i.favorite)
      if (i.categoryId) expect(catIds.has(i.categoryId)).toBe(true)
      for (const l of i.links) {
        expect(l).not.toBe(i.id)
        expect(byId.get(l)?.links).toContain(i.id)
      }
      if (i.type === 'file' || i.type === 'image') {
        const f = files.get(i.fileId!)
        expect(f?.itemId).toBe(i.id)
        expect(f?.size).toBe(i.fileSize)
      }
      if (i.status === 'archive') expect(i.prevStatus).toBeDefined()
      if (i.status === 'library') expect(i.processedAt).toBeDefined()
      if (i.linkMeta) expect(i.linkMeta.status).not.toBe('pending')
    }
    const fav = items.filter((i: Item) => i.favorite === 1).length
    expect(fav).toBeGreaterThanOrEqual(5)
    expect(files.size).toBe(7)
  })

  it('повторный вызов возвращает false, force не плодит дубли и не трогает пользовательские', async () => {
    await seedDemoData()
    expect(await seedDemoData()).toBe(false)
    await db.items.add({
      id: 'user-1', type: 'text', title: 'моя', content: '', categoryId: null, tags: [], links: ['demo-01'],
      status: 'inbox', favorite: 0, source: 'manual', createdAt: 1, updatedAt: 1,
    })
    const n = await db.items.count()
    const fn = await db.files.count()
    expect(await seedDemoData(true)).toBe(true)
    expect(await db.items.count()).toBe(n)
    expect(await db.files.count()).toBe(fn)
    expect(await db.items.get('user-1')).toBeDefined()
    // Связь пользователя с демо-записью сохраняется и становится двунаправленной.
    expect((await db.items.get('user-1'))!.links).toEqual(['demo-01'])
    expect((await db.items.get('demo-01'))!.links).toContain('user-1')
  })

  it('архивные записи из базы знаний имеют processedAt', async () => {
    await seedDemoData()
    const archived = (await db.items.toArray()).filter((i) => i.status === 'archive' && i.prevStatus === 'library')
    expect(archived.length).toBeGreaterThan(0)
    for (const i of archived) expect(i.processedAt).toBeDefined()
  })

  it('force не стирает правки пользователя в демо-записях и категориях', async () => {
    await seedDemoData()
    await db.items.update('demo-04', { title: 'Моя правка', status: 'library', updatedAt: Date.now() })
    await db.items.update('demo-02', { title: 'тоже правка' })
    await db.categories.update('demo-cat-work', { name: 'Офис', color: 'red', order: 7 })
    await db.categories.add({ id: 'user-cat', name: 'Моя', color: 'slate', order: 1, createdAt: 1 })
    await db.items.delete('demo-03')

    expect(await seedDemoData(true)).toBe(true)
    expect((await db.items.get('demo-04'))!.title).toBe('Моя правка')
    expect((await db.items.get('demo-04'))!.status).toBe('library')
    expect((await db.items.get('demo-02'))!.title).toBe('тоже правка')
    // Удалённая демо-запись возвращается.
    expect(await db.items.get('demo-03')).toBeDefined()

    const cats = await db.categories.toArray()
    const work = cats.find((c) => c.id === 'demo-cat-work')!
    expect(work).toMatchObject({ name: 'Офис', color: 'red', order: 7 })
    expect(cats.find((c) => c.id === 'user-cat')!.order).toBe(1)
    expect(cats).toHaveLength(6)
  })

  it('демо-категория не дублирует пользовательскую с тем же именем', async () => {
    await db.categories.add({ id: 'mine', name: 'работа', color: 'slate', order: 0, createdAt: 1 })
    await seedDemoData()
    const cats = await db.categories.toArray()
    expect(cats.filter((c) => c.name.toLowerCase() === 'работа')).toHaveLength(1)
    expect(cats.every((c, _, all) => all.filter((x) => x.order === c.order).length === 1)).toBe(true)
    const work = (await db.items.toArray()).filter((i) => i.categoryId === 'mine')
    expect(work.length).toBeGreaterThan(0)
  })

  it('clearAllData очищает данные, но оставляет seeded', async () => {
    await seedDemoData()
    await clearAllData()
    expect(await db.items.count()).toBe(0)
    expect(await db.files.count()).toBe(0)
    expect(await db.categories.count()).toBe(0)
    expect(await seedDemoData()).toBe(false)
  })
})
