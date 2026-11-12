# stage4-core-logic

Задача: этап 4, волна 0, пакет `core-logic` (`.progress/spec-stage4.md` §2): чистая логика и хранилища с тестами —
store/ui, store/confirm, тексты переполнения, ImportReport.trashed, displayTitle без разметки, `\|` в вики-ссылках,
даты, разделители по дням, корзина, сохранённые поиски, backupUi, forgetDirectory, новые действия, useDebounced.

Статус: готово

## Результат

- `src/store/ui.ts`: `CaptureDraft.source`; `customDates`, `mdPreview`, `setDateRange(range | null, custom?)`,
  `setMdPreview`; `setView`, `resetFilter`, `applyQuery` сбрасывают `customDates`. `mdPreview` — из
  `localStorage['qd-md-preview']` (нет хранилища или сбой → `true`), запись `'1'`/`'0'` с проглатыванием ошибки.
  Сверх спецификации: экспорт `MD_PREVIEW_KEY`.
- `src/store/confirm.ts` (нов.): `ConfirmOptions`, `ConfirmRequest`, `useConfirm`, `confirmDialog`; новый вопрос
  отвечает прежнему `false`. В `request` подписи уже заполнены (`DEFAULT_CONFIRM_LABEL` «Подтвердить»,
  `DEFAULT_CANCEL_LABEL` «Отмена» — экспортированы).
- `src/lib/errors.ts`: `QUOTA_MESSAGE` с «очистите корзину». `src/lib/exportImport.ts`: `tooBig` — «Очистите корзину,
  удалите крупные файлы…»; `ImportReport.trashed` — записанные записи с `deletedAt`.
- `src/lib/itemTitle.ts`: `derivedTitleLine(item)`; `displayTitle` берёт производный заголовок из неё; `TitleSource` +
  `type`.
- `src/lib/wikiLinks.ts`: `[[цель\|подпись]]`. `src/lib/markdownExport.ts`: ссылка, записанная через `\|`,
  переписывается тоже через `\|`.
- `src/lib/dates.ts`: `DatePreset`, `DATE_PRESETS`, `presetOf`, `parseDateInput`, `customDateRange`, `formatDateRange`
  (+ экспорт текстов `DATE_INPUT_ERROR`, `DATE_ORDER_ERROR`).
- `src/lib/dayGroups.ts` (нов.): `DayEntry`, `groupByDay`.
- `src/lib/trash.ts` (нов.): `TRASH_DAYS_OPTIONS`, `trashDaysLabel`, `trashPurgeAt`, `trashDaysLeft`, `trashLeftLabel`.
- `src/lib/savedSearch.ts` (нов.): `SearchScreen`, `isNarrowed`, `sectionFilter`, `currentSearchQuery`,
  `viewForQuery`, `suggestSearchName`.
- `src/lib/backupUi.ts` (нов.): `UiMessage`, `DESKTOP_HINT`, `BACKUP_PERIOD_LABEL`, `backupResultMessage`, `sameDir`,
  `shouldForgetDir`.
- `src/lib/desktop.ts`: `forgetDirectory(dir)` → `invoke<boolean>('forget_directory', { dir })`.
- `src/lib/actions.ts`: `actPurgeAsk`, `actEmptyTrashAsk`, `actApplyWikiLinks`, `openItemInSection`,
  `actSaveCurrentSearch` (+ `NOTHING_TO_SAVE`), `actApplySearch`, `actRenameSearch`, `actMoveSearch`,
  `actDownloadMarkdown` (`markdownExport` грузится `import()`); `createAndEnrich` молча создаёт связи по `[[…]]`
  (кроме кода).
- `src/hooks/useDebounced.ts` (нов.).

Прежние экспорты и сигнатуры не менялись (только добавления; у `openItemInSection` тип параметра шире спецификации —
см. отступления).

## Проверки

- `npm run typecheck` — чисто (exit 0).
- `npm test` — 45 файлов, 1352 теста, все зелёные (до пакета — 41 / 1266). Новые/изменённые тесты своих файлов
  прогнаны трижды — стабильно.
- `npx oxlint` по своим файлам — замечаний нет.
- Р7 (заголовок без разметки) ни одного теста в чужих файлах не уронил.

## Изменённые файлы

`src/store/ui.ts`, `src/store/ui.test.ts` (нов.), `src/store/confirm.ts` (нов.), `src/store/confirm.test.ts` (нов.),
`src/lib/errors.ts`, `src/lib/errors.test.ts`, `src/lib/exportImport.ts`, `src/lib/exportImport.test.ts`,
`src/lib/itemTitle.ts`, `src/lib/itemTitle.test.ts`, `src/lib/wikiLinks.ts`, `src/lib/wikiLinks.test.ts`,
`src/lib/markdownExport.ts`, `src/lib/markdownExport.test.ts`, `src/lib/dates.ts`, `src/lib/dates.test.ts`,
`src/lib/dayGroups.ts` (нов.), `src/lib/dayGroups.test.ts` (нов.), `src/lib/trash.ts` (нов.), `src/lib/trash.test.ts`
(нов.), `src/lib/savedSearch.ts` (нов.), `src/lib/savedSearch.test.ts` (нов.), `src/lib/backupUi.ts` (нов.),
`src/lib/backupUi.test.ts` (нов.), `src/lib/actions.ts`, `src/lib/actions.test.ts`, `src/lib/desktop.ts`,
`src/lib/desktop.test.ts`, `src/hooks/useDebounced.ts` (нов.), этот файл.

## Отступления и решения там, где спецификация молчит

1. `openItemInSection(item: Pick<Item, 'id' | 'status' | 'deletedAt'> & Partial<Pick<Item, 'favorite'>>)` — без
   `favorite` правило «Избранного» (уточнено при сверке) проверить нельзя; вызов с `Item` подходит.
2. `trashDaysLabel`: любое значение ≤ 0 или не число → «Не очищать» (в спецификации — только 0); настройка
   допускает 0…3650, так что на деле это 0.
3. `sameDir`: «/» и «\» считаются одним разделителем; корень («/», «C:\») не теряет разделитель, чтобы не стать
   пустой строкой. Ошибка в сторону «одна и та же папка» лишь оставляет прежнюю папку подтверждённой.
4. `backupResultMessage`: `done` с пустым путём → «Копия сохранена»; `failed` с пустой ошибкой → «Не удалось
   сохранить копию».
5. `derivedTitleLine`: правило «строка из одних `- * _ = # > |`» к коду не применяется (у кода — только `trim`, как
   раньше); из каждой строки разбираются первые 1000 символов (заголовок ≤ 80, а `stripMarkdown` на длинной строке
   для каждой карточки дорог). Строка таблицы с текстом (`| a | b |`) остаётся как есть.
6. `actSaveCurrentSearch(name)`: переданное имя берётся как есть (пустое — ошибка репозитория «Название не может
   быть пустым» в toast); подсказка `suggestSearchName` — только когда `name` не передан.
7. `actApplyWikiLinks`: сообщение — обычный `toast()`; заголовок цели — из снимка (запасной путь — `getItem`).
8. `forgetDirectory`: строка из одних пробелов тоже → `false` без вызова.
9. `customDateRange` принимает только `ГГГГ-ММ-ДД` (формат `<input type="date">`), с проверкой существования даты.

## Нужно в чужом файле

Нет. Запросов CSS нет.

## Не проверено

- Браузер не запускался (пакет без интерфейса).
- `useDebounced` тестом не покрыт: файла теста нет в пакете, окружение тестов — node без отрисовки React.
- `forgetDirectory` с настоящей командой Rust не вызывался (команду добавляет пакет `tauri-forget`); в тестах — подмена
  `invoke`.
- `actDownloadMarkdown` в браузере не запускался: в тесте подменены `document` и `URL.createObjectURL`.
