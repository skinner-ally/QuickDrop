# fix-final-deferred

Задача: найти в отчётах `.progress/agents/fix-final-*.md` отложенные правки «требует правки чужого файла»,
проверить по коду, выполнить невыполненные, добиться зелёных `npm run typecheck`, `npm test`, `npm run build`.

Статус: готово

## Найденные отложенные пункты (все проверены по коду: ни один не был сделан) и что сделано

Из fix-final-ui-shell-list:
1. Вставка текст+PNG в QuickCapture. Сделано: общий `src/lib/clipboard.ts` (`filesFromClipboard`,
   `isRichTextPaste`, `pastedFiles`) + тест; useHotkeys и QuickCapture.onPaste используют его, без дублей.
2. Вспышка светлой темы. Сделано: `public/theme-init.js` (блокирующий внешний скрипт, ключ `qd-theme`,
   логика как в ThemeProvider), подключён в `index.html`. Проверено: в сборке путь переписывается от base
   (`/quickdrop/theme-init.js` при VITE_BASE), файл в precache SW, в Tauri-сборке тоже подключается.

Из fix-final-ui-detail-capture-settings:
3. decodeFile: тип Blob. Сделано: `safeBlobType` / `safeThumbType` в `lib/normalize.ts` (белый список
   image/audio/video, application/pdf, text/plain, иначе octet-stream; превью только png/jpeg/webp, иначе по
   сигнатуре). Объявленный тип остаётся в `mimeType`. Отступление от рекомендации: image/svg+xml сохраняется —
   UI показывает SVG только растеризованным (safeFileUrl), а демоданные и свои SVG после восстановления
   из копии иначе не отрисовывались бы вовсе.
4. Скачивание/экспорт в macOS-сборке. Сделано без новых зависимостей: `lib.rs` создаёт главное окно в
   `setup` (`create: false` в tauri.conf.json) и в macOS вешает `on_download` (путь «Загрузки/<имя>» от wry,
   событие `download-finished` с именем и успехом); `desktop.ts` слушает событие и показывает toast.
   Windows не тронут (WebView2 скачивает сам). Общий `saveBlob(blob, name)` в `lib/actions.ts`, им пользуются
   actDownload и DataSection.doExport. Код компилируется на всех ОС (`cfg!`), но в живом macOS не проверен.
5. ai.ts: проверка адреса. Сделано: `aiBaseUrlError` (разбор URL, а не регулярка: старая пропускала
   `http://localhost:80@evil.example`); вызывается в suggestForItem до fetch и в AiSection как validate.
6. sanitizeLinkMeta: image/favicon из копии не переносятся. Тест обновлён.

Из fix-final-core-logic:
7. ErrorBoundary вокруг раздела в AppShell (`key={view}`), фолбэк «Не удалось показать раздел» с кнопками
   «Повторить» и «Открыть настройки».
8. LinkCard: pending только при живой загрузке (`isLinkMetaLoading`), скелет — только если нет прежних данных.
9. describeError вместо локальных errMsg/errText/fail и `e instanceof Error ? …` во всех toast UI
   (QuickCapture, DataSection, save.ts, App, InboxView, BulkBar, TriageMode, ItemList, Tags/Categories/
   Section/Ai/Links/Appearance-секции, Sidebar, CategorySelect, CommandPalette, AiSuggest, LinkedItems, LinkPicker).
10. Текст диалога «Удалить все данные»: добавлены ключ API, настройки ИИ и адрес прокси.

Из fix-final-rust-platform:
11. repo.createItem: тот же `safeBlobType` для Blob своих файлов. Тест в repo.test.ts.
12. QuickCapture: черновик в sessionStorage через 400 мс после ввода, на pagehide и visibilitychange=hidden;
    не пишется во время сохранения, после успешного сохранения и поверх сохранённого черновика.
    Проверено в браузере (dev): черновик пишется при вводе и восстанавливается после перезагрузки.
13. README: VITE_BASE (в т.ч. Git Bash и PowerShell), frame-ancestors только заголовком хостинга, порядок
    выпуска версии, отложенная перезагрузка SW, скачивание в macOS, https для ИИ, очистка ключа.
14. ShortcutsSection: при `globalShortcutFailure() === settings.globalShortcut` подсказка поля — красная
    «Сочетание … не назначено».
15. CLAUDE.md: структура (errors, clipboard, swReload), PWA (swReload, CSP, theme-init, VITE_BASE),
    Tauri (окно в setup, скачивания, saveBlob), раздел «Безопасность данных».

Не трогал (это не отложенные правки, а сознательные пропуски в отчётах): мобильная «Назад»,
versionchange-баннер.

## Проверка
- `npm run typecheck` — ок.
- `npm test` — 17 файлов, 473 теста, все прошли (+8 новых: clipboard 4, ai 2, exportImport 1, repo 1).
- `npm run build` — ок (dist/ пересобран; sw.js и manifest есть).
- Сборки в scratchpad: `VITE_BASE=/quickdrop/` и `TAURI_ENV_PLATFORM=windows` — ок.
- `cargo check`, `cargo test --lib` (6 ок, 1 сетевой ignored) — ок. clippy не установлен.
- `npx oxlint src` — 35 предупреждений, 0 ошибок (как до правок).

## Изменённые файлы
- Новые: src/lib/clipboard.ts, src/lib/clipboard.test.ts, public/theme-init.js
- src/lib/normalize.ts, src/lib/exportImport.ts, src/lib/exportImport.test.ts, src/db/repo.ts, src/db/repo.test.ts
- src/lib/ai.ts, src/lib/ai.test.ts, src/lib/actions.ts, src/lib/desktop.ts
- src/hooks/useHotkeys.ts, src/components/capture/QuickCapture.tsx, src/components/layout/AppShell.tsx
- src/components/items/detail/LinkCard.tsx, detail/save.ts, detail/AiSuggest.tsx, detail/LinkedItems.tsx,
  detail/LinkPicker.tsx, src/components/items/BulkBar.tsx, TriageMode.tsx, ItemList.tsx, CategorySelect.tsx
- src/components/layout/Sidebar.tsx, src/components/palette/CommandPalette.tsx, src/App.tsx, src/views/InboxView.tsx
- src/views/settings/DataSection.tsx, AiSection.tsx, ShortcutsSection.tsx, Section.tsx, TagsSection.tsx,
  CategoriesSection.tsx, LinksSection.tsx, AppearanceSection.tsx
- index.html, src-tauri/src/lib.rs, src-tauri/tauri.conf.json
- README.md, CLAUDE.md
- git не трогал.
