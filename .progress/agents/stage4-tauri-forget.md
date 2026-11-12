# stage4-tauri-forget

Задача: этап 4, волна 1, пакет `tauri-forget` (`.progress/spec-stage4.md` §5.7, Р17). Rust: `ApprovedDirs::forget`
и команда `forget_directory` — убирает папку из подтверждённых по точному и каноническому пути; сначала файл,
потом память; мьютекс при канонизации не удерживается. Регистрация в `generate_handler!`, тесты cargo.
Права `capabilities` не меняются.

Файлы пакета: `src-tauri/src/backup.rs`, `src-tauri/src/lib.rs`, этот файл.

Статус: готово

## Результат

`src-tauri/src/backup.rs`:
- `ApprovedDirs::forget(&self, dir: &str) -> Result<bool, String>`: `trim`; пустая строка и неполный путь → `Ok(false)`.
  Канонический вид запрошенного (`dunce::canonicalize`, может не быть) и канонизация записей идут по копии списка,
  мьютекс в это время не удерживается (как в `resolve`). Затем под мьютексом текущий список фильтруется по найденным
  записям; если убирать нечего (в т.ч. запись успели убрать параллельно) — `Ok(false)`, файл не переписывается.
  Иначе сначала `save_dirs`, потом память; сбой записи → `Err("Не удалось забыть папку: …")`, список прежний.
- `forgotten_dirs(dirs, requested, canonical, canonicalize)` — чистая функция выбора записей: равные запрошенному
  пути или его каноническому виду и записи с тем же каноническим видом; `canonical = None` (папка недоступна) —
  только точное совпадение, записи не канонизируются. Совпавшие точно записи тоже не канонизируются.
- Команда `#[tauri::command] pub async fn forget_directory(dir: String, approved: State<ApprovedDirs>) -> Result<bool, String>`
  (имя аргумента `dir` совпадает с вызовом `invoke('forget_directory', { dir })` в `src/lib/desktop.ts`).

`src-tauri/src/lib.rs`: `backup::forget_directory` в `generate_handler!`. `capabilities/default.json` не менялся:
собственные команды приложения в нём не перечисляются (в `build.rs` нет app manifest).

Тесты (новые, 7):
- `forget_removes_exact_and_roundabout_path` — точная строка с пробелами по краям, путь с `..`; после отзыва
  `resolve` → «Папка не подтверждена»; третья запись цела; файл и перезагрузка списка; повторный отзыв → `false`.
- `forget_unknown_dir_leaves_file_untouched` — неизвестная, несуществующая, подпапка, родитель → `false`; файл
  (метка в компактном JSON) не перезаписан, `.tmp` не появился.
- `forget_ignores_empty_and_relative` — `""`, пробелы, `\t\n`, относительные пути → `Ok(false)`, файл не тронут.
- `forget_unavailable_dir_by_exact_string` — удалённая папка убирается по строке; обходной путь с `..` к недоступной
  папке не совпадает; после повторного появления папка не подтверждена.
- `forget_failure_keeps_list_unchanged` — на месте файла каталог: `Err("Не удалось забыть папку: …")`, `resolve`
  по-прежнему проходит, временный файл убран.
- `forgotten_dirs_exact_then_canonical` — чистая функция: состав и порядок, какие записи канонизируются (счётчик),
  недоступная папка — без канонизации.
- `forget_removes_links_to_same_dir` — папка, выбранная через точку соединения, отзывается по настоящему пути
  (ссылка в этом запуске создалась, тест не пропущен).

## Проверки

- `cargo test --manifest-path src-tauri/Cargo.toml` — 56 прошло (было 49), 1 пропущен (сетевой, как и раньше).
- `cargo check --manifest-path src-tauri/Cargo.toml --all-targets` — без предупреждений.
- `npm run typecheck` — чисто; `npm test` — 46 файлов / 1377 тестов прошло.

## Изменённые файлы

- `src-tauri/src/backup.rs`
- `src-tauri/src/lib.rs`
- `.progress/agents/stage4-tauri-forget.md`

## Запросы CSS

Нет.

## Не проверено

- Вызов `forget_directory` через IPC в окне Tauri и итоговый `approved-dirs.json` в каталоге настроек (среда не
  позволяет; приёмка §8 п. 3).
- `cargo clippy` не запускался.

## Заметки

- Отзыв по каноническому виду убирает и записи-ссылки на ту же папку (junction/symlink), в т.ч. если такая ссылка
  выбрана другой настройкой под другой строкой: `shouldForgetDir` сравнивает строки. Это уже принято в HANDOFF
  («редкий случай, принят»).
