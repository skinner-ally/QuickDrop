# stage8-ci

Задача: пакет «ci» этапа 8 (волна 1) — `.progress/spec-stage8.md` §7.
Файлы: `.github/workflows/ci.yml` (новый), `.github/workflows/release.yml`.

Статус: готово

## Сделано
- `ci.yml`: on push (main) и pull_request, `permissions: contents: read`. Задача `web` (ubuntu-latest): check-version
  без тега, npm ci, typecheck, test, build. Задача `rust` (windows-latest): Node 22, rust-toolchain stable,
  rust-cache (workspaces: src-tauri), npm ci, npm run build (dist для Tauri), cargo test --locked.
- `release.yml`: в `desktop` перед tauri-action добавлены «Сборка фронтенда для тестов Rust» и «Тесты Rust»
  с `if: matrix.platform == 'windows-latest'`. Остальное не менялось.
- Версии действий как в release.yml (checkout@v7, setup-node@v7, rust-toolchain@stable, rust-cache@v2).

## Проверено
- `node scripts/check-version.mjs` без аргумента проходит; `npm run typecheck`, `npm test` (2499) зелёные.
- Не проверено: сам прогон workflow на GitHub, разбор YAML парсером.
