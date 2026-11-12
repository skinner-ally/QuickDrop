# spec-stage4-review

- Задача: сверка `.progress/spec-stage4.md` с кодом (файлы, экспорты, сигнатуры, API react-markdown/remark-gfm,
  контракты CLAUDE.md, docs/DESIGN.md, покрытие этапа 4 плана и долгов HANDOFF) и проверка разбивки на пакеты.
- Статус: готово
- Код не менялся, git не трогался, пакеты не ставились. Временные скрипты — только в scratchpad.

## Что проверено

- Все названные существующие файлы и экспорты есть: `repo` (корзина, поиски, `findDuplicateLink`), `useItems`
  (`useItemsWithTrash`, `useTrashedItems`, `useTrashCount`, `getItemsWithTrashSnapshot`, `getTrashedItemsSnapshot`,
  `useSavedSearches`, `useDayKey`), `lib/dates` (`relativeRange`, `formatDateToken`, `startOfDay`), `itemTitle`
  (`formatDayLabel`, `formatDateTime`, `NO_DATE`), `wikiLinks`, `markdownExport` (`planMarkdownExport`, `itemToMarkdown`,
  `buildMarkdownExport`, `MdExportEntry` совместим с `ExportDoc`), `exportDir.exportDocsToDir`, `autoBackup`
  (`BackupRunResult`, `runBackupNow`, `checkAutoBackup`, `autoBackupStatus`, `BACKUP_KEEP_MIN/MAX`), `desktop`
  (`pickDirectory({ purpose, defaultPath })`, `revealInExplorer`), `search` (`composeQuery(…, now, { relativeDates })`,
  `parseQuery`, `queryWords`, `fold`), `normalize.searchNameKey`, `radioGroupKeyDown`, `Section`/`Row`/`Field`/
  `CommitInput`/`saved`, `lazyRetry`/`ErrorBoundary`, все значки (`bookmark`, `more`, `undo`, `file-text`, `eye`, `code`…).
  Rust: `ApprovedDirs` (`approve`, `resolve` без удержания мьютекса, `save_dirs`), `generate_handler!` в `lib.rs`;
  команды приложения не требуют записей в `capabilities`.
- react-markdown 10.1.0 / remark-gfm 4.0.1 — скриптом через `react-dom/server`: `li.node.position.start.offset` на маркере
  (вложенные, цитата, нумерованный), `task-list-item`, `- [ ]` и код — не задачи, сырой HTML → текст, `[[x\|y]]` в таблице
  и в абзаце → `[[x|y]]`, CRLF остаётся `\r\n` в текстовом узле, `urlTransform` получает `href` сносок. Типы — `tsc`
  7.0.2 на отдельном файле: плагин `() => (tree: MdNode) => void`, `mdUrlTransform(url, key): string`, строки в
  `remarkRehypeOptions`, `node.position` в `li` — без приведений (проверка действительно ловит ошибки типов).
- Покрытие: все шесть пунктов «Этап 4» плана и долги HANDOFF этапа 4 (is:trash в разделах, `missing`, тексты
  переполнения и отчёт импорта, `forget_directory`, папки только из `pickDirectory`, `relativeDates: false`,
  `VIEWS`/`ActiveView`, разметка в заголовках, `text-[0.8rem]`, `DraftWithSource`) распределены по пакетам.

## Исправлено в спецификации (пометка «(уточнено при сверке)»)

1. Разбивка: `TrashView.tsx` и `AppShell.tsx` перенесены из `views-filter` в `list` (§0, новый §5.2a, §7): `TrashView`
   передаёт `variant="trash"`, тип расширяет `ItemCard.tsx` пакета `list` — иначе typecheck `views-filter` зависел бы от
   соседа, а приёмка `list` в разделе «Корзина» — от `views-filter`. §4 п.7 переписан: типовых стыков в волне 1 нет;
   пакетам, до которых доходят стыки поведения, проверять смену раздела (`#/trash`), а не чужую отрисовку.
2. §2.9 `currentSearchQuery`: в корзине со своим статусом в строке (`is:inbox`) раздел не дописывался → сохранённый
   поиск открылся бы во «Входящих». Правило приведено к `computeVisible`: корзина — `is:trash` всегда, если его нет;
   избранное — `is:fav`, если нет `is:fav` и `is:trash`. Добавлены тесты.
3. §2.5: `markdownExport` переписывает `[[a\|b]]` как `[[A|b]]` — в таблице голая `|` режет ячейку (проверено). Писать
   через `\|`, тест.
4. §2.12: точные тексты `actPurgeAsk` (несколько записей), источник числа для `actEmptyTrashAsk`
   (`getTrashedItemsSnapshot`, без снимка — без числа), `openItemInSection` не уводит из «Избранного», детали
   `actDownloadMarkdown`.
5. §2.8 формула `trashPurgeAt` (как `purgeExpired`); §2.10 имя файла из `result.path`.
6. §3.1: экспорт `MdNode`; `remarkSoftBreaks` и CRLF; тест вики-адреса через отрисовку; тест «нет `<img>`» без `![]()`.
   §3.3: `import type`, защита `typeof window`, сброс `ErrorBoundary` при смене `source`. §3.6: `initialFocus` вместо
   `autoFocus` в `ConfirmHost`. §3.7: `.pixel .qd-md { line-height: inherit }` (иначе `1.6` из слоя действовало и в П);
   `color-scheme` у поля даты уже наследуется от `<html>`.
7. §5.1: у `NavButton` нет пропа `title` — разрешено добавить необязательный `title`.
8. §5.2: у карточки сетки флажков нет; `snippetOf` при `derivedTitleLine() === null`.
9. §5.3: `openCapture({ text, source: 'manual' })`; в `TriageMode` обёртка `<p>` → `<div>`, классы размера — в
   `className` `MarkdownText` (`.qd-md` задаёт свой размер).
10. §5.4: остаток `0` — без «(удалится сегодня)» в скобках; что не проверять до сдачи `list`.
11. §5.5: при остановке на дубле сбрасывать и `savingRef`; `passive` только при `shownUrl === linkUrl`; зависимости
    `useMemo` палитры.

## Вопросы основной сессии

- `forget_directory` убирает и записи с тем же каноническим путём: если новая папка или папка другой настройки — та же
  папка под другим написанием (junction/symlink), она тоже будет отозвана (`shouldForgetDir` сравнивает строки).
  Редко; принять или добавить в команду список `keep`.
- Пакет `list` вырос до 7 файлов (opus). Если тяжело — вынести `TrashView` + `AppShell` в отдельный пакет волны 2.
- `ItemsView.tsx` (ничей): подсказка архива «Del — удалить» — теперь это перенос в корзину; поправить при приёмке, если
  нужно единообразие с «В списке: в корзину».
- Клик по вики-ссылке в разборе входящих открывает запись в панели деталей под окном разбора (обработчик по умолчанию).

## Изменённые файлы

- `.progress/spec-stage4.md`
- `.progress/agents/spec-stage4-review.md` (этот файл)
