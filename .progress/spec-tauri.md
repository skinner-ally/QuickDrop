# Спецификация: оболочка Tauri

Автор: архитектор `spec-tauri`, 2026-11-11. Основание: `.progress/plan-combined.md` (этапы 2, 7, 8).
Часть 1 исполняется на этапе 2 агентом `tauri-backup`. Часть 2 — проработка этапа 7 и приёмки этапа 8.
Часть 2 сверена с кодом перед этапом 7 (2026-11-13, `spec-stage7`); исполнение этапа 7 — п. 2.14.

## 0. Исходное состояние (проверено)

| Что | Значение |
|---|---|
| `tauri` в `Cargo.lock` | 2.12.5 (runtime-wry 2.12.3, wry 0.57.2, tao 0.37.2, tray-icon 0.25.1 — уже в lock как необязательная) |
| Плагины в проекте | `tauri-plugin-opener` 2.7.3, `tauri-plugin-global-shortcut` 2.4.1, `tauri-plugin-single-instance` 2.5.5 (уже подключён, поднимает `main`) |
| Последние 2.x на crates.io | `tauri-plugin-dialog` 2.8.4 (тянет `tauri-plugin-fs` 2.7.1), `tauri-plugin-autostart` 2.7.0, `tauri-plugin-deep-link` 2.6.3; все требуют `tauri ^2.12`, rust 1.90 (локально rustc 1.99.1). (уточнено после ревью этапа 7) Плагин автозапуска в проекте не используется — п. 2.4 |
| npm | `@tauri-apps/api` 2.12.4, `@tauri-apps/plugin-dialog` 2.8.4, `@tauri-apps/plugin-autostart` 2.7.0, `@tauri-apps/plugin-deep-link` 2.6.3 |
| Внимание | `cargo search` показывает `3.0.0-alpha.*` — это Tauri 3. В `Cargo.toml` писать `"2"`, не `"*"` и не альфу |
| Сборка сейчас | `quickdrop.exe` 5,24 МБ; NSIS 2,35 МБ; MSI 3,00 МБ (база для сравнения на этапе 8) |
| IPC | `invoke(cmd, args, options)`: `args` может быть `Uint8Array`/`ArrayBuffer` → в Rust `tauri::ipc::Request::body()` = `InvokeBody::Raw`; `options.headers` → `Request::headers()`. Запрос идёт `fetch` на `http://ipc.localhost` (разрешён в CSP); при отказе канала Tauri переходит на `postMessage`, и двоичное тело приходит как `InvokeBody::Json` (массив чисел) |
| Команды приложения | Разрешены всем окнам без записи в capabilities (манифест команд в `build.rs` не задан) — так и остаётся |
| Тесты JS | vitest, окружение `node`, `src/**/*.test.ts` |

---

# Часть 1. Автобэкап и экспорт в папку (этап 2)

## 1.1. Решения

1. **Расписание — в JS, запись — в Rust.** Данные лежат в IndexedDB, читать их может только веб-слой
   (`exportBackup()`); Rust только пишет байты на диск.
2. **Папку выбирает Rust, а не JS.** Команда `pick_directory` сама открывает системный диалог
   (`tauri-plugin-dialog`, Rust API) и заносит выбранную папку в список подтверждённых
   (`approved-dirs.json` в каталоге настроек приложения). Команды записи принимают `dir` строкой, но работают
   только с подтверждённой папкой. Обоснование: `write_export_file` пишет файлы с произвольными именами
   (вложения пользователя, в т.ч. `.exe`, `.bat`); без списка любая ошибка внедрения скрипта в веб-слое
   превращалась бы в запись в «Автозагрузку». Следствие: npm-пакет `@tauri-apps/plugin-dialog` и право
   `dialog:allow-open` **не нужны**, `package.json` на этом этапе не меняется. (обновлено после ревью этапов 1–2) Заголовок диалога Rust выбирает сам по коду назначения (`purpose`), свой текст веб-слой не передаёт (внедрённый скрипт иначе выдал бы свой вопрос за вопрос приложения); начальная папка диалога принимается, только если она уже подтверждена.
3. **Данные передаются частями по 8 МиБ** сырым телом `invoke`; параметры — в заголовке `x-qd-args`.
   Одним вызовом нельзя: копия до 480 МБ дала бы пик памяти 1,5–3 ГБ (ArrayBuffer в JS + тело запроса
   в процессе WebView2 + `Vec<u8>` в Rust, а в запасном канале `postMessage` — JSON-массив чисел).
4. **Атомарность**: части дописываются во временный файл `<имя>.qdpart` в той же папке, на последней части —
   `sync_all` и `rename` поверх итогового имени.
5. **Имя автокопии** `quickdrop-backup-YYYYMMDD-HHMMSS.json` (локальное время). Ручной экспорт называется
   `quickdrop-backup-YYYY-MM-DD.json` (`backupFileName`, не меняется) — под шаблон автокопии не подпадает,
   поэтому обрезка его никогда не удалит.
   (обновлено после ревью этапов 1–2) Обрезка трогает только копии, начатые этой установкой: их имена ведёт `OwnBackups`
   (`own-backups.json` в каталоге настроек рядом с `approved-dirs.json`). Копии другого компьютера с той же схемой
   имён в общей облачной папке не удаляются и не вытесняют свои. Шаблон имени не менялся.
6. Ошибки Rust — `Result<_, String>` с готовым русским текстом; JS превращает строку в `Error`.

## 1.2. Зависимости

`src-tauri/Cargo.toml`, секция `[dependencies]` (исполнитель добавляет сам):

```toml
tauri-plugin-dialog = "2"     # 2.8.4
percent-encoding = "2"        # 2.3.2, уже в Cargo.lock
dunce = "1"                   # 1.0.5, уже в Cargo.lock: canonicalize без префикса \\?\
```

npm: ничего. Dev-зависимостей Rust нет (временные каталоги тестов — через `std::env::temp_dir()`).

## 1.3. Rust: `src-tauri/src/backup.rs` (новый файл)

В `lib.rs` — только `mod backup;`, регистрация плагина, `manage`, список команд (см. 1.4).

### Константы

```rust
pub const ARGS_HEADER: &str = "x-qd-args";
pub const PART_SUFFIX: &str = ".qdpart";
pub const MAX_CHUNK_BYTES: usize = 16 * 1024 * 1024;       // одна часть (JS шлёт по 8 МиБ)
pub const MAX_BACKUP_BYTES: u64 = 512 * 1024 * 1024;        // JS-предел копии 480 МБ + запас
pub const MAX_EXPORT_FILE_BYTES: u64 = 128 * 1024 * 1024;   // вложение ≤ 100 МБ (MAX_FILE_SIZE) + запас
pub const MAX_KEEP: u32 = 1000;
pub const MAX_APPROVED_DIRS: usize = 16;
pub const MAX_OWN_BACKUPS: usize = 2000;                    // (обновлено после ревью этапов 1–2): предел списка своих копий, старые вытесняются
pub const MAX_REL_PATH_CHARS: usize = 400;
pub const MAX_REL_DEPTH: usize = 8;
pub const MAX_FULL_PATH_UTF16: usize = 259;                 // MAX_PATH - 1
```

### Типы (serde, `rename_all = "camelCase"`)

```rust
#[derive(Deserialize)] #[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveBackupArgs { dir: String, file_name: String, offset: u64, last: bool }
#[derive(Deserialize)] #[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WriteExportArgs { dir: String, rel_path: String, offset: u64, last: bool }

// у всех трёх — #[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct SavedFile   { path: String, size: u64, done: bool }        // size — записано всего; path — итоговый файл
pub struct BackupEntry { name: String, size: u64, modified_at: u64 }  // modifiedAt, мс с 1970
pub struct PruneResult { removed: Vec<String>, failed: Vec<String> }  // имена файлов
```

### Список подтверждённых папок

```rust
pub struct ApprovedDirs { file: PathBuf, dirs: Mutex<Vec<PathBuf>> }
impl ApprovedDirs {
    pub fn load(file: PathBuf) -> Self;                       // нет файла/битый JSON → пустой список, не ошибка
    pub fn approve(&self, dir: &Path) -> Result<(), String>;  // без дублей, не больше MAX_APPROVED_DIRS (старые вытесняются), сохраняет файл атомарно
    pub fn resolve(&self, dir: &str) -> Result<PathBuf, String>;
}
```

- Файл: `app.path().app_config_dir()?.join("approved-dirs.json")`, содержимое — JSON-массив строк путей
  в том виде, в каком их вернул диалог.
- `resolve`: `trim` → пусто: «Папка не выбрана»; не абсолютный путь: «Укажите полный путь к папке»;
  `dunce::canonicalize` не удался: «Папка не найдена: {dir}. Проверьте, что диск подключён»; не каталог:
  «Это не папка: {dir}»; ни одна запись списка после `dunce::canonicalize` не равна результату:
  «Папка не подтверждена: выберите её заново в настройках». Возвращает канонический путь.
  Записи списка, которые сейчас не канонизируются (диск отключён), пропускаются, но из файла не удаляются.
  (обновлено после ревью этапов 1–2) Список копируется под мьютексом, проверка идёт без блокировки. Сначала точное совпадение записи с
  запрошенной строкой или её каноническим видом (без канонизации записей: в настройках обычно строка из диалога),
  затем канонизация записей от новых к старым — старая запись о недоступном сетевом диске не ждёт тайм-аута на
  каждую часть и каждый файл экспорта.
- Сравнение — точное равенство канонических путей (подпапки подтверждённой папки не считаются подтверждёнными).

### Список своих копий (обновлено после ревью этапов 1–2)

```rust
pub struct OwnBackups { file: PathBuf, names: Mutex<Vec<String>> }   // own-backups.json: JSON-массив имён
impl OwnBackups {
    pub fn load(file: PathBuf) -> Self;                       // нет файла/битый JSON → пусто; посторонние строки отбрасываются
    pub fn record(&self, name: &str) -> Result<(), String>;   // до записи первой части; без дублей; не больше MAX_OWN_BACKUPS
    fn snapshot(&self) -> Vec<String>;
    fn forget(&self, gone: &[String]) -> Result<(), String>;  // убрать удалённые обрезкой имена
}
```

`save_backup` записывает имя в список на части с `offset 0` до записи; сбой записи списка — ошибка копии (иначе копия
навсегда осталась бы вне обрезки).

### Чистые функции (покрываются `#[cfg(test)]`)

```rust
fn is_backup_name(name: &str) -> bool;       // ровно ^quickdrop-backup-\d{8}-\d{6}\.json$, ASCII-цифры, регистр строго нижний; без regex
fn is_backup_part_name(name: &str) -> bool;  // is_backup_name(имя без PART_SUFFIX)
fn safe_rel_path(rel: &str) -> Result<PathBuf, String>;
fn write_chunk(target: &Path, offset: u64, bytes: &[u8], last: bool, max_total: u64) -> Result<u64, String>;
fn list_in(dir: &Path) -> Result<Vec<BackupEntry>, String>;          // только обычные файлы по шаблону, по имени по убыванию
fn prune_in(dir: &Path, keep: usize, protect: Option<&str>, is_own: impl Fn(&str) -> bool) -> Result<PruneResult, String>;   // (обновлено после ревью этапов 1–2)
fn body_bytes(body: &tauri::ipc::InvokeBody) -> Result<std::borrow::Cow<'_, [u8]>, String>;
fn header_args<T: serde::de::DeserializeOwned>(headers: &tauri::http::HeaderMap) -> Result<T, String>;
fn io_message(e: &std::io::Error, action: &str) -> String;
```

`safe_rel_path` — отклоняет (ничего не «чинит»; очистка имён — обязанность `src/lib/markdownExport.ts`):
- пустую строку и длину > `MAX_REL_PATH_CHARS`;
- `\` заменяется на `/`, затем: ведущий `/`, любой символ `:` (диски и потоки NTFS), пустой компонент,
  компоненты `.` и `..`, глубину > `MAX_REL_DEPTH`;
- в компоненте: символы `< > " | ? *`, управляющие (< 0x20), окончание на точку или пробел, длину > 255
  единиц UTF-16, окончание на `.qdpart` (без учёта регистра);
- зарезервированные имена Windows без учёта регистра по части до первой точки (с обрезкой пробелов):
  `CON PRN AUX NUL COM1…COM9 LPT1…LPT9 COM¹ COM² COM³ LPT¹ LPT² LPT³` и `CONIN$`, `CONOUT$`.

Тексты: «Недопустимый путь файла: {rel}» (структура пути), «Недопустимое имя файла: {компонент}» (символы,
зарезервированное имя, окончание).

`write_chunk`:
- временный файл — `target` с дописанным к имени `PART_SUFFIX`;
- `offset == 0` → `File::create` (обнуляет старый остаток); `offset > 0` → открыть на дозапись; файла нет
  или его длина ≠ `offset` → «Нарушен порядок записи файла: повторите попытку»;
- `offset + bytes.len() > max_total` → удалить временный файл, «Файл больше допустимого размера ({N} МБ)»;
- `write_all`; при `last` — `sync_all`, закрыть, `fs::rename(tmp, target)` (в Windows заменяет существующий);
- при любой ошибке записи или переименования временный файл удаляется (без паники, если не вышло);
- возвращает записанный на данный момент размер.

`prune_in`: `keep == 0` → «Число хранимых копий должно быть не меньше 1»; берёт список файлов по шаблону и
оставляет только те, что `is_own` (начаты этой установкой); удаляет свои копии после первых `keep` (по имени по убыванию);
дополнительно удаляет свои остатки `.qdpart` прерванной записи. Каталоги, ссылки, чужие копии и любые другие имена не
трогает. Неудачное удаление отдельного файла — в `failed`, не ошибка. (обновлено после ревью этапов 1–2) `protect` — имя только что сохранённой
копии: остаётся всегда и занимает одно из `keep` мест (при `keep = 1` и часах, переведённых назад, удаляется старая
копия, а не новая); если такой копии среди своих нет, остаются `keep` последних.

`body_bytes`: `Raw(v)` → заимствовать; `Json(Array)` из чисел 0..=255 → собрать `Vec<u8>` (запасной канал
`postMessage`); иначе «Ожидались двоичные данные». Длина > `MAX_CHUNK_BYTES` → «Слишком большая часть данных».

`header_args`: заголовок `x-qd-args` → `percent_decode_str(..).decode_utf8()` → `serde_json::from_str`;
нет заголовка или ошибка разбора → «Некорректные параметры команды».

`io_message`: `NotFound` → «{action}: папка или файл не найдены», `PermissionDenied` → «{action}: нет доступа
(папка защищена от записи или файл занят)», `StorageFull` → «{action}: на диске не осталось места»,
иначе «{action}: {e}». `action` — «Не удалось сохранить копию», «Не удалось записать файл»,
«Не удалось прочитать папку», «Не удалось удалить старые копии».

### Команды

```rust
#[tauri::command]
pub async fn pick_directory(window: tauri::WebviewWindow, approved: tauri::State<'_, ApprovedDirs>,
    purpose: Option<String>, default_path: Option<String>) -> Result<Option<String>, String>;   // (обновлено после ревью этапов 1–2): вместо title
#[tauri::command]
pub async fn save_backup(request: tauri::ipc::Request<'_>, approved: tauri::State<'_, ApprovedDirs>,
    own: tauri::State<'_, OwnBackups>) -> Result<SavedFile, String>;
#[tauri::command]
pub async fn prune_backups(dir: String, keep: u32, protect: Option<String>,
    approved: tauri::State<'_, ApprovedDirs>, own: tauri::State<'_, OwnBackups>) -> Result<PruneResult, String>;
#[tauri::command]   // (обновлено после ревью этапов 1–2)
pub async fn discard_export_part(dir: String, rel_path: String, approved: tauri::State<'_, ApprovedDirs>)
    -> Result<bool, String>;
#[tauri::command]
pub async fn list_backups(dir: String, approved: tauri::State<'_, ApprovedDirs>)
    -> Result<Vec<BackupEntry>, String>;
#[tauri::command]
pub async fn write_export_file(request: tauri::ipc::Request<'_>, approved: tauri::State<'_, ApprovedDirs>)
    -> Result<SavedFile, String>;
```

Все `async` (не занимают главный поток окна); внутри обычный `std::fs` — часть ≤ 16 МиБ пишется быстро.

- `pick_directory`: `use tauri_plugin_dialog::DialogExt;`
  `window.dialog().file().set_parent(&window).set_title(dialog_title(purpose))` — заголовок из фиксированного набора:
  `"backup"` → «Папка для резервных копий», `"export"` → «Папка для экспорта Markdown», иначе «Выберите папку»;
  `set_directory(default_path)` — только если `default_path` уже подтверждённая папка (`dialog_start` → `approved.resolve`); `blocking_pick_folder()`
  (в async-команде допустимо). Отмена → `Ok(None)`. Выбор → `FilePath::into_path()` → `approved.approve` →
  `Ok(Some(путь строкой))`. Ошибка сохранения списка: «Не удалось запомнить выбранную папку: {e}».
- `save_backup`: `header_args::<SaveBackupArgs>` → `!is_backup_name(file_name)` → «Недопустимое имя файла
  резервной копии» → `approved.resolve(dir)` → `write_chunk(dir.join(file_name), …, MAX_BACKUP_BYTES)` →
  `SavedFile { path: <dir/file_name>, size, done: last }`.
- `prune_backups`: `keep > MAX_KEEP` → «Слишком большое число копий»; `protect`, если задан и не `is_backup_name` → «Недопустимое имя файла резервной копии»; `resolve` → `prune_in` по снимку `OwnBackups`; удалённые имена убираются из списка (сбой записи списка обрезку не отменяет).
- `discard_export_part` (обновлено после ревью этапов 1–2): удаляет `<файл>.qdpart` в подтверждённой папке; путь проверяется `safe_rel_path`; каталогов не создаёт, ссылку наружу из папки отклоняет («Путь выходит за пределы папки экспорта»), каталог с именем остатка не трогает; `true` — остаток был удалён.
- `list_backups`: `resolve` → `list_in`.
- `write_export_file`: `header_args::<WriteExportArgs>` → `resolve(dir)` → `safe_rel_path` →
  `target = base.join(rel)`; длина пути в UTF-16 > `MAX_FULL_PATH_UTF16` → «Слишком длинный путь к файлу:
  сократите название или выберите папку ближе к корню диска»; `create_dir_all(parent)`;
  `dunce::canonicalize(parent)` обязан начинаться с `base`, иначе «Путь выходит за пределы папки экспорта»
  (ссылка или точка соединения внутри папки); `write_chunk(target, …, MAX_EXPORT_FILE_BYTES)`.
  Существующий файл перезаписывается (повторный экспорт обновляет).

## 1.4. `lib.rs`, права

```rust
mod backup;
// run():
builder
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
        use tauri::Manager;
        let config_dir = app.path().app_config_dir()?;
        app.manage(backup::ApprovedDirs::load(config_dir.join("approved-dirs.json")));
        app.manage(backup::OwnBackups::load(config_dir.join("own-backups.json")));   // (обновлено после ревью этапов 1–2)
        create_main_window(app)?;
        Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        fetch_link_meta,
        backup::pick_directory, backup::save_backup, backup::prune_backups,
        backup::list_backups, backup::write_export_file, backup::discard_export_part
    ])
```

`single_instance` остаётся первым плагином. `src-tauri/capabilities/default.json`: добавить одну строку
`"opener:allow-reveal-item-in-dir"` (кнопка «Показать в папке»). Прав `dialog:*` и `fs:*` не добавлять.
`tauri.conf.json`, CSP, версия приложения — без изменений.

## 1.5. Протокол передачи двоичных данных

Один вызов на часть:

```
invoke(cmd, Uint8Array(часть), { headers: { 'x-qd-args': encodeURIComponent(JSON.stringify(args)) } })
```

- `args` для `save_backup`: `{ dir, fileName, offset, last }`; для `write_export_file`: `{ dir, relPath, offset, last }`.
- `offset` — число уже отправленных байт; первая часть `offset: 0`; последняя `last: true`.
  Пустой файл — один вызов с пустым телом, `offset: 0, last: true`.
- Части идут строго последовательно (ждать ответ каждой). Размер части `IPC_CHUNK_BYTES = 8 МиБ`.
- Заголовок кодируется `encodeURIComponent`: значения заголовков обязаны быть ASCII, а пути бывают кириллические.
- Ответ каждой части — `SavedFile`; итог операции — ответ последней (`done: true`).
- Прерывание (ошибка, закрытие приложения) оставляет только `*.qdpart`; итоговый файл либо прежний, либо целый новый.
  (обновлено после ревью этапов 1–2) При отмене или сбое (Rust или чтение части), если Rust принял хотя бы одну часть, `invokeChunked` вызывает `discard` — для экспорта это `discard_export_part`; сбой уборки не заменяет исходную ошибку (`console.warn`). Остаток после аварийного закрытия приложения посреди выгрузки остаётся, пока тот же файл не будет выгружен целиком; остатки автокопий убирает обрезка.

## 1.6. TypeScript: `src/lib/ipc.ts` (новый, чистый) и добавления в `src/lib/desktop.ts`

`src/lib/ipc.ts` — без импортов Tauri, sonner, БД (тестируется в node):

```ts
export const IPC_ARGS_HEADER = 'x-qd-args'
export const IPC_CHUNK_BYTES = 8 * 1024 * 1024

export type InvokeFn = <T>(
  cmd: string,
  args?: Record<string, unknown> | Uint8Array,
  options?: { headers: Record<string, string> },
) => Promise<T>

/** JSON → значение заголовка (ASCII). */
export function encodeIpcArgs(args: Record<string, unknown>): string
/** Строка ошибки из Rust → Error с тем же текстом; иное → Error(fallback). Error возвращается как есть. */
export function ipcError(e: unknown, fallback: string): Error
/** Шлёт data частями; к args добавляет offset и last; возвращает ответ последней части. Отказ → ipcError. */
export function invokeChunked<T>(
  invokeFn: InvokeFn, cmd: string, args: Record<string, unknown>, data: Blob,
  options?: { chunkBytes?: number; fallback?: string; signal?: AbortSignal; discard?: () => Promise<unknown> },   // discard — (обновлено после ревью этапов 1–2)
): Promise<T>
```

`signal`: проверяется перед каждой частью; отмена → `Error('Отменено')`.

Добавления в `src/lib/desktop.ts` (существующие экспорты не менять):

```ts
export interface SavedFile { path: string; size: number; done: boolean }
export interface BackupEntry { name: string; size: number; modifiedAt: number }
export interface PruneResult { removed: string[]; failed: string[] }

export const DESKTOP_ONLY_MESSAGE = 'Доступно только в настольной версии'

/** Системный диалог выбора папки; папка запоминается как разрешённая для записи. Вне Tauri и при отмене — null. */
export function pickDirectory(options?: { purpose?: DirectoryPurpose; defaultPath?: string }): Promise<string | null>   // (обновлено после ревью этапов 1–2): purpose 'backup' | 'export' вместо title; defaultPath действует, только если папка уже подтверждена
/** Атомарная запись автокопии. fileName — только quickdrop-backup-YYYYMMDD-HHMMSS.json. */
export function saveBackupFile(dir: string, fileName: string, data: Blob, signal?: AbortSignal): Promise<SavedFile>
export function pruneBackups(dir: string, keep: number, protect?: string): Promise<PruneResult>   // (обновлено после ревью этапов 1–2): protect — имя только что сохранённой копии; чужие копии не трогаются
export function listBackups(dir: string): Promise<BackupEntry[]>
/** Запись файла экспорта: relPath относительный, разделитель '/'. Строка пишется как UTF-8 без BOM. */
export function writeExportFile(dir: string, relPath: string, data: Blob | string, signal?: AbortSignal): Promise<SavedFile>
/** Показать файл или папку в проводнике. false — вне Tauri или не удалось. Никогда не бросает. */
export function revealInExplorer(path: string): Promise<boolean>
```

- Все, кроме `pickDirectory` и `revealInExplorer`, вне Tauri бросают `Error(DESKTOP_ONLY_MESSAGE)`;
  ошибки Rust приходят как `Error` с русским текстом (`ipcError`).
- `invoke` берётся `await import('@tauri-apps/api/core')` (как в `linkMeta.ts`); `revealInExplorer` —
  `revealItemInDir` из `@tauri-apps/plugin-opener`.
- `initDesktop()`: сразу после строки с `listenDownloads()` добавить запуск расписания —
  `void import('./autoBackup').then((m) => m.initAutoBackup()).catch(…console.warn…)`. Динамический импорт:
  `autoBackup.ts` сам импортирует `desktop.ts`. `src/main.tsx` не меняется.

## 1.7. `src/lib/autoBackup.ts` (новый)

```ts
import type { Settings } from '@/types'
import type { PruneResult, SavedFile } from '@/lib/desktop'

export const BACKUP_PERIOD_MS = { daily: 24 * 3600_000, weekly: 7 * 24 * 3600_000 } as const
export const BACKUP_CHECK_INTERVAL_MS = 3600_000
export const BACKUP_START_DELAY_MS = 30_000
export const BACKUP_KEEP_MIN = 1
export const BACKUP_KEEP_MAX = 100

/** quickdrop-backup-YYYYMMDD-HHMMSS.json по локальному времени. */
export function autoBackupFileName(date?: Date): string
/** Целое в [BACKUP_KEEP_MIN, BACKUP_KEEP_MAX]; не число → 10. */
export function clampKeep(keep: number): number
export function isBackupDue(s: Pick<Settings, 'backupDir' | 'backupEvery' | 'backupLastAt'>, now: number): boolean

export type BackupSkipReason = 'not-desktop' | 'off' | 'no-dir' | 'not-due' | 'busy' | 'empty' | 'retry-later'   // 'empty' — уточнено при сверке; 'retry-later' — (обновлено после ревью этапов 1–2)
export type BackupRunResult =
  | { status: 'skipped'; reason: BackupSkipReason }
  | { status: 'done'; path: string; size: number; removed: number }
  | { status: 'failed'; error: string }

export interface AutoBackupStatus { running: boolean; lastError: string | null; lastPath: string | null }

export interface AutoBackupDeps {
  isDesktop(): boolean
  now(): number
  getSettings(): Promise<Settings>
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void>
  /** Число записей в базе, включая корзину (настоящая зависимость: `db.items.count()`). Уточнено при сверке. */
  countItems(): Promise<number>
  /** Папка доступна и подтверждена, иначе исключение с текстом Rust (настоящая — `listBackups`). (обновлено после ревью этапов 1–2) */
  checkDir(dir: string): Promise<void>
  exportBackup(): Promise<Blob>
  saveBackupFile(dir: string, fileName: string, data: Blob): Promise<SavedFile>
  /** protect — имя только что сохранённой копии. */
  pruneBackups(dir: string, keep: number, protect: string): Promise<PruneResult>
  /** Сообщить о сбое планового запуска. */
  notifyError(message: string): void
}

export interface AutoBackup {
  /** Плановая проверка: запускает копию, только если пришёл срок. Никогда не бросает. */
  check(): Promise<BackupRunResult>
  /** «Создать копию сейчас»: срок и backupEvery не учитываются, папка обязательна. Никогда не бросает. */
  runNow(): Promise<BackupRunResult>
  status(): AutoBackupStatus
  /** Таймеры и слушатель видимости; возвращает функцию остановки. Повторный вызов — без второго набора таймеров. */
  start(): () => void
}
export function createAutoBackup(deps: AutoBackupDeps): AutoBackup

/** Синглтон с настоящими зависимостями. */
export function initAutoBackup(): void
export function runBackupNow(): Promise<BackupRunResult>
export function checkAutoBackup(): Promise<BackupRunResult>
export function autoBackupStatus(): AutoBackupStatus
```

Поведение:
- `isBackupDue`: `false`, если `backupEvery === 'off'` или `backupDir.trim() === ''`; иначе `true`, если
  `backupLastAt <= 0`, или `backupLastAt > now` (часы перевели назад), или `now - backupLastAt >= период`.
- Порядок запуска: `checkDir(dir)` (до сборки копии; (обновлено после ревью этапов 1–2)) → `exportBackup()` → `saveBackupFile(dir, autoBackupFileName(new Date(now)), blob)` →
  `setSetting('backupLastAt', now)` → `pruneBackups(dir, clampKeep(backupKeep), fileName)`. Сбой обрезки — только
  `console.warn`, итог остаётся `done` (`removed: 0`).
- `check()`: вне Tauri → `skipped/not-desktop`, зависимости не вызываются; далее по `getSettings()`:
  `off`, `no-dir`, `not-due`.
- (уточнено при сверке; требование `.progress/spec-stage2.md` §6 п. 8) Пустая база не копируется по расписанию:
  если срок пришёл, но `countItems() === 0` → `skipped/empty`, `exportBackup` не вызывается, `backupLastAt` не
  меняется, `notifyError` не вызывается. Иначе после «Удалить все данные» пустые копии вытеснили бы рабочие при
  обрезке. `runNow()` это правило не применяет (явная команда пользователя).
- Защита от параллельных запусков — одно поле `running: Promise<BackupRunResult> | null`:
  `check()` при идущем запуске → `skipped/busy`; `runNow()` при идущем запуске возвращает тот же промис.
- Сбой (любое исключение в цепочке, включая `getSettings`): `backupLastAt` не меняется, итог
  `failed` с `describeError(e, 'Не удалось сохранить резервную копию')`, `lastError` запоминается.
  Плановый запуск вызывает `notifyError` **один раз за серию сбоев**: флаг сбрасывается после успешной копии.
  `runNow()` `notifyError` не вызывает — сообщение показывает вызвавший интерфейс. Следующая попытка — на
  очередной плановой проверке (через час), без ускоренных повторов.
  (обновлено после ревью этапов 1–2) Пауза после сбоя: `failed = { at, dir }`; плановый запуск в той же папке раньше чем через
  `BACKUP_CHECK_INTERVAL_MS − 60 000` после сбоя даёт `skipped/'retry-later'` (её соблюдают `visibilitychange`, таймер старта и
  часовой таймер). Пауза не действует, если часы переведены назад (`now < at`) или выбрана другая папка
  (`checkAutoBackup()` после смены папки делает копию сразу); успешная копия её снимает. `runNow()` паузу не учитывает,
  но его сбой её ставит. Сбой `checkDir` (отключённый диск, неподтверждённая папка) — `failed` с текстом Rust без сборки копии.
- `start()`: `setTimeout(check, BACKUP_START_DELAY_MS)`, `setInterval(check, BACKUP_CHECK_INTERVAL_MS)`,
  слушатель `visibilitychange` (при `visible` → `check()`: после сна компьютера таймер может запоздать).
  При отсутствии `document` слушатель не ставится.
- `initAutoBackup()`: вне Tauri ничего не делает; повторный вызов ничего не делает. Настоящий `notifyError`:
  `toast.error('Автоматическая копия не сохранена', { description: message, duration: 10_000,
  action: { label: 'Настройки', onClick: () => useUi.getState().setView('settings') } })`.
  Успех плановой копии — без уведомления.
- Расписание работает только в главном окне (мини-окно этапа 7 `initDesktop` не вызывает).

## 1.8. `src/lib/exportDir.ts` (новый) — запись экспорта Markdown на диск

Модуль не знает, как запись превращается в Markdown: это чистый `src/lib/markdownExport.ts` (контракт — у
архитектора данных). Здесь фиксируется только форма результата, которую он должен отдавать, и запись.

```ts
import type { Item } from '@/types'
import type { SavedFile } from '@/lib/desktop'

/** Вложение: либо готовый blob, либо fileId из таблицы files (читается через repo.getFile). */
export interface ExportAttachment { path: string; blob?: Blob; fileId?: string }
/** Один документ экспорта. Все path — относительные, разделитель '/', уникальные в пределах выгрузки. */
export interface ExportDoc { path: string; markdown: string; attachments?: readonly ExportAttachment[] }

export interface ExportDirOptions {
  signal?: AbortSignal
  onProgress?(done: number, total: number): void            // в документах
  /** Подмена для тестов. */
  write?: (dir: string, relPath: string, data: Blob | string, signal?: AbortSignal) => Promise<SavedFile>
  loadFile?: (fileId: string) => Promise<Blob | undefined>
}
export interface ExportDirReport {
  dir: string
  docs: number          // записано .md
  attachments: number   // записано вложений
  bytes: number
  failed: Array<{ path: string; error: string }>
}

export function exportDocsToDir(dir: string, docs: readonly ExportDoc[], options?: ExportDirOptions): Promise<ExportDirReport>

export type ItemToDoc = (item: Item) => ExportDoc | Promise<ExportDoc>
/** dir по умолчанию — settings.mdExportDir. */
export function exportMarkdownToDir(
  items: readonly Item[], toDoc: ItemToDoc, options?: ExportDirOptions & { dir?: string },
): Promise<ExportDirReport>
```

Поведение:
- Пустой `dir` → `Error('Не выбрана папка для экспорта Markdown')`; вне Tauri — `Error(DESKTOP_ONLY_MESSAGE)`
  (бросает настоящий `writeExportFile`; с подменой `write` проверка не делается).
- На документ: сначала вложения по порядку, затем `.md` (документ не ссылается на ещё не записанные файлы).
  Вложение без `blob`: `loadFile(fileId)` (по умолчанию `(await getFile(id))?.blob`); нет данных →
  в `failed` с текстом «Файл вложения не найден».
- Ошибка одного файла не прерывает выгрузку: путь и текст — в `failed`, идём дальше. Исключение: текст
  ошибки начинается с «Папка не » (не найдена, не подтверждена, не выбрана) — выгрузка прерывается этим
  `Error` (дальше всё равно ничего не запишется).
- `signal.aborted` проверяется перед каждым файлом → `Error('Экспорт отменён')`.
- `exportMarkdownToDir`: `toDoc` вызывается по одному на запись; исключение `toDoc` → в `failed`
  с `path: item.id`.

Точка стыковки с архитектором данных: если `markdownExport.ts` отдаёт документ с другими именами полей,
согласующая обёртка `ItemToDoc` пишется в месте вызова (интерфейс этапа 4); `exportDir.ts` не меняется.
Требования к чистому модулю со стороны записи: пути проходят правила `safe_rel_path` (п. 1.3), имя файла
≤ 80 символов, глубина ≤ 8, полный путь ≤ 259 символов.

## 1.9. Настройки (определяет архитектор данных; здесь — как используются)

| Ключ | Тип | По умолчанию (предложение) | Кто пишет |
|---|---|---|---|
| `backupDir` | `string` | `''` | интерфейс этапа 4 — только значением из `pickDirectory()` |
| `backupEvery` | `'off' \| 'daily' \| 'weekly'` | `'off'` | интерфейс |
| `backupKeep` | `number` | `10` | интерфейс (1–100) |
| `backupLastAt` | `number` | `0` | только `autoBackup.ts` |
| `mdExportDir` | `string` | `''` | интерфейс — только значением из `pickDirectory()` |

Требование к `exportImport.ts` (архитектор данных): `backupDir`, `mdExportDir`, `backupLastAt` — в
`PRIVATE_SETTINGS` (пути этого компьютера не должны попадать в копию и приходить из чужой копии).
(обновлено после ревью этапов 1–2) Туда же `backupEvery` и `backupKeep`. `clearAllData` `backupLastAt` не сбрасывает (иначе первая запись после
стирания вызвала бы автокопию почти пустой базы и обрезку рабочих копий). Отзыв подтверждённых папок при смене
настройки не реализован: настройки живут в IndexedDB, Rust о смене не знает; нужна команда отзыва, которую вызовет экран
настроек (этап 4).
Интерфейс этапа 4 использует: `pickDirectory`, `listBackups`, `revealInExplorer`, `runBackupNow`,
`checkAutoBackup` (после смены папки или периодичности), `autoBackupStatus`, `exportMarkdownToDir`.

## 1.10. Тесты

JS (vitest, node):

`src/lib/ipc.test.ts`
- `invokeChunked`: blob 0 байт → один вызов, пустое тело, `offset 0, last true`; меньше части; ровно N частей;
  N частей с остатком (`chunkBytes: 4`); заголовок декодируется обратно в `args` (кириллический путь);
  возвращён ответ последней части; отказ строкой → `Error` с этим текстом; отказ не строкой → `fallback`;
  после отказа следующие части не шлются; `signal` → «Отменено».

`src/lib/autoBackup.test.ts` (подставные `AutoBackupDeps`, `vi.useFakeTimers()`)
- `autoBackupFileName`: формат, дополнение нулями, локальное время;
- `clampKeep`: 0, −5, 3.7, 1000, `NaN`;
- `isBackupDue`: `off`; пустая папка; `lastAt 0`; ровно период; период − 1 мс; `lastAt` в будущем; `weekly`;
- `check`: не Tauri → зависимости не тронуты; пришёл срок → порядок вызовов и аргументы
  (`saveBackupFile` с именем по `now`, `setSetting('backupLastAt', now)`, `pruneBackups(dir, clampKeep)`);
- сбой `exportBackup`/`saveBackupFile` → `failed`, `backupLastAt` не записан, `notifyError` один раз на два
  сбоя подряд, после успеха снова срабатывает;
- сбой `pruneBackups` → `done`;
- два `check()` одновременно → `exportBackup` вызван один раз, второй `busy`;
- (уточнено при сверке) пришёл срок, `countItems()` → 0: `skipped/empty`, `exportBackup` и `setSetting` не вызваны;
  `runNow()` при пустой базе копию делает;
- `runNow()` при `backupEvery: 'off'` выполняется; без папки → `skipped/no-dir`; во время запуска возвращает
  тот же результат; `notifyError` не вызывает;
- `start()`: проверка через `BACKUP_START_DELAY_MS` и каждый `BACKUP_CHECK_INTERVAL_MS`; функция остановки
  снимает таймеры.

`src/lib/exportDir.test.ts` (подставные `write`, `loadFile`)
- порядок: вложения, затем `.md`; счётчики и `bytes`; вложение по `fileId`; отсутствующий файл → `failed`;
  сбой одного файла не прерывает; «Папка не найдена…» прерывает; отмена; пустая папка; исключение `toDoc`.

Rust (`#[cfg(test)] mod tests` в `backup.rs`; временный каталог —
`std::env::temp_dir().join(format!("quickdrop-test-{name}-{pid}-{счётчик}"))`, удаляется в конце теста):
- `is_backup_name`: верное имя; имя ручного экспорта `quickdrop-backup-2026-11-11.json`; другой регистр;
  лишний суффикс `.bak`; путь с `../`; не-ASCII цифры; пробел; 7 и 9 цифр даты;
- `safe_rel_path`: `a/b.md` и `заметки/файл 1.md` проходят; `\` нормализуется; отклоняются `../x`, `a/../b`,
  `/x`, `C:/x`, `a:b`, `a//b`, `con.md`, `LPT1`, `nul.txt/x.md`, `x.`, `x `, `a<b`, `a\u{1}b`, `x.qdpart`,
  9 уровней, 401 символ;
- `write_chunk`: одна часть; три части; неверный `offset`; часть без начала; превышение предела (временный
  файл удалён); перезапись существующего; после завершения `.qdpart` нет;
- `prune_in`: остаются `keep` последних по имени; не тронуты посторонний файл, ручной экспорт, каталог с
  именем по шаблону; `keep 0` → ошибка; остатки `.qdpart` удалены; (обновлено после ревью этапов 1–2): защищённая (`protect`) копия с меньшей отметкой остаётся при `keep = 1` и `keep = 3`; чужие копии и остатки не трогаются и не вытесняют свои; `OwnBackups` (запись, повтор, перезагрузка, `forget`, битый файл, предел, сбой записи); `discard_export_part_in`; `dialog_title`, `dialog_start`; `is_approved` (точное совпадение без канонизации, порядок от новых к старым);
- `list_in`: порядок по убыванию, размеры;
- `ApprovedDirs`: `approve` → `resolve` проходит; неподтверждённая папка → ошибка; несуществующая → ошибка;
  относительный путь → ошибка; перезагрузка из файла; вытеснение сверх `MAX_APPROVED_DIRS`; битый файл → пусто;
- `body_bytes`: `Raw`; `Json` массив чисел; `Json` объект → ошибка; число 256 → ошибка;
- `header_args`: кириллица в `dir`; нет заголовка; лишнее поле (`deny_unknown_fields`).

## 1.11. Владение, порядок, готовность (исполнитель `tauri-backup`)

Правит только:
- `src-tauri/**` (`Cargo.toml`, `Cargo.lock`, `src/lib.rs`, новый `src/backup.rs`, `capabilities/default.json`);
- `src/lib/desktop.ts` — только добавления из п. 1.6;
- новые `src/lib/ipc.ts`, `src/lib/ipc.test.ts`, `src/lib/autoBackup.ts`, `src/lib/autoBackup.test.ts`,
  `src/lib/exportDir.ts`, `src/lib/exportDir.test.ts`.

Не трогает: `src/components/**`, `src/views/**`, `src/types.ts`, `src/db/**`, `src/lib/exportImport.ts`,
`src/main.tsx`, `package.json`, `vite.config.ts`, `tauri.conf.json` (кроме случая ошибки сборки — тогда
сообщить основной сессии), `.github/**`.

Предусловие (делает основная сессия или исполнитель данных до старта): в `Settings`/`DEFAULT_SETTINGS`
есть пять ключей из п. 1.9. Если их ещё нет — исполнитель останавливается со статусом «ошибка» и не
добавляет их сам.
(уточнено при сверке) Предусловие закрывает шаг 0 этапа 2 — исполнитель `data-contracts`
(`.progress/spec-stage2.md` §1.1; значения по умолчанию там совпадают с п. 1.9). `tauri-backup` стартует после
приёмки шага 0 и идёт параллельно волне 1 этапа 2 и исполнителям этапа 1: общих файлов с ними нет
(`src/lib/desktop.ts` на этапах 1–3 правит только он).

Готово, когда:
1. `npm run typecheck` и `npm test` проходят; `cargo test --manifest-path src-tauri/Cargo.toml` проходит;
   `cargo check` без предупреждений.
2. В `capabilities/default.json` добавлена только `opener:allow-reveal-item-in-dir`.
3. Экспорты и сигнатуры совпадают с п. 1.3, 1.6–1.8 буквально.
4. `.progress/agents/tauri-backup.md` заполнен.

Ручная проверка основной сессией (`npm run tauri dev`, консоль разработчика):
`pickDirectory()` → папка; `setSetting('backupDir', …)`, `setSetting('backupEvery','daily')`,
`runBackupNow()` → файл `quickdrop-backup-…json` в папке, импортируется обратно; 12 запусков при
`backupKeep 10` → в папке 10 автокопий; `saveBackupFile('C:\\Windows', …)` → «Папка не подтверждена…»;
папка с кириллицей и пробелами; отключённый диск → один toast.

Предложение основной сессии (вне владения исполнителя): в `.github/workflows/release.yml`, задача `desktop`,
перед сборкой добавить шаг `cargo test --manifest-path src-tauri/Cargo.toml`.

---

# Часть 2. Быстрый захват (этап 7) и приёмка Windows (этап 8)

> (уточнено перед этапом 7) Часть 2 сверена с кодом после этапов 1–6 (2026-11-13, `spec-stage7`). Исправленные места
> помечены «(уточнено перед этапом 7)». Точные контракты, порядок работ и пакеты — в п. 2.14; **при расхождении
> пп. 2.1–2.12 с п. 2.14 действует п. 2.14.** Решения основной сессии (пользователь не отвечал, взяты безопасные
> умолчания): крестик главного окна по умолчанию закрывает приложение (`closeToTray: false`), приём от расширения
> и автозапуск по умолчанию выключены, канал расширения — только локальный HTTP, `quickdrop://` не делается.

## 2.1. Сводка решений

| Вопрос | Решение | Почему |
|---|---|---|
| Мини-окно | Второе `WebviewWindow` с меткой `capture`, отдельная точка входа `capture.html` + `src/capture-main.tsx`. (уточнено перед этапом 7) Включается настройкой `captureWindow` (по умолчанию включено); выключено — сочетание, как сейчас, поднимает главное окно | Не тянет оболочку, списки, граф, фон; не запускает побочные действия главного окна (сочетания, автобэкап, засев) |
| Когда создаётся | (уточнено перед этапом 7) Скрытым, командой `set_shell_options` из `initDesktop()` главного окна (после чтения настроек, то есть после открытия БД) и только при `captureWindow: true`; отдельной команды `prepare_capture_window` нет | Показ мгновенный; обновление схемы Dexie всегда делает главное окно; при выключенной настройке второй процесс WebView2 не создаётся |
| Общие данные | Тот же origin и тот же каталог данных WebView2 → та же IndexedDB и `localStorage`; запись делает само мини-окно через `createAndEnrich` | Dexie 4 рассылает изменения между окнами одного origin — список в главном окне обновляется сам |
| Глобальное сочетание | Регистрация остаётся в JS главного окна; обработчик: главное окно в фокусе или `captureWindow` выключен → прежний диалог, иначе `toggle_capture_window` | Минимум изменений; сохраняется готовая обработка занятого сочетания |
| Закрытие мини-окна | `Esc`, сохранение, потеря фокуса (в JS, с задержкой 150 мс и паузой на время системного диалога выбора файла) | Потерю фокуса в Rust нельзя отличить от открытия диалога файла |
| Трей | Меню «Открыть QuickDrop», «Быстрая запись», «Выход»; левый клик — открыть главное окно. Значок есть всегда | — |
| Крестик главного окна | (уточнено перед этапом 7) Настройка «Сворачивать в трей при закрытии» (`closeToTray`), **по умолчанию выключена**: крестик закрывает приложение, как сейчас. Разового вопроса при первом закрытии нет | Решение основной сессии: безопасное умолчание — поведение не меняется без ведома пользователя |
| Автозапуск | (уточнено после ревью этапа 7) Крейт `auto-launch = "0.6"` напрямую (режим Windows `CurrentUser`, только HKCU), без `tauri-plugin-autostart`; аргумент `--autostart` → главное окно стартует скрытым; состояние читается из системы, в `Settings` не хранится. (уточнено перед этапом 7) По умолчанию выключен; управляется командами Rust `get_autostart` / `set_autostart`, npm-пакет не нужен | Реестр можно изменить мимо приложения |
| Один экземпляр | Уже подключён; доработка: показать скрытое в трей окно; запуск с `--autostart` окно не поднимает | — |
| Канал расширения | Локальный HTTP на `127.0.0.1` с токеном; `quickdrop://` не делаем. (уточнено перед этапом 7) По умолчанию выключен; пока выключен, порт не слушается | См. 2.6 |

## 2.2. Мини-окно

`src-tauri/tauri.conf.json`, второй элемент `app.windows`:

```json
{
  "label": "capture", "create": false, "url": "capture.html", "title": "QuickDrop — быстрая запись",
  "width": 640, "height": 440, "resizable": false, "maximizable": false, "minimizable": false,
  "decorations": false, "shadow": false, "alwaysOnTop": true, "skipTaskbar": true,
  "visible": false, "focus": false, "center": true, "dragDropEnabled": false
}
```

(уточнено после ревью этапа 7) `"focus": false`: окно создаётся заранее, пока пользователь работает в главном,
а WebView2 с `focus: true` при создании забирает ввод даже у скрытого окна. Фокус ставит `show_capture`.

(уточнено перед этапом 7) Размер 640×440 вместо 560×340: нынешняя форма `QuickCapture` (ряд типов, заголовок,
категория и теги, строка о дубле ссылки, вопрос о файлах) в 340 px не помещается; форма внутри окна прокручивается.

`shadow: false` — прямоугольное окно без системной рамки Windows 11; рамку рисует CSS (деревянная в
пиксельных сценах, 1 px `--border` в «Классике»). `transparent` не включать (известные артефакты WebView2).
`data_directory` и `incognito` не задавать — иначе у окна будет своя IndexedDB.

Rust, новый `src-tauri/src/shell.rs` — (уточнено перед этапом 7) состав команд изменён, точные сигнатуры в п. 2.14.3:
`set_shell_options` (флаги `close_to_tray` и `capture_window`; создаёт или уничтожает мини-окно),
`toggle_capture_window`, `show_main_window`, `open_in_main`, `quit_app`, `get_autostart`, `set_autostart`.
Команд `prepare_capture_window`, `set_close_to_tray(enabled, hint_shown)` и `hide_main_window` нет.

`toggle_capture_window`: окна нет → создать; видимо и в фокусе → `hide()`, `Ok(false)`; иначе поставить на
монитор под курсором (`app.cursor_position()`, `app.monitor_from_point(x, y)`, запасной — `primary_monitor()`):
по горизонтали по центру, верх на 22 % высоты монитора; `show()`, `set_focus()`,
`emit_to("capture", "capture-shown", ())`. `CloseRequested` окна `capture` (Alt+F4) → `prevent_close()` + `hide()`.

(уточнено после ревью этапа 7) «В фокусе» — по флагу `ShellState::capture_focused`, который ведут события
`WindowEvent::Focused` мини-окна (сброс при скрытии, `CloseRequested`, `Destroyed` и `destroy()`), а не по
`win.is_focused()`: в Windows фокус уходит в дочернее окно WebView2, и геттер (состояние tao) даёт `false`, пока
курсор стоит в поле, — повторное нажатие не прятало бы окно. События же Tauri синтезирует из GotFocus/LostFocus
самого WebView2 (на них работает и `onFocusChanged` в JS). Проверить вживую при приёмке: фокус в поле, второе
нажатие прячет окно, третье показывает его с сохранённым текстом.

(уточнено после ревью этапа 7) Скрытие по потере фокуса не срабатывает, пока зажата основная кнопка мыши
(команда `capture_pointer_down`: Windows — `GetAsyncKeyState` с учётом `SM_SWAPBUTTON`, крейт `windows-sys`;
другие ОС — `false`): нажатие на файл в Проводнике отнимает у окна фокус раньше, чем файл донесён до окна.
Пока файл над окном (`dragenter`…`drop`/уход курсора), скрытие на паузе (`suspend`/`resume`).

Права — новый `src-tauri/capabilities/capture.json`: `"windows": ["capture"]`, `permissions`:
`core:default`, `core:window:allow-hide`, `core:window:allow-start-dragging`. Без `global-shortcut` и `opener`.

Веб-слой:

| Файл | Содержимое |
|---|---|
| `capture.html` (корень) | как `index.html`, без PWA-метатегов; `<script src="/theme-init.js">`, `<script type="module" src="/src/capture-main.tsx">` |
| `src/capture-main.tsx` | `createRoot` → `<CaptureWindowApp />`; не импортирует `./pwa`, не вызывает `initDesktop`, `applyInitialHash` |
| `src/components/capture/CaptureForm.tsx` | (уточнено перед этапом 7) форма, вынесенная из `QuickCapture.tsx` (сейчас это внутренняя функция `CaptureForm({ snapshotRef })`, жёстко связанная с `useUi`: `closeCapture`, `captureDraft`, `openItemInSection`, toast «Открыть»). Новые пропсы — п. 2.14.5; `QuickCapture()` остаётся с прежним контрактом и использует её |
| `src/components/capture/CaptureWindowApp.tsx` | `ErrorBoundary` → `ThemeProvider` → `CaptureForm variant="window"` + `Toaster`; шапка с `data-tauri-drag-region` |
| `src/lib/captureWindow.ts` (+ тест) | см. ниже |
| `vite.config.ts` | `build.rolldownOptions.input = isTauriBuild ? { main: 'index.html', capture: 'capture.html' } : undefined` (Vite 8.3: `rolldownOptions` есть, `rollupOptions` — устаревший синоним; проверено по `node_modules/vite`). В веб-сборку и в precache PWA `capture.html` не попадает; в dev Vite отдаёт `/capture.html` сам |

```ts
// src/lib/captureWindow.ts
export const CAPTURE_WINDOW_LABEL = 'capture'
export const CAPTURE_BLUR_DELAY_MS = 150
export function hideCaptureWindow(): Promise<void>               // getCurrentWindow().hide()
/** Чистая логика скрытия по потере фокуса (тестируется с fake timers).
 *  (уточнено после ревью этапа 7) isPointerDown: пока true — скрытие откладывается ещё на delayMs. */
export function createBlurHider(hide: () => void, delayMs?: number, isPointerDown?: () => Promise<boolean>): {
  onFocusChange(focused: boolean): void   // false → hide через delayMs, если фокус не вернулся и нет паузы
  suspend(): void                         // перед открытием системного диалога файла
  resume(): void                          // после change/cancel поля файла
  dispose(): void
}
/** Подписки окна: 'capture-shown', onFocusChanged → blurHider. Возвращает отписку. */
export function initCaptureWindow(handlers: { onShown(): void; blur: ReturnType<typeof createBlurHider> }): Promise<() => void>
```

(уточнено перед этапом 7) `isCaptureWindow()` живёт в `src/lib/platform.ts` (нужна и `db/db.ts`, см. п. 2.14.2).
Жизненный цикл формы повторяет диалог: показ окна (`capture-shown`) монтирует форму, скрытие размонтирует.
Поэтому действуют готовые правила `QuickCapture`: набранный текст при `Esc` и потере фокуса уходит в черновик
`sessionStorage` (у мини-окна он свой) и восстанавливается при следующем показе с пометкой «Черновик
восстановлен»; при прикреплённых файлах или идущем сохранении окно не скрывается (показывается готовый вопрос
«Прикреплённые файлы не сохранятся. Закрыть?»); подписка на все записи (поиск дубля ссылки) в скрытом окне не висит.

Сценарий: сохранение → `createAndEnrich` (статус `inbox`) → черновик очищается → окно скрывается; ошибка →
окно остаётся, `toast.error(describeError(e))`. Загрузка заголовка ссылки доделывается в скрытом окне и приходит
в главное через БД (`isLinkMetaLoading` в главном окне для такой записи `false` — это уже предусмотренное
поведение «pending из другой вкладки»). Тема, сцена и шрифт — те же `theme-init.js` и `ThemeProvider`
(общие `localStorage` и таблица `meta`).

Изменение обработчика сочетания в `desktop.ts` (`registerShortcut`) — (уточнено перед этапом 7) с учётом настройки:

```ts
const mini = (await getSettings()).captureWindow && !document.hasFocus()
if (mini) await invoke('toggle_capture_window')        // отказ команды → прежнее поведение
else raiseWindow().finally(() => useUi.getState().openCapture())
```

(уточнено перед этапом 7) Поле «Глобальное сочетание» переезжает из `ShortcutsSection` в новую секцию «Быстрый
захват» (п. 2.14.6); в `ShortcutsSection` остаётся строка-указатель.

## 2.3. Трей и закрытие главного окна

`Cargo.toml`: `tauri = { version = "2", features = ["tray-icon"] }`. В `setup` (`shell::create_tray(app)`):

```rust
TrayIconBuilder::with_id("main")
    .icon(app.default_window_icon().unwrap().clone())
    .tooltip("QuickDrop")
    .menu(&Menu::with_items(app, &[
        &MenuItem::with_id(app, "open", "Открыть QuickDrop", true, None::<&str>)?,
        &MenuItem::with_id(app, "capture", "Быстрая запись", true, None::<&str>)?,
        &PredefinedMenuItem::separator(app)?,
        &MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?,
    ])?)
    .show_menu_on_left_click(false)
    .on_menu_event(/* open → show_main; capture → показать мини-окно; quit → app.exit(0) */)
    .on_tray_icon_event(/* Click { button: Left, button_state: Up } и DoubleClick → show_main */)
    .build(app)?;
```

(уточнено перед этапом 7) `CloseRequested` окна `main` (в `on_window_event`):
- `close_to_tray == false` (умолчание) → закрытию не мешать;
- `close_to_tray == true` → `api.prevent_close()` + `hide()`.
Разового вопроса «Свернуть в трей / Выйти», события `tray-hint` и ключа `localStorage['qd-tray-hint']` нет:
настройку включает сам пользователь, пояснение — в подсказке переключателя.

(уточнено перед этапом 7) **Выход при закрытии главного окна.** Tauri завершает процесс, только когда закрыты
все окна, а скрытое мини-окно — тоже окно: без доработки крестик закрыл бы главное окно и оставил бы процесс
висеть в трее. Поэтому на `WindowEvent::Destroyed` окна `main` вызывается `app.exit(0)`.

Значения флагов Rust получает от JS: `initDesktop()` вызывает `set_shell_options({ closeToTray, captureWindow })`;
до этого вызова оба флага `false` (если веб-слой не загрузился, крестик закрывает приложение, мини-окна нет).
При смене настроек секция «Быстрый захват» вызывает `applyShellOptions(...)`.

(уточнено перед этапом 7) Пункт трея «Быстрая запись»: при `capture_window == true` показывает мини-окно прямо
из Rust; иначе поднимает главное окно и шлёт ему событие `open-capture`. Создавать и показывать окна из
обработчика меню или значка напрямую нельзя — в Windows `WebviewWindowBuilder::build` в синхронном обработчике
виснет (примечание в исходниках tauri 2.12.5); работу выносить в `tauri::async_runtime::spawn`.

## 2.4. Автозапуск

(уточнено после ревью этапа 7) Rust (в секции зависимостей для настольных платформ): `auto-launch = "0.6"`
напрямую, **без `tauri-plugin-autostart`**: плагин не даёт выбрать режим Windows, а его режим (Dynamic) из
процесса, запущенного от имени администратора, пишет в HKLM — общую для компьютера запись, которую обычный
процесс потом не снимет. `shell::Autostart(auto_launch::AutoLaunch)` собирается в `shell::init`: имя =
`package_info().name` (как было у плагина — прежние записи HKCU подхватываются), аргумент `--autostart`;
Windows — `WindowsEnableMode::CurrentUser` и путь к exe **в кавычках** (`quoted_exe_path`); macOS — LaunchAgent,
канонический путь exe; Linux — AppImage или exe. `set_autostart(false)`: после `disable()` перепроверка
`is_enabled()`; запись осталась (HKLM от прежних версий) → `Err` с подсказкой, а не тихий `Ok`.

(уточнено перед этапом 7) Управление — своими командами Rust, а не JS-API. Следствия: npm-пакет
`@tauri-apps/plugin-autostart` и права `autostart:*` в capabilities **не нужны**, `package.json` на этапе 7 не
меняется.

- `setup`: `std::env::args().any(|a| a == "--autostart")` → главное окно создаётся с `.visible(false)`.
- Команды: `get_autostart() -> { enabled, available, reason? }`, `set_autostart(enabled) -> Result<(), String>`.
  В отладочной сборке (`cfg!(debug_assertions)`) `available: false`, `set_autostart` возвращает ошибку: иначе в
  реестр попадёт `target/debug`. Проверка в Rust, а не по `import.meta.env.DEV`.
- `desktop.ts`: `getAutostart(): Promise<AutostartState>`, `setAutostart(on: boolean): Promise<{ ok: boolean; error?: string }>`.
- `setup` (Rust, не JS): если автозапуск включён и сборка не отладочная → повторный `enable()` (обновляет путь
  к exe после переустановки).
- Windows: значение в `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. Отключение через «Диспетчер
  задач → Автозагрузка» может быть не видно (`is_enabled()` остаётся `true`) — упомянуть в инструкции.

## 2.5. Один экземпляр

Плагин остаётся первым в цепочке. Обработчик: аргументы содержат `--autostart` → ничего; иначе
`unminimize()`, `show()`, `set_focus()` окна `main` (в т.ч. скрытого в трей).
(уточнено перед этапом 7) Сейчас обработчик написан прямо в `lib.rs` (`tauri_plugin_single_instance::init(|app, _args, _cwd| …)`,
плагин 2.5.5); на этапе 7 он сводится к вызову `shell::on_second_instance(app, &args)`.

## 2.6. Канал для расширения Chrome

| | `quickdrop://` (deep-link) | HTTP на `127.0.0.1` + токен |
|---|---|---|
| Объём | ~2 тыс. символов адреса; кириллица в percent-кодировании — в 6–9 раз длиннее, то есть 200–300 букв выделенного текста | Любой (свой предел 1 МиБ) |
| Ответ расширению | Нет: нельзя показать «Сохранено» или ошибку | Есть: код и JSON |
| Вмешательство браузера | Запрос «Открыть QuickDrop?», переход вкладки на внешний адрес | Нет |
| Запуск | Каждый раз новый процесс, пересылка аргументов первому экземпляру | Запрос к работающему приложению |
| Приложение не запущено | Запустится | Ошибка «QuickDrop не запущен» |
| Установка | Запись схемы в реестр установщиком; в dev — регистрация при запуске | Ничего |
| Защита | Ссылку может подсунуть любая страница (после подтверждения — запись во «Входящие»); токен в адресе виден в командной строке процесса | Токен в заголовке + проверка `Origin` и `Host` |
| Минусы | — | Порт может быть занят (настраивается); приложение должно работать (трей + автозапуск); (уточнено после ревью этапа 7) подмена при свободном порту: пока QuickDrop не слушает, порт может занять чужой процесс и получить токен (п. 2.14.4, «Принятый риск») |

**Рекомендация: HTTP на `127.0.0.1` с токеном.** Главный сценарий — выделенный текст — в адрес не помещается,
а без ответа расширение не может честно сообщить результат. Трей и автозапуск того же этапа закрывают
единственный минус. `tauri-plugin-deep-link` не подключаем.

### Протокол (версия 1)

(уточнено после ревью этапа 7) Сервер: свой минимальный HTTP на `std::net::TcpListener` (без зависимостей;
`tiny_http` убран — не ограничивал время чтения), поток приёма и поток на соединение, привязка строго
`("127.0.0.1", port)`; порт по умолчанию `47821`. Пределы — п. 2.14.4.

```
POST http://127.0.0.1:{port}/v1/capture
Authorization: Bearer {token}
Content-Type: application/json

{ "v": 1, "kind": "page" | "link" | "selection",
  "url": "https://…",        // page: адрес страницы; link: адрес ссылки; selection: адрес страницы-источника
  "title": "…",              // page и selection: заголовок страницы; link: не передаётся
  "text": "…" }              // только selection: выделенный текст

GET http://127.0.0.1:{port}/v1/ping      (тот же Authorization) → { "ok": true, "app": "quickdrop", "version": "0.1.0" }
```

(уточнено перед этапом 7) У `link` заголовка нет: Chrome в `contextMenus` текст ссылки не отдаёт (`linkText` есть
только в Firefox); заголовок страницы QuickDrop подтянет сам, если включено `autoFetchLinkTitle`.

Проверки в Rust, по порядку (ответ всегда JSON `{ "ok": false, "error": "…" }`) —
(уточнено перед этапом 7) таблица приведена к п. 2.14.4:

| Проверка | Код |
|---|---|
| `Host` ровно `127.0.0.1:{port}` (защита от DNS rebinding; `localhost` не принимается — расширение ходит только на `127.0.0.1`) | 403 |
| `Origin`: если есть — ровно `chrome-extension://` + 32 буквы `a`–`p`; для `POST` и `OPTIONS` обязателен; у `GET /v1/ping` может отсутствовать (Chrome не всегда ставит его на GET) | 403 |
| `OPTIONS` (preflight) с верным `Origin` → 204 + `Access-Control-Allow-Origin: {origin}`, `-Allow-Methods: POST, GET`, `-Allow-Headers: authorization, content-type`, `-Allow-Private-Network: true`, `-Max-Age: 600` | 204 |
| Путь и метод не из списка | 404 / 405 |
| `Authorization: Bearer` совпадает с токеном (сравнение за постоянное время) | 401 |
| (уточнено после ревью этапа 7) Частота: не больше 30 запросов **с верным токеном** за 10 с (запрос без верного токена получает 401 раньше и в счёт не идёт — иначе чужая страница забивала бы окно частоты расширению) | 429 |
| `Content-Type` начинается с `application/json` | 415 |
| `Content-Length` обязателен и ≤ 1 048 576 | 411 / 413 |
| Тело — JSON-объект с `"v": 1` | 400 |

Успешные ответы несут `Access-Control-Allow-Origin: {origin}`. Сервер стартует только с токеном из 43 символов
base64url (32 случайных байта).

(уточнено перед этапом 7) Дальше — не «событие с данными и ожидание 5 с», а очередь с подтверждением (п. 2.14.4):
Rust кладёт сообщение в слот ожидания, шлёт в `main` событие-будильник `ext-capture`, главное окно само забирает
сообщение командой `ext_take_pending` (в т.ч. при запуске — если подписка появилась позже события) и
подтверждает итог командой `ext_capture_done`. Команды: `ext_server_apply(enabled, port, token)`,
`ext_server_status()`, `ext_take_pending()`, `ext_capture_done(request_id, ok, duplicate, error)`;
`start_ext_server` / `stop_ext_server` не делаются.

Ответы: `200 { "ok": true, "duplicate": false }` (идентификатор записи наружу не отдаётся — канал только
принимает); ошибка разбора или сохранения → `422` с текстом; главное окно не забрало сообщение за 5 с →
`504`, запись не создана; забрало, но не подтвердило за 10 с → `504` «QuickDrop не подтвердил сохранение».

JS, новый чистый `src/lib/extensionCapture.ts` (+ тест):

```ts
export interface ExtensionMessage { v: 1; kind: 'page' | 'link' | 'selection'; url?: string; title?: string; text?: string }
/** Проверка полей и пределов: url ≤ 2048 и только http/https, title ≤ 300, text ≤ 500 000 символов. Бросает Error с русским текстом. */
export function parseExtensionMessage(raw: unknown): ExtensionMessage
export function extensionMessageToInput(msg: ExtensionMessage): NewItemInput
```

Соответствие: `page` и `link` → `{ type: 'link', url, title, status: 'inbox', source: 'extension' }`;
`selection` → запись по `detectInput(text)` со `status: 'inbox', source: 'extension'` (подробно — п. 2.14.4).
(уточнено перед этапом 7) Обработчик живёт не в `desktop.ts`, а в новом `src/lib/extInbox.ts`: `parseExtensionMessage`
→ для ссылок `repo.findDuplicateLink(url)` (есть с этапа 2; нашёлся → `ext_capture_done({ ok: true, duplicate: true })`,
запись не создаётся) → `createAndEnrich` → `ext_capture_done`. Главное окно при этом не поднимается.

Добавление в общие типы (делает основная сессия перед этапом 7): `ItemSource` += `'extension'`
(`types.ts`, белый список `ITEM_SOURCES` в `exportImport.ts`).
(уточнено при сверке) Уже выполняется на этапе 2: `ITEM_SOURCES` с `'extension'` объявлен в `types.ts` шагом 0
(`.progress/spec-stage2.md` §1.1), `exportImport.ts` берёт список оттуда (`data-backup`). Перед этапом 7 не повторять.

## 2.7. Расширение (Manifest V3), каталог `extension/`

```
extension/
  manifest.json
  background.js     service worker: контекстное меню, команда, отправка
  popup.html  popup.js  popup.css
  options.html  options.js
  icons/icon-16.png  icon-32.png  icon-48.png  icon-128.png
  README.md         установка: chrome://extensions → «Режим разработчика» → «Загрузить распакованное»
```

(уточнено перед этапом 7) Итоговый состав каталога — в п. 2.14.7: общий модуль `shared.js`, один файл стилей
`ui.css` вместо `popup.css`, service worker — ES-модуль (`"type": "module"` в манифесте), значки делает
`scripts/gen-extension-icons.mjs`.

```json
{
  "manifest_version": 3,
  "name": "QuickDrop",
  "version": "0.1.0",
  "description": "Сохраняет страницу, ссылку или выделенный текст во «Входящие» QuickDrop.",
  "minimum_chrome_version": "116",
  "permissions": ["contextMenus", "activeTab", "storage"],
  "host_permissions": ["http://127.0.0.1/*"],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html", "default_title": "Сохранить в QuickDrop" },
  "options_ui": { "page": "options.html", "open_in_tab": false },
  "commands": { "save-page": { "suggested_key": { "default": "Alt+Shift+Q" }, "description": "Сохранить страницу в QuickDrop" } },
  "icons": { "16": "icons/icon-16.png", "32": "icons/icon-32.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png" }
}
```

- Хранение: `chrome.storage.local` `{ port: 47821, token: '' }` (не `sync`: токен не должен уходить в аккаунт).
- Контекстное меню (создаётся в `runtime.onInstalled`): `qd-page` (`contexts: ['page']`, «Сохранить страницу
  в QuickDrop»), `qd-link` (`['link']`, «Сохранить ссылку в QuickDrop»), `qd-selection` (`['selection']`,
  «Сохранить выделенное в QuickDrop»).
- (уточнено перед этапом 7) Права — минимальные по решению основной сессии: `activeTab`, `contextMenus`, `storage`
  и `host_permissions` только `http://127.0.0.1/*`; права `scripting` нет. Выделенный текст берётся из
  `info.selectionText` контекстного меню. Цена: Chrome отдаёт его одной строкой (переносы строк заменяются
  пробелами). Вернуть переносы можно только правом `scripting` — вопрос вынесен в открытые (п. 2.14.10).
- Всплывающее окно: заголовок и адрес активной вкладки, кнопка «Сохранить страницу», ссылка «Настройки»;
  строка состояния («Сохранено», «Уже сохранено», текст ошибки, «QuickDrop не запущен или приём выключен»,
  «Укажите токен в настройках расширения»); после успеха закрывается через 800 мс. Кнопки «Сохранить
  выделенное» во всплывающем окне нет (без `scripting` выделение из него не прочитать) — выделение сохраняется
  из контекстного меню.
- Из service worker результат показывается значком: `action.setBadgeText` «OK» или «!» на 2 с, текст ошибки —
  в `action.setTitle`.
- Отправка: `fetch` с `AbortSignal.timeout(20000)` (сервер отвечает не позже чем через 15 с); сетевой отказ →
  «QuickDrop не запущен или приём выключен».
- Значки `extension/icons/icon-{16,32,48,128}.png` — свои, из `public/icon.svg`, скриптом
  `scripts/gen-extension-icons.mjs` (sharp уже есть в devDependencies).
- Настройки расширения: порт, токен, кнопка «Проверить соединение» (`/v1/ping`).
- Без сборки: обычные JS-файлы, без зависимостей.

## 2.8. Требования безопасности

- Сервер слушает только `127.0.0.1`; выключен по умолчанию (`extEnabled: false`).
- Токен: 32 случайных байта (`crypto.getRandomValues`) в base64url, создаётся приложением при первом
  включении, хранится в `Settings.extToken`, входит в `PRIVATE_SETTINGS`, в журнал и события не пишется.
  Кнопка «Создать новый» перезапускает сервер. (уточнено перед этапом 7) В интерфейсе кнопка называется
  «Сменить» и спрашивает подтверждение; рядом — «Показать» и «Скопировать» (п. 2.14.6).
- Никаких исходящих запросов ни из сервера, ни из расширения (кроме `http://127.0.0.1:{port}`);
  в расширении нет удалённого кода, постоянных content scripts и права `tabs`.
- Rust проверяет транспорт (адрес, origin, токен, размер), JS — содержимое (`parseExtensionMessage`);
  адрес проходит обычную проверку `createItem` (только http/https/ftp).
- (уточнено после ревью этапа 7) Соединения обслуживаются параллельно (поток на соединение), не больше
  `MAX_CONN = 8` одновременно; следующие ждут в очереди ядра, а не сбрасываются. Плюс явный предел 30 запросов
  с верным токеном за 10 с (ответ 429). Главное окно разбирает список ожидающих сообщений.
- (уточнено перед этапом 7) Канал только принимает: чтения записей, поиска и списков через него нет; ответ
  содержит лишь `ok`, `duplicate` и текст ошибки. Токен и порт живут в `Settings` (IndexedDB) и в памяти процесса
  Rust; на диск вне IndexedDB, в журнал, в события и в резервную копию не попадают (`PRIVATE_SETTINGS` уже
  содержит `extEnabled`, `extPort`, `extToken`; «Удалить все данные» стирает `extEnabled` и `extToken`).
- Команды записи на диск (часть 1) работают только с подтверждёнными папками — мини-окно и возможная
  ошибка в разметке Markdown не расширяют доступ к файловой системе.

## 2.9. Настройки этапа 7 (добавления в `Settings`)

| Ключ | Тип | По умолчанию | Копия |
|---|---|---|---|
| `closeToTray` | `boolean` | `false` (уточнено перед этапом 7; в коде сейчас `true` — меняет пакет `contracts`) | можно экспортировать |
| `captureWindow` | `boolean` | `true` (уточнено перед этапом 7: новый ключ) | можно экспортировать |
| `extEnabled` | `boolean` | `false` | `PRIVATE_SETTINGS` |
| `extPort` | `number` | `47821` | `PRIVATE_SETTINGS` |
| `extToken` | `string` | `''` | `PRIVATE_SETTINGS` |

(уточнено перед этапом 7) `closeToTray`, `extEnabled`, `extPort`, `extToken` уже есть в `src/types.ts`,
`settingsSchema.ts` (`extPort` 1024–65535), `PRIVATE_SETTINGS` и `CLEARED_SETTINGS` (`db/seed.ts`) с этапа 2.

Автозапуск в `Settings` не хранится (п. 2.4). Добавления в `desktop.ts` на этапе 7 —
(уточнено перед этапом 7) полный список с сигнатурами в п. 2.14.2: `applyShellOptions`, `toggleCaptureWindow`,
`showMainWindow`, `quitApp`, `getAutostart`, `setAutostart`, `generateExtensionToken`, `isExtensionToken`,
`applyExtensionServer`, `getExtServerStatus`.

`initDesktop()` дополнительно: `applyShellOptions(settings)`, `applyExtensionServer(settings)` при включённом
приёме, подписки окна `open-capture` и `open-item`. Подписку `ext-capture` ставит `startExtInbox()`
(`src/lib/extInbox.ts`), её вызывает `main.tsx`. Путь автозапуска обновляет Rust.

## 2.10. Зависимости этапа 7

| Где | Что | Версия |
|---|---|---|
| Cargo | `tauri` — добавить feature `tray-icon` | 2.12.5 |
| Cargo (настольные платформы) | (уточнено после ревью этапа 7) `auto-launch = "0.6"` напрямую (вместо `tauri-plugin-autostart`, п. 2.4) | 0.6.0 |
| Cargo (Windows) | (уточнено после ревью этапа 7) `windows-sys = "0.61"`, features `Win32_UI_Input_KeyboardAndMouse`, `Win32_UI_WindowsAndMessaging` — команда `capture_pointer_down` (п. 2.2); версия уже была в `Cargo.lock` | 0.61.2 |
| Cargo | (уточнено после ревью этапа 7) HTTP-сервер — свой на `std::net`, без зависимостей (`tiny_http` убран) | — |
| npm | (уточнено перед этапом 7) ничего: автозапуск идёт через команды Rust, `package.json` и `package-lock.json` не меняются | — |
| Не нужны | `tauri-plugin-deep-link`, `@tauri-apps/plugin-deep-link`, `@tauri-apps/plugin-dialog`, `@tauri-apps/plugin-autostart`, `tauri-plugin-autostart`, `tauri-plugin-fs` (приходит транзитивно с dialog, не регистрируется) | — |

(уточнено перед этапом 7) Проверено локально (`~/.cargo/registry`, `Cargo.lock`): `tauri` 2.12.5 с feature
`tray-icon` (крейт `tray-icon` 0.25.1, `muda` 0.20.0 уже скачаны), `tauri-plugin-single-instance` 2.5.5 подключён.
(уточнено после ревью этапа 7) Плагин автозапуска и HTTP-крейт в итоге не используются; `auto-launch` 0.6.0 и
`windows-sys` 0.61.2 есть в `Cargo.lock`.

## 2.11. Владение файлами на этапе 7 (без пересечений)

(уточнено перед этапом 7) Таблица ниже — первоначальный набросок; **действует разбивка п. 2.14.9** (один файл —
один пакет, волны 0–2). Отличия: `lib.rs` — у пакета сведения, `Cargo.toml` / `tauri.conf.json` / capabilities —
только у `deps`, `desktop.ts` — у `contracts`, приём записей — отдельный `src/lib/extInbox.ts`, секция настроек
называется `QuickCaptureSection.tsx`, диалога `tray-hint` нет.

| Исполнитель | Файлы |
|---|---|
| основная сессия (до запуска) | `package.json` (npm-пакет автозапуска — не понадобился, см. п. 2.4). (уточнено при сверке) Правки `src/types.ts` (настройки п. 2.9, `ItemSource`) и `src/lib/exportImport.ts` (`PRIVATE_SETTINGS`, `ITEM_SOURCES`) уже сделаны на этапе 2 (`.progress/spec-stage2.md` §1.1, §2.5) — только убедиться, что они на месте |
| `tauri-shell` | `src-tauri/**` (новые `src/shell.rs`, `src/ext_server.rs`, `capabilities/capture.json`; `lib.rs`, `Cargo.toml`, `tauri.conf.json`, `capabilities/default.json`), `src/lib/desktop.ts`, `src/lib/extensionCapture.ts` (+ тест) |
| `capture-window` | `capture.html`, `src/capture-main.tsx`, `src/components/capture/**`, `src/lib/captureWindow.ts` (+ тест), `vite.config.ts` |
| `chrome-extension` | `extension/**` |
| `settings-desktop` (после первых трёх) | новый `src/views/settings/DesktopSection.tsx` (трей, автозапуск, расширение: переключатель, порт, токен, «Скопировать», «Создать новый», состояние сервера), подключение в `SettingsView.tsx`, правка подсказки в `ShortcutsSection.tsx`, диалог `tray-hint` |

Общий контракт `tauri-shell` ↔ `capture-window`: метка `capture`, событие `capture-shown`, команды п. 2.2.

Критерии готовности этапа 7: сочетание из чужого приложения показывает мини-окно за < 200 мс, `Enter`/
`Ctrl+Enter` сохраняет запись во «Входящие», она появляется в открытом главном окне без перезагрузки;
`Esc` и щелчок мимо скрывают окно; вложение файла не закрывает окно; крестик главного окна сворачивает в
трей, «Выход» завершает процесс; второй запуск exe поднимает окно; после перезагрузки Windows приложение
стартует скрытым; расширение сохраняет страницу, ссылку и выделение из 20 тыс. символов кириллицы с
переносами; неверный токен → 401 и понятный текст; запрос со страницы сайта (`fetch` из консоли) → 403.

(уточнено перед этапом 7) Поправки к критериям: крестик сворачивает в трей **при включённой настройке**, при
выключенной (умолчание) — завершает процесс целиком (в диспетчере задач `quickdrop.exe` нет); автозапуск и приём
от расширения проверяются после включения в настройках; при выключенном приёме порт не слушается
(`Test-NetConnection 127.0.0.1 -Port 47821` — отказ); выделение из расширения приходит без переносов строк
(нет права `scripting`); запись от расширения сохраняется и при главном окне, свёрнутом в трей.

## 2.12. Риски

Сборка NSIS/MSI:
- Автозапуск хранит путь к exe. NSIS ставит в `%LOCALAPPDATA%\QuickDrop`, MSI — в `Program Files`: при
  установке обоих пакетов запись в реестре указывает на последний запущенный. Рекомендация: распространять
  NSIS; MSI оставить в сборке, в инструкции не упоминать.
- Удаление приложения не убирает значение из ключа `Run` (мёртвая запись, Windows её пропускает). При
  желании — хук NSIS `NSIS_HOOK_POSTUNINSTALL` (`bundle.windows.nsis.installerHooks`) с `DeleteRegValue`.
- Обновление при работающем в трее приложении: NSIS просит закрыть процесс; MSI может потребовать
  перезагрузку. В инструкции: перед обновлением — «Выход» в трее.
- Неподписанный exe с автозапуском и слушающим портом чаще вызывает SmartScreen и срабатывания антивирусов.
  Привязка к `127.0.0.1` запроса брандмауэра Windows не вызывает.
- Удаление с флажком «удалить данные приложения» стирает IndexedDB и `approved-dirs.json`; автокопии в
  папке пользователя остаются — об этом сказать в инструкции.
- Второе окно — ещё один процесс отрисовки WebView2 (≈ 40–80 МБ памяти).
- Chrome ужесточает доступ страниц к локальной сети (Private/Local Network Access). Для расширений с
  `host_permissions` ограничение не применяется, сервер на всякий случай отвечает
  `Access-Control-Allow-Private-Network: true`; перепроверить на актуальном Chrome при реализации.
- Порядок фокуса: `set_focus()` из обработчика глобального сочетания Windows разрешает; при показе из трея
  окно может открыться без фокуса ввода — проверить, при необходимости повторить `set_focus()` после `show()`.

(уточнено перед этапом 7) Добавлено при сверке:
- **Процесс не завершается, пока существует скрытое мини-окно** — см. п. 2.3 (`Destroyed` окна `main` → `app.exit(0)`).
  Проверить вживую при выключенном `closeToTray`.
- **События Tauri и глобальный `listen`.** Слушатель JS, поставленный глобальным `listen()` из
  `@tauri-apps/api/event` (цель `Any`), получает и события, адресованные другому окну (`emit_to("main", …)`):
  так устроен `match_any_or_filter` в tauri 2.12.5. Новые подписки этапа 7 ставить через
  `getCurrentWebviewWindow().listen(...)`, а события слать `emit_to(<метка>, …)`.
- **Скрытое главное окно.** Приём от расширения и обработчик сочетания работают в JS главного окна; при окне,
  скрытом в трей, WebView2 продолжает исполнять JS, но таймеры замедляет. Приём построен на событиях, а не
  на таймерах; проверить вживую после 10+ минут в трее.
- **`settleStaleLinkMeta` во втором окне.** `db.on('ready')` срабатывает в каждом окне, открывшем БД: мини-окно
  перевело бы `pending` заголовка, который в эту минуту грузит главное окно, в итог (на экране мигнёт «не
  удалось»). Поэтому в мини-окне починка не запускается (п. 2.14.2).
- **Изменения между окнами** доходят через `BroadcastChannel` Dexie; оба окна живут в одном процессе браузера
  WebView2 (общий каталог данных), но вживую это не проверялось.
- **Автозапуск и диспетчер задач.** Что `is_enabled()` показывает после отключения записи в «Диспетчер задач →
  Автозагрузка», зависит от версии крейта `auto-launch` — проверить на этапе 8.
- (уточнено после ревью этапа 7) **Пределы приёма** (сервер свой, на `std::net`; `tiny_http` убран — у него не
  было сроков чтения): не больше `MAX_CONN = 8` соединений в обработке; следующие **ждут в очереди ядра** (поток
  приёма не вызывает `accept`, пока нет места), а не сбрасываются. Строка запроса и заголовки — не больше 8 КБ
  (иначе 431) и не дольше `HEAD_TIMEOUT = 1 с` на всё целиком; не-HTTP байты (TLS ClientHello, двоичный мусор,
  первый байт не заглавная буква) — соединение закрывается сразу, без ответа. Тело и запись ответа — отдельно
  по `IO_TIMEOUT = 5 с`; тело читается только после шагов 1–9, огромный `Content-Length` получает 413 без
  чтения; после ответа остаток запроса выбрасывается не больше 2 МБ / 1 с. Страница в браузере **может** держать
  соединения (обращение к `https://127.0.0.1:{порт}` шлёт ClientHello, `<link rel=preconnect>` молчит), но
  ClientHello закрывается сразу, а молчащее соединение держит место не дольше 1 с — честный запрос расширения
  ждёт в очереди не дольше ~1–2 с (у расширения запас 20 с). Локальная программа, непрерывно открывающая
  соединения, может замедлить приём; ресурсы при этом не копятся. Принято.
- **Расширение в установщик не входит**: каталог `extension/` лежит в исходниках. Вложить его в сборку
  (`bundle.resources`) можно на этапе 8 — открытый вопрос п. 2.14.10.

CSP:
- `app.security.csp` общий для всех окон; мини-окну и серверу расширения изменений не нужно (сервер живёт в
  Rust, веб-слой к нему не обращается).
- `connect-src` должен сохранять `ipc: http://ipc.localhost`: без него `invoke` уходит в `postMessage`, и
  части копии передаются JSON-массивами (работает, но в разы медленнее и тяжелее по памяти).
- Шрифты этапа 1 — только локальные файлы (`font-src 'self' data:`); в мокапе они грузятся с
  `fonts.googleapis.com` — в приложение это не переносить.
- pdf.js (этап 2): воркер должен быть файлом сборки того же origin; `blob:`-воркер текущая политика
  (`default-src 'self'`) запретит. Если понадобится — добавить `worker-src 'self' blob:` в `tauri.conf.json`
  и в `WEB_CSP`.
- `script-src 'self'`: в `capture.html` тот же внешний `theme-init.js`, inline-скриптов нет.

## 2.13. Приёмка Windows (этап 8)

1. `npm run tauri build` → NSIS и MSI; размеры записать и сравнить с базой (exe 5,24 МБ, NSIS 2,35 МБ,
   MSI 3,00 МБ); прирост объяснить (шрифты, pdf.js, фон).
2. Установка NSIS поверх 0.1.0: данные на месте, схема обновилась, значок в трее один.
3. Консоль WebView2 (сборка `--debug`): нет нарушений CSP во всех пяти сценах, днём и ночью, в главном и
   мини-окне; нет запросов наружу, кроме метаданных ссылок и включённого ИИ.
4. Шрифты: Nunito, Geist, Handjet, Tiny5 грузятся из `http://tauri.localhost/assets/…`; кириллица в каждом.
5. Canvas: фон и граф при масштабе Windows 100/125/150 % без размытия (`image-rendering: pixelated`,
   учёт `devicePixelRatio`); 1–2 тыс. нод — плавный сдвиг и масштаб; окно свёрнуто или скрыто в трей —
   отрисовка остановлена (загрузка процессора ≈ 0); работа при отключённом аппаратном ускорении (RDP).
6. Автобэкап: по расписанию и «сейчас», обрезка, кириллическая папка, сетевая папка, папка только для
   чтения, отключённый диск (один toast), копия ≈ 400 МБ (память процесса не растёт на размер копии),
   импорт созданной копии.
7. Экспорт Markdown: записи с вложениями, длинные и «опасные» названия, повторный экспорт перезаписывает.
8. Мини-окно, трей, автозапуск, один экземпляр, расширение — по критериям п. 2.11.
9. Удаление: процесс завершается, данные остаются (без флажка) либо удаляются (с флажком).
10. `scripts/check-version.mjs`: версия поднята в трёх файлах; `extension/manifest.json` версионируется отдельно.

## 2.14. Исполнение этапа 7

Автор: архитектор `spec-stage7`, 2026-11-13. Раздел написан по нынешнему коду (после этапов 1–6) и действует
поверх пп. 2.1–2.12. Сигнатуры из `CLAUDE.md` не меняются — только добавления.

### 2.14.1. Что проверено и что нет

| Что | Итог |
|---|---|
| `tauri` 2.12.5, feature `tray-icon` | В реестре cargo есть. `tauri::tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState}`: `with_id`, `icon`, `tooltip`, `menu`, `show_menu_on_left_click`, `on_menu_event(Fn(&AppHandle, MenuEvent))`, `on_tray_icon_event(Fn(&TrayIcon, TrayIconEvent))`, `build(app)`; `TrayIconEvent::Click { button, button_state, .. }` и `DoubleClick` (только Windows) |
| Окна | `WebviewWindowBuilder::from_config(app, &WindowConfig)`, `.visible(bool)`, `.build()`; в конфиге окна есть `create`, `visible`, `focus`, `decorations`, `shadow`, `alwaysOnTop`, `skipTaskbar`, `resizable`, `maximizable`, `minimizable`, `dragDropEnabled`. `AppHandle::{cursor_position, monitor_from_point, primary_monitor, default_window_icon, exit}`; `Monitor::{position, size, work_area, scale_factor}`; у окна `is_visible`, `is_focused`, `show`, `hide`, `set_focus`, `set_position`, `outer_size`, `unminimize`, `destroy` |
| Создание окна в Windows | `build()` виснет в синхронной команде и в обработчиках событий → команды, создающие окно, только `async fn`; из обработчиков трея — через `tauri::async_runtime::spawn` |
| События | `Emitter::emit_to("<метка>", событие, данные)` → цель `AnyLabel`; слушатель JS, поставленный `getCurrentWebviewWindow().listen`, получает только события своего окна; глобальный `listen()` (цель `Any`) получает **все** события, включая адресованные другому окну |
| Права | `core:default`, `core:window:allow-hide`, `core:window:allow-start-dragging` существуют. Команды приложения (`invoke_handler`) доступны всем окнам: манифест команд в `build.rs` не задан |
| `tauri-plugin-single-instance` 2.5.5 | `init(FnMut(&AppHandle, Vec<String>, String))`, подключён |
| Автозапуск, HTTP-сервер | На момент сверки плагина автозапуска и HTTP-крейта локально не было. (уточнено после ревью этапа 7) Итог: автозапуск — `auto-launch` 0.6 напрямую (п. 2.4), сервер — свой на `std::net` (п. 2.14.4); плагин и HTTP-крейт не используются |
| Vite 8.3.7 | `build.rolldownOptions.input` есть |
| Не проверено вживую | Всё поведение окон, трея, фокуса, автозапуска, `BroadcastChannel` между окнами, заголовок `Origin` у запросов расширения — проверяется основной сессией в окне Tauri и в Chrome после сведения |

### 2.14.2. Основа веб-слоя (пакет `contracts`)

**Настройки** (`src/types.ts`):

| Ключ | Тип | Умолчание | В копии |
|---|---|---|---|
| `closeToTray` | `boolean` | `false` (сейчас в коде `true` — исправить) | переносится |
| `captureWindow` | `boolean` | `true` (новый ключ: глобальное сочетание открывает мини-окно) | переносится |
| `extEnabled` | `boolean` | `false` | нет (`PRIVATE_SETTINGS`) |
| `extPort` | `number` | `47821`, допустимо 1024–65535 | нет |
| `extToken` | `string` | `''` | нет |

`exportImport.ts`, `settingsSchema.ts`, `db/seed.ts` править не нужно: `ext*` уже приватные и стираются
«Удалить все данные», булевы ключи проверяются по типу. Тест `exportImport.test.ts` перечисляет переносимые
ключи (`PORTABLE`) — добавить `captureWindow`. Автозапуск в `Settings` не хранится.

**`src/lib/platform.ts`** — добавить:

```ts
/** Страница мини-окна быстрой записи (capture.html). */
export const isCaptureWindow = (): boolean =>
  typeof location !== 'undefined' && /\/capture\.html$/.test(location.pathname)
```

**`src/db/db.ts`**: `this.on('ready', …settleStaleLinkMeta)` ставить, только если `!isCaptureWindow()` — мини-окно
не должно завершать `pending` заголовка, который сейчас грузит главное окно. Больше ничего в схеме не меняется.

**`src/index.css`**: добавить `@source not "../extension";` — классы из файлов расширения не должны попадать в CSS
приложения.

**`src/lib/shellUi.ts`** (новый, чистый, с тестом) — строки и проверки для настроек и обмена:

```ts
export interface ExtServerStatus { running: boolean; port: number | null; error?: string }
export interface AutostartState { enabled: boolean; available: boolean; reason?: string }
export const EXT_PORT_MIN = 1024
export const EXT_PORT_MAX = 65535
export function isExtensionToken(v: unknown): v is string        // /^[A-Za-z0-9_-]{43}$/
export function tokenFromBytes(bytes: Uint8Array): string        // base64url без '=', 32 байта → 43 символа
export function validateExtPort(v: string): string | null        // null либо «Число от 1024 до 65535»
export function maskToken(token: string): string                 // точки + последние 4 символа; пусто → «не создан»
export function extStatusText(enabled: boolean, status?: ExtServerStatus): { text: string; error: boolean }
//   выключено → «Выключено»; running → «Принимает записи на 127.0.0.1:{port}»; иначе текст ошибки
export const QUICK_CAPTURE_DESKTOP_HINT =
  'Мини-окно, значок в трее, автозапуск и приём записей от расширения браузера работают в приложении для Windows.'
export const EXTENSION_INSTALL_STEPS: readonly string[]          // 5 шагов, текст — п. 2.14.6
```

**`src/lib/desktop.ts`** — добавления (обёртки готовы сразу; пока команд Rust нет, они возвращают отказ, а не
бросают, и поведение остаётся прежним):

```ts
export type { ExtServerStatus, AutostartState } from '@/lib/shellUi'
/** 32 байта crypto.getRandomValues → base64url. */
export function generateExtensionToken(): string
/** set_shell_options: флаги трея и мини-окна. Не бросает; false — вне Tauri или отказ команды. */
export function applyShellOptions(s: Pick<Settings, 'closeToTray' | 'captureWindow'>): Promise<boolean>
/** toggle_capture_window; true — мини-окно показано. Бросает Error при отказе. */
export function toggleCaptureWindow(): Promise<boolean>
/** show_main_window. Не бросает. */
export function showMainWindow(): Promise<void>
/** open_in_main: показать главное окно и открыть в нём запись (вызывает мини-окно). Не бросает. */
export function openInMain(id: string): Promise<void>
/** quit_app. */
export function quitApp(): Promise<void>
/** Вне Tauri и при ошибке — { enabled: false, available: false, reason }. Не бросает. */
export function getAutostart(): Promise<AutostartState>
export function setAutostart(on: boolean): Promise<{ ok: boolean; error?: string }>
/** ext_server_apply. Вне Tauri, без годного токена при enabled, при отказе — { running: false, port: null, error }. Не бросает. */
export function applyExtensionServer(
  s: Pick<Settings, 'extEnabled' | 'extPort' | 'extToken'>,
): Promise<ExtServerStatus>
export function getExtServerStatus(): Promise<ExtServerStatus>
```

Имена аргументов `invoke` — camelCase (`{ closeToTray, captureWindow }`, `{ enabled, port, token }`, `{ id }`,
`{ enabled }`): Tauri сам переводит их в snake_case параметров Rust.

Обработчик глобального сочетания (`registerShortcut`):

```ts
if (e.state !== 'Pressed') return
let mini = false
try { mini = (await getSettings()).captureWindow && !document.hasFocus() } catch { /* как раньше */ }
if (mini) { try { await toggleCaptureWindow(); return } catch (err) { console.warn(…) } }
raiseWindow().catch(…).finally(() => useUi.getState().openCapture())      // прежнее поведение
```

`initDesktop()` — дополнения (существующее не ломать: скачивания, сверка папок, автокопии, сочетание и toast
о занятом сочетании остаются):

1. подписки окна через `getCurrentWebviewWindow().listen` (не глобальный `listen`):
   `open-capture` → `useUi.getState().openCapture()`; `open-item` (`{ id: string }`) → `repo.getItem(id)` →
   `openItemInSection(item)` (импорт `./actions` динамический — `actions.ts` сам импортирует `desktop.ts`);
2. настройки читаются один раз; `void applyShellOptions(settings)`;
3. `settings.extEnabled` → `applyExtensionServer(settings)`; не запустился → `toast.error('Приём от расширения
   не запущен', { description: status.error, action: «Настройки» })`;
4. регистрация сочетания — как сейчас.

`initDesktop()` вызывается только главным окном. Тесты `desktop.test.ts`: новые обёртки (аргументы `invoke`,
поведение вне Tauri, отказ команды, негодный токен не уходит в Rust).

### 2.14.3. Rust: оболочка — `src-tauri/src/shell.rs` (пакет `rust-shell`)

Модуль самодостаточен: не ссылается на `crate::…` (до сведения он собирается отдельной проверочной целью,
п. 2.14.9).

```rust
pub const MAIN_LABEL: &str = "main";
pub const CAPTURE_LABEL: &str = "capture";
pub const AUTOSTART_ARG: &str = "--autostart";
pub const EVENT_CAPTURE_SHOWN: &str = "capture-shown";   // → окно capture, без данных
pub const EVENT_OPEN_CAPTURE: &str = "open-capture";     // → окно main, без данных
pub const EVENT_OPEN_ITEM: &str = "open-item";           // → окно main, { "id": "…" }

#[derive(Default)]
pub struct ShellState { close_to_tray: AtomicBool, capture_window: AtomicBool }   // оба false до вызова JS

/// Вызывается из setup: manage(ShellState), значок в трее, обновление пути автозапуска.
pub fn init(app: &tauri::App) -> tauri::Result<()>;
/// Запуск с --autostart: главное окно создаётся скрытым.
pub fn started_hidden() -> bool;
pub fn has_autostart_arg<I: IntoIterator<Item = S>, S: AsRef<str>>(args: I) -> bool;      // чистая, с тестом
/// Второй запуск exe: с --autostart — ничего, иначе показать главное окно.
pub fn on_second_instance(app: &tauri::AppHandle, args: &[String]);
/// Общий обработчик событий окон (подключается в lib.rs через Builder::on_window_event).
pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent);
/// Левый верхний угол мини-окна в физических пикселях: по центру рабочей области монитора, верх на 22 % её
/// высоты; окно целиком в пределах рабочей области. Чистая, с тестом (в т.ч. монитор с отрицательными координатами).
pub fn capture_position(area_pos: (i32, i32), area_size: (u32, u32), win_size: (u32, u32)) -> (i32, i32);

#[derive(serde::Serialize)] #[serde(rename_all = "camelCase")]
pub struct AutostartState { enabled: bool, available: bool, reason: Option<String> }

#[tauri::command] pub async fn set_shell_options(app: tauri::AppHandle, close_to_tray: bool, capture_window: bool) -> Result<(), String>;
#[tauri::command] pub async fn toggle_capture_window(app: tauri::AppHandle) -> Result<bool, String>;   // true — показано
#[tauri::command] pub async fn show_main_window(app: tauri::AppHandle) -> Result<(), String>;
#[tauri::command] pub async fn open_in_main(app: tauri::AppHandle, id: String) -> Result<(), String>;
#[tauri::command] pub fn quit_app(app: tauri::AppHandle);                                               // app.exit(0)
#[tauri::command] pub fn get_autostart(app: tauri::AppHandle) -> AutostartState;
#[tauri::command] pub fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String>;
```

Поведение:

- **`set_shell_options`**: записывает оба флага. `capture_window == true` и окна `capture` нет → создаёт его
  скрытым (`from_config` по записи `capture` из `tauri.conf.json`, `.visible(false)`); `false` и окно есть →
  `destroy()` (освобождает процесс WebView2). Идемпотентна.
- **`toggle_capture_window`**: окна нет → создать; видимо и в фокусе (уточнено после ревью этапа 7: флаг
  `capture_focused` по событиям `Focused`, не `is_focused()`, п. 2.2) → `hide()`, `Ok(false)`; иначе —
  монитор под курсором (`cursor_position` → `monitor_from_point`, запасной `primary_monitor`), `set_position`
  по `capture_position` (рабочая область `work_area`), `show()`, `set_focus()`, `emit_to("capture",
  "capture-shown", ())`, `Ok(true)`. Работает и при `capture_window == false` (вызов из JS уже учёл настройку).
- **`show_main_window`** / внутренняя `show_main`: `unminimize()`, `show()`, `set_focus()` окна `main`.
- **`open_in_main`**: `id` — непустая строка до 128 символов без управляющих символов (id записей из чужой
  копии бывают не UUID), иначе `Err`; `show_main`, затем
  `emit_to("main", "open-item", { id })`.
- **`on_window_event`**: окно `main` — `CloseRequested` при `close_to_tray` → `api.prevent_close()` + `hide()`;
  `Destroyed` → `app_handle().exit(0)` (иначе процесс держит скрытое мини-окно). Окно `capture` —
  `CloseRequested` (Alt+F4) → `prevent_close()` + `hide()`.
- **Трей** (`TrayIconBuilder::with_id("main")`, значок `default_window_icon()`, подсказка «QuickDrop», меню не
  по левому клику): «Открыть QuickDrop» → `show_main`; «Быстрая запись» → при `capture_window` показать
  мини-окно (та же логика, что `toggle_capture_window`, но без скрытия видимого), иначе `show_main` +
  `emit_to("main", "open-capture", ())`; разделитель; «Выход» → `exit(0)`. Левый клик (`Click` с
  `MouseButton::Left` и `MouseButtonState::Up`) и `DoubleClick` → `show_main`. Работа с окнами из обработчиков —
  через `tauri::async_runtime::spawn`.
- **Автозапуск** (уточнено после ревью этапа 7: `auto-launch` 0.6 напрямую, `shell::Autostart`, п. 2.4):
  `get_autostart` — `enabled` из `is_enabled()` (ошибка → `false` и `reason`); в отладочной сборке
  `available: false`, `reason: "В отладочной сборке автозапуск не настраивается"`. `set_autostart` — `enable()` /
  `disable()` (после `disable()` перепроверка: запись осталась в HKLM → `Err` с подсказкой); в отладочной сборке
  `Err` с тем же текстом; прочие ошибки — `Err("Не удалось изменить автозапуск: …")`. В `init`: сборка не
  отладочная и автозапуск включён → повторный `enable()`.
- (уточнено после ревью этапа 7) **Фокус мини-окна** — флаг `ShellState::capture_focused` по событиям
  `WindowEvent::Focused` (п. 2.2); `toggle_capture_window` прячет окно при `should_hide_capture(visible, focused)`.
  Команда `capture_pointer_down() -> bool` (п. 2.2) зарегистрирована в `invoke_handler`.
- macOS не ломать: всё, что есть только в Windows (`DoubleClick`, `skip_taskbar`), — без ошибок сборки на
  других платформах; код оболочки рассчитан на `cfg(desktop)`, как нынешние плагины.

Тексты ошибок — по-русски (`Result<_, String>`), как в `backup.rs`.

### 2.14.4. Канал расширения

**Путь записи:**

```
расширение ──POST /v1/capture──▶ поток HTTP в Rust (ext_server.rs)
   проверки транспорта (Host, Origin, токен, частота, тип, размер, JSON с "v": 1)
   └─ сообщение кладётся в слот ожидания {requestId, message, taken: false}
   └─ emit_to("main", "ext-capture", requestId)            — только «будильник», данных в событии нет
главное окно (src/lib/extInbox.ts)
   ext_take_pending() → [{ requestId, message }]            — слот помечается taken
   parseExtensionMessage → (ссылка) repo.findDuplicateLink → createAndEnrich({ …, source: 'extension' })
   ext_capture_done({ requestId, ok, duplicate, error })
поток HTTP ──200 / 422 / 504──▶ расширение
```

Почему «забрать», а не данные в событии: событие, пришедшее до того, как главное окно поставило подписку
(запуск, перезагрузка страницы), теряется. `startExtInbox()` сначала ставит подписку, затем один раз забирает
накопленное — порядок запуска не важен. Событие без данных не раскрывает содержимое другим слушателям.

**Сроки.** Сообщение не забрано за 5 с → слот очищается, ответ `504` «QuickDrop не отвечает, запись не
сохранена» (запись гарантированно не создана). Забрано, но не подтверждено ещё за 10 с → `504` «QuickDrop не
подтвердил сохранение. Проверьте «Входящие»». Опоздавший `ext_capture_done` с неизвестным `requestId`
игнорируется. Расширение ждёт ответа 20 с.

**Когда канал недоступен.** Приём выключен, приложение не запущено или главное окно ещё не дошло до
`initDesktop()` — порт не слушается, расширение получает сетевой отказ и показывает «QuickDrop не запущен или
приём выключен». Сервер запускает только JS главного окна (`applyExtensionServer`): токен и порт лежат в
IndexedDB, Rust их не хранит. Окно в трее — приём работает (страница главного окна жива).

**`src-tauri/src/ext_server.rs`** (пакет `rust-ext`; модуль самодостаточен, без `crate::…`):

```rust
pub const EVENT_EXT_CAPTURE: &str = "ext-capture";
pub const MAX_BODY: usize = 1_048_576;
pub const TAKE_TIMEOUT: Duration = Duration::from_secs(5);
pub const DONE_TIMEOUT: Duration = Duration::from_secs(10);
pub const RATE_MAX: usize = 30;
pub const RATE_WINDOW: Duration = Duration::from_secs(10);
// (уточнено после ревью этапа 7) пределы своего сервера:
pub const MAX_CONN: usize = 8;                                   // соединений в обработке; остальные ждут в очереди ядра
pub const MAX_HEAD: usize = 8 * 1024;                            // строка запроса + заголовки, иначе 431
pub const HEAD_TIMEOUT: Duration = Duration::from_secs(1);       // на заголовки целиком
pub const IO_TIMEOUT: Duration = Duration::from_secs(5);         // на тело и отдельно на запись ответа

#[derive(Clone, Serialize)] #[serde(rename_all = "camelCase")]
pub struct ExtStatus { pub running: bool, pub port: Option<u16> }
#[derive(Clone, Serialize)] #[serde(rename_all = "camelCase")]
pub struct ExtPending { pub request_id: u64, pub message: serde_json::Value }
pub struct ExtOutcome { pub ok: bool, pub duplicate: bool, pub error: Option<String> }

#[derive(Default)]
pub struct ExtServer { /* состояние сервера, слот ожидания, счётчик запросов */ }
impl ExtServer {
    /// enabled == false → остановить. Тот же порт и токен при работающем сервере → ничего не делать.
    /// notify вызывается из потока HTTP, когда в слоте появилось сообщение.
    pub fn apply(&self, enabled: bool, port: u16, token: &str, version: &str,
                 notify: impl Fn(u64) + Send + Sync + 'static) -> Result<ExtStatus, String>;
    pub fn status(&self) -> ExtStatus;
    pub fn take_pending(&self) -> Vec<ExtPending>;
    pub fn complete(&self, request_id: u64, outcome: ExtOutcome);
    pub fn stop(&self);
}

// чистые, с тестами
pub fn is_valid_token(s: &str) -> bool;                      // ровно 43 символа [A-Za-z0-9_-]
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool;                    // сравнение за постоянное время
pub fn is_extension_origin(s: &str) -> bool;                 // "chrome-extension://" + 32 символа a–p
pub fn host_matches(host: Option<&str>, port: u16) -> bool;  // ровно "127.0.0.1:{port}"

#[tauri::command] pub fn ext_server_apply(window: tauri::WebviewWindow, state: tauri::State<'_, ExtServer>,
    enabled: bool, port: u16, token: String) -> Result<ExtStatus, String>;
#[tauri::command] pub fn ext_server_status(state: tauri::State<'_, ExtServer>) -> ExtStatus;
#[tauri::command] pub fn ext_take_pending(window: tauri::WebviewWindow, state: tauri::State<'_, ExtServer>) -> Result<Vec<ExtPending>, String>;
#[tauri::command] pub fn ext_capture_done(window: tauri::WebviewWindow, state: tauri::State<'_, ExtServer>,
    request_id: u64, ok: bool, duplicate: bool, error: Option<String>) -> Result<(), String>;
```

- `ext_server_apply`, `ext_take_pending`, `ext_capture_done` принимаются только от окна с меткой `main`
  (иначе `Err("Недоступно из этого окна")`). `ext_server_apply` передаёт в `apply` замыкание
  `move |id| { let _ = app.emit_to("main", EVENT_EXT_CAPTURE, id); }` и версию `app.package_info().version`.
- Привязка строго `SocketAddr::from(([127, 0, 0, 1], port))` — не `localhost`, не `0.0.0.0`. Порт вне
  1024–65535 → `Err("Порт должен быть от 1024 до 65535")`; занят → `Err("Порт {port} занят другой программой")`;
  прочее → `Err("Не удалось открыть порт {port}: …")`; негодный токен → `Err("Токен расширения не создан")`.
- (уточнено после ревью этапа 7) Сервер свой, на `std::net::TcpListener`. Поток приёма `qd-ext-http`:
  ждёт свободное место в `MAX_CONN` (сигнал от завершившегося соединения), затем блокирующий `accept`; без
  опроса по таймеру — в трее поток не просыпается без запросов. Ошибка `accept` (нехватка дескрипторов) —
  пауза 200 мс и продолжение. На каждое соединение — поток `qd-ext-conn`; одно соединение = один запрос
  (`Connection: close`). Остановка: флаг, сигнал места и **подключение к себе**, которое снимает блокирующий
  `accept` (флаг проверяется сразу после `accept`, будящее соединение до проверок не доходит); затем ожидание
  потока до 1 с. Смена токена на том же порту — подмена настроек на месте, без перезапуска. Смена порта —
  сначала открыть новый порт, затем остановить старый сервер: новый порт не открылся → `Err`, прежний сервер
  продолжает работать. Остановка при ожидающем сообщении отвечает `503` и очищает слот. Пределы — п. 2.12
  («Пределы приёма»).
- Токен в журнал, в тексты ошибок и в события не попадает. Сравнение — `ct_eq`.

**HTTP (версия 1).** Все ответы — `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-store`,
`X-Content-Type-Options: nosniff`, `Vary: Origin`; при проверенном `Origin` — `Access-Control-Allow-Origin: {origin}`
(не `*`, без `Allow-Credentials`). Тело ошибки — `{ "ok": false, "error": "…" }`.

| № | Проверка | Отказ |
|---|---|---|
| 1 | `Host` ровно `127.0.0.1:{port}` | 403 «Недопустимый адрес» |
| 2 | `Origin`: если есть — `is_extension_origin`; для `POST` и `OPTIONS` обязателен | 403 «Запрос не от расширения» |
| 3 | `OPTIONS` → 204 + `Access-Control-Allow-Methods: POST, GET`, `-Allow-Headers: authorization, content-type`, `-Allow-Private-Network: true`, `-Max-Age: 600` | — |
| 4 | Маршрут: `GET /v1/ping`, `POST /v1/capture` | 404 / 405 |
| 5 | `Authorization: Bearer {token}` | 401 «Неверный токен» |
| 6 | (уточнено после ревью этапа 7) Частота: не больше 30 запросов **с верным токеном** за 10 с (запрос без верного токена получает 401 на шаге 5 и в счёт не идёт: чужая страница не может забить окно частоты расширению) | 429 + `Retry-After: 10` |
| 7 | `GET /v1/ping` → `200 { "ok": true, "app": "quickdrop", "version": "…" }` | — |
| 8 | `Content-Type` начинается с `application/json` | 415 |
| 9 | `Content-Length` есть / не больше `MAX_BODY` | 411 / 413 «Слишком большой запрос» |
| 10 | Тело — UTF-8, JSON-объект, `"v": 1` | 400 |
| 11 | Передача главному окну, ожидание | 200 `{ "ok": true, "duplicate": bool }` / 422 / 503 / 504 |

Канал только принимает: ни один маршрут не возвращает записи, теги, категории или настройки; `ping` и
`duplicate` доступны только с токеном. Страница сайта не пройдёт: без CORS она не может поставить заголовок
`Authorization`, а preflight с её `Origin` получит 403; подмена DNS упирается в проверку `Host`.

(уточнено после ревью этапа 7) **Принятый риск — подмена сервера при свободном порту.** Расширение не
удостоверяется, кто отвечает на порту: токен уходит открытым `Authorization: Bearer` при каждом `ping` и `send`,
ответ узнаётся только по `app: "quickdrop"`. Пока порт свободен (приложение не запущено, приём выключен,
QuickDrop получил «Порт занят»), любой локальный процесс, в том числе другой учётной записи, может занять
`127.0.0.1:{port}` и получить токен и отправляемое содержимое (адрес, заголовок, выделенный текст), а с токеном
потом слать записи во «Входящие» в пределах частоты. Пока QuickDrop слушает, перехватить порт нельзя (вторая
привязка — `WSAEACCES`). Подходит однопользовательскому компьютеру (целевой сценарий); на общем компьютере —
выбрать нестандартный порт и не пользоваться расширением, когда QuickDrop закрыт. Оговорка — в подсказке токена
(`QuickCaptureSection.tsx`), в `extension/README.md` и на странице настроек расширения. Полное решение — версия
протокола 2 без секрета в проводе (HMAC-подпись запроса с `ts` и `nonce`, ответ `ping` с доказательством знания
токена, кэш `nonce` против повтора) — отдельной задачей, не на этапе 7.

Тесты `ext_server.rs` (`#[cfg(test)]`, сервер на свободном порту, запросы через `std::net::TcpStream`, вместо
главного окна — поток, вызывающий `take_pending` и `complete`): каждая строка таблицы; успешная запись и дубль;
422; сообщение не забрано → 504 и пустой слот; забрано без подтверждения → 504; повторный `apply` с теми же
параметрами не перезапускает; смена токена — старый токен 401; после `stop` порт свободен; тело ровно
`MAX_BODY` принимается, на байт больше — 413. Сроки в тестах — укороченные (поля состояния или
`cfg(test)`-константы), чтобы набор шёл секунды. (уточнено после ревью этапа 7) Плюс пределы своего сервера:
8 TLS-подобных и 8 молчащих соединений не мешают `ping` дольше ~`HEAD_TIMEOUT`; не-HTTP байты закрываются
сразу; 20 молчащих — в обработке не больше `MAX_CONN`, `ping` ждёт не больше двух сроков заголовков;
последовательные запросы быстрее 20 мс (нет опроса `accept`); `stop` быстрее 200 мс и порт сразу свободен,
в том числе когда все места заняты; заголовки, разрезанные на `\r\n\r` + `\n`; 431, 400, `Expect: 100-continue`.
Тесты модулей выполняются в составе библиотеки (`cargo test --lib`); отдельных проверочных целей в
`src-tauri/tests` нет.

**Содержимое — `src/lib/extensionCapture.ts`** (чистый, с тестом; пакет `ext-inbox`):

```ts
export const EXT_URL_MAX = 2048
export const EXT_TITLE_MAX = 300
export const EXT_TEXT_MAX = 500_000
export type ExtensionKind = 'page' | 'link' | 'selection'
export interface ExtensionMessage { v: 1; kind: ExtensionKind; url?: string; title?: string; text?: string }
/** Бросает Error с русским текстом. Лишние поля отбрасываются. */
export function parseExtensionMessage(raw: unknown): ExtensionMessage
export function extensionMessageToInput(msg: ExtensionMessage): NewItemInput
```

- `raw` — обычный объект, `v === 1`, `kind` из списка; иначе «Неизвестный формат сообщения расширения».
- `url`: строка, после `trim` не длиннее `EXT_URL_MAX`, разбирается `new URL`, протокол только `http:` /
  `https:`. Для `page` и `link` обязателен («Не указан адрес страницы», «Адрес не поддерживается» — например
  `chrome://`, `file://`). Для `selection` негодный или отсутствующий адрес просто отбрасывается.
- `title`: необязательная строка; управляющие символы убираются, пробельные схлопываются, обрезка до
  `EXT_TITLE_MAX`; не строка → отбрасывается.
- `text` (только `selection`): строка, непустая после `trim` («Выделенный текст пуст»), не длиннее
  `EXT_TEXT_MAX` («Выделенный текст слишком длинный»); `\r\n` → `\n`, символ NUL убирается.
- Отображение: `page`, `link` → `{ type: 'link', url, title, status: 'inbox', source: 'extension' }`.
  `selection` → по `detectInput(text)`: `link` → запись-ссылка с `det.url`; `code` →
  `{ type: 'code', content: det.stripped ?? text, language, title }` (адрес источника в код не дописывается,
  заголовок — название страницы); иначе `{ type: 'text', content: text + (url ? '\n\nИсточник: ' + url : '') }`
  без заголовка. Везде `status: 'inbox'`, `source: 'extension'`.

**Приём — `src/lib/extInbox.ts`** (с тестом; пакет `ext-inbox`):

```ts
export interface ExtResult { ok: boolean; duplicate: boolean; error?: string }
export interface ExtInboxDeps {
  findDuplicateLink(url: string): Promise<Item | undefined>     // repo.findDuplicateLink
  createAndEnrich(input: NewItemInput): Promise<Item>           // lib/actions
  onSaved?(item: Item): void
}
/** Разбор, проверка дубля ссылки, создание записи. Не бросает: ошибка → { ok: false, error }. */
export function handleExtCapture(message: unknown, deps?: Partial<ExtInboxDeps>): Promise<ExtResult>
/** ext_take_pending → handleExtCapture → ext_capture_done, строго по одному. Возвращает число обработанных. Не бросает. */
export function drainExtInbox(): Promise<number>
/** Подписка getCurrentWebviewWindow().listen('ext-capture') и первый drain. Идемпотентна. Вне Tauri и в мини-окне — ничего. */
export function startExtInbox(): Promise<void>
```

Дубль ссылки (в т.ч. ссылка из выделения) → `{ ok: true, duplicate: true }`, запись не создаётся. Ошибка →
`describeError(e, 'Не удалось сохранить')`. Запись в БД — только через `createAndEnrich` → `repo.createItem`.
После успешного сохранения, если страница главного окна видима (`document.visibilityState === 'visible'`), —
`toast.success('Сохранено из браузера', { description: displayTitle(item), action: «Открыть» → select })`.
Вызовы `drain`, пришедшие во время работы, не теряются и не идут параллельно (флаг «повторить»).
Подключение — в `main.tsx` (пакет `wire`): `if (isTauri()) void import('./lib/extInbox').then((m) => m.startExtInbox())`.

### 2.14.5. Мини-окно (пакет `ui-capture`)

**Как мини-окно создаёт запись.** У окна своя загрузка приложения — отдельная страница `capture.html` с точкой
входа `src/capture-main.tsx` (не маршрут и не параметр `index.html`): оболочка, списки, граф, фон, `pwa.ts`,
`initDesktop()`, `applyInitialHash()`, очистка корзины и разбор PDF задним числом в ней не загружаются. Origin и
каталог данных WebView2 у окон общие → та же IndexedDB `quickdrop`, те же `localStorage` (тема, сцена, шрифт) и
таблица `meta`. Запись создаёт само мини-окно: `createAndEnrich(input)` → `repo.createItem`. Главное окно
узнаёт о записи без событий Tauri: `liveQuery` Dexie получает изменения другого окна (`BroadcastChannel`),
списки, счётчики и поисковый индекс обновляются сами. Заголовок ссылки догружает мини-окно уже скрытым
(`fetch_link_meta` доступна всем окнам).

**Файлы:**

| Файл | Содержимое |
|---|---|
| `capture.html` | как `index.html` без метатегов PWA и `apple-*`; `<html lang="ru">`, `<title>QuickDrop — быстрая запись</title>`, `<script src="/theme-init.js">`, `<div id="root">`, `<script type="module" src="/src/capture-main.tsx">`. Inline-скриптов нет |
| `src/capture-main.tsx` | `import './index.css'`, `import './styles/capture-window.css'`, `createRoot(...).render(<StrictMode><CaptureWindowApp /></StrictMode>)` |
| `src/styles/capture-window.css` | обычный CSS (без директив Tailwind): `html, body, #root` на всю высоту, без прокрутки страницы, фон окна — токен сцены |
| `src/components/capture/CaptureForm.tsx` | форма, перенесённая из `QuickCapture.tsx` вместе с `FileRow`, черновиком, `acceptFiles` и прочими внутренними функциями |
| `src/components/capture/QuickCapture.tsx` | остаётся `QuickCapture()` с прежним контрактом: `Dialog` + `CaptureForm variant="dialog"` + `notifySaved` |
| `src/components/capture/CaptureWindowApp.tsx` | корень мини-окна |
| `src/lib/captureWindow.ts` (+ тест) | п. 2.2: `CAPTURE_WINDOW_LABEL`, `CAPTURE_BLUR_DELAY_MS`, `hideCaptureWindow`, `createBlurHider`, `initCaptureWindow`; (уточнено после ревью этапа 7) `capturePointerDown` (команда `capture_pointer_down`) |
| `vite.config.ts` | `build: { rolldownOptions: { input: isTauriBuild ? { main: 'index.html', capture: 'capture.html' } : undefined } }`; остальное не трогать |

**Пропсы формы** (перенос механический: поведение диалога не меняется ни в чём):

```ts
export interface CaptureFormProps {
  variant: 'dialog' | 'window'
  /** Диалог: useUi.captureDraft. Окно: null. */
  draft: CaptureDraft | null
  /** Форма кладёт сюда «можно ли закрыть» (как сейчас): false — идёт сохранение или показан вопрос о файлах. */
  snapshotRef: { current: (() => boolean) | null }
  /** Диалог: closeCapture. Окно: размонтировать форму и скрыть окно. */
  onClose(): void
  /** Диалог: notifySaved (toast с «Открыть»). Окно: ничего — окно скрывается. */
  onSaved(ids: string[], toLibrary: boolean): void
  /** «Открыть» у дубля ссылки. Диалог: openItemInSection. Окно: openInMain(item.id). */
  onOpenItem(item: Item): void
  /** Окно: системный диалог выбора файла открыт/закрыт — пауза скрытия по потере фокуса. */
  onFilePicker?(open: boolean): void
}
```

Вместо прямых `useUi((s) => s.closeCapture)`, `useUi((s) => s.captureDraft)`, `useUi.getState().captureDraft`,
`openItemInSection` и `notifySaved` форма пользуется пропсами. `onFilePicker(true)` — перед
`fileInputRef.current?.click()`; `onFilePicker(false)` — на `change` и `cancel` поля файла. `variant="window"`:
форма занимает всю высоту окна и прокручивается внутри, поле текста растягивается; кнопка «Отмена» видна и на
широком экране (в диалоге она только на телефоне).

**`CaptureWindowApp`:** `ErrorBoundary` (как в `App.tsx`, `StorageErrorFallback`) → `ThemeProvider` →
`TooltipProvider` → рамка окна + `Toaster`. Состояние `open`:

- `capture-shown` → `open = true` (форма монтируется, поле текста получает фокус; черновик восстанавливается
  штатно); окно уже открыто — только вернуть фокус в поле текста;
- запрос закрытия (`Esc`, потеря фокуса через `createBlurHider`, кнопка закрытия в шапке): если
  `snapshotRef.current?.() === false` — остаться; иначе `open = false` и `hideCaptureWindow()`;
- `onClose` формы (сохранено, «Отмена», «Открыть» у дубля) → то же без опроса;
- `Esc` обрабатывается на `window` в фазе всплытия и только если событие не обработал открытый выпадающий
  список (категория, теги, язык): первый `Esc` закрывает список, второй — окно;
- вне Tauri (страница открыта в браузере на `/capture.html` — так её проверяют в dev) форма открыта сразу,
  скрытие ничего не делает.

Оформление — в обоих стилях (`docs/DESIGN.md`): в пиксельных сценах рамка `px-panel` (дерево + бумага), в
«Классике» — `bg-popover` с рамкой 1 px `--border`; шапка — значок `sprout` (в «Классике» скрыт, как в
`QuickCapture`), «Быстрая запись», кнопка закрытия (`Icon name="x"`); шапка — область перетаскивания
(`data-tauri-drag-region`, кнопка закрытия из неё исключена). Новых токенов и правок `pixel.css` не нужно.
`ConfirmHost`, `useHotkeys`, `AppShell` в мини-окно не подключаются.

Тест `captureWindow.test.ts`: `createBlurHider` с поддельными таймерами — скрытие через задержку; фокус вернулся
до срока — не скрывать; `suspend` / `resume`; потеря фокуса во время паузы после `resume` и возврата фокуса не
скрывает; `dispose`.

### 2.14.6. Настройки: секция «Быстрый захват» (пакет `ui-settings`)

Новый `src/views/settings/QuickCaptureSection.tsx`: `QuickCaptureSection({ settings }: { settings: Settings })`,
`Section id="quick-capture" title="Быстрый захват"`, описание: «Мини-окно по глобальному сочетанию, значок в
трее, запуск вместе с системой и приём записей от расширения браузера». В `SettingsView.tsx` — сразу после
`ShortcutsSection`. Образец устройства — `BackupSection` и `AiSection` (`Row`, `Field`, `CommitInput`, `Switch`,
ошибки через `describeError`).

**Вне Tauri** секция показывает только абзац `QUICK_CAPTURE_DESKTOP_HINT`.

**В Tauri:**

| Элемент | Поведение |
|---|---|
| Переключатель «Мини-окно быстрой записи» (`captureWindow`) | `setSetting` → `applyShellOptions({ ...settings, captureWindow })`. Подсказка: «Глобальное сочетание открывает маленькое окно поверх других программ. Выключено — поднимается главное окно QuickDrop» |
| Поле «Глобальное сочетание» | переносится из `ShortcutsSection` без изменений поведения (`applyGlobalShortcut`, `globalShortcutFailure`, тексты ошибок). В `ShortcutsSection` на его месте строка: в Tauri — «Глобальное сочетание настраивается в разделе «Быстрый захват»», вне Tauri — нынешний текст про настольную версию |
| Переключатель «Сворачивать в трей при закрытии» (`closeToTray`) | `setSetting` → `applyShellOptions`. Подсказка: «Крестик прячет окно в трей, QuickDrop продолжает работать: действуют сочетание и приём от расширения. Выйти — через значок в трее» |
| Переключатель «Запускать вместе с системой» | состояние — `getAutostart()` при показе секции (в `Settings` не хранится); `setAutostart(on)`, при отказе — `toast.error` и прежнее положение. `available === false` → выключен, рядом `reason`. Подсказка: «QuickDrop стартует свёрнутым в трей» |
| Заголовок блока «Расширение для Chrome» | — |
| Переключатель «Принимать записи от расширения» (`extEnabled`) | включение: токен — нынешний, если `isExtensionToken`, иначе `generateExtensionToken()`; `applyExtensionServer({ extEnabled: true, extPort, extToken })`; запустился → `setSettings({ extToken, extEnabled: true })`; не запустился → `toast.error(status.error)`, настройка не включается (созданный токен сохраняется). Выключение: `setSetting('extEnabled', false)` → `applyExtensionServer` с `extEnabled: false`. Подсказка: «QuickDrop слушает только этот компьютер (127.0.0.1) и только пока приём включён. Работает, пока приложение запущено» |
| Строка состояния | `extStatusText(settings.extEnabled, status)`; `status` — `getExtServerStatus()` при показе и после каждого применения; ошибка — цветом `text-destructive`, `role="status"` |
| Поле «Порт» | `CommitInput`, `validateExtPort`; при включённом приёме сначала `applyExtensionServer` с новым портом: отказ → ошибка под полем, в настройках и у работающего сервера остаётся старый порт (Rust не останавливает прежний сервер, пока не открыл новый порт); успех → `setSetting('extPort', n)` |
| Поле «Токен» | только чтение, по умолчанию `maskToken`; кнопки: «Показать» / «Скрыть» (значки `eye` / `eye-off`), «Скопировать» (`copyText(token, 'Токен скопирован')` из `lib/actions`), «Сменить» — `confirmDialog({ title: 'Сменить токен?', description: 'Расширение перестанет сохранять записи, пока в его настройках не указан новый токен.', confirmLabel: 'Сменить' })` → новый токен → при включённом приёме `applyExtensionServer` → `setSetting('extToken', …)`. Токена ещё нет — «не создан», кнопки «Показать» и «Скопировать» выключены. Подсказка: «Токен хранится только на этом компьютере и не попадает в резервную копию» |
| Установка расширения | нумерованный список `EXTENSION_INSTALL_STEPS` |

Тексты шагов установки: 1) «Откройте в Chrome страницу chrome://extensions и включите «Режим разработчика»»;
2) «Нажмите «Загрузить распакованное расширение» и выберите папку extension из комплекта QuickDrop»;
3) «Откройте настройки расширения: значок QuickDrop → «Настройки»»; 4) «Вставьте туда порт и токен из этого
раздела и нажмите «Сохранить»»; 5) «Нажмите «Проверить соединение» — должно появиться «Соединение есть»».

Оформление — существующими примитивами секций настроек, верно в пиксельных сценах и в «Классике»; `brand` не
использовать (здесь нет главного действия). Проверка в браузере — с подставленным `window.__TAURI_INTERNALS__`,
как секция копий на этапе 4 (команды Rust при этом недоступны: обёртки возвращают отказ, секция должна
показать его текстом, а не упасть).

### 2.14.7. Расширение Chrome (пакет `extension`)

```
extension/
  manifest.json
  background.js      service worker (ES-модуль): контекстное меню, команда, значок-результат
  shared.js          общий модуль: настройки, отправка, тексты ошибок
  popup.html  popup.js
  options.html  options.js
  ui.css             общий стиль всплывающего окна и страницы настроек
  icons/icon-16.png  icon-32.png  icon-48.png  icon-128.png
  README.md
scripts/gen-extension-icons.mjs    public/icon.svg → четыре PNG (sharp), запуск: node scripts/gen-extension-icons.mjs
```

`manifest.json` — как в п. 2.7 с поправками: `"permissions": ["activeTab", "contextMenus", "storage"]`,
`"host_permissions": ["http://127.0.0.1/*"]`, `"background": { "service_worker": "background.js", "type": "module" }`,
`"minimum_chrome_version": "116"`, `"version": "0.1.0"` (версия расширения ведётся отдельно от приложения).
Нет: `scripting`, `tabs`, `<all_urls>`, постоянных content scripts, удалённого кода, inline-скриптов, сборки и
зависимостей.

`shared.js`:

```js
export const DEFAULT_PORT = 47821
export async function loadConfig()                 // { port, token } из chrome.storage.local (не sync)
export async function saveConfig({ port, token })
export function portError(value)                   // null или текст: целое 1024–65535
export function tokenError(value)                  // null или текст: 43 символа A–Z a–z 0–9 _ -
export async function send(kind, { url, title, text })   // → { ok: true, duplicate } | { ok: false, error }
export async function ping()                       // → { ok: true, version } | { ok: false, error }
```

- Адрес — всегда `http://127.0.0.1:${port}`; заголовки `Authorization: Bearer ${token}` и
  `Content-Type: application/json`; `signal: AbortSignal.timeout(20000)`; других сетевых запросов нет.
- До отправки: токена нет → «Укажите токен в настройках расширения»; адрес страницы не http/https → «Эту
  страницу сохранить нельзя»; адрес длиннее 2048, текст длиннее 500 000 символов или тело больше 1 МиБ →
  «Слишком большой текст».
- Ответы: сетевой отказ → «QuickDrop не запущен или приём выключен»; истёк срок → «QuickDrop не ответил»;
  401 → «Неверный токен. Скопируйте его заново из настроек QuickDrop»; 403 → «QuickDrop отклонил запрос»;
  413 → «Слишком большой текст»; 429 → «Слишком часто. Повторите через несколько секунд»; прочее — поле
  `error` ответа либо «Ошибка {код}».

`background.js`: в `runtime.onInstalled` — `contextMenus.removeAll()` и три пункта: `qd-page` (`['page']`,
«Сохранить страницу в QuickDrop»), `qd-link` (`['link']`, «Сохранить ссылку в QuickDrop»), `qd-selection`
(`['selection']`, «Сохранить выделенное в QuickDrop»). `contextMenus.onClicked`: страница → `send('page',
{ url: tab.url, title: tab.title })`; ссылка → `send('link', { url: info.linkUrl })`; выделение →
`send('selection', { url: info.pageUrl, title: tab?.title, text: info.selectionText })`. Команда `save-page`
(`Alt+Shift+Q`) → как пункт страницы. Итог — значком: «OK» (сохранено или уже было) или «!» на 2 с, текст —
в `action.setTitle` («Сохранено в QuickDrop», «Уже сохранено», текст ошибки).

Всплывающее окно: заголовок и адрес активной вкладки (`tabs.query({ active: true, currentWindow: true })`,
данные вкладки даёт `activeTab`), кнопка «Сохранить страницу», строка состояния (`role="status"`), ссылка
«Настройки» (`runtime.openOptionsPage()`); после успеха закрывается через 800 мс. Страница настроек: порт,
токен (поле-пароль с «Показать»), «Сохранить», «Проверить соединение» → «Соединение есть: QuickDrop {версия}»
или текст ошибки.

Вид: расширение живёт вне приложения, поэтому один стиль — палитра «Классики» (тёплая бумажная нейтраль,
акцент — терракота `#D2622E` только на главной кнопке), системный шрифт, светлая и тёмная тема по
`prefers-color-scheme`, без эмодзи, градиентов и капса. Все тексты — по-русски.

`README.md`: что умеет; установка (те же пять шагов); какие права и зачем; ограничения (QuickDrop должен быть
запущен, приём включён; выделение сохраняется без переносов строк; служебные страницы браузера не
сохраняются); как обновить (кнопка обновления на `chrome://extensions`); как пересоздать значки.

Проверка пакета: `node --check` для каждого `.js`, `manifest.json` разбирается как JSON, значки существуют и
имеют нужный размер. В Chrome расширение проверяет основная сессия.

### 2.14.8. Зависимости, конфигурация, сведение

**Пакет `deps`** — единственный, кто меняет `Cargo.toml`, `Cargo.lock`, `tauri.conf.json`, `capabilities/*`,
`build.rs`, `package.json`, `package-lock.json` и запускает `cargo fetch` / `npm install`:

- `src-tauri/Cargo.toml`: `tauri = { version = "2", features = ["tray-icon"] }`. (уточнено после ревью этапа 7)
  Итог: HTTP-крейта нет (сервер свой); в секции настольных платформ (рядом с `global-shortcut` и
  `single-instance`) — `auto-launch = "0.6"` вместо плагина автозапуска; в `[target.'cfg(windows)'.dependencies]` —
  `windows-sys = "0.61"` (п. 2.10). Версии Tauri — только `2.x`, не альфа Tauri 3.
- `src-tauri/tauri.conf.json`: второй элемент `app.windows` — запись `capture` из п. 2.2 (640×440,
  `create: false`). CSP и остальное не трогать.
- `src-tauri/capabilities/capture.json`: `{ "identifier": "capture", "description": "Права мини-окна быстрой
  записи", "windows": ["capture"], "permissions": ["core:default", "core:window:allow-hide",
  "core:window:allow-start-dragging"] }`. `default.json` не меняется (главное окно показывает и прячет Rust).
- `package.json` / `package-lock.json`: изменений нет (npm-пакет автозапуска не нужен).
- Проверка: `cargo check`, `cargo test` (60 тестов этапа 4 проходят и с feature `tray-icon`), `npm run typecheck`.
  Если тестовый exe в Windows перестал запускаться из-за манифеста common-controls (код `0xc0000139`) —
  обход в `src-tauri/build.rs`, с записью в отчёт.
- **Сверка API по скачанным исходникам** с записью в `.progress/agents/stage7-deps.md` точных сигнатур.
  Расхождения с п. 2.14 — в отчёт: пакеты `rust-shell` и `rust-ext` читают его первым делом. (уточнено после
  ревью этапа 7) Плагин автозапуска и HTTP-крейт, которые здесь сверялись, из проекта убраны (пп. 2.4, 2.14.4).

**Пакет `wire`** (волна 2) — `src-tauri/src/lib.rs` и `src/main.tsx`:

```rust
mod backup;
mod ext_server;
mod shell;
// #[cfg(desktop)]: single-instance первым — |app, args, _cwd| shell::on_second_instance(app, &args);
//                  global-shortcut (уточнено после ревью этапа 7: плагина автозапуска нет, автозапуск — в shell::init)
// setup: … approved-dirs, own-backups (как сейчас); app.manage(ext_server::ExtServer::default());
//        shell::init(app)?; create_main_window(app, shell::started_hidden())?   // скрытый старт: .visible(false)
// .on_window_event(|window, event| shell::on_window_event(window, event))
// invoke_handler: нынешние 9 команд + shell::{set_shell_options, toggle_capture_window, capture_pointer_down,
//   show_main_window, open_in_main, quit_app, get_autostart, set_autostart}
//   + ext_server::{ext_server_apply, ext_server_status, ext_take_pending, ext_capture_done}
```

`main.tsx`: после `void initDesktop()` — `if (isTauri()) void import('./lib/extInbox').then((m) => m.startExtInbox())`
(с `catch` и `console.warn`). Проверка сведения: `cargo check`, `cargo test`, `npm run typecheck`, `npm test`,
`npm run build` (веб: `capture.html` в `dist` нет) и сборка веб-слоя как для Tauri (`TAURI_ENV_PLATFORM=windows`
в окружении → в `dist` есть `index.html` и `capture.html`, `sw.js` нет). Модуль волны 1 не собирается в составе
библиотеки — чужой файл не править, вернуть ошибку с точным текстом компилятора.

### 2.14.9. Пакеты (один файл — ровно один пакет)

| Волна | Пакет | Модель | Файлы |
|---|---|---|---|
| 0, по очереди | `deps` | opus | `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/capture.json`, `src-tauri/build.rs` (только при необходимости) |
| 0, по очереди | `contracts` | opus | `src/types.ts`, `src/lib/platform.ts`, `src/db/db.ts`, `src/index.css`, `src/lib/shellUi.ts`, `src/lib/shellUi.test.ts`, `src/lib/desktop.ts`, `src/lib/desktop.test.ts`, `src/lib/exportImport.test.ts`, `src/lib/settingsSchema.test.ts`, `src/db/seed.test.ts` |
| 1 | `rust-shell` | opus | `src-tauri/src/shell.rs`, `src-tauri/tests/shell_module.rs` |
| 1 | `rust-ext` | opus | `src-tauri/src/ext_server.rs`, `src-tauri/tests/ext_server_module.rs` |
| 1 | `ext-inbox` | opus | `src/lib/extensionCapture.ts`, `src/lib/extensionCapture.test.ts`, `src/lib/extInbox.ts`, `src/lib/extInbox.test.ts` |
| 1 | `ui-capture` | sonnet | `capture.html`, `src/capture-main.tsx`, `src/styles/capture-window.css`, `src/components/capture/CaptureForm.tsx`, `src/components/capture/QuickCapture.tsx`, `src/components/capture/CaptureWindowApp.tsx`, `src/lib/captureWindow.ts`, `src/lib/captureWindow.test.ts`, `vite.config.ts` |
| 1 | `ui-settings` | sonnet | `src/views/settings/QuickCaptureSection.tsx`, `src/views/SettingsView.tsx`, `src/views/settings/ShortcutsSection.tsx` |
| 1 | `extension` | sonnet | `extension/manifest.json`, `extension/background.js`, `extension/shared.js`, `extension/popup.html`, `extension/popup.js`, `extension/options.html`, `extension/options.js`, `extension/ui.css`, `extension/icons/icon-16.png`, `extension/icons/icon-32.png`, `extension/icons/icon-48.png`, `extension/icons/icon-128.png`, `extension/README.md`, `scripts/gen-extension-icons.mjs` |
| 2 | `wire` | opus | `src-tauri/src/lib.rs`, `src/main.tsx` |

Каждый пакет ведёт `.progress/agents/stage7-<пакет>.md`.

**Как модули Rust проверяются до сведения.** `lib.rs` принадлежит пакету `wire`, а неподключённый модуль
компилятор не видит. Поэтому каждый пакет Rust волны 1 кладёт рядом проверочную цель — файл в `src-tauri/tests/`
из двух строк:

```rust
#![allow(dead_code)]
#[path = "../src/shell.rs"] mod shell;      // у rust-ext — "../src/ext_server.rs" mod ext_server
```

и проверяет только её: `cargo check --manifest-path src-tauri/Cargo.toml --test shell_module`, затем
`cargo test … --test shell_module` (тесты `#[cfg(test)]` внутри модуля в такой цели выполняются). Отсюда
требование: модули не ссылаются на `crate::…`. Пакеты идут параллельно — общий `cargo test` в волне 1 не
запускать (чужой модуль может быть недописан). После сведения проверочные цели дублируют тесты модулей;
основная сессия удаляет `src-tauri/tests/` при коммите этапа (или оставляет — цена только во времени сборки).
(уточнено после ревью этапа 7) Удалены: тесты модулей идут в составе библиотеки (`cargo test --lib`).

**Проверки по волнам.** Волна 0: после `deps` — `cargo check`, `cargo test`, `npm run typecheck`; после
`contracts` — `npm run typecheck`, `npm test` (приложение ведёт себя как раньше: команд Rust ещё нет, обёртки
возвращают отказ, сочетание поднимает главное окно). Волна 1: Rust — своя проверочная цель; веб —
`npm run typecheck` и свои тесты (ошибки в чужих файлах параллельных пакетов — не повод их править; повторить
проверку); `ui-capture` и `ui-settings` — ещё и просмотр в браузере в пиксельной сцене и в «Классике».
Волна 2: полный набор из п. 2.14.8.

**Зависимости между пакетами волны 1** — только через контракты этого раздела: имена команд и событий
(пп. 2.14.3, 2.14.4), `desktop.ts` и `shellUi.ts` (п. 2.14.2), протокол HTTP (п. 2.14.4), пропсы формы
(п. 2.14.5). Файлы пакетов не пересекаются.

### 2.14.10. Открытые вопросы (умолчания приняты, работу не блокируют)

1. **Переносы строк в выделении.** Без права `scripting` Chrome отдаёт выделение одной строкой. Добавить
   `scripting` (тогда и кнопка «Сохранить выделенное» во всплывающем окне)? Умолчание — нет (минимальные права).
2. **Расширение в установщике.** Вложить каталог `extension/` в сборку (`bundle.resources`) и добавить в
   настройки кнопку «Показать папку расширения»? Умолчание — нет: папка берётся из исходников; вернуться на этапе 8.
3. **`captureWindow` по умолчанию включён** — глобальное сочетание из чужого приложения открывает мини-окно, а
   не главное. Это и есть цель этапа; выключается в настройках.
4. **Поле «Глобальное сочетание» переезжает** из «Горячих клавиш» в «Быстрый захват».
5. **Toast «Сохранено из браузера»** в главном окне, когда оно на экране. Убрать, если мешает.
6. **Автозапуск при выключенном трее**: после входа в систему QuickDrop стартует скрытым, но закрытие окна
   крестиком завершает его до следующего входа. Подсказки в секции это объясняют; связывать настройки не стали.
7. **Привязка к идентификатору расширения** не делается: у распакованного расширения он зависит от пути к
   папке. Защита — токен, `Origin` вида `chrome-extension://…` и `Host`.
8. **Сеть для `deps`**: нужно было скачать HTTP-крейт и плагин автозапуска. (уточнено после ревью этапа 7)
   Снято: оба из проекта убраны, новых зависимостей из сети не нужно.

### 2.14.11. Что проверить основной сессии после сведения

Сверх критериев п. 2.11: крестик при выключенном `closeToTray` завершает процесс (мини-окно создано и скрыто);
запись из мини-окна появляется в открытом главном окне без перезагрузки; заголовок ссылки, сохранённой из
мини-окна, догружается; `Esc` при открытом списке категорий закрывает список, а не окно; выбор файла скрепкой не
прячет окно; расширение сохраняет при главном окне в трее; при выключенном приёме порт закрыт; смена порта и
токена применяется без перезапуска; `fetch` к `http://127.0.0.1:47821/v1/capture` из консоли обычного сайта —
отказ; экспорт копии не содержит `extToken`, `extPort`, `extEnabled`; в «Классике» и в пиксельной сцене секция
настроек и мини-окно выглядят верно; веб-версия (`npm run dev` в браузере) показывает в секции только пояснение.
