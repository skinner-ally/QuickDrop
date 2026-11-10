/**
 * Доменная модель QuickDrop. Единственный источник истины для типов данных.
 * Менять только осознанно: от этих типов зависят БД, поиск, экспорт и UI.
 */

export const ITEM_TYPES = ['text', 'link', 'code', 'idea', 'file', 'image'] as const
export type ItemType = (typeof ITEM_TYPES)[number]

/**
 * Жизненный цикл записи:
 *  inbox   — входящий поток, запись ещё не разобрана;
 *  library — постоянная база знаний (запись обработана);
 *  archive — убрано с глаз, но не удалено.
 */
export const ITEM_STATUSES = ['inbox', 'library', 'archive'] as const
export type ItemStatus = (typeof ITEM_STATUSES)[number]

export type ItemSource = 'manual' | 'paste' | 'drop' | 'import' | 'demo'

/** Метаданные страницы, извлечённые по ссылке. */
export interface LinkMeta {
  title?: string
  description?: string
  siteName?: string
  /** URL картинки-превью (og:image). */
  image?: string
  /** URL favicon. */
  favicon?: string
  /** Чем закончилась попытка извлечения. */
  status: 'pending' | 'ok' | 'failed'
  fetchedAt?: number
}

/** Результат необязательной LLM-обработки (не часть MVP, поле зарезервировано). */
export interface AiMeta {
  summary?: string
  suggestedTitle?: string
  suggestedTags?: string[]
  model?: string
  generatedAt?: number
}

export interface Item {
  /** crypto.randomUUID() */
  id: string
  type: ItemType
  /** Заголовок. Может быть пустым — тогда UI показывает производный (см. lib/itemTitle). */
  title: string
  /**
   * Основное содержимое: текст заметки/идеи, исходник кода,
   * либо комментарий к ссылке/файлу/изображению.
   */
  content: string

  /** Только для type === 'link'. */
  url?: string
  linkMeta?: LinkMeta

  /** Только для type === 'code': идентификатор языка ('ts', 'python', ...). */
  language?: string

  /** Для type === 'file' | 'image': ссылка на запись в таблице files. */
  fileId?: string
  fileName?: string
  fileSize?: number
  mimeType?: string

  categoryId: string | null
  /** Имена тегов в нижнем регистре, без '#', без дубликатов. */
  tags: string[]
  /** id связанных записей. Связи двунаправленные — поддерживаются репозиторием. */
  links: string[]

  status: ItemStatus
  /** Статус до архивации — чтобы «Вернуть из архива» возвращало туда же. */
  prevStatus?: Exclude<ItemStatus, 'archive'>
  /** 0 | 1, а не boolean: IndexedDB не индексирует boolean. */
  favorite: 0 | 1

  source: ItemSource
  createdAt: number
  updatedAt: number
  /** Когда запись перенесена из inbox в library. */
  processedAt?: number

  ai?: AiMeta
}

/** Бинарное содержимое файла/изображения. Хранится отдельно, чтобы списки были лёгкими. */
export interface StoredFile {
  id: string
  itemId: string
  blob: Blob
  /** Уменьшенное превью (только для изображений), до ~480px по большей стороне. */
  thumb?: Blob
  name: string
  mimeType: string
  size: number
  createdAt: number
}

export const CATEGORY_COLORS = [
  'slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet', 'pink',
] as const
export type CategoryColor = (typeof CATEGORY_COLORS)[number]

export interface Category {
  id: string
  name: string
  color: CategoryColor
  order: number
  createdAt: number
}

/** Ключи таблицы meta (key-value настройки). */
export interface Settings {
  /** Демоданные уже были загружены (чтобы не засевать повторно). */
  seeded: boolean
  theme: 'system' | 'light' | 'dark'
  /** Автоматически подтягивать заголовок страницы по ссылке. */
  autoFetchLinkTitle: boolean
  /**
   * Необязательный CORS-прокси для веб-версии, шаблон с {url}.
   * Пусто = не использовать (по умолчанию: адреса ссылок не уходят третьим лицам).
   */
  linkProxyUrl: string
  /** Глобальная горячая клавиша (только Tauri), формат Tauri: 'CommandOrControl+Shift+Space'. */
  globalShortcut: string
  /** Необязательная LLM-интеграция (OpenAI-совместимый API: OpenAI, DeepSeek, ...). */
  aiEnabled: boolean
  aiBaseUrl: string
  aiApiKey: string
  aiModel: string
}

export const DEFAULT_SETTINGS: Settings = {
  seeded: false,
  theme: 'system',
  autoFetchLinkTitle: true,
  linkProxyUrl: '',
  globalShortcut: 'CommandOrControl+Shift+Space',
  aiEnabled: false,
  aiBaseUrl: 'https://api.deepseek.com/v1',
  aiApiKey: '',
  aiModel: 'deepseek-chat',
}

export interface MetaRecord {
  key: string
  value: unknown
}

/** Данные для создания записи: всё необязательное репозиторий заполняет сам. */
export interface NewItemInput {
  type: ItemType
  title?: string
  content?: string
  url?: string
  language?: string
  categoryId?: string | null
  tags?: string[]
  status?: ItemStatus
  favorite?: boolean
  source?: ItemSource
  /** Для file/image: сам файл; репозиторий сохранит его и сделает превью. */
  file?: File | Blob
  fileName?: string
}

/** Поля записи, которые можно править через updateItem. */
export type ItemPatch = Partial<
  Pick<Item, 'type' | 'title' | 'content' | 'url' | 'linkMeta' | 'language' | 'categoryId' | 'tags' | 'ai'>
>

/** Фильтры списков. Все поля необязательны и комбинируются по И. */
export interface ItemFilter {
  status?: ItemStatus | ItemStatus[]
  types?: ItemType[]
  /** null = «без категории». */
  categoryId?: string | null
  /** Запись должна содержать все перечисленные теги. */
  tags?: string[]
  favorite?: boolean
  /** Без тегов и без категории. */
  untagged?: boolean
  /** Диапазон по createdAt (включительно). */
  from?: number
  to?: number
}

export type SortMode = 'newest' | 'oldest' | 'updated' | 'title'
