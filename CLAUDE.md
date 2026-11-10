# QuickDrop

Универсальный накопитель информации: одно место, куда мгновенно сбрасывается текст, ссылка, код,
идея, файл или изображение. Структура не придумывается заранее — запись падает во «Входящие»,
потом разбирается (категория, теги, связи, избранное) и переносится в базу знаний.

Интерфейс и все пользовательские тексты — на русском. Desktop-first, но обязан работать на iPhone (PWA).

## Возобновление работы (обязательно при старте сессии)

1. Прочитать этот файл, `PROGRESS.md` и всю папку `.progress/` (сначала `HANDOFF.md`).
2. Свериться с `git log --oneline` и `git status`.
3. Продолжить с незавершённого места. Готовое не переделывать.

Фиксация прогресса:
- `.progress/HANDOFF.md` — состояние основной сессии; обновлять после каждого значимого шага.
- `.progress/agents/<имя-задачи>.md` — каждый субагент ведёт свой файл: задача, статус
  (`в работе` / `готово` / `ошибка`), результат, изменённые файлы. Создать файл в начале работы,
  обновить в конце.
- Папку `.progress` не удалять до завершения проекта.
- Коммитит только основная сессия после ревью этапа. Субагенты не коммитят и не трогают git.

## Стек

React 19 + TypeScript 7 + Vite 8 · Tailwind v4 + shadcn/ui (стиль base-nova, на Base UI, **не Radix**) ·
Dexie 4 (IndexedDB) + dexie-react-hooks · MiniSearch · Zustand · lucide-react · sonner ·
Vitest + fake-indexeddb · Tauri 2 (Windows/macOS) · vite-plugin-pwa (веб/iPhone).

Команды: `npm run dev` · `npm run typecheck` · `npm test` · `npm run build` · `npm run tauri dev|build`.

Ограничения tsconfig: `verbatimModuleSyntax` (типы импортировать через `import type`),
`erasableSyntaxOnly` (без enum, namespace, parameter properties), `noUnusedLocals/Parameters`.
Алиас `@/` → `src/`. `cn` импортировать из `@/lib/utils`. Компоненты shadcn лежат в `src/components/ui` — новые добавлять через
`npx shadcn@latest add <name> -y`, существующие не переписывать.

## Структура

```
src/
  types.ts            доменная модель (источник истины)
  db/db.ts            схема Dexie
  db/repo.ts          все записи в БД идут только через репозиторий
  db/seed.ts          демоданные
  db/settings.ts      настройки (таблица meta)
  search/             MiniSearch: индекс, разбор запроса, подсветка
  lib/detect.ts       определение типа записи по вводу
  lib/linkMeta.ts     заголовок/описание по ссылке
  lib/exportImport.ts резервная копия JSON
  lib/ai.ts           необязательная LLM-интеграция
  lib/platform.ts     isTauri / isMac
  lib/itemTitle.ts    производный заголовок, форматирование
  store/ui.ts         состояние интерфейса (zustand)
  hooks/              useItems, useHotkeys и т.п.
  components/ui/      shadcn
  components/layout/  AppShell, Sidebar, TopBar, MobileNav
  components/capture/ QuickCapture
  components/items/   ItemCard, ItemList, ItemDetail, TagInput, ...
  views/              InboxView, LibraryView, FavoritesView, ArchiveView, SettingsView
src-tauri/            оболочка Tauri 2
```

## Модель данных

См. `src/types.ts` и `src/db/db.ts`. Ключевое:
- `Item.status`: `inbox` → `library` (обработано) ; `archive` — убрано, `prevStatus` хранит откуда.
- `Item.favorite` — `0 | 1` (IndexedDB не индексирует boolean).
- `Item.tags` — нижний регистр, без `#`, без дублей. Отдельной таблицы тегов нет: теги выводятся из записей.
- `Item.links` — двунаправленные связи, целостность держит репозиторий.
- Бинарники — в таблице `files` (`blob` + `thumb` для изображений), запись ссылается через `fileId`.
- Настройки — таблица `meta` (key/value), типы в `Settings`.

## Контракты модулей

Сигнатуры ниже обязательны: UI и логика пишутся параллельно разными агентами и должны сойтись.
Добавлять экспорты можно, менять перечисленные — нельзя.

### `src/db/repo.ts`
```ts
createItem(input: NewItemInput): Promise<Item>            // генерит id/даты, нормализует теги, сохраняет файл+thumb
updateItem(id: string, patch: ItemPatch): Promise<void>   // обновляет updatedAt
deleteItem(id: string): Promise<void>                     // каскад: files + убрать id из links других записей
restoreItem(snapshot: DeletedSnapshot): Promise<void>     // отмена удаления
getItem(id: string): Promise<Item | undefined>
setStatus(ids: string | string[], status: ItemStatus): Promise<void> // ведёт prevStatus/processedAt
unarchive(ids: string | string[]): Promise<void>          // вернуть в prevStatus (по умолчанию library)
toggleFavorite(id: string): Promise<void>
setCategory(ids: string | string[], categoryId: string | null): Promise<void>
addTags(ids: string | string[], tags: string[]): Promise<void>
removeTag(ids: string | string[], tag: string): Promise<void>
renameTag(from: string, to: string): Promise<void>        // по всей базе, со слиянием
deleteTag(tag: string): Promise<void>
linkItems(a: string, b: string): Promise<void>            // двунаправленно, без самоссылок
unlinkItems(a: string, b: string): Promise<void>
getFile(fileId: string): Promise<StoredFile | undefined>
listCategories(): Promise<Category[]>                     // по order
createCategory(name: string, color?: CategoryColor): Promise<Category>
updateCategory(id: string, patch: Partial<Pick<Category, 'name' | 'color' | 'order'>>): Promise<void>
deleteCategory(id: string): Promise<void>                 // записи получают categoryId = null
normalizeTag(raw: string): string                         // trim, lower, без '#', пробелы → '-'
matchesFilter(item: Item, filter: ItemFilter): boolean    // чистая функция
sortItems(items: Item[], sort: SortMode): Item[]          // чистая, не мутирует
type DeletedSnapshot = { item: Item; file?: StoredFile; linkedIds: string[] }
deleteItem возвращает Promise<DeletedSnapshot> — см. реализацию; UI показывает toast «Отменить».
```
(Уточнение: `deleteItem` возвращает `Promise<DeletedSnapshot>`.)

### `src/db/settings.ts`
```ts
getSettings(): Promise<Settings>                          // DEFAULT_SETTINGS + сохранённое
setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>
useSettings(): Settings | undefined                       // live-хук
```

### `src/db/seed.ts`
```ts
seedDemoData(force?: boolean): Promise<boolean>           // true, если засеяно; уважает settings.seeded
clearAllData(): Promise<void>
```

### `src/search/index.ts`
```ts
parseQuery(raw: string): ParsedQuery   // { text, filter: ItemFilter } ; операторы: tag:x #x type:link is:fav is:inbox|library|archive cat:имя has:file
searchItems(items: Item[], raw: string, categories?: Category[]): SearchHit[] // пустой text → все items, score 0
type SearchHit = { item: Item; score: number; terms: string[] }
highlight(text: string, terms: string[]): Array<{ text: string; hit: boolean }>
makeSnippet(item: Item, terms: string[], maxLen?: number): string
```
Индекс кэшируется внутри модуля и пересобирается инкрементально при изменении набора записей.
Поиск: префиксный + нечёткий, регистронезависимый, `ё`=`е`, по полям title/content/url/tags/fileName/linkMeta/категория.

### `src/lib/detect.ts`
```ts
detectInput(raw: string): { type: ItemType; url?: string; language?: string; title?: string }
isUrl(s: string): boolean
normalizeUrl(s: string): string
detectFileType(file: { type: string; name: string }): 'image' | 'file'
```

### `src/lib/linkMeta.ts`
```ts
fetchLinkMeta(url: string, opts?: { proxyUrl?: string; signal?: AbortSignal }): Promise<LinkMeta>
titleFromUrl(url: string): string                         // запасной заголовок из домена/пути
parseHtmlMeta(html: string, baseUrl: string): Omit<LinkMeta, 'status'>
```
В Tauri — через команду Rust `fetch_link_meta` (`invoke`), в вебе — прямой fetch, затем необязательный прокси,
иначе `status: 'failed'` (UI использует `titleFromUrl`). Никогда не бросает.

### `src/lib/exportImport.ts`
```ts
exportBackup(): Promise<Blob>                             // JSON, бинарники в base64, с version
importBackup(file: Blob, mode: 'merge' | 'replace'): Promise<ImportReport>
type ImportReport = { items: number; files: number; categories: number; skipped: number }
```

### `src/lib/ai.ts` (необязательная часть)
```ts
suggestForItem(item: Item, settings: Settings, signal?: AbortSignal): Promise<AiMeta> // OpenAI-совместимый /chat/completions
```

### `src/lib/itemTitle.ts`
```ts
displayTitle(item: Item): string        // title || linkMeta.title || fileName || первая строка content || 'Без названия'
formatRelative(ts: number): string      // «только что», «5 мин назад», «вчера», дата
formatBytes(n: number): string
TYPE_LABEL: Record<ItemType, string>    // Текст, Ссылка, Код, Идея, Файл, Изображение
```

### `src/store/ui.ts`
Уже написан — читать файл. `useUi` — единственное состояние интерфейса.

### `src/hooks/useItems.ts`
```ts
useAllItems(): Item[] | undefined                         // liveQuery всех записей
useVisibleItems(base: ItemFilter): { hits: SearchHit[]; total: number; loading: boolean }
  // base (от раздела) + useUi.filter + useUi.query + useUi.sort
useCategories(): Category[]
useAllTags(): Array<{ tag: string; count: number }>
useCounts(): { inbox: number; library: number; favorites: number; archive: number }
useFileUrl(fileId: string | undefined, kind?: 'thumb' | 'full'): string | undefined // objectURL с отзывом
```

## Горячие клавиши (внутри открытого приложения)

- `Ctrl/⌘+Shift+Space` или `Alt+N` (и `N` вне полей ввода) — быстрое добавление.
- `Ctrl/⌘+K` или `/` — поиск. `Esc` — закрыть панель/детали.
- `Ctrl/⌘+V` вне полей ввода — открыть добавление с содержимым буфера (текст или картинка).
- Перетаскивание файлов в окно — добавление файлов.
- В списке: `J/K` — вверх/вниз, `E` — в базу знаний, `A` — архив, `F` — избранное, `Enter` — открыть, `Del` — удалить.
- В Tauri `Ctrl/⌘+Shift+Space` — глобальная: поднимает окно и открывает добавление.

## Правила кода

- Запись в БД — только через `db/repo.ts` (исключения: seed, импорт, settings).
- Чтение в React — через `useLiveQuery`/хуки из `hooks/useItems.ts`.
- Никаких сетевых запросов, кроме извлечения метаданных ссылки и явно включённого AI.
- Комментарии — по-русски и только там, где неочевидно «почему».
- Перед сдачей работы: `npm run typecheck` и `npm test` должны проходить.
