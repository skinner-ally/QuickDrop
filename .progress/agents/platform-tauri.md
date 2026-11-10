# platform-tauri

Статус: готово

Результат: src-tauri (Cargo.toml, build.rs, tauri.conf.json, capabilities/default.json, src/lib.rs, src/main.rs, app-icon.svg, icons/), src/lib/desktop.ts (initDesktop, applyGlobalShortcut, openExternal), правки src/main.tsx, vite.config.ts, src/views/settings/ShortcutsSection.tsx, package.json (+@tauri-apps/plugin-opener).
Проверено: cargo check OK, npx tsc -b OK, tauri icon из SVG OK. Не проверено: tauri build/dev, реальная работа сочетания и fetch_link_meta.
Контракт: actOpen и ссылки в UI должны вызывать openExternal из '@/lib/desktop'.
