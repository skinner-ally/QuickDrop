# fix-review5-actions-data

Задача: исправления ревью этапа 5, группа «actions-data» (M8, C7 — данные, C20 — данные, C6 — чистая функция, M3 — хук).
Границы: src/lib/actions.ts(+test), src/lib/savedSearch.ts(+test), src/db/repo.ts(+test), src/store/ui.ts(+test),
src/lib/hotkeyGuards.ts, src/hooks/useItems.ts, src/hooks/computeVisible.ts (+ новые тестовые файлы).

Статус: готово (typecheck и npm test — 57 файлов, 1780 тестов — проходят)

## Исправлено
- M8: `useUi.applyQuery(query, view?, home?)` — home задаёт appliedView (по умолчанию view). `actApplySearch` в «Графе»
  передаёт `viewForQuery(query) ?? 'graph'`: поиск с is:<раздел>, применённый в графе, не стирается при переходе в этот
  раздел; в чужой раздел — снимается, как раньше. Тесты: ui.test.ts, actions.test.ts.
- C7 (данные): `addPositions(map, expectCategory?)` — при переданном ожидании место пропускается, если категория записи
  в базе уже другая (проверка в той же rw-транзакции). Без второго параметра — прежнее поведение. Тест: repo.test.ts.
- C20 (данные): `computeLegend(items, inGraph, showArchive)` и хук `useLegendCounts(inGraph, showArchive)` в useItems.ts.
  Тест: src/hooks/legend.test.ts (новый).
- C6: `graphKeyTarget(selectedId, cursorId, inScene)` в hotkeyGuards.ts. Тест: src/lib/hotkeyGuards.test.ts (новый).
- M3 (данные): `useCategoryList(): Category[] | undefined`; `useCategories()` теперь отдаёт общий пустой массив, пока идёт чтение.

## Осталось экрану (чужие файлы)
- GraphView.tsx (C7): `useSaveLayout(layout, fixed, all)`; для id из `add` — `cats[id] = byId.get(id)?.categoryId ?? null`
  (byId — Map из того же `all`, по которому считалась раскладка); вызов `addPositions(add, cats)`. setPositions не трогать.
- GraphView.tsx (M3): `useCategoryList()` вместо useCategories; пока undefined — раскладку не считать и места не писать.
- Sidebar.tsx (C20): строки 122–132 → `const showArchive = useGraph((s) => s.showArchive)`, `const inGraph = view === 'graph'`
  (перенести выше, нижнее объявление удалить), `const { tags, perCategory } = useLegendCounts(inGraph, showArchive)`;
  импорт computeAllTags убрать, если больше не нужен.
- useGraphKeys.ts (C6, страховка к эффекту синхронизации курсора в GraphView): строка 85 →
  `const target = graphKeyTarget(ui.selectedId, g.cursorId, sc.byId)`.

## Файлы
src/db/repo.ts, src/db/repo.test.ts, src/store/ui.ts, src/store/ui.test.ts, src/lib/actions.ts, src/lib/actions.test.ts,
src/hooks/useItems.ts, src/hooks/legend.test.ts (новый), src/lib/hotkeyGuards.ts, src/lib/hotkeyGuards.test.ts (новый).
