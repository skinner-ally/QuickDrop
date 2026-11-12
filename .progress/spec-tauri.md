# Спецификация: оболочка Tauri

Автор: архитектор `spec-tauri`, 2026-11-11. Основание: `.progress/plan-combined.md` (этапы 2, 7, 8).
Часть 1 исполняется на этапе 2 агентом `tauri-backup`. Часть 2 — проработка этапа 7 и приёмки этапа 8.

## 0. Исходное состояние (проверено)

| Что | Значение |
|---|---|
| `tauri` в `Cargo.lock` | 2.12.5 (runtime-wry 2.12.3, wry 0.57.2, tao 0.37.2, tray-icon 0.25.1 — уже в lock как необязательная) |
| Плагины в проекте | `tauri-plugin-opener` 2.7.3, `tauri-plugin-global-shortcut` 2.4.1, `tauri-plugin-single-instance` 2.5.5 (уже подключён, поднимает `main`) |
| Последние 2.x на crates.io | `tauri-plugin-dialog` 2.8.4 (тянет `tauri-plugin-fs` 2.7.1), `tauri-plugin-autostart` 2.7.0, `tauri-plugin-deep-link` 2.6.3; все требуют `tauri ^2.12`, rust 1.90 (локально rustc 1.99.1) |
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

## 2.1. Сводка решений

| Вопрос | Решение | Почему |
|---|---|---|
| Мини-окно | Второе `WebviewWindow` с меткой `capture`, отдельная точка входа `capture.html` + `src/capture-main.tsx` | Не тянет оболочку, списки, граф, фон; не запускает побочные действия главного окна (сочетания, автобэкап, засев) |
| Когда создаётся | Скрытым, по команде `prepare_capture_window` из `initDesktop()` главного окна — после того как главное окно открыло БД | Показ мгновенный; обновление схемы Dexie всегда делает главное окно |
| Общие данные | Тот же origin и тот же каталог данных WebView2 → та же IndexedDB и `localStorage`; запись делает само мини-окно через `createAndEnrich` | Dexie 4 рассылает изменения между окнами одного origin — список в главном окне обновляется сам |
| Глобальное сочетание | Регистрация остаётся в JS главного окна; обработчик: главное окно в фокусе → прежний диалог, иначе `toggle_capture_window` | Минимум изменений; сохраняется готовая обработка занятого сочетания |
| Закрытие мини-окна | `Esc`, сохранение, потеря фокуса (в JS, с задержкой 150 мс и паузой на время системного диалога выбора файла) | Потерю фокуса в Rust нельзя отличить от открытия диалога файла |
| Трей | Меню «Открыть QuickDrop», «Быстрая запись», «Выход»; левый клик — открыть главное окно | — |
| Крестик главного окна | По умолчанию — в трей (`closeToTray: true`), при первом закрытии — разовый вопрос «Свернуть в трей / Выйти» | Иначе глобальное сочетание и приём из расширения перестают работать |
| Автозапуск | `tauri-plugin-autostart`, аргумент `--autostart` → главное окно стартует скрытым; состояние читается из системы, в `Settings` не хранится | Реестр можно изменить мимо приложения |
| Один экземпляр | Уже подключён; доработка: показать скрытое в трей окно; запуск с `--autostart` окно не поднимает | — |
| Канал расширения | Локальный HTTP на `127.0.0.1` с токеном; `quickdrop://` не делаем | См. 2.6 |

## 2.2. Мини-окно

`src-tauri/tauri.conf.json`, второй элемент `app.windows`:

```json
{
  "label": "capture", "create": false, "url": "capture.html", "title": "QuickDrop — быстрая запись",
  "width": 560, "height": 340, "resizable": false, "maximizable": false, "minimizable": false,
  "decorations": false, "shadow": false, "alwaysOnTop": true, "skipTaskbar": true,
  "visible": false, "focus": true, "center": true, "dragDropEnabled": false
}
```

`shadow: false` — прямоугольное окно без системной рамки Windows 11; рамку рисует CSS (деревянная в
пиксельных сценах, 1 px `--border` в «Классике»). `transparent` не включать (известные артефакты WebView2).
`data_directory` и `incognito` не задавать — иначе у окна будет своя IndexedDB.

Rust, новый `src-tauri/src/shell.rs`:

```rust
#[tauri::command] pub async fn prepare_capture_window(app: AppHandle) -> Result<(), String>;   // идемпотентна; WebviewWindowBuilder::from_config
#[tauri::command] pub async fn toggle_capture_window(app: AppHandle) -> Result<bool, String>;  // true — окно показано
#[tauri::command] pub async fn show_main_window(app: AppHandle) -> Result<(), String>;         // unminimize + show + set_focus
#[tauri::command] pub fn set_close_to_tray(state: State<'_, ShellState>, enabled: bool, hint_shown: bool);
#[tauri::command] pub async fn hide_main_window(app: AppHandle) -> Result<(), String>;
#[tauri::command] pub fn quit_app(app: AppHandle);                                             // app.exit(0)
pub struct ShellState { close_to_tray: AtomicBool, tray_hint_shown: AtomicBool }
```

`toggle_capture_window`: окна нет → создать; видимо и в фокусе → `hide()`, `Ok(false)`; иначе поставить на
монитор под курсором (`app.cursor_position()`, `app.monitor_from_point(x, y)`, запасной — `primary_monitor()`):
по горизонтали по центру, верх на 22 % высоты монитора; `show()`, `set_focus()`,
`emit_to("capture", "capture-shown", ())`. `CloseRequested` окна `capture` (Alt+F4) → `prevent_close()` + `hide()`.

Права — новый `src-tauri/capabilities/capture.json`: `"windows": ["capture"]`, `permissions`:
`core:default`, `core:window:allow-hide`, `core:window:allow-start-dragging`. Без `global-shortcut` и `opener`.

Веб-слой:

| Файл | Содержимое |
|---|---|
| `capture.html` (корень) | как `index.html`, без PWA-метатегов; `<script src="/theme-init.js">`, `<script type="module" src="/src/capture-main.tsx">` |
| `src/capture-main.tsx` | `createRoot` → `<CaptureWindowApp />`; не импортирует `./pwa`, не вызывает `initDesktop`, `applyInitialHash` |
| `src/components/capture/CaptureForm.tsx` | форма, вынесенная из `QuickCapture.tsx` без оболочки `Dialog`: `CaptureForm({ variant: 'dialog' \| 'window', onSaved(items: Item[]), onCancel() })`; `QuickCapture()` остаётся с прежним контрактом и использует её |
| `src/components/capture/CaptureWindowApp.tsx` | `ErrorBoundary` → `ThemeProvider` → `CaptureForm variant="window"` + `Toaster`; шапка с `data-tauri-drag-region` |
| `src/lib/captureWindow.ts` (+ тест) | см. ниже |
| `vite.config.ts` | `build.rolldownOptions.input = isTauriBuild ? { main: 'index.html', capture: 'capture.html' } : undefined` (Vite 8: `rollupOptions` — устаревший синоним). В веб-сборку и в precache PWA `capture.html` не попадает; в dev Vite отдаёт `/capture.html` сам |

```ts
// src/lib/captureWindow.ts
export const CAPTURE_WINDOW_LABEL = 'capture'
export const CAPTURE_BLUR_DELAY_MS = 150
export function isCaptureWindow(): boolean                       // location.pathname оканчивается на '/capture.html'
export function hideCaptureWindow(): Promise<void>               // getCurrentWindow().hide()
/** Чистая логика скрытия по потере фокуса (тестируется с fake timers). */
export function createBlurHider(hide: () => void, delayMs?: number): {
  onFocusChange(focused: boolean): void   // false → hide через delayMs, если фокус не вернулся и нет паузы
  suspend(): void                         // перед открытием системного диалога файла
  resume(): void                          // после change/cancel поля файла
  dispose(): void
}
/** Подписки окна: 'capture-shown' (сфокусировать поле ввода), onFocusChanged → blurHider, Esc. Возвращает отписку. */
export function initCaptureWindow(handlers: { onShown(): void; blur: ReturnType<typeof createBlurHider> }): Promise<() => void>
```

Сценарий: сохранение → `createAndEnrich` (статус `inbox`) → форма очищается → `hideCaptureWindow()`; ошибка →
окно остаётся, `toast.error(describeError(e))`. `Esc` и потеря фокуса скрывают окно, набранный текст остаётся
до следующего показа (окно не уничтожается). Загрузка заголовка ссылки доделывается в скрытом окне и приходит
в главное через БД (`isLinkMetaLoading` в главном окне для такой записи `false` — это уже предусмотренное
поведение «pending из другой вкладки»). Тема, сцена и шрифт — те же `theme-init.js` и `ThemeProvider`
(общие `localStorage` и таблица `meta`).

Изменение обработчика сочетания в `desktop.ts` (`registerShortcut`):

```ts
if (document.hasFocus()) useUi.getState().openCapture()
else void invoke('toggle_capture_window').catch(() => raiseWindow().finally(() => useUi.getState().openCapture()))
```

Текст подсказки в `ShortcutsSection`: «Открывает окно быстрой записи поверх любого приложения».

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

`CloseRequested` окна `main` (в `on_window_event`):
- `close_to_tray == false` → ничего (обычный выход);
- `true` и `tray_hint_shown == false` → `prevent_close()`, выставить `tray_hint_shown = true`, отправить в
  `main` событие `tray-hint`; окно не скрывать. JS показывает диалог: «QuickDrop останется работать в трее,
  чтобы действовали быстрая запись по сочетанию клавиш и расширение браузера» — кнопки «Свернуть в трей»
  (`hide_main_window`) и «Выйти» (`quit_app`); ставит `localStorage['qd-tray-hint'] = '1'`;
- `true` и подсказка показана → `prevent_close()` + `hide()`.
Если JS не отвечает, второе нажатие крестика скрывает окно — закрытие не зависит от веб-слоя.

Значения флагов Rust получает от JS: `initDesktop()` вызывает
`set_close_to_tray({ enabled: settings.closeToTray, hintShown: localStorage['qd-tray-hint'] === '1' })`;
до этого вызова оба флага `false` (если веб-слой не загрузился, крестик закрывает приложение).
При смене настройки интерфейс вызывает `setCloseToTray(on)`.

## 2.4. Автозапуск

Rust (в секции зависимостей для настольных платформ): `tauri-plugin-autostart = "2"`;
`.plugin(tauri_plugin_autostart::Builder::new().args(["--autostart"]).build())`.
Права в `default.json`: `autostart:allow-enable`, `autostart:allow-disable`, `autostart:allow-is-enabled`.
npm: `@tauri-apps/plugin-autostart`.

- `setup`: `std::env::args().any(|a| a == "--autostart")` → главное окно создаётся с `.visible(false)`.
- `desktop.ts`: `getAutostart(): Promise<boolean>`, `setAutostart(on: boolean): Promise<{ ok: boolean; error?: string }>`.
- `initDesktop()`: если `isEnabled()` → повторный `enable()` (обновляет путь к exe после переустановки).
- Переключатель в настройках выключен в dev-сборке (`import.meta.env.DEV`): иначе в реестр попадёт `target/debug`.
- Windows: значение в `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. Отключение через «Диспетчер
  задач → Автозагрузка» плагин не видит (`isEnabled()` остаётся `true`) — упомянуть в инструкции.

## 2.5. Один экземпляр

Плагин остаётся первым в цепочке. Обработчик: аргументы содержат `--autostart` → ничего; иначе
`unminimize()`, `show()`, `set_focus()` окна `main` (в т.ч. скрытого в трей).

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
| Минусы | — | Порт может быть занят (настраивается); приложение должно работать (трей + автозапуск) |

**Рекомендация: HTTP на `127.0.0.1` с токеном.** Главный сценарий — выделенный текст — в адрес не помещается,
а без ответа расширение не может честно сообщить результат. Трей и автозапуск того же этапа закрывают
единственный минус. `tauri-plugin-deep-link` не подключаем.

### Протокол (версия 1)

Сервер: `tiny_http = "0.12"`, отдельный поток, привязка строго `("127.0.0.1", port)`; порт по умолчанию `47821`.

```
POST http://127.0.0.1:{port}/v1/capture
Authorization: Bearer {token}
Content-Type: application/json

{ "v": 1, "kind": "page" | "link" | "selection",
  "url": "https://…",        // page: адрес страницы; link: адрес ссылки; selection: адрес страницы-источника
  "title": "…",              // page: заголовок страницы; link: текст ссылки; selection: заголовок страницы
  "text": "…" }              // только selection: выделенный текст

GET http://127.0.0.1:{port}/v1/ping      (тот же Authorization) → { "ok": true, "app": "quickdrop", "version": "0.1.0" }
```

Проверки в Rust, по порядку (ответ всегда JSON `{ "ok": false, "error": "…" }`):

| Проверка | Код |
|---|---|
| `Host` ровно `127.0.0.1:{port}` или `localhost:{port}` (защита от DNS rebinding) | 403 |
| `Origin` присутствует и начинается с `chrome-extension://` | 403 |
| `OPTIONS` (preflight) с верным `Origin` → 204 + `Access-Control-Allow-Origin: {origin}`, `-Allow-Methods: POST, GET`, `-Allow-Headers: authorization, content-type`, `-Allow-Private-Network: true`, `-Max-Age: 600` | 204 |
| Путь и метод не из списка | 404 / 405 |
| `Authorization: Bearer` совпадает с токеном (сравнение за постоянное время) | 401 |
| `Content-Type` начинается с `application/json` | 415 |
| `Content-Length` обязателен и ≤ 1 048 576 | 411 / 413 |
| Тело — JSON-объект | 400 |

Успешные ответы несут `Access-Control-Allow-Origin: {origin}`. Сервер стартует только с токеном длиной ≥ 32.

Дальше: Rust присваивает `requestId` (`AtomicU64`), шлёт в `main` событие `ext-capture`
`{ requestId, message }` и ждёт до 5 с вызова `ext_capture_done`:

```rust
#[tauri::command] pub async fn start_ext_server(app: AppHandle, port: u16, token: String) -> Result<u16, String>; // «Порт {port} занят другой программой»; повторный вызов перезапускает
#[tauri::command] pub fn stop_ext_server(app: AppHandle);
#[tauri::command] pub fn ext_capture_done(app: AppHandle, request_id: u64, ok: bool, id: Option<String>, duplicate: bool, error: Option<String>);
```

Ответы: `200 { "ok": true, "id": "…", "duplicate": false }`; ошибка сохранения → `422` с текстом; главное окно
не ответило за 5 с → `504 { "error": "QuickDrop не ответил" }`.

JS, новый чистый `src/lib/extensionCapture.ts` (+ тест):

```ts
export interface ExtensionMessage { v: 1; kind: 'page' | 'link' | 'selection'; url?: string; title?: string; text?: string }
/** Проверка полей и пределов: url ≤ 2048 и только http/https, title ≤ 300, text ≤ 500 000 символов. Бросает Error с русским текстом. */
export function parseExtensionMessage(raw: unknown): ExtensionMessage
export function extensionMessageToInput(msg: ExtensionMessage): NewItemInput
```

Соответствие: `page` и `link` → `{ type: 'link', url, title, status: 'inbox', source: 'extension' }`;
`selection` → `{ type: detectInput(text).type, language, content: text + (url ? '\n\nИсточник: ' + url : ''),
status: 'inbox', source: 'extension' }`. Обработчик события в `desktop.ts`: `parseExtensionMessage` → для
ссылок поиск дубля функцией этапа 2 (нашёлся → `ext_capture_done({ ok: true, id, duplicate: true })`, запись
не создаётся) → `createAndEnrich` → `ext_capture_done`. Главное окно при этом не поднимается.

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

```json
{
  "manifest_version": 3,
  "name": "QuickDrop",
  "version": "0.1.0",
  "description": "Сохраняет страницу, ссылку или выделенный текст во «Входящие» QuickDrop.",
  "minimum_chrome_version": "116",
  "permissions": ["contextMenus", "activeTab", "scripting", "storage"],
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
- Выделенный текст: `chrome.scripting.executeScript({ target: { tabId }, func: () => getSelection().toString() })`
  (сохраняет переносы строк); при отказе (служебные страницы, просмотр PDF) — `info.selectionText`.
- Всплывающее окно: заголовок и адрес активной вкладки, кнопки «Сохранить страницу» и, при наличии
  выделения, «Сохранить выделенное»; строка состояния («Сохранено», «Уже сохранено», текст ошибки,
  «QuickDrop не запущен», «Укажите токен в настройках расширения»); после успеха закрывается через 800 мс.
- Из service worker результат показывается значком: `action.setBadgeText` «OK» или «!» на 2 с, текст ошибки —
  в `action.setTitle`.
- Отправка: `fetch` с `AbortSignal.timeout(8000)`; сетевой отказ → «QuickDrop не запущен».
- Настройки расширения: порт, токен, кнопка «Проверить соединение» (`/v1/ping`).
- Без сборки: обычные JS-файлы, без зависимостей.

## 2.8. Требования безопасности

- Сервер слушает только `127.0.0.1`; выключен по умолчанию (`extEnabled: false`).
- Токен: 32 случайных байта (`crypto.getRandomValues`) в base64url, создаётся приложением при первом
  включении, хранится в `Settings.extToken`, входит в `PRIVATE_SETTINGS`, в журнал и события не пишется.
  Кнопка «Создать новый» перезапускает сервер.
- Никаких исходящих запросов ни из сервера, ни из расширения (кроме `http://127.0.0.1:{port}`);
  в расширении нет удалённого кода, постоянных content scripts и права `tabs`.
- Rust проверяет транспорт (адрес, origin, токен, размер), JS — содержимое (`parseExtensionMessage`);
  адрес проходит обычную проверку `createItem` (только http/https/ftp).
- Обработка запросов последовательная (один поток) — естественный предел частоты.
- Команды записи на диск (часть 1) работают только с подтверждёнными папками — мини-окно и возможная
  ошибка в разметке Markdown не расширяют доступ к файловой системе.

## 2.9. Настройки этапа 7 (добавления в `Settings`)

| Ключ | Тип | По умолчанию | Копия |
|---|---|---|---|
| `closeToTray` | `boolean` | `true` | можно экспортировать |
| `extEnabled` | `boolean` | `false` | `PRIVATE_SETTINGS` |
| `extPort` | `number` | `47821` | `PRIVATE_SETTINGS` |
| `extToken` | `string` | `''` | `PRIVATE_SETTINGS` |

Автозапуск в `Settings` не хранится (п. 2.4). Добавления в `desktop.ts` на этапе 7:

```ts
export function toggleCaptureWindow(): Promise<void>
export function showMainWindow(): Promise<void>
export function setCloseToTray(on: boolean): Promise<void>
export function getAutostart(): Promise<boolean>
export function setAutostart(on: boolean): Promise<{ ok: boolean; error?: string }>
export function generateExtensionToken(): string
export function applyExtensionServer(s: Pick<Settings, 'extEnabled' | 'extPort' | 'extToken'>): Promise<{ ok: boolean; port?: number; error?: string }>
```

`initDesktop()` дополнительно: `set_close_to_tray`, `prepare_capture_window`, `applyExtensionServer(settings)`,
обновление пути автозапуска, подписки `ext-capture` и `tray-hint`.

## 2.10. Зависимости этапа 7

| Где | Что | Версия |
|---|---|---|
| Cargo | `tauri` — добавить feature `tray-icon` | 2.12.5 |
| Cargo (настольные платформы) | `tauri-plugin-autostart = "2"` | 2.7.0 |
| Cargo | `tiny_http = "0.12"` | 0.12.0 |
| npm | `@tauri-apps/plugin-autostart` | ^2.7.0 |
| Не нужны | `tauri-plugin-deep-link`, `@tauri-apps/plugin-deep-link`, `@tauri-apps/plugin-dialog`, `tauri-plugin-fs` (приходит транзитивно с dialog, не регистрируется) | — |

## 2.11. Владение файлами на этапе 7 (без пересечений)

| Исполнитель | Файлы |
|---|---|
| основная сессия (до запуска) | `package.json` (`@tauri-apps/plugin-autostart`). (уточнено при сверке) Правки `src/types.ts` (настройки п. 2.9, `ItemSource`) и `src/lib/exportImport.ts` (`PRIVATE_SETTINGS`, `ITEM_SOURCES`) уже сделаны на этапе 2 (`.progress/spec-stage2.md` §1.1, §2.5) — только убедиться, что они на месте |
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
