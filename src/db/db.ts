import Dexie, { type EntityTable, type Table } from 'dexie'
import { settleLinkMeta } from '@/lib/normalize'
import type { Category, Item, MetaRecord, StoredFile } from '@/types'

/**
 * 'pending' осмыслен, пока жива сессия, которая ждёт ответа. Если приложение закрыли или перезагрузили
 * во время запроса метаданных, при открытии базы превращаем его в итог: иначе «загрузка»
 * висела бы вечно, а «Обновить данные» оставалась бы заблокированной. Работает до того, как база
 * станет доступна остальным, — поэтому только через vip-соединение из аргумента.
 */
async function settleStaleLinkMeta(vip: Dexie): Promise<void> {
  try {
    await vip
      .table<Item, string>('items')
      .where('type')
      .equals('link')
      .filter((it) => it.linkMeta?.status === 'pending')
      .modify((it) => {
        if (it.linkMeta) it.linkMeta = settleLinkMeta(it.linkMeta)
      })
  } catch (e) {
    // Починка необязательна: открыть базу важнее.
    console.warn('QuickDrop: не удалось завершить прерванные загрузки ссылок', e)
  }
}

/**
 * Схема IndexedDB. Версии только добавляются (version(2)...), существующие не правятся.
 *
 * items:
 *   id                    — первичный ключ
 *   type, status, favorite, categoryId — фильтры
 *   *tags, *links         — multiEntry-индексы
 *   createdAt, updatedAt  — сортировка
 *   [status+createdAt]    — быстрый список «входящие по дате»
 * files: бинарники отдельно от записей; itemId — для каскадного удаления.
 */
export class QuickDropDB extends Dexie {
  items!: EntityTable<Item, 'id'>
  files!: EntityTable<StoredFile, 'id'>
  categories!: EntityTable<Category, 'id'>
  meta!: Table<MetaRecord, string>

  constructor(name = 'quickdrop') {
    super(name)
    this.version(1).stores({
      items:
        'id, type, status, favorite, categoryId, *tags, *links, createdAt, updatedAt, [status+createdAt]',
      files: 'id, itemId',
      categories: 'id, order',
      meta: 'key',
    })
    this.on('ready', (vip) => settleStaleLinkMeta(vip))
  }
}

export const db = new QuickDropDB()
