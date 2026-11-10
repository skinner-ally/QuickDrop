# review-final-platform

Задача: финальное ревью, линза «платформы, сборка и документация» (только чтение).
Статус: готово

## Что проверено
- vite.config.ts, src/pwa.ts, index.html, public/* (размеры PNG по заголовкам IHDR), dist/ (manifest, sw.js, пути в index.html).
- src-tauri: tauri.conf.json, Cargo.toml/Cargo.lock, capabilities/default.json (все 10 идентификаторов есть в gen/schemas/desktop-schema.json), lib.rs, main.rs, иконки (.ico: 16/24/32/48/64/256; .icns валиден, длина совпадает).
- Исходники tauri-runtime-wry 2.12.3 / wry 0.57.2 из cargo registry (drag-drop и download).
- src/lib/desktop.ts, src/hooks/useHotkeys.ts, ShortcutsSection, actions.ts, DataSection.
- .github/workflows/release.yml (теги actions существуют: checkout/setup-node/upload-artifact v7, tauri-action v1, rust-cache v2).
- README.md, CLAUDE.md, PROGRESS.md, package.json, .gitignore, .oxlintrc.json; `npx oxlint src` — только предупреждения стиля/React Compiler, реальных ошибок нет (bad-match-all-arg в CodeView — ложное: new RegExp(re) сохраняет флаг g).

## Находки (по важности)
1. HIGH src-tauri/tauri.conf.json:13 — не задан `dragDropEnabled: false`. По умолчанию Tauri ставит свой обработчик (tauri-runtime-wry возвращает true → wry не передаёт событие в WebView), HTML5 dragenter/drop для файлов в окне не приходят. useHotkeys слушает только DOM-события → перетаскивание файлов в настольной версии не работает (Windows и macOS), хотя README и «Настройки → Горячие клавиши» его обещают. Исправить: `"dragDropEnabled": false` в описании окна.
2. HIGH src/views/settings/DataSection.tsx:93, src/lib/actions.ts:194 — экспорт резервной копии и «Скачать» сделаны через `<a download>` + blob. В macOS-сборке wry отменяет навигацию-скачивание, если не задан download handler (wkwebview/navigation.rs: has_download_handler=false → Cancel), а в lib.rs on_download нет. На macOS кнопки ничего не делают — единственный способ переноса данных недоступен. Исправить: on_download в Rust либо сохранение через plugin-dialog + plugin-fs. На Windows не проверялось вживую.
3. MEDIUM README.md:89 — «vite-plugin-pwa … в vite.config.ts не подключён: манифест и офлайн-кэш пока не настроены» — неверно: плагин подключён, dist содержит manifest.webmanifest и sw.js. В разделе «Стек» плагин не упомянут.
4. MEDIUM vite.config.ts:29 / index.html — base не задан, start_url/scope/id/share_target/shortcut = '/', в index.html абсолютные /favicon.svg, /apple-touch-icon.png, /assets/*. При размещении в подкаталоге (GitHub Pages project site) — пустая страница и 404. README:75 обещает «любой статический хостинг». Исправить: base из env + относительные start_url/scope, либо оговорка в README.
5. MEDIUM .github/workflows/release.yml:51 — job `desktop` не зависит от `web` (typecheck/test): черновик релиза с установщиками публикуется и при красных тестах. Добавить `needs: web`.
6. LOW README.md:120 — «изменение применяется после перезапуска» неверно: applyGlobalShortcut перерегистрирует сочетание сразу.
7. LOW src/pwa.ts:79 — toast «Приложение обновлено» вызывается при импорте модуля, до монтирования <Toaster>; sonner не доставляет тосты, созданные до подписки → сообщение никогда не показывается.
8. LOW .github/workflows/release.yml:46 — tagName `v__VERSION__` берётся из tauri.conf.json, а не из запушенного тега: пуш v0.2.0 без правки версии (в 3 файлах) создаст/дополнит релиз v0.1.0.
9. LOW CLAUDE.md:208 — «next-themes» (пакета нет, свой ThemeProvider); нет раздела про Tauri/src/lib/desktop.ts; README.md «Стек» аналогично.
10. LOW src/hooks/useHotkeys.ts:176-189 — подписка на событие `quick-add`, которое Rust нигде не эмитит; комментарий «окно уже поднято Rust-стороной» неверен (поднимает desktop.ts). Мёртвый код + лишний динамический чанк event.
11. LOW src/components/layout/ThemeProvider.tsx:8 — theme-color светлой темы #f7f5f1 не совпадает с фоном (#FBFAF8 в index.html/manifest, --background) → полоса другого оттенка в адресной/статусной строке.
12. LOW package.json — `clsx` и `tailwind-merge` в dependencies не импортируются (cn берётся из пакета `cn`). `cn` и `shadcn` используются (src/lib/utils.ts, @import "shadcn/tailwind.css") — переносить не нужно; next-themes отсутствует.

## Изменённые файлы
Только этот отчёт.
