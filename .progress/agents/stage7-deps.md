# stage7-deps

Задача: пакет «deps» этапа 7 (волна 0) — зависимости Rust (tray-icon, tiny_http, autostart), Cargo.lock,
окно `capture` в tauri.conf.json, `capabilities/capture.json`; сверка API по скачанным исходникам.

Статус: **готово** (2026-11-13)

## Изменённые файлы

- `src-tauri/Cargo.toml` — `tauri = { version = "2", features = ["tray-icon"] }`; `tiny_http = "0.12"` в
  `[dependencies]`; `tauri-plugin-autostart = "2"` в секции настольных платформ (после single-instance).
- `src-tauri/Cargo.lock` — `cargo fetch`: только добавления (ascii 1.1.0, auto-launch 0.6.0, chunked_transfer 1.5.0,
  dirs 6.0.0, httpdate 1.0.3, nix 0.31.3, objc2-security 0.3.2, objc2-service-management 0.3.2, os_info 3.15.0,
  smappservice-rs 0.1.3, tauri-plugin-autostart **2.7.0**, tiny_http **0.12.0**, windows-registry 0.6.1).
  Версии прежних пакетов не менялись; `tauri` 2.12.5, `tray-icon` 0.25.1, `muda` 0.20.0 уже были в lock.
- `src-tauri/tauri.conf.json` — второй элемент `app.windows`: запись `capture` ровно по п. 2.2 (640×440). CSP и
  главное окно не тронуты.
- `src-tauri/capabilities/capture.json` — новый, по п. 2.14.8 (+ строка `$schema`, как в default.json).
- `src-tauri/build.rs` — **не менялся**: тестовый exe с `tray-icon` запускается (0xc0000139 нет).
- `default.json`, `package.json`, `package-lock.json`, исходники Rust — не трогались.

## Проверки

- `cargo check --manifest-path src-tauri/Cargo.toml` — ок (tauri-build принял окно capture и capture.json;
  `src-tauri/gen/schemas/capabilities.json` теперь содержит `capture`, каталог `gen` в .gitignore).
- `cargo test --manifest-path src-tauri/Cargo.toml` — 60 passed, 0 failed, 1 ignored.
- `npm run typecheck` — ок.

## Сверка API (по `~/.cargo/registry/src/index.crates.io-*/`)

### tauri-plugin-autostart 2.7.0 (`src/lib.rs`, весь крейт — один файл)

```rust
#![cfg(not(any(target_os = "android", target_os = "ios")))]   // крейт пуст на мобильных
pub enum MacosLauncher { #[default] LaunchAgent, AppleScript }   // Default + Copy + Clone + Debug
pub enum Error { Io(std::io::Error), Anyhow(String) }            // thiserror: Display; Serialize как строка
pub struct AutoLaunchManager(/* auto_launch::AutoLaunch */);
impl AutoLaunchManager {
    pub fn enable(&self) -> Result<(), Error>;      // синхронные, не async
    pub fn disable(&self) -> Result<(), Error>;     // «нет значения в реестре» → Ok(()) (уже выключено)
    pub fn is_enabled(&self) -> Result<bool, Error>;
}
pub trait ManagerExt<R: Runtime> { fn autolaunch(&self) -> State<'_, AutoLaunchManager>; }
impl<R: Runtime, T: Manager<R>> ManagerExt<R> for T   // App, AppHandle, WebviewWindow, Window, Webview
#[derive(Default)] pub struct Builder { .. }
impl Builder {
    pub fn new() -> Self;
    pub fn arg<S: Into<String>>(self, arg: S) -> Self;
    pub fn args<I, S>(self, args: I) -> Self where I: IntoIterator<Item = S>, S: Into<String>;
    #[cfg(target_os = "macos")] pub fn macos_launcher(self, l: MacosLauncher) -> Self;
    pub fn app_name<S: Into<String>>(self, name: S) -> Self;
    pub fn build<R: Runtime>(self) -> TauriPlugin<R>;
}
pub fn init<R: Runtime>(macos_launcher: MacosLauncher, args: Option<Vec<&'static str>>) -> TauriPlugin<R>;
```

Использование: `use tauri_plugin_autostart::ManagerExt;` → `app.autolaunch().enable()`; текст ошибки —
`e.to_string()`. Подключение по п. 2.14.8 (`Builder::new().args([shell::AUTOSTART_ARG]).build()`) совпадает с API.

Особенности (для `rust-shell` и `wire`):
- `autolaunch()` — это `state::<AutoLaunchManager>()`: **паника**, если плагин не зарегистрирован. Менеджер
  кладётся в state в `setup` плагина (плагины до `setup` приложения — к `shell::init` он уже есть). Надёжнее
  в `shell.rs` брать `app.try_state::<tauri_plugin_autostart::AutoLaunchManager>()` и при `None` отвечать
  `available: false` / `Err(...)` — тогда и проверочная цель, и забытая регистрация не роняют процесс.
- Плагин регистрирует JS-команды `plugin:autostart|enable/disable/is_enabled`, но прав `autostart:*` в
  capabilities нет — из веб-слоя они недоступны (так и задумано, управление через свои команды).
- Имя записи по умолчанию — `app.package_info().name` (= `productName` «QuickDrop»).
- Windows (auto-launch 0.6.0, `windows.rs`): значение в `SOFTWARE\Microsoft\Windows\CurrentVersion\Run` =
  `format!("{} {}", exe_path, args.join(" "))` — **путь не берётся в кавычки** (путь с пробелами, например
  MSI в `Program Files` или профиль «C:\Users\Имя Фамилия», остаётся без кавычек; Windows обычно запускает и так,
  но это слабое место — проверить вживую). Режим `WindowsEnableMode::Dynamic` (плагин его не меняет): сначала
  пишет в **HKLM**, при отказе доступа — в HKCU; т.е. если QuickDrop запущен с правами администратора, автозапуск
  ляжет для всех пользователей. `disable` чистит оба. `is_enabled` = есть значение в Run (HKLM или HKCU) **и**
  не выключено в «Диспетчере задач → Автозагрузка» (`Explorer\StartupApproved\Run`); выключенное там → `false`.
- macOS: по умолчанию `LaunchAgent` (plist в `~/Library/LaunchAgents`).

### tiny_http 0.12.0 (фичи по умолчанию пусты, без SSL)

```rust
impl Server {   // Server: Send + Sync (проверено трейтом-пустышкой в крейте)
    pub fn http<A: ToSocketAddrs>(addr: A) -> Result<Server, Box<dyn Error + Send + Sync + 'static>>;
    pub fn recv(&self) -> io::Result<Request>;
    pub fn recv_timeout(&self, timeout: Duration) -> io::Result<Option<Request>>;  // Ok(None) — таймаут
    pub fn try_recv(&self) -> io::Result<Option<Request>>;
    pub fn unblock(&self);            // будит ОДИН поток, висящий в recv()/incoming_requests()
    pub fn server_addr(&self) -> ListenAddr;
}
impl Drop for Server   // ставит флаг закрытия и коннектится к себе, чтобы снять accept — порт освобождается
impl Request {
    pub fn method(&self) -> &Method;  // enum Method { Get, Head, Post, Put, Delete, Connect, Options, Trace,
                                      //   Patch, NonStandard(AsciiString) }; PartialEq, as_str()
    pub fn url(&self) -> &str;        // путь + query, как пришёл ("/v1/capture")
    pub fn headers(&self) -> &[Header];
    pub fn body_length(&self) -> Option<usize>;   // None при chunked / неизвестной длине
    pub fn remote_addr(&self) -> Option<&SocketAddr>;
    pub fn as_reader(&mut self) -> &mut dyn Read; // при Expect: 100-continue сначала шлёт 100
    pub fn respond<R: Read>(self, response: Response<R>) -> Result<(), io::Error>;
}
impl Drop for Request  // без respond → автоматически пустой 500
pub struct Header { pub field: HeaderField, pub value: AsciiString }
impl Header {
    pub fn from_bytes<B1, B2>(header: B1, value: B2) -> Result<Header, ()>
        where B1: Into<Vec<u8>> + AsRef<[u8]>, B2: Into<Vec<u8>> + AsRef<[u8]>;   // только ASCII
}
impl FromStr for Header   // "Name: value".parse::<Header>()
impl HeaderField { pub fn equiv(&self, other: &'static str) -> bool;  // без учёта регистра
                   pub fn as_str(&self) -> &AsciiStr; }
// значение заголовка: h.value.as_str() -> &str
impl Response<Cursor<Vec<u8>>> {
    pub fn from_string<S: Into<String>>(data: S) -> Self;   // 200 + Content-Type: text/plain; charset=UTF-8
    pub fn from_data<D: Into<Vec<u8>>>(data: D) -> Self;
}
impl<R: Read> Response<R> {
    pub fn with_status_code<S: Into<StatusCode>>(self, code: S) -> Self;  // From<u16|i32|u32|...>
    pub fn with_header<H: Into<Header>>(self, header: H) -> Self;
    pub fn add_header<H: Into<Header>>(&mut self, header: H);
}
Response::empty<S: Into<StatusCode>>(code: S) -> Response<io::Empty>;
```

Особенности (для `rust-ext`):
- Поиск заголовка: `rq.headers().iter().find(|h| h.field.equiv("Origin")).map(|h| h.value.as_str())`.
- `with_header(Content-Type)` **заменяет** стандартный `text/plain` из `from_string` (а не добавляет второй).
  `add_header` молча игнорирует `Connection`, `Trailer`, `Transfer-Encoding`, `Upgrade`; `Content-Length` лишь
  задаёт длину.
- Ошибка `Server::http` — `Box<dyn Error>`; «порт занят» распознавать через
  `e.downcast_ref::<std::io::Error>().map(|e| e.kind())` == `ErrorKind::AddrInUse`. В Windows порт из
  зарезервированного диапазона (Hyper-V/WSL, `netsh int ipv4 show excludedportrange`) даёт WSAEACCES →
  `ErrorKind::PermissionDenied` — тоже стоит показывать как «порт недоступен/занят».
- `body_length()` может быть `None` (chunked) — читать тело только через `as_reader().take(MAX_BODY as u64 + 1)`
  и отказывать, если прочитано больше `MAX_BODY`; `Some(n) > MAX_BODY` — отказ 413 без чтения.
- Заголовок `Expect` с иным значением, чем `100-continue`, tiny_http отклоняет сам (запрос до `recv` не доходит).
- Таймаутов чтения/записи сокета в tiny_http нет, пул потоков соединений не ограничен (`util::TaskPool`):
  риск из п. 2.12 («медленное локальное соединение занимает поток») подтверждается.
- Логирует только через `log::debug!` (адрес прослушивания); логгер в приложении не установлен.

## Расхождения с п. 2.14

- Существенных нет: `Builder::new().args([...]).build()`, `ManagerExt::autolaunch()`, `enable/disable/is_enabled`,
  `Server::http`, `recv_timeout`, `unblock`, методы `Request`/`Response`/`Header` — есть с ожидаемыми именами.
- Уточнения: методы автозапуска синхронные и возвращают `Result<_, tauri_plugin_autostart::Error>` (не `String`);
  `autolaunch()` паникует без плагина (см. `try_state`); `Header::from_bytes` → `Result<Header, ()>` (только ASCII,
  значение `Origin` из расширения ASCII — ок); `body_length()` — `Option`.
- `capture.json` содержит строку `$schema` (в п. 2.14.8 её нет; добавлена для единообразия с default.json).
