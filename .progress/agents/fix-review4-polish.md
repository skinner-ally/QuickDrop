# fix-review4-polish
Статус: готово (typecheck и npm test проходят, 1621 тест).

Сделано: замечания 1, 2, 4-12 полностью; 3 частично.
- wikiLinks.ts: патч dests/inLinkDest (1), сноска (2), `\[[A]](u)` (3.1), DEFINITION без \s (3.6), экспорт mayHaveWikiLinks (3.7; используется в actions.ts).
- SavedSearches (4), ItemDetail: -m-1 p-1 (5), чип @[26rem] (6), кнопки pointer-coarse:h-9 (8), ItemList курсор после восстановления (7), BackupSection busy (9), FilePreview role=region (10), actions.openLink (11), M14: renameQueryOperators + repo (12).
- DESIGN.md п.2.6: «обрезающий блок».

Долги (в HANDOFF не писал): 3.2-3.5, 3.8 (фаззер-сверка, urlSpans по micromark, afterDef, таблица после пункта списка, сноски без ссылок);
M14(d) подсказка в пустой выдаче для удалённых тега/категории; deleteTag/deleteCategory поиски не трогают.
