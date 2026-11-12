# fix-review4-tauri-keep

Задача: исправления ревью этапа 4, группа «tauri-keep» — C5 (keep в forget_directory),
C6/M30 (часть в lib: ожидание конца копии перед отзывом папки), M16 (сверка подтверждённых папок при запуске),
M15 (часть в lib: повторный выбор той же папки после сбоя).

Файлы (только эти): src-tauri/src/backup.rs, src-tauri/src/lib.rs, src/lib/desktop.ts, src/lib/desktop.test.ts,
src/lib/backupUi.ts, src/lib/backupUi.test.ts, src/lib/autoBackup.ts, src/lib/autoBackup.test.ts.

Статус: готово

## Что сделано

### C5 — keep
- Rust: `ApprovedDirs::forget(dir, keep: &[String])`; `forgotten_dirs(.., keep: &[PathBuf], ..)` — записи из keep
  отсеиваются первыми (не убираются и не канонизируются). `keep_paths`: trim, без пустых и неполных путей.
  Команда `forget_directory(dir, keep: Option<Vec<String>>)`.
- Тесты cargo: `forget_keeps_dirs_in_use` (оба направления: настоящий путь ↔ ссылка, и мусор в keep),
  случай keep в `forgotten_dirs_exact_then_canonical`; `forget_removes_links_to_same_dir` оставлен с пустым keep.
- TS: `forgetDirectory(dir, keep = [])` → `invoke('forget_directory', { dir, keep })` без пустых строк; тесты.
- backupUi.ts: `dirsInUse(settings)` и `forgetUnusedDir(prev, deps)` (ждёт idle, затем читает настройки,
  prev снова в настройках — не отзывает, keep — все папки из настроек); тесты.
- autoBackup.ts: `forgetPrevDir(prev)` — `forgetUnusedDir` с настоящими зависимостями; тест проводки.

### C6/M30 — часть в lib
- `AutoBackup.idle()` (цикл: ждёт и копию, которую runNow перезапустил после пропуска плановой проверки),
  экспорт `autoBackupIdle()`. `forgetPrevDir` ждёт его перед отзывом. Тесты: сразу без запуска, ждёт идущую,
  после сбоя резолвится, ждёт перезапуск runNow (мутационная проверка: без цикла тест падает).

### M15 — часть в lib
- `AutoBackup.resetFailure()` / `resetAutoBackupFailure()`: снимает паузу, ошибку и флаг «уже сообщили».
- `AutoBackup.dirChanged()` / `autoBackupDirChanged()`: idle → resetFailure → check. Повторный выбор той же
  папки после сбоя даёт копию сразу; проверка новой папки во время копии не уходит в busy.
- `status()` возвращает тот же объект, пока состояние не изменилось; `subscribe()` / `subscribeAutoBackup()` —
  для `useSyncExternalStore`. Тесты.

### M16 — сверка при запуске
- Rust: `ApprovedDirs::retain(keep)` (точное совпадение, без канонизации, только убирает; общий `replace`
  с forget), команда `retain_directories(keep)` в `generate_handler!`. В отладочной сборке команда ничего
  не делает: у `tauri dev` другая IndexedDB (devUrl), а approved-dirs.json общий с установленным приложением
  (тот же identifier) — сверка отзывала бы его папки.
- Тесты cargo: `retain_keeps_only_dirs_in_settings`, `retain_removes_other_spelling_of_kept_dir`,
  `retain_failure_keeps_list_unchanged`.
- TS: `retainDirectories(keep)`, `reconcileApprovedDirs()` (не прочитались настройки — ничего не отзывает),
  вызов в `initDesktop`; тесты.

## Не сделано (чужие файлы)
- BackupSection.tsx: переход на `forgetPrevDir`, `autoBackupDirChanged`, подписку на статус, `disabled`
  у DirRow на время экспорта/копии (C6 п. 1, M30) — см. ответ исполнителя (skipped).
- Документы: spec-stage4.md §5.7 и контракт forgetDirectory, Р17, HANDOFF.md:58.

## Проверка
- `npm run typecheck` — чисто; `npm test` — 46 файлов, 1448 тестов зелёные.
- `cargo test` — 60 passed, 1 ignored; тесты со ссылками не пропущены (точка соединения создалась).
- `cargo check` и `cargo check --release` — без предупреждений.
