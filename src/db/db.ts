import Dexie, { type EntityTable, type Table } from 'dexie'
import { markLegacyGridUpgraded, upgradeLegacyPoint } from '@/lib/legacyGrid'
import { settleLinkMeta } from '@/lib/normalize'
import { isCaptureWindow } from '@/lib/platform'
import type { Category, Item, MetaRecord, NodePosition, SavedSearch, StoredFile } from '@/types'

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
 *   deletedAt             — корзина (v2): у записи вне корзины поля нет, в индекс она не попадает
 * files: бинарники отдельно от записей; itemId — для каскадного удаления.
 * positions (v2): сохранённые положения нод графа, id — id записи.
 * searches (v2): сохранённые поиски, order — порядок в боковой панели.
 * v3: схема не менялась, положения нод перенесены на сетку 48 (lib/legacyGrid).
 */
export class QuickDropDB extends Dexie {
  items!: EntityTable<Item, 'id'>
  files!: EntityTable<StoredFile, 'id'>
  categories!: EntityTable<Category, 'id'>
  meta!: Table<MetaRecord, string>
  positions!: EntityTable<NodePosition, 'id'>
  searches!: EntityTable<SavedSearch, 'id'>

  constructor(name = 'quickdrop') {
    super(name)
    this.version(1).stores({
      items:
        'id, type, status, favorite, categoryId, *tags, *links, createdAt, updatedAt, [status+createdAt]',
      files: 'id, itemId',
      categories: 'id, order',
      meta: 'key',
    })
    // v2: корзина (индекс deletedAt — записи без поля в индекс не попадают), положения нод графа, сохранённые поиски.
    // Преобразование данных не нужно, поэтому без upgrade().
    this.version(2).stores({
      items:
        'id, type, status, favorite, categoryId, *tags, *links, createdAt, updatedAt, [status+createdAt], deletedAt',
      positions: 'id',
      searches: 'id, order',
    })
    // v3: шаг сетки графа 32 → 48 (нода 16 → 24 px). Схема та же; сохранённые положения переносятся на новую
    // сетку, иначе ноды нового размера на старом шаге стояли бы почти вплотную.
    this.version(3)
      .stores({})
      .upgrade(async (tx) => {
        await tx
          .table<NodePosition, string>('positions')
          .toCollection()
          .modify((p) => {
            const next = upgradeLegacyPoint(p)
            p.x = next.x
            p.y = next.y
          })
        markLegacyGridUpgraded()
      })
    // Мини-окно открывает ту же базу, пока главное окно, возможно, ещё ждёт заголовок ссылки:
    // его 'pending' не прерванный, а живой — завершать его может только главное окно.
    if (!isCaptureWindow()) this.on('ready', (vip) => settleStaleLinkMeta(vip))
  }
}

export const db = new QuickDropDB()
