# QuickDrop

Универсальный накопитель информации: одно место, куда мгновенно сбрасывается текст, ссылка, код,
идея, файл или изображение. Структура не придумывается заранее — запись падает во «Входящие»,
потом разбирается (категория, теги, связи, избранное) и переносится в базу знаний.

Интерфейс и все пользовательские тексты — на русском. Desktop-first (основная платформа — Windows), но обязан работать на iPhone (PWA).

## Возобновление работы (обязательно при старте сессии)

1. Прочитать этот файл, `PROGRESS.md` и всю папку `.progress/` (сначала `HANDOFF.md`, затем `plan-combined.md`
   и нужные `spec-stage*.md`; `spec-tauri.md` — про оболочку).
2. Свериться с `git log --oneline` и `git status`.
3. Продолжить с незавершённого места. Готовое не переделывать.

Фиксация прогресса:
- `.progress/HANDOFF.md` — состояние основной сессии; обновлять после каждого значимого шага.
- `.progress/agents/<имя-задачи>.md` — каждый субагент ведёт свой файл: задача, статус
  (`в работе` / `готово` / `ошибка`), результат, изменённые файлы. Создать файл в начале работы,
  обновить в конце.
- `.progress/spec-stage<N>.md` — спецификации этапов; при расхождении с кодом истина — код и этот файл.
  Отставшие от кода спецификации перечислены в `HANDOFF.md`, их не правят.
- `.progress/*-result.json`, `review*-findings.json`, `review*-fixes.json` — итоги этапов и ревью.
- Папку `.progress` не удалять до завершения проекта.
- Коммитит только основная сессия после ревью этапа. Субагенты не коммитят и не трогают git.
- Этот файл меняется только с личного подтверждения пользователя; предложения по правке — в `.progress/CLAUDE.proposed.md`.

## Стек

React 19 + TypeScript 7 + Vite 8 · Tailwind v4 + shadcn/ui (стиль base-nova, на Base UI, **не Radix**) ·
Dexie 4 (IndexedDB) + dexie-react-hooks · MiniSearch · Zustand · react-markdown + remark-gfm · pdfjs-dist (текст и
страницы PDF) · lucide-react (только внутри `components/icons` и `ui/*`, см. «Дизайн») · sonner · cmdk ·
шрифты `@fontsource*` (Geist, Nunito, Handjet, Tiny5) ·
Vitest + fake-indexeddb · oxlint · Tauri 2 (Windows — основная, macOS собирается; Rust: reqwest, tauri-plugin-dialog,
global-shortcut, single-instance, opener, auto-launch, dunce) · vite-plugin-pwa (веб/iPhone).

Команды: `npm run dev` · `npm run typecheck` · `npm test` · `npm run lint` · `npm run build` ·
`npm run tauri dev|build` · `npm run icons` · `cargo test --manifest-path src-tauri/Cargo.toml` ·
`node scripts/check-version.mjs [vX.Y.Z]`.

Ограничения tsconfig: `verbatimModuleSyntax` (типы импортировать через `import type`),
`erasableSyntaxOnly` (без enum, namespace, parameter properties), `noUnusedLocals/Parameters`,
`noFallthroughCasesInSwitch`. Алиас `@/` → `src/`. `cn` импортировать из `@/lib/utils`. Компоненты shadcn лежат в
`src/components/ui` — новые добавлять через `npx shadcn@latest add <name> -y`, существующие не переписывать
(допустима только замена значка lucide на `Icon`).

Тесты: Vitest в среде `node` (файлы `src/**/*.test.ts`, setup — `src/test/setup.ts`), DOM нет. Поэтому логику
экранов выносят в чистые модули и проверяют их; компоненты в тестах не монтируются.

## Структура

```
src/
  main.tsx, App.tsx            точка входа главного окна; capture-main.tsx — мини-окна (capture.html, только Tauri)
  pwa.ts                       PWA: регистрация SW, ярлык «Быстрая запись», share_target
  types.ts                     доменная модель (источник истины)
  index.css                    токены «Классики» и Tailwind-тема
  styles/                      scenes.css (палитры сцен), pixel.css (примитивы px-*), fonts.css, markdown.css,
                               capture-window.css
  db/                          db.ts (схема Dexie), repo.ts (все записи), seed.ts, settings.ts
  search/                      index.ts (публичный вход), engine.ts (MiniSearch), query.ts (разбор запроса),
                               serialize.ts (фильтр → строка), highlight.ts, filter.ts, normalize.ts
  store/                       ui.ts, graph.ts, selection.ts, confirm.ts (zustand)
  hooks/                       useItems.ts (+ computeVisible.ts), useHotkeys.ts, useOcr.ts, useDebounced.ts, useMediaQuery.ts
  lib/                         чистая логика и сервисы (перечень — в «Контрактах»); подкаталоги:
    graph/                     граф: геометрия, рисование, подписи, отбор, тема, жесты, контракт слоя фона (ambient.ts)
    ambient/                   живой фон графа: мир, плитки, спрайты, эффекты, планировщик, контроллер
    pixelfx/                   производные от pixelfx (MIT) + LICENSE и README
  components/
    ui/                        shadcn (base-nova)
    icons/                     Icon (единственный способ показать значок), PixelIcon, реестр, names.ts, gallery
    layout/                    AppShell, Sidebar, TopBar, MobileNav, NavButton, SavedSearches, ThemeProvider, ConfirmHost, ErrorBoundary
    capture/                   QuickCapture (панель), CaptureForm (общая форма), CaptureWindowApp (мини-окно)
    items/                     ItemList, ItemCard, ItemDetail, FilterBar, BulkBar, TriageMode, ItemMenu, TagInput,
                               CategorySelect, FilePreview, CodeView, safeFileUrl.ts и др.
    items/detail/              части панели деталей: ItemContent, ContentEditor, LinkCard, FileBlock, OcrBlock (+ ocrView.ts),
                               LinkedItems, LinkPicker, TitleField, AiSuggest, autosave.ts, save.ts
    markdown/                  MarkdownView, MarkdownText, ViewModeToggle
    graph/                     экран графа: GraphCanvas, оверлеи, меню, жесты (useGraphGestures), клавиши (useGraphKeys), useAmbient
    palette/                   CommandPalette
  views/                       InboxView, LibraryView, FavoritesView, ArchiveView, TrashView, GraphView (+ ItemsView — общий список),
                               SettingsView и views/settings/* (секции)
  test/                        общие помощники тестов (setup.ts, sceneVars.ts)
src-tauri/                     оболочка Tauri 2 (Cargo.toml, tauri.conf.json, build.rs, icons/, app-icon.svg)
  src/lib.rs, main.rs          сборка приложения, окно main, fetch_link_meta, скачивания (macOS)
  src/shell.rs                 мини-окно, трей, закрытие в трей, второй запуск, автозапуск, extension_dir
  src/backup.rs                автокопии и экспорт в папку (подтверждённые папки)
  src/ext_server.rs            локальный HTTP-приём от расширения Chrome
  capabilities/default.json    права главного окна;  capabilities/capture.json — права мини-окна
extension/                     расширение Chrome (MV3, без сборки), README.md
capture.html                   страница мини-окна; index.html — главного
scripts/                       check-version.mjs, gen-icons.mjs (PWA: public/pwa-*.png, apple-touch-icon.png), gen-extension-icons.mjs
public/                        иконки PWA, theme-init.js (ранняя тема), licenses/pixelfx-LICENSE.txt
docs/                          DESIGN.md (правила дизайна, нормативно), ИНСТРУКЦИЯ.md (для пользователя)
mockup/                        справочный образец пиксельного вида (в сборку не входит, не править)
.github/workflows/             ci.yml (проверки на push и PR), release.yml (релиз установщиков по тегу)
.progress/                     журнал работы (см. «Возобновление работы»)
```

## Модель данных

См. `src/types.ts` и `src/db/db.ts`. Схема Dexie — версия 2 (версии только добавляются, существующие не правятся).
Таблицы: `items`, `files`, `categories`, `meta`, `positions`, `searches`.

- `Item.status`: `inbox` → `library` (обработано) ; `archive` — убрано, `prevStatus` хранит откуда.
- **Корзина.** `Item.deletedAt?: number` — запись в корзине (индекс `deletedAt`; у записи вне корзины поля нет).
  Удаление ничего больше не меняет: `status`, `links`, файл, положение на графе, `updatedAt` остаются, запись из
  корзины возвращается байт-в-байт. Окончательное удаление — только `purgeItems`/`emptyTrash`/`purgeExpired`.
  Все списки, поиск, граф, счётчики и экспорт Markdown по умолчанию корзину не видят (`ItemFilter.trashed`).
- `Item.favorite` — `0 | 1` (IndexedDB не индексирует boolean).
- `Item.tags` — нижний регистр, без `#`, без дублей. Отдельной таблицы тегов нет: теги выводятся из записей.
- `Item.links` — двунаправленные связи, целостность держит репозиторий.
- `Item.source`: `manual | paste | drop | import | demo | extension | share`.
- Бинарники — в таблице `files` (`blob` + `thumb` для изображений), запись ссылается через `fileId`.
- **Распознанный текст.** `Item.ocrText` — текст вложения (слой PDF или распознанный моделью со зрением), участвует
  в поиске и сниппетах, в экспорте Markdown («Распознанный текст») и в резервной копии. `Item.ocrAt` — когда текст
  извлекали в последний раз, в т.ч. безрезультатно (`ocrAt` есть, `ocrText` нет). `Item.ocrVisionAt` — когда
  вложение в последний раз пробовали распознать моделью со зрением (успех, «текста нет» или неустранимая ошибка);
  поля нет — не пробовали. `Item.ocrClearedAt` — текст убрал пользователь: PDF с этой отметкой и без `ocrVisionAt`
  не считается сканом и не уходит в ИИ; ставит только `repo.clearOcrText`, снимают `setOcrText` и `setVisionText`.
  `Item.ocrAutoSkipAt` — автораспознавание запись не берёт (отмена задачи пользователем или импорт копии); ручное
  «Распознать» работает; ставит только `repo.markVisionAutoSkip`; это решение этого устройства, поэтому в копию не
  идёт и из неё не читается. Все пять — вне `ItemPatch`, пишут только `repo.setOcrText`, `repo.setVisionText`,
  `repo.markVisionTried`, `repo.clearOcrText`, `repo.markVisionAutoSkip`; `updatedAt` не меняется. Предел текста — `MAX_OCR_TEXT` (200 000 знаков, `cleanOcrText`).
- `positions` — сохранённые положения нод графа (`NodePosition`: `id` записи, `x`, `y`, мировые координаты).
- `searches` — сохранённые поиски (`SavedSearch`: `id`, `name`, `query`, `order`, `createdAt`). Запрос — строка с
  операторами (`search.serializeFilter`/`composeQuery`).
- Настройки — таблица `meta` (key/value), типы в `Settings`, умолчания — `DEFAULT_SETTINGS`, проверка значений —
  `lib/settingsSchema.ts`. Группы:
  - оформление: `theme`, `scene` (`auto|meadow|autumn|paper|winter|classic`), `font` (`round|plain|soft|pixel`), `ambient`;
  - ссылки: `autoFetchLinkTitle`, `linkProxyUrl`;
  - ИИ: `aiEnabled`, `aiBaseUrl`, `aiApiKey`, `aiModel`; распознавание: `aiVisionModel`, `aiAutoOcr`, `aiAutoOcrSince`;
  - корзина: `trashDays` (0 — не очищать); копии: `backupDir`, `backupEvery`, `backupKeep`, `backupLastAt`, `mdExportDir`;
  - оболочка (Tauri): `globalShortcut`, `closeToTray`, `captureWindow`, `extEnabled`, `extPort`, `extToken`;
  - служебное: `seeded`.
  Не попадают в резервную копию и не импортируются (`PRIVATE_SETTINGS`): `aiApiKey`, `seeded`, `aiEnabled`,
  `aiBaseUrl`, `aiModel`, `aiVisionModel`, `aiAutoOcr`, `aiAutoOcrSince`, `linkProxyUrl`, `autoFetchLinkTitle`,
  `backupDir`, `backupLastAt`, `backupEvery`, `backupKeep`, `mdExportDir`, `extEnabled`, `extPort`, `extToken`.
  «Удалить все данные» стирает вместе с записями (`CLEARED_SETTINGS`): ключ, адрес и модели ИИ, `aiEnabled`,
  `aiAutoOcr`, `aiAutoOcrSince`, `linkProxyUrl`, `extEnabled`, `extToken`; `backupLastAt` не сбрасывается.
- Формат резервной копии — JSON, `BACKUP_VERSION = 2` (читаются версии 1–2): настройки (кроме закрытых), категории,
  записи (`deletedAt`, `ocrText`, `ocrAt`, `ocrVisionAt`, `ocrClearedAt`; `ocrAutoSkipAt` не выгружается), `positions`, `searches`, файлы в base64.

## Контракты модулей

Сигнатуры обязательны: UI и логика пишутся параллельно разными агентами и должны сойтись.
Добавлять экспорты можно, менять существующие — нельзя. Перечень ниже — по экспортам кода; полный — в самих файлах.

### `src/db/repo.ts`
```ts
// записи
createItem(input: NewItemInput): Promise<Item>            // id/даты, нормализация тегов, файл+thumb; бросает Error по-русски (url, файл > 100 МБ)
updateItem(id: string, patch: ItemPatch): Promise<void>   // обновляет updatedAt
applyLinkMeta(id: string, url: string, meta: LinkMeta): Promise<boolean>
getItem(id: string): Promise<Item | undefined>
getFile(fileId: string): Promise<StoredFile | undefined>
listLiveItems(): Promise<Item[]>                          // вне корзины, прямое чтение (мини-окно)
findDuplicateLink(url: string, excludeId?: string): Promise<Item | undefined>   // правила — lib/dedupe, без корзины
// корзина
deleteItem(id: string): Promise<DeletedSnapshot>          // В КОРЗИНУ (deletedAt), не окончательно
deleteItems(ids: string[]): Promise<DeletedSnapshot[]>
restoreFromTrash(ids: string | string[]): Promise<void>
restoreItem(snapshot: DeletedSnapshot): Promise<void>     // отмена: из корзины или воссоздание из снимка, если запись уже удалена окончательно
restoreItems(snapshots: DeletedSnapshot[]): Promise<void>
purgeItems(ids: string | string[]): Promise<number>       // окончательно: файлы, положения, ссылки у соседей (updatedAt соседей не меняется)
emptyTrash(): Promise<number>
purgeExpired(days: number, now?: number): Promise<number> // автоочистка; days <= 0 — выкл.
// статусы, избранное, категории, теги, связи
setStatus(ids: string | string[], status: ItemStatus): Promise<void> // ведёт prevStatus/processedAt
unarchive(ids: string | string[]): Promise<void>          // вернуть в prevStatus (по умолчанию library)
toggleFavorite(id: string): Promise<void>
setFavorite(ids: string | string[], favorite: boolean): Promise<void>
setCategory(ids: string | string[], categoryId: string | null): Promise<void>
addTags(ids: string | string[], tags: string[]): Promise<void>
removeTag(ids: string | string[], tag: string): Promise<void>
renameTag(from: string, to: string): Promise<void>        // по всей базе, со слиянием
deleteTag(tag: string): Promise<void>
linkItems(a: string, b: string): Promise<void>            // двунаправленно, без самоссылок
unlinkItems(a: string, b: string): Promise<void>
listCategories(): Promise<Category[]>                     // по order
createCategory(name: string, color?: CategoryColor): Promise<Category>
updateCategory(id: string, patch: Partial<Pick<Category, 'name' | 'color' | 'order'>>): Promise<void>   // бросает на имя-дубль
deleteCategory(id: string): Promise<void>                 // записи получают categoryId = null
// граф и сохранённые поиски
setPositions(map) / addPositions(...) / getPositions() / removePositions(ids) / clearPositions()
listSavedSearches() / createSavedSearch(name, query) / updateSavedSearch(...) / deleteSavedSearch(id)
reorderSavedSearches(ids) / restoreSavedSearch(search)
// распознанный текст (updatedAt не меняется)
setOcrText(id: string, text: string, at?: number): Promise<boolean>     // текст слоя PDF и правка; снимает ocrClearedAt; ocrVisionAt остаётся. Очистка — только clearOcrText, не setOcrText('')
clearOcrText(id: string, at?: number): Promise<boolean>                 // очистка пользователем: ocrText удалён, ocrAt = ocrClearedAt
markVisionAutoSkip(id: string, at?: number): Promise<boolean>           // ocrAutoSkipAt: авто запись не берёт
setVisionText(id: string, text: string, at?: number): Promise<boolean>  // итог зрения: ocrText (пусто — поле удалено), ocrAt = ocrVisionAt
markVisionTried(id: string, at?: number): Promise<boolean>              // неустранимая ошибка зрения: только ocrVisionAt
// чистые
normalizeTag(raw: string): string                         // trim, lower, без '#', пробелы → '-' (реэкспорт lib/normalize; есть и normalizeTags)
matchesFilter(item: Item, filter: ItemFilter): boolean    // реэкспорт lib/filter
sortItems(items: Item[], sort: SortMode): Item[]          // не мутирует
type DeletedSnapshot = { item: Item; file?: StoredFile; linkedIds: string[] }
```
`false` у `set*Text`/`markVision*`/`clearOcrText` — записи нет; запись в корзине обновляется как обычная.
Остальное: `THUMB_MAX`, `MAX_FILE_SIZE`, `makeThumb`.

### `src/db/settings.ts`, `src/db/seed.ts`
```ts
getSettings(): Promise<Settings>                          // DEFAULT_SETTINGS + сохранённое (значения проверяются isValidSetting)
setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>
setSettings(patch: Partial<Settings>): Promise<void>      // пакетно; сдвигает aiAutoOcrSince на текущий момент, когда авто снова начинает действовать (ИИ включили, вернули ключ или модель) или меняется хост; явно переданный aiAutoOcrSince не трогает
useSettings(): Settings | undefined                       // live-хук
mergeSettings(records: readonly MetaRecord[]): Settings
seedDemoData(force?: boolean): Promise<boolean>           // true, если засеяно; уважает settings.seeded
clearAllData(): Promise<void>
```

### `src/search/index.ts`
```ts
parseQuery(raw: string, now?: number): ParsedQuery   // { text, phrases, filter: ItemFilter, categoryName? }
searchItems(items: readonly Item[], raw: string, categories?: Category[], options?: SearchOptions): SearchHit[]
  // пустой text → все записи, прошедшие фильтр, score 0. options: within (поиск среди подмножества без перестройки
  // индекса), trash (false | true | 'any'), now. items — ВСЕ записи, включая корзину: с ними синхронизируется индекс.
type SearchHit = { item: Item; score: number; terms: string[] }
highlight(text: string, terms: string[]): Array<{ text: string; hit: boolean }>
makeSnippet(item: Item, terms: string[], maxLen?: number): string   // заголовок, текст, затем распознанный текст
serializeFilter(filter: ItemFilter, categories, now?, options?): string      // фильтр → строка операторов (обратна parseQuery)
composeQuery(query: string, filter: ItemFilter, categories, now?, options?): string   // фильтр + строка поиска для сохранённого поиска
renameQueryOperators(raw: string, rename: QueryRename): string               // переписывает tag:/#/cat: при переименовании
resolveCategoryName(name, categories) / resolveQueryFilter(parsed, categories) / matchesFilter / matchesFilterIgnoringTrash
prepareSearchIndex / prepareSearchIndexAsync / isSearchIndexReady / resetSearchIndex / getSearchIndexStats
```
Операторы: `tag:x` `#x` `type:link` `is:fav|inbox|library|archive|untagged|trash` `cat:имя` `has:file|image|link`
`date:` `after:` `before:` (даты: `2026-11-13`, `13.11.2026`, `сегодня`, `вчера`, `неделя`, `месяц`, `год`, …) и русские
псевдонимы (`тег`, `тип`, `кат`, `дата`, `после`, `до`, `корзина` и др. — таблицы в `search/query.ts`).
Поиск: префиксный + нечёткий, регистронезависимый, `ё`=`е`, по полям title/content/url/tags/fileName/linkMeta/
категория/`ocrText` (вес 1, сверка по `ocrAt`). Индекс кэшируется в модуле и обновляется инкрементально.

### `src/lib/detect.ts`, `linkMeta.ts`, `dedupe.ts`
```ts
detectInput(raw: string): { type: ItemType; url?: string; language?: string; title?: string }
isUrl(s: string): boolean;  normalizeUrl(s: string): string
detectFileType(file: { type: string; name: string }): 'image' | 'file'
fetchLinkMeta(url: string, opts?: { proxyUrl?: string; signal?: AbortSignal }): Promise<LinkMeta>   // никогда не бросает
titleFromUrl(url: string): string                         // запасной заголовок из домена/пути
parseHtmlMeta(html: string, baseUrl: string): Omit<LinkMeta, 'status'>
linkKey(raw) / sameLink(a, b) / findDuplicateLinkIn(items, url, excludeId?)   // сравнение адресов без шума (www, параметры слежения utm_*, fbclid и др.; youtu.be и m.-поддомены осознанно не склеиваются)
```
В Tauri `fetchLinkMeta` идёт через команду Rust `fetch_link_meta` (`invoke`), в вебе — прямой fetch, затем необязательный
прокси, иначе `status: 'failed'` (UI использует `titleFromUrl`).

### `src/lib/exportImport.ts`, `markdownExport.ts`, `exportDir.ts`, `autoBackup.ts`, `dataDesktop.ts`
```ts
exportBackup(options?: ExportOptions): Promise<Blob>      // JSON с version, бинарники в base64; бросает, если копия > 480 МБ
importBackup(file: Blob, mode: 'merge' | 'replace'): Promise<ImportReport>
type ImportReport = { items; files; categories; skipped; positions; searches; trashed: number }
sanitizeSettings(raw) / sanitizeItem(raw, now?)           // чистка чужой копии; PRIVATE_SETTINGS — что не переносится
blobToBase64(blob) / base64ToBytes(b64) / backupFileName(date?)
planMarkdownExport(items) / buildMarkdownExport(items, categories): MdExportEntry[] / itemToMarkdown(...) / safeFileName(raw)
exportMarkdownToDir(...) / exportDocsToDir(...) / exportReportSummary(report)   // экспорт в папку с прогрессом и отменой
createAutoBackup(deps) / initAutoBackup() / runBackupNow() / checkAutoBackup() / autoBackupStatus() / subscribeAutoBackup(cb)
clearAllDataAndStopExtension() / applyImportedShellSettings()   // lib/dataDesktop: «Удалить все данные» и импорт с учётом оболочки
```
При слиянии копий записи корзины из копии живут не меньше `IMPORTED_TRASH_GRACE_DAYS` (7) суток; свежее распознавание
(`ocrAt`) переносится вместе с `ocrText`, итоговый `ocrVisionAt` — наибольший из двух версий; `ocrClearedAt` переносится вместе
с победившим текстом, `ocrAutoSkipAt` — своя отметка устройства.

### `src/lib/ai.ts` (необязательная часть)
```ts
suggestForItem(item: Item, settings: Settings, signal?: AbortSignal): Promise<AiMeta>   // OpenAI-совместимый POST {base}/chat/completions
aiBaseUrlError(raw: string): string | null                // https; http только localhost/127.0.0.1/[::1]
parseAiJson / normalizeTags
// распознавание текста на изображении (этап 8)
VISION_TIMEOUT_MS = 120_000
class VisionError extends Error { kind: 'config' | 'item' | 'transient'; status?: number }
visionModelOf(settings): string                           // aiVisionModel, пусто — aiModel
visionAvailability(settings: Settings): string | null     // null — можно; иначе причина по-русски
aiHostLabel(baseUrl: string): string                      // хост для текста «изображение будет отправлено на …»
cleanVisionAnswer(raw: string): string                    // снимает ограду ```, NO_TEXT → ''
recognizeImage(image: Blob, settings: Settings, signal?: AbortSignal): Promise<VisionReply>   // { text, truncated, model }
```
`recognizeImage` — **единственная функция приложения, отправляющая изображение**: проверка `visionAvailability` идёт
первой, до чтения изображения и до сети; принимает только JPEG/PNG до 4 МБ; один запрос = одно изображение; без
`response_format`/`max_tokens`; один повтор без `temperature` при 400 про него; время — общий предел 120 с.
Виды ошибок: `config` (ключ, модель без зрения, адрес) — авто останавливается; `item` (413, `content_filter`,
непригодное изображение) — запись помечается `ocrVisionAt`; `transient` (сеть, 429, 5xx, время) — отметки нет.
Распознанный текст — данные: в запросы `suggestForItem` он не добавляется. Ключ в тексты ошибок не попадает.

### `src/lib/ocr.ts`, `ocrState.ts`, `visionImage.ts`, `pdfText.ts`, `pdfEngine.ts`, `pdfRender.ts` (этап 8)
```ts
// ocrState.ts — правила, пределы и состояние сеанса (без React и сети)
VISION_MAX_SIDE = 2000; VISION_MIN_SIDE = 24; VISION_MAX_SOURCE_BYTES = 30 МБ; VISION_MAX_IMAGE_BYTES = 4 МБ;
VISION_PDF_MAX_PAGES = 5; VISION_JPEG_QUALITY = 0.85; VISION_AUTO_INTERVAL_MS = 3000; VISION_AUTO_SESSION_LIMIT = 100;
VISION_AUTO_FAIL_STREAK = 3; VISION_AUTO_COOLDOWN_MS = 10 мин; VISION_RATE_PAUSE_MS = 60 с;
VISION_BACKLOG_BATCH = 20; VISION_BACKLOG_MIN_GAP_MS = 60 с; OCR_VIEW_CHARS = 20_000; OCR_EDIT_MAX = 50_000
ocrKindOf(item): 'image' | 'pdf' | null;  isScanPdf(item);  needsVision(item);  isVisionBacklog(item, since)   // since + без ocrAutoSkipAt
type OcrOutcome = { status: 'ok' | 'empty' | 'failed' | 'skipped'; error?; via?: 'text-layer' | 'vision'; pages?: { read; total }; truncated? }
type OcrJob = { phase: 'queued' | 'running'; manual; page?; pages?; cancel? };  type OcrNote = { status: 'failed' | 'empty'; error?; at }
getOcrJob(id) / setOcrJob(id, job | null) / getOcrNote(id) / setOcrNote(id, note | null) / subscribeOcr(cb) / resetOcrState()

// ocr.ts — исполнение, очередь, автораспознавание
textSourceOf(item): 'pdf' | 'image' | null
extractItemText(item: Item, options?: { vision?: boolean; force?: boolean; signal?: AbortSignal }): Promise<OcrOutcome>   // не бросает
backfillPdfText(limit?) / drainPdfBackfill(pauseMs?)      // текст слоя у PDF, добавленных раньше
drainVisionBacklog(): Promise<number>;  startVisionAuto(): void   // из main.tsx, только главное окно

// visionImage.ts
planVisionSize(width, height, maxSide?): { width; height } | null
planVisionTiles(width, height, maxSide?, overlap?, maxTiles?): ...   // вытянутая картинка — полосы (до 5), каждая — отдельный запрос
prepareVisionImage(blob: Blob, options?: { backend?: RasterBackend }): Promise<PreparedImage>   // 'ok' | 'tiles' | 'too-small' | 'failed'

// pdfText.ts / pdfEngine.ts / pdfRender.ts
extractPdfText(data: Blob, options?: PdfTextOptions): Promise<PdfTextResult>   // 'ok' | 'empty' | 'failed' | 'aborted'; failed + permanent
isPdf(file) ;  PdfDocLike { numPages; pageText(n); pageImage?(n, maxSide): Promise<Blob>; close() }
createPdfEngine(pdfjs, makeWorker?, options?: { wasmUrl?: string }): PdfEngine;  loadPdfEngine(): Promise<PdfEngine>
openPdfPages(data: Blob, options?: { maxPages?; signal?; engine? }): Promise<PdfPagesResult>   // { total, count, page(n), close() }
```
Правила: параллельность зрения 1, ручной запуск идёт вне очереди авто и вне предела; авто не чаще раза в 3 с и не
более 100 запросов за сеанс (страница PDF — запрос); перед КАЖДЫМ запросом заново читаются настройки — выключение ИИ
действует на уже стоящие задачи; авто берёт только записи с `createdAt >= aiAutoOcrSince` и без `ocrAutoSkipAt` (включение настройки не
отправляет в ИИ накопленный архив; «Отменить» у задачи и импорт копии ставят `ocrAutoSkipAt`); запись в корзине не распознаётся; мини-окно зрением не распознаёт (запись
подхватит главное окно); прежний `ocrText` не стирается, пока нет нового результата; PDF-скан — первые 5 страниц по
одной, ошибка на любой странице — ошибка всей задачи, частичный текст не пишется. Декодеры сканов pdf.js (JBIG2, JPX)
подключаются JS-вариантами (`useWasm: false`, `wasmUrl` → `pdfjs/`), файлы кладёт плагин Vite `quickdrop:pdf-decoders`.

### `src/lib/actions.ts` (действия с toast и «Отменить» — единственное место вызова repo из UI для типовых действий)
```ts
createAndEnrich(input: NewItemInput): Promise<Item>       // createItem + фон: linkMeta по настройкам, текст PDF, распознавание при aiEnabled && aiAutoOcr
refreshLinkMeta(item) / isLinkMetaLoading(id)
actToLibrary / actToInbox / actArchive / actUnarchive (ids)           // toast + отмена
actToggleFavorite(item) / actSetCategory(ids, categoryId) / actCopy(item) / copyText(text, message?) / actOpen(item) / openLink(url) / actDownload(item) / actDownloadMarkdown(item) / saveBlob(blob, name)
actDelete(ids)                                            // в корзину, toast «Отменить»
actRestoreFromTrash(ids) / actPurge(ids) / actEmptyTrash() / actPurgeAsk(ids) / actEmptyTrashAsk()   // *Ask — с вопросом (store/confirm)
actSaveSearch(name, query) / actSaveCurrentSearch(name?) / actApplySearch(search) / actDeleteSearch(search) / actRenameSearch(id, name) / actMoveSearch(id, delta)
actApplyWikiLinks(...) / applyWikiLinks(itemId, content, items) / findDuplicateLinkNow(url) / openItemInSection(...)
actMoveNode(id, point) / actLinkItems(a, b) / actUnlinkItems(a, b) / actRelayoutGraph()
actRecognize(item) / actCancelRecognize(id) / actSaveOcrText(id, text) / actClearOcrText(item)     // распознанный текст
```
Ошибки в UI — `toast.error(describeError(e, запасной текст))`.

### Прочие модули `src/lib`
- `normalize.ts`: `foldText`, `normalizeTag(s)`, `normalizeTags`, `tagKey`, `categoryNameKey`, `safeLinkUrl`, `safeImageUrl`,
  `hasForeignScheme`, `safeBlobType`, `safeThumbType`, `settleLinkMeta`, `cleanOcrText`, `MAX_OCR_TEXT`, `sanitizePoint`, `searchNameKey`.
- `filter.ts`: `matchesFilter`, `matchesFilterIgnoringTrash`. `settingsSchema.ts`: `isValidSetting(key, value)`.
- `itemTitle.ts`: `displayTitle(item)` (title || linkMeta.title || fileName || первая строка content без разметки || «Без названия»),
  `formatRelative(ts)`, `formatDayLabel`, `formatDateTime`, `formatBytes(n)`, `TYPE_LABEL`, `TYPE_LABEL_PLURAL`, `derivedTitleLine`.
- `dates.ts`: `startOfDay/endOfDay/addDays`, `relativeRange`, `parseDateToken`, `formatDateToken`, `presetOf`, `DATE_PRESETS`,
  `customDateRange`, `formatDateRange`. `dayGroups.ts`: `groupByDay` (разделители по дням при сортировке по дате).
- `trash.ts`: `TRASH_DAYS_OPTIONS`, `trashDaysLabel`, `trashPurgeAt`, `trashDaysLeft`, `trashLeftLabel`, `trashPurgeNote`
  (календарные дни). `trashCleanup.ts`: `cleanupTrash`, `startTrashCleanup` (раз в 6 ч, первый — через 5 с).
- `savedSearch.ts`: `currentSearchQuery`, `viewForQuery`, `findSavedByQuery`, `isSavedSearchActive`, `suggestSearchName`, `sectionFilter`.
- `queryHints.ts`: `missingQueryTargets(query, filter, categories, knownTags, now?)`, `queryHintText(hints)` — подсказка в пустой
  выдаче («Категории «x» нет…»).
- `markdown.ts`: `remarkWikiLinks`, `remarkSoftBreaks`, `mdUrlTransform`, `openableLinkUrl`, `toggleTaskAt`, `isMarkdownFile`, `MD_RENDER_MAX`.
  `wikiLinks.ts`: `parseWikiLinks`, `findWikiSyntax`, `buildTitleIndex`, `resolveWikiLink`, `wikiLinkTargets`. `plainText.ts`: `stripMarkdown`.
  Просмотр Markdown — без `<img>` и без исполнения HTML (react-markdown, urlTransform).
- `graphLayout.ts`: `computeLayout`, `toLayoutNodes`, `snapToGrid`, `findFreeSpot`, `GRAPH_*` (раскладка зон по категориям).
  `graph/*`: `geometry` (камера, ступени масштаба 12,5–200 %, хит-тест), `draw` (рисование нод и связей), `labels`, `match`
  (приглушение по отбору), `scene` (`buildGraphScene`), `theme` (`readGraphTheme` из CSS-переменных), `interaction`, `types`;
  `graph/ambient.ts` — контракт слоя живого фона (см. ниже).
- `ambient/*` — живой фон: `world` (лес и пруды по координатам, детерминированно), `clearing` (поляны вокруг нод), `tileRender`/`tileStore`
  (плитки с кэшем), `sprites/*` (своя графика сцен), `effects/*` (листопад, лучи, снег, бабочки, светлячки), `scheduler`
  (`ambientMode`: off/static/animated), `engine`, `controller` (`createAmbientController`). Остановка анимации: раздел не «Граф»,
  окно скрыто, `prefers-reduced-motion`, «Живой фон» выкл., сцена «Классика».
  **Контракт слоя** (`lib/graph/ambient.ts`): `setAmbientLayer(layer | null)`, `getAmbientLayer()`, `requestAmbientFrame()`,
  `subscribeAmbient(cb)`; `AmbientLayer.draw({ back, front }, frame)` вызывает хост (`GraphCanvas`) на каждой перерисовке и кадре.
- `scene.ts`: `resolveScene`, `seasonScene`, `isPixelScene`, `sceneClasses`, `SCENE_LABEL`, `FONT_LABEL`, `THEME_COLOR`.
- `desktop.ts` (Tauri; вне Tauri всё ничего не делает или возвращает «Доступно только в настольной версии»): `initDesktop`,
  `applyGlobalShortcut`/`reapplyGlobalShortcut`, `globalShortcutFailure`, `openExternal`, `revealInExplorer`, `getExtensionDir`,
  `pickDirectory({ purpose?, defaultPath? })`, `forgetDirectory`, `retainDirectories`, `reconcileApprovedDirs`, `saveBackupFile`, `pruneBackups`,
  `listBackups`, `writeExportFile`, `applyShellOptions`, `toggleCaptureWindow`, `showMainWindow`, `openInMain`, `quitApp`,
  `getAutostart`/`setAutostart`, `applyExtensionServer`/`stopExtensionServer`/`getExtServerStatus`, `generateExtensionToken`.
  `shellUi.ts` — чистые тексты и проверки секции «Быстрый захват» (`validateExtPort`, `maskToken`, `extStatusText`, `EXTENSION_INSTALL_STEPS`).
  `captureWindow.ts` — мини-окно (скрытие по потере фокуса, `createBlurHider`, `initCaptureWindow`). `ipc.ts` — `invokeChunked`
  (большие тела частями, заголовок `x-qd-args`). `extInbox.ts` — приём от расширения: `startExtInbox`, `drainExtInbox`, `handleExtCapture`;
  `extensionCapture.ts` — разбор сообщения расширения (`parseExtensionMessage`, `extensionMessageToInput`, пределы).
- Прочее: `platform.ts` (`isTauri`, `isCaptureWindow`, `isMac`, `modKey`), `errors.ts` (`describeError`, `isQuotaError`, `readableError`),
  `clipboard.ts` (`pastedFiles`), `swReload.ts` (`createReloadGate`, `isUserBusy`), `id.ts` (`newId` вместо `crypto.randomUUID`: работа по http в
  локальной сети), `keys.ts` (`matchKey` — клавиши по `e.code`), `hotkeyGuards.ts`, `backupUi.ts`, `utils.ts` (`cn`).

### Состояние и хуки
- `store/ui.ts` — `useUi`, единственное состояние интерфейса: `view` (`inbox|library|favorites|archive|graph|trash|settings`),
  `selectedId`, `query`, `appliedQuery/appliedView` (применённый сохранённый поиск), `filter` (`UiFilter` — без статуса, избранного и
  корзины: их задаёт раздел), `customDates`, `sort`, `layout`, `mdPreview`, `captureOpen`/`captureDraft`, `paletteOpen`, `navOpen`
  и действия (`setView`, `setQuery`, `setFilter`, `setDateRange`, `applyQuery`, `openCapture`, …).
- `store/graph.ts` — `useGraph`: камера (сохраняется в localStorage), курсор, режим связи, меню, выбранная связь, архив на графе.
  `store/selection.ts` — `useSelection`: множественный выбор и курсор списка (не путать с `useUi.selectedId`).
  `store/confirm.ts` — `confirmDialog(options): Promise<boolean>` (вместо `window.confirm`, рисует `ConfirmHost`).
- `hooks/useItems.ts`:
```ts
useAllItems(): Item[] | undefined                         // liveQuery записей вне корзины; снимок общий для всех подписчиков
useTrashedItems() / useItemsWithTrash() / useTrashCount()
useVisibleItems(base: ItemFilter): { hits: SearchHit[]; total: number; loading: boolean }   // base (раздел) + useUi.filter/query/sort
useCategories(): Category[];  useAllTags(): Array<{ tag: string; count: number }>
useCounts(): { inbox: number; library: number; favorites: number; archive: number }
usePositions() / useSavedSearches() / useItem(id) / useLinkedItems(item) / useLegendCounts(inGraph, showArchive) / useDayKey()
useFileUrl(fileId: string | undefined, kind?: 'thumb' | 'full'): string | undefined   // objectURL с отзывом
```
  `hooks/useOcr.ts` — `useOcrJob(id)`, `useOcrNote(id)`; `useHotkeys()` — глобальные клавиши, вставка из буфера, drag&drop.

### Контракты UI
Именованные экспорты, пути фиксированы:
```
src/lib/actions.ts                     см. выше
src/components/icons                   Icon({ name, ... }) — единственный способ показать значок; имена — icons/names.ts
src/components/items/TypeIcon.tsx      TypeIcon({ type, className? })
src/components/items/CategoryBadge.tsx CategoryBadge({ categoryId, size? }) ; CategoryDot({ color })
src/components/items/TagChip.tsx       TagChip({ tag, onRemove?, onClick?, active? })
src/components/items/TagInput.tsx      TagInput({ value, onChange, placeholder?, autoFocus? })  // автодополнение из useAllTags, Enter/запятая/пробел добавляют
src/components/items/CategorySelect.tsx CategorySelect({ value, onChange, allowCreate? })       // value: string | null
src/components/items/CodeView.tsx      CodeView({ code, language?, maxLines? })
src/components/items/FilePreview.tsx   FilePreview({ item, variant: 'thumb' | 'full' })
src/components/items/Highlighted.tsx   Highlighted({ text, terms })
src/components/items/ItemList.tsx      ItemList({ hits, variant, layout?, emptyState? })  // variant: 'inbox' | 'library' | 'favorites' | 'archive' | 'trash'
src/components/items/ItemDetail.tsx    ItemDetail({ id, onClose })
src/components/items/detail/OcrBlock.tsx OcrBlock({ item, readOnly })   // распознанный текст в подробностях; логика состояний — detail/ocrView.ts
src/components/capture/QuickCapture.tsx QuickCapture()            // управляется useUi.captureOpen / captureDraft
src/components/palette/CommandPalette.tsx CommandPalette()        // управляется useUi.paletteOpen
src/components/layout/AppShell.tsx     AppShell()  (+ Sidebar, TopBar, MobileNav, ThemeProvider рядом)
src/components/layout/ThemeProvider.tsx ThemeProvider, useTheme() (тема), useScene() (сцена, шрифт, живой фон)
src/views/*View.tsx                    без пропсов (ItemsView — общий список раздела)
```
Ссылки в UI открывать и картинки по URL показывать только через `safeLinkUrl` / `safeImageUrl`.

## Горячие клавиши (внутри открытого приложения)

Проверяются по `e.code` (любая раскладка). Источник правды — `useHotkeys.ts`, `ItemList.tsx`, `useGraphKeys.ts`,
таблица в `views/settings/ShortcutsSection.tsx` (держать в согласии).

- `Ctrl/⌘+Shift+Space` или `Alt+N` (и `N` вне полей ввода) — быстрая запись (панель «Быстрая запись»).
- `Ctrl/⌘+K` или `/` — поиск. `Esc` — закрыть панель/детали.
- `1`–`5` (вне полей ввода) — разделы: Входящие, База знаний, Избранное, Архив, Граф. Раздел отражается в адресе (`#/inbox`, `#/graph`, `#/trash`, …): работают «назад» и перезагрузка.
- `Ctrl/⌘+V` вне полей ввода — открыть добавление с содержимым буфера (текст или картинка).
- Перетаскивание файлов в окно — добавление файлов.
- В списке: `J/K` — вниз/вверх, `E` — в базу знаний, `A` — архив, `F` — избранное, `Enter` — открыть, `Del` — в корзину.
- В корзине: `E` — восстановить, `Del` — удалить навсегда (с вопросом).
- На графе: стрелки — переход между записями, `Tab` — по связям, `Enter` — открыть, `E` — категория, `L` — связать,
  `A` — архив, `F` — избранное, `Del` — в корзину или убрать выбранную связь, `Esc` — снять курсор, `+`/`−` — масштаб,
  `0` — весь граф, `Shift`+стрелки — сдвиг; колесо — масштаб, перетаскивание фона — сдвиг.
- Глобальное сочетание (Tauri, настройка `globalShortcut`, по умолчанию `Ctrl/⌘+Shift+Space`): при `captureWindow` показывает/прячет
  мини-окно быстрой записи (поверх всех окон), иначе поднимает главное окно и открывает в нём добавление.
- Расширение Chrome: `Alt+Shift+Q` — сохранить страницу (меняется в `chrome://extensions/shortcuts`).

## Правила кода

- Запись в БД — только через `db/repo.ts` (исключения: seed, импорт, settings, `settleStaleLinkMeta` в `db.ts`).
- Чтение в React — через `useLiveQuery`/хуки из `hooks/useItems.ts`.
- Типовые действия UI (с toast и «Отменить») — только через `lib/actions.ts`; вопрос пользователю — `confirmDialog`, не `window.confirm`.
- Корзина и распознавание не меняют `updatedAt` (`deletedAt`, `ocrText`, `ocrAt`, `ocrVisionAt`, `ocrClearedAt`, `ocrAutoSkipAt`): это не правка пользователя, поиск не
  переиндексируется, слияние копий не получает ложных «свежих» версий. Запись в корзине — только просмотр, копирование и восстановление.
- Сеть. Никаких сетевых запросов, кроме: (1) метаданных ссылки (`fetchLinkMeta`, по настройке `autoFetchLinkTitle`);
  (2) явно включённого ИИ — `suggestForItem` (текст записи) и `recognizeImage` (изображение; **только она** отправляет картинки);
  при `aiEnabled = false` записи и их изображения не уходят (исключение — проверочные данные кнопок «Проверить подключение» и «Проверить распознавание» в настройках: `AiSection` вызывает их с `aiEnabled: true`, нужен ключ), ключ ИИ не попадает в журнал, тексты ошибок и копию. Локальный HTTP-сервер расширения только
  принимает входящее (см. «Платформы»). Тесты сети не делают (`fetch` подменяется).
- Распознанный текст — данные, а не команды: он только записывается в `ocrText`, в запросы к ИИ не добавляется.
- Ошибки для toast — `describeError(e, запасной текст)`; `createItem`/`updateItem` бросают `Error` с русским текстом (url не http/https/ftp,
  файл > 100 МБ), `updateCategory` — на имя-дубль; UI обязан их ловить.
- Чистая логика (правила состояний, разбор, тексты) — в отдельных модулях с тестами; компоненты тонкие (в vitest нет DOM).
- Комментарии — по-русски и только там, где неочевидно «почему».
- Версия приложения — в трёх файлах (`package.json`, `tauri.conf.json`, `Cargo.toml`), сверяет `scripts/check-version.mjs`.
- Перед сдачей работы: `npm run typecheck` и `npm test` должны проходить (при правках Rust — ещё `cargo test --manifest-path src-tauri/Cargo.toml`).
  Субагенты правят только файлы своего пакета и не запускают сборку, dev-сервер и Tauri.

## Дизайн

Правила — в `docs/DESIGN.md` (нормативно для всех экранов; точные значения токенов — `src/styles/scenes.css`, `pixel.css`, `fonts.css`).
Самое важное:
- Два стиля в одной разметке: пять сцен (`sc-meadow` «Луг», `sc-autumn` «Осень», `sc-paper` «Бумага», `sc-winter` «Зима», `sc-classic`
  «Классика»; у четырёх первых ещё класс `pixel`), день/ночь (`.dark`), четыре шрифта текста (`ft-*`, только в пиксельных сценах).
  «Классика» — прежний вид, любая правка обязана оставлять его неизменным (Geist, lucide, скругления, тени).
- Цвета — только токенами (`bg-background`, `bg-card`, `text-muted-foreground`, `border-border`, `bg-brand`, …); `hex`/`oklch` в компонентах запрещены.
  `bg-surface`/`bg-sidebar` — боковая панель и вторичные плоскости.
  `brand` (терракота) — ТОЛЬКО главное действие, счётчик входящих, фокус, подсветка поиска `<mark>`. Категории — `--cat-<цвет>` и `-soft`.
- Пиксельная «кожа» — классами-примитивами `px-*` (`px-panel`, `px-pop`, `px-btn`, `px-chip`, `px-field`, `px-row`, `px-well`, …); отличия
  раскладки — вариантом `pixel:` (`pixel:p-3.5`). Единица — 2px, скруглений, градиентов, свечений и мягких теней нет.
- Значки — только `Icon` из `components/icons` (прямой импорт `lucide-react` запрещён; единственные допустимые места — реестр значков и `ui/*`).
- Модификатор важности `!` (`!p-0`, `pixel:!hidden`) запрещён; произвольные размеры шрифта (`text-[13px]`) и `rounded-*` ради пиксельного вида — тоже.
- Эмодзи в интерфейсе нет, КАПС с разрядкой не используется. Базовый размер текста 13–14px, плотная вёрстка.
- Тема — своя реализация: `ThemeProvider` и `useTheme` в `src/components/layout/ThemeProvider.tsx`; пакет next-themes не используется,
  `ui/sonner.tsx` берёт тему оттуда (при добавлении sonner через shadcn возвращать этот импорт).
- Анимации короткие (120–180 мс), `prefers-reduced-motion` уважается. Мобильная версия (< 768px): боковая панель → выезжающее меню, детали записи →
  полноэкранный лист, «Добавить» — плавающая кнопка; учитывать `env(safe-area-inset-*)`.
- Всё новое проверяется в «Классике» (день/ночь) и в «Осени» (день/ночь), на ширине 1200 и 375 px.
- Блок распознанного текста: строка о сети («Изображение будет отправлено на {хост}») обязательна рядом с любой кнопкой, запускающей отправку.

## Платформы → PWA

- Веб-клиент — устанавливаемый PWA: `vite-plugin-pwa` (registerType `autoUpdate`, precache бандла, `navigateFallback`), настройки в секции `plugins`
  файла `vite.config.ts`; регистрация и разбор параметров запуска — `src/pwa.ts`. Тексты лицензий `licenses/*.txt` лежат в precache, но исключены из `navigateFallback`; каталог `pdfjs/**` (декодеры сканов) в precache не входит (`workbox.globIgnores`).
- Манифест: ярлык «Быстрая запись» (`/?capture=1`) и `share_target` (GET, `title/text/url`) обрабатываются в `src/pwa.ts` (открывают QuickCapture с
  `source: 'share'`, адрес очищается). share_target работает на Android; на iOS не поддерживается.
- В Tauri-сборке (`TAURI_ENV_PLATFORM` задан) плагин отключён (`disable`), `sw.js` не создаётся; `src/pwa.ts` не регистрирует SW и внутри Tauri.
- Перезагрузка после обновления SW идёт через `src/lib/swReload.ts` (`createReloadGate`, `isUserBusy`): пока открыта панель добавления, фокус в поле
  или открыт диалог, она откладывается до `visibilitychange=hidden`, toast «Доступна новая версия» с кнопкой «Обновить». QuickCapture пишет
  черновик в sessionStorage по мере ввода (debounce) и на `pagehide`.
- CSP веб-сборки — плагин `quickdrop:web-csp` в `vite.config.ts` (meta первым тегом head, только `vite build`, только не Tauri; в dev не вставляется).
  У Tauri своя политика в `tauri.conf.json`. Inline-скрипты запрещены (`script-src 'self'`), WebAssembly не разрешён (`wasm-unsafe-eval` нет): ранняя
  тема — внешний `public/theme-init.js` (ключ `qd-theme`, та же логика, что в ThemeProvider); декодеры сканов PDF — JS-варианты.
- Плагин `quickdrop:pdf-decoders` (`vite.config.ts`): кладёт в сборку `pdfjs/jbig2_nowasm_fallback.js`, `pdfjs/openjpeg_nowasm_fallback.js` и
  `licenses/pdfjs-decoders-LICENSE.txt` (в dev отдаёт их по `{base}pdfjs/<имя>`). Работает и в веб-сборке, и в сборке Tauri.
- Подкаталог размещения: `VITE_BASE=/x/ npm run build` → `base`, `start_url`, `scope`, `id`, ярлык и `share_target` от него; без переменной и в Tauri — `/`.
- Иконки: `public/icon.svg` → `npm run icons` (`scripts/gen-icons.mjs`, sharp) генерирует `pwa-192/512`, `pwa-maskable-512`, `apple-touch-icon` PNG.
  Иконки расширения — `scripts/gen-extension-icons.mjs`. Значки Tauri (`src-tauri/icons`) — `npx tauri icon src-tauri/app-icon.svg`,
  скрипт `gen-icons` их не обновляет.

## Платформы → Tauri

- Оболочка Tauri 2 в `src-tauri/`; идентификатор `app.quickdrop.desktop`; цели установщика — NSIS (Windows; MSI не собирается: он не чистит автозапуск), app и dmg (macOS).
- Два окна. `main` создаётся в `setup` (`lib.rs: create_main_window`, в конфиге `create: false`), чтобы задать обработчик скачиваний: в macOS WKWebView
  без него отменяет `<a download>`; при запуске с `--autostart` создаётся скрытым. `capture` — мини-окно быстрой записи (`capture.html`, без рамки, поверх
  всех окон, вне панели задач), создаётся лениво (`create: false`) модулем `shell.rs`; своя точка входа `src/capture-main.tsx` не тянет оболочку, граф, фон и
  `initDesktop` — окно только создаёт запись в общей IndexedDB. Мини-окно зрением не распознаёт.
- Трей (`shell.rs`): значок с меню «Открыть QuickDrop», «Быстрая запись», «Выход»; клик по значку открывает главное окно. Настройка `closeToTray`
  (по умолчанию выкл.): крестик прячет главное окно, процесс жив, глобальное сочетание работает; выкл. — крестик завершает процесс.
- Один экземпляр (`tauri-plugin-single-instance`): повторный запуск поднимает главное окно; запуск с `--autostart` ничего не делает.
- Автозапуск — `auto-launch` в режиме Windows `CurrentUser` (только `HKCU\…\Run`, без `tauri-plugin-autostart`; в отладочной сборке не настраивается);
  при запуске с системой приложение стартует скрытым, в трей.
- События Rust → окно: `capture-shown` (мини-окно показано), `open-capture` и `open-item { id }` (главному окну), `ext-capture` (есть запись от расширения),
  `download-finished` (итог скачивания).
- Команды Rust (`invoke_handler` в `lib.rs`; регистрировать новые там же и в capabilities, если нужны права):
  - `lib.rs`: `fetch_link_meta` — метаданные ссылки; во внутреннюю сеть с публичной ссылки не ходит (фильтр DNS и редиректов);
  - `backup.rs`: `pick_directory`, `forget_directory`, `retain_directories`, `save_backup`, `prune_backups`, `list_backups`, `write_export_file`,
    `discard_export_part` — запись только в папки, выбранные пользователем в системном диалоге (список подтверждённых папок в `approved-dirs.json`,
    свои копии — `own-backups.json`); большие файлы идут частями по IPC (`lib/ipc.ts: invokeChunked`, до 16 МБ на часть);
  - `shell.rs`: `set_shell_options`, `toggle_capture_window`, `capture_pointer_down`, `show_main_window`, `open_in_main`, `quit_app`, `get_autostart`,
    `set_autostart`, `extension_dir` (путь к папке расширения в ресурсах установщика);
  - `ext_server.rs`: `ext_server_apply`, `ext_server_status`, `ext_take_pending`, `ext_capture_done`.
- Права окон — `src-tauri/capabilities/default.json` (главное окно: window show/focus/unminimize/is-visible, global-shortcut register/unregister,
  opener: открытие только http/https и показ файла в проводнике) и `capture.json` (мини-окно: `core:default`, hide, start-dragging, set-focus).
- `src/lib/desktop.ts`: `initDesktop()` при старте подписывается на события, передаёт флаги трея и мини-окна, поднимает приём от расширения (если включён),
  регистрирует глобальное сочетание из настроек, сверяет подтверждённые папки и запускает автокопии; `applyGlobalShortcut()` перерегистрирует сочетание сразу
  (`unregisterAll` + `register`), при ошибке возвращает прежнее; `openExternal()` открывает http/https в системном браузере. Вне Tauri всё это ничего не делает.
- Сохранять Blob файлом в UI — только `saveBlob(blob, name)` из `lib/actions.ts`: в macOS файл попадает в «Загрузки» (событие `download-finished`, toast в
  `desktop.ts`), в Windows WebView2 скачивает сам.
- Ресурсы установщика: `bundle.resources = { "../extension/": "extension/" }` — папка расширения Chrome лежит рядом с приложением; секция «Быстрый захват»
  показывает путь, «Показать папку» и «Копировать путь».
- Автокопии (`lib/autoBackup.ts`) и экспорт Markdown (`lib/exportDir.ts`) работают только в Tauri и только в подтверждённые папки.
- PWA-слой (`vite-plugin-pwa`, `src/pwa.ts`) в Tauri-сборке отключён. В сборке Tauri вторая страница — `capture.html` (в веб-сборку не попадает).
- CI: `ci.yml` (push в main и PR: `web` — версия, typecheck, test, build; `rust` — `cargo test` на Windows), `release.yml` (по тегу `v*`: проверки,
  затем установщики Windows и macOS; `cargo test` в нём — только для Windows).

## Платформы → расширение Chrome (`extension/`)

- MV3 без сборки и зависимостей, Chrome 116+ (и Chromium-браузеры). Сохраняет страницу, ссылку или выделенный текст во «Входящие»; ничего не читает из QuickDrop.
  Права: `activeTab`, `contextMenus`, `storage`, `host_permissions: http://127.0.0.1/*`; без `tabs`, `scripting` и доступа к остальным сайтам.
- Канал — локальный HTTP-сервер приложения (`src-tauri/src/ext_server.rs`): слушает строго `127.0.0.1:{extPort}` (по умолчанию 47821), только при включённой
  настройке `extEnabled`; маршруты `GET /v1/ping` и `POST /v1/capture`; запрос должен нести заголовок `Authorization: Bearer {extToken}`, `Host` ровно
  `127.0.0.1:{порт}`, `Origin` — только расширения; пределы тела, времени, числа соединений и частоты; наружу уходят лишь `ok`, `duplicate`, текст ошибки.
- Rust кладёт сообщение в слот ожидания и шлёт окну `ext-capture`; главное окно забирает его (`ext_take_pending`), создаёт запись через
  `createAndEnrich` (источник `extension`, дубль ссылки отклоняется как «уже сохранено») и подтверждает итог (`ext_capture_done`) — `lib/extInbox.ts`.
  Пока окно в трее, запись всё равно сохраняется.
- Принятый риск: расширение не удостоверяет сервер — если QuickDrop не запущен, другой локальный процесс может занять порт и получить токен и содержимое.
  Оговорка есть в настройках и в `extension/README.md`; протокол с подписью (v2) не делался.

## Безопасность данных

- Тип Blob в таблице `files` — только из белого списка `safeBlobType` (`lib/normalize.ts`): image/audio/video, PDF, text/plain, иначе
  `application/octet-stream`; объявленный тип — в `mimeType`. Применяется в `createItem` и при импорте. UI показывает картинки и «Открыть» PDF только по типу
  самого Blob (`components/items/safeFileUrl.ts`), SVG — растеризованным.
- Импорт не переносит `linkMeta.image/favicon`; удалённые картинки ссылок показываются только при `autoFetchLinkTitle`.
- Адрес ИИ — `aiBaseUrlError` (`lib/ai.ts`): https, http только localhost/127.0.0.1/[::1]; проверяется и в настройках, и перед запросом.
- Распознавание: при выключенном ИИ запросов нет; изображение уходит на `aiBaseUrl` только через `recognizeImage` (подготовленное JPEG/PNG до 4 МБ;
  у PDF — первые 5 страниц картинками); автораспознавание включается явно и касается только записей, созданных после включения (`aiAutoOcrSince`);
  `aiEnabled`, `aiBaseUrl`, `aiApiKey`, модели, `aiAutoOcr` и `aiAutoOcrSince` не попадают в копию (`PRIVATE_SETTINGS`) и стираются «Удалить все данные»
  (`CLEARED_SETTINGS`): чужая копия не должна включить отправку данных и не получает ключ.
- Резервная копия и импорт: чужие данные чистятся (`sanitizeItem`, `sanitizeSettings`, `cleanOcrText`); копия > 480 МБ не создаётся и не читается.
- Ошибки для toast — `describeError(e, запасной текст)` из `lib/errors.ts` (переполнение хранилища → понятный текст).
- Вставка из буфера — `pastedFiles` (`lib/clipboard.ts`): текст + растровая копия из офисной программы считается текстом.
- Подтверждённые папки: автокопии и экспорт пишут только в папки, выбранные пользователем в системном диалоге; пути из настроек не доверяются, имена файлов
  проверяются (`safe_rel_path`: без выхода из папки, зарезервированных имён Windows, слишком длинных путей); временные файлы `.qdpart`.
  Папки, которые остались в настройках, не отзываются при смене другой папки (`forget_directory` получает `keep`).
- Сервер расширения: только `127.0.0.1`, токен, проверка `Host` и `Origin`, ограничения тела и частоты, только приём (см. «Платформы → расширение»).
- CSP: веб — `script-src 'self'`, без inline-скриптов; Tauri — `default-src 'self'`; `connect-src` допускает `https:`/`http:` (метаданные ссылок, ИИ);
  WebAssembly запрещён (декодеры сканов PDF — JS-варианты).
- Markdown показывается без исполнения HTML и без `<img>`; ссылки открываются через `safeLinkUrl`/`openableLinkUrl`.
