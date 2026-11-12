# tauri-backup

Задача: этап 2, `.progress/spec-tauri.md` §0 и Часть 1 (1.1–1.11) — автобэкап и экспорт в папку:
Rust `src-tauri/src/backup.rs` + команды, `src/lib/ipc.ts`, добавления в `src/lib/desktop.ts`,
`src/lib/autoBackup.ts`, `src/lib/exportDir.ts`, тесты.

Статус: готово

## Результат

Rust (`src-tauri`):
- `Cargo.toml`: `tauri-plugin-dialog = "2"` (в lock 2.8.4, тянет `tauri-plugin-fs` 2.7.1), `percent-encoding = "2"`, `dunce = "1"`.
- `src/backup.rs`: константы, типы, `ApprovedDirs` (load / approve / resolve), чистые функции
  (`is_backup_name`, `is_backup_part_name`, `safe_rel_path`, `write_chunk`, `list_in`, `prune_in`, `body_bytes`,
  `header_args`, `io_message`), команды `pick_directory`, `save_backup`, `prune_backups`, `list_backups`,
  `write_export_file`; 33 теста в `#[cfg(test)]`.
- `src/lib.rs`: `mod backup;`, плагин dialog, `manage(ApprovedDirs)`, пять команд в `generate_handler!`.
- `capabilities/default.json`: добавлена только `opener:allow-reveal-item-in-dir`.

TypeScript:
- `src/lib/ipc.ts`: `IPC_ARGS_HEADER`, `IPC_CHUNK_BYTES`, `InvokeFn`, `encodeIpcArgs`, `ipcError`, `invokeChunked`.
- `src/lib/desktop.ts` (только добавления): `SavedFile`, `BackupEntry`, `PruneResult`, `DESKTOP_ONLY_MESSAGE`,
  `pickDirectory`, `saveBackupFile`, `pruneBackups`, `listBackups`, `writeExportFile`, `revealInExplorer`;
  в `initDesktop()` после `listenDownloads()` — динамический импорт `./autoBackup` и `initAutoBackup()`.
- `src/lib/autoBackup.ts`: константы, `autoBackupFileName`, `clampKeep`, `isBackupDue`, `createAutoBackup`,
  синглтон `initAutoBackup` / `runBackupNow` / `checkAutoBackup` / `autoBackupStatus`.
- `src/lib/exportDir.ts`: `ExportAttachment`, `ExportDoc`, `ExportDirOptions`, `ExportDirReport`,
  `exportDocsToDir`, `ItemToDoc`, `exportMarkdownToDir`.
- Тесты: `ipc.test.ts` (17), `autoBackup.test.ts` (35), `exportDir.test.ts` (19).

## Проверки

- `cargo test --manifest-path src-tauri/Cargo.toml` — 39 прошло, 1 пропущен (сетевой `fetch_public_page`, был и раньше).
  Тест ссылки наружу (`export_target_refuses_link_out_of_dir`) на этой машине выполнился, а не пропустился.
- `cargo check --manifest-path src-tauri/Cargo.toml` — без предупреждений.
- `npm run typecheck` — после написания моих файлов прошёл чисто. При повторных запусках в конце (три раза с
  паузами) падает только на чужом `src/search/search.test.ts` (неиспользуемые импорты, файл в работе у другого
  агента); в моих файлах ошибок нет.
- `npx vitest run src/lib/ipc.test.ts src/lib/autoBackup.test.ts src/lib/exportDir.test.ts` — 71 прошёл.
- `npx oxlint` по своим файлам — без замечаний.
- `npm test` — 1079 прошло, 2 падают в чужих файлах:
  `src/lib/actions.test.ts` «удаление и отмена во время загрузки не оставляют вечную „загрузку“» (после
  `actDelete` запись остаётся с `deletedAt` — корзина из `db/repo.ts`) и `src/lib/itemTitle.test.ts`
  «formatDayLabel › негодная отметка — заглушка». Мои модули эти тесты не затрагивают.

## Отступления

- `runNow()` при идущем запуске отдаёт его итог, но если идущая плановая проверка закончилась пропуском
  (`not-due`, `off`, `empty`), запускает копию сам: иначе «Создать копию сейчас» молча ничего бы не сделала.
  При идущей настоящей копии — тот же объект результата.
- `runNow()` вне Tauri возвращает `skipped/not-desktop` (в спецификации описано только для `check()`).
- `exportDocsToDir` без подмены `write` вне Tauri бросает `DESKTOP_ONLY_MESSAGE` сразу, до первого файла;
  тот же текст от подменённой записи считается прерывающим наравне с «Папка не …».
- Отмена во время записи файла (из `invokeChunked` приходит «Отменено») превращается в «Экспорт отменён»,
  а не попадает в `failed`.
- Rust: `write_export_file` проверяет, что существующая часть пути внутри папки, ещё до `create_dir_all`
  (ссылка внутри папки не уводит создание каталогов наружу), затем повторно после; `.qdpart` под именем
  ссылки или каталога отклоняется; остатки `.qdpart`, убранные обрезкой, в `removed` не входят
  (там только автокопии).
- В тестах Rust вместо `unwrap_err()` для `list_in` / `prune_in` — `.err().unwrap()`: типы по спецификации
  имеют только `Serialize`, без `Debug`.

## Не проверено

- Работа в настоящем окне Tauri (`npm run tauri dev` запускать нельзя): диалог выбора папки, передача сырого
  тела и заголовка `x-qd-args` через IPC, запасной канал `postMessage`, `revealItemInDir`, toast при сбое
  плановой копии, сценарии ручной проверки из п. 1.11.
- macOS и Linux: Rust собирался и тестировался только в Windows.
- Сборка (`npm run build`, `npm run tauri build`) — делает основная сессия.

## Изменённые файлы

- `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/src/lib.rs`, `src-tauri/src/backup.rs` (новый),
  `src-tauri/capabilities/default.json`
- `src/lib/desktop.ts`
- `src/lib/ipc.ts`, `src/lib/ipc.test.ts`, `src/lib/autoBackup.ts`, `src/lib/autoBackup.test.ts`,
  `src/lib/exportDir.ts`, `src/lib/exportDir.test.ts` (новые)
