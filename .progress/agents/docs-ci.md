# docs-ci

Задача: написать `.github/workflows/release.yml` (сборка Tauri 2 через tauri-action по тегу v* и вручную: Windows + macOS universal; job web: typecheck, test, build, upload dist) и `README.md` (по-русски, кратко и точно, факты сверены с CLAUDE.md и кодом src/views/settings/*, src/search/query.ts).

Статус: готово (с оговорками ниже)

Результат:
- release.yml: jobs `desktop` (matrix: windows-latest; macos-latest с `--target universal-apple-darwin`, rustup-таргеты aarch64/x86_64 через dtolnay `targets`, tauri-action@v1 с tagName v__VERSION__, releaseName 'QuickDrop v__VERSION__', releaseDraft true, permissions contents: write только на этом job) и `web` (npm ci, typecheck, test, build, upload-artifact dist).
- Версии actions: актуальные мажоры по `gh api releases/latest` — checkout@v7, setup-node@v7 (в docs-platform.md указан v6, взят более новый), upload-artifact@v7, swatinem/rust-cache@v2, dtolnay/rust-toolchain@stable (как в задаче), tauri-apps/tauri-action@v1 (тег v1 существует).
- Не проверено: YAML не валидирован парсером (в окружении нет yaml/js-yaml), сам workflow не запускался. src-tauri неполный (нет tauri.conf.json, Cargo.toml), поэтому сборка и пути bundle не проверены.
- README.md: описание, возможности, стек, требования, команды (сверены с package.json), пути установщиков (по умолчанию Tauri 2, не проверены), сборка macOS, iPhone, данные (IndexedDB, экспорт/импорт), горячие клавиши, операторы поиска, ИИ-помощник.
- Замечено: vite-plugin-pwa в зависимостях, но не подключён в vite.config.ts, манифеста и service worker нет. В README это указано.
- npx tsc -b: ошибка вне моих файлов — src/lib/actions.ts(175,45): Cannot find module '@/lib/desktop'. Мои файлы не TypeScript.

Изменённые файлы:
- .github\workflows\release.yml
- README.md
- .progress\agents\docs-ci.md
