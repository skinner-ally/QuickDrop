# stage7-ui-settings

Задача: пакет «ui-settings» этапа 7 (волна 1) — секция настроек «Быстрый захват» по `.progress/spec-tauri.md` п. 2.14.6.

Статус: готово

## Сделано
- `src/views/settings/QuickCaptureSection.tsx` (новый): `QuickCaptureSection({ settings })`, `id="quick-capture"`.
  Вне Tauri — только абзац `QUICK_CAPTURE_DESKTOP_HINT`. В Tauri: «Мини-окно быстрой записи», «Глобальное сочетание»
  (перенесено без изменений поведения), «Сворачивать в трей при закрытии», «Запускать вместе с системой»,
  блок «Расширение для Chrome» (приём, состояние, порт, токен, установка).
- `src/views/SettingsView.tsx`: секция сразу после `ShortcutsSection`; у `ShortcutsSection` убран ненужный проп.
- `src/views/settings/ShortcutsSection.tsx`: поле сочетания заменено строкой-указателем; сигнатура без `settings`.

## Проверки
`npm run typecheck` — чисто; `npm test` — 78 файлов, 2302 теста, прошли. В браузере не смотрел (запрещено правилами).
