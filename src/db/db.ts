import Dexie, { type EntityTable, type Table } from 'dexie'
import type { Category, Item, MetaRecord, StoredFile } from '@/types'

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
  }
}

export const db = new QuickDropDB()
