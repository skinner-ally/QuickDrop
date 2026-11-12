# fix-review4-filter-search-ui

Задача: исправления ревью этапа 4, группа «filter-search-ui» (C3 экран, C11 п.4, M10, M11=M26, M12=M29, M13=M20, M23=M32, замечание приёмки A2).
Статус: готово (typecheck чисто; vitest: все зелёные, кроме чужого src/styles/markdown.test.ts).

Исправлено:
- C3: FilterBar подписан на useDayKey, при смене суток вызывает useUi.rollDatePreset(prev, new).
- C11 п.4: SavedSearches использует isSavedSearchActive(s, { view, query, filter }).
- M10: список поисков читается в SaveSearchButton и передаётся в SaveForm пропсом; M26: findSavedByQuery/alreadySavedText.
- M11: палитра не менялась, дубль закрыт actSaveCurrentSearch (toast «Уже сохранён…»).
- M12/M29: isUnfinishedDate (src/components/items/periodInput.ts + тест): год < 1000 при наборе не ошибка и не меняет фильтр; при открытии поповера поля и ошибка сверяются с фильтром.
- M13/M20: NavButton получил необязательный className; строки поисков pr-8 / pointer-coarse:pr-10.
- M23/M32: ItemsView archive: «Del — в корзину»; остальные подсказки согласованы с ShortcutsSection.
- A2: FilterBar — внешний flex-ряд; на desktop (>=768) прокручиваемая часть min-w-0 flex-1, блок сортировки и вида справа shrink-0; на мобильном блок остался внутри прокручиваемого ряда, как было.

Не сделано: CommandPalette.tsx, TopBar.tsx не менялись (не требовалось).
Файлы: FilterBar.tsx, SaveSearchButton.tsx, SavedSearches.tsx, NavButton.tsx, ItemsView.tsx, новые periodInput.ts/.test.ts.
