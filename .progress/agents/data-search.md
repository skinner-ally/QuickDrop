# data-search

Задача: этап 2, волна 1 (`.progress/spec-stage2.md` §0, §2.3, §2.4, §3, §4) — поиск: операторы дат и `is:trash`,
`serializeFilter` / `composeQuery` / `resolveQueryFilter`, корзина и `ocrText` в `searchItems`, `makeSnippet` без
разметки Markdown; новые чистые модули `lib/dates.ts`, `lib/plainText.ts`; `computeVisible` с корзиной;
`formatDayLabel` в `lib/itemTitle.ts`.

Файлы владения: `src/search/*`, `src/lib/dates.ts` (+тест), `src/lib/plainText.ts` (+тест),
`src/hooks/computeVisible.ts` (+тест), `src/lib/itemTitle.ts` (+тест).

Статус: готово

Работа шла в два захода: первый оборвался после `dates.ts`, `plainText.ts`, `query.ts`, `engine.ts`, `serialize.ts`,
`index.ts`, `filter.ts` (без тестов). Второй заход сверил этот код со спецификацией, доделал остальное и написал тесты.

## Результат

- `npm run typecheck` — чисто.
- Тесты своих файлов (`npx vitest run src/search src/hooks/computeVisible.test.ts src/lib/itemTitle.test.ts
  src/lib/dates.test.ts src/lib/plainText.test.ts`) — 5 файлов, 168 тестов, все зелёные. Существующие тесты не правились,
  только добавления.
- Полный `npm test` — 33 файла, 1131 тест, 1 красный: `actions.test.ts › удаление и отмена во время загрузки…`
  (ожидаемый по §4, чинит `data-hooks`).
- `npx oxlint` по своим файлам — без замечаний.

### Что сделано (экспорты)

- `src/search/query.ts`: `parseQuery(raw, now = Date.now())`; ключи `date:` `дата:`, `after:` `since:` `после:`,
  `before:` `until:` `до:`; `is:trash|trashed|deleted|bin|корзина|удаленные` → `filter.trashed = true`. Неверная дата —
  токен целиком в свободный текст; оператор без значения игнорируется; несколько дат пересекаются (`from = max`, `to = min`).
- `src/search/serialize.ts` (новый): `serializeFilter(filter, categories, now?)`, `composeQuery(query, filter, categories, now?)`.
- `src/search/engine.ts`: `SearchOptions.trash` / `.now`, `resolveQueryFilter(parsed, categories)`; корзина в `searchItems`
  (`matchesFilter` c `trashed`, либо `matchesFilterIgnoringTrash` при `trash: 'any'`); поле индекса `ocrText` (последнее,
  вес 1, обрезка `MAX_INDEXED_CONTENT`); `Entry.ocrAt` — запись переиндексируется при смене `updatedAt`, имени категории
  или `ocrAt`; фразы ищутся и в `ocrText`.
- `src/search/highlight.ts`: `makeSnippet` — источники `content` → `linkMeta.description` → `ocrText`; у всех типов, кроме
  `code`, `content` проходит `stripMarkdown`.
- `src/search/index.ts`, `filter.ts`: реэкспорт `serializeFilter`, `composeQuery`, `resolveQueryFilter`,
  `matchesFilterIgnoringTrash`.
- `src/lib/dates.ts` (новый): `DAY_MS`, `DateRange`, `RelativePeriod`, `startOfDay`, `endOfDay`, `addDays`,
  `relativeRange`, `parseDateToken`, `formatDateToken`; сверх спецификации — `MIN_DATE_YEAR`, `MAX_DATE_YEAR`,
  `RELATIVE_PERIODS` (нужны `serialize.ts`).
- `src/lib/plainText.ts` (новый): `stripMarkdown`.
- `src/hooks/computeVisible.ts`: `computeVisible(items, categories, base, uiFilter: UiFilter, query, sort, now?)`;
  `is:trash` → `effectiveBase = { trashed: true, status? }`; фильтры интерфейса — через `matchesFilterIgnoringTrash`;
  `searchItems(…, { within, trash: 'any', now })`.
- `src/lib/itemTitle.ts`: `formatDayLabel(ts, now?)` — «Сегодня», «Вчера», «12 ноября», «12 ноября 2025», `NO_DATE`.

### Тесты (новые)

- `dates.test.ts` (16): границы суток, `addDays` через месяц/год/високосный, `relativeRange`, все форматы
  `parseDateToken`, 27 неверных значений → `null`, `formatDateToken` и обратный разбор.
- `plainText.test.ts` (18): каждое правило снятия разметки и случаи «не трогает» (`2 * 3 * 4`, `snake_case_name`, `a_b`,
  одиночные `*` и `_`, адреса, `#тег`, обычный текст, `\r\n`, служебные символы, сверхдлинная строка).
- `itemTitle.test.ts` (+4): `formatDayLabel`.
- `computeVisible.test.ts` (+7): корзина не видна и не входит в `total`; `base: { trashed: true }` (с текстом и с
  `uiFilter`); `is:trash` из «Входящих» и «Избранного»; вход в корзину не перестраивает индекс; дата запроса ∩
  `uiFilter.from/to`; относительные даты от `now`.
- `search.test.ts` (+50): даты и `is:trash` в `parseQuery`; `resolveQueryFilter`; `serializeFilter` — каждое поле, порядок,
  круг на 29 фильтрах, точность «сутки», относительные периоды; `composeQuery`; `matchesFilter` / `…IgnoringTrash`;
  `searchItems` — корзина (по умолчанию, `trash: true`, `'any'`, `is:trash`, без переиндексации), даты (границы
  включительно, `options.now`), `ocrText` (слова, фраза, вес заголовка, переиндексация по `ocrAt`); `makeSnippet` —
  `ocrText`, порядок источников, Markdown у `text`/`idea`/`link`, сохранён у `code`, длинные тексты.

## Изменённые файлы

`src/search/query.ts`, `src/search/engine.ts`, `src/search/highlight.ts`, `src/search/index.ts`, `src/search/filter.ts`,
`src/search/serialize.ts` (новый), `src/search/search.test.ts`, `src/lib/dates.ts` (новый), `src/lib/dates.test.ts` (новый),
`src/lib/plainText.ts` (новый), `src/lib/plainText.test.ts` (новый), `src/hooks/computeVisible.ts`,
`src/hooks/computeVisible.test.ts`, `src/lib/itemTitle.ts`, `src/lib/itemTitle.test.ts`, этот файл.

## Отступления и уточнения

1. `serializeFilter`, даты: при `from > to` пишется `after:A before:B`, а не `date:A..B` (диапазон с A > B — неверная
   дата и стал бы текстом); граница с годом вне 1970…2999 опускается или прижимается к краю (такую дату `parseQuery`
   не разобрал бы).
2. `serializeFilter`, кавычки: пара `“…”` годится, только если в имени нет ни `”`, ни `“` (лексер принимает обе как
   закрывающие). Если заняты все четыре псевдоимени «без категории» или имя не взять ни в одну пару кавычек — оператор
   пропускается. Типы и теги — без дублей, теги нормализуются `normalizeTag`, неизвестные типы и статусы отбрасываются.
3. `after:` / `before:` с диапазоном `A..B` остаются текстом (по таблице операторов они принимают дату или период).
4. `stripMarkdown`: заголовок — только с пробелом после решёток (`#тег` не трогается); строка длиннее 5000 символов
   проходит только построчные правила (маркеры строки снимаются, парные — нет); по букве спецификации `2*3*4` (без
   пробелов) и `__init__` считаются разметкой.
5. `makeSnippet`: без терминов у длинного текста обрабатывается только начало (результат тот же, что при полной
   обработке — есть тест); поиск совпадения идёт кусками по 8000 символов с дешёвой проверкой подстрокой. Причина —
   `ocrText` до 200 тыс. символов и `stripMarkdown` на каждую карточку (замер: худший случай 58 мс → 7 мс на запись).
6. `computeVisible` при `is:trash` снимает все условия раздела, включая «избранное» (буквально по §2.4).
7. В начале второго захода один раз выполнен `git diff --stat` (только чтение, чтобы увидеть объём первого захода);
   ничего не менялось. Больше git не вызывался.

## Не проверено

- В приложении и браузере не проверялось: новые экспорты интерфейсом ещё не используются, dev-сервер не запускался.
- `npm run build` не запускался (запрещено правилами задачи).
- Тесты дат построены через `new Date(y, m, d)` и от пояса не зависят, но запускались только в местном поясе этой
  машины (без перевода часов); сутки в 23 и 25 часов на практике не прогонялись.
- `useItems.ts` (волна 2) пока передаёт в `computeVisible` прежний набор записей — связка с корзиной в приложении
  заработает после `data-hooks`.
