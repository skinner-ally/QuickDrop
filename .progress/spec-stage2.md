# Спецификация этапа 2: данные и логика без интерфейса

Статус: готово к исполнению. Дата: 2026-11-11. Автор: агент `spec-data`.
Основание: `.progress/plan-combined.md` (этап 2 + данные этапов 4, 5, 8), решения основной сессии.
Контракты из `CLAUDE.md` не меняются — только добавления. Раздел «Дизайн» сюда не относится.

Содержание: 0. Решения · 1. Шаг контрактов (готовый код) · 2. Контракты модулей · 3. Тесты ·
4. Исполнители и владение файлами · 5. Влияние на UI (для этапов 3–5, 8) · 6. Точки интеграции и вопросы.

---

## 0. Принятые решения (коротко, с обоснованием)

| № | Решение | Почему |
|---|---|---|
| Р1 | Корзина — поле `Item.deletedAt`. Перенос в корзину и восстановление **не меняют `updatedAt`**, `status`, `prevStatus`, `links`, файл, положение на графе | «Отменить» возвращает запись байт-в-байт; индекс поиска не переиндексируется; слияние копий не искажается |
| Р2 | `ItemFilter.trashed`: `true` — только корзина, иначе — только вне корзины. Третьего состояния нет; «не смотреть на корзину» — отдельная функция `matchesFilterIgnoringTrash` | Сигнатура `matchesFilter` не меняется, а поведение по умолчанию прячет корзину везде, где уже стоит `matchesFilter` |
| Р3 | Общий источник записей в `useItems.ts` по-прежнему читает **всю** таблицу один раз; `useAllItems()` отдаёт срез без корзины, `useTrashedItems()` — корзину, `useItemsWithTrash()` — всё. Срезы кэшируются по снимку (стабильные ссылки) | Одно чтение таблицы на мутацию сохраняется; существующие потребители `useAllItems` получают «без корзины» без правок |
| Р4 | В поиск (`searchItems`) всегда можно передавать любой набор: корзину отсекает фильтр. `computeVisible` передаёт полный набор и `trash: 'any'` (сам уже отобрал) | Индекс не перестраивается при входе в «Корзину» |
| Р5 | Оператор `is:trash` существует (у каждого поля `ItemFilter` есть оператор); он же снимает статус раздела | Нужен для полноты `serializeFilter`; позволяет искать в корзине из любого раздела |
| Р6 | Добавлено поле `Item.ocrAt?: number` (сверх решения основной сессии) | `setOcrText` не меняет `updatedAt`, а индекс поиска сверяется по `updatedAt` — нужен дешёвый признак изменения; заодно отличает «не пробовали» от «пробовали, текста нет» (автораспознавание не повторяется) |
| Р7 | Положения нод: **сохраняется всё, что разложено** (и автораскладка, и перетаскивание). `computeLayout` размещает только ноды без сохранённого места; сохранённые — неизменны и заняты, включая места скрытых записей (архив, корзина). «Разложить» = `clearPositions()` + полный пересчёт | Если хранить только перетащенные, любое добавление/перетаскивание сдвигает соседей (последовательное заполнение зоны) — пространственная память ломается. Запись из корзины возвращается на своё место без доп. кода |
| Р8 | Смена категории записи (`setCategory`, `updateItem({categoryId})`, `deleteCategory`) **удаляет её сохранённое положение** → раскладка ставит ноду в зону новой категории | Перетащить на «грядку» больше нельзя; смена категории — единственный способ перевести ноду в другую цветовую зону |
| Р9 | Дубль ссылки ищется **без записей в корзине**, архив учитывается; `http`/`https` и `www.` не различаются | Корзина «скрыта отовсюду»; «Открыть» запись из корзины сбивало бы с толку |
| Р10 | `date:week`/`month`/`year` — скользящие 7/30/365 календарных дней, включая сегодня; `after:`/`before:` включают указанный день | «За неделю» в быстрых вариантах FilterBar; календарный месяц задаётся явно `date:2026-11` |
| Р11 | Экспорт Markdown — плоская папка: `<Имя>.md` в корне, вложения в `attachments/` | Вики-ссылки `[[Имя]]` разрешаются по имени файла без путей (Obsidian) |
| Р12 | `ItemSource` получает `'extension'` сейчас (этап 7) | `types.ts` правится один раз; цена — одна строка в `ItemDetail.tsx` (см. 1.8) |
| Р13 | Состояние графа — отдельный стор `src/store/graph.ts` (zustand), камера дублируется в `localStorage` (`qd-graph-camera`), в БД не пишется | Переживает смену раздела и перезапуск; не трогает liveQuery |
| Р14 | Локальные пути, токен расширения и всё, что включает сетевые запросы, — в `PRIVATE_SETTINGS` (не экспортируется и не импортируется) | Чужая копия не должна перенаправить автобэкап в произвольную папку или включить отправку картинок в ИИ |

---

## 1. Шаг контрактов (выполняется ПЕРВЫМ, одним агентом `data-contracts`, до распараллеливания)

**(уточнено при сверке)** Это общий первый шаг и для этапа 1: `src/types.ts` и `src/db/settings.ts` правит только
`data-contracts` (включая `scene` / `font` / `ambient` и проверку их значений). Исполнитель `theme-core` этапа 1
(`.progress/spec-stage1.md` §7.1) эти файлы не трогает и стартует после приёмки шага; `icons` этапа 1 от шага не
зависит. После шага параллельно идут: волна 1 этого этапа, `tauri-backup` (`.progress/spec-tauri.md` §1.11),
`theme-core` и `icons` — их файлы не пересекаются.

Файлы шага: `src/types.ts`, `src/db/db.ts`, `src/db/db.test.ts`, `src/db/settings.ts`, `src/lib/settingsSchema.ts` (новый),
`src/lib/settingsSchema.test.ts` (новый), `src/lib/filter.ts`, `src/lib/normalize.ts`, `src/lib/normalize.test.ts` (новый),
`src/store/ui.ts`, `src/components/items/ItemDetail.tsx` (одна строка, 1.8). Заглушки экспортов не нужны: после шага `npm run typecheck`
и `npm test` проходят без изменений в остальном коде (проверено по текущим местам использования: литералов `Settings`
нет, `ai.test.ts` строит настройки через `...DEFAULT_SETTINGS`, `switch (view)` в `AppShell` не исчерпывающий).

### 1.1 `src/types.ts`

Заменить объявление `ItemSource`:

```ts
export const ITEM_SOURCES = ['manual', 'paste', 'drop', 'import', 'demo', 'extension'] as const
export type ItemSource = (typeof ITEM_SOURCES)[number]
```

В `interface Item` после `ai?: AiMeta` добавить:

```ts
  /**
   * Текст, извлечённый из вложения (PDF с текстовым слоем, распознанная картинка). Участвует в поиске.
   * Не входит в ItemPatch: пишет только repo.setOcrText, updatedAt при этом не меняется.
   */
  ocrText?: string
  /** Когда текст извлекался в последний раз, в т.ч. безрезультатно (ocrAt есть, ocrText нет). */
  ocrAt?: number
  /** С какого момента запись в корзине. Поля нет — запись не в корзине. status, prevStatus и links не меняются. */
  deletedAt?: number
```

`ItemPatch` и `NewItemInput` не менять.

После `StoredFile` добавить:

```ts
/** Точка в мировых координатах графа: центр ноды, px при масштабе 100 %. */
export interface GraphPoint {
  x: number
  y: number
}

/** Сохранённое положение ноды графа. id — id записи. */
export interface NodePosition extends GraphPoint {
  id: string
}

/** Сохранённый поиск: строка запроса с операторами (см. search.serializeFilter). */
export interface SavedSearch {
  id: string
  name: string
  query: string
  order: number
  createdAt: number
}

export const SAVED_SEARCH_NAME_MAX = 60
export const SAVED_SEARCH_QUERY_MAX = 2000
```

Перед `interface Settings` добавить:

```ts
export const THEMES = ['system', 'light', 'dark'] as const
// (уточнено при сверке) имена сведены с .progress/spec-stage1.md: ScenePref / FontPref, SCENE_PREFS / FONT_PREFS
// (было SceneSetting / FontSetting, SCENES / FONTS). lib/scene.ts этапа 1 списки только реэкспортирует.
export const SCENE_PREFS = ['auto', 'meadow', 'autumn', 'paper', 'winter', 'classic'] as const
export type ScenePref = (typeof SCENE_PREFS)[number]
export const FONT_PREFS = ['round', 'plain', 'soft', 'pixel'] as const
export type FontPref = (typeof FONT_PREFS)[number]
export const BACKUP_PERIODS = ['off', 'daily', 'weekly'] as const
export type BackupPeriod = (typeof BACKUP_PERIODS)[number]
```

В `interface Settings` добавить (после `aiModel`):

```ts
  /** Сцена оформления. 'auto' — по календарю (дек–фев winter, сен–ноя autumn, иначе meadow). */
  scene: ScenePref
  /** Шрифт текста; действует только в пиксельных сценах. */
  font: FontPref
  /** Живой фон графа. */
  ambient: boolean

  /** Через сколько дней запись в корзине удаляется окончательно. 0 — не очищать автоматически. */
  trashDays: number

  /** Папка автоматических резервных копий (только Tauri). Пусто — не выбрана. */
  backupDir: string
  backupEvery: BackupPeriod
  /** Сколько последних автоматических копий хранить. */
  backupKeep: number
  /** Когда сделана последняя автоматическая копия (мс), 0 — ни разу. */
  backupLastAt: number
  /** Папка экспорта в Markdown (только Tauri). Пусто — не выбрана. */
  mdExportDir: string

  /** Распознавать текст на новых картинках и сканах автоматически (нужен включённый ИИ). */
  aiAutoOcr: boolean
  /** Модель со зрением для распознавания. Пусто — использовать aiModel. */
  aiVisionModel: string

  /** Этап 7 (Tauri). Закрытие окна сворачивает в трей, а не завершает приложение. */
  closeToTray: boolean
  /** Приём записей от расширения браузера (локальный сервер на 127.0.0.1). */
  extEnabled: boolean
  extPort: number
  /** Секрет для расширения браузера; создаётся при первом включении. */
  extToken: string
```

В `DEFAULT_SETTINGS` добавить:

```ts
  scene: 'auto',
  font: 'round',
  ambient: true,
  trashDays: 30,
  backupDir: '',
  backupEvery: 'off',
  backupKeep: 10,
  backupLastAt: 0,
  mdExportDir: '',
  aiAutoOcr: false,
  aiVisionModel: '',
  closeToTray: true,
  extEnabled: false,
  extPort: 47821,
  extToken: '',
```

`Settings['theme']` оставить как есть (`'system' | 'light' | 'dark'`); `THEMES` — только список для проверки.
Четыре последних поля (этап 7) и пять полей копий/экспорта взяты из `.progress/spec-tauri.md` (п. 1.9, 2.9) буквально;
автозапуск в `Settings` не хранится (состояние читается из системы).

В `interface ItemFilter` добавить:

```ts
  /** Корзина: true — только записи в корзине; false или не задано — только записи вне корзины. */
  trashed?: boolean
```

### 1.2 `src/db/db.ts`

Импорт типов: добавить `NodePosition`, `SavedSearch`. В классе:

```ts
  positions!: EntityTable<NodePosition, 'id'>
  searches!: EntityTable<SavedSearch, 'id'>
```

В конструкторе после `version(1)` (её не трогать):

```ts
    // v2: корзина (индекс deletedAt — записи без поля в индекс не попадают), положения нод графа, сохранённые поиски.
    // Преобразование данных не нужно, поэтому без upgrade().
    this.version(2).stores({
      items:
        'id, type, status, favorite, categoryId, *tags, *links, createdAt, updatedAt, [status+createdAt], deletedAt',
      positions: 'id',
      searches: 'id, order',
    })
```

Комментарий над классом дополнить строками про `deletedAt`, `positions`, `searches`. `files`, `categories`, `meta` в v2
не перечислять (Dexie переносит их из v1).

### 1.3 `src/lib/filter.ts` (целиком новое тело)

```ts
/** Все условия фильтра, кроме корзины (для кода, который корзину уже отобрал сам). */
export function matchesFilterIgnoringTrash(item: Item, filter: ItemFilter): boolean {
  /* прежнее тело matchesFilter без изменений */
}

export function matchesFilter(item: Item, filter: ItemFilter): boolean {
  // Корзина скрыта отовсюду, пока фильтр явно не просит её.
  if ((item.deletedAt !== undefined) !== (filter.trashed === true)) return false
  return matchesFilterIgnoringTrash(item, filter)
}
```

В doc-комментарий добавить строку «`trashed`: true — только корзина, иначе — только вне корзины».

### 1.4 `src/lib/normalize.ts` (добавить в конец)

```ts
// ───────────────────────── распознанный текст, граф, сохранённые поиски ─────────────────────────

/** Предел распознанного текста одной записи, символов. */
export const MAX_OCR_TEXT = 200_000

/** \r\n → \n, без управляющих символов (кроме \n и \t), 3+ пустых строк → 2, trim, обрезка до MAX_OCR_TEXT. */
export function cleanOcrText(raw: string): string

/** Предел координаты ноды графа, px. */
export const MAX_GRAPH_COORD = 1_000_000

/** Точка графа из произвольного значения: конечные числа, округление до целого, |v| ≤ MAX_GRAPH_COORD; иначе null. */
export function sanitizePoint(raw: unknown): GraphPoint | null

/** Ключ уникальности имени сохранённого поиска: foldText, пробелы схлопнуты, trim. */
export function searchNameKey(name: string): string
```

(`import type { GraphPoint, LinkMeta } from '@/types'`.) Тесты этих трёх функций — новый файл
`src/lib/normalize.test.ts` (входит в шаг).

### 1.5 `src/lib/settingsSchema.ts` (новый) и `src/db/settings.ts`

```ts
import { BACKUP_PERIODS, DEFAULT_SETTINGS, FONT_PREFS, SCENE_PREFS, THEMES, type Settings } from '@/types'

/**
 * Годится ли значение для настройки key: тип как у значения по умолчанию плюс правила поля.
 * Единая проверка для чтения из meta (mergeSettings) и импорта (sanitizeSettings).
 */
export function isValidSetting<K extends keyof Settings>(key: K, value: unknown): value is Settings[K]
```

Правила: `typeof value === typeof DEFAULT_SETTINGS[key]`; дополнительно: `theme ∈ THEMES`, `scene ∈ SCENE_PREFS`, `font ∈ FONT_PREFS`,
`backupEvery ∈ BACKUP_PERIODS`; `trashDays` — целое 0…3650; `backupKeep` — целое 1…100; `backupLastAt` — конечное ≥ 0;
`extPort` — целое 1024…65535; строки — длина ≤ 4096. Неизвестный ключ → `false`.

`src/db/settings.ts`: в `mergeSettings` заменить проверку `typeof value !== typeof DEFAULT_SETTINGS[key]` на
`!isValidSetting(key, value)`. Больше ничего не менять.

### 1.6 `src/store/ui.ts`

```ts
export type View = 'inbox' | 'library' | 'favorites' | 'archive' | 'graph' | 'trash' | 'settings'

/** Фильтры интерфейса: статус, избранное и корзину задаёт раздел. */
export type UiFilter = Omit<ItemFilter, 'status' | 'favorite' | 'trashed'>
```

`UiState.filter: UiFilter`; `setFilter: (patch: Partial<UiFilter>) => void`. Добавить действие:

```ts
  /** Применить запрос целиком (сохранённый поиск): строка поиска заменяется, фильтры и выбор сбрасываются. */
  applyQuery: (query: string, view?: View) => void
  // реализация: set((s) => ({ query, filter: {}, selectedId: null, navOpen: false, view: view ?? s.view }))
```

### 1.7 `src/db/db.test.ts` — новый тест

«база версии 1 открывается как версия 2 без потери данных»: создать базу «сырой» `Dexie` со схемой v1 (строки схемы
скопировать из `version(1)`), положить 2 записи, закрыть; открыть `new QuickDropDB(name)`; проверить: записи на месте и
равны исходным; `positions` и `searches` существуют и пусты; `items.where('deletedAt').above(0).count() === 0`;
после `items.update(id, { deletedAt: 5 })` тот же запрос даёт 1.

### 1.8 Единственная правка в `src/components` на этапе 2

`src/components/items/ItemDetail.tsx`, объект `SOURCE_LABEL: Record<ItemSource, string>` — добавить
`extension: 'Из браузера'` (иначе typecheck не пройдёт). Других правок в `src/components`, `src/views`, `public`,
`src-tauri` этап 2 не делает.

### 1.9 Критерии готовности шага

`npm run typecheck` и `npm test` зелёные; число тестов выросло только на новые (db, settingsSchema, normalize);
существующие тесты не правились.

---

## 2. Контракты новых и изменённых экспортов

Условные обозначения: **нов.** — новый экспорт, **изм.** — меняется поведение при прежней сигнатуре.

### 2.1 `src/db/repo.ts`

#### Корзина

```ts
deleteItem(id: string): Promise<DeletedSnapshot>                 // изм.
deleteItems(ids: string[]): Promise<DeletedSnapshot[]>           // изм.
restoreItem(snapshot: DeletedSnapshot): Promise<void>            // изм.
restoreItems(snapshots: DeletedSnapshot[]): Promise<void>        // изм.
restoreFromTrash(ids: string | string[]): Promise<void>          // нов.
purgeItems(ids: string | string[]): Promise<number>              // нов.
emptyTrash(): Promise<number>                                    // нов.
purgeExpired(days: number, now?: number): Promise<number>        // нов.
```

- `deleteItems` — одна транзакция `rw` по `items`, чтение `files`. Берёт существующие записи **без** `deletedAt`
  (несуществующие и уже лежащие в корзине пропускаются). Снимок строится как раньше и ДО правки: `item` — запись без
  `deletedAt`, `file` — запись файла (как раньше, нужна для восстановления после окончательного удаления),
  `linkedIds` — `item.links ∪ обратные ссылки`. Затем каждой записи ставится `deletedAt = now` (одно `now` на пакет).
  Больше ничего не меняется: ни `updatedAt`, ни `links` (ни свои, ни у соседей), ни файлы, ни `positions`.
- `deleteItem` — `deleteItems([id])[0]`; бросает `Error('Запись не найдена')`, если записи нет,
  `Error('Запись уже в корзине')`, если она в корзине.
- `restoreItems` — одна транзакция `rw` по `items`, `files`, `categories`. Для каждого снимка:
  1. запись **есть в БД**: если у неё есть `deletedAt` — снять (`update(id, { deletedAt: undefined })`) и завершить
     зависший `linkMeta.status === 'pending'` через `settleLinkMeta`; остальные поля записи не трогать (в БД — истина).
     Записи без `deletedAt` не трогать вовсе;
  2. записи **нет** (успели удалить окончательно): воссоздать по прежнему алгоритму (исходные даты, без `deletedAt`,
     категория → `null`, если её уже нет, файл из снимка, связи — только с существующими записями, в обе стороны,
     `updatedAt` соседей не менять). Положение на графе не восстанавливается.
  Ошибки — через `readableError`, как сейчас.
- `restoreFromTrash(ids)` — пункт 1 для перечисленных id; несуществующие и не лежащие в корзине пропускаются.
- `purgeItems(ids)` — окончательное удаление **любых** существующих записей (в корзине или нет), одна транзакция `rw`
  по `items`, `files`, `positions`: прежний каскад `deleteItems` (файлы по `itemId` и `fileId`; у оставшихся записей
  из `links` убираются удалённые id без смены `updatedAt`) + `positions.bulkDelete(ids)`. Возвращает число удалённых записей.
- `emptyTrash()` — `purgeItems` для всех записей с `deletedAt` (`items.where('deletedAt').above(0).primaryKeys()`).
- `purgeExpired(days, now = Date.now())` — если `days` не конечное или `≤ 0` → `0`, ничего не делает. Иначе
  `purgeItems` для записей с `deletedAt ≤ now − days·86 400 000` (граница включительно).
- `getItem(id)` по-прежнему отдаёт запись и из корзины (нужно разделу «Корзина» и восстановлению).
- `linkItems(a, b)` — **изм.**: дополнительно ничего не делает, если любая из двух записей в корзине. `unlinkItems` — без изменений.
- Остальные мутации (`updateItem`, `setStatus`, теги, категории) записи в корзине не отличают: UI их для корзины
  не предлагает, а переименование/удаление тега и удаление категории обязаны затрагивать и корзину (иначе после
  восстановления вернётся старый тег).

#### Положения нод

```ts
setPositions(map: Record<string, GraphPoint>): Promise<void>     // нов.
getPositions(): Promise<Record<string, GraphPoint>>              // нов.
removePositions(ids: string | string[]): Promise<void>           // нов.
clearPositions(): Promise<Record<string, GraphPoint>>            // нов. — возвращает прежние (для «Отменить»)
```

- `setPositions` — транзакция `rw` по `positions` + чтение ключей `items`. Значения проходят `sanitizePoint`
  (негодные пропускаются); id, которых нет в `items`, пропускаются; запись через `bulkPut`. `items` не изменяется —
  `updatedAt` не трогается, список записей не перечитывается.
- `getPositions` — объект через `Object.fromEntries` (ключ `__proto__` безопасен).
- Положение удаляется автоматически (в той же транзакции, добавить `db.positions` в её область):
  `setCategory` — у записей, чья категория реально сменилась; `updateItem` — когда в патче есть `categoryId`, отличный
  от текущего (читать текущую запись в транзакции); `deleteCategory` — у всех записей удаляемой категории;
  `purgeItems` — у удалённых. Перенос в корзину и архив положение **сохраняют**.

#### Сохранённые поиски

```ts
listSavedSearches(): Promise<SavedSearch[]>                                              // по order
createSavedSearch(name: string, query: string): Promise<SavedSearch>
updateSavedSearch(id: string, patch: Partial<Pick<SavedSearch, 'name' | 'query'>>): Promise<void>
deleteSavedSearch(id: string): Promise<void>
reorderSavedSearches(ids: string[]): Promise<void>
restoreSavedSearch(search: SavedSearch): Promise<void>                                    // для «Отменить»
```

- Имя и запрос — `trim()`. Ошибки (`Error`, русский текст, UI показывает toast): пустое имя — «Название не может
  быть пустым»; пустой запрос — «Запрос пуст — сохранять нечего»; имя длиннее `SAVED_SEARCH_NAME_MAX` или запрос длиннее
  `SAVED_SEARCH_QUERY_MAX` — «Слишком длинное название» / «Слишком длинный запрос»; имя совпадает по `searchNameKey`
  с другим поиском — «Поиск «…» уже есть».
- `createSavedSearch`: `id = newId()`, `order = max(order) + 1`, `createdAt = now`.
- `updateSavedSearch`: `undefined` в патче — «не менять»; несуществующий id — ничего.
- `reorderSavedSearches(ids)`: перечисленные получают `order = индекс`; не перечисленные встают после них в прежнем
  относительном порядке; неизвестные id игнорируются.
- `restoreSavedSearch`: `put` как есть; при занятом имени к имени дописывается ` (2)`, ` (3)`…

#### Распознанный текст и дубли

```ts
setOcrText(id: string, text: string, at?: number): Promise<boolean>     // нов.
findDuplicateLink(url: string, excludeId?: string): Promise<Item | undefined>   // нов.
```

- `setOcrText`: `text = cleanOcrText(text)`; непустой → `{ ocrText: text, ocrAt: at ?? Date.now() }`; пустой →
  `{ ocrText: undefined, ocrAt: at ?? Date.now() }` (поле удаляется, отметка «пробовали» остаётся). `updatedAt` не
  меняется. `false`, если записи нет. Работает и для записи в корзине.
- `findDuplicateLink`: читает `items.where('type').equals('link')` и возвращает `findDuplicateLinkIn(…)` (см. 2.2).

### 2.2 `src/lib/dedupe.ts` (новый, чистый)

```ts
/** Ключ сравнения адресов; null — это не http/https/ftp-адрес. */
export function linkKey(raw: string): string | null
export function sameLink(a: string, b: string): boolean
/** Запись-дубль среди items: без корзины, без excludeId; сначала не архивные, затем самая новая по createdAt. */
export function findDuplicateLinkIn(items: readonly Item[], url: string, excludeId?: string): Item | undefined
```

Правила `linkKey` (по порядку): `trim` → `normalizeUrl` из `lib/detect` (дописывает схему) → `new URL` (ошибка → `null`);
схема не из `http:`/`https:`/`ftp:` → `null`. Ключ = `[ftp://]` + хост + порт + путь + запрос + фрагмент, где:
- схема: `http` и `https` не различаются (в ключ не входят); `ftp` — префикс `ftp://`;
- логин/пароль отбрасываются;
- хост: нижний регистр (даёт `URL`), без ведущего `www.`, без конечной точки;
- порт: только нестандартный (`:8080`);
- путь: как в `URL.pathname`, без конечных `/` (корень → пустая строка); регистр пути сохраняется;
- запрос: убрать параметры слежения — имя начинается с `utm_` либо входит в набор `fbclid, gclid, gclsrc, dclid, gbraid,
  wbraid, msclkid, yclid, ysclid, mc_cid, mc_eid, _ga, _gl, igshid, igsh, ref_src, ref_url, _hsenc, _hsmi, mkt_tok`
  (сравнение имён без учёта регистра); оставшиеся отсортировать по имени (устойчиво), собрать `?a=1&b=2`; пусто → нет;
- фрагмент: отбрасывается, кроме маршрутов одностраничных приложений — начинается с `#/` или `#!` (сохраняется как есть).

Не делается (осознанно): `youtu.be` ↔ `youtube.com/watch`, `m.`-поддомены, `index.html`.

### 2.3 `src/search/*`, `src/lib/dates.ts`, `src/lib/plainText.ts`

#### Грамматика строки поиска (целиком)

```
запрос   := { пробел | фраза | оператор | слово }
фраза    := "…" | «…» | “…” | „…“          — точная подстрока; незакрытая кавычка — до конца строки
оператор := '#' значение | '#' фраза | ключ ':' значение | ключ ':' фраза
слово    := всё остальное до пробела       — свободный текст (все слова обязательны, префикс + опечатки)
```

Ключи и значения сравниваются без учёта регистра и `ё/е`. Оператор без значения (`tag:`) игнорируется. Неизвестный
ключ или ни одного распознанного значения → токен целиком остаётся свободным текстом. Все операторы объединяются по И.

| Оператор | Ключи | Значения | Поле `ItemFilter` |
|---|---|---|---|
| тег | `#x`, `tag:` `tags:` `тег:` | имя тега; через запятую — несколько (все обязательны) | `tags` |
| тип | `type:` `тип:` | `text link code idea file image` и русские синонимы; через запятую — любой из | `types` |
| вложение | `has:` | `file` (= file+image), `image`, `link` | `types` |
| признак | `is:` | `fav` · `inbox` `library` `archive` (несколько — любой из) · `untagged` · **`trash`** | `favorite` · `status` · `untagged` · `trashed` |
| категория | `cat:` `category:` `кат:` `категория:` | имя (в кавычках, если с пробелами); `none` `нет` `без` `"без категории"` — без категории | `categoryId` (через `categoryName`) |
| дата | **`date:` `дата:`** | дата · период · диапазон `A..B` | `from` и `to` |
| не раньше | **`after:` `since:` `после:`** | дата · период | `from` |
| не позже | **`before:` `until:` `до:`** | дата · период | `to` |

Новые синонимы `is:`: `trash, trashed, deleted, bin, корзина, удаленные` → `trashed: true`.

Даты (всё — **локальное время**, границы **включительно**):
- дата-литерал: `ГГГГ-ММ-ДД`, `ДД.ММ.ГГГГ` (день), `ГГГГ-ММ`, `ММ.ГГГГ` (месяц), `ГГГГ` (год). День и месяц — 1–2 цифры,
  год — ровно 4 цифры, 1970…2999. Литерал даёт отрезок `[начало периода; начало следующего периода − 1 мс]`,
  границы строятся через `new Date(y, m, d)` (устойчиво к переводу часов);
- период (зависит от «сейчас»): `today|сегодня` — сегодняшние сутки; `yesterday|вчера` — вчерашние; `week|неделя` —
  последние 7 календарных дней, включая сегодня; `month|месяц` — последние 30; `year|год` — последние 365. Отрезок
  `[начало (сегодня − N + 1); конец сегодня]`, дни отсчитываются через `setDate` (не вычитанием миллисекунд);
- `date:X` → `from = начало(X)`, `to = конец(X)`; `date:A..B` (A и B — литералы) → `from = начало(A)`, `to = конец(B)`;
- `after:X` → `from = начало(X)`; `before:X` → `to = конец(X)` (указанный день/месяц/год входит);
- несколько операторов дат пересекаются: `from = max`, `to = min`; если получилось `from > to` — так и остаётся (ничего не найдётся);
- **неверная дата** (`date:2026-13-45`, `date:31.02.2026`, `date:foo`, `date:a,b`, диапазон с `начало(A) > конец(B)`) —
  токен целиком уходит в свободный текст, фильтр не трогается;
- перечисление через запятую для дат не поддерживается.

#### Экспорты

```ts
// query.ts
parseQuery(raw: string, now?: number): ParsedQuery                 // изм.: +второй необязательный аргумент (по умолчанию Date.now())

// serialize.ts (новый файл)
serializeFilter(filter: ItemFilter, categories: readonly Category[], now?: number): string     // нов.
composeQuery(query: string, filter: ItemFilter, categories: readonly Category[], now?: number): string  // нов.

// engine.ts
interface SearchOptions {
  within?: readonly Item[]
  /** false (по умолчанию) — только вне корзины; true — только корзина; 'any' — корзину не проверять (within уже отобран). */
  trash?: boolean | 'any'                                          // нов.
  /** «Сейчас» для относительных дат (тесты). */
  now?: number                                                     // нов.
}
resolveQueryFilter(parsed: ParsedQuery, categories: readonly Category[]): ItemFilter | null   // нов.; null — категория из cat: не найдена
searchItems(items, raw, categories?, options?): SearchHit[]        // изм. (корзина, ocrText, даты)

// highlight.ts
makeSnippet(item: Item, terms: string[], maxLen?: number): string  // изм. (ocrText, без разметки Markdown)

// index.ts — реэкспортировать serializeFilter, composeQuery, resolveQueryFilter, matchesFilterIgnoringTrash
```

- `serializeFilter` — строка операторов, обратная `parseQuery` + `resolveQueryFilter`. Порядок частей фиксирован:
  статус, избранное, без тегов, корзина, типы, категория, теги, даты; разделитель — один пробел; пустой фильтр → `''`.
  - `status` → `is:inbox` (массив → несколько `is:`); пустой массив — ничего; `favorite: true` → `is:fav`;
    `untagged: true` → `is:untagged`; `trashed: true` → `is:trash`; `false`/`undefined` — ничего;
  - `types` → `type:link,code` (канонические английские id, в порядке массива);
  - `categoryId: null` → `cat:none`; если есть категория с ключом имени `none` — первый незанятый из `нет`, `без`,
    `"без категории"`; `categoryId: id` → `cat:Имя` или `cat:"Имя с пробелами"`; id нет в `categories` — оператор
    пропускается. Кавычки: первая пара из `"…"`, `«…»`, `“…”`, чьей закрывающей нет в имени; кавычки обязательны, если
    в имени есть пробел, запятая или кавычка;
  - `tags` → `#tag` на каждый; `#"tag"` в кавычках, если тег оканчивается на один из `.,;:!?)` либо содержит кавычку;
  - `from`/`to`: если пара точно равна периоду `today|yesterday|week|month|year` относительно `now` → `date:week` и т.п.
    (сохранённый поиск остаётся относительным); оба заданы и в одних сутках → `date:ГГГГ-ММ-ДД`; оба заданы →
    `date:A..B`; только `from` → `after:ГГГГ-ММ-ДД`; только `to` → `before:ГГГГ-ММ-ДД`. Точность — сутки: при обратном
    разборе `from` расширяется до начала своих суток, `to` — до конца (диапазон не сужается).
- `composeQuery` = `[serializeFilter(filter, …), query.trim()].filter(Boolean).join(' ')`. Известное ограничение: если
  и в `query`, и в `filter` задана категория, побеждает `cat:` из `query` (последний в строке).
- `resolveQueryFilter` — `{ ...parsed.filter }` + `categoryId` из `parsed.categoryName` (через `resolveCategoryName`).
- `searchItems`:
  - корзина: `options.trash === 'any'` → записи проверяются `matchesFilterIgnoringTrash`; иначе `matchesFilter` с
    `trashed = parsed.filter.trashed === true || options.trash === true`;
  - индекс: поле `ocrText` (`item.ocrText`, обрезка до `MAX_INDEXED_CONTENT`), в `FIELDS` — последним, вес 1;
    `Entry` получает `ocrAt: number` (`item.ocrAt ?? 0`); запись переиндексируется, если изменился `updatedAt`, имя
    категории **или `ocrAt`**. Точные фразы ищутся и в `ocrText` (через общий haystack);
  - `parseQuery(raw, options.now)`.
- `makeSnippet`: источники по порядку — `content`, `linkMeta.description`, `ocrText`; первое совпадение — в любом из них
  (в этом порядке); без совпадений — начало первого непустого. Для записей всех типов, кроме `code`, `content`
  предварительно проходит `stripMarkdown`. Длина и многоточия — как сейчас.

#### `src/lib/dates.ts` (новый, чистый)

```ts
export const DAY_MS = 86_400_000
export type DateRange = { from: number; to: number }
export type RelativePeriod = 'today' | 'yesterday' | 'week' | 'month' | 'year'
export function startOfDay(ts: number): number
export function endOfDay(ts: number): number                 // начало следующих суток − 1
export function addDays(ts: number, days: number): number    // календарные дни, через setDate
export function relativeRange(period: RelativePeriod, now: number): DateRange
export function parseDateToken(raw: string, now: number): DateRange | null   // литерал, период или A..B; null — неверно
export function formatDateToken(ts: number): string          // 'ГГГГ-ММ-ДД' по локальному времени
```

`src/lib/itemTitle.ts` — добавить `formatDayLabel(ts: number, now?: number): string` → «Сегодня», «Вчера», «12 ноября»,
«12 ноября 2025» (год — если не текущий), `NO_DATE` для негодной отметки. Для разделителей по дням (этап 4).

#### `src/lib/plainText.ts` (новый, чистый)

```ts
/** Текст без разметки Markdown — для сниппетов. Обычный текст не портит. */
export function stripMarkdown(md: string): string
```

Убирает: маркеры заголовков `#…` в начале строки; `>` цитат; маркеры списков `- `, `* `, `+ `, `1. `; чекбоксы
`[ ]`/`[x]` после маркера списка; строки-ограды ```` ``` ````/`~~~` (содержимое блока остаётся); обратные кавычки
инлайн-кода; `![alt](url)` → `alt`; `[текст](url)` → `текст`; `[[запись|подпись]]` → `подпись`; `[[запись]]` → `запись`;
парные `**…**`, `__…__`, `~~…~~`, `*…*`, `_…_` — только если маркер прилегает к непробельному символу, а `_` стоит на
границе слова. Не трогает: `2 * 3 * 4`, `snake_case_name`, `a_b`, одиночные `*` и `_`, адреса.

### 2.4 `src/hooks/computeVisible.ts`

```ts
computeVisible(items, categories, base, uiFilter: UiFilter, query, sort, now?: number): VisibleResult   // изм.
```

- `items` — **все** записи, включая корзину (см. 2.9);
- `effectiveBase`: если в запросе есть `is:trash` → `{ trashed: true, status: parsed.filter.status }` (статус раздела
  снимается); иначе, если есть статус в запросе → `{ ...base, status }`; иначе `base`;
- цикл: `matchesFilter(item, effectiveBase)` (считает `total`), затем `matchesFilterIgnoringTrash(item, uiFilter)`;
- `searchItems(items, query, categories, { within: pre, trash: 'any', now })`.

### 2.5 `src/lib/exportImport.ts`, `src/db/seed.ts`

```ts
export const BACKUP_VERSION = 2
export type ImportReport = { items: number; files: number; categories: number; skipped: number; positions: number; searches: number }
export interface BackupData { …; positions?: NodePosition[]; searches?: SavedSearch[] }
```

- **Экспорт**: `version: 2`; в заголовок (до `files`) добавляются `positions` (только для существующих записей) и
  `searches` (по `order`). Записи корзины экспортируются как есть (с `deletedAt`), `ocrText`/`ocrAt` — тоже.
  Транзакция чтения включает `db.positions`, `db.searches`.
- **Чтение**: версии 1 и 2. `positions`/`searches` отсутствуют или не массивы → пустые списки (не ошибка, для обеих
  версий). `version > 2` → прежняя ошибка «создана более новой версией».
- **`sanitizeItem`**: `deletedAt` — через `ts()`; `ocrText` — строка → `cleanOcrText`, пустая не пишется; `ocrAt` — `ts()`;
  `source` — по `ITEM_SOURCES` из `@/types` (локальный список удалить).
- **Положения**: `sanitizePoint` + непустой строковый `id`; дубли id — первый; негодные → `skipped`.
- **Поиски**: `id` непустой, `name`/`query` после `trim` непустые и в пределах `SAVED_SEARCH_*_MAX` (иначе `skipped`),
  `order` — число или индекс, `createdAt` — `ts() ?? now`.
- **`replace`**: дополнительно `positions.clear()`, `searches.clear()`; затем пишутся положения тех id, что есть в
  `items` после импорта, и все поиски (имена-дубли внутри копии получают суффикс ` (2)`…).
- **`merge`**: положение из копии пишется, только если у записи **нет локального** и запись существует после слияния
  (локальная раскладка сильнее); поиск: тот же `id` — остаётся локальный (`skipped`); то же имя (`searchNameKey`) и тот
  же запрос — `skipped`; то же имя, другой запрос — импортируется с суффиксом ` (2)`…; новые встают после локальных
  (`order = max + 1…`). Запись побеждает по `updatedAt` как сейчас — `deletedAt` приходит вместе с победившей версией.
- **`repairIntegrity`**: дополнительно удалить `positions`, чьих записей нет. Связи с записями в корзине — корректные.
- **Настройки**: `sanitizeSettings` использует `isValidSetting` (частный случай `theme` убрать). В `PRIVATE_SETTINGS`
  добавить: `backupDir, backupLastAt, mdExportDir` (пути и состояние этого компьютера), `aiAutoOcr, aiVisionModel`
  (включают отправку данных в сеть), `extEnabled, extPort, extToken`. Экспортируются и импортируются: `theme,
  globalShortcut, scene, font, ambient, trashDays, backupEvery, backupKeep, closeToTray`.
- **`seed.ts`**: `clearAllData` очищает также `positions` и `searches`; в `CLEARED_SETTINGS` добавить `aiVisionModel,
  aiAutoOcr, extEnabled, extToken, backupLastAt`. `isPristineDemo` — дополнительно
  `existing.deletedAt === undefined` (демо-запись в корзине считается тронутой пользователем и повторным засевом не
  воскрешается).

### 2.6 `src/lib/graphLayout.ts` (новый, чистый) и `src/store/graph.ts`

```ts
export const GRAPH_NODE_SIZE = 16      // сторона квадрата ноды, px при 100 %
export const GRAPH_CELL = 32           // шаг сетки, px; центр ноды — в узле сетки
export const GRAPH_ZONE_GAP = 3        // зазор между зонами, клеток
export const GRAPH_NONE_ZONE = 'none'  // ключ зоны записей без категории

export interface LayoutNode { id: string; categoryId: string | null; links: readonly string[]; createdAt: number }
export interface LayoutZone { key: string; x: number; y: number; r: number; count: number }
export interface LayoutResult {
  /** Положения всех нод из nodes: сохранённые — как были, новые — рассчитанные. */
  positions: Map<string, GraphPoint>
  /** id нод, получивших место в этом вызове (их нужно сохранить через setPositions). */
  placed: string[]
  zones: LayoutZone[]
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null
}

/** Записи графа: статус inbox и library, без корзины. */
export function toLayoutNodes(items: readonly Item[]): LayoutNode[]
export function computeLayout(
  nodes: readonly LayoutNode[],
  categoryOrder: readonly string[],                       // id категорий по order
  fixed: Readonly<Record<string, GraphPoint>>,            // ВСЕ сохранённые положения (и скрытых записей)
): LayoutResult
/** Ближайший к target свободный узел сетки (для броска ноды). taken — занятые положения, ignoreId — сама нода. */
export function findFreeSpot(target: GraphPoint, taken: Readonly<Record<string, GraphPoint>>, ignoreId?: string): GraphPoint
export function snapToGrid(p: GraphPoint): GraphPoint
```

Алгоритм `computeLayout` (детерминированный: без `Math.random`, все сортировки с добивкой по `id`):

1. Вход: ноды без дублей id, отсортированы по `(createdAt, id)`. Связи на отсутствующие ноды и на себя игнорируются.
2. Занятые клетки — клетка `round(x / CELL), round(y / CELL)` каждого положения из `fixed`, **включая id, которых нет
   в `nodes`** (место записи из корзины/архива не занимается). Нода с положением в `fixed` выдаётся как есть.
3. Зона ноды = `categoryId ?? 'none'`. Порядок зон: `'none'`, затем `categoryOrder`, затем неизвестные id по алфавиту.
4. Ёмкость зоны: `n` = число нод зоны (с сохранённым местом и без); `cap = max(8, 2^ceil(log2(1.5·n)))`;
   радиус в клетках `rc = ceil(sqrt(cap / π)) + 1`; `r = rc · CELL`. (Степени двойки — геометрия зоны меняется редко.)
5. Центр зоны: если в зоне есть ноды с сохранённым местом — покоординатная (нижняя) медиана их точек, привязанная к
   сетке; иначе центр подбирается обходом «подсолнуха»: кандидат `i = 0, 1, 2…`: `ρ = CELL·sqrt(i)`,
   `θ = i · 2.399963229728653`, точка привязывается к сетке; первый кандидат, где для всех уже размещённых зон
   `dist ≥ r + r' + GRAPH_ZONE_GAP·CELL`. Предел 50 000 кандидатов, затем — справа от всех зон. На пустом `fixed`
   зона «без категории» получает `(0, 0)`, категории — вокруг по спирали.
6. Размещение нод без места, зона за зоной: компоненты связности (по связям внутри зоны) в порядке
   `(min createdAt, min id)`; внутри компоненты — обход в ширину от ноды с наибольшей степенью, соседи по `(createdAt, id)`.
   Для ноды кандидаты: (а) 8 ближайших к центру свободных клеток зоны (клетки зоны — смещения, отсортированные по
   `(dx² + dy², dy, dx)`; указатель на первую свободную только растёт); (б) свободные клетки квадрата 5×5 вокруг
   каждой уже размещённой связанной ноды (не больше 6 соседей, по `id`), если сосед в той же зоне либо ближе
   `r + 2·CELL` к центру зоны. Оценка клетки = `Σ dist²(клетка, связанные размещённые) + 0.25 · dist²(клетка, центр)`;
   минимум; ничья — ближе к центру, затем `(cy, cx)`. Нет размещённых связанных — первая свободная клетка зоны.
   Клетки вне номинального радиуса допустимы (зона «растёт»), пересечений нод не бывает никогда.
7. `zones` — для зон с `count ≥ 1`; `bounds` — по центрам нод `± GRAPH_NODE_SIZE / 2`; пустой вход → `positions` пуст,
   `bounds: null`.

Сложность: сортировки `O(n log n)`, размещение `O(n)` (постоянное число кандидатов), центры зон `O(k² · I)` для `k`
категорий. Цель: 2000 нод, 3000 связей — < 300 мс.

`src/store/graph.ts`:

```ts
export interface GraphCamera { x: number; y: number; zoom: number }   // x, y — мировая точка в центре экрана
interface GraphState {
  camera: GraphCamera
  hoveredId: string | null
  /** Ключ зоны (id категории или 'none'), остальные ноды приглушены; null — нет. */
  focusZone: string | null
  setCamera: (patch: Partial<GraphCamera>) => void
  resetCamera: () => void
  setHovered: (id: string | null) => void
  setFocusZone: (key: string | null) => void
}
export const useGraph: UseBoundStore<StoreApi<GraphState>>
export const GRAPH_CAMERA_KEY = 'qd-graph-camera'
```

Камера по умолчанию `{ x: 0, y: 0, zoom: 1 }`; при создании стора читается из `localStorage` (try/catch, проверка
типов, `zoom` в пределах 0.1…4), при `setCamera` пишется с задержкой 300 мс. Без `localStorage` (тесты, приватный
режим) — молча в памяти. Ступени масштаба и жесты определяет этап 5.

### 2.7 `src/lib/wikiLinks.ts`, `src/lib/markdownExport.ts` (новые, чистые)

```ts
// wikiLinks.ts
export interface WikiLink { raw: string; target: string; label: string; start: number; end: number }
export function parseWikiLinks(text: string): WikiLink[]
export function wikiKey(title: string): string
export function buildTitleIndex(items: readonly Item[]): Map<string, Item>
export function resolveWikiLink(target: string, index: ReadonlyMap<string, Item>, selfId?: string): Item | undefined
/** id записей, на которые ссылается текст: уникальные, без selfId, в порядке появления. */
export function wikiLinkTargets(text: string, items: readonly Item[], selfId?: string): string[]
```

- `[[запись]]` и `[[запись|подпись]]`; `target`/`label` — `trim`; `label` по умолчанию = `target`; пустой `target`,
  перевод строки или `[`/`]` внутри — не ссылка; `target` длиннее 200 символов — не ссылка. Ссылки внутри блоков
  ```` ``` ````/`~~~` и инлайн-кода `` `…` `` не разбираются. `start`/`end` — позиции в исходном тексте.
- `wikiKey` = `foldText` + схлопнутые пробелы + `trim` (регистр и `ё/е` не важны).
- `buildTitleIndex`: ключ — `wikiKey(displayTitle(item))`; записи с `deletedAt` пропускаются; при одинаковом заголовке
  побеждает: `library` → `inbox` → `archive`, затем более ранняя `createdAt`, затем меньший `id`.
- `resolveWikiLink` не возвращает запись `selfId`.

```ts
// markdownExport.ts
export interface MdAttachment { path: string; fileId: string; name: string }     // path — относительно корня экспорта, разделитель '/'
/** Структурно совместим с ExportDoc из src/lib/exportDir.ts (spec-tauri, п. 1.8): { path, markdown, attachments: [{ path, fileId }] }. */
export interface MdExportEntry { id: string; path: string; markdown: string; attachments: MdAttachment[] }
export interface MdExportPlan { notes: Map<string, string>; attachments: Map<string, string> }  // id записи → имя без .md; id записи → 'attachments/…'
export function safeFileName(raw: string, maxLen?: number): string                // по умолчанию 80
export function planMarkdownExport(items: readonly Item[]): MdExportPlan
export function itemToMarkdown(item: Item, ctx: { categories: readonly Category[]; items: readonly Item[]; plan: MdExportPlan }): MdExportEntry
export function buildMarkdownExport(items: readonly Item[], categories: readonly Category[]): MdExportEntry[]
```

- `safeFileName` — имя обязано проходить `safe_rel_path` из `spec-tauri.md` (п. 1.3; Rust ничего не чинит, только
  отклоняет): NFC; символы `< > : " / \ | ? *`, управляющие (0–31, 127) и `# ^ [ ]` → пробел; пробелы схлопнуть;
  убрать ведущие точки и пробелы, конечные точки и пробелы; зарезервированные имена Windows — сравнение без учёта
  регистра по части **до первой точки** с обрезкой пробелов: `CON, PRN, AUX, NUL, COM1–9, LPT1–9, COM¹ COM² COM³,
  LPT¹ LPT² LPT³, CONIN$, CONOUT$` → префикс `_`; окончание `.qdpart` (без учёта регистра) → дописать `_`;
  пусто → `Без названия`; обрезка до `maxLen` единиц UTF-16 без разрыва суррогатных пар, расширение (последняя точка,
  не длиннее 10 символов) при обрезке сохраняется; после обрезки снова убрать конечные точки и пробелы.
- `planMarkdownExport`: записи без корзины, в порядке `(createdAt, id)`; имя заметки = `safeFileName(displayTitle, 72)`;
  совпадение без учёта регистра → ` (2)`, ` (3)`…; вложение записи с `fileId` → `attachments/` +
  `safeFileName(fileName, 74)`, совпадения → ` (2)` перед расширением. Итоговое имя любого файла (с суффиксом и
  расширением) ≤ 80 символов, глубина пути ≤ 2.
- `itemToMarkdown`: `path = <имя>.md`. Содержимое:
  - шапка YAML: `id`, `title` (`displayTitle`), `type`, `status`, `category` (имя; нет категории — поля нет), `tags`
    (`[a, b]`, поле есть всегда), `favorite: true` (только если избранное), `url` (для ссылок), `created`, `updated`
    (`new Date(ts).toISOString()`), `source: quickdrop`. Все строки — в двойных кавычках с экранированием `\` и `"`,
    переводы строк → пробел;
  - тело: `text`/`idea` — `# Заголовок` (только если задан `item.title`), затем `content`; `link` —
    `[displayTitle](url)`, описание страницы цитатой `> …`, затем `content`; `code` — блок с языком, ограда длиннее
    любой серии обратных кавычек в коде (минимум 3); `image` — `content`, затем `![имя](attachments/…)`; `file` —
    `content`, затем `[имя](attachments/…)` (в адресе пробелы и скобки закодированы `encodeURI` + `%28`/`%29`);
    непустой `ocrText` — раздел `## Распознанный текст`;
  - вики-ссылки в `content`, которые разрешаются в запись из `plan.notes`, переписываются в `[[ИмяФайла|подпись]]`;
    неразрешённые остаются как есть;
  - связи: раздел `## Связанные` со строками `- [[ИмяФайла]]` для каждого id из `item.links`, который есть в
    `plan.notes` (корзина туда не попадает); нет таких — раздела нет;
  - `attachments` — одна запись для `file`/`image` с `fileId`. Сам Blob читает вызывающий (`getFile`).
- `buildMarkdownExport` = план + `itemToMarkdown` для каждой записи без корзины.

### 2.8 `src/lib/pdfText.ts`, `src/lib/pdfEngine.ts` (новые)

```ts
// pdfText.ts — никогда не бросает
export const PDF_MAX_PAGES = 200
export const PDF_MAX_CHARS = 200_000            // = MAX_OCR_TEXT
export const PDF_MAX_BYTES = 50 * 1024 * 1024
export const PDF_TIMEOUT_MS = 30_000
export interface PdfDocLike { numPages: number; pageText(page: number): Promise<string>; close(): Promise<void> }
export interface PdfEngine { open(data: Uint8Array): Promise<PdfDocLike> }
export interface PdfTextOptions { maxPages?: number; maxChars?: number; signal?: AbortSignal; engine?: () => Promise<PdfEngine> }
export interface PdfTextResult {
  status: 'ok' | 'empty' | 'failed' | 'aborted'
  text: string            // очищенный (cleanOcrText), '' при empty/failed
  pages: number           // всего страниц в файле (0, если не открылся)
  readPages: number
  truncated: boolean      // упёрлись в предел страниц, символов или времени
  error?: string          // русский текст для status === 'failed'
}
export function isPdf(file: { mimeType?: string; fileName?: string }): boolean      // application/pdf или расширение .pdf
export function extractPdfText(data: Blob, options?: PdfTextOptions): Promise<PdfTextResult>
```

- Порядок: размер > `PDF_MAX_BYTES` → `failed` («PDF больше 50 МБ — текст не извлекается»); движок по умолчанию —
  `(await import('./pdfEngine')).loadPdfEngine()` (ленивый чанк); страницы читаются по одной, между страницами
  проверяются `signal` (→ `aborted`, прочитанное не возвращается) и время (`PDF_TIMEOUT_MS`: если уже набрано ≥ 20
  непробельных символов → `ok` + `truncated`, иначе → `failed` «Не удалось прочитать PDF за отведённое время»);
  текст страниц склеивается через пустую строку; меньше 20 непробельных символов на все прочитанные страницы → `empty`
  (скан без текстового слоя — кандидат на распознавание ИИ); любое исключение (битый файл, пароль, нет worker) →
  `failed` с понятным текстом («PDF защищён паролем», «Не удалось прочитать PDF»). `close()` — в `finally`.
- `pdfEngine.ts`: `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`; `loadPdfEngine()` делает
  `await import('pdfjs-dist')`, ставит `GlobalWorkerOptions.workerSrc = workerUrl`, открывает документ через
  `getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false })`. `pageText` — элементы
  `getTextContent()`: `str` подряд, `hasEOL` → `\n`. Никаких сетевых адресов (CMap, шрифты) не задавать.
  Тесты `pdfText.test.ts` этот файл не импортируют (движок подставляется).
- Пакет: `pdfjs-dist@6.5.438` (проверено `npm view`; требует Node ≥ 22.13 — установлен 22.23). После установки
  исполнитель сверяет путь worker-файла (`ls node_modules/pdfjs-dist/build`) и API `getDocument`/`getTextContent`.

### 2.9 `src/hooks/useItems.ts`

```ts
useAllItems(): Item[] | undefined                 // изм.: без корзины
getAllItemsSnapshot(): Item[] | undefined         // изм.: без корзины
useTrashedItems(): Item[] | undefined             // нов.: только корзина, по deletedAt убыв.
getTrashedItemsSnapshot(): Item[] | undefined     // нов.
useItemsWithTrash(): Item[] | undefined           // нов.: все записи (для поиска)
getItemsWithTrashSnapshot(): Item[] | undefined   // нов.
useTrashCount(): number                           // нов.
usePositions(): Record<string, GraphPoint> | undefined   // нов.: liveQuery таблицы positions
useSavedSearches(): SavedSearch[]                 // нов.: по order; [] пока грузится
useDayKey(): number                               // нов.: начало текущих локальных суток; обновляется в полночь
useVisibleItems(base): …                          // изм.
useLinkedItems(item): Item[]                      // изм.: без записей в корзине
```

- Источник один: `liveQuery(() => db.items.toArray())`. Срезы считаются один раз на снимок (`WeakMap<Item[], …>`);
  если корзина пуста, срез «без корзины» — **тот же массив**, что и полный снимок, корзина — общий пустой массив
  (ссылки стабильны: требование `useSyncExternalStore` и быстрый путь индекса поиска).
- `useCounts`, `useAllTags`, `computeCounts`, `computeAllTags` — без изменений в коде: получают срез без корзины.
  `useCounts` поле корзины не получает (сигнатура зафиксирована) — для неё `useTrashCount()`.
- `useVisibleItems`: берёт `useItemsWithTrash()`; в зависимости `useMemo` добавляется `useDayKey()`; `now` в
  `computeVisible` не передаётся (берётся текущее время).
- `useItem(id)` — без изменений: отдаёт и запись из корзины.

### 2.10 `src/lib/actions.ts`, `src/lib/trashCleanup.ts`, `src/lib/ocr.ts`

```ts
// actions.ts
actDelete(ids): Promise<void>                    // изм.: в корзину; toast «В корзине» / «В корзине: N» + «Отменить» (restoreItems)
actRestoreFromTrash(ids: string | string[]): Promise<void>   // нов.: toast «Восстановлено» / «Восстановлено: N»
actPurge(ids: string | string[]): Promise<void>  // нов.: purgeItems; toast «Удалено навсегда» / «Удалено навсегда: N»; без отмены
actEmptyTrash(): Promise<void>                   // нов.: emptyTrash; toast «Корзина очищена: N»; при 0 — без toast
actSaveSearch(name: string, query: string): Promise<SavedSearch | undefined>   // нов.: toast.success «Поиск сохранён»
actDeleteSearch(search: SavedSearch): Promise<void>          // нов.: toast «Поиск удалён» + «Отменить» (restoreSavedSearch)
applyWikiLinks(itemId: string, content: string, items: readonly Item[]): Promise<string[]>   // нов.
createAndEnrich(input): Promise<Item>            // изм.: для PDF в фоне запускает extractItemText
```

- Все — через существующий `safe()`: ошибки становятся `toast.error`, наружу не бросают. Подтверждение перед
  `actPurge`/`actEmptyTrash` — на стороне UI.
- `applyWikiLinks`: `wikiLinkTargets(content, items, itemId)` → для каждой цели, которой ещё нет в связях записи, —
  `linkItems`. Возвращает id новых связей. Связи не снимает (удаление `[[…]]` из текста связь не рвёт). Не бросает.

```ts
// trashCleanup.ts
export const TRASH_CLEANUP_EVERY_MS = 6 * 60 * 60 * 1000
export async function cleanupTrash(now?: number): Promise<number>   // getSettings().trashDays → purgeExpired; не бросает (ошибка → 0 + console.warn)
export function startTrashCleanup(): () => void                     // первый запуск через 5 с, затем каждые 6 ч; возвращает остановку
```

```ts
// ocr.ts
export type TextSource = 'pdf' | 'image'
export interface ExtractOutcome { status: 'ok' | 'empty' | 'failed' | 'skipped'; error?: string }
export function textSourceOf(item: Pick<Item, 'type' | 'mimeType' | 'fileName' | 'fileId'>): TextSource | null
export function extractItemText(item: Item, options?: { vision?: boolean; force?: boolean; signal?: AbortSignal }): Promise<ExtractOutcome>
export function backfillPdfText(limit?: number): Promise<number>     // по умолчанию 10
```

- `textSourceOf`: `pdf` — запись с `fileId` и `isPdf`; `image` — `type === 'image'` с `fileId`; иначе `null`.
- `extractItemText` (не бросает): нет источника → `skipped`; `ocrAt` уже есть и нет `force` → `skipped`; PDF →
  `getFile` → `extractPdfText` → при `ok`/`empty` вызвать `setOcrText(id, text)`; `failed`/`aborted` — `ocrAt` не
  ставится (можно повторить). Ветка `image` и PDF со статусом `empty` при `vision: true` — **этап 8**: на этапе 2
  возвращает `skipped`.
- `backfillPdfText`: PDF-записи без `ocrAt` (включая архив, без корзины), по одной, не больше `limit` за вызов;
  возвращает число обработанных.

Контракт этапа 8 (для сведения, на этапе 2 не реализуется): `lib/ai.ts` —
`recognizeText(image: Blob, settings: Settings, signal?: AbortSignal): Promise<string>` (OpenAI-совместимый
`/chat/completions` с `image_url`, модель `settings.aiVisionModel || settings.aiModel`, проверки `aiEnabled`/ключа/
`aiBaseUrlError` и ошибки — как у `suggestForItem`); вызывается только по кнопке «Распознать» или при `aiAutoOcr`.

---

## 3. Тесты

Общее: тесты, которые чистят базу в `beforeEach`, добавляют `db.positions.clear()` и `db.searches.clear()`.

### 3.1 Существующие тесты, которые меняются

| Файл | Тест | Что меняется |
|---|---|---|
| `db/repo.test.ts` | «каскадно удаляет файл и обратные связи, restore всё возвращает» | Переписать: после `deleteItem` запись есть и имеет `deletedAt`, файл на месте, `links` соседей не тронуты; `restoreItem` снимает `deletedAt`, запись равна исходной. Прежний сценарий каскада переносится в новый тест `purgeItems` |
| `db/repo.test.ts` | «deleteItems: снимки связанной пары исходные…» | После `deleteItems` у соседа `links` **остаются** (`[b.id]`), `updatedAt` не тронут; после `restoreItems` все три записи равны исходным |
| `db/repo.test.ts` | «deleteItem бросает для несуществующей записи» | Добавить: бросает и для записи, уже лежащей в корзине |
| `db/repo.test.ts` | «restore сбрасывает удалённую за это время категорию», «отмена удаления не возвращает вечную загрузку» | Проходят без правок; добавить вариант «после `purgeItems`» (воссоздание из снимка) |
| `lib/actions.test.ts` | «удаление и отмена во время загрузки не оставляют вечную загрузку» | Запись теперь остаётся в БД: поздний ответ записывается; после `restoreItems` — `{ status: 'ok', title: 'F' }`, `deletedAt` нет. Добавить вариант с `purgeItems` до ответа: ответ некуда писать, после `restoreItems` — `{ status: 'failed' }` |
| `lib/exportImport.test.ts` | «восстанавливает записи, категории, настройки и байты файлов» | `data.version` → `2`; отчёт → `{ items: 2, files: 1, categories: 1, skipped: 0, positions: 0, searches: 0 }` |
| `lib/exportImport.test.ts` | «битый JSON и чужой формат…» | «более новой версией» — для `version: 3` |
| `lib/exportImport.test.ts` | прочие сравнения отчёта через `toEqual` | Добавить `positions: 0, searches: 0` |
| `db/seed.test.ts` | «clearAllData очищает данные…» | Проверить также `positions` и `searches`; новые стираемые настройки |
| `search/search.test.ts`, `hooks/computeVisible.test.ts`, `hooks/useItems.test.ts`, `lib/ai.test.ts`, `db/db.test.ts` | — | Существующие проходят без правок (только добавления) |

### 3.2 Обязательные новые тесты

**Шаг контрактов.** `db.test.ts` — 1.7. `settingsSchema.test.ts` — каждое правило из 1.5 (годное/негодное значение
для каждого перечисления и числа, неизвестный ключ); `mergeSettings` отбрасывает `scene: 'x'`, `trashDays: -1`.
`normalize.test.ts` — `cleanOcrText` (управляющие символы, `\r\n`, обрезка), `sanitizePoint` (NaN, строки, округление,
предел), `searchNameKey`.

**`repo.test.ts`.**
- корзина: `deleteItems` не меняет `updatedAt`/`links`/файл/положение; повторный вызов для записи в корзине — пустой
  результат; `restoreFromTrash`; `restoreItems` для записи вне корзины — без изменений;
- `purgeItems`: файл удалён, связи у соседей убраны без смены `updatedAt`, положение удалено, возвращает число;
  работает и для записи вне корзины; несуществующие id → 0;
- `emptyTrash`: удаляет только корзину; `purgeExpired`: граница включительно, `days = 0`/`NaN`/отрицательное → 0,
  свежие записи остаются, `now` подставляется;
- `restoreItems` после `purgeItems`: воссоздание с файлом и связями (прежняя логика);
- `linkItems` с записью в корзине — ничего не делает;
- положения: `setPositions` не меняет `updatedAt` записи, пропускает неизвестные id и негодные точки, округляет;
  `getPositions`; `removePositions`; `clearPositions` возвращает прежние; смена категории (`setCategory`,
  `updateItem({ categoryId })`, `deleteCategory`) удаляет положение, та же категория — нет; архив и корзина — нет;
- сохранённые поиски: создание (порядок, trim), все ошибки из 2.1, `updateSavedSearch` с `undefined`,
  `reorderSavedSearches` (частичный список, неизвестные id), `restoreSavedSearch` при занятом имени;
- `setOcrText`: не меняет `updatedAt`, ставит `ocrAt`, пустой текст удаляет `ocrText`, обрезка, `false` для
  несуществующей записи; `findDuplicateLink`: находит по нормализованному адресу, пропускает корзину и `excludeId`.

**`dedupe.test.ts`.** Таблица пар «одинаковые»: регистр хоста, `www.`, `http`/`https`, конечный `/`, `#фрагмент`,
`utm_*` и набор слежения, порядок параметров, порт по умолчанию, адрес без схемы. Пары «разные»: путь, значимый
параметр, `#/маршрут`, регистр пути, нестандартный порт. `null` для `mailto:`, пустой строки, мусора.
`findDuplicateLinkIn`: приоритет не архивной, затем новой; корзина и `excludeId` пропускаются.

**`search.test.ts` и соседние.**
- `parseQuery` даты: каждый формат литерала; `today|yesterday|week|month|year` и русские синонимы при заданном `now`;
  `after:`/`before:` (включительно); `A..B`; пересечение нескольких операторов; неверные даты остаются текстом и не
  трогают фильтр; `date:` без значения игнорируется; `is:trash` и синонимы; ожидаемые значения строятся через
  `new Date(y, m, d)` (тест не зависит от часового пояса);
- `serializeFilter`: каждое поле отдельно; «круг» `resolveQueryFilter(parseQuery(serializeFilter(f)))` равен `f` для
  набора фильтров (все поля, категория с пробелом и с кавычкой, «без категории», тег с точкой в конце, даты по
  границам суток, относительные периоды); неизвестная категория пропускается; пустой фильтр → `''`; `composeQuery`;
- `matchesFilter`: `trashed` (обе стороны), `matchesFilterIgnoringTrash`;
- `searchItems`: корзина скрыта по умолчанию, `trash: true`, `trash: 'any'`, `is:trash`; поиск и точная фраза по
  `ocrText`; смена `ocrAt` без смены `updatedAt` переиндексирует запись (по `getSearchIndexStats().replaced`);
- `makeSnippet`: совпадение только в `ocrText`; запись без `content` — начало `ocrText`; разметка Markdown убрана у
  `text`, сохранена у `code`;
- `dates.test.ts`: границы суток, `addDays` через смену месяца/года, `relativeRange`, `parseDateToken` (31.02 → null),
  `formatDateToken`; `itemTitle.test.ts`: `formatDayLabel`;
- `plainText.test.ts`: каждое правило + случаи «не трогает» из 2.3;
- `computeVisible.test.ts`: корзина не видна в разделах и не входит в `total`; `base: { trashed: true }` показывает
  только корзину (в т.ч. с текстом и с `uiFilter`); `is:trash` из раздела «Входящие» снимает статус; вход в корзину
  не перестраивает индекс (`rebuilt: false`); дата из запроса и `uiFilter.from` пересекаются.

**`exportImport.test.ts`, `seed.test.ts`.** Полный цикл с корзиной, `ocrText`/`ocrAt`, положениями и поисками;
чтение копии версии 1 (без новых разделов); `replace` очищает положения и поиски; `merge`: локальное положение
сильнее, положение без записи не пишется, поиск-дубль пропущен, одноимённый с другим запросом получает суффикс;
негодные положения/поиски → `skipped`; `deletedAt` вне диапазона дат отбрасывается; новые приватные настройки не
попадают в экспорт и не импортируются, `scene`/`font`/`ambient`/`trashDays` — попадают; негодное `scene` из копии
игнорируется; `repairIntegrity` удаляет положения без записей; демо-запись в корзине не воскрешается `seedDemoData(true)`.

**`graphLayout.test.ts`.** Детерминизм (повторный вызов и перемешанный вход дают равный результат); нет двух нод в
одной клетке; сохранённые положения возвращаются без изменений и не попадают в `placed`; клетки сохранённых
положений скрытых записей не занимаются; на пустом `fixed` зоны не пересекаются (`dist ≥ r₁ + r₂ + зазор`), зона «без
категории» — в `(0, 0)`; две связанные ноды одной зоны — в соседних клетках; новая нода при переданных сохранённых
положениях остальных никого не сдвигает и встаёт у своей зоны; связи на неизвестные id и на себя, дубли id,
неизвестная категория, пустой вход; `findFreeSpot` (свободно → привязка к сетке, занято → ближайшая свободная,
`ignoreId`); `toLayoutNodes` (без архива и корзины); производительность: 2000 нод, 12 категорий, 3000 связей
(генератор с фиксированным зерном) — проверка < 1500 мс. `graph.test.ts`: значения по умолчанию, `setCamera`,
работа без `localStorage`.

**`wikiLinks.test.ts`, `markdownExport.test.ts`.** Разбор обеих форм, пробелы, пустая цель, вложенные скобки, код и
ограды, позиции; сопоставление без регистра и `ё/е`, приоритет при одинаковых заголовках, корзина и `selfId`.
`safeFileName`: каждый запрещённый символ, `CON`/`con.txt`/`LPT1`, точки и пробелы по краям, пусто, длинное имя,
эмодзи на границе обрезки. План: совпадения имён без учёта регистра, вложения с одинаковым именем. Запись каждого
типа → ожидаемый текст целиком (шапка, тело, «Связанные»); кавычки и перевод строки в заголовке; код с ```` ``` ````
внутри; переписывание вики-ссылок; связь с записью из корзины не выводится.

**`pdfText.test.ts`** (движок-подделка через `options.engine`). `ok` с несколькими страницами; предел страниц и
символов → `truncated`; `empty`; исключение при открытии и при чтении страницы → `failed`, `close()` вызван;
`signal` → `aborted`; превышение времени (fake timers): с текстом → `ok` + `truncated`, без текста → `failed`; файл больше предела → `failed` без
вызова движка; `isPdf`. Настоящий `pdfjs-dist` в тестах не загружается.

**`useItems.test.ts`, `actions.test.ts`, `trashCleanup.test.ts`, `ocr.test.ts`.** Срезы: запись в корзине уходит из
`getAllItemsSnapshot()` и появляется в `getTrashedItemsSnapshot()`; ссылки срезов стабильны между вызовами; при
пустой корзине срез и полный снимок — один массив; чтений таблицы на мутацию по-прежнему одно; `setPositions` не
вызывает чтения `items`. `actDelete` → запись в корзине, действие toast «Отменить» возвращает; `actPurge`,
`actRestoreFromTrash`, `actEmptyTrash` (тексты toast, счётчик); `actSaveSearch` — ошибка дубля уходит в
`toast.error`; `applyWikiLinks` создаёт только недостающие связи. `cleanupTrash`: учитывает `trashDays`, `0` — ничего,
ошибка не всплывает. `extractItemText`: PDF → `setOcrText`; повтор без `force` → `skipped`; `failed` не ставит `ocrAt`;
`backfillPdfText` соблюдает `limit` и пропускает корзину.

(уточнено при сверке) У `extractItemText` и `createAndEnrich` нет параметра для подмены движка PDF, а настоящий
`pdfjs-dist` в тестах загружаться не должен (окружение `node`: worker через `?url`, DOM-зависимости). Поэтому `ocr.test.ts` и
`actions.test.ts` подменяют модуль целиком: `vi.mock('@/lib/pdfText', …)` с поддельным `extractPdfText` (и настоящим
`isPdf`). Тест, который импортирует `ocr.ts` или `actions.ts` без этой подмены и создаёт PDF-запись, считается ошибкой.

---

## 4. Исполнители и владение файлами

Порядок: **шаг 0** (один агент) → **волна 1** (шесть агентов параллельно) → **волна 2** (один агент).
До волны 1 основная сессия ставит `pdfjs-dist@6.5.438` (`npm i pdfjs-dist@6.5.438`). Файлы не пересекаются;
«+тест» — одноимённый `*.test.ts` рядом.

| Агент | Волна | Файлы (исключительное владение) | Зависит от |
|---|---|---|---|
| `data-contracts` | 0 | `src/types.ts`, `src/db/db.ts` +тест, `src/db/settings.ts`, `src/lib/settingsSchema.ts` +тест (нов.), `src/lib/filter.ts`, `src/lib/normalize.ts` +тест (нов. тест), `src/store/ui.ts`, одна строка `src/components/items/ItemDetail.tsx` | — |
| `data-repo` | 1 | `src/db/repo.ts` +тест, `src/lib/dedupe.ts` +тест (нов.) | шаг 0 |
| `data-search` | 1 | `src/search/*` (вкл. новый `serialize.ts` и `search.test.ts`), `src/lib/dates.ts` +тест (нов.), `src/lib/plainText.ts` +тест (нов.), `src/hooks/computeVisible.ts` +тест, `src/lib/itemTitle.ts` +тест | шаг 0 |
| `data-backup` | 1 | `src/lib/exportImport.ts` +тест, `src/db/seed.ts` +тест | шаг 0 |
| `data-graph` | 1 | `src/lib/graphLayout.ts` +тест (нов.), `src/store/graph.ts` +тест (нов.) | шаг 0 |
| `data-markdown` | 1 | `src/lib/wikiLinks.ts` +тест (нов.), `src/lib/markdownExport.ts` +тест (нов.) | шаг 0 |
| `data-pdf` | 1 | `src/lib/pdfText.ts` +тест (нов.), `src/lib/pdfEngine.ts` (нов.) | шаг 0, пакет |
| `data-hooks` | 2 | `src/hooks/useItems.ts` +тест, `src/lib/actions.ts` +тест, `src/lib/trashCleanup.ts` +тест (нов.), `src/lib/ocr.ts` +тест (нов.) | `data-repo`, `data-search`, `data-pdf`, `data-markdown` |

Правила для всех: `package.json`, `vite.config.ts`, `src/main.tsx`, `CLAUDE.md`, `src/components/**`, `src/views/**`,
`public/**`, `src-tauri/**`, git не трогать; свой файл `.progress/agents/<имя>.md`; перед сдачей —
`npm run typecheck` (зелёный всегда) и тесты своих файлов (`npx vitest run <пути>`).

Критерии готовности:
- шаг 0 — см. 1.9;
- волна 1 — у каждого агента зелёные typecheck и свои тесты из раздела 3. Полный `npm test` после волны 1 может иметь
  **один** красный тест: `actions.test.ts › удаление и отмена во время загрузки…` (ломается от корзины, чинит `data-hooks`);
- волна 2 — полный `npm test` и `npm run typecheck` зелёные; `npm run build` проходит (основная сессия, после точек
  интеграции из раздела 6).

Промежуточное состояние: между `data-repo` и `data-hooks` записи в корзине пропадают из списков (через `matchesFilter`),
но ещё считаются в тегах и счётчиках — коммитить волны 1 и 2 одним этапом.

---

## 5. Влияние корзины и новых данных на существующий UI (список для этапов 3–5, 8)

Без правок интерфейса после этапа 2 всё работает как раньше, с одним отличием: удалённое попадает в корзину
(toast «В корзине»), а раздела «Корзина» ещё нет — записи лежат до автоочистки или до этапа 4.

### 5.1 Вызовы `actDelete` (поведение меняется само, правка — по желанию)

| Место | Сейчас | После этапа 2 | Что сделать на этапах 3–4 |
|---|---|---|---|
| `components/items/BulkBar.tsx:108` | удаление пакета | в корзину | в разделе «Корзина» — кнопки «Восстановить» (`actRestoreFromTrash`) и «Удалить навсегда» (`actPurge` после подтверждения) |
| `components/items/ItemCard.tsx:167` | кнопка «Удалить» | в корзину | вариант `trash`: другие быстрые действия |
| `components/items/ItemList.tsx:366` | клавиша `Del` | в корзину | в корзине `Del` → `actPurge` с подтверждением; добавить `variant: 'trash'` |
| `components/items/ItemMenu.tsx:75` | пункт «Удалить» | в корзину | в корзине — «Восстановить», «Удалить навсегда» |
| `components/items/TriageMode.tsx:338` | решение «удалить» | в корзину | — |

Прямых вызовов `deleteItem`/`deleteItems`/`restoreItems` из компонентов нет (только `lib/actions.ts`).

### 5.2 Потребители `useAllItems` / `getAllItemsSnapshot` (теперь без корзины)

| Место | Последствие | Что сделать |
|---|---|---|
| `components/items/ItemDetail.tsx:183-185` (`missing`) | запись в корзине считается отсутствующей → панель ведёт себя как после удаления сейчас (регресса нет) | этап 4: в разделе «Корзина» проверять по `useItemsWithTrash()`; показывать запись только для чтения с «Восстановить» / «Удалить навсегда» и датой удаления |
| `components/items/ItemList.tsx:143,155,200` (поиск открытой записи в снимке) | запись из корзины не находится | этап 4: для `variant: 'trash'` — `getItemsWithTrashSnapshot()` |
| `components/items/detail/LinkedItems.tsx:29-30` | связанные из корзины скрыты (`useLinkedItems`), «похожие по тегам» — тоже | — |
| `components/items/detail/LinkPicker.tsx:19,29` | корзина не предлагается для связи | заодно заменить `searchItems(pool, …)` на `searchItems(all, query, categories, { within: pool })` — сейчас подмножество в первом аргументе перестраивает индекс |
| `components/items/TriageMode.tsx:293` | удалённая в разборе запись исчезает из набора, как раньше | — |
| `components/palette/CommandPalette.tsx:88,151` | корзина не ищется | этап 4: команды «Корзина», «Очистить корзину»; этап 5: «Граф» |
| `components/layout/Sidebar.tsx:175-186` | счётчики и теги без корзины | этап 3–4: пункты «Граф» и «Корзина» (`useTrashCount()`), блок сохранённых поисков (`useSavedSearches`, `applyQuery`, `actSaveSearch`, `actDeleteSearch`, `reorderSavedSearches`) |
| `views/InboxView.tsx:112` (`useCounts`) | без корзины | — |
| `views/settings/DataSection.tsx:31` | число записей — без корзины | показать корзину отдельной строкой; в отчёте импорта — новые поля `positions`, `searches` |
| `views/settings/CategoriesSection.tsx:122`, `TagsSection.tsx:15`, `components/items/FilterBar.tsx:162`, `TagInput.tsx:22` | счётчики и подсказки без корзины | — |

### 5.3 Новые экраны и точки подключения

- `AppShell.tsx`: список `VIEWS` и `ActiveView` — добавить `graph` (ленивый чанк) и `trash`; без этого адреса `#/graph`
  и `#/trash` игнорируются, а `setView('trash')` показывает пустую область.
- `hooks/useHotkeys.ts` (`VIEW_BY_DIGIT`): клавиша раздела «Граф» — `5` (`Digit5: 'graph'`, этап 5); «Корзина» —
  без цифры, последним пунктом навигации (уточнено при сверке — так в `.progress/spec-stage3.md` §1.3).
- Раздел «Корзина» (этап 4): `useVisibleItems({ trashed: true })`; сортировка по дате удаления — на стороне раздела
  (`SortMode` не расширяется: у него могут быть исчерпывающие таблицы подписей); «Очистить» → подтверждение →
  `actEmptyTrash()`; подпись «удалится через N дн.» = `trashDays − прошедшие дни` (при `trashDays = 0` — не показывать).
- `QuickCapture` (этап 4): предупреждение о дубле — `findDuplicateLinkIn(useAllItems() ?? [], url)`; «Открыть» →
  `setView` по статусу найденной записи + `select(id)`.
- `TopBar`/`FilterBar` (этап 4): «Сохранить поиск» → `composeQuery(query, filter, categories)` → `actSaveSearch`;
  быстрые периоды задавать через `relativeRange(…)` (обе границы — тогда сохранённый поиск остаётся относительным);
  свой период — `startOfDay(from)` / `endOfDay(to)`.
- Списки (этап 4): разделители по дням — `formatDayLabel`; точная дата в подсказке — `formatDateTime`.
- Детали записи (этап 4): после сохранения текста — `applyWikiLinks(id, content, useAllItems())`; просмотр Markdown
  разрешает `[[…]]` через `buildTitleIndex`/`resolveWikiLink`.
- Настройки: срок корзины (`trashDays`), автокопия и папка Markdown (`backupDir`, `backupEvery`, `backupKeep`,
  `mdExportDir` — этап 4 + Tauri), распознавание (`aiAutoOcr`, `aiVisionModel` — этап 8), сцена/шрифт/живой фон (этап 1).
- Граф (этап 5): `nodes = toLayoutNodes(useAllItems())`, `fixed = usePositions()`,
  `layout = computeLayout(nodes, categories.map(c => c.id), fixed)`; если `layout.placed` не пуст — сохранить их
  `setPositions` (один раз на изменение, с задержкой); бросок ноды — `findFreeSpot` → `setPositions({ [id]: p })`;
  «Разложить» — `prev = await clearPositions()` → пересчёт → toast «Отменить» → `setPositions(prev)`; камера —
  `useGraph`; отбор — `searchItems(itemsWithTrash, query, categories, { within: графовые записи })`.
- Этап 8: кнопка «Распознать» → `extractItemText(item, { vision: true, force: true })`; результат `failed` показать toast.

---

## 6. Точки интеграции для основной сессии и открытые вопросы

Правки вне владения агентов (делает основная сессия после волны 2):

1. `package.json`: `pdfjs-dist@6.5.438` (до волны 1).
2. `vite.config.ts`, `workbox.globPatterns`: добавить `mjs` (worker PDF в офлайн-кэше PWA). CSP менять не нужно:
   worker — файл своего origin (`worker-src 'self'` в вебе, `default-src 'self'` в Tauri), `eval` выключен.
   (уточнено при сверке) Проверено: Tauri отдаёт `.mjs` как `text/javascript` (`tauri-utils` 2.10.2, `mime_type.rs`),
   модульный worker загрузится. После `npm run build` убедиться, что `pdf.worker.min-*.mjs` попал в precache:
   workbox молча пропускает файлы больше 2 МиБ — если worker больше, добавить в `workbox`
   `maximumFileSizeToCacheInBytes: 4 * 1024 * 1024`.
3. `src/main.tsx`: `startTrashCleanup()` и отложенный (`requestIdleCallback` или таймер 10 с) `void backfillPdfText()`.
4. `CLAUDE.md`: после этапа — дописать контракты из раздела 2 и структуру (новые файлы).
5. Настройки копий, экспорта и этапа 7 уже сведены с `.progress/spec-tauri.md` (п. 1.9, 2.9): шаг 0 этой
   спецификации закрывает предусловие агента `tauri-backup` и пункт «основная сессия (до запуска)» этапа 7 по
   `types.ts`. (уточнено при сверке) Имена сведены с `.progress/spec-stage1.md`: типы `ScenePref` / `FontPref`, списки
   `SCENE_PREFS` / `FONT_PREFS` (п. 1.1, 1.5 исправлены); `types.ts` и `db/settings.ts` этап 1 не правит.
6. Расхождение с `spec-tauri.md` (п. 2.11): там `ITEM_SOURCES` правится в `exportImport.ts` перед этапом 7 — здесь
   список перенесён в `types.ts` на шаге 0, а `exportImport.ts` берёт его оттуда (агент `data-backup`). Повторять не нужно.
7. `markdownExport.buildMarkdownExport` отдаёт документы, структурно совместимые с `ExportDoc` из `exportDir.ts`
   (`path`, `markdown`, `attachments[].path/fileId`) — согласующая обёртка не нужна.
8. Автокопия (`autoBackup.ts`, spec-tauri) должна пропускать пустую базу — иначе после «Удалить все данные» пустые
   копии вытеснят рабочие. (уточнено при сверке) Правило внесено в `spec-tauri.md` п. 1.7: зависимость
   `countItems()`, причина пропуска `'empty'`.

Вопросы к пользователю (везде указан вариант по умолчанию, работы не блокируют):

1. `date:week` / `month` — скользящие 7 / 30 дней (по умолчанию) или календарные неделя / месяц?
2. После смены категории нода графа переезжает в зону новой категории, даже если её двигали вручную (по умолчанию — да).
3. Архив на графе не показывается (по умолчанию), место ноды за ним сохраняется.
4. Дубль ссылки: записи в корзине не считаются, архивные — считаются; `http` и `https` — один адрес (по умолчанию).
5. Экспорт в Markdown — одна папка без подпапок по категориям, вложения в `attachments/` (по умолчанию).
6. Распознанный текст попадает в экспорт Markdown отдельным разделом (по умолчанию — да).
7. Пределы PDF: 200 страниц, 200 тыс. символов, файл до 50 МБ, 30 с на файл (по умолчанию).
