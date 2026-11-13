# final-fix-logic — исправления финального ревью, группа «logic»

Задача: подтверждённые находки финального ревью (af91a0b..HEAD) в src/lib, src/db, src/search, src/store,
src/hooks, src/types.ts, extension/.

Статус: готово

## Результат

- №1 и №3 (одна причина): importBackup ставит ocrAutoSkipAt каждой новой здесь записи с распознаваемым вложением
  (ocrKindOf) без текста, без ocrVisionAt и ocrClearedAt — без оглядки на deletedAt и ocrAt. Картинка из корзины
  после «Восстановить» и PDF без проверенного слоя после разбора в задел авто не попадают. Тест на merge и replace.
- №2: renameQueryOperators сравнивает тег по tagKey (ё = е, NFKC), срез хвоста по исходному тексту. Тест.
- №4: freeSearchName перенесён в lib/normalize.ts; restoreSavedSearch и импорт пользуются им — имя с суффиксом
  не длиннее SAVED_SEARCH_NAME_MAX. Тест в repo.test.ts.
- №5: missingQueryTargets сравнивает теги по tagKey, повторы схлопываются по ключу. Тест.
- №6: applyGlobalShortcut откатывается на действующее сочетание (activeShortcut); если его нет (сбой на старте) —
  на значение настроек, как прежде. failedShortcut снимается, только если вернули именно его. Тест в
  dataDesktop.test.ts.
- №7: ожидание очереди текстового слоя PDF прерывается отменой (untilAborted + Promise.race в run). Тест.
- №8: EXT_TOKEN_LENGTH теперь задаёт TOKEN_RE. Остальное (showMainWindow, quitApp, exportMarkdownToDir,
  removePositions) не удалялось — см. отчёт исполнителя: API из спецификации, удаление требует чужих файлов.

Проверки: npm run typecheck — чисто; npm test — 89 файлов, 2657 тестов.

## Изменённые файлы

src/lib/exportImport.ts, src/lib/exportImport.test.ts, src/search/serialize.ts, src/search/search.test.ts,
src/lib/queryHints.ts, src/lib/queryHints.test.ts, src/lib/normalize.ts, src/db/repo.ts, src/db/repo.test.ts,
src/lib/desktop.ts, src/lib/dataDesktop.test.ts, src/lib/ocr.ts, src/lib/ocr.test.ts, src/lib/shellUi.ts
