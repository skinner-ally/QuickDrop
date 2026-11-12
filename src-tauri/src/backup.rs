//! Автокопия и экспорт в папку. Веб-слой присылает байты частями, запись идёт только в папки,
//! которые пользователь сам выбрал в системном диалоге (список подтверждённых папок).

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::borrow::Cow;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::ipc::InvokeBody;

pub const ARGS_HEADER: &str = "x-qd-args";
pub const PART_SUFFIX: &str = ".qdpart";
pub const MAX_CHUNK_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_BACKUP_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_EXPORT_FILE_BYTES: u64 = 128 * 1024 * 1024;
pub const MAX_KEEP: u32 = 1000;
pub const MAX_APPROVED_DIRS: usize = 16;
pub const MAX_OWN_BACKUPS: usize = 2000;
pub const MAX_REL_PATH_CHARS: usize = 400;
pub const MAX_REL_DEPTH: usize = 8;
pub const MAX_FULL_PATH_UTF16: usize = 259;

const ACTION_SAVE_BACKUP: &str = "Не удалось сохранить копию";
const ACTION_WRITE_FILE: &str = "Не удалось записать файл";
const ACTION_READ_DIR: &str = "Не удалось прочитать папку";
const ACTION_PRUNE: &str = "Не удалось удалить старые копии";
const ACTION_DISCARD: &str = "Не удалось удалить временный файл";

const BAD_ARGS: &str = "Некорректные параметры команды";
const BAD_ORDER: &str = "Нарушен порядок записи файла: повторите попытку";
const OUTSIDE_EXPORT_DIR: &str = "Путь выходит за пределы папки экспорта";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SaveBackupArgs {
    dir: String,
    file_name: String,
    offset: u64,
    last: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WriteExportArgs {
    dir: String,
    rel_path: String,
    offset: u64,
    last: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedFile {
    path: String,
    size: u64,
    done: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    name: String,
    size: u64,
    modified_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneResult {
    removed: Vec<String>,
    failed: Vec<String>,
}

/// Папки, выбранные пользователем в системном диалоге. Команды записи работают только с ними:
/// иначе любая ошибка внедрения скрипта в веб-слое превращалась бы в запись в произвольное место диска.
pub struct ApprovedDirs {
    file: PathBuf,
    dirs: Mutex<Vec<PathBuf>>,
}

impl ApprovedDirs {
    pub fn load(file: PathBuf) -> Self {
        let mut dirs: Vec<PathBuf> = fs::read(&file)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Vec<String>>(&bytes).ok())
            .unwrap_or_default()
            .into_iter()
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .collect();
        if dirs.len() > MAX_APPROVED_DIRS {
            dirs.drain(..dirs.len() - MAX_APPROVED_DIRS);
        }
        Self { file, dirs: Mutex::new(dirs) }
    }

    pub fn approve(&self, dir: &Path) -> Result<(), String> {
        if !dir.is_absolute() {
            return Err("Укажите полный путь к папке".into());
        }
        let mut dirs = self.dirs.lock().unwrap_or_else(|e| e.into_inner());
        let mut next: Vec<PathBuf> = dirs.iter().filter(|d| d.as_path() != dir).cloned().collect();
        next.push(dir.to_path_buf());
        if next.len() > MAX_APPROVED_DIRS {
            next.drain(..next.len() - MAX_APPROVED_DIRS);
        }
        // Сначала файл, потом память: несохранённое подтверждение пропало бы после перезапуска.
        save_dirs(&self.file, &next)?;
        *dirs = next;
        Ok(())
    }

    pub fn resolve(&self, dir: &str) -> Result<PathBuf, String> {
        let dir = dir.trim();
        if dir.is_empty() {
            return Err("Папка не выбрана".into());
        }
        let path = Path::new(dir);
        if !path.is_absolute() {
            return Err("Укажите полный путь к папке".into());
        }
        let canonical = dunce::canonicalize(path)
            .map_err(|_| format!("Папка не найдена: {dir}. Проверьте, что диск подключён"))?;
        if !canonical.is_dir() {
            return Err(format!("Это не папка: {dir}"));
        }
        // Копия списка: канонизация недоступной сетевой папки ждёт тайм-аута, держать при этом мьютекс нельзя.
        let dirs = self.dirs.lock().unwrap_or_else(|e| e.into_inner()).clone();
        if !is_approved(&dirs, path, &canonical, |d| dunce::canonicalize(d).ok()) {
            return Err("Папка не подтверждена: выберите её заново в настройках".into());
        }
        Ok(canonical)
    }

    /// Убирает папку из подтверждённых. true — что-то убрано. Пустая строка и неполный путь — Ok(false).
    /// keep — папки, которые остались в настройках: их записи не убираются, даже если это та же папка,
    /// записанная иначе (сетевой диск и UNC, subst, ссылка) — иначе отзыв прежней папки снимал бы
    /// подтверждение с только что выбранной.
    pub fn forget(&self, dir: &str, keep: &[String]) -> Result<bool, String> {
        let dir = dir.trim();
        if dir.is_empty() {
            return Ok(false);
        }
        let path = Path::new(dir);
        if !path.is_absolute() {
            return Ok(false);
        }
        let keep = keep_paths(keep);
        // Как в resolve: канонизация (в т.ч. недоступной сетевой папки) идёт по копии списка, без мьютекса.
        let canonical = dunce::canonicalize(path).ok();
        let snapshot = self.dirs.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let gone = forgotten_dirs(&snapshot, path, canonical.as_deref(), &keep, |d| dunce::canonicalize(d).ok());
        if gone.is_empty() {
            return Ok(false);
        }
        let mut dirs = self.dirs.lock().unwrap_or_else(|e| e.into_inner());
        let next: Vec<PathBuf> = dirs.iter().filter(|d| !gone.contains(d)).cloned().collect();
        self.replace(&mut dirs, next)
    }

    /// Оставляет только записи, точно равные папкам из keep (настройки приложения). Сверка при запуске:
    /// отзыв прежней папки одноразовый, и его сбой (или стёртые данные веб-слоя) иначе оставил бы папку
    /// открытой для записи навсегда. Записи не канонизируются: другая запись той же папки в настройках
    /// не значится, а значит, не нужна. true — что-то убрано.
    pub fn retain(&self, keep: &[String]) -> Result<bool, String> {
        let keep = keep_paths(keep);
        let mut dirs = self.dirs.lock().unwrap_or_else(|e| e.into_inner());
        let next: Vec<PathBuf> = dirs.iter().filter(|d| keep.contains(d)).cloned().collect();
        self.replace(&mut dirs, next)
    }

    /// Новый список вместо текущего, если он короче. Сначала файл, потом память: иначе забытая папка
    /// вернулась бы после перезапуска.
    fn replace(&self, dirs: &mut Vec<PathBuf>, next: Vec<PathBuf>) -> Result<bool, String> {
        if next.len() == dirs.len() {
            return Ok(false);
        }
        save_dirs(&self.file, &next).map_err(|e| format!("Не удалось забыть папку: {e}"))?;
        *dirs = next;
        Ok(true)
    }
}

/// Папки из настроек: пробелы по краям отброшены, пустые и неполные пути пропущены. Сравниваются с записями
/// точно: в настройках лежит та же строка, что вернул pick_directory, а approve хранит тот же путь.
fn keep_paths(keep: &[String]) -> Vec<PathBuf> {
    keep.iter()
        .map(|k| k.trim())
        .filter(|k| !k.is_empty())
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .collect()
}

/// Записи, которые убирает forget: равные запрошенному пути или его каноническому виду и записи с тем же
/// каноническим видом. canonical = None (папка недоступна, диск отключён) — только точное совпадение,
/// записи не канонизируются. Записи из keep не убираются и не канонизируются.
fn forgotten_dirs(
    dirs: &[PathBuf],
    requested: &Path,
    canonical: Option<&Path>,
    keep: &[PathBuf],
    canonicalize: impl Fn(&Path) -> Option<PathBuf>,
) -> Vec<PathBuf> {
    dirs.iter()
        .filter(|d| !keep.contains(d))
        .filter(|d| {
            d.as_path() == requested
                || canonical.is_some_and(|c| d.as_path() == c || canonicalize(d).is_some_and(|dc| dc == c))
        })
        .cloned()
        .collect()
}

/// Сначала точное совпадение пути (обычный случай: в настройках лежит строка из диалога), затем канонический
/// вид от новых записей к старым. resolve идёт на каждую часть и каждый файл экспорта: старая запись
/// о недоступном сетевом диске не должна каждый раз ждать тайм-аута.
fn is_approved(
    dirs: &[PathBuf],
    requested: &Path,
    canonical: &Path,
    canonicalize: impl Fn(&Path) -> Option<PathBuf>,
) -> bool {
    dirs.iter().any(|d| d == requested || d == canonical)
        || dirs.iter().rev().any(|d| canonicalize(d).is_some_and(|c| c == canonical))
}

fn save_dirs(file: &Path, dirs: &[PathBuf]) -> Result<(), String> {
    let list: Vec<&str> = dirs
        .iter()
        .map(|d| d.to_str().ok_or_else(|| "путь содержит недопустимые символы".to_string()))
        .collect::<Result<_, _>>()?;
    save_list(file, &list)
}

/// Атомарная запись JSON-массива строк (временный файл + rename).
fn save_list(file: &Path, list: &[&str]) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(list).map_err(|e| e.to_string())?;
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = with_suffix(file, ".tmp").ok_or_else(|| "некорректный путь файла настроек".to_string())?;
    let written = (|| -> io::Result<()> {
        let mut f = File::create(&tmp)?;
        f.write_all(&json)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, file)
    })();
    written.map_err(|e| {
        let _ = fs::remove_file(&tmp);
        e.to_string()
    })
}

/// Имена автокопий, начатых этой установкой. Обрезка удаляет только их: в общей облачной папке копии
/// другого компьютера с той же схемой имён иначе вытеснялись бы чужим `keep`. Хранится рядом со списком
/// папок, а не в настройках IndexedDB: импорт копии на другом компьютере перенёс бы список туда.
pub struct OwnBackups {
    file: PathBuf,
    names: Mutex<Vec<String>>,
}

impl OwnBackups {
    pub fn load(file: PathBuf) -> Self {
        let mut names: Vec<String> = fs::read(&file)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Vec<String>>(&bytes).ok())
            .unwrap_or_default()
            .into_iter()
            .filter(|n| is_backup_name(n))
            .collect();
        if names.len() > MAX_OWN_BACKUPS {
            names.drain(..names.len() - MAX_OWN_BACKUPS);
        }
        Self { file, names: Mutex::new(names) }
    }

    fn snapshot(&self) -> Vec<String> {
        self.names.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Вызывается до записи первой части: копия, не попавшая в список, и её остаток `.qdpart` после сбоя
    /// никогда не удалялись бы обрезкой.
    pub fn record(&self, name: &str) -> Result<(), String> {
        let mut names = self.names.lock().unwrap_or_else(|e| e.into_inner());
        if names.iter().any(|n| n == name) {
            return Ok(());
        }
        let mut next = names.clone();
        next.push(name.to_owned());
        if next.len() > MAX_OWN_BACKUPS {
            next.drain(..next.len() - MAX_OWN_BACKUPS);
        }
        save_list(&self.file, &next.iter().map(String::as_str).collect::<Vec<_>>())?;
        *names = next;
        Ok(())
    }

    fn forget(&self, gone: &[String]) -> Result<(), String> {
        let mut names = self.names.lock().unwrap_or_else(|e| e.into_inner());
        let next: Vec<String> = names.iter().filter(|n| !gone.contains(n)).cloned().collect();
        if next.len() == names.len() {
            return Ok(());
        }
        save_list(&self.file, &next.iter().map(String::as_str).collect::<Vec<_>>())?;
        *names = next;
        Ok(())
    }
}

/// Тот же путь с дописанным к имени файла суффиксом.
fn with_suffix(path: &Path, suffix: &str) -> Option<PathBuf> {
    let mut name = path.file_name()?.to_os_string();
    name.push(suffix);
    Some(path.with_file_name(name))
}

/// Ровно `quickdrop-backup-YYYYMMDD-HHMMSS.json`. Ручной экспорт (`quickdrop-backup-YYYY-MM-DD.json`)
/// под шаблон не подпадает, поэтому обрезка его не удалит.
fn is_backup_name(name: &str) -> bool {
    const PREFIX: &[u8] = b"quickdrop-backup-";
    const SUFFIX: &[u8] = b".json";
    let Some(rest) = name.as_bytes().strip_prefix(PREFIX) else {
        return false;
    };
    let Some(stamp) = rest.strip_suffix(SUFFIX) else {
        return false;
    };
    stamp.len() == 15
        && stamp[8] == b'-'
        && stamp[..8].iter().all(u8::is_ascii_digit)
        && stamp[9..].iter().all(u8::is_ascii_digit)
}

fn is_backup_part_name(name: &str) -> bool {
    name.strip_suffix(PART_SUFFIX).is_some_and(is_backup_name)
}

fn is_reserved_name(component: &str) -> bool {
    let stem = component.split('.').next().unwrap_or("").trim_matches(' ').to_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$") {
        return true;
    }
    ["COM", "LPT"].iter().any(|prefix| {
        stem.strip_prefix(prefix).is_some_and(|rest| {
            let mut chars = rest.chars();
            matches!((chars.next(), chars.next()), (Some('1'..='9' | '¹' | '²' | '³'), None))
        })
    })
}

fn is_safe_component(part: &str) -> bool {
    !(part.chars().any(|c| matches!(c, '<' | '>' | '"' | '|' | '?' | '*') || (c as u32) < 0x20)
        || part.ends_with('.')
        || part.ends_with(' ')
        || part.encode_utf16().count() > 255
        || part.to_lowercase().ends_with(PART_SUFFIX)
        || is_reserved_name(part))
}

/// Проверка относительного пути файла экспорта. Ничего не исправляет: очистка имён — обязанность веб-слоя.
fn safe_rel_path(rel: &str) -> Result<PathBuf, String> {
    let bad_path = || {
        // Слишком длинную строку в текст ошибки целиком не кладём.
        let shown: String = rel.chars().take(120).collect();
        let dots = if shown.len() < rel.len() { "…" } else { "" };
        format!("Недопустимый путь файла: {shown}{dots}")
    };
    if rel.is_empty() || rel.chars().count() > MAX_REL_PATH_CHARS {
        return Err(bad_path());
    }
    let normalized = rel.replace('\\', "/");
    // Двоеточие — это и буква диска, и альтернативный поток NTFS (file.txt:stream).
    if normalized.starts_with('/') || normalized.contains(':') {
        return Err(bad_path());
    }
    let parts: Vec<&str> = normalized.split('/').collect();
    if parts.len() > MAX_REL_DEPTH || parts.iter().any(|p| p.is_empty() || *p == "." || *p == "..") {
        return Err(bad_path());
    }
    let mut out = PathBuf::new();
    for part in parts {
        if !is_safe_component(part) {
            return Err(format!("Недопустимое имя файла: {part}"));
        }
        out.push(part);
    }
    Ok(out)
}

fn io_message(e: &io::Error, action: &str) -> String {
    match e.kind() {
        io::ErrorKind::NotFound => format!("{action}: папка или файл не найдены"),
        io::ErrorKind::PermissionDenied => {
            format!("{action}: нет доступа (папка защищена от записи или файл занят)")
        }
        io::ErrorKind::StorageFull => format!("{action}: на диске не осталось места"),
        _ => format!("{action}: {e}"),
    }
}

fn open_part(tmp: &Path, offset: u64, action: &str) -> Result<File, String> {
    let existing = fs::symlink_metadata(tmp);
    if offset == 0 {
        // Ссылка под именем временного файла увела бы запись за пределы папки.
        if existing.is_ok_and(|meta| !meta.is_file()) {
            return Err(format!("{action}: имя временного файла занято"));
        }
        return File::create(tmp).map_err(|e| io_message(&e, action));
    }
    match existing {
        Ok(meta) if meta.is_file() && meta.len() == offset => OpenOptions::new()
            .append(true)
            .open(tmp)
            .map_err(|e| io_message(&e, action)),
        Ok(_) => Err(BAD_ORDER.into()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Err(BAD_ORDER.into()),
        Err(e) => Err(io_message(&e, action)),
    }
}

fn write_chunk_as(
    target: &Path,
    offset: u64,
    bytes: &[u8],
    last: bool,
    max_total: u64,
    action: &str,
) -> Result<u64, String> {
    let tmp = with_suffix(target, PART_SUFFIX).ok_or_else(|| format!("{action}: некорректный путь файла"))?;
    let mut file = open_part(&tmp, offset, action)?;
    let total = match offset.checked_add(bytes.len() as u64) {
        Some(total) if total <= max_total => total,
        _ => {
            drop(file);
            let _ = fs::remove_file(&tmp);
            return Err(format!("Файл больше допустимого размера ({} МБ)", max_total / (1024 * 1024)));
        }
    };
    let mut result = file.write_all(bytes);
    if last && result.is_ok() {
        result = file.sync_all();
    }
    // В Windows открытый файл нельзя переименовать: закрываем до rename.
    drop(file);
    if last && result.is_ok() {
        result = fs::rename(&tmp, target);
    }
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(io_message(&e, action));
    }
    Ok(total)
}

/// Дописывает часть во временный файл `<имя>.qdpart`; на последней части заменяет им итоговый файл.
fn write_chunk(target: &Path, offset: u64, bytes: &[u8], last: bool, max_total: u64) -> Result<u64, String> {
    write_chunk_as(target, offset, bytes, last, max_total, ACTION_WRITE_FILE)
}

/// Автокопии (по имени по убыванию) и имена остатков прерванной записи. Только обычные файлы:
/// каталоги и ссылки с подходящими именами не учитываются.
fn scan(dir: &Path, action: &str) -> Result<(Vec<BackupEntry>, Vec<String>), String> {
    let mut entries = Vec::new();
    let mut parts = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| io_message(&e, action))?.flatten() {
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        let backup = is_backup_name(&name);
        if !backup && !is_backup_part_name(&name) {
            continue;
        }
        if !entry.file_type().is_ok_and(|t| t.is_file()) {
            continue;
        }
        if !backup {
            parts.push(name);
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        let modified_at = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as u64);
        entries.push(BackupEntry { name, size: meta.len(), modified_at });
    }
    entries.sort_by(|a, b| b.name.cmp(&a.name));
    Ok((entries, parts))
}

fn list_in(dir: &Path) -> Result<Vec<BackupEntry>, String> {
    scan(dir, ACTION_READ_DIR).map(|(entries, _)| entries)
}

/// Оставляет `keep` последних своих автокопий (`is_own`), чужие не трогает и не считает. `protect` —
/// только что записанная копия: она остаётся, даже если по имени не последняя (часы или пояс сдвинуты
/// назад), и занимает одно из `keep` мест. Свои остатки `.qdpart` тоже убирает, но в `removed` они не входят:
/// это удалённые копии.
fn prune_in(
    dir: &Path,
    keep: usize,
    protect: Option<&str>,
    is_own: impl Fn(&str) -> bool,
) -> Result<PruneResult, String> {
    if keep == 0 {
        return Err("Число хранимых копий должно быть не меньше 1".into());
    }
    let (entries, parts) = scan(dir, ACTION_PRUNE)?;
    let own: Vec<BackupEntry> = entries.into_iter().filter(|e| is_own(&e.name)).collect();
    let protected = protect.filter(|p| own.iter().any(|e| e.name == *p));
    let mut kept = usize::from(protected.is_some());
    let mut result = PruneResult { removed: Vec::new(), failed: Vec::new() };
    for entry in own {
        if Some(entry.name.as_str()) == protected {
            continue;
        }
        if kept < keep {
            kept += 1;
            continue;
        }
        match fs::remove_file(dir.join(&entry.name)) {
            Ok(()) => result.removed.push(entry.name),
            Err(_) => result.failed.push(entry.name),
        }
    }
    for name in parts {
        if !name.strip_suffix(PART_SUFFIX).is_some_and(&is_own) {
            continue;
        }
        if fs::remove_file(dir.join(&name)).is_err() {
            result.failed.push(name);
        }
    }
    Ok(result)
}

/// Убирает остаток `<файл>.qdpart` прерванной выгрузки экспорта. Каталогов не создаёт; `false` — остатка
/// не было. `base` — канонический путь подтверждённой папки.
fn discard_export_part_in(base: &Path, rel_path: &str) -> Result<bool, String> {
    let target = base.join(safe_rel_path(rel_path)?);
    let parent = target.parent().ok_or_else(|| OUTSIDE_EXPORT_DIR.to_string())?;
    match dunce::canonicalize(parent) {
        Ok(real) if real.starts_with(base) => {}
        Ok(_) => return Err(OUTSIDE_EXPORT_DIR.into()),
        // Каталога нет — нет и остатка.
        Err(_) => return Ok(false),
    }
    let tmp = with_suffix(&target, PART_SUFFIX)
        .ok_or_else(|| format!("{ACTION_DISCARD}: некорректный путь файла"))?;
    match fs::symlink_metadata(&tmp) {
        Ok(meta) if meta.is_file() => {
            fs::remove_file(&tmp).map(|()| true).map_err(|e| io_message(&e, ACTION_DISCARD))
        }
        _ => Ok(false),
    }
}

fn body_bytes(body: &InvokeBody) -> Result<Cow<'_, [u8]>, String> {
    const TOO_BIG: &str = "Слишком большая часть данных";
    const NOT_BINARY: &str = "Ожидались двоичные данные";
    match body {
        InvokeBody::Raw(bytes) if bytes.len() > MAX_CHUNK_BYTES => Err(TOO_BIG.into()),
        InvokeBody::Raw(bytes) => Ok(Cow::Borrowed(bytes.as_slice())),
        // Запасной канал postMessage: двоичное тело приходит JSON-массивом чисел.
        InvokeBody::Json(serde_json::Value::Array(items)) => {
            if items.len() > MAX_CHUNK_BYTES {
                return Err(TOO_BIG.into());
            }
            items
                .iter()
                .map(|v| v.as_u64().and_then(|n| u8::try_from(n).ok()))
                .collect::<Option<Vec<u8>>>()
                .map(Cow::Owned)
                .ok_or_else(|| NOT_BINARY.into())
        }
        InvokeBody::Json(_) => Err(NOT_BINARY.into()),
    }
}

fn header_args<T: DeserializeOwned>(headers: &tauri::http::HeaderMap) -> Result<T, String> {
    let raw = headers
        .get(ARGS_HEADER)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| BAD_ARGS.to_string())?;
    let json = percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .map_err(|_| BAD_ARGS.to_string())?;
    serde_json::from_str(&json).map_err(|_| BAD_ARGS.to_string())
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// Создаёт каталоги до файла экспорта и проверяет, что они остались внутри `base` (канонический путь).
fn prepare_export_parent(base: &Path, target: &Path) -> Result<(), String> {
    let inside = |p: &Path| dunce::canonicalize(p).is_ok_and(|c| c.starts_with(base));
    let parent = target.parent().ok_or_else(|| OUTSIDE_EXPORT_DIR.to_string())?;
    // Проверка до создания: ссылка или точка соединения внутри папки не должна увести
    // create_dir_all наружу.
    let mut existing = parent;
    while !existing.exists() {
        existing = existing.parent().ok_or_else(|| OUTSIDE_EXPORT_DIR.to_string())?;
    }
    if !inside(existing) {
        return Err(OUTSIDE_EXPORT_DIR.into());
    }
    fs::create_dir_all(parent).map_err(|e| io_message(&e, ACTION_WRITE_FILE))?;
    if !inside(parent) {
        return Err(OUTSIDE_EXPORT_DIR.into());
    }
    Ok(())
}

/// Полный путь файла экспорта внутри подтверждённой папки `base`; создаёт недостающие каталоги.
fn export_target(base: &Path, rel_path: &str) -> Result<PathBuf, String> {
    let target = base.join(safe_rel_path(rel_path)?);
    if target.to_string_lossy().encode_utf16().count() > MAX_FULL_PATH_UTF16 {
        return Err(
            "Слишком длинный путь к файлу: сократите название или выберите папку ближе к корню диска".into(),
        );
    }
    prepare_export_parent(base, &target)?;
    Ok(target)
}

/// Заголовок диалога — только из фиксированного набора: текст от веб-слоя в системном окне выбора папки
/// позволил бы внедрённому скрипту выдать свой вопрос за вопрос приложения.
fn dialog_title(purpose: Option<&str>) -> &'static str {
    match purpose {
        Some("backup") => "Папка для резервных копий",
        Some("export") => "Папка для экспорта Markdown",
        _ => "Выберите папку",
    }
}

/// Начальная папка диалога — только уже подтверждённая: иначе скрипт открыл бы диалог сразу
/// в «Автозагрузке», и для записи туда хватило бы одного нажатия.
fn dialog_start(approved: &ApprovedDirs, default_path: Option<&str>) -> Option<PathBuf> {
    default_path.and_then(|p| approved.resolve(p).ok())
}

#[tauri::command]
pub async fn pick_directory(
    window: tauri::WebviewWindow,
    approved: tauri::State<'_, ApprovedDirs>,
    purpose: Option<String>,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = window.dialog().file().set_title(dialog_title(purpose.as_deref()));
    #[cfg(desktop)]
    {
        dialog = dialog.set_parent(&window);
    }
    if let Some(start) = dialog_start(&approved, default_path.as_deref()) {
        dialog = dialog.set_directory(start);
    }
    let Some(picked) = dialog.blocking_pick_folder() else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| format!("Не удалось запомнить выбранную папку: {e}"))?;
    approved
        .approve(&path)
        .map_err(|e| format!("Не удалось запомнить выбранную папку: {e}"))?;
    Ok(Some(path_string(&path)))
}

/// Отзыв папки после смены настройки: прежняя папка больше не открыта для записи. keep — папки,
/// оставшиеся в настройках. Риска не добавляет: скрипт в веб-слое и так мог бы просто не вызывать отзыв.
#[tauri::command]
pub async fn forget_directory(
    dir: String,
    keep: Option<Vec<String>>,
    approved: tauri::State<'_, ApprovedDirs>,
) -> Result<bool, String> {
    approved.forget(&dir, &keep.unwrap_or_default())
}

/// Сверка при запуске: подтверждёнными остаются только папки из настроек. Команда может только убирать.
/// В отладочной сборке ничего не делает: у `tauri dev` свои настройки (другой адрес страницы — другая
/// IndexedDB), а список папок общий с установленным приложением, и сверка отзывала бы его папки.
#[tauri::command]
pub async fn retain_directories(
    keep: Vec<String>,
    approved: tauri::State<'_, ApprovedDirs>,
) -> Result<bool, String> {
    if cfg!(debug_assertions) {
        return Ok(false);
    }
    approved.retain(&keep)
}

const BAD_BACKUP_NAME: &str = "Недопустимое имя файла резервной копии";

#[tauri::command]
pub async fn save_backup(
    request: tauri::ipc::Request<'_>,
    approved: tauri::State<'_, ApprovedDirs>,
    own: tauri::State<'_, OwnBackups>,
) -> Result<SavedFile, String> {
    let args: SaveBackupArgs = header_args(request.headers())?;
    if !is_backup_name(&args.file_name) {
        return Err(BAD_BACKUP_NAME.into());
    }
    let bytes = body_bytes(request.body())?;
    let target = approved.resolve(&args.dir)?.join(&args.file_name);
    if args.offset == 0 {
        own.record(&args.file_name).map_err(|e| format!("{ACTION_SAVE_BACKUP}: {e}"))?;
    }
    let size = write_chunk_as(&target, args.offset, &bytes, args.last, MAX_BACKUP_BYTES, ACTION_SAVE_BACKUP)?;
    Ok(SavedFile { path: path_string(&target), size, done: args.last })
}

#[tauri::command]
pub async fn prune_backups(
    dir: String,
    keep: u32,
    protect: Option<String>,
    approved: tauri::State<'_, ApprovedDirs>,
    own: tauri::State<'_, OwnBackups>,
) -> Result<PruneResult, String> {
    if keep > MAX_KEEP {
        return Err("Слишком большое число копий".into());
    }
    if protect.as_deref().is_some_and(|p| !is_backup_name(p)) {
        return Err(BAD_BACKUP_NAME.into());
    }
    let names = own.snapshot();
    let result = prune_in(&approved.resolve(&dir)?, keep as usize, protect.as_deref(), |n| {
        names.iter().any(|known| known == n)
    })?;
    // Сбой записи списка обрезку не отменяет: лишнее имя в нём ничему не мешает.
    let _ = own.forget(&result.removed);
    Ok(result)
}

#[tauri::command]
pub async fn discard_export_part(
    dir: String,
    rel_path: String,
    approved: tauri::State<'_, ApprovedDirs>,
) -> Result<bool, String> {
    discard_export_part_in(&approved.resolve(&dir)?, &rel_path)
}

#[tauri::command]
pub async fn list_backups(
    dir: String,
    approved: tauri::State<'_, ApprovedDirs>,
) -> Result<Vec<BackupEntry>, String> {
    list_in(&approved.resolve(&dir)?)
}

#[tauri::command]
pub async fn write_export_file(
    request: tauri::ipc::Request<'_>,
    approved: tauri::State<'_, ApprovedDirs>,
) -> Result<SavedFile, String> {
    let args: WriteExportArgs = header_args(request.headers())?;
    let bytes = body_bytes(request.body())?;
    let base = approved.resolve(&args.dir)?;
    let target = export_target(&base, &args.rel_path)?;
    let size = write_chunk(&target, args.offset, &bytes, args.last, MAX_EXPORT_FILE_BYTES)?;
    Ok(SavedFile { path: path_string(&target), size, done: args.last })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    /// Временный каталог теста; удаляется при выходе из области видимости.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let n = COUNTER.fetch_add(1, Ordering::SeqCst);
            let path = std::env::temp_dir().join(format!("quickdrop-test-{name}-{}-{n}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).unwrap();
            // Канонический вид: temp_dir() в Windows бывает с коротким именем (USER~1).
            Self(dunce::canonicalize(&path).unwrap())
        }

        fn path(&self) -> &Path {
            &self.0
        }

        fn file(&self, name: &str, content: &[u8]) -> PathBuf {
            let p = self.0.join(name);
            fs::write(&p, content).unwrap();
            p
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut out: Vec<String> = fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().into_string().unwrap())
            .collect();
        out.sort();
        out
    }

    const NAME: &str = "quickdrop-backup-20261111-093005.json";

    #[test]
    fn backup_name_pattern() {
        assert!(is_backup_name(NAME));
        assert!(is_backup_name("quickdrop-backup-00000000-000000.json"));
        for bad in [
            "quickdrop-backup-2026-11-11.json", // ручной экспорт
            "Quickdrop-backup-20261111-093005.json",
            "quickdrop-backup-20261111-093005.JSON",
            "quickdrop-backup-20261111-093005.json.bak",
            "../quickdrop-backup-20261111-093005.json",
            "sub/quickdrop-backup-20261111-093005.json",
            "quickdrop-backup-２０２６1111-093005.json",
            "quickdrop-backup-2026111١-093005.json",
            "quickdrop-backup-20261111-093005 .json",
            " quickdrop-backup-20261111-093005.json",
            "quickdrop-backup-2026111-093005.json",
            "quickdrop-backup-202611111-093005.json",
            "quickdrop-backup-20261111-09300.json",
            "quickdrop-backup-20261111_093005.json",
            "quickdrop-backup-20261111-093005.json.qdpart",
            "",
        ] {
            assert!(!is_backup_name(bad), "{bad:?} не должно считаться автокопией");
        }
    }

    #[test]
    fn backup_part_name_pattern() {
        assert!(is_backup_part_name("quickdrop-backup-20261111-093005.json.qdpart"));
        assert!(!is_backup_part_name(NAME));
        assert!(!is_backup_part_name("notes.md.qdpart"));
        assert!(!is_backup_part_name("quickdrop-backup-2026-11-11.json.qdpart"));
    }

    #[test]
    fn rel_path_accepts_plain_paths() {
        assert_eq!(safe_rel_path("a/b.md").unwrap(), Path::new("a").join("b.md"));
        assert_eq!(
            safe_rel_path("заметки/файл 1.md").unwrap(),
            Path::new("заметки").join("файл 1.md")
        );
        assert_eq!(safe_rel_path("a\\b\\c.md").unwrap(), Path::new("a").join("b").join("c.md"));
        assert_eq!(safe_rel_path("x.md").unwrap(), PathBuf::from("x.md"));
        // похоже на зарезервированное, но им не является
        for ok in ["console.md", "com10.txt", "lpt.md", "nulls/x.md", "a.b.c", ".obsidian/x.md"] {
            assert!(safe_rel_path(ok).is_ok(), "{ok:?} должен проходить");
        }
        let deep = ["d"; MAX_REL_DEPTH].join("/");
        assert!(safe_rel_path(&deep).is_ok());
        assert!(safe_rel_path(&"я".repeat(200)).is_ok());
    }

    #[test]
    fn rel_path_rejects_structure() {
        let nine = ["d"; MAX_REL_DEPTH + 1].join("/");
        let long = format!("{}/{}", "a".repeat(200), "b".repeat(200));
        assert_eq!(long.chars().count(), 401);
        for bad in [
            "", "../x", "a/../b", "a/..", "..", "./x", "a/./b", "/x", "\\x", "\\\\server\\share\\x", "C:/x",
            "C:\\x", "c:x", "a:b", "x.md:stream", "a//b", "a/", nine.as_str(), long.as_str(),
        ] {
            let err = safe_rel_path(bad).unwrap_err();
            assert!(err.starts_with("Недопустимый путь файла"), "{bad:?}: {err}");
        }
    }

    #[test]
    fn rel_path_rejects_names() {
        let wide = "я".repeat(256);
        for bad in [
            "con.md", "CON", "Con.txt", "LPT1", "lpt9.md", "COM1.txt", "com¹", "LPT³.md", "prn", "aux.h",
            "nul.txt/x.md", "a/NUL", "con .md", "conin$", "CONOUT$.txt", "x.", "x ", "a./b.md", "a /b.md",
            "a<b", "a>b", "a\"b", "a|b", "a?b", "a*b", "a\u{1}b", "a\tb", "x.qdpart", "x.QdPart",
            "sub.qdpart/x.md", wide.as_str(),
        ] {
            let err = safe_rel_path(bad).unwrap_err();
            assert!(err.starts_with("Недопустимое имя файла"), "{bad:?}: {err}");
        }
    }

    #[test]
    fn write_chunk_single_part() {
        let dir = TempDir::new("chunk-single");
        let target = dir.path().join("a.json");
        assert_eq!(write_chunk(&target, 0, b"hello", true, 100).unwrap(), 5);
        assert_eq!(fs::read(&target).unwrap(), b"hello");
        assert_eq!(names(dir.path()), ["a.json"]);
    }

    #[test]
    fn write_chunk_empty_file() {
        let dir = TempDir::new("chunk-empty");
        let target = dir.path().join("empty.md");
        assert_eq!(write_chunk(&target, 0, b"", true, 100).unwrap(), 0);
        assert_eq!(fs::read(&target).unwrap(), b"");
        assert_eq!(names(dir.path()), ["empty.md"]);
    }

    #[test]
    fn write_chunk_three_parts() {
        let dir = TempDir::new("chunk-three");
        let target = dir.path().join("a.json");
        assert_eq!(write_chunk(&target, 0, b"ab", false, 100).unwrap(), 2);
        // до последней части итогового файла нет
        assert_eq!(names(dir.path()), ["a.json.qdpart"]);
        assert_eq!(write_chunk(&target, 2, b"cd", false, 100).unwrap(), 4);
        assert_eq!(write_chunk(&target, 4, b"e", true, 100).unwrap(), 5);
        assert_eq!(fs::read(&target).unwrap(), b"abcde");
        assert_eq!(names(dir.path()), ["a.json"]);
    }

    #[test]
    fn write_chunk_rejects_wrong_offset() {
        let dir = TempDir::new("chunk-offset");
        let target = dir.path().join("a.json");
        write_chunk(&target, 0, b"abc", false, 100).unwrap();
        assert_eq!(write_chunk(&target, 2, b"x", true, 100).unwrap_err(), BAD_ORDER);
        assert_eq!(write_chunk(&target, 4, b"x", true, 100).unwrap_err(), BAD_ORDER);
        assert!(!target.exists());
        // верное продолжение после отказа проходит
        assert_eq!(write_chunk(&target, 3, b"d", true, 100).unwrap(), 4);
        assert_eq!(fs::read(&target).unwrap(), b"abcd");
    }

    #[test]
    fn write_chunk_rejects_part_without_start() {
        let dir = TempDir::new("chunk-nostart");
        let target = dir.path().join("a.json");
        assert_eq!(write_chunk(&target, 5, b"x", true, 100).unwrap_err(), BAD_ORDER);
        assert!(names(dir.path()).is_empty());
    }

    #[test]
    fn write_chunk_restart_truncates_leftover() {
        let dir = TempDir::new("chunk-restart");
        let target = dir.path().join("a.json");
        write_chunk(&target, 0, b"old-old-old", false, 100).unwrap();
        assert_eq!(write_chunk(&target, 0, b"new", true, 100).unwrap(), 3);
        assert_eq!(fs::read(&target).unwrap(), b"new");
    }

    #[test]
    fn write_chunk_enforces_limit() {
        let dir = TempDir::new("chunk-limit");
        let target = dir.path().join("a.json");
        dir.file("a.json", b"previous");
        write_chunk(&target, 0, b"12345", false, 8).unwrap();
        let err = write_chunk(&target, 5, b"6789", true, 8).unwrap_err();
        assert!(err.starts_with("Файл больше допустимого размера"), "{err}");
        // временный файл удалён, прежний итоговый цел
        assert_eq!(names(dir.path()), ["a.json"]);
        assert_eq!(fs::read(&target).unwrap(), b"previous");

        let err = write_chunk(&target, 0, b"123456789", true, 8).unwrap_err();
        assert!(err.starts_with("Файл больше допустимого размера"), "{err}");
        assert_eq!(names(dir.path()), ["a.json"]);
        assert_eq!(write_chunk(&target, 0, b"12345678", true, 8).unwrap(), 8);
        assert!(write_chunk(&target, u64::MAX, b"1", true, u64::MAX).is_err());
    }

    #[test]
    fn write_chunk_overwrites_existing() {
        let dir = TempDir::new("chunk-overwrite");
        let target = dir.file("a.json", b"old content that is longer");
        write_chunk(&target, 0, b"ne", false, 100).unwrap();
        // пока запись не завершена, прежний файл цел
        assert_eq!(fs::read(&target).unwrap(), b"old content that is longer");
        write_chunk(&target, 2, b"w", true, 100).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new");
        assert_eq!(names(dir.path()), ["a.json"]);
    }

    #[test]
    fn write_chunk_failed_rename_removes_part() {
        let dir = TempDir::new("chunk-rename");
        let target = dir.path().join("taken");
        fs::create_dir(&target).unwrap();
        dir.file("taken/inner.txt", b"x");
        assert!(write_chunk(&target, 0, b"data", true, 100).is_err());
        assert_eq!(names(dir.path()), ["taken"]);
        assert!(target.is_dir());
    }

    #[test]
    fn write_chunk_refuses_directory_as_part() {
        let dir = TempDir::new("chunk-partdir");
        let target = dir.path().join("a.json");
        fs::create_dir(dir.path().join("a.json.qdpart")).unwrap();
        assert!(write_chunk(&target, 0, b"data", true, 100).is_err());
        assert_eq!(write_chunk(&target, 4, b"data", true, 100).unwrap_err(), BAD_ORDER);
        assert!(!target.exists());
    }

    fn backup_name(day: u32) -> String {
        format!("quickdrop-backup-202611{day:02}-120000.json")
    }

    #[test]
    fn list_orders_newest_first() {
        let dir = TempDir::new("list");
        dir.file(&backup_name(3), b"333");
        dir.file(&backup_name(11), b"1");
        dir.file(&backup_name(7), b"55555");
        dir.file("quickdrop-backup-2026-11-11.json", b"manual");
        dir.file("notes.txt", b"x");
        dir.file(&format!("{}.qdpart", backup_name(12)), b"part");
        fs::create_dir(dir.path().join(backup_name(20))).unwrap();

        let list = list_in(dir.path()).unwrap();
        let got: Vec<(&str, u64)> = list.iter().map(|e| (e.name.as_str(), e.size)).collect();
        assert_eq!(
            got,
            [(backup_name(11).as_str(), 1), (backup_name(7).as_str(), 5), (backup_name(3).as_str(), 3)]
        );
        assert!(list.iter().all(|e| e.modified_at > 1_600_000_000_000));
    }

    #[test]
    fn list_missing_dir_is_error() {
        let dir = TempDir::new("list-missing");
        let err = list_in(&dir.path().join("нет")).err().unwrap();
        assert!(err.starts_with(ACTION_READ_DIR), "{err}");
    }

    #[test]
    fn prune_keeps_latest_and_spares_other_files() {
        let dir = TempDir::new("prune");
        for day in 1..=5 {
            dir.file(&backup_name(day), b"x");
        }
        dir.file("quickdrop-backup-2026-11-11.json", b"manual");
        dir.file("notes.txt", b"x");
        dir.file("quickdrop-backup-20261101-120000.json.bak", b"x");
        dir.file("Quickdrop-Backup-20261101-120000.txt", b"x");
        dir.file(&format!("{}.qdpart", backup_name(9)), b"part");
        dir.file("export.md.qdpart", b"foreign part");
        let old_dir = dir.path().join("quickdrop-backup-20200101-000000.json");
        fs::create_dir(&old_dir).unwrap();
        fs::write(old_dir.join("keep.txt"), b"x").unwrap();

        let result = prune_in(dir.path(), 2, None, |_| true).unwrap();
        assert_eq!(result.removed, [backup_name(3), backup_name(2), backup_name(1)]);
        assert!(result.failed.is_empty());
        assert_eq!(
            names(dir.path()),
            [
                "Quickdrop-Backup-20261101-120000.txt".to_string(),
                "export.md.qdpart".into(),
                "notes.txt".into(),
                "quickdrop-backup-20200101-000000.json".into(),
                "quickdrop-backup-2026-11-11.json".into(),
                "quickdrop-backup-20261101-120000.json.bak".into(),
                backup_name(4),
                backup_name(5),
            ]
        );
        assert!(old_dir.join("keep.txt").exists());

        // повторный вызов и запас по числу ничего не удаляют
        assert!(prune_in(dir.path(), 2, None, |_| true).unwrap().removed.is_empty());
        assert!(prune_in(dir.path(), 50, None, |_| true).unwrap().removed.is_empty());
        assert_eq!(list_in(dir.path()).unwrap().len(), 2);
    }

    #[test]
    fn prune_requires_positive_keep() {
        let dir = TempDir::new("prune-zero");
        dir.file(&backup_name(1), b"x");
        assert_eq!(
            prune_in(dir.path(), 0, None, |_| true).err().unwrap(),
            "Число хранимых копий должно быть не меньше 1"
        );
        assert_eq!(names(dir.path()), [backup_name(1)]);
    }

    #[test]
    fn prune_keeps_new_copy_with_older_stamp() {
        // keep 1: часы перевели назад, новая копия по имени старше прежней
        let dir = TempDir::new("prune-protect-1");
        let late = "quickdrop-backup-20261112-200000.json";
        let fresh = "quickdrop-backup-20261112-150000.json";
        dir.file(late, b"old");
        dir.file(fresh, b"new");
        let result = prune_in(dir.path(), 1, Some(fresh), |_| true).unwrap();
        assert_eq!(result.removed, [late]);
        assert_eq!(names(dir.path()), [fresh]);

        // keep 3: новая копия и две последние по имени
        let dir = TempDir::new("prune-protect-3");
        for day in 2..=5 {
            dir.file(&backup_name(day), b"x");
        }
        let result = prune_in(dir.path(), 3, Some(&backup_name(2)), |_| true).unwrap();
        assert_eq!(result.removed, [backup_name(3)]);
        assert_eq!(names(dir.path()), [backup_name(2), backup_name(4), backup_name(5)]);

        // защищённой копии в папке нет — остаются keep последних
        let result = prune_in(dir.path(), 2, Some(&backup_name(9)), |_| true).unwrap();
        assert_eq!(result.removed, [backup_name(2)]);
    }

    #[test]
    fn prune_spares_foreign_copies_and_parts() {
        let dir = TempDir::new("prune-foreign");
        // копия ноутбука в общей папке и три копии этого компьютера
        let laptop = "quickdrop-backup-20261101-090000.json";
        dir.file(laptop, b"laptop");
        for day in 2..=4 {
            dir.file(&backup_name(day), b"desk");
        }
        let foreign = backup_name(20);
        let foreign_part = format!("{foreign}.qdpart");
        let own_part = format!("{}.qdpart", backup_name(21));
        dir.file(&foreign_part, b"p");
        dir.file(&own_part, b"p");

        let result = prune_in(dir.path(), 2, None, |n: &str| n != laptop && n != foreign).unwrap();
        assert_eq!(result.removed, [backup_name(2)]);
        assert!(result.failed.is_empty());
        let mut expected = vec![laptop.to_string(), backup_name(3), backup_name(4), foreign_part];
        expected.sort();
        assert_eq!(names(dir.path()), expected);

        // keep 1 при одной своей копии — чужие не вытесняют её и не удаляются
        let result = prune_in(dir.path(), 1, None, |n: &str| n == backup_name(4)).unwrap();
        assert!(result.removed.is_empty());
        assert!(dir.path().join(laptop).exists());
    }

    #[test]
    fn own_backups_record_persist_forget() {
        let cfg = TempDir::new("own-cfg");
        let file = cfg.path().join("nested").join("own-backups.json");
        let own = OwnBackups::load(file.clone());
        own.record(NAME).unwrap();
        own.record(NAME).unwrap();
        own.record(&backup_name(1)).unwrap();
        assert_eq!(own.snapshot(), [NAME.to_string(), backup_name(1)]);

        let reloaded = OwnBackups::load(file.clone());
        assert_eq!(reloaded.snapshot(), [NAME.to_string(), backup_name(1)]);
        reloaded.forget(&[NAME.to_string(), backup_name(5)]).unwrap();
        assert_eq!(OwnBackups::load(file).snapshot(), [backup_name(1)]);
    }

    #[test]
    fn own_backups_bad_file_and_cap() {
        let cfg = TempDir::new("own-bad");
        for content in [&b"{ not json"[..], b"[1,2]", b""] {
            let file = cfg.file("own-backups.json", content);
            assert!(OwnBackups::load(file).snapshot().is_empty());
        }
        let file = cfg.file(
            "own-backups.json",
            br#"["../x.json", "quickdrop-backup-20261111-093005.json", "notes.txt"]"#,
        );
        assert_eq!(OwnBackups::load(file).snapshot(), [NAME]);

        let many: Vec<String> =
            (0..MAX_OWN_BACKUPS + 3).map(|i| format!("quickdrop-backup-{i:08}-000000.json")).collect();
        let file = cfg.path().join("many.json");
        fs::write(&file, serde_json::to_vec(&many).unwrap()).unwrap();
        let own = OwnBackups::load(file);
        let names = own.snapshot();
        assert_eq!(names.len(), MAX_OWN_BACKUPS);
        assert_eq!(names[0], many[3]);
        own.record("quickdrop-backup-99999999-000000.json").unwrap();
        let names = own.snapshot();
        assert_eq!(names.len(), MAX_OWN_BACKUPS);
        assert_eq!(names[0], many[4]);
    }

    #[test]
    fn own_backups_record_failure_keeps_list() {
        let cfg = TempDir::new("own-fail");
        let file = cfg.path().join("own-backups.json");
        fs::create_dir(&file).unwrap();
        fs::write(file.join("x"), b"x").unwrap();
        let own = OwnBackups::load(file);
        assert!(own.record(NAME).is_err());
        assert!(own.snapshot().is_empty());
    }

    #[test]
    fn is_approved_checks_exact_match_first_and_newest_first() {
        use std::cell::RefCell;
        let old = PathBuf::from("N:/старая");
        let mid = PathBuf::from("D:/mid");
        let current = PathBuf::from("D:/current");
        let dirs = vec![old.clone(), mid.clone(), current.clone()];
        let seen = RefCell::new(Vec::<PathBuf>::new());
        // старая запись недоступна, mid — ссылка на D:/real-mid
        let canon = |d: &Path| {
            seen.borrow_mut().push(d.to_path_buf());
            if d == old.as_path() {
                None
            } else if d == mid.as_path() {
                Some(PathBuf::from("D:/real-mid"))
            } else {
                Some(d.to_path_buf())
            }
        };

        assert!(is_approved(&dirs, &current, &current, &canon));
        assert!(is_approved(&dirs, Path::new("D:/x/../current"), &current, &canon));
        assert!(seen.borrow().is_empty(), "точное совпадение — без канонизации записей");

        assert!(is_approved(&dirs, Path::new("D:/other"), Path::new("D:/real-mid"), &canon));
        assert_eq!(*seen.borrow(), [current.clone(), mid.clone()]);

        seen.borrow_mut().clear();
        assert!(!is_approved(&dirs, Path::new("D:/zzz"), Path::new("D:/zzz"), &canon));
        assert_eq!(*seen.borrow(), [current, mid, old]);
    }

    #[test]
    fn dialog_title_is_fixed() {
        assert_eq!(dialog_title(Some("backup")), "Папка для резервных копий");
        assert_eq!(dialog_title(Some("export")), "Папка для экспорта Markdown");
        for other in [None, Some(""), Some("Подтвердите папку QuickDrop"), Some("Backup")] {
            assert_eq!(dialog_title(other), "Выберите папку");
        }
    }

    #[test]
    fn dialog_start_only_from_approved() {
        let cfg = TempDir::new("start-cfg");
        let data = TempDir::new("start-data");
        let other = TempDir::new("start-other");
        let approved = ApprovedDirs::load(cfg.path().join("approved-dirs.json"));
        approved.approve(data.path()).unwrap();
        assert_eq!(dialog_start(&approved, Some(&path_string(data.path()))), Some(data.path().to_path_buf()));
        assert_eq!(dialog_start(&approved, Some(&path_string(other.path()))), None);
        assert_eq!(dialog_start(&approved, Some("")), None);
        assert_eq!(dialog_start(&approved, None), None);
    }

    #[test]
    fn discard_export_part_removes_leftover_only() {
        let dir = TempDir::new("discard");
        let target = export_target(dir.path(), "заметки/видео.mp4").unwrap();
        write_chunk(&target, 0, b"half", false, 100).unwrap();
        assert_eq!(names(&dir.path().join("заметки")), ["видео.mp4.qdpart"]);
        assert!(discard_export_part_in(dir.path(), "заметки/видео.mp4").unwrap());
        assert!(names(&dir.path().join("заметки")).is_empty());
        assert!(!discard_export_part_in(dir.path(), "заметки/видео.mp4").unwrap());

        // готовый файл не трогается
        dir.file("готово.md", b"x");
        assert!(!discard_export_part_in(dir.path(), "готово.md").unwrap());
        assert_eq!(fs::read(dir.path().join("готово.md")).unwrap(), b"x");

        // каталоги не создаются, недопустимые пути отклоняются
        assert!(!discard_export_part_in(dir.path(), "нет/x.md").unwrap());
        assert!(!dir.path().join("нет").exists());
        assert!(discard_export_part_in(dir.path(), "../x.md").is_err());
        assert!(discard_export_part_in(dir.path(), "x.md.qdpart").is_err());

        // каталог под именем остатка не удаляется
        fs::create_dir(dir.path().join("d.md.qdpart")).unwrap();
        assert!(!discard_export_part_in(dir.path(), "d.md").unwrap());
        assert!(dir.path().join("d.md.qdpart").is_dir());
    }

    #[test]
    fn approved_dirs_approve_and_resolve() {
        let cfg = TempDir::new("approved-cfg");
        let data = TempDir::new("approved папка с пробелом");
        let other = TempDir::new("approved-other");
        let approved = ApprovedDirs::load(cfg.path().join("nested").join("approved-dirs.json"));

        let unapproved = approved.resolve(&path_string(data.path())).unwrap_err();
        assert!(unapproved.starts_with("Папка не подтверждена"), "{unapproved}");

        approved.approve(data.path()).unwrap();
        assert_eq!(approved.resolve(&path_string(data.path())).unwrap(), data.path());
        assert_eq!(
            approved.resolve(&format!("  {}  ", path_string(data.path()))).unwrap(),
            data.path()
        );
        // путь с «..» ведёт в ту же папку — сравнение идёт по каноническому виду
        let roundabout = data.path().join("..").join(data.path().file_name().unwrap());
        assert_eq!(approved.resolve(&path_string(&roundabout)).unwrap(), data.path());

        assert!(approved.resolve(&path_string(other.path())).unwrap_err().starts_with("Папка не подтверждена"));
        // подпапка и родитель подтверждённой папки подтверждёнными не считаются
        let sub = data.path().join("sub");
        fs::create_dir(&sub).unwrap();
        assert!(approved.resolve(&path_string(&sub)).unwrap_err().starts_with("Папка не подтверждена"));
        let parent = data.path().parent().unwrap();
        assert!(approved.resolve(&path_string(parent)).unwrap_err().starts_with("Папка не подтверждена"));
    }

    #[test]
    fn approved_dirs_reject_bad_input() {
        let cfg = TempDir::new("approved-bad-cfg");
        let data = TempDir::new("approved-bad");
        let approved = ApprovedDirs::load(cfg.path().join("approved-dirs.json"));
        approved.approve(data.path()).unwrap();

        assert_eq!(approved.resolve("").unwrap_err(), "Папка не выбрана");
        assert_eq!(approved.resolve("   ").unwrap_err(), "Папка не выбрана");
        assert_eq!(approved.resolve("backups").unwrap_err(), "Укажите полный путь к папке");
        assert_eq!(approved.resolve("./backups").unwrap_err(), "Укажите полный путь к папке");
        let missing = data.path().join("missing");
        assert!(approved.resolve(&path_string(&missing)).unwrap_err().starts_with("Папка не найдена"));
        let file = data.file("file.txt", b"x");
        assert!(approved.resolve(&path_string(&file)).unwrap_err().starts_with("Это не папка"));
        assert!(approved.approve(Path::new("relative")).is_err());
    }

    #[test]
    fn approved_dirs_persist_and_reload() {
        let cfg = TempDir::new("approved-reload-cfg");
        let data = TempDir::new("approved-reload");
        let file = cfg.path().join("approved-dirs.json");
        let approved = ApprovedDirs::load(file.clone());
        approved.approve(data.path()).unwrap();
        approved.approve(data.path()).unwrap();

        let stored: Vec<String> = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        assert_eq!(stored, [path_string(data.path())]);
        assert_eq!(names(cfg.path()), ["approved-dirs.json"]);

        let reloaded = ApprovedDirs::load(file);
        assert_eq!(reloaded.resolve(&path_string(data.path())).unwrap(), data.path());
    }

    #[test]
    fn approved_dirs_evict_oldest() {
        let cfg = TempDir::new("approved-evict-cfg");
        let root = TempDir::new("approved-evict");
        let file = cfg.path().join("approved-dirs.json");
        let approved = ApprovedDirs::load(file.clone());
        let dirs: Vec<PathBuf> = (0..MAX_APPROVED_DIRS + 2)
            .map(|i| {
                let d = root.path().join(format!("d{i}"));
                fs::create_dir(&d).unwrap();
                d
            })
            .collect();
        for d in &dirs {
            approved.approve(d).unwrap();
        }
        let stored: Vec<String> = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        assert_eq!(stored.len(), MAX_APPROVED_DIRS);
        assert!(approved.resolve(&path_string(&dirs[0])).is_err());
        assert!(approved.resolve(&path_string(&dirs[1])).is_err());
        assert!(approved.resolve(&path_string(&dirs[2])).is_ok());
        assert!(approved.resolve(&path_string(dirs.last().unwrap())).is_ok());

        // повторное подтверждение переносит папку в конец очереди
        approved.approve(&dirs[2]).unwrap();
        let extra = root.path().join("extra");
        fs::create_dir(&extra).unwrap();
        approved.approve(&extra).unwrap();
        assert!(approved.resolve(&path_string(&dirs[2])).is_ok());
        assert!(approved.resolve(&path_string(&dirs[3])).is_err());
    }

    #[test]
    fn approved_dirs_skip_unavailable_entries() {
        let cfg = TempDir::new("approved-gone-cfg");
        let root = TempDir::new("approved-gone");
        let file = cfg.path().join("approved-dirs.json");
        let gone = root.path().join("gone");
        let live = root.path().join("live");
        fs::create_dir(&gone).unwrap();
        fs::create_dir(&live).unwrap();
        let approved = ApprovedDirs::load(file.clone());
        approved.approve(&gone).unwrap();
        fs::remove_dir(&gone).unwrap();
        approved.approve(&live).unwrap();

        assert!(approved.resolve(&path_string(&live)).is_ok());
        // отключённая папка остаётся в файле и снова действует, когда появится
        let stored: Vec<String> = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        assert_eq!(stored, [path_string(&gone), path_string(&live)]);
        fs::create_dir(&gone).unwrap();
        assert!(approved.resolve(&path_string(&gone)).is_ok());
    }

    #[test]
    fn approved_dirs_broken_file_is_empty() {
        let cfg = TempDir::new("approved-broken-cfg");
        let data = TempDir::new("approved-broken");
        for content in [&b"{ not json"[..], b"{\"dirs\":[]}", b"[1,2]", b""] {
            let file = cfg.file("approved-dirs.json", content);
            let approved = ApprovedDirs::load(file);
            assert!(approved.dirs.lock().unwrap().is_empty());
            assert!(approved.resolve(&path_string(data.path())).is_err());
        }
        let approved = ApprovedDirs::load(cfg.path().join("absent.json"));
        assert!(approved.dirs.lock().unwrap().is_empty());
        // относительные записи из файла не принимаются
        let file = cfg.file("approved-dirs.json", b"[\"relative\\\\dir\", \".\"]");
        assert!(ApprovedDirs::load(file).dirs.lock().unwrap().is_empty());
    }

    #[test]
    fn approve_failure_keeps_list_unchanged() {
        let cfg = TempDir::new("approved-fail-cfg");
        let data = TempDir::new("approved-fail");
        // файл списка нельзя создать: на его месте каталог
        let file = cfg.path().join("approved-dirs.json");
        fs::create_dir(&file).unwrap();
        fs::write(file.join("x"), b"x").unwrap();
        let approved = ApprovedDirs::load(file);
        assert!(approved.approve(data.path()).is_err());
        assert!(approved.resolve(&path_string(data.path())).is_err());
    }

    /// Список подтверждённых папок в файле — то, что увидит следующий запуск.
    fn stored_dirs(file: &Path) -> Vec<String> {
        serde_json::from_slice(&fs::read(file).unwrap()).unwrap()
    }

    fn assert_unapproved(approved: &ApprovedDirs, dir: &Path) {
        let err = approved.resolve(&path_string(dir)).unwrap_err();
        assert!(err.starts_with("Папка не подтверждена"), "{}: {err}", dir.display());
    }

    #[test]
    fn forget_removes_exact_and_roundabout_path() {
        let cfg = TempDir::new("forget-cfg");
        let a = TempDir::new("forget-a");
        let b = TempDir::new("forget-b папка");
        let keep = TempDir::new("forget-keep");
        let file = cfg.path().join("approved-dirs.json");
        let approved = ApprovedDirs::load(file.clone());
        for d in [a.path(), keep.path(), b.path()] {
            approved.approve(d).unwrap();
        }

        // точная строка (пробелы по краям отбрасываются)
        assert_eq!(approved.forget(&format!("  {}  ", path_string(a.path())), &[]), Ok(true));
        assert_unapproved(&approved, a.path());

        // путь с «..» к той же папке — по каноническому виду
        let roundabout = b.path().join("..").join(b.path().file_name().unwrap());
        assert_eq!(approved.forget(&path_string(&roundabout), &[]), Ok(true));
        assert_unapproved(&approved, b.path());

        // остальные записи целы, и после перезагрузки списка тоже
        assert_eq!(approved.resolve(&path_string(keep.path())).unwrap(), keep.path());
        assert_eq!(stored_dirs(&file), [path_string(keep.path())]);
        let reloaded = ApprovedDirs::load(file);
        assert_unapproved(&reloaded, a.path());
        assert_unapproved(&reloaded, b.path());
        assert_eq!(reloaded.resolve(&path_string(keep.path())).unwrap(), keep.path());

        // повторный отзыв — убирать нечего
        assert_eq!(approved.forget(&path_string(a.path()), &[]), Ok(false));
    }

    #[test]
    fn forget_unknown_dir_leaves_file_untouched() {
        let cfg = TempDir::new("forget-unknown-cfg");
        let data = TempDir::new("forget-unknown");
        let other = TempDir::new("forget-unknown-other");
        let file = cfg.path().join("approved-dirs.json");
        let approved = ApprovedDirs::load(file.clone());
        approved.approve(data.path()).unwrap();
        // Метка: список записывается с отступами, перезапись файла её стёрла бы.
        let marker = serde_json::to_vec(&[path_string(data.path())]).unwrap();
        fs::write(&file, &marker).unwrap();

        assert_eq!(approved.forget(&path_string(other.path()), &[]), Ok(false));
        assert_eq!(approved.forget(&path_string(&other.path().join("нет")), &[]), Ok(false));
        // подпапка и родитель подтверждённой папки — другие папки
        let sub = data.path().join("sub");
        fs::create_dir(&sub).unwrap();
        assert_eq!(approved.forget(&path_string(&sub), &[]), Ok(false));
        assert_eq!(approved.forget(&path_string(data.path().parent().unwrap()), &[]), Ok(false));

        assert_eq!(fs::read(&file).unwrap(), marker);
        assert_eq!(names(cfg.path()), ["approved-dirs.json"]);
        assert_eq!(approved.resolve(&path_string(data.path())).unwrap(), data.path());
    }

    #[test]
    fn forget_ignores_empty_and_relative() {
        let cfg = TempDir::new("forget-bad-cfg");
        let data = TempDir::new("forget-bad");
        let file = cfg.path().join("approved-dirs.json");
        let approved = ApprovedDirs::load(file.clone());
        approved.approve(data.path()).unwrap();
        let before = fs::read(&file).unwrap();

        let own_name = data.path().file_name().unwrap().to_str().unwrap().to_string();
        for bad in ["", "   ", "\t\n", "backups", "./backups", "..", own_name.as_str()] {
            assert_eq!(approved.forget(bad, &[]), Ok(false), "{bad:?}");
        }
        assert_eq!(fs::read(&file).unwrap(), before);
        assert_eq!(approved.resolve(&path_string(data.path())).unwrap(), data.path());
    }

    #[test]
    fn forget_unavailable_dir_by_exact_string() {
        let cfg = TempDir::new("forget-gone-cfg");
        let root = TempDir::new("forget-gone");
        let file = cfg.path().join("approved-dirs.json");
        let gone = root.path().join("gone");
        let live = root.path().join("live");
        fs::create_dir(&gone).unwrap();
        fs::create_dir(&live).unwrap();
        let approved = ApprovedDirs::load(file.clone());
        approved.approve(&gone).unwrap();
        approved.approve(&live).unwrap();
        // диск отключён
        fs::remove_dir(&gone).unwrap();

        // канонического вида нет — обходной путь к той же папке не совпадает
        let roundabout = gone.join("..").join("gone");
        assert_eq!(approved.forget(&path_string(&roundabout), &[]), Ok(false));
        assert_eq!(stored_dirs(&file), [path_string(&gone), path_string(&live)]);

        assert_eq!(approved.forget(&path_string(&gone), &[]), Ok(true));
        assert_eq!(stored_dirs(&file), [path_string(&live)]);
        // диск подключили снова — подтверждения уже нет
        fs::create_dir(&gone).unwrap();
        assert_unapproved(&approved, &gone);
        assert!(approved.resolve(&path_string(&live)).is_ok());
    }

    #[test]
    fn forget_failure_keeps_list_unchanged() {
        let cfg = TempDir::new("forget-fail-cfg");
        let data = TempDir::new("forget-fail");
        let file = cfg.path().join("approved-dirs.json");
        let approved = ApprovedDirs::load(file.clone());
        approved.approve(data.path()).unwrap();
        // файл списка нельзя заменить: на его месте каталог
        fs::remove_file(&file).unwrap();
        fs::create_dir(&file).unwrap();
        fs::write(file.join("x"), b"x").unwrap();

        let err = approved.forget(&path_string(data.path()), &[]).unwrap_err();
        assert!(err.starts_with("Не удалось забыть папку: "), "{err}");
        assert_eq!(approved.resolve(&path_string(data.path())).unwrap(), data.path());
        // временный файл убран
        assert_eq!(names(cfg.path()), ["approved-dirs.json"]);
    }

    #[test]
    fn forgotten_dirs_exact_then_canonical() {
        use std::cell::RefCell;
        let offline = PathBuf::from("N:/сеть");
        let exact = PathBuf::from("D:/копии");
        let real = PathBuf::from("D:/real");
        let link = PathBuf::from("D:/link");
        let other = PathBuf::from("D:/other");
        let dirs = vec![offline.clone(), exact.clone(), real.clone(), link.clone(), other.clone()];
        let seen = RefCell::new(Vec::<PathBuf>::new());
        // «D:/копии» и «D:/link» — ссылки на D:/real, сетевая запись недоступна
        let canon = |d: &Path| {
            seen.borrow_mut().push(d.to_path_buf());
            if d == offline.as_path() {
                None
            } else if d == exact.as_path() || d == link.as_path() {
                Some(real.clone())
            } else {
                Some(d.to_path_buf())
            }
        };

        assert_eq!(
            forgotten_dirs(&dirs, &exact, Some(real.as_path()), &[], &canon),
            [exact.clone(), real.clone(), link.clone()]
        );
        // совпавшие точно записи не канонизируются
        assert_eq!(*seen.borrow(), [offline.clone(), link.clone(), other.clone()]);

        // запрошенная папка недоступна — только точное совпадение, записи не канонизируются
        seen.borrow_mut().clear();
        assert_eq!(forgotten_dirs(&dirs, &offline, None, &[], &canon), [offline.clone()]);
        assert!(forgotten_dirs(&dirs, Path::new("D:/x/../real"), None, &[], &canon).is_empty());
        assert!(seen.borrow().is_empty());

        assert!(forgotten_dirs(&dirs, Path::new("D:/zzz"), Some(Path::new("D:/zzz")), &[], &canon).is_empty());

        // папка из настроек не убирается и не канонизируется, даже если это та же папка
        seen.borrow_mut().clear();
        assert_eq!(
            forgotten_dirs(&dirs, &exact, Some(real.as_path()), &[link.clone()], &canon),
            [exact.clone(), real.clone()]
        );
        assert_eq!(*seen.borrow(), [offline.clone(), other.clone()]);
        // запрошенная папка сама в keep — её точная запись остаётся
        assert_eq!(
            forgotten_dirs(&dirs, &exact, Some(real.as_path()), &[exact.clone()], &canon),
            [real.clone(), link.clone()]
        );
    }

    #[test]
    fn forget_removes_links_to_same_dir() {
        let cfg = TempDir::new("forget-link-cfg");
        let data = TempDir::new("forget-link-data");
        let root = TempDir::new("forget-link-root");
        let link = root.path().join("link");
        if !link_dir(data.path(), &link) {
            eprintln!("пропуск: не удалось создать ссылку на каталог");
            return;
        }
        let file = cfg.path().join("approved-dirs.json");
        let approved = ApprovedDirs::load(file.clone());
        approved.approve(&link).unwrap();
        approved.approve(root.path()).unwrap();

        // папка выбрана через ссылку, отзывается по настоящему пути — запись ссылки убрана
        assert_eq!(approved.forget(&path_string(data.path()), &[]), Ok(true));
        assert_unapproved(&approved, &link);
        assert_unapproved(&approved, data.path());
        assert_eq!(stored_dirs(&file), [path_string(root.path())]);
    }

    #[test]
    fn forget_keeps_dirs_in_use() {
        let cfg = TempDir::new("forget-keep-cfg");
        let data = TempDir::new("forget-keep-data");
        let root = TempDir::new("forget-keep-root");
        let link = root.path().join("link");
        if !link_dir(data.path(), &link) {
            eprintln!("пропуск: не удалось создать ссылку на каталог");
            return;
        }
        let file = cfg.path().join("approved-dirs.json");

        // прежняя папка — настоящий путь, новая — та же папка через ссылку
        let approved = ApprovedDirs::load(file.clone());
        approved.approve(data.path()).unwrap();
        approved.approve(&link).unwrap();
        assert_eq!(approved.forget(&path_string(data.path()), &[path_string(&link)]), Ok(true));
        assert!(approved.resolve(&path_string(&link)).is_ok());
        assert_eq!(stored_dirs(&file), [path_string(&link)]);
        // настоящий путь доступен через канонический вид ссылки: папка по-прежнему в настройках
        assert!(approved.resolve(&path_string(data.path())).is_ok());

        // обратно: прежняя — ссылка, новая — настоящий путь (subst и сетевой диск дают то же)
        fs::remove_file(&file).unwrap();
        let approved = ApprovedDirs::load(file.clone());
        approved.approve(&link).unwrap();
        approved.approve(data.path()).unwrap();
        assert_eq!(approved.forget(&path_string(&link), &[path_string(data.path())]), Ok(true));
        assert!(approved.resolve(&path_string(data.path())).is_ok());
        assert_eq!(stored_dirs(&file), [path_string(data.path())]);

        // пустые, неполные и с пробелами по краям строки keep не ломают отзыв
        let keep = [String::new(), "  ".into(), "relative".into(), format!("  {}  ", path_string(data.path()))];
        approved.approve(&link).unwrap();
        assert_eq!(approved.forget(&path_string(&link), &keep), Ok(true));
        assert_eq!(stored_dirs(&file), [path_string(data.path())]);
    }

    #[test]
    fn retain_keeps_only_dirs_in_settings() {
        let cfg = TempDir::new("retain-cfg");
        let root = TempDir::new("retain");
        let file = cfg.path().join("approved-dirs.json");
        let [a, b, c] = ["a", "b", "c"].map(|n| {
            let d = root.path().join(n);
            fs::create_dir(&d).unwrap();
            d
        });
        let gone = root.path().join("gone");
        let approved = ApprovedDirs::load(file.clone());
        for d in [&a, &gone, &b, &c] {
            fs::create_dir_all(d).unwrap();
            approved.approve(d).unwrap();
        }
        // недоступная папка не мешает сверке: записи не канонизируются
        fs::remove_dir(&gone).unwrap();

        let keep = [format!(" {} ", path_string(&c)), String::new(), "relative".into(), path_string(&a)];
        assert_eq!(approved.retain(&keep), Ok(true));
        // порядок записей (очередь вытеснения) сохраняется
        assert_eq!(stored_dirs(&file), [path_string(&a), path_string(&c)]);
        assert_unapproved(&approved, &b);
        assert!(approved.resolve(&path_string(&a)).is_ok());
        let reloaded = ApprovedDirs::load(file.clone());
        assert_unapproved(&reloaded, &b);
        assert!(reloaded.resolve(&path_string(&c)).is_ok());

        // убирать нечего — файл не перезаписывается
        let marker = serde_json::to_vec(&[path_string(&a), path_string(&c)]).unwrap();
        fs::write(&file, &marker).unwrap();
        assert_eq!(approved.retain(&keep), Ok(false));
        assert_eq!(fs::read(&file).unwrap(), marker);

        // в настройках папок нет — подтверждённых тоже
        assert_eq!(approved.retain(&[]), Ok(true));
        assert!(stored_dirs(&file).is_empty());
        assert_unapproved(&approved, &a);
        assert_eq!(approved.retain(&[path_string(&a)]), Ok(false));
        // сверка только убирает: папка из keep, которой нет в списке, подтверждённой не становится
        assert_unapproved(&approved, &a);
    }

    #[test]
    fn retain_removes_other_spelling_of_kept_dir() {
        let cfg = TempDir::new("retain-link-cfg");
        let data = TempDir::new("retain-link-data");
        let root = TempDir::new("retain-link-root");
        let link = root.path().join("link");
        if !link_dir(data.path(), &link) {
            eprintln!("пропуск: не удалось создать ссылку на каталог");
            return;
        }
        let file = cfg.path().join("approved-dirs.json");
        let approved = ApprovedDirs::load(file.clone());
        approved.approve(&link).unwrap();
        approved.approve(data.path()).unwrap();
        assert_eq!(approved.retain(&[path_string(data.path())]), Ok(true));
        assert_eq!(stored_dirs(&file), [path_string(data.path())]);
        assert!(approved.resolve(&path_string(data.path())).is_ok());
    }

    #[test]
    fn retain_failure_keeps_list_unchanged() {
        let cfg = TempDir::new("retain-fail-cfg");
        let data = TempDir::new("retain-fail");
        let file = cfg.path().join("approved-dirs.json");
        let approved = ApprovedDirs::load(file.clone());
        approved.approve(data.path()).unwrap();
        fs::remove_file(&file).unwrap();
        fs::create_dir(&file).unwrap();
        fs::write(file.join("x"), b"x").unwrap();

        let err = approved.retain(&[]).unwrap_err();
        assert!(err.starts_with("Не удалось забыть папку: "), "{err}");
        assert_eq!(approved.resolve(&path_string(data.path())).unwrap(), data.path());
        assert_eq!(names(cfg.path()), ["approved-dirs.json"]);
    }

    #[test]
    fn body_bytes_variants() {
        let raw = InvokeBody::Raw(vec![0, 1, 255]);
        assert_eq!(&*body_bytes(&raw).unwrap(), &[0, 1, 255]);
        assert!(body_bytes(&InvokeBody::Raw(Vec::new())).unwrap().is_empty());

        let json = InvokeBody::Json(serde_json::json!([0, 7, 255]));
        assert_eq!(&*body_bytes(&json).unwrap(), &[0, 7, 255]);
        assert!(body_bytes(&InvokeBody::Json(serde_json::json!([]))).unwrap().is_empty());

        for bad in [
            serde_json::json!({ "a": 1 }),
            serde_json::json!([1, 256]),
            serde_json::json!([-1]),
            serde_json::json!([1.5]),
            serde_json::json!(["1"]),
            serde_json::json!("abc"),
            serde_json::Value::Null,
        ] {
            assert_eq!(body_bytes(&InvokeBody::Json(bad)).unwrap_err(), "Ожидались двоичные данные");
        }

        let big = InvokeBody::Raw(vec![0; MAX_CHUNK_BYTES + 1]);
        assert_eq!(body_bytes(&big).unwrap_err(), "Слишком большая часть данных");
        assert!(body_bytes(&InvokeBody::Raw(vec![0; MAX_CHUNK_BYTES])).is_ok());
    }

    fn headers_with(json: &str) -> tauri::http::HeaderMap {
        let encoded =
            percent_encoding::utf8_percent_encode(json, percent_encoding::NON_ALPHANUMERIC).to_string();
        let mut headers = tauri::http::HeaderMap::new();
        headers.insert(ARGS_HEADER, encoded.parse().unwrap());
        headers
    }

    #[test]
    fn header_args_decodes_cyrillic() {
        let headers = headers_with(
            r#"{"dir":"D:\\Резервные копии\\QuickDrop","fileName":"quickdrop-backup-20261111-093005.json","offset":8388608,"last":false}"#,
        );
        let args: SaveBackupArgs = header_args(&headers).unwrap();
        assert_eq!(args.dir, "D:\\Резервные копии\\QuickDrop");
        assert_eq!(args.file_name, NAME);
        assert_eq!(args.offset, 8_388_608);
        assert!(!args.last);

        let headers = headers_with(r#"{"dir":"D:\\x","relPath":"заметки/файл 1.md","offset":0,"last":true}"#);
        let args: WriteExportArgs = header_args(&headers).unwrap();
        assert_eq!(args.rel_path, "заметки/файл 1.md");
        assert!(args.last);
    }

    #[test]
    fn header_args_rejects_bad_input() {
        let missing = tauri::http::HeaderMap::new();
        assert_eq!(header_args::<SaveBackupArgs>(&missing).err().unwrap(), BAD_ARGS);
        for bad in [
            r#"{"dir":"D:\\x","fileName":"a","offset":0,"last":true,"extra":1}"#,
            r#"{"dir":"D:\\x","fileName":"a","offset":0}"#,
            r#"{"dir":"D:\\x","fileName":"a","offset":-1,"last":true}"#,
            r#"{"dir":"D:\\x","relPath":"a","offset":0,"last":true}"#,
            "not json",
            "",
        ] {
            assert_eq!(header_args::<SaveBackupArgs>(&headers_with(bad)).err().unwrap(), BAD_ARGS, "{bad}");
        }
        // битая percent-последовательность даёт не UTF-8
        let mut headers = tauri::http::HeaderMap::new();
        headers.insert(ARGS_HEADER, "%FF%FE".parse().unwrap());
        assert_eq!(header_args::<SaveBackupArgs>(&headers).err().unwrap(), BAD_ARGS);
    }

    #[test]
    fn io_messages() {
        let msg = |kind: io::ErrorKind| io_message(&io::Error::from(kind), "Не удалось записать файл");
        assert_eq!(msg(io::ErrorKind::NotFound), "Не удалось записать файл: папка или файл не найдены");
        assert_eq!(
            msg(io::ErrorKind::PermissionDenied),
            "Не удалось записать файл: нет доступа (папка защищена от записи или файл занят)"
        );
        assert_eq!(msg(io::ErrorKind::StorageFull), "Не удалось записать файл: на диске не осталось места");
        assert!(msg(io::ErrorKind::TimedOut).starts_with("Не удалось записать файл: "));
    }

    #[test]
    fn export_target_creates_nested_dirs() {
        let dir = TempDir::new("export-target");
        let target = export_target(dir.path(), "заметки/2026/файл 1.md").unwrap();
        assert_eq!(target, dir.path().join("заметки").join("2026").join("файл 1.md"));
        assert!(target.parent().unwrap().is_dir());
        write_chunk(&target, 0, "текст".as_bytes(), true, 100).unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "текст");

        assert_eq!(export_target(dir.path(), "x.md").unwrap(), dir.path().join("x.md"));
        assert!(export_target(dir.path(), "../x.md").is_err());
        assert!(export_target(dir.path(), "a/con.md").is_err());
        // отклонённый путь каталогов не создаёт
        assert!(!dir.path().join("a").exists());
    }

    #[test]
    fn export_target_rejects_long_full_path() {
        let dir = TempDir::new("export-long");
        let base_len = path_string(dir.path()).encode_utf16().count();
        // base + разделитель + имя = ровно MAX_FULL_PATH_UTF16
        let fits = "я".repeat(MAX_FULL_PATH_UTF16 - base_len - 1 - 3) + ".md";
        assert!(export_target(dir.path(), &fits).is_ok());
        let err = export_target(dir.path(), &format!("я{fits}")).unwrap_err();
        assert!(err.starts_with("Слишком длинный путь к файлу"), "{err}");
    }

    /// Ссылка на каталог: символическая, а без прав на неё в Windows — точка соединения.
    fn link_dir(original: &Path, link: &Path) -> bool {
        #[cfg(windows)]
        {
            std::os::windows::fs::symlink_dir(original, link).is_ok()
                || std::process::Command::new("cmd")
                    .args(["/C", "mklink", "/J"])
                    .arg(link)
                    .arg(original)
                    .output()
                    .is_ok_and(|o| o.status.success())
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(original, link).is_ok()
        }
    }

    #[test]
    fn export_target_refuses_link_out_of_dir() {
        let dir = TempDir::new("export-link");
        let outside = TempDir::new("export-link-outside");
        if !link_dir(outside.path(), &dir.path().join("link")) {
            eprintln!("пропуск: не удалось создать ссылку на каталог");
            return;
        }
        assert_eq!(export_target(dir.path(), "link/x.md").unwrap_err(), OUTSIDE_EXPORT_DIR);
        assert_eq!(export_target(dir.path(), "link/new/deep/x.md").unwrap_err(), OUTSIDE_EXPORT_DIR);
        // за пределами папки ничего не создано
        assert!(names(outside.path()).is_empty());
        // ссылка внутрь самой папки допустима
        fs::create_dir(dir.path().join("real")).unwrap();
        if link_dir(&dir.path().join("real"), &dir.path().join("inner")) {
            assert!(export_target(dir.path(), "inner/x.md").is_ok());
        }
    }

    #[test]
    fn discard_export_part_refuses_link_out_of_dir() {
        let dir = TempDir::new("discard-link");
        let outside = TempDir::new("discard-link-outside");
        outside.file("x.md.qdpart", b"outside");
        if !link_dir(outside.path(), &dir.path().join("link")) {
            eprintln!("пропуск: не удалось создать ссылку на каталог");
            return;
        }
        assert_eq!(discard_export_part_in(dir.path(), "link/x.md").unwrap_err(), OUTSIDE_EXPORT_DIR);
        assert!(outside.path().join("x.md.qdpart").exists());
    }
}
