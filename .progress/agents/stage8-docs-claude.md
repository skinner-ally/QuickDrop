# stage8-docs-claude

Задача: пакет «docs-claude» этапа 8 (волна 1) — `.progress/spec-stage8.md` §6.2. Полная предлагаемая редакция
`CLAUDE.md` в `.progress/CLAUDE.proposed.md`. Сам `CLAUDE.md` не менялся.
Файлы: `.progress/CLAUDE.proposed.md` (новый), этот файл.

Статус: готово

## Результат
- `.progress/CLAUDE.proposed.md` — полная редакция (первая строка по спецификации), 10 разделов по §6.2.
- Источники: код `src/**` (экспорты сверены grep по каждому модулю), `src-tauri/src/*.rs`, `tauri.conf.json`, capabilities,
  `vite.config.ts`, `package.json`, `Cargo.toml`, `docs/DESIGN.md`, `.github/workflows/*`, `extension/*`; контракты этапа 8:
  `ai`, `ocrState`, `actions`, `repo`, `queryHints`, `ocrView`, `useOcr`, `desktop.getExtensionDir`, `bundle.resources`, `shell::extension_dir`
  сверены с уже написанным кодом; `ocr` (`drainVisionBacklog`, `startVisionAuto`, зрение), `visionImage`, `pdfRender`, `pdfEngine`
  (`wasmUrl`, `pageImage`), плагин Vite `quickdrop:pdf-decoders` — по спецификации §3 (код пакета `ocr-logic` на момент
  работы не был сдан).

## Расхождения нынешнего CLAUDE.md с кодом
1. `deleteItem` описан как каскадное удаление (files + links) — в коде это перенос в корзину (`deletedAt`); окончательное удаление —
   `purgeItems`/`emptyTrash`/`purgeExpired`; `restoreItem` теперь снимает `deletedAt` или воссоздаёт запись из снимка; есть `restoreFromTrash`.
2. Модель данных: нет `deletedAt`, `ocrText`/`ocrAt`/`ocrVisionAt`, таблиц `positions` и `searches`, схемы v2, источников `extension`/`share`,
   большинства настроек (сцена, шрифт, корзина, копии, ИИ-распознавание, трей, мини-окно, расширение), `PRIVATE_SETTINGS`/`CLEARED_SETTINGS`.
3. Структура: нет `components/{graph,icons,items/detail,markdown,palette}`, `views/{GraphView,TrashView,ItemsView,settings/*}`, `styles/`,
   `store/{graph,selection,confirm}`, `lib/{graph,ambient,pixelfx}` и десятков модулей `lib`, `test/`, `capture.html`, `src/capture-main.tsx`,
   `src-tauri/src/{shell,backup,ext_server}.rs`, `capabilities/capture.json`, `extension/`, `scripts/`, `docs/`, `mockup/`, `public/`, `.github/`.
4. Контракты: `searchItems` имеет 4-й аргумент `options` (`within`, `trash`, `now`) и при пустом тексте возвращает записи, прошедшие фильтр, а
   не «все items»; `parseQuery(raw, now?)`, `ParsedQuery.phrases`; операторы `date:`/`after:`/`before:`, `is:untagged|trash`, `has:link`, русские
   псевдонимы; `exportBackup(options?)`; `ImportReport` расширен (`positions`, `searches`, `trashed`); `useAllItems` — без корзины (есть
   `useTrashedItems`, `useItemsWithTrash`); `ItemList.variant` включает `'trash'`; `fetchLinkMeta` и `suggestForItem` — без изменений.
5. Клавиши: `Del` в списке теперь в корзину (не «удалить»); не описаны `1`–`5`, клавиши корзины и графа, адрес `#/раздел`; глобальное сочетание в
   Tauri открывает мини-окно (при `captureWindow`), а не «поднимает окно и открывает добавление» (это запасной вариант).
6. Раздел «Дизайн» устарел: одна «бумажная» тема, lucide 16px, `ThemeProvider` только с темой — теперь пять сцен, `px-*`, `Icon` вместо lucide,
   `useScene`, четыре шрифта, запрет `!`; заменён ссылкой на `docs/DESIGN.md` и выжимкой.
7. Стек и команды: нет pdfjs-dist, react-markdown, remark-gfm, cmdk, `@fontsource*`, oxlint; нет `npm run lint`, `npm run icons` (был только в «PWA»),
   `cargo test`, `check-version.mjs`; не сказано, что Vitest работает без DOM.
8. Tauri: описано одно окно, три функции `desktop.ts` и один набор прав — в коде два окна (`main`, `capture`), трей, автозапуск (HKCU), один
   экземпляр, ~20 команд Rust в `lib.rs`/`backup.rs`/`shell.rs`/`ext_server.rs`, `desktop.ts` с десятками экспортов, два файла capabilities
   (в default добавлены `is-visible`, `reveal-item-in-dir`), ресурсы установщика (`extension/`), события Rust → окно.
9. PWA: `share_target` теперь открывает запись с `source: 'share'` (не `paste`); `licenses/*.txt` исключены из `navigateFallback`, `pdfjs/**` — из precache (по спецификации, `ocr-logic`); CSP веб-сборки
   содержит `worker-src 'self'`; добавлен плагин `quickdrop:pdf-decoders`.
10. Правила кода: сеть описана без `recognizeImage` и без входящего сервера расширения; исключения для записи в БД не включали
    `settleStaleLinkMeta`; нет правил про корзину и распознавание (не меняют `updatedAt`), `confirmDialog`, `actions.ts` как единственное место
    типовых действий, чистую логику вне компонентов.
11. «Безопасность данных»: нет подтверждённых папок автокопий, сервера расширения, распознавания (что уходит в сеть), WebAssembly в CSP.
12. «Возобновление работы»: перечень файлов `.progress` расширен (`spec-stage*.md`, `*-result.json`, `review*`), правило про `CLAUDE.proposed.md`.
