import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '@/db/db'
import { clearAllData, seedDemoData } from '@/db/seed'
import { getSettings, setSettings } from '@/db/settings'
import { DEFAULT_SETTINGS, ITEM_TYPES, type Item, type Settings } from '@/types'

async function reset() {
  await db.items.clear()
  await db.files.clear()
  await db.categories.clear()
  await db.meta.clear()
  await db.positions.clear()
  await db.searches.clear()
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

  it('демо-запись в корзине не воскрешается повторным засевом', async () => {
    await seedDemoData()
    const before = (await db.items.get('demo-06'))!
    // Перенос в корзину меняет только deletedAt (как repo.deleteItems): остальное совпадает с определением.
    await db.items.update('demo-06', { deletedAt: 5_000 })
    await db.positions.put({ id: 'demo-06', x: 32, y: -64 })
    const files = await db.files.count()

    expect(await seedDemoData(true)).toBe(true)

    expect(await db.items.get('demo-06')).toEqual({ ...before, deletedAt: 5_000 })
    expect(await db.items.where('deletedAt').above(0).primaryKeys()).toEqual(['demo-06'])
    // Файл записи в корзине и её место на графе остаются при ней.
    expect(await db.files.count()).toBe(files)
    expect((await db.files.get(before.fileId!))?.itemId).toBe('demo-06')
    expect(await db.positions.toArray()).toEqual([{ id: 'demo-06', x: 32, y: -64 }])
    // Связи остаются двунаправленными и с записью в корзине.
    const byId = new Map((await db.items.toArray()).map((i) => [i.id, i]))
    for (const i of byId.values()) {
      for (const l of i.links) expect(byId.get(l)?.links, `${i.id} → ${l}`).toContain(i.id)
    }
  })

  it('засев не создаёт положений и поисков, повторный — не трогает пользовательские', async () => {
    await seedDemoData()
    expect(await db.positions.count()).toBe(0)
    expect(await db.searches.count()).toBe(0)
    expect(await db.items.where('deletedAt').above(0).count()).toBe(0)

    const search = { id: 's1', name: 'Мой поиск', query: 'is:fav', order: 0, createdAt: 1 }
    await db.positions.put({ id: 'demo-01', x: 64, y: 96 })
    await db.searches.put(search)
    expect(await seedDemoData(true)).toBe(true)
    expect(await db.positions.toArray()).toEqual([{ id: 'demo-01', x: 64, y: 96 }])
    expect(await db.searches.toArray()).toEqual([search])
  })

  it('clearAllData очищает данные, но оставляет seeded', async () => {
    await seedDemoData()
    await db.items.update('demo-01', { deletedAt: 5_000 })
    await db.positions.bulkPut([
      { id: 'demo-01', x: 1, y: 2 },
      { id: 'demo-02', x: 3, y: 4 },
    ])
    await db.searches.put({ id: 's1', name: 'Поиск', query: 'tag:a', order: 0, createdAt: 1 })
    await clearAllData()
    expect(await db.items.count()).toBe(0)
    expect(await db.files.count()).toBe(0)
    expect(await db.categories.count()).toBe(0)
    expect(await db.positions.count()).toBe(0)
    expect(await db.searches.count()).toBe(0)
    expect(await seedDemoData()).toBe(false)
  })

  it('clearAllData стирает ключ API и сетевые настройки, оформление оставляет', async () => {
    await setSettings({
      aiApiKey: 'sk-secret',
      aiBaseUrl: 'https://llm.example/v1?token=t',
      aiEnabled: true,
      aiModel: 'm',
      linkProxyUrl: 'https://proxy.example/?key=k&url={url}',
      theme: 'dark',
      autoFetchLinkTitle: false,
    })
    await clearAllData()
    const s = await getSettings()
    expect(s.aiApiKey).toBe('')
    expect(s.aiBaseUrl).toBe(DEFAULT_SETTINGS.aiBaseUrl)
    expect(s.aiEnabled).toBe(false)
    expect(s.aiModel).toBe(DEFAULT_SETTINGS.aiModel)
    expect(s.linkProxyUrl).toBe('')
    expect(s.theme).toBe('dark')
    expect(s.autoFetchLinkTitle).toBe(false)
    expect(s.seeded).toBe(true)
  })

  it('clearAllData стирает секрет расширения и распознавание; остальное, включая отметку автокопии, оставляет', async () => {
    const kept = {
      scene: 'winter',
      font: 'pixel',
      ambient: false,
      trashDays: 7,
      backupDir: 'C:\Backups',
      backupEvery: 'weekly',
      backupKeep: 3,
      // Сброс отметки сделал бы автокопию «просроченной»: копия почти пустой базы пришла бы сразу
      // после первой новой записи и вытеснила бы рабочие копии.
      backupLastAt: 1_700_000_000_000,
      mdExportDir: 'D:\Vault',
      closeToTray: false,
      extPort: 50123,
      globalShortcut: 'Alt+Q',
    } satisfies Partial<Settings>
    await setSettings({
      ...kept,
      aiVisionModel: 'vision-x',
      aiAutoOcr: true,
      extEnabled: true,
      extToken: 'tok-secret',
    })
    await clearAllData()

    // В meta стёртых ключей нет вовсе (а не «лежит значение по умолчанию»).
    const keys = (await db.meta.toCollection().primaryKeys()).sort()
    expect(keys).toEqual([...Object.keys(kept), 'seeded'].sort())

    const s = await getSettings()
    expect(s).toMatchObject(kept)
    expect(s.aiVisionModel).toBe('')
    expect(s.aiAutoOcr).toBe(false)
    expect(s.extEnabled).toBe(false)
    expect(s.extToken).toBe('')
  })
})
