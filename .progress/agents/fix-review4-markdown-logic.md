# fix-review4-markdown-logic

Статус: готово

Задача: исправления ревью этапа 4, группа «markdown-logic» — C12, M2, M28, M3, M4 (часть lib), M18, M17, M31, M33
(тесты рискованных ветвей в своих файлах).

Границы: src/lib/{markdown,wikiLinks,markdownExport,itemTitle,plainText,exportDir}.ts и их тесты; в src/db/repo.ts —
только сортировка по названию (M31). git не трогался.

## Исправлено

- C12 — `buildTitleIndex` пропускает запись без своего заголовка, если производный заголовок взят из строки с
  `[[…]]` (`titleIsWikiLink`, синтаксис ищется `findWikiSyntax` по сырой строке — и в коде с отступом, где
  `stripMarkdown` скобки тоже снимает). `beats()` не менялся. Тесты а–в + экспорт (ссылка ведёт к «Проект А (2)»).
- M3 — единый разбор `[[…]]`: `parseWikiInner`/`findWikiSyntax` (lib/wikiLinks.ts) используют и `parseWikiLinks`,
  и `remarkWikiLinks` (lib/markdown.ts, свой разбор удалён). `parseWikiLinks` видит исходник как remark + GFM:
  код с отступом (пункты списка, сноски, цитаты, пустой пункт), ограда в строке маркера и конец ограды/HTML вместе
  с пунктом или цитатой, HTML-блоки 1–7 и строчный HTML/угловые автоссылки, определения ссылок, `[[x]](адрес)`,
  `[[x]][метка]`, [[…]] внутри текста обычной ссылки, автоссылки GFM (внутри цели и «поглощение» адресом перед
  `[[`), `\`-экранирование и сущности (числовые + ~45 именованных) с позициями по исходнику, таблицы (голая «|» в
  ячейке — не ссылка; `inTable`), «ленивое» продолжение, BOM. Сверка: 100+ случаев в markdown.test.ts сравнивают
  цели просмотра (react-markdown) и parseWikiLinks; вне репозитория — случайный перебор ~250 тыс. текстов из
  4 наборов фрагментов: расхождений 0. Производительность проверена на патологических входах (100 КБ — до ~130 мс).
- M2 — `toggleTaskAt`: BOM в начале → позиция +1. M28 — флажок на следующей строке после маркера (в т.ч. CRLF и
  «>» цитаты). Тесты: BOM, перенос, вложенные с CRLF, цитата в пункте, ограда и код с отступом в пункте.
- M4 (lib) — `openableLinkUrl` (http/https с «//»); `mdUrlTransform` пропускает только такие href/src: ftp и
  «https:host» показываются текстом.
- M18 — `rewriteWikiLinks`: в строке таблицы разделитель и «|» подписи — «\|» (и у ссылки без подписи, когда имя
  файла ≠ заголовку); вне таблицы «\|» сохраняется, только если так был записан сам разделитель.
- M17 — `exportEach`: 3 отказа «нет доступа»/«нет места» подряд (без удачной записи между ними) прерывают
  выгрузку → `report.stopped`; если не записано ничего — бросается Error с текстом отказа. Сбой чтения вложения
  счёт не трогает. `exportReportSummary(report)` — строка итога для экрана.
- M31 — `sortTitle`: «нет заголовка» по `derivedTitleLine` (текст из одной разметки — в конец). Тест в repo.test.ts.
- M33 — тесты: `parseWikiLinks` с `\|`, `\\|`, `[[a|b\|c]]`; `toggleTaskAt` (см. M2/M28); buildTitleIndex (C12).

## Не сделано (чужие файлы — см. ответ)

- BackupSection.tsx: строка итога → `exportReportSummary(report)`.
- lib/actions.ts `openLink`: в Tauri при `openExternal() === false` — toast вместо `window.open`.
- Необязательная часть C12 (своё название побеждает в `beats`) — не делалась.

## Файлы

src/lib/wikiLinks.ts, src/lib/wikiLinks.test.ts, src/lib/markdown.ts, src/lib/markdown.test.ts,
src/lib/markdownExport.ts, src/lib/markdownExport.test.ts, src/lib/exportDir.ts, src/lib/exportDir.test.ts,
src/db/repo.ts (sortTitle + импорт), src/db/repo.test.ts (тест sortItems).

Проверки: `npm run typecheck` чисто; `npm test` — 46 файлов, 1590 тестов.
