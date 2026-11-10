# fix-core-review

Задача: проверить и исправить находки ревью этапа «ядро» (22 находки: computeVisible/search filter,
repo, seed, query, exportImport, detect, linkMeta, ai, useItems). Дубли matchesFilter/normalizeTag свести
к одному источнику. После правок — typecheck, test, build зелёные.

Статус: готово

## Результат
- `npm run typecheck` — без ошибок; `npm test` — 10 файлов, 432 теста зелёные; `npm run build` — зелёный.
- Единые источники: `src/lib/normalize.ts` (normalizeTag/normalizeTags/tagKey/foldText/categoryNameKey,
  safeLinkUrl/safeImageUrl/hasForeignScheme) и `src/lib/filter.ts` (matchesFilter). repo и search
  реэкспортируют; ai, exportImport, seed, search/query используют их же. Циклов импорта нет.
- Исправлено 21 из 22 находок полностью, 1 частично (isUrl: зоны .ai/.io оставлены ссылками —
  claude.ai/github.io; в существующих тестах claude.ai — ссылка).
- Сигнатуры CLAUDE.md не менялись; добавлены только необязательные параметры/экспорты:
  searchItems(…, { within }), exportBackup({ maxBytes }), MAX_FILE_SIZE, MAX_BACKUP_BYTES,
  estimateBackupBytes, PRIVATE_SETTINGS, subscribeAllItems/getAllItemsSnapshot, computeAllTags/computeCounts.
- Поведенческие изменения, о которых надо знать UI: createItem/updateItem бросают на url не http/https/ftp
  и на файл > 100 МБ; updateCategory бросает на имя-дубль; createItem сохраняет HEIC/TIFF как 'file',
  если движок не декодирует; импорт не трогает aiEnabled/aiBaseUrl/aiModel/linkProxyUrl/autoFetchLinkTitle;
  экспорт бросает понятную ошибку, если копия > 480 МБ; ссылки в UI открывать через safeLinkUrl.

## Изменённые файлы
- новые: src/lib/normalize.ts, src/lib/filter.ts
- src/search/filter.ts, src/search/normalize.ts, src/search/engine.ts, src/search/index.ts, src/search/search.test.ts
- src/hooks/computeVisible.ts, src/hooks/computeVisible.test.ts, src/hooks/useItems.ts, src/hooks/useItems.test.ts
- src/db/repo.ts, src/db/repo.test.ts, src/db/seed.ts, src/db/seed.test.ts
- src/lib/exportImport.ts, src/lib/exportImport.test.ts
- src/lib/detect.ts, src/lib/detect.test.ts
- src/lib/linkMeta.ts, src/lib/linkMeta.test.ts
- src/lib/ai.ts, src/lib/ai.test.ts
