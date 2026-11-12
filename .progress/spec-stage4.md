# Спецификация этапа 4 — малые доработки

Источники: `.progress/plan-combined.md` (этап 4), `docs/DESIGN.md`, `.progress/spec-stage3.md` §3 (сквозные правила
переноса — действуют целиком), `.progress/spec-stage2.md` §5 (точки подключения), `.progress/HANDOFF.md` (долги).
Истина — код на коммите `3cbcdba`. Контракты `CLAUDE.md` не меняются (только добавления).

Что появляется: просмотр Markdown, раздел «Корзина», предупреждение о дубле ссылки, сохранённые поиски, настройки
автокопий и экспорта в папку, отбор по датам и разделители по дням. Каждый экран верен в пиксельных сценах и в
«Классике»; телефон (< 768px) не ломается.

Обозначения: «К» — «Классика», «П» — пиксельные сцены. `+ …` — классы добавляются к нынешним.

## 0. Порядок работ и владение файлами

Один файл — один пакет на весь этап. Чужие файлы не править; нужна правка — записать в свой отчёт раздел
«Нужно в чужом файле» (файл, что, зачем), вносит основная сессия.

| Волна | Пакет | Модель | Порт | Файлы (исключительное владение; «нов.» — новый) |
|---|---|---|---|---|
| 0 (первым) | `core-logic` | opus | — | `src/store/ui.ts`, `src/store/ui.test.ts` нов., `src/store/confirm.ts` нов., `src/store/confirm.test.ts` нов., `src/lib/errors.ts`, `src/lib/errors.test.ts`, `src/lib/exportImport.ts`, `src/lib/exportImport.test.ts`, `src/lib/itemTitle.ts`, `src/lib/itemTitle.test.ts`, `src/lib/wikiLinks.ts`, `src/lib/wikiLinks.test.ts`, `src/lib/markdownExport.ts`, `src/lib/markdownExport.test.ts`, `src/lib/dates.ts`, `src/lib/dates.test.ts`, `src/lib/dayGroups.ts` нов., `src/lib/dayGroups.test.ts` нов., `src/lib/trash.ts` нов., `src/lib/trash.test.ts` нов., `src/lib/savedSearch.ts` нов., `src/lib/savedSearch.test.ts` нов., `src/lib/backupUi.ts` нов., `src/lib/backupUi.test.ts` нов., `src/lib/actions.ts`, `src/lib/actions.test.ts`, `src/lib/desktop.ts`, `src/lib/desktop.test.ts`, `src/hooks/useDebounced.ts` нов. |
| 0 (вторым) | `core-ui` | opus | 5180 | `src/lib/markdown.ts` нов., `src/lib/markdown.test.ts` нов., `src/components/markdown/MarkdownView.tsx` нов., `src/components/markdown/MarkdownText.tsx` нов., `src/components/markdown/ViewModeToggle.tsx` нов., `src/components/items/detail/ContentEditor.tsx`, `src/components/items/detail/ItemContent.tsx`, `src/components/items/detail/LinkCard.tsx`, `src/components/layout/ConfirmHost.tsx` нов., `src/App.tsx`, `src/styles/markdown.css` нов., `src/styles/pixel.css`, `src/index.css`, `docs/DESIGN.md` |
| 1 | `shell-nav` | sonnet | 5181 | `src/components/layout/Sidebar.tsx`, `src/components/layout/NavButton.tsx` нов., `src/components/layout/SavedSearches.tsx` нов. |
| 1 | `list` | opus | 5182 | `src/components/items/ItemList.tsx`, `src/components/items/ItemCard.tsx`, `src/components/items/ItemMenu.tsx`, `src/components/items/BulkBar.tsx`, `src/components/items/trashContext.ts` нов., `src/views/TrashView.tsx` нов., `src/components/layout/AppShell.tsx` |
| 1 | `views-filter` | sonnet | 5183 | `src/components/items/FilterBar.tsx`, `src/components/items/SaveSearchButton.tsx` нов., `src/views/InboxView.tsx`, `src/components/items/TriageMode.tsx` |
| 1 | `detail` | sonnet | 5184 | `src/components/items/ItemDetail.tsx`, `src/components/items/detail/TitleField.tsx`, `src/components/items/detail/LinkedItems.tsx`, `src/components/items/FilePreview.tsx` |
| 1 | `capture-palette` | sonnet | 5185 | `src/components/capture/QuickCapture.tsx`, `src/components/palette/CommandPalette.tsx` |
| 1 | `settings` | sonnet | 5186 | `src/views/SettingsView.tsx`, `src/views/settings/DataSection.tsx`, `src/views/settings/BackupSection.tsx` нов., `src/views/settings/ShortcutsSection.tsx` |
| 1 | `tauri-forget` | opus | — | `src-tauri/src/backup.rs`, `src-tauri/src/lib.rs` |

(уточнено при сверке) `TrashView.tsx` и `AppShell.tsx` перенесены из `views-filter` в `list`: `TrashView` передаёт
`ItemList` `variant="trash"`, а тип `ItemVariant` расширяет `ItemCard.tsx` (пакет `list`) — в `views-filter` typecheck
падал бы до сдачи соседа, а проверка `list` в разделе «Корзина» ждала бы `views-filter`. Теперь пакеты волны 1 зависят
только от волны 0. Раздел — в §5.2a.

Волны 2 нет. После волны 1 — приёмка основной сессии (§8).

Ничьи (не править): `src/components/ui/*`, `src/components/icons/*`, `ThemeProvider.tsx`, `TopBar.tsx`, `MobileNav.tsx`,
`ErrorBoundary.tsx`, `ItemsView.tsx`, `LibraryView.tsx`, `FavoritesView.tsx`, `ArchiveView.tsx`, `EmptyState.tsx`,
`TagChip.tsx`, `TagInput.tsx`, `CategoryBadge.tsx`, `CategorySelect.tsx`, `CodeView.tsx`, `Highlighted.tsx`, `TypeIcon.tsx`,
`detail/AutoLinkText.tsx`, `detail/AutoTextarea.tsx`, `detail/FileBlock.tsx`, `detail/LinkPicker.tsx`, `detail/AiSuggest.tsx`,
`detail/save.ts`, `detail/autosave.ts`, `settings/Section.tsx` и прочие секции настроек, `src/hooks/useItems.ts`,
`useHotkeys.ts`, `computeVisible.ts`, `src/search/*`, `src/db/*`, `src/types.ts`, `src/main.tsx`, `vite.config.ts`,
`src/styles/scenes.css`, `fonts.css`, остальной `src/lib/*`, `capabilities/default.json`.

Файл прогресса каждого пакета — `.progress/agents/stage4-<пакет>.md` (задача, статус, результат, изменённые файлы,
«Нужно в чужом файле», что не проверено). git не трогать, пакеты не устанавливать.

## 1. Решения

| № | Решение |
|---|---|
| Р1 | Markdown показывается у текста, идеи и у заметки к ссылке/файлу/изображению; код — как раньше (`CodeView`). Режим «Просмотр / Исходник» — один на всё приложение (`useUi.mdPreview`, localStorage `qd-md-preview`), по умолчанию «Просмотр». Правка — как раньше: клик по тексту или «Изменить» открывает textarea с исходником |
| Р2 | Одиночный перевод строки в просмотре — перенос строки (свой плагин `remarkSoftBreaks`): обычные заметки без разметки выглядят как раньше |
| Р3 | Сырой HTML не исполняется и не разбирается: показывается текстом (`skipHtml` не включается, `rehype-raw` нет). `<img>` не создаётся никогда: картинка Markdown — ссылка со значком |
| Р4 | Вики-ссылки в просмотре — плагин над деревом mdast (текстовые узлы вне кода и вне обычных ссылок). Цель с разметкой внутри (`[[a *b* c]]`) ссылкой не становится — ограничение. В таблицах пишется `[[запись\|подпись]]` (как в Obsidian); `parseWikiLinks` учится тому же |
| Р5 | Задача переключается по позиции узла `li` в исходнике (`node.position.start.offset`), а не по порядковому номеру: пустые пункты `- [ ]` и пункты в коде задачами не являются, счёт по регулярному выражению расходился бы с разбором |
| Р6 | Связи по вики-ссылкам создаются при выходе из правки (blur, Ctrl/⌘+Enter, Esc, закрытие панели) и при создании записи, а не на каждом автосохранении: иначе при наборе `[[План на год]]` возникла бы связь с «План». Связи не снимаются (решение этапа 2) |
| Р7 | `displayTitle` снимает разметку Markdown с производного заголовка (первая значимая строка `content`) у всех типов, кроме кода. Свой заголовок, заголовок страницы и имя файла не трогаются. Следствие: имена файлов экспорта и разрешение `[[…]]` идут по заголовку без разметки |
| Р8 | Запись «в корзине» определяется по `item.deletedAt`, а не по разделу: карточка, меню, клавиши, массовые действия и детали ведут себя одинаково в разделе «Корзина» и в выдаче `is:trash` |
| Р9 | Раздел «Корзина» — свой экран без `FilterBar`: порядок по дате удаления (новые сверху), вид — только список, поиск из верхней панели работает. `SortMode` не расширяется |
| Р10 | Подтверждение внутри приложения — `confirmDialog()` (промис) + `ConfirmHost` в `App.tsx`. `window.confirm` не используется нигде |
| Р11 | В корзине `E` — восстановить, `Del`/`Backspace` — удалить навсегда (с подтверждением), `A` и `F` не действуют |
| Р12 | Дубль ссылки: строка появляется через 300 мс после остановки ввода и ничего не перехватывает. Попытка сохранить дубль (Enter, Ctrl/⌘+Enter, кнопка) останавливается: строка становится `role="alert"`, фокус уходит на «Открыть». Проверка при сохранении — синхронная по снимку, без задержки |
| Р13 | Сохранённый поиск запоминает раздел: при сохранении к запросу добавляется `is:inbox` / `is:library` / `is:fav` / `is:archive` / `is:trash` (если в строке поиска нет своего статуса). При применении раздел выбирается по запросу (`viewForQuery`) |
| Р14 | Быстрые периоды — «Сегодня», «За неделю», «За месяц» через `relativeRange` (обе границы). Свой период — два поля даты; признак `useUi.customDates` → `composeQuery(…, { relativeDates: false })` |
| Р15 | Разделители по дням — в виде «Список» при сортировке «новые», «старые» (по `createdAt`) и «недавно изменённые» (по `updatedAt`), когда в запросе нет слов; в «Корзине» — по `deletedAt`. В сетке разделителей нет |
| Р16 | Экспорт в Markdown: все записи вне корзины (архив входит), `buildMarkdownExport` + `exportDocsToDir`. Вне Tauri блоки копий и экспорта показывают пояснение; запасной путь — пункт меню записи «Скачать как Markdown» (один файл без вложений), работает везде |
| Р17 | Отзыв папки: `forgetDirectory(prev)` вызывается после успешной записи новой настройки и только если `prev` не совпадает с папкой другой настройки (`shouldForgetDir`) |

## 2. Волна 0, пакет `core-logic`

Только логика и тесты (vitest, окружение node). Браузер не нужен. Существующие экспорты и поведение не менять, кроме
названного. Если из-за Р7 упадёт тест в чужом файле — не править, перечислить в отчёте.

### 2.1 `src/store/ui.ts`

```ts
export interface CaptureDraft { text?: string; type?: ItemType; files?: File[]; source?: ItemSource }   // + source

interface UiState {
  /** Период дат задан полями «свой период», а не быстрой кнопкой. */
  customDates: boolean
  /** Текст с разметкой показывается отрисованным (true) или исходником (false). */
  mdPreview: boolean
  /** null — снять период. custom по умолчанию false. */
  setDateRange: (range: { from?: number; to?: number } | null, custom?: boolean) => void
  setMdPreview: (on: boolean) => void
}
```

- `setDateRange(null)` → `filter.from = filter.to = undefined`, `customDates = false`.
  `setDateRange(r, custom)` → `filter.from = r.from`, `filter.to = r.to` (остальной фильтр сохраняется);
  `customDates = !!custom && (r.from !== undefined || r.to !== undefined)`.
- `setView`, `resetFilter`, `applyQuery` дополнительно ставят `customDates: false`. `setFilter` не меняется.
- `mdPreview`: начальное значение — `localStorage['qd-md-preview'] !== '0'` (нет `localStorage` или исключение → `true`);
  `setMdPreview` пишет `'1'`/`'0'` (исключение глотается).
- Тест `ui.test.ts`: `setDateRange` (оба режима, снятие, сохранение прочих полей фильтра), сброс `customDates` тремя
  действиями, `mdPreview` без `localStorage`.

### 2.2 `src/store/confirm.ts` (новый)

```ts
export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string      // по умолчанию «Подтвердить»
  cancelLabel?: string       // по умолчанию «Отмена»
  destructive?: boolean
}
export interface ConfirmRequest extends ConfirmOptions { id: number }
export const useConfirm: UseBoundStore<StoreApi<{ request: ConfirmRequest | null; settle: (ok: boolean) => void }>>
/** Показывает вопрос (рисует ConfirmHost) и ждёт ответа. Новый вопрос поверх старого: старый получает false. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean>
```

`settle(ok)` решает промис текущего запроса и ставит `request = null`; без запроса — ничего. Тесты: ответ да/нет,
второй вопрос отвечает первому `false`, `settle` без запроса.

### 2.3 Тексты и отчёт импорта

- `src/lib/errors.ts`: `QUOTA_MESSAGE = 'Недостаточно места в хранилище: очистите корзину, удалите крупные файлы или
  освободите место на устройстве'`.
- `src/lib/exportImport.ts`, `tooBig`: последняя фраза — «Очистите корзину, удалите крупные файлы или сохраните их
  отдельно и повторите экспорт.»
- `ImportReport` получает поле `trashed: number` — сколько из записанных записей (`itemsToPut`) имеют `deletedAt`.
  Начальное значение в отчёте `0`. Тесты: импорт копии с записью в корзине → `trashed: 1`; обычный → `0`; существующие
  сравнения отчёта поправить.

### 2.4 `src/lib/itemTitle.ts`

```ts
/** Строка content, из которой берётся производный заголовок: её номер и текст без разметки; null — такой нет. */
export function derivedTitleLine(
  item: Pick<Item, 'content'> & Partial<Pick<Item, 'type'>>,
): { index: number; text: string } | null
```

- Строки `content` (делить по `/\r?\n/`), не дальше первых 50. Для `type === 'code'` текст строки — `line.trim()`.
  Иначе — `stripMarkdown(line).trim()` (строка-ограда кода даёт пустую строку и пропускается); строка только из
  знаков `- * _ = # > |` и пробелов (разделитель, подчёркивание заголовка) пропускается. Первая непустая — результат.
- `displayTitle`: вместо нынешнего поиска первой строки — `derivedTitleLine(item)?.text`, затем `clip(…, 80)`.
  `TitleSource` получает необязательное `type`. Остальной порядок источников прежний.
- Тесты: `# Заголовок` → «Заголовок»; `- [ ] купить **хлеб**` → «купить хлеб»; первая строка ` ```js ` → берётся
  следующая; `---` пропускается; код `# comment` и `__init__` не трогаются; `#тег` остаётся; пустой content → прежние
  запасные варианты; `derivedTitleLine().index`.

### 2.5 `src/lib/wikiLinks.ts`

`parseWikiLinks`: если перед первым `|` внутри `[[…]]` стоит `\`, он к цели не относится (`[[a\|b]]` → цель `a`,
подпись `b`). Тест. `markdownExport.ts` править только если его тесты упадут из-за Р7 или этой правки.
(уточнено при сверке) Исключение: `markdownExport` переписывает ссылку как `[[имя|подпись]]` (`markdownExport.ts:307`);
ссылку, записанную через `\|` (`link.raw.includes('\\|')`), переписывать тоже через `\|` — иначе в таблице Markdown
голая `|` разрежет ячейку (проверено: `| [[x|y]] |` даёт две ячейки). Тест: строка таблицы с `[[…\|…]]` после экспорта
остаётся одной ячейкой.

### 2.6 `src/lib/dates.ts` — добавить

```ts
export type DatePreset = 'today' | 'week' | 'month'
export const DATE_PRESETS: ReadonlyArray<{ id: DatePreset; label: string }>   // Сегодня · За неделю · За месяц
/** Быстрый период, которому пара from/to равна точно (relativeRange от now); иначе null. */
export function presetOf(from: number | undefined, to: number | undefined, now: number): DatePreset | null
/** 'ГГГГ-ММ-ДД' из <input type="date"> → начало этих суток; пусто или не дата → null. */
export function parseDateInput(value: string): number | null
/**
 * Два поля → диапазон: from — начало суток «с», to — конец суток «по»; пустое поле — граница не задана;
 * оба пусты → range: null. Ошибки: «Неверная дата», «Дата начала позже даты конца».
 */
export function customDateRange(
  fromValue: string, toValue: string,
): { ok: true; range: { from?: number; to?: number } | null } | { ok: false; error: string }
/** «12.11.2026», «12.11.2026 – 14.11.2026», «с 12.11.2026», «по 14.11.2026»; обе границы пусты → ''. */
export function formatDateRange(from: number | undefined, to: number | undefined): string
```

Значение для поля даты — существующий `formatDateToken(ts)`. Тесты: каждая функция, границы суток, год вне
1970…2999 → «Неверная дата», один день (`from` и `to` одних суток) → одна дата.

### 2.7 `src/lib/dayGroups.ts` (новый)

```ts
export type DayEntry<T> = { kind: 'header'; key: string; label: string } | { kind: 'row'; row: T }
/** Вставляет заголовок перед первой строкой каждых суток (по порядку строк). Подпись — formatDayLabel(ts, now). */
export function groupByDay<T>(rows: readonly T[], tsOf: (row: T) => number, now: number): DayEntry<T>[]
```

Сутки — `startOfDay(ts)`; негодная отметка (NaN, вне Date) — своя группа с подписью `NO_DATE`. `key` уникален и
устойчив при дозагрузке: `d-<порядковый номер заголовка>-<начало суток>`. Тесты: сегодня/вчера/дата, год в подписи,
повтор суток не подряд — два заголовка с разными ключами, пустой список, негодная отметка.

### 2.8 `src/lib/trash.ts` (новый)

```ts
export const TRASH_DAYS_OPTIONS: readonly number[]           // [7, 14, 30, 90, 365, 0]
/** «7 дней», «14 дней», «30 дней», «90 дней», «1 год», 0 → «Не очищать»; прочее → «N дн.» */
export function trashDaysLabel(days: number): string
/** Момент автоочистки; null — автоочистка выключена (days ≤ 0 или не число) либо записи нет в корзине. */
export function trashPurgeAt(deletedAt: number | undefined, trashDays: number): number | null
/** Сколько суток осталось (округление вверх, не меньше 0); null — как у trashPurgeAt. */
export function trashDaysLeft(deletedAt: number | undefined, trashDays: number, now: number): number | null
/** null → ''; 0 → «удалится сегодня»; N → «ещё N дн.» */
export function trashLeftLabel(left: number | null): string
```

(уточнено при сверке) `trashPurgeAt = deletedAt + trashDays × DAY_MS` — та же арифметика, что в `repo.purgeExpired`
(`now − days × DAY_MS`); фактическая очистка идёт при запуске и раз в 6 часов, поэтому «сегодня» допустимо до 6 ч
после срока. Тесты: каждая функция, `trashDays = 0`, нет `deletedAt`, срок уже прошёл → `0`.

### 2.9 `src/lib/savedSearch.ts` (новый)

```ts
export interface SearchScreen { view: View; query: string; filter: UiFilter; customDates: boolean }
/** Есть ли что сохранять: непустая строка поиска или хотя бы одно поле фильтра. */
export function isNarrowed(query: string, filter: UiFilter): boolean
/** Часть фильтра, которую задаёт раздел: inbox/library/archive → status, favorites → favorite, trash → trashed; иначе {}. */
export function sectionFilter(view: View): ItemFilter
/** Запрос для сохранения: composeQuery(строка, фильтр + раздел, категории, now, { relativeDates: !customDates }). */
export function currentSearchQuery(screen: SearchScreen, categories: readonly Category[], now?: number): string
/** Раздел, заданный самим запросом: is:trash → 'trash'; ровно один статус → его раздел; is:fav → 'favorites'; иначе null. */
export function viewForQuery(query: string, now?: number): View | null
/** Имя по умолчанию: запрос в одну строку, не длиннее SAVED_SEARCH_NAME_MAX («…» в конце); пусто → «Поиск»; занятое → « (2)», « (3)»… */
export function suggestSearchName(query: string, taken: readonly string[]): string
```

- `currentSearchQuery`: часть раздела добавляется по правилам `computeVisible` (что строка поиска переопределяет,
  то не дописывается; разбор — `parseQuery(query).filter`) (уточнено при сверке — для корзины и избранного было неверно):
  - `inbox` / `library` / `archive` — статус, если в строке нет своего статуса и нет `is:trash`;
  - `favorites` — `is:fav`, если в строке нет `is:fav` и нет `is:trash` (свой статус `is:fav` не отменяет:
    `computeVisible` оставляет избранное при `{ ...base, status }`);
  - `trash` — `is:trash`, если его нет в строке, **даже при своём статусе**: в корзине `is:inbox` сужает корзину
    (`{ trashed: true, status }`), и без `is:trash` сохранённый поиск открылся бы во «Входящих».
  Не сузили ничего (`!isNarrowed`) → пустая строка (сам раздел без отбора не сохраняется).
- Занятость имени сравнивать через `searchNameKey` (`lib/normalize`).
- Тесты: каждый раздел, строка со своим `is:archive` (раздел не дописывается), корзина со строкой `is:inbox`
  (→ `is:trash is:inbox`, `viewForQuery` → `'trash'`), избранное со строкой `is:archive` (→ `is:fav is:archive`), свой
  период и быстрый период (`date:week` против дат), круг `currentSearchQuery` → `viewForQuery`, `suggestSearchName`
  (обрезка, занятость).

### 2.10 `src/lib/backupUi.ts` (новый)

```ts
export type UiMessage = { kind: 'success' | 'error' | 'info'; text: string }
export const DESKTOP_HINT = 'Доступно в приложении для Windows'
export const BACKUP_PERIOD_LABEL: Record<BackupPeriod, string>   // Выключено · Каждый день · Каждую неделю
export function backupResultMessage(result: BackupRunResult): UiMessage
/** Одна и та же папка: без учёта регистра, хвостовых разделителей и пробелов по краям; пустые не равны ничему. */
export function sameDir(a: string, b: string): boolean
/** Отзывать ли прежнюю папку: она непуста, отличается от новой и не занята другой настройкой. */
export function shouldForgetDir(prev: string, next: string, other: string): boolean
```

Тексты `backupResultMessage`: `done` → success «Копия сохранена: <имя файла>» (+ «, старых копий удалено: N» при
`removed > 0`; имя файла — часть `result.path` после последнего `/` или `\`, уточнено при сверке); `failed` → error с текстом ошибки; `skipped`: `no-dir` → error «Сначала выберите папку для копий»;
`not-desktop` → info `DESKTOP_HINT`; `empty` → info «База пуста — копировать нечего»; `retry-later` → info «Недавняя
попытка не удалась. Повторите позже или выберите другую папку»; `busy` → info «Копия уже создаётся»; `off` → info
«Автоматические копии выключены»; `not-due` → info «Срок очередной копии ещё не подошёл».

### 2.11 `src/lib/desktop.ts`

```ts
/** Убирает папку из подтверждённых для записи (команда Rust forget_directory). Вне Tauri, пустая строка, ошибка → false. Не бросает. */
export async function forgetDirectory(dir: string): Promise<boolean>
```

Вызов: `invoke<boolean>('forget_directory', { dir })`. Тест в `desktop.test.ts` (имя команды и аргумент, ошибка → `false`).

### 2.12 `src/lib/actions.ts` — добавить

```ts
/** Подтверждение → actPurge. Одна запись: «Запись «<заголовок>» будет удалена без возможности восстановления.»; несколько: «Записей: N. …» */
export async function actPurgeAsk(ids: string | string[]): Promise<void>
/** Подтверждение с числом записей в корзине → actEmptyTrash. Корзина пуста — ничего. */
export async function actEmptyTrashAsk(): Promise<void>
/** applyWikiLinks по снимку записей (getAllItemsSnapshot); снимка нет или в тексте нет «[[» → []. toast, если не silent. */
export async function actApplyWikiLinks(itemId: string, content: string, options?: { silent?: boolean }): Promise<string[]>
/** Раздел по записи (корзина → 'trash', иначе по status) + select. setView — только если раздел другой. */
export function openItemInSection(item: Pick<Item, 'id' | 'status' | 'deletedAt'>): void
/** Сохраняет текущий отбор экрана (useUi + listCategories). Имя по умолчанию — suggestSearchName. Нечего сохранять → toast.error. */
export async function actSaveCurrentSearch(name?: string): Promise<SavedSearch | undefined>
/** applyQuery(search.query, viewForQuery(…) ?? текущий раздел; из settings/graph/trash без своего раздела — 'library'). */
export function actApplySearch(search: SavedSearch): void
export async function actRenameSearch(id: string, name: string): Promise<boolean>      // ошибка → toast, false
export async function actMoveSearch(id: string, delta: -1 | 1): Promise<void>          // reorderSavedSearches
/** Одна запись файлом .md без вложений (planMarkdownExport + itemToMarkdown + saveBlob). */
export async function actDownloadMarkdown(item: Item): Promise<void>
```

- Подтверждения: `confirmDialog({ title: 'Удалить навсегда?', description, confirmLabel: 'Удалить навсегда',
  destructive: true })`; для корзины — `title: 'Очистить корзину?'`, `description: 'Все записи в корзине (N) будут
  удалены без возможности восстановления.'`, `confirmLabel: 'Очистить'`. Отказ — ничего не происходит.
- (уточнено при сверке) Тексты и данные подтверждений:
  - `actPurgeAsk`: id без повторов; пусто — ничего. Одна запись — заголовок `displayTitle(await getItem(id))` (записи
    нет — ничего не спрашивать и не удалять); несколько — дословно «Записей: N. Они будут удалены без возможности
    восстановления.»
  - `actEmptyTrashAsk`: N — `getTrashedItemsSnapshot()?.length`; `0` — ничего; снимка нет (`undefined`) — спросить без
    числа: «Все записи в корзине будут удалены без возможности восстановления.» Новых функций чтения в `repo` не
    добавлять (`src/db/*` на этапе 4 ничей).
- (уточнено при сверке) `openItemInSection`: если текущий раздел — «Избранное», а запись в избранном, не в архиве и не
  в корзине, раздел не меняется (только `select`).
- (уточнено при сверке) `actDownloadMarkdown`: `items = getAllItemsSnapshot() ?? [item]` (если `item` в снимке нет —
  добавить его), `plan = planMarkdownExport(items)`, `entry = itemToMarkdown(item, { categories: await
  listCategories(), items, plan })`, `saveBlob(new Blob([entry.markdown], { type: 'text/markdown;charset=utf-8' }),
  entry.path)`; ошибки — через `safe`. `markdownExport` можно грузить `await import(...)`, чтобы не утяжелять основной
  чанк.
- `actApplyWikiLinks`: toast «Добавлена связь: «<заголовок>»» (одна) / «Добавлено связей: N».
- `createAndEnrich`: после `createItem`, если `item.type !== 'code'` и в `item.content` есть `[[` —
  `void actApplyWikiLinks(item.id, item.content, { silent: true })`.
- `actSaveCurrentSearch`: «Нечего сохранять: задайте поиск или фильтры».
- Тесты (`actions.test.ts`, `confirmDialog` подменить): `actPurgeAsk` (да/нет, текст для одной и нескольких),
  `actEmptyTrashAsk` (пустая корзина — без вопроса), `actApplyWikiLinks` (silent, без снимка), `openItemInSection`,
  `actApplySearch` (раздел из запроса и запасной), `actMoveSearch` (края списка), `actSaveCurrentSearch`.

### 2.13 `src/hooks/useDebounced.ts` (новый)

```ts
/** Значение, отстающее на delayMs после последнего изменения. */
export function useDebounced<T>(value: T, delayMs: number): T
```

### 2.14 Критерии готовности

`npm run typecheck` и `npm test` зелёные (кроме перечисленных в отчёте чужих тестов); новые функции покрыты тестами;
ни один прежний экспорт не изменил сигнатуру.

## 3. Волна 0, пакет `core-ui`

Запускается после `core-logic`. Весь Markdown — от разбора до сохранения задачи — в одном пакете.

### 3.1 `src/lib/markdown.ts` (новый, без тяжёлых зависимостей)

Не импортирует `react-markdown` и `remark-gfm`. Типы узлов — свои минимальные интерфейсы (пакеты `mdast`/`hast` в
`package.json` не добавлять). Обход дерева — своя рекурсия. (уточнено при сверке) Тип узла экспортируется:
`export interface MdNode { type: string; value?: string; url?: string; children?: MdNode[]; position?: { start: {
offset?: number } } }` (поля — по нужде); плагины этого вида принимаются `remarkPlugins` без приведений.

```ts
export const WIKI_SCHEME = 'qd-wiki:'
export const MD_RENDER_MAX = 100_000                      // символов; длиннее — показывается исходник
export function wikiHref(target: string): string           // WIKI_SCHEME + encodeURIComponent(target)
export function parseWikiHref(href: string | undefined): string | null   // цель или null (не вики-адрес, битая кодировка)
/** remark-плагин: [[цель]] и [[цель|подпись]] в текстовых узлах → узел link с url = wikiHref(цель). */
export function remarkWikiLinks(): (tree: MdNode) => void
/** remark-плагин: перевод строки внутри текстового узла → узел break. */
export function remarkSoftBreaks(): (tree: MdNode) => void
/** urlTransform для react-markdown. */
export function mdUrlTransform(url: string, key: string): string
/** Исходник с переключённой задачей, пункт которой начинается в offset; null — задачи там нет. */
export function toggleTaskAt(source: string, offset: number): string | null
export function isMarkdownFile(file: { fileName?: string; mimeType?: string }): boolean   // .md .markdown .mdown, text/markdown
```

- `remarkWikiLinks`: внутрь `link`, `linkReference`, `code`, `inlineCode`, `html` не заходит. Разбор цели и подписи —
  как в `parseWikiLinks` (trim, пустая цель и цель длиннее 200 символов — не ссылка, подпись по умолчанию — цель).
- `remarkSoftBreaks` ставится после `remarkWikiLinks`; узлы `code`/`inlineCode`/`html` не трогает. (уточнено при
  сверке) В исходнике с CRLF текстовый узел содержит `\r\n` (проверено: `"line1\r\nline2"`) — делить по `/\r?\n/`,
  `\r\n` — один перевод.
- `mdUrlTransform`: `key === 'href'` → адрес с `WIKI_SCHEME` или начинающийся с `#` возвращается как есть, иначе
  `safeLinkUrl(url) ?? ''`; `key === 'src'` → `safeLinkUrl(url) ?? ''`; прочие ключи → `''`.
- `toggleTaskAt`: с позиции `offset` (липкое выражение) `[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[([ xX])\]` → символ в
  скобках меняется: пробел → `x`, `x`/`X` → пробел. Остальной текст не меняется байт в байт (в т.ч. `\r\n`).

Проверено на установленных версиях (`react-markdown` 10.1, `remark-gfm` 4.0.1): компонент `li` получает `node` с
`position.start.offset`, указывающим на маркер пункта (и во вложенных списках, и в цитате); у задачи
`className` содержит `task-list-item`; `- [ ]` без текста и пункты в блоке кода задачами не являются; сырой HTML без
`skipHtml` превращается в текст; `[[x\|y]]` в ячейке таблицы приходит текстовым узлом `[[x|y]]`.
(уточнено при сверке) Перепроверено отдельным скриптом: всё так же, плюс `[[p\|q]]` в абзаце тоже даёт `[[p|q]]`,
`- [ ] ` с пробелом — не задача, `urlTransform` вызывается для `href` сносок (`#user-content-fn-1`); подписи сносок
приходят как заданы. Типы проверены `tsc` 7.0.2: плагин вида `() => (tree: MdNode) => void` в `remarkPlugins`,
`mdUrlTransform(url, key): string` в `urlTransform`, строки в `remarkRehypeOptions` и `node.position.start.offset` в `li`
принимаются без приведений.

Тесты `markdown.test.ts` (в node: `renderToStaticMarkup(createElement(Markdown, {…}))` из `react-dom/server` с простыми
компонентами-зондами, без компонентов проекта):
- задачи: для каждого `li.task-list-item` `toggleTaskAt(source, offset)` меняет ровно свой флажок — вложенные списки,
  цитата, нумерованный список, `* [X]`, CRLF; пункты в ограде кода и `- [ ]` без текста не затрагиваются; неверный
  `offset` → `null`;
- вики-ссылки: простая, с подписью, несколько в строке, в таблице с `\|`, не в коде, не внутри обычной ссылки, `c++`
  и скобки в цели (круг `wikiHref` → `parseWikiHref`, в т.ч. через отрисовку: `href`, который получил зонд `a`, —
  mdast-util-to-hast нормализует адрес ссылки);
- переносы: «а\nб» → два текста и `br`; в коде перевод строки остаётся;
- безопасность: `javascript:`, `data:`, `file:`, `mailto:`, относительный адрес → пустой `href`; `<script>` и
  `<img onerror>` из исходника — текст, в разметке нет тегов `script`/`img`/`iframe`; `src` картинки проходит только
  http/https/ftp. (уточнено при сверке) Проверку «нет `<img>`» делать на исходнике без синтаксиса `![]()` либо с
  зондом `img`: без зонда react-markdown рисует `<img>` для картинки Markdown, а `renderToStaticMarkup` добавляет
  `<link rel="preload" as="image">`.

### 3.2 `src/components/markdown/MarkdownView.tsx` (новый, отдельный чанк)

```ts
export interface MarkdownViewProps {
  source: string
  /** id записи-владельца: ссылка на саму себя не разрешается. */
  selfId?: string
  /** Задан — задачи кликабельны; получает новый исходник целиком. */
  onChange?: (next: string) => void
  /** Клик по вики-ссылке; по умолчанию useUi.getState().select(id). */
  onOpenItem?: (id: string) => void
  density?: 'normal' | 'compact'
  className?: string
}
export function MarkdownView(props: MarkdownViewProps): ReactElement
```

- `<Markdown remarkPlugins={[remarkGfm, remarkWikiLinks, remarkSoftBreaks]} urlTransform={mdUrlTransform}
  remarkRehypeOptions={{ footnoteLabel: 'Сноски', footnoteBackLabel: 'К тексту' }} components={…}>`. `rehypePlugins` нет.
  Обёртка — `<div className={cn('qd-md', className)} data-density={density}>`. Компонент — `memo`; объект `components`
  стабилен (`useMemo`), иначе поддерево пересоздаётся на каждый рендер.
- Компоненты:
  - `a`: адрес с `WIKI_SCHEME` → вики-ссылка (ниже); пустой `href` → `<span>` с детьми (небезопасный адрес — просто
    текст); `#…` → `<a>` с `onClick`: `preventDefault`, найти элемент с этим `id` внутри своего `.qd-md` и
    `scrollIntoView({ block: 'nearest' })` (адрес страницы не менять — там раздел приложения); остальное — как в
    `AutoLinkText`: `target="_blank" rel="noopener noreferrer"`, `onClick`: `stopPropagation`, в Tauri —
    `preventDefault` + `openLink(href)`.
  - вики-ссылка: цель → `resolveWikiLink(target, index, selfId)`, где `index = buildTitleIndex(useAllItems() ?? [])`
    (кэш `WeakMap` по массиву снимка на уровне модуля — один индекс на все просмотры). Нашлась —
    `<button type="button" className="qd-md-wiki">` с `onClick` → `onOpenItem(id)` (`stopPropagation`); нет —
    `<span className="qd-md-wiki" data-missing="true" title="Запись не найдена">`.
  - `img`: никогда не `<img>`. Безопасный `src` → ссылка `<a className="qd-md-img">` со значком
    `<Icon name="file-image" size={14} />` и текстом `alt || адрес` (поведение клика — как у обычной ссылки);
    небезопасный → текст `alt`.
  - `pre`: код из дочернего `code` (`node.children[0]`): язык — из класса `language-*` через `normalizeLanguage`
    (`lib/detect`), текст без завершающего `\n` → `<CodeView code language />`.
  - `code` (инлайн) — `<code>` без классов (вид даёт `markdown.css`).
  - `li`: если в `className` есть `task-list-item` — запомнить `node.position.start.offset` и передать флажку
    (контекст или замыкание в этом же компоненте); `input`: `<Checkbox className="qd-md-check" checked={…}>` из
    `ui/checkbox`; с `onChange` — `onCheckedChange` → `toggleTaskAt(source, offset)` → `onChange(next)` (если не
    `null`), `onClick` → `stopPropagation`; без `onChange` — `readOnly`, `tabIndex={-1}`.
  - `table` — в обёртке `<div className="qd-md-table">`.
- Импорт `lucide-react` запрещён; значки — `Icon`.

### 3.3 `src/components/markdown/MarkdownText.tsx` (новый, лёгкий — его импортируют остальные)

```ts
export type MarkdownTextProps = MarkdownViewProps
/** Лениво грузит MarkdownView. Пока грузится, при сбое загрузки и при source.length > MD_RENDER_MAX — <AutoLinkText text={source} />. */
export function MarkdownText(props: MarkdownTextProps): ReactElement
```

`lazyRetry(() => import('./MarkdownView'), (m) => m.MarkdownView)` + `ErrorBoundary` (`fallback` — `AutoLinkText`) +
`Suspense`. На уровне модуля — догрузка чанка в простое (`window.setTimeout(…, 2500)`, как `loadDetail` в `AppShell`).
(уточнено при сверке) Тип пропсов из `./MarkdownView` — только `import type` (иначе чанк склеится с основным);
догрузка — под `typeof window !== 'undefined'`; `ErrorBoundary` не умеет сбрасываться сам — после сбоя отрисовки
граница сбрасывается при смене `source` (например, `key`, растущий при смене `source` после ошибки), иначе исправленный
текст так и остался бы исходником.

### 3.4 `src/components/markdown/ViewModeToggle.tsx` (новый)

```ts
/** Переключатель «Просмотр / Исходник» (useUi.mdPreview). */
export function ViewModeToggle({ className }: { className?: string }): ReactElement
```

`role="group"` `aria-label="Вид текста"`, две кнопки с `aria-pressed`: «Просмотр» (`eye`) и «Исходник» (`code`).
К: как переключатель вида списка в `FilterBar` (рамка-контейнер, активная — `bg-muted text-foreground`), высота 24px,
`text-xs`, значок 14. П: `+ px-btn pixel:h-7.5 pixel:max-md:h-9`, контейнер `pixel:gap-1 pixel:border-0 pixel:p-0`.

### 3.5 `ContentEditor.tsx`, `ItemContent.tsx`, `LinkCard.tsx`

`ContentEditor` — новые пропсы (прежние вызовы остаются верными):

```ts
renderView: (value: string, api: { change: (next: string) => void }) => React.ReactNode
readOnly?: boolean                       // нет перехода в правку и кнопки «Изменить»; пустое значение — ничего не рисуется
toolbar?: React.ReactNode                // справа в строке под текстом (рядом с «Изменить»); только при непустом значении
onCommitted?: (value: string) => void    // выход из правки: blur, Ctrl/⌘+Enter, Esc, размонтирование во время правки
```

- `api.change(next)` = `setValue(next)` + `flush()` — сохранение идёт существующим путём автосохранения.
- `startEdit` не срабатывает на `button, a, input, [role="checkbox"]`.
- `readOnly`: обёртка без `cursor-text` и `hover:bg-muted/40`.
- `onCommitted` вызывается с текущим значением после `flush()`; при размонтировании — в cleanup, если шла правка.

`ItemContent({ item, readOnly? })`:
- текст и идея: `toolbar={<ViewModeToggle />}`; `renderView={(v, api) => mdPreview ? <MarkdownText source={v}
  selfId={item.id} onChange={readOnly ? undefined : api.change} /> : <AutoLinkText text={v} />}`;
  `onCommitted={(v) => void actApplyWikiLinks(item.id, v)}`;
- заметка к ссылке, файлу, изображению — то же, `density="compact"`;
- код — без изменений (плюс `readOnly`: выбор языка скрыт);
- `readOnly` передаётся в `ContentEditor` и `LinkCard`.

`LinkCard({ item, readOnly? })`: при `readOnly` нет кнопки «Обновить данные» и поля адреса; «Открыть» и «Копировать
ссылку» остаются.

### 3.6 `ConfirmHost.tsx`, `App.tsx`

`ConfirmHost()` рисует `useConfirm().request` через `ui/dialog`: `open={!!request}`, `onOpenChange` → закрытие =
`settle(false)`; `DialogContent showCloseButton={false}`; `DialogTitle`, `DialogDescription`, `DialogFooter`:
«Отмена» (`variant="outline"`, `autoFocus`) и кнопка подтверждения (`variant="destructive"` при `destructive`).
Текст запроса держать в состоянии до конца анимации закрытия (последний непустой запрос), чтобы диалог не схлопывался
пустым. `App.tsx`: `<ConfirmHost />` рядом с `<Toaster />`.
(уточнено при сверке) Фокус на «Отмена» надёжнее задать `initialFocus={cancelRef}` у `DialogContent` (проп `Dialog.Popup`
в `@base-ui/react` 1.9.0 есть; `ui/dialog` пробрасывает остальные пропсы), чем `autoFocus`: менеджер фокуса Base UI
ставит фокус сам. Возврат фокуса после закрытия (вызов не из кнопки-триггера) — проверить в браузере; не возвращается —
`finalFocus` с элементом, который был в фокусе до вопроса.

### 3.7 CSS (только этот пакет правит стили на этапе 4)

`src/index.css`: `@import "./styles/markdown.css";` после `pixel.css`; вне слоёв —
`.dark input[type="date"] { color-scheme: dark; }` (значок календаря в ночных палитрах, в т.ч. «Классики»).
(уточнено при сверке) `ThemeProvider` и `public/theme-init.js` уже ставят `style.colorScheme` на `<html>`, поле даты
его наследует — правило страховочное (на случай чужого `color-scheme` у предка), безвредно.

`src/styles/pixel.css`, раздел 5: `.pixel .px-flag[data-flag="trash"] { background: var(--danger); }`.

`src/styles/markdown.css` (новый). Базовые правила — в `@layer components` (это вид «Классики»), пиксельные отличия —
ниже, под `.pixel`, вне слоёв. Цвета — только токены; размеры шрифта — только переменные `--text-*`.

| Селектор | «Классика» | Пиксельные сцены |
|---|---|---|
| `.qd-md` | `font-size: var(--text-sm)`, `line-height: 1.6`, `overflow-wrap: anywhere` | `line-height: inherit` — базовое `1.6` из слоя действует и в П, а высоту строки там задаёт шрифтовой класс (`ft-soft`/`ft-pixel`: `1.25` на `body`) (уточнено при сверке) |
| `.qd-md > * + *`, то же внутри `li`, `blockquote`, `td` | `margin-top: .5rem` | `8px` |
| `h1` / `h2` / `h3` / `h4–h6` | `--text-lg` / `--text-base` / `--text-md` / `--text-sm`; `font-weight: 600`; `line-height: 1.3`; сверху `1rem` (у первого — 0) | вес `var(--fw-b)`; шрифт текста, не `--font-head` |
| `[data-density="compact"]` заголовки | все `--text-sm` | то же |
| `ul` / `ol` | `list-style: disc` / `decimal`; `padding-left: 1.25rem`; между пунктами `2px` | `padding-left: 20px` |
| `ul.contains-task-list` | `list-style: none`; `padding-left: 0` | — |
| `li.task-list-item` | `position: relative`; `padding-left: 1.5rem` | `padding-left: 24px` |
| `.qd-md-check` | `position: absolute; left: 0; top: .2em` | — |
| `blockquote` | `border-left: 2px solid var(--border)`; `padding-left: .75rem`; `color: var(--muted-foreground)` | `border-left: 4px solid var(--paper-line)`; `padding-left: 10px` |
| `hr` | `border-top: 1px solid var(--border)`; `margin: 1rem 0` | `2px solid var(--paper-line)` |
| `.qd-md-table` | `overflow-x: auto` | — |
| `table` | `border-collapse: collapse`; `font-size: var(--text-2sm)` | — |
| `th`, `td` | `border: 1px solid var(--border)`; `padding: .25rem .5rem`; `text-align: left`; `vertical-align: top` | `border: 2px solid var(--paper-line)` |
| `th` | `background: var(--muted)`; `font-weight: 600` | `background: var(--paper-2)`; вес `var(--fw-b)` |
| `:not(pre) > code` | моноширинный; `font-size: var(--text-xs)`; `background: var(--muted)`; `padding: 0 .25rem`; `border-radius: 4px` | `background: var(--paper-2)`; `outline: 2px solid var(--paper-line)`; `outline-offset: -2px` |
| `a`, `.qd-md-img` | `color: inherit`; `text-decoration: underline`; `text-underline-offset: 2px` | то же |
| `.qd-md-img` | `display: inline-flex`; `align-items: center`; `gap: .25rem` | — |
| `.qd-md-wiki` | `border-bottom: 1px dashed currentColor`; `cursor: pointer`; без подчёркивания; `font: inherit`; `text-align: left` | `border-bottom-width: 2px` |
| `.qd-md-wiki[data-missing]` | `color: var(--muted-foreground)`; `cursor: default` | — |
| `del` | `color: var(--muted-foreground)` | — |
| `sup` | `font-size: var(--text-2xs)` | — |
| `.footnotes` | `border-top: 1px solid var(--border)`; `padding-top: .5rem`; `font-size: var(--text-2sm)` | `2px solid var(--paper-line)` |

Brand как цвет текста и `--font-head` в тексте Markdown не используются. Фокус ссылок и кнопок в П — автоматический.

`docs/DESIGN.md`: в §5 — `data-flag="trash"`; новый короткий §12 «Markdown» (класс `qd-md`, где лежат правила, что
картинки — ссылкой, заголовки набраны шрифтом текста).

### 3.8 Проверка в браузере (порт 5180) и критерии готовности

Матрица `spec-stage3.md` §3.14 на панели деталей: запись-текст с заголовками, списком, цитатой, таблицей, кодом,
ссылкой, картинкой, `[[вики-ссылкой]]` (на существующую запись и на несуществующую), задачами.
1. «Просмотр»: разметка отрисована, одиночные переводы строк сохранены, картинка — ссылка, сетевых запросов к
   чужим хостам нет (вкладка Network).
2. Клик по флажку меняет исходник (проверить в «Исходнике» и после перезагрузки), панель в правку не переходит.
3. Клик по вики-ссылке открывает запись; после правки с новой `[[…]]` и ухода из поля появляется связь и toast.
4. Клик по тексту — правка; Esc возвращает исходное; «Исходник» ↔ «Просмотр» сохраняется после перезагрузки.
5. Заметка у ссылки и у файла — тот же рендер, компактные заголовки.
6. `confirmDialog` из консоли (`(await import('/src/store/confirm.ts')).confirmDialog({ title: 'Проверка', destructive: true })`):
   диалог в К и П, Esc и «Отмена» → `false`, подтверждение → `true`, фокус возвращается.
7. `npm run build`: `MarkdownView` — отдельный чанк, основной чанк не вырос на `react-markdown`.

## 4. Сквозные правила волны 1

1. Действуют `spec-stage3.md` §3 (п. 1–15) и `docs/DESIGN.md`. Стили (`src/styles/*`, `src/index.css`) и `ui/*` не
   править; не хватает правила — в отчёт.
2. Новые атрибуты состояния, разрешённые на этапе 4: `data-flag="trash"`, `data-density`, `data-missing`.
3. Запись в БД — через `db/repo.ts`; типовые действия — через `lib/actions.ts`; ошибки — `toast.error(describeError(e))`.
4. Подтверждения — только `actPurgeAsk` / `actEmptyTrashAsk` / `confirmDialog`. `window.confirm` запрещён.
5. Тексты — по-русски, дословно из спецификации. Существующие тексты и `aria-label` не менять, кроме названных.
6. Существующие сценарии и клавиши не ломать (`CLAUDE.md` «Горячие клавиши»).
7. Пока работают соседи, `npm run typecheck` может падать на чужих файлах: отвечать за свои файлы, расхождения
   перечислить в отчёте. `npm test` — зелёный. (уточнено при сверке) Типовых стыков между пакетами волны 1 нет — каждый
   опирается только на волну 0; остаются стыки поведения: пункты меню корзины в деталях (`ItemMenu` — пакет `list`),
   отрисовка раздела «Корзина» (`AppShell` + `TrashView` — пакет `list`). Пакетам, которые до них доходят
   (`shell-nav`, `detail`, `capture-palette`), проверять своё: смену раздела (`useUi.getState().view === 'trash'`,
   адрес `#/trash`) и собственные элементы, а не содержимое чужих.
8. Браузер: свой dev-сервер `npm run dev -- --port <порт> --strictPort`; матрица §3.14 этапа 3 («Осень» день/ночь,
   «Классика» день/ночь, 1280 и 390px; бегло «Луг», «Бумага», «Зима»). «Классика» на нетронутых экранах — без отличий.

## 5. Пакеты волны 1

### 5.1 `shell-nav` — боковая панель: корзина и сохранённые поиски

`NavButton.tsx` (новый): перенести из `Sidebar.tsx` без изменений `NavButton` и `SectionHeader`, экспортировать оба.
(уточнено при сверке) Единственное добавление — необязательный проп `title?: string` у `NavButton` (передаётся
`<button>`): у нынешнего `NavButton` его нет, а строке поиска нужна подсказка с запросом.

`Sidebar.tsx`:
- `NAV_ITEMS`: после «Архив» — `{ view: 'trash', label: 'Корзина', icon: 'trash', count: 'trash' }` (комментарий про
  граф остаётся). Счётчики: `{ ...useCounts(), trash: useTrashCount() }`; у корзины счётчик обычный (не brand),
  скрыт при нуле — как у остальных.
- Между списком разделов и «Категориями» — `<SavedSearches />`.

`SavedSearches.tsx` (новый) — `export function SavedSearches()`:
- `useSavedSearches()`; пусто → `null`. Заголовок — `SectionHeader title="Поиски"` (сворачивается, как «Категории»).
- Строка: обёртка `group/ss relative flex items-center`; `NavButton` (значок `bookmark`, подпись — имя, `title` —
  запрос) → `actApplySearch(search)`; `active` — `useUi.query.trim() === search.query` и фильтр пуст.
- Справа — кнопка-меню «…» (`Button variant="ghost" size="icon-xs"`, `aria-label="Действия с поиском «<имя>»"`,
  значок `more`; видна при наведении/фокусе строки, на сенсорном экране — всегда; П: `+ px-btn pixel:size-7.5
  pixel:max-md:size-9`). Пункты `DropdownMenu`: «Переименовать» (`pencil`), «Выше» (`arrow-up`, выключен у первого),
  «Ниже» (`arrow-down`, выключен у последнего) → `actMoveSearch`, разделитель, «Удалить» (`trash`, destructive) →
  `actDeleteSearch(search)` (toast с «Отменить» уже есть).
- Переименование — поле на месте строки (образец — `NewCategory` в `Sidebar`: те же классы, `maxLength =
  SAVED_SEARCH_NAME_MAX`, `aria-label="Название поиска"`): Enter и blur → `actRenameSearch` (при `false` поле
  остаётся), Esc — отмена (`stopPropagation`).
- Телефон: применённый поиск закрывает меню сам (`applyQuery` сбрасывает `navOpen`).

Готово, когда: пункт «Корзина» с числом; сохранённые поиски применяются, переименовываются (ошибка имени-дубля —
toast), двигаются, удаляются с отменой; активный поиск подсвечен; К и П; 390px (меню).
Сценарии: создать поиск из консоли (`(await import('/src/db/repo.ts')).createSavedSearch('Неделя', 'is:library date:week')`)
→ строка появилась → клик → раздел «База знаний», запрос в строке поиска → переименовать → «Ниже» → удалить → «Отменить».
Клик по «Корзине» проверять сменой раздела (`#/trash`, пункт подсвечен): сам раздел рисует пакет `list` (уточнено при
сверке).

### 5.2 `list` — списки: корзина, клавиши, разделители по дням

`trashContext.ts` (новый): `export const TrashDaysContext = createContext<number>(DEFAULT_SETTINGS.trashDays)`.

`ItemCard.tsx`:
- `ItemVariant` += `'trash'`. `sameItem` дополнительно сравнивает `deletedAt` (перенос в корзину не меняет `updatedAt`).
- `const trashed = item.deletedAt !== undefined` — в `ItemRow` и `ItemCard`:
  - заголовок `+ text-muted-foreground` (вместо `text-foreground`);
  - вместо относительного времени создания — `<TrashMeta item />`: «удалено <formatRelative(deletedAt)>» и, если
    `trashDaysLeft(...) !== null`, — `trashLeftLabel` (при остатке ≤ 3 — `text-destructive`). К: одной строкой через
    « · »; П: в колонке метаданных — двумя строками. `title` — «Удалено: <formatDateTime(deletedAt)>». Срок берётся из
    `TrashDaysContext`, «сейчас» — `Date.now()` при рендере;
  - правый флажок: `data-flag="trash"`; левый (избранное) — как есть; звезда `StarMark` не показывается
    (уточнено при сверке: флажки есть только у строки `ItemRow`, у карточки сетки их нет — там только без звезды);
  - `QuickActions`: «Восстановить» (`undo`) → `actRestoreFromTrash(item.id)`; «Удалить навсегда» (`trash`, destructive)
    → `actPurgeAsk(item.id)`. Ветки по `variant` — только для записей вне корзины.
- Мобильная строка метаданных (`md:hidden`) получает тот же `title` с точной датой, что и настольная.
- `snippetOf`, ветка по умолчанию: строка заголовка — `derivedTitleLine(item)?.index` (а не первая непустая);
  `null` (в content нет значимой строки, заголовок «Без названия») — сниппет из всего content (уточнено при сверке).
- `CardPreview`, ветка по умолчанию: `stripMarkdown(item.content.slice(0, 600)).slice(0, 400)`.

`ItemMenu.tsx`, `itemActionList(item)`:
- запись в корзине: «Открыть ссылку» (если ссылка), «Копировать», «Скачать» (если файл), «Восстановить» (`undo`,
  `shortcut: 'E'`), «Удалить навсегда» (`trash`, destructive, `shortcut: 'Del'`) → `actRestoreFromTrash` / `actPurgeAsk`;
- запись вне корзины: прежний список + перед «Удалить» — `{ id: 'export-md', label: 'Скачать как Markdown',
  icon: 'file-text' }` для типов `text`, `idea`, `code`, `link` → `actDownloadMarkdown(item)`.

`BulkBar.tsx`: проп `trashed?: boolean`. При `trashed` — только счётчик, «Восстановить» (`undo`) →
`actRestoreFromTrash(ids)`, «Удалить навсегда» (`trash`, `hover:text-destructive`) → `actPurgeAsk(ids)`, «Снять
выбор». Долг: `text-[0.8rem]` у `CategorySelect` → `text-2sm`.

`ItemList.tsx` (пропсы прежние, `variant` принимает `'trash'`):
- `const trashQuery = parseQuery(query).filter.trashed === true`; `const wantTrashed = variant === 'trash' || trashQuery`.
- `inSection(item, variant, wantTrashed)`: `(item.deletedAt !== undefined) !== wantTrashed` → `false`; при
  `wantTrashed` → `true`; иначе прежние проверки статуса.
- Все три поиска открытой записи в снимке — через `getItemsWithTrashSnapshot()`.
- Клавиши (`targets()` делится на `live` — без `deletedAt` и `gone` — в корзине):
  `E` — `gone` → `actRestoreFromTrash`, `live` — как раньше; `A`, `F` — только `live` (нет `live` — клавиша
  поглощается без действия); `Delete`/`Backspace` — `gone` → `actPurgeAsk`, `live` → `actDelete`. Остальные клавиши,
  защита от автоповтора, `sheetOpen` — без изменений.
- Провайдер `TrashDaysContext` со значением `useSettings()?.trashDays ?? DEFAULT_SETTINGS.trashDays`.
- `<BulkBar variant={variant} trashed={wantTrashed} />`.
- Разделители по дням вместо `GROUP_LABELS`/`dateGroup` (удалить): `grouped = layoutMode === 'list' &&
  queryWords(parseQuery(query).text).length === 0 && (variant === 'trash' || sort !== 'title')`; отметка строки:
  `variant === 'trash'` → `deletedAt ?? createdAt`, `sort === 'updated'` → `updatedAt`, иначе `createdAt`;
  `groupByDay(hits.slice(0, shown), tsOf, now)`, где `now` зависит от `useDayKey()` (подписи меняются в полночь).
  Разметка заголовка прежняя, `key` — из `DayEntry`.

Готово, когда: в выдаче `is:trash` и в разделе «Корзина» строки и карточки выглядят удалёнными, действия, меню,
массовая панель и клавиши — «Восстановить» / «Удалить навсегда»; обычные разделы ведут себя как раньше; разделители
по дням; К и П.
Сценарии: удалить запись (Del) → toast «В корзине» → в поиске `is:trash` строка с «удалено только что · ещё 30 дн.» →
`E` возвращает → снова удалить → `Del` в `is:trash` → диалог → «Отмена» (запись на месте) → `Del` → «Удалить навсегда»
(строка исчезла, курсор на соседней) → отметить две записи (X) → панель с двумя кнопками → сортировки «новые»,
«изменённые», «по названию» (заголовков дней нет) → сетка (заголовков нет) → J/K/Enter/E/A/F в «Входящих» как раньше.

### 5.2a `list` (продолжение) — раздел «Корзина»

(уточнено при сверке) Перенесено из §5.3: `TrashView` зависит от `variant="trash"` этого же пакета. Образец разметки —
`src/views/ItemsView.tsx` (ничей, не править).

`AppShell.tsx`: `VIEWS` += `'trash'`; `ActiveView`: `case 'trash': return <TrashView />` и `default: return null`
(раздел «Граф» — этап 5). Больше ничего.

`TrashView.tsx` (новый) — `export function TrashView()`:
- `useVisibleItems({ trashed: true })`; если в запросе нет слов (`queryWords(parseQuery(query).text).length === 0`) —
  упорядочить `hits` по `deletedAt` по убыванию (`useMemo`).
- Разметка `section` и `h1` — как в `ItemsView` (те же классы, `aria-label="Корзина"`). Шапка: заголовок «Корзина»,
  счётчик «N из M», подсказка клавиш (тот же класс, что `KEY_HINT`): «J/K — выбор · Enter — открыть · E —
  восстановить · Del — удалить навсегда»; под заголовком — пояснение: при `trashDays > 0` «Записи удаляются
  окончательно через <trashDaysLabel> после удаления», иначе «Автоочистка выключена»; ссылка-кнопка «Изменить срок» →
  `setView('settings')`. Справа — `Button variant="outline" size="sm"` «Очистить корзину» (`trash`,
  `hover:text-destructive`, выключена при `useTrashCount() === 0`) → `actEmptyTrashAsk()`.
- `<ItemList hits={ordered} variant="trash" layout="list" emptyState={…} />` (как в `ItemsView`: не рисовать, пока
  `loading`). Пусто без поиска: `EmptyState icon="trash" title="Корзина пуста"` с описанием «Удалённые записи лежат
  здесь <срок>, затем удаляются окончательно.» (при выключенной автоочистке — «…пока вы не очистите корзину.»);
  пусто при поиске: `search-x`, «Ничего не найдено», кнопка «Сбросить поиск» (`setQuery('')`).

Готово, когда (дополнительно к §5.2): `#/trash` открывает раздел; «Очистить корзину» спрашивает и очищает; К и П; 390px.
Сценарии: корзина — пустое состояние (срок и «не очищать»), с записями (разделители по дате удаления), поиск по
корзине (пусто — «Сбросить поиск»), «Изменить срок» → настройки, «Очистить» → диалог → «Отмена» / «Очистить».

### 5.3 `views-filter` — даты, сохранение поиска, дубль в строке быстрой записи, разбор

(уточнено при сверке) `AppShell.tsx` и `TrashView.tsx` — в пакете `list` (§5.2a).

`FilterBar.tsx`:
- `PeriodFilter` — `Popover` вместо меню. Удалить `PERIODS`, `periodStart`, `currentPeriod`.
  - Кнопка: `FilterButton icon="calendar"`; подпись: быстрый период (`!customDates && presetOf(from, to, now)`) — его
    `label`; иначе при заданных датах — `formatDateRange(from, to)`; иначе «Период». `active` — заданы даты.
  - Содержимое (`w-64 gap-2 p-2`): `role="radiogroup"` `aria-label="Период"` из кнопок `role="radio"` (стрелки —
    `radioGroupKeyDown` из `@/views/settings/radioKeys`): «Всё время» → `setDateRange(null)`, затем `DATE_PRESETS` →
    `setDateRange(relativeRange(id, Date.now()))`; класс строк — как у пунктов `TagsFilter` (`px-nav`, отмеченная —
    `aria-checked`, `font-medium`, значок `check`).
  - Разделитель, подпись «Свой период», два поля `Input type="date"` (`min="1970-01-01"` `max="2999-12-31"`,
    `aria-label` «С даты» / «По дату», высота как у поля «Найти тег»); значения — `formatDateToken` границ, если
    `customDates`, иначе пусто (локальное состояние, синхронизация при открытии). На каждое изменение —
    `customDateRange(a, b)`: `ok` → `setDateRange(range, true)` (`range === null` → `setDateRange(null)`); ошибка →
    текст `role="alert"` `text-xs text-destructive` и `aria-invalid` на обоих полях, фильтр не меняется.
- Строка активных фильтров показывается при `hasActive || query.trim() !== ''`. Два чипа дат заменить одним:
  «Период: <подпись кнопки>» → `setDateRange(null)`. После чипов — `<SaveSearchButton />`; «Сбросить фильтры» — только
  при `hasActive`.

`SaveSearchButton.tsx` (новый) — `export function SaveSearchButton()`:
- `Popover`; кнопка `Button variant="ghost" size="xs"` со значком `bookmark` и текстом «Сохранить поиск».
- Содержимое (`w-72 gap-2 p-2`): запрос `currentSearchQuery({ view, query, filter, customDates }, categories)` — строкой
  `font-mono text-xs text-muted-foreground break-all`; если поиск с таким запросом уже есть — текст «Уже сохранён как
  «<имя>»» и кнопка выключена; иначе `Input` (имя, `autoFocus`, по умолчанию `suggestSearchName(запрос, имена)`,
  `maxLength = SAVED_SEARCH_NAME_MAX`, `aria-label="Название поиска"`) и `Button size="sm"` «Сохранить». Enter в поле
  и кнопка → `actSaveCurrentSearch(name)`; успех — закрыть поповер; ошибка (toast показан) — остаться.

`InboxView.tsx`, `QuickAdd.submit`: перед `createAndEnrich` — если ввод — ссылка и
`findDuplicateLinkIn(getAllItemsSnapshot() ?? [], url)` нашёл запись, открыть полную панель
(`openCapture({ text: value, source: 'manual' })` — без `source` панель сочла бы ввод вставкой, уточнено при сверке),
очистить поле и выйти: предупреждение покажет `QuickCapture`.

`TriageMode.tsx`: содержимое текста и идеи (абзац с `item.content`, строка ~112) — `<MarkdownText source={item.content}
selfId={item.id} />` в прежней обёртке с её классами размера и цвета (без `whitespace-pre-wrap`). Заметки у ссылки и
файла — без изменений. Клавиши разбора не трогать. (уточнено при сверке) Обёртка `<p>` становится `<div>` (блоки
Markdown внутри `<p>` недопустимы), а классы размера и цвета (`text-md leading-relaxed text-foreground/90`) идут в
`className` у `MarkdownText`: правило `.qd-md { font-size }` задаёт размер на самом элементе, наследованный от обёртки
не подействует; утилиты сильнее `@layer components`.

Готово, когда: период из трёх быстрых вариантов и своих дат отбирает записи и показывается чипом; «Сохранить поиск»
создаёт поиск с разделом и датами; К и П; 390px.
Сценарии: «База знаний» → «Период» → «За неделю» → чип «Период: За неделю» → «Сохранить поиск» (в запросе
`is:library date:week`) → свой период с 1-го по 10-е → чип с датами → сохранить (в запросе `date:…..…`) → начало позже
конца — ошибка, отбор прежний → «Всё время» → в строке быстрой записи «Входящих» ввести уже сохранённый адрес →
открывается панель с предупреждением (строку предупреждения рисует пакет `capture-palette`: до его сдачи проверять, что
открылась панель с адресом и запись не создана) → «Разобрать»: текст с разметкой отрисован.

### 5.4 `detail` — панель деталей: корзина, даты, файлы .md

`ItemDetail.tsx`:
- `missing` — по `useItemsWithTrash()`.
- `const trashed = item.deletedAt !== undefined`. При `trashed` панель только для чтения:
  - шапка: тип — статичной подписью (без меню смены), чип «В корзине» (вместо статуса), нет звезды и `PrimaryAction`;
    кнопка `Button size="sm" variant="outline"` «Восстановить» → `actRestoreFromTrash(item.id)`; `ItemMenu`
    (`variant="detail"` — пункты для корзины даёт пакет `list`); «Назад» / «Закрыть» — как есть;
  - первым блоком тела — плашка `role="note"` (`rounded-lg border border-border bg-muted/50 p-2 text-2sm px-well`):
    «Запись в корзине. Удалена <formatDateTime(deletedAt)>.» и, если `trashPurgeAt` не `null`, — «Удалится
    окончательно <formatDayLabel(purgeAt)> (<trashLeftLabel>)» (подпись дня — со строчной буквы; при остатке `0` —
    «Удалится окончательно сегодня» без скобок, иначе выходит «сегодня (удалится сегодня)», уточнено при сверке); кнопка
    `variant="ghost" size="sm"` «Удалить навсегда» (`hover:text-destructive`) → `actPurgeAsk(item.id)`;
  - `<TitleField item readOnly />`, `<ItemContent item readOnly />`, `AiSummary`;
  - «Организация»: `CategoryBadge size="md"` и теги `TagChip` без `onRemove`/`onClick` (нет ни того, ни другого —
    блок не рисуется);
  - `<LinkedItems item readOnly />`; `AiSuggest` не рисуется;
  - срок корзины: `useSettings()?.trashDays ?? DEFAULT_SETTINGS.trashDays`.
- `Meta`: значения дат — в `<time dateTime={ISO}>` (негодная отметка — без `time`); для записи в корзине после
  «Обработано» — строка «Удалено». «Создано» и «Изменено» с точным временем уже есть — оставить.

`TitleField.tsx`: проп `readOnly?: boolean` → `<h2 className="px-1 -mx-1 text-lg leading-snug font-semibold break-words">`
с `displayTitle(item)` вместо поля.

`LinkedItems.tsx`: проп `readOnly?: boolean` → нет `LinkPicker`, кнопок «Убрать связь» и блока «Похожие»; связей нет —
секция не рисуется. Переход по клику остаётся.

`FilePreview.tsx` (вид `full`, не изображение):
- файл больше `MAX_TEXT_BYTES` → вместо молчания текст `text-xs text-muted-foreground`: «Файл больше 200 КБ —
  содержимое не показывается, скачайте файл»;
- `isMarkdownFile(item)`: над содержимым — строка с `<ViewModeToggle className="ml-auto" />`; при `mdPreview` —
  `<MarkdownText source={text} selfId={item.id} />` в блоке `px-well max-h-[70vh] overflow-auto rounded-lg border
  border-border bg-muted/50 px-3 py-2` (без `onChange`: задачи не кликабельны); иначе — нынешний `<pre>`;
- прочие текстовые файлы — как сейчас.

Готово, когда: запись из корзины открывается только для чтения с «Восстановить» / «Удалить навсегда»; после
восстановления панель становится обычной, после окончательного удаления закрывается; файл `.md` показывается с
разметкой и исходником; К и П; лист на 390px.
Сценарии: `is:trash` → Enter → панель без полей ввода, даты «Создано / Изменено / Удалено» → «Восстановить» → панель
редактируемая → удалить, открыть, «Удалить навсегда» → «Отмена» → подтвердить → панель закрылась; запись-ссылка в
корзине (нет «Обновить данные» и поля адреса); прикрепить `notes.md` → «Просмотр» / «Исходник»; файл `.md` больше
200 КБ → пояснение. (уточнено при сверке) Пункты меню «…» для записи в корзине даёт пакет `list` — их не проверять;
запись из корзины открывать через `is:trash` в обычном разделе (раздел «Корзина» рисует `list`).

### 5.5 `capture-palette` — предупреждение о дубле, команды палитры

`QuickCapture.tsx`:
- Долг: тип `DraftWithSource` и приведения убрать — поле `source` теперь есть в `CaptureDraft`.
- Состояние: `const items = useAllItems()`; `const shownUrl = useDebounced(linkUrl, 300)`;
  `const passive = shownUrl ? findDuplicateLinkIn(items ?? [], shownUrl) : undefined`;
  `dupOk: string | null` — `linkKey` адреса, для которого нажато «Всё равно добавить»;
  `dupAsk: { item: Item; keepOpen: boolean } | null` — сохранение остановлено.
  Показываемый дубль: `dupAsk?.item ?? passive`, если `linkKey(linkUrl) !== dupOk`. Смена `linkKey(linkUrl)`
  сбрасывает `dupAsk`.
- `save(keepOpen, allowDup = false)`: в ветке без файлов после `buildInput(base)` — если это ссылка, `!allowDup`,
  `dupOk !== linkKey(input.url)` и `findDuplicateLinkIn(getAllItemsSnapshot() ?? [], input.url)` нашёл запись:
  `setDupAsk({ item, keepOpen })`, снять `saving` (и `savingRef.current = false`, и `setSaving(false)` — иначе
  следующая попытка сохранить молча выходит, уточнено при сверке), фокус на кнопку «Открыть», выйти без создания.
- (уточнено при сверке) `passive` считать только при `linkUrl && shownUrl === linkUrl`: иначе после стирания адреса
  старая строка висела бы ещё 300 мс, а при наборе показывала бы дубль прежнего адреса.
- Строка под адресом ссылки (`linkUrl`): `flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border
  border-border bg-muted/50 p-2 text-2sm px-well`; `role="status"`, при `dupAsk` — `role="alert"`. Текст: «Такая
  ссылка уже есть: » + `<span className="font-medium">` с `displayTitle(item)` (обрезка `truncate`) + для архивной —
  « (в архиве)». Кнопки: «Открыть» (`variant="outline" size="sm"`) — убрать черновик (если не `initial.preserved`),
  `doneRef.current = true`, `closeCapture()`, `openItemInSection(item)`; «Всё равно добавить» (`variant="ghost"
  size="sm"`) — `setDupOk(linkKey(linkUrl))`, `setDupAsk(null)`, `save(dupAsk?.keepOpen ?? false, true)`.
- Ввод строка не перехватывает: фокус остаётся в поле, пока не было попытки сохранить. Ветка с файлами и остальные
  сценарии (черновик, вопрос о файлах, Enter/Ctrl+Enter/Ctrl+Shift+Enter) — без изменений.

`CommandPalette.tsx`:
- `openItem` → `openItemInSection(item)` + `close()`; локальные `STATUS_VIEW` убрать.
- Действия (на месте комментария-заглушки, перед «Перейти: Настройки»): «Перейти: Корзина» (`trash`) → `go('trash')`;
  «Очистить корзину» (`trash`; только при `useTrashCount() > 0`) → `close()`, `actEmptyTrashAsk()`; «Сохранить текущий
  поиск» (`bookmark`; только при `isNarrowed(query, filter)`) → `close()`, `actSaveCurrentSearch()`.
- Группа «Поиски» (после «Действий»): `useSavedSearches()`, отбор по имени (`fold(name).includes(needle)`), без ввода —
  первые 5; пункт: значок `bookmark`, имя, справа запрос `text-xs text-muted-foreground truncate` → `actApplySearch`,
  `close()`.
- Комментарий про граф оставить.
- (уточнено при сверке) Список `actions` собран в `useMemo([setScene])`: условные пункты зависят от `useTrashCount()`
  и `isNarrowed(query, filter)` (`query`/`filter` — из `useUi`, не ввод палитры) — добавить их в зависимости.
- Проверка «Перейти: Корзина» — смена раздела (`#/trash`); сам раздел рисует пакет `list`.

Готово, когда: дубль виден при вставке адреса, не мешает вводу, останавливает сохранение по Enter и Ctrl+Enter;
оба действия работают; палитра открывает корзину, очищает её с подтверждением, применяет и сохраняет поиски; К и П.
Сценарии: сохранить `https://example.com/a?utm_source=x` → открыть панель, вставить `http://www.example.com/a/` →
через ~0,3 с строка → Enter сразу после вставки (до появления строки) — запись не создана, строка стала заметной,
фокус на «Открыть» → Enter — открылась существующая → повторить, «Всё равно добавить» — создана вторая → адрес записи
из архива — приписка «(в архиве)» → адрес записи из корзины — предупреждения нет → текст, код, файлы — без строки.

### 5.6 `settings` — корзина, копии, экспорт

`SettingsView.tsx`: после `<DataSection />` — `<BackupSection settings={settings} />`.

`ShortcutsSection.tsx`: «В списке: удалить» → «В списке: в корзину»; добавить строки `{ keys: [['E']], label: 'В корзине:
восстановить' }` и `{ keys: [['Del']], label: 'В корзине: удалить навсегда' }`.

`DataSection.tsx`:
- Плитка «В корзине»: число записей и размер файлов (`useTrashedItems()`), например «3, 1,2 МБ».
- Строка `Row` «Корзина»: слева подпись «Хранить удалённое» и пояснение `text-xs text-muted-foreground` «Записи
  старше срока удаляются при запуске и раз в 6 часов»; справа `Select` (`TRASH_DAYS_OPTIONS`, подписи
  `trashDaysLabel`; текущее значение вне списка — дополнительным пунктом) → `setSetting('trashDays', n)` + `saved()`;
  кнопка `variant="outline"` «Очистить корзину» (выключена при пустой) → `actEmptyTrashAsk()`.
  Настройки читать через `useSettings()`.
- `reportText`: после числа записей, если `r.trashed > 0`, — « (в корзине: N)».

`BackupSection.tsx` (новый) — `export function BackupSection({ settings }: { settings: Settings })`,
`Section id="backup" title="Копии и экспорт в папку"`.
- Вне Tauri (`!isTauri()`): только текст `text-2sm text-muted-foreground`: «<DESKTOP_HINT>: автоматические
  резервные копии и экспорт всей базы в папку Markdown. В браузере копию можно сохранить кнопкой «Экспорт резервной
  копии», а отдельную запись — пунктом меню «Скачать как Markdown».»
- Автокопии:
  - `Row` «Папка для копий»: путь (`truncate`, `title` — полный; не выбрана — «не выбрана») и кнопки «Выбрать…»,
    «Показать в проводнике» (`folder-open`; при выбранной папке → `revealInExplorer(dir)`, `false` → toast.error «Не
    удалось открыть папку»), «Сбросить» (при выбранной).
    «Выбрать…»: `pickDirectory({ purpose: 'backup', defaultPath: settings.backupDir || undefined })`; `null` — ничего;
    иначе `await setSetting('backupDir', picked)`; затем `if (shouldForgetDir(prev, picked, settings.mdExportDir))
    void forgetDirectory(prev)`; затем `void checkAutoBackup()`. «Сбросить»: `setSetting('backupDir', '')` + тот же
    отзыв. Путь вручную не вводится.
  - `Row` «Периодичность»: `Select` по `BACKUP_PERIODS` с `BACKUP_PERIOD_LABEL` → `setSetting('backupEvery', v)`; не
    `off` и папка выбрана → `void checkAutoBackup()`; не `off` без папки — пояснение «Выберите папку: без неё копии
    не создаются».
  - `Field` «Хранить копий»: `CommitInput type="number"`, проверка — целое от `BACKUP_KEEP_MIN` до `BACKUP_KEEP_MAX`
    («Число от 1 до 100») → `setSetting('backupKeep', n)`.
  - `Row`: слева «Последняя копия: <formatDateTime(backupLastAt)>» или «Последняя копия: ещё не создавалась»; под ней,
    если есть `autoBackupStatus().lastError`, — `text-xs text-destructive`. Справа `Button variant="outline"` «Сделать
    копию сейчас» (на время работы — значок `loader` с `animate-spin`, кнопка выключена) → `runBackupNow()` →
    `backupResultMessage(result)` → toast по `kind`; при `done` — действие toast «Показать» → `revealInExplorer(path)`.
- Экспорт в Markdown:
  - `Row` «Папка для Markdown» — то же с `purpose: 'export'`, настройкой `mdExportDir` и
    `shouldForgetDir(prev, picked, settings.backupDir)`.
  - Пояснение: «Каждая запись — файл .md, вложения — в папке attachments. Файлы с теми же именами перезаписываются,
    остальное в папке не трогается. Записи из корзины не выгружаются.»
  - Кнопка «Экспортировать в Markdown» (выключена без папки и во время работы): `items = getAllItemsSnapshot() ?? []`,
    `entries = buildMarkdownExport(items, await listCategories())`, `exportDocsToDir(dir, entries, { signal,
    onProgress })`. Во время работы: «Экспорт: <done> из <total>», полоса (дорожка `h-1.5 w-full bg-muted
    pixel:h-2 pixel:border-2 pixel:border-wood-dark pixel:bg-paper-line`, заполнение `bg-foreground pixel:bg-leaf`,
    ширина — `style`), кнопка «Отмена» (`AbortController.abort()`).
  - Итог (остаётся под кнопкой до следующего запуска): «Готово: заметок N, вложений M, <formatBytes(bytes)>» +
    «Показать в проводнике»; при `failed.length` — «Не записано: K» и первые 5 строк «<путь>: <ошибка>»
    (`text-xs text-muted-foreground`). Исключение: «Экспорт отменён» → `toast('Экспорт отменён')`, прочее →
    `toast.error(describeError(e))`. Размонтирование секции во время экспорта — `abort()`.

Готово, когда: срок корзины меняется и сохраняется; в браузере секция показывает пояснение; отчёт импорта называет
записи корзины; в К и П ничего не обрезано на 390px. Работа кнопок копий и экспорта в окне Tauri проверяется основной
сессией (§8) — в отчёте перечислить непроверенное.
Сценарии (браузер): «Данные» → «Хранить удалённое» → «7 дней» → перезагрузка → значение на месте → «Очистить корзину» →
диалог → импорт копии с записью в корзине → «Записей: 3 (в корзине: 1)…» → секция «Копии и экспорт в папку» с
пояснением → строки клавиш. Вёрстку настольных блоков смотреть так: в консоли `window.__TAURI_INTERNALS__ = {}`,
затем уйти из «Настроек» и вернуться (`isTauri()` читается при каждом рендере) — блоки копий и экспорта появятся, их
кнопки покажут ошибку вызова (это ожидаемо); после проверки перезагрузить страницу.

### 5.7 `tauri-forget` — команда `forget_directory`

`backup.rs`:

```rust
impl ApprovedDirs {
    /// Убирает папку из подтверждённых. true — что-то убрано. Пустая строка и неполный путь — Ok(false).
    pub fn forget(&self, dir: &str) -> Result<bool, String>
}

#[tauri::command]
pub async fn forget_directory(dir: String, approved: tauri::State<'_, ApprovedDirs>) -> Result<bool, String>
```

- Убираются записи, равные запрошенному пути (после `trim`) или его каноническому виду, и записи, чей канонический
  вид совпадает с каноническим видом запрошенного. Папка недоступна (диск отключён) — работает только точное
  совпадение строк.
- Канонизация — без удержания мьютекса (как в `resolve`): снять копию списка, вычислить убираемые, затем под
  мьютексом отфильтровать текущий список. Сначала файл (`save_dirs`), потом память; сбой записи — `Err("Не удалось
  забыть папку: …")`, список не меняется. Нечего убирать — файл не переписывается.
- `lib.rs`: `backup::forget_directory` в `generate_handler!`. Права (`capabilities`) не меняются.
- Тесты: убирает точное совпадение и путь с `..`; неизвестная папка → `false`, файл не тронут; после `forget`
  `resolve` отвечает «Папка не подтверждена»; остальные записи целы; сохраняется после перезагрузки списка; сбой записи
  оставляет список прежним; пустая строка и относительный путь → `Ok(false)`; недоступная папка убирается по строке.

Готово, когда: `cargo test --manifest-path src-tauri/Cargo.toml` и `cargo check --all-targets` чистые.

## 6. Клавиши

Новых глобальных клавиш нет; `useHotkeys.ts` не меняется (у «Корзины» нет цифры). Меняется только список:

| Клавиша | Запись вне корзины | Запись в корзине |
|---|---|---|
| `E` | в базу знаний / вернуть из архива (как раньше) | восстановить |
| `A`, `F` | как раньше | не действуют |
| `Del`, `Backspace` | в корзину (toast «Отменить») | удалить навсегда (подтверждение) |
| `J/K`, стрелки, `Enter`, `O`, `X`, `Ctrl/⌘+A`, `Esc` | как раньше | как раньше |

В быстрой записи: Enter / Ctrl/⌘+Enter при найденном дубле ссылки не сохраняют, а переводят фокус на «Открыть».
В редакторе текста: Ctrl/⌘+Enter, Esc, blur — как раньше; дополнительно создают связи по `[[…]]`.

## 7. Долги из HANDOFF — кто делает

| Долг | Пакет |
|---|---|
| `is:trash` в обычном разделе: карточка, меню, массовые действия, клавиши | `list` |
| `ItemDetail`: `missing` через `useItemsWithTrash()`, запись в корзине — только чтение | `detail` (+ `readOnly` у `ItemContent`/`LinkCard` — `core-ui`) |
| `QUOTA_MESSAGE`, `tooBig` — «очистите корзину»; отчёт импорта — записи в корзине | `core-logic`, показ — `settings` |
| `forget_directory` при смене папки | `tauri-forget` (Rust), `core-logic` (`forgetDirectory`, `shouldForgetDir`), `settings` (вызов) |
| `backupDir` / `mdExportDir` только из `pickDirectory()` | `settings` |
| Свой период → `{ relativeDates: false }` | `core-logic` (`customDates`, `currentSearchQuery`), `views-filter` |
| `AppShell`: `VIEWS` и `ActiveView` не знают `trash` | `list` (`graph` — этап 5; уточнено при сверке — было `views-filter`) |
| Заголовок карточки показывает маркеры Markdown | `core-logic` (Р7), `list` (сниппет и превью) |
| `text-[0.8rem]` в `BulkBar` | `list` |
| Приведение `DraftWithSource` в `QuickCapture` | `core-logic` (поле), `capture-palette` |
| «Корзина отдельной строкой» в «Данных» (`spec-stage2.md` §5.2) | `settings` |
| Команды палитры «Корзина», «Очистить корзину» (`spec-stage2.md` §5.2) | `capture-palette` |

Уже закрыто раньше (не делать): значок 24px у плавающей кнопки, `data-skin` лайтбокса и быстрой записи, `positions` и
`searches` в отчёте импорта, `within` в `LinkPicker`. Остаются на свои этапы: `graphLayout` (5), признак распознавания
сканов и `cargo test` в CI (8), «Быстрое добавление» в `docs/ИНСТРУКЦИЯ.md` (8), обновление `CLAUDE.md` (8).

## 8. Приёмка основной сессией

1. `npm run typecheck`, `npm test`, `npm run build`, `cargo test`, `cargo check`; свести стыки пакетов (`variant="trash"`,
   пункты меню корзины в деталях, правки из разделов «Нужно в чужом файле»).
2. Сквозные сценарии (К и «Осень», день и ночь, 1280 и 390px):
   - корзина: удалить → «Отменить»; удалить → раздел «Корзина» (счётчик в панели) → детали только для чтения →
     восстановить; удалить навсегда из строки, меню, панели, массово, клавишей; «Очистить корзину» из раздела,
     настроек и палитры; `trashDays = 0`;
   - Markdown: задачи, вики-ссылки (связь появилась в «Связанных записях»), файл `.md`, заголовки карточек без
     разметки, сниппеты, разбор входящих;
   - дубль ссылки из панели и из строки быстрой записи;
   - поиск: быстрый и свой период → сохранить → применить из панели и палитры → переименовать, переставить, удалить;
   - разделители по дням и точная дата в подсказке.
3. Окно Tauri: выбор папок, «Сделать копию сейчас», «Показать в проводнике», экспорт Markdown с отменой, смена папки
   (прежняя отозвана: `approved-dirs.json`), `confirmDialog` вместо системного.
4. Дополнить `HANDOFF.md`, коммит этапа.

## 9. Открытые вопросы (исполнение не останавливают)

1. Markdown включён для всех текстов и заметок сразу, одиночный перевод строки — перенос (по умолчанию — да).
2. Сохранённый поиск запоминает раздел, в котором создан (по умолчанию — да).
3. Попытка сохранить дубль ссылки останавливается, фокус — на «Открыть» (по умолчанию — да; иначе — сохранять по
   второму Enter).
4. В корзине нет панели фильтров и сортировок, порядок — по дате удаления (по умолчанию — да).
5. Сроки корзины: 7, 14, 30, 90 дней, год, «не очищать» (по умолчанию — этот набор).
6. Экспорт в Markdown включает архив и не включает корзину; вне приложения — только одна запись файлом (по умолчанию — да).
7. Разделители по дням показываются и при сортировке «недавно изменённые» — по дате изменения (по умолчанию — да).
8. Производный заголовок без разметки меняет имена файлов экспорта у записей без своего заголовка (по умолчанию — принять).
9. Секция настроек называется «Копии и экспорт в папку» и стоит после «Данных» (по умолчанию — так).
