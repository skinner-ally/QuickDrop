# core-search

**Задача:** реализовать `src/search/` (parseQuery, searchItems, highlight, makeSnippet, matchesFilter) по контракту
из CLAUDE.md + тесты `src/search/search.test.ts`.

**Статус:** готово

## Результат
- `npx vitest run src/search/search.test.ts` — 51/51 зелёные.
- `npx tsc -b` — без ошибок; `npx oxlint src/search` — чисто.
- 5000 записей: построение индекса ~0.7 с (один раз), поиск после прогрева 2–60 мс
  (самые тяжёлые — однобуквенный префикс и первая фраза), инкрементальное обновление одной записи ~3 мс.

## Изменённые файлы
- `src/search/index.ts` — реэкспорт (публичный API модуля)
- `src/search/normalize.ts` — fold (NFKC, lower, ё→е), токенизатор, разбиение camelCase, термины индекса/запроса
- `src/search/filter.ts` — `matchesFilter` (своя копия правил, без импорта из db/repo)
- `src/search/query.ts` — `parseQuery`, тип `ParsedQuery`
- `src/search/engine.ts` — MiniSearch, кэш индекса с инкрементальной синхронизацией, `searchItems`
- `src/search/highlight.ts` — `highlight`, `makeSnippet`
- `src/search/search.test.ts` — тесты

## Дополнительные экспорты (сверх контракта)
- `prepareSearchIndex(items, categories?)` — построить индекс заранее (idle), чтобы первый ввод не ждал.
- `resetSearchIndex()` — сброс кэша (тесты, clearAllData).
- `getSearchIndexStats()` — размер индекса и что сделала последняя синхронизация.
- `resolveCategoryName(name, categories)` — id категории по имени.
- `matchesFilter`, `fold`, `tokenize`, типы `SearchHit`, `ParsedQuery`, `HighlightPart`, `SearchIndexStats`.

## Отклонения / решения
- Буст `linkTitle: 1.5` в дополнение к title 3 / tags 2 (заголовок ссылки до ручного переименования).
- `cat:none|без|нет` → «без категории» (только если категории с таким именем нет).
- Русские ключи операторов: `тег:`, `тип:`, `кат:`/`категория:`; кавычки `"…"`, `«…»`, `“…”`.
- Неизвестное значение `type:/is:/has:` остаётся свободным текстом; оператор без значения игнорируется.
- `favorite: false` в фильтре = только не избранные (строгое сравнение).
- При одних фразах (без текста) — score 0, terms = слова фраз (для подсветки).
