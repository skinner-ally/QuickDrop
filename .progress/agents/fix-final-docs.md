# fix-final-docs

**Задача:** исправить находки финального ревью по области «docs» (README.md, CLAUDE.md, PROGRESS.md).

**Статус:** готово

## Находки

1. **medium, README.md (строки 89-90): PWA описан как неподключённый.** Исправлено. Абзац заменён описанием фактического поведения: установка на экран «Домой», офлайн-кэш через SW, автообновление (autoUpdate), ярлык «Быстрая запись» (`/?capture=1`), share_target (Android, iOS не поддерживается), отключение SW в dev (`devOptions`) и в Tauri (`TAURI_ENV_PLATFORM`). В раздел «Стек» добавлен vite-plugin-pwa (Workbox).
2. **low, README.md (строки 119-120): «изменение применяется после перезапуска».** Исправлено. Указано, что новое сочетание применяется сразу; при занятости или ошибке остаётся прежнее.
3. **low, CLAUDE.md (строка 208): next-themes.** Исправлено. Указано, что используется свой `ThemeProvider` / `useTheme` из `src/components/layout/ThemeProvider.tsx`, пакет next-themes не используется.
4. **low, CLAUDE.md: нет desktop.ts, pwa.ts, настроек capabilities, cn как реэкспорта.** Исправлено. В «Структуру» добавлены `lib/desktop.ts`, `lib/utils.ts` (cn — реэкспорт пакета `cn`), `pwa.ts`, `src-tauri/capabilities/default.json`, `src-tauri/src/`. Добавлен раздел «Платформы → Tauri».

## Изменённые файлы

- README.md
- CLAUDE.md
- .progress\agents\fix-final-docs.md

## Требует правки чужого файла

Нет.

## Проверка

- `npx tsc -b` — без ошибок.
- `npm test` — 10 файлов, 432 теста, все прошли.

## Не менялось

Раздел CLAUDE.md «Возобновление работы», правила прогресса, PROGRESS.md (находки его не касались). git не трогался.
