# stage8-ext-bundle

Задача: расширение Chrome в установщике (spec-stage8 §5.3, Р11).
Статус: готово

## Результат
- `tauri.conf.json`: `bundle.resources = { "../extension/": "extension/" }` (форма Map из tauri-utils 2.10.2,
  `BundleResources::Map`; каталог обходится рекурсивно с сохранением структуры). `cargo test` собирает,
  tauri-build копирует папку в `target/debug/extension` — путь работает и в `tauri dev`.
- `shell.rs`: `extension_dir_in(resource_dir) -> Option<PathBuf>` (каталог `extension` с файлом `manifest.json`,
  путь через `dunce::canonicalize`, запасной — `dunce::simplified`) + команда `extension_dir` («Папка расширения
  не найдена»). Тесты: есть, нет каталога, нет ресурсов, без манифеста, манифест-каталог, `extension` — файл,
  конфиг содержит ресурс и исходная папка с манифестом.
- `lib.rs`: регистрация `shell::extension_dir`.
- `desktop.ts`: `getExtensionDir(): Promise<string | null>` (вне Tauri, отказ, пустой/нестроковый ответ — null).
- `shellUi.ts`: шаг 2 по §5.3; `EXTENSION_DIR_SOURCE_HINT`, `EXTENSION_UPDATE_HINT`, `extensionManifestPath(dir)`.
- `QuickCaptureSection.tsx`: `ExtensionDirRow` под шагами установки — путь (моно, select-all), «Показать папку»
  (revealInExplorer на manifest.json), «Копировать путь»; без папки — строка про исходники.
- `extension/README.md`: шаг установки и обновление после обновления QuickDrop.

## Проверки
- `cargo test`: 130 passed, 2 ignored (в т.ч. 5 новых), без предупреждений.
- `npm run typecheck` — ок; `npm test` — 86 файлов, 2545 passed (первый прогон падал в чужом
  queryHints.test.ts — пакет другого исполнителя; повторный прошёл).
- Не проверено: `tauri build` (MSI/NSIS), вид блока в настройках, «Показать папку» в живом окне.

## Изменённые файлы
src-tauri/tauri.conf.json, src-tauri/src/shell.rs, src-tauri/src/lib.rs, src/lib/desktop.ts,
src/lib/desktop.test.ts, src/lib/shellUi.ts, src/lib/shellUi.test.ts,
src/views/settings/QuickCaptureSection.tsx, extension/README.md
