# fix-final-ui-shell-list: готово (tsc -b чисто, npm test см. отчёт)

Новые файлы: src/lib/keys.ts (+keys.test.ts), src/components/layout/ErrorBoundary.tsx (ErrorBoundary, StorageErrorFallback, RetryFallback, lazyRetry).

- [medium] App ErrorBoundary: исправлено (граница выше ThemeProvider, фолбэк без БД, onUncaughtError в main.tsx).
- [high] Клавиши списка vs открытая запись: исправлено (эффект курсор<-selectedId; activeItem() из снапшота; DetailPane не возвращает фокус на старую строку).
- [medium] Lazy-чанки: исправлено (ErrorBoundary + lazyRetry вокруг Settings/Detail/Palette/Triage, .catch у предзагрузок).
- [medium] Модальный лист: исправлено (data-detail-sheet; Ctrl+A/Esc/отмеченные игнорируются в ItemList).
- [medium] Вставка текст+PNG: useHotkeys исправлено; QuickCapture.tsx onPaste — ТРЕБУЕТ ПРАВКИ ЧУЖОГО ФАЙЛА (то же условие: текст, если text/plain непуст И все файлы image/* И types содержит text/html|text/rtf; тогда не делать preventDefault).
- [low] Мобильная «Назад»: пропущено (нужен pushState для модальных слоёв, затрагивает hash-синхронизацию и QuickCapture; не мала/не безопасна).
- [low] Сетка: исправлено (колонки по DOM, ↑/↓ на ±cols, ←/→ ±1, J/K линейно).
- [low] Клавиши под слоем: исправлено (captureOpen/paletteOpen/navOpen в ItemList и Triage). Проверка «событие из диалога разбора» не добавлена.
- [low] Вспышка тёмной темы: требует правки index.html (чужой файл): блокирующий внешний скрипт, читающий qd-theme, или `@media (prefers-color-scheme: dark) { html { background: ... } }`.
- [low] macOS Option+N / Ctrl+K: исправлено (на Mac mod=⌘; Alt+N не перехватывается в полях).
- [low] Esc: исправлено (useHotkeys preventDefault при закрытии деталей; ItemList чистит отметки только без preventDefault; Esc в поле при открытых деталях снимает фокус).
- [low] Drop мимо формы: исправлено (openCapture({files}) всегда).
- [low] ItemsView/InboxView пустая выдача: исправлено (ItemList остаётся смонтированным, пустое состояние через emptyState).
- [low] Мёртвая подписка quick-add: удалена.
- [low] theme-color: light = #FBFAF8.
- matchKey: применён в useHotkeys, ItemList, TriageMode, TopBar, Sidebar (Enter в полях оставлен на e.key из-за NumpadEnter).
