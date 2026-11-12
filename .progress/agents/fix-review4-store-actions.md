# fix-review4-store-actions

Задача: исправления ревью этапа 4, группа «store-actions» (C2, C3 — часть store, C11 — часть store, M11=M26, M6, M14 —
оценка, M33 — тесты в своих файлах).

Границы: src/store/ui.ts(+test), src/lib/actions.ts(+test), src/lib/savedSearch.ts(+test), src/lib/dates.ts(+test),
src/lib/trash.ts(+test), src/lib/dayGroups.ts(+test). git не трогал.

Статус: готово (`npm run typecheck` чисто, `npm test` 46 файлов / все тесты зелёные, oxlint по своим файлам чисто).

## Исправлено

- C2. `actPurgeAsk` спрашивает и удаляет только записи, которые по базе лежат в корзине (`trashedNow` — getItem по
  каждому id): живые пропускаются, нет ни одной — без вопроса; после «да» перечитывает и удаляет только то, что ещё
  в корзине. Тесты: живая запись, смешанный список, восстановление во время вопроса (3 → удалены 2), всё восстановлено,
  ошибка чтения. `actPurge`/`purgeItems` не менялись.
- C2, число в `actEmptyTrashAsk` — не дефект (см. «Пропущено»); добавлен тест: восстановленное во время вопроса
  остаётся, toast с фактическим числом.
- C3 (store). `useUi.rollDatePreset(prevNow, now)`: быстрый период (по `presetOf` от prevNow) переносится на сутки now;
  свой период, произвольные границы, пустой фильтр, те же сутки, негодное время — состояние то же (без оповещения).
  Тесты в ui.test.ts (неделя, «Сегодня» → `date:today`, пропуск суток, неизменность `toBe(prev)`).
- C11 (store). `appliedQuery: string | null`, `appliedView: View | null` в useUi. `applyQuery` их ставит (пустой
  запрос — null), `setQuery` с другой строкой их снимает, `setView` очищает поиск, только если он нетронутый
  применённый, раздел отличается от раздела применения и это раздел со списком (настройки/граф поиск не снимают).
  Тесты в ui.test.ts и actions.test.ts (боковая панель, категория, openItemInSection).
- C11 п.4 (логика). `isSavedSearchActive(search, { view, query, filter }, now?)` в savedSearch.ts + тесты; подключить
  в SavedSearches.tsx должна группа экранов.
- M11 = M26. `actSaveCurrentSearch` (с именем и без) не создаёт второй поиск с тем же запросом: toast
  «Уже сохранён как «<имя>»», возврат undefined. `findSavedByQuery`, `alreadySavedText` в savedSearch.ts + тесты.
- M6. `trashDaysLeft` считает календарные сутки до дня очистки (round по началу суток), `trashPurgeAt` → null вне
  диапазона Date, новая `trashPurgeNote(deletedAt, trashDays, now)` — строка плашки. Тесты, в т.ч. перебор часов и
  перевод часов (Europe/Berlin).
- M33 (свои файлы). Тесты: viewForQuery на пары операторов, круг currentSearchQuery→viewForQuery для избранного/
  корзины/настроек/графа; presetOf в полночь и для своего периода = «Сегодня»; customDateRange/startOfDay/endOfDay/
  addDays/relativeRange/presetOf при переводе часов; groupByDay в полночь, при now в полночь, при now = NaN и при
  переводе часов. Пояс в тестах переключается `vi.stubEnv('TZ', 'Europe/Berlin')` и возвращается в afterAll.

## Пропущено

- C2, число в `actEmptyTrashAsk`: не дефект — снимок живой (liveQuery), `emptyTrash` в одной транзакции берёт только
  то, что в корзине на момент «да», toast показывает фактическое число. Тест добавлен.
- M14: нужен src/db/repo.ts (переписывание `searches` в транзакциях updateCategory/renameTag) и разбор токенов
  `cat:`/`tag:`/`#` в src/search — не мои файлы. Долг.
- M33 вне моих файлов: toggleTaskAt, shouldForgetDir, parseWikiLinks, buildTitleIndex, вынос inSection/targets из
  ItemList; конфликт «Без категории» + `cat:x` в строке (composeQuery, src/search/serialize.ts).
- Подписка FilterBar на смену суток, подсветка в SavedSearches.tsx, проверка в SaveSearchButton, переход TrashNote на
  `trashPurgeNote` — файлы группы экранов (API описан в отчёте).

## Файлы

src/store/ui.ts, src/store/ui.test.ts, src/lib/actions.ts, src/lib/actions.test.ts, src/lib/savedSearch.ts,
src/lib/savedSearch.test.ts, src/lib/dates.test.ts, src/lib/trash.ts, src/lib/trash.test.ts, src/lib/dayGroups.test.ts.
src/lib/dates.ts и src/lib/dayGroups.ts не менялись.
