import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '@/db/db'
import { createItem, getItem } from '@/db/repo'
import { setSetting } from '@/db/settings'
import { DEFAULT_SETTINGS } from '@/types'
import { TRASH_CLEANUP_EVERY_MS, TRASH_CLEANUP_FIRST_MS, cleanupTrash, startTrashCleanup } from './trashCleanup'

const DAY = 86_400_000
const NOW = new Date(2026, 10, 11, 12).getTime()

/** Запись, лежащая в корзине days суток к моменту NOW. */
async function trashed(days: number): Promise<string> {
  const item = await createItem({ type: 'text', content: `в корзине ${days} дн.` })
  await db.items.update(item.id, { deletedAt: NOW - days * DAY })
  return item.id
}

const exists = async (id: string) => (await getItem(id)) !== undefined

beforeEach(async () => {
  await Promise.all([
    db.items.clear(),
    db.files.clear(),
    db.categories.clear(),
    db.meta.clear(),
    db.positions.clear(),
    db.searches.clear(),
  ])
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('cleanupTrash', () => {
  it('удаляет пролежавшее дольше срока из настроек; свежее и записи вне корзины остаются', async () => {
    expect(DEFAULT_SETTINGS.trashDays).toBe(30)
    const old = await trashed(31)
    const edge = await trashed(30)
    const fresh = await trashed(29)
    const live = await createItem({ type: 'text', content: 'не в корзине' })

    expect(await cleanupTrash(NOW)).toBe(2)
    expect(await exists(old)).toBe(false)
    expect(await exists(edge)).toBe(false)
    expect(await exists(fresh)).toBe(true)
    expect(await exists(live.id)).toBe(true)
    expect(await cleanupTrash(NOW)).toBe(0)
  })

  it('учитывает trashDays из настроек', async () => {
    await setSetting('trashDays', 7)
    const week = await trashed(8)
    const recent = await trashed(6)
    expect(await cleanupTrash(NOW)).toBe(1)
    expect(await exists(week)).toBe(false)
    expect(await exists(recent)).toBe(true)
  })

  it('trashDays = 0 — автоочистка выключена', async () => {
    await setSetting('trashDays', 0)
    const ancient = await trashed(1000)
    expect(await cleanupTrash(NOW)).toBe(0)
    expect(await exists(ancient)).toBe(true)
  })

  it('без now берёт текущее время', async () => {
    const item = await createItem({ type: 'text', content: 'x' })
    await db.items.update(item.id, { deletedAt: Date.now() - 31 * DAY })
    const recent = await createItem({ type: 'text', content: 'y' })
    await db.items.update(recent.id, { deletedAt: Date.now() - DAY })
    expect(await cleanupTrash()).toBe(1)
    expect(await exists(item.id)).toBe(false)
    expect(await exists(recent.id)).toBe(true)
  })

  it('ошибка не всплывает: 0 и предупреждение в консоли', async () => {
    const old = await trashed(40)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(db.meta, 'bulkGet').mockRejectedValueOnce(new Error('база недоступна'))
    await expect(cleanupTrash(NOW)).resolves.toBe(0)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(await exists(old)).toBe(true)

    // сбой самого удаления — так же
    vi.spyOn(db.items, 'bulkDelete').mockRejectedValueOnce(new Error('сбой удаления'))
    await expect(cleanupTrash(NOW)).resolves.toBe(0)
    expect(warn).toHaveBeenCalledTimes(2)
    expect(await exists(old)).toBe(true)
  })
})

describe('startTrashCleanup', () => {
  // Подменяются только таймеры расписания: база (fake-indexeddb на setImmediate) продолжает работать.
  const fakeSchedule = () =>
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })

  it('первый запуск через 5 с, затем каждые 6 ч; остановка снимает таймеры', async () => {
    const old = await trashed(40)
    fakeSchedule()
    vi.setSystemTime(NOW)
    // Каждый запуск начинается с чтения настроек.
    const reads = vi.spyOn(db.meta, 'bulkGet')
    const stop = startTrashCleanup()
    expect(reads).not.toHaveBeenCalled()

    vi.advanceTimersByTime(TRASH_CLEANUP_FIRST_MS - 1)
    expect(reads).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(reads).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(TRASH_CLEANUP_EVERY_MS - 1)
    expect(reads).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(reads).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(TRASH_CLEANUP_EVERY_MS)
    expect(reads).toHaveBeenCalledTimes(3)

    stop()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(TRASH_CLEANUP_EVERY_MS * 3)
    expect(reads).toHaveBeenCalledTimes(3)

    // запуск по расписанию действительно чистит корзину
    vi.useRealTimers()
    const start = Date.now()
    while (await exists(old)) {
      if (Date.now() - start > 2000) throw new Error('timeout')
      await new Promise((r) => setTimeout(r, 5))
    }
  })

  it('остановка до первого запуска отменяет и его', () => {
    fakeSchedule()
    const reads = vi.spyOn(db.meta, 'bulkGet')
    const stop = startTrashCleanup()
    stop()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(TRASH_CLEANUP_EVERY_MS)
    expect(reads).not.toHaveBeenCalled()
  })
})
