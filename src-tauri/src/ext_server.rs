//! Локальный HTTP-приём записей от расширения браузера (спецификация, п. 2.14.4).
//!
//! Канал только принимает: ни один маршрут не отдаёт содержимое базы, наружу уходят лишь `ok`, `duplicate`
//! и текст ошибки. Сервер слушает строго `127.0.0.1` и запускается только по команде главного окна
//! (`ext_server_apply`), пока приём выключен — порт не слушается. Модуль самодостаточен (без `crate::…`).
//!
//! HTTP — свой минимальный разбор на `std::net`: одно соединение = один запрос (`Connection: close`),
//! у каждого соединения свой поток, их число ограничено `MAX_CONN`, на заголовки, тело и ответ — сроки.
//! Ни одно соединение не держит поток и сокет дольше этих сроков, даже если клиент молчит или
//! заявил огромное тело. Соединения сверх предела не сбрасываются, а ждут в очереди ядра: иначе тот, кто
//! держит 8 молчащих соединений (страница, обращающаяся к `https://127.0.0.1:{порт}`, тоже так может),
//! закрывал бы приём от расширения. Срок на заголовки короткий, не-HTTP байты (TLS) закрываются сразу.

use std::collections::VecDeque;
use std::io::{ErrorKind, Read, Write};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{Emitter, Manager};

pub const EVENT_EXT_CAPTURE: &str = "ext-capture";
pub const MAX_BODY: usize = 1_048_576;
pub const TAKE_TIMEOUT: Duration = Duration::from_secs(5);
pub const DONE_TIMEOUT: Duration = Duration::from_secs(10);
pub const RATE_MAX: usize = 30;
pub const RATE_WINDOW: Duration = Duration::from_secs(10);
/// Одновременно обслуживаемых соединений; следующие ждут в очереди ядра, пока место не освободится.
pub const MAX_CONN: usize = 8;
/// Предел строки запроса вместе с заголовками.
pub const MAX_HEAD: usize = 8 * 1024;
/// Срок на строку запроса и заголовки — на всё целиком, а не на один `read`. Короткий: столько ждёт в очереди
/// честный запрос, когда все места заняты молчащими соединениями (у расширения запас 20 с).
pub const HEAD_TIMEOUT: Duration = Duration::from_secs(1);
/// Срок на чтение тела и отдельно на запись ответа — тоже на всё целиком: клиент, досылающий по байту,
/// упирается в него.
pub const IO_TIMEOUT: Duration = Duration::from_secs(5);

/// Пауза после настоящей ошибки `accept` (нехватка дескрипторов и подобное); в обычной работе accept блокирующий.
const ACCEPT_ERROR_PAUSE: Duration = Duration::from_millis(200);
/// Страховочный шаг ожидания свободного места (основной путь — сигнал `ConnGuard::drop`).
const SLOT_WAIT_STEP: Duration = Duration::from_millis(200);
/// Срок будящего подключения к себе при остановке.
const WAKE_CONNECT: Duration = Duration::from_millis(200);
/// Сколько `stop` ждёт завершения потока: команды синхронные и не должны надолго занимать главный поток.
const STOP_WAIT: Duration = Duration::from_secs(1);
/// Порт закрытого сокета система может отдать не сразу; повторное открытие того же порта сразу после
/// остановки может получить «занят» — в этом окне пробуем ещё.
const REBIND_WAIT: Duration = Duration::from_secs(1);
const REBIND_STEP: Duration = Duration::from_millis(50);
const REBIND_RECENT: Duration = Duration::from_secs(3);
/// После ответа непрочитанный остаток запроса выбрасывается (в буфер на стеке, не больше этого и не дольше
/// `LINGER_TIME`): закрытие сокета с данными в приёмном буфере шлёт RST, и клиент мог бы не успеть прочитать ответ.
const LINGER_BYTES: usize = 2 * MAX_BODY;
const LINGER_TIME: Duration = Duration::from_secs(1);
const ERROR_MAX_CHARS: usize = 500;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtStatus {
    pub running: bool,
    pub port: Option<u16>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtPending {
    pub request_id: u64,
    pub message: Value,
}

pub struct ExtOutcome {
    pub ok: bool,
    pub duplicate: bool,
    pub error: Option<String>,
}

type Notify = Arc<dyn Fn(u64) + Send + Sync + 'static>;

/// Меняется на работающем сервере без перезапуска. Debug намеренно не реализован: внутри токен.
struct Config {
    token: String,
    version: String,
    notify: Notify,
}

struct Slot {
    id: u64,
    gen: u64,
    message: Value,
    taken_at: Option<Instant>,
    outcome: Option<ExtOutcome>,
}

#[derive(Default)]
struct Shared {
    /// Сообщения, ждущие главное окно. Соединения обслуживаются параллельно, а при смене порта старый и
    /// новый сервер ненадолго живут вместе — поэтому список, а не одно место.
    slots: Mutex<Vec<Slot>>,
    cv: Condvar,
    next_id: AtomicU64,
    /// Соединения в обработке (всех поколений сервера вместе).
    active: AtomicUsize,
    /// Сигнал «место освободилось» для потока приёма (замок — только против потерянного сигнала).
    conn_lock: Mutex<()>,
    conn_cv: Condvar,
}

impl Shared {
    fn notify_conn(&self) {
        let _g = lock(&self.conn_lock);
        self.conn_cv.notify_all();
    }
}

struct Running {
    port: u16,
    gen: u64,
    /// Фактический адрес сокета — для теста привязки только к 127.0.0.1.
    #[cfg(test)]
    addr: SocketAddr,
    config: Arc<Mutex<Config>>,
    stop: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

pub struct ExtServer {
    running: Mutex<Option<Running>>,
    shared: Arc<Shared>,
    next_gen: AtomicU64,
    last_stopped: Mutex<Option<(u16, Instant)>>,
    take_timeout: Duration,
    done_timeout: Duration,
    head_timeout: Duration,
    io_timeout: Duration,
}

impl Default for ExtServer {
    fn default() -> Self {
        Self::with_timeouts(TAKE_TIMEOUT, DONE_TIMEOUT)
    }
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl ExtServer {
    fn with_timeouts(take_timeout: Duration, done_timeout: Duration) -> Self {
        ExtServer {
            running: Mutex::new(None),
            shared: Arc::new(Shared::default()),
            next_gen: AtomicU64::new(0),
            last_stopped: Mutex::new(None),
            take_timeout,
            done_timeout,
            head_timeout: HEAD_TIMEOUT,
            io_timeout: IO_TIMEOUT,
        }
    }

    #[cfg(test)]
    fn with_head_timeout(mut self, head_timeout: Duration) -> Self {
        self.head_timeout = head_timeout;
        self
    }

    /// `enabled == false` → остановить. Тот же порт при работающем сервере → без перезапуска (токен, версия
    /// и `notify` подменяются на месте). Новый порт открывается раньше, чем закрывается прежний: не открылся —
    /// прежний сервер продолжает работать, ответ `Err`. `notify` вызывается из потока HTTP.
    pub fn apply(
        &self,
        enabled: bool,
        port: u16,
        token: &str,
        version: &str,
        notify: impl Fn(u64) + Send + Sync + 'static,
    ) -> Result<ExtStatus, String> {
        if !enabled {
            self.stop();
            return Ok(self.status());
        }
        if port < 1024 {
            return Err("Порт должен быть от 1024 до 65535".into());
        }
        if !is_valid_token(token) {
            return Err("Токен расширения не создан".into());
        }
        let config = Config { token: token.to_string(), version: version.to_string(), notify: Arc::new(notify) };

        let mut running = lock(&self.running);
        if let Some(run) = running.as_ref() {
            if run.port == port && !run.handle.is_finished() {
                *lock(&run.config) = config;
                return Ok(ExtStatus { running: true, port: Some(port) });
            }
        }
        // Тот же порт, но поток почему-то завершился: прежний сервер надо закрыть до открытия порта заново.
        if running.as_ref().is_some_and(|r| r.port == port) {
            if let Some(dead) = running.take() {
                self.shutdown(dead);
            }
        }
        let listener = self.open(port)?;
        #[cfg(test)]
        let addr = listener.local_addr().map_err(|e| format!("Не удалось открыть порт {port}: {e}"))?;
        let gen = self.next_gen.fetch_add(1, Ordering::SeqCst) + 1;
        let config = Arc::new(Mutex::new(config));
        let stop = Arc::new(AtomicBool::new(false));
        let ctx = Arc::new(Ctx {
            port,
            gen,
            config: config.clone(),
            shared: self.shared.clone(),
            stop: stop.clone(),
            take_timeout: self.take_timeout,
            done_timeout: self.done_timeout,
            head_timeout: self.head_timeout,
            io_timeout: self.io_timeout,
            rate: Mutex::new(RateLimiter::default()),
        });
        let handle = thread::Builder::new()
            .name("qd-ext-http".into())
            .spawn(move || accept_loop(listener, ctx))
            .map_err(|e| format!("Не удалось запустить приём: {e}"))?;
        let old = running.replace(Running {
            port,
            gen,
            #[cfg(test)]
            addr,
            config,
            stop,
            handle,
        });
        drop(running);
        if let Some(old) = old {
            self.shutdown(old);
        }
        Ok(ExtStatus { running: true, port: Some(port) })
    }

    pub fn status(&self) -> ExtStatus {
        match lock(&self.running).as_ref() {
            Some(run) if !run.handle.is_finished() => ExtStatus { running: true, port: Some(run.port) },
            _ => ExtStatus { running: false, port: None },
        }
    }

    /// Сообщения, которые главное окно ещё не забирало; помечаются забранными (дальше идёт срок подтверждения).
    pub fn take_pending(&self) -> Vec<ExtPending> {
        let now = Instant::now();
        let mut slots = lock(&self.shared.slots);
        let out = slots
            .iter_mut()
            .filter(|s| s.taken_at.is_none())
            .map(|s| {
                s.taken_at = Some(now);
                ExtPending { request_id: s.id, message: s.message.clone() }
            })
            .collect();
        drop(slots);
        self.shared.cv.notify_all();
        out
    }

    /// Итог от главного окна. Неизвестный (опоздавший) `request_id` игнорируется.
    pub fn complete(&self, request_id: u64, outcome: ExtOutcome) {
        let mut slots = lock(&self.shared.slots);
        if let Some(slot) = slots.iter_mut().find(|s| s.id == request_id && s.outcome.is_none()) {
            slot.outcome = Some(outcome);
            drop(slots);
            self.shared.cv.notify_all();
        }
    }

    /// Остановить приём. Ожидающее сообщение получает 503 и убирается из очереди.
    pub fn stop(&self) {
        let run = lock(&self.running).take();
        if let Some(run) = run {
            self.shutdown(run);
        }
    }

    /// Поток приёма стоит в блокирующем `accept` (или ждёт свободное место): его будит подключение к себе
    /// (или сигнал места), он видит флаг и, завершаясь, закрывает слушающий сокет. Соединения, уже взятые
    /// в обработку, доживают свои сроки сами; их ожидание в `deliver` снимает очистка слотов.
    fn shutdown(&self, run: Running) {
        run.stop.store(true, Ordering::SeqCst);
        lock(&self.shared.slots).retain(|s| s.gen != run.gen);
        self.shared.cv.notify_all();
        self.shared.notify_conn();
        wake_accept(run.port, &run.handle);
        let deadline = Instant::now() + STOP_WAIT;
        while !run.handle.is_finished() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(5));
        }
        if run.handle.is_finished() {
            let _ = run.handle.join();
        }
        *lock(&self.last_stopped) = Some((run.port, Instant::now()));
    }

    fn open(&self, port: u16) -> Result<TcpListener, String> {
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        let recently_ours = lock(&self.last_stopped)
            .is_some_and(|(p, at)| p == port && at.elapsed() < REBIND_RECENT);
        let deadline = Instant::now() + if recently_ours { REBIND_WAIT } else { Duration::ZERO };
        loop {
            match TcpListener::bind(addr) {
                // Блокирующий: поток приёма спит в accept, остановку он узнаёт от будящего подключения.
                Ok(listener) => return Ok(listener),
                Err(e) if e.kind() == ErrorKind::AddrInUse && Instant::now() < deadline => {
                    thread::sleep(REBIND_STEP);
                }
                Err(e) if e.kind() == ErrorKind::AddrInUse => {
                    return Err(format!("Порт {port} занят другой программой"));
                }
                // Windows: порт из диапазона, зарезервированного системой (Hyper-V, WSL), даёт WSAEACCES.
                Err(e) if e.kind() == ErrorKind::PermissionDenied => {
                    return Err(format!("Порт {port} недоступен: зарезервирован системой, выберите другой"));
                }
                Err(e) => return Err(format!("Не удалось открыть порт {port}: {e}")),
            }
        }
    }

    #[cfg(test)]
    fn generation(&self) -> Option<u64> {
        lock(&self.running).as_ref().map(|r| r.gen)
    }

    #[cfg(test)]
    fn active_connections(&self) -> usize {
        self.shared.active.load(Ordering::SeqCst)
    }
}

impl Drop for ExtServer {
    fn drop(&mut self) {
        self.stop();
    }
}

// ---------- чистые функции ----------

/// Ровно 43 символа base64url (32 случайных байта без выравнивания).
pub fn is_valid_token(s: &str) -> bool {
    s.len() == 43 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Сравнение за постоянное время (для строк одной длины; длина токена не секрет).
pub fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let diff = a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y));
    std::hint::black_box(diff) == 0
}

/// `chrome-extension://` + идентификатор расширения: ровно 32 буквы `a`–`p`.
pub fn is_extension_origin(s: &str) -> bool {
    s.strip_prefix("chrome-extension://")
        .is_some_and(|id| id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b)))
}

/// `Host` ровно `127.0.0.1:{port}` — защита от подмены DNS (`localhost` тоже не принимается).
pub fn host_matches(host: Option<&str>, port: u16) -> bool {
    host.is_some_and(|h| h == format!("127.0.0.1:{port}"))
}

/// Скользящее окно: не больше `RATE_MAX` принятых запросов за `RATE_WINDOW`.
#[derive(Default)]
struct RateLimiter {
    hits: VecDeque<Instant>,
}

impl RateLimiter {
    fn allow(&mut self, now: Instant) -> bool {
        while let Some(&t) = self.hits.front() {
            if now.saturating_duration_since(t) >= RATE_WINDOW {
                self.hits.pop_front();
            } else {
                break;
            }
        }
        if self.hits.len() >= RATE_MAX {
            return false;
        }
        self.hits.push_back(now);
        true
    }
}

// ---------- разбор HTTP ----------

/// Строка запроса и заголовки (без тела).
#[derive(Debug, PartialEq, Eq)]
struct Head {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
}

#[derive(Debug, PartialEq, Eq)]
enum HeadError {
    /// Заголовки длиннее `MAX_HEAD` → 431.
    TooLarge,
    /// Клиент закрыл соединение, замолчал дольше срока или сокет сломан → закрыть без ответа.
    Closed,
}

/// token из RFC 9110 (имя метода и заголовка).
fn is_token(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b"!#$%&'*+-.^_`|~".contains(&b))
}

/// Разбор строки запроса и заголовков (без завершающего `\r\n\r\n`). `None` — запрос не по форме → 400.
/// Строки продолжения (obs-fold), управляющие символы и не-UTF-8 не принимаются.
fn parse_head(raw: &[u8]) -> Option<Head> {
    let text = std::str::from_utf8(raw).ok()?;
    let mut lines = text.split("\r\n");
    let mut parts = lines.next()?.split(' ');
    let (method, path, version) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some()
        || !is_token(method)
        || path.is_empty()
        || path.bytes().any(|b| b.is_ascii_control())
        || !matches!(version, "HTTP/1.1" | "HTTP/1.0")
    {
        return None;
    }
    let mut headers = Vec::new();
    for line in lines {
        let (name, value) = line.split_once(':')?;
        if !is_token(name) {
            return None;
        }
        let value = value.trim_matches(|c| c == ' ' || c == '\t');
        if value.chars().any(|c| c.is_control() && c != '\t') {
            return None;
        }
        headers.push((name.to_string(), value.to_string()));
    }
    Some(Head { method: method.to_string(), path: path.to_string(), headers })
}

/// `Content-Length`: только цифры; число больше `u64` — «очень много» (дальше всё равно 413).
fn parse_content_length(v: &str) -> Option<u64> {
    if v.is_empty() || !v.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(v.parse::<u64>().unwrap_or(u64::MAX))
}

fn find_head_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4).position(|w| w == b"\r\n\r\n")
}

/// Один `read` не позже `deadline`. `None` — срок вышел или ошибка сокета.
fn read_some(stream: &mut TcpStream, buf: &mut [u8], deadline: Instant) -> Option<usize> {
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return None;
        }
        stream.set_read_timeout(Some(left)).ok()?;
        match stream.read(buf) {
            Ok(n) => return Some(n),
            Err(e) if e.kind() == ErrorKind::Interrupted => {}
            Err(_) => return None,
        }
    }
}

/// Байт, допустимый в строке запроса и заголовках: печатный ASCII, `\t`, `\r`, `\n` и obs-text (≥ 0x80 —
/// дальше его проверит разбор UTF-8). Управляющих байтов в HTTP нет, а в TLS ClientHello (0x16 …) и в
/// двоичном мусоре они есть почти сразу.
fn is_head_byte(b: u8) -> bool {
    matches!(b, b'\t' | b'\r' | b'\n' | 0x20..=0x7e | 0x80..=0xff)
}

/// Начало похоже на HTTP: первый байт — заглавная буква метода (или пустая строка перед ним, RFC 9112 п. 2.2).
fn is_head_start(b: u8) -> bool {
    b.is_ascii_uppercase() || b == b'\r' || b == b'\n'
}

/// Заголовки до `\r\n\r\n`, не больше `MAX_HEAD`. Возвращает их и уже прочитанное начало тела.
/// Не-HTTP байты (TLS, двоичные данные) — сразу `Closed`, не дожидаясь срока.
fn read_head(stream: &mut TcpStream, deadline: Instant) -> Result<(Vec<u8>, Vec<u8>), HeadError> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 2048];
    let mut checked = 0usize;
    loop {
        let n = match read_some(stream, &mut chunk, deadline) {
            Some(0) | None => return Err(HeadError::Closed),
            Some(n) => n,
        };
        let from = buf.len().saturating_sub(3);
        buf.extend_from_slice(&chunk[..n]);
        let end = find_head_end(&buf[from..]).map(|p| p + from);
        // После `\r\n\r\n` — тело: там может быть что угодно.
        let limit = end.unwrap_or(buf.len());
        // Конец заголовков может начаться в прошлом куске (`\r\n\r` + `\n`): тогда limit < checked.
        let fresh = &buf[checked.min(limit)..limit];
        if !buf.first().copied().is_some_and(is_head_start) || !fresh.iter().copied().all(is_head_byte) {
            return Err(HeadError::Closed);
        }
        checked = checked.max(limit);
        if let Some(end) = end {
            if end + 4 > MAX_HEAD {
                return Err(HeadError::TooLarge);
            }
            let rest = buf.split_off(end + 4);
            buf.truncate(end);
            return Ok((buf, rest));
        }
        if buf.len() >= MAX_HEAD {
            return Err(HeadError::TooLarge);
        }
    }
}

/// После ответа: выбросить непрочитанный остаток запроса (см. `LINGER_BYTES`), пока клиент не закроет.
fn linger(stream: &mut TcpStream) {
    let deadline = Instant::now() + LINGER_TIME;
    let mut chunk = [0u8; 8192];
    let mut total = 0usize;
    while total < LINGER_BYTES {
        match read_some(stream, &mut chunk, deadline) {
            Some(n) if n > 0 => total += n,
            _ => break,
        }
    }
}

/// Запрос одного соединения: заголовки разобраны, тело читается только на шаге 10.
struct HttpRequest<'a> {
    head: Head,
    /// Начало тела, прочитанное вместе с заголовками.
    rest: Vec<u8>,
    stream: &'a mut TcpStream,
    io_timeout: Duration,
}

impl HttpRequest<'_> {
    /// Значение заголовка; `Err`, если он повторён (такой запрос не принимаем).
    fn header(&self, name: &str) -> Result<Option<&str>, ()> {
        let mut found =
            self.head.headers.iter().filter(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str());
        let first = found.next();
        if found.next().is_some() {
            return Err(());
        }
        Ok(first)
    }

    fn has_header(&self, name: &str) -> bool {
        self.head.headers.iter().any(|(n, _)| n.eq_ignore_ascii_case(name))
    }

    /// Ровно `len` байт тела (`len` уже проверен: не больше `MAX_BODY`) за `io_timeout`. `None` — клиент
    /// прислал меньше, замолчал или ушёл.
    fn read_body(&mut self, len: usize) -> Option<Vec<u8>> {
        let mut body = std::mem::take(&mut self.rest);
        // Лишнее после заявленной длины — не наше (соединение всё равно закрывается после ответа).
        body.truncate(len);
        if body.len() < len {
            let wants_continue =
                matches!(self.header("Expect"), Ok(Some(v)) if v.eq_ignore_ascii_case("100-continue"));
            if wants_continue && body.is_empty() {
                self.stream.write_all(b"HTTP/1.1 100 Continue\r\n\r\n").ok()?;
            }
        }
        body.reserve_exact(len - body.len());
        let deadline = Instant::now() + self.io_timeout;
        let mut chunk = [0u8; 8192];
        while body.len() < len {
            let want = (len - body.len()).min(chunk.len());
            match read_some(self.stream, &mut chunk[..want], deadline) {
                Some(0) | None => return None,
                Some(n) => body.extend_from_slice(&chunk[..n]),
            }
        }
        Some(body)
    }
}

// ---------- ответы ----------

struct Reply {
    status: u16,
    body: Option<Value>,
    origin: Option<String>,
    extra: Vec<(&'static str, String)>,
}

impl Reply {
    fn error(status: u16, msg: &str) -> Self {
        Reply { status, body: Some(json!({ "ok": false, "error": msg })), origin: None, extra: Vec::new() }
    }
    fn json(status: u16, body: Value) -> Self {
        Reply { status, body: Some(body), origin: None, extra: Vec::new() }
    }
    fn origin(mut self, origin: &Option<String>) -> Self {
        self.origin = origin.clone();
        self
    }
    fn with(mut self, name: &'static str, value: &str) -> Self {
        self.extra.push((name, value.to_string()));
        self
    }
}

fn truncate_chars(s: &str, max: usize) -> String {
    match s.char_indices().nth(max) {
        Some((i, _)) => s[..i].to_string(),
        None => s.to_string(),
    }
}

fn outcome_reply(outcome: ExtOutcome) -> Reply {
    if outcome.ok {
        return Reply::json(200, json!({ "ok": true, "duplicate": outcome.duplicate }));
    }
    let msg = outcome.error.filter(|e| !e.trim().is_empty()).unwrap_or_else(|| "Не удалось сохранить".into());
    Reply::error(422, &truncate_chars(&msg, ERROR_MAX_CHARS))
}

fn reason(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        411 => "Length Required",
        413 => "Content Too Large",
        415 => "Unsupported Media Type",
        422 => "Unprocessable Content",
        429 => "Too Many Requests",
        431 => "Request Header Fields Too Large",
        503 => "Service Unavailable",
        504 => "Gateway Timeout",
        _ => "Internal Server Error",
    }
}

fn push_header(out: &mut String, name: &str, value: &str) {
    // Значения — константы и проверенный origin; перевод строки в заголовок не пропускается никогда.
    if is_token(name) && !value.bytes().any(|b| b.is_ascii_control()) {
        out.push_str(name);
        out.push_str(": ");
        out.push_str(value);
        out.push_str("\r\n");
    }
}

fn build_response(reply: Reply) -> Vec<u8> {
    let body = reply.body.map(|b| b.to_string().into_bytes()).unwrap_or_default();
    let mut head = format!("HTTP/1.1 {} {}\r\n", reply.status, reason(reply.status));
    let base = [
        ("Content-Type", "application/json; charset=utf-8"),
        ("Cache-Control", "no-store"),
        ("X-Content-Type-Options", "nosniff"),
        ("Vary", "Origin"),
    ];
    for (n, v) in base {
        push_header(&mut head, n, v);
    }
    // Только проверенный origin расширения; не `*` и без Allow-Credentials.
    if let Some(o) = reply.origin.as_deref() {
        push_header(&mut head, "Access-Control-Allow-Origin", o);
    }
    for (n, v) in &reply.extra {
        push_header(&mut head, n, v);
    }
    // У 204 длины быть не должно (RFC 9110, п. 8.6).
    if reply.status != 204 {
        push_header(&mut head, "Content-Length", &body.len().to_string());
    }
    push_header(&mut head, "Connection", "close");
    head.push_str("\r\n");
    let mut out = head.into_bytes();
    out.extend_from_slice(&body);
    out
}

// ---------- соединения ----------

/// Место в пределе `MAX_CONN`; освобождается в `Drop`, в том числе при панике потока соединения.
struct ConnGuard(Arc<Shared>);

impl ConnGuard {
    fn acquire(shared: &Arc<Shared>) -> Option<ConnGuard> {
        let mut cur = shared.active.load(Ordering::SeqCst);
        loop {
            if cur >= MAX_CONN {
                return None;
            }
            match shared.active.compare_exchange(cur, cur + 1, Ordering::SeqCst, Ordering::SeqCst) {
                Ok(_) => return Some(ConnGuard(shared.clone())),
                Err(now) => cur = now,
            }
        }
    }
}

impl Drop for ConnGuard {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::SeqCst);
        self.0.notify_conn();
    }
}

/// Ждать свободное место в `MAX_CONN`, не принимая новых соединений: они копятся в очереди ядра и будут
/// приняты по порядку. false — пора останавливаться.
fn wait_for_slot(ctx: &Ctx) -> bool {
    let shared = &ctx.shared;
    let mut g = lock(&shared.conn_lock);
    while shared.active.load(Ordering::SeqCst) >= MAX_CONN && !ctx.stop.load(Ordering::SeqCst) {
        g = match shared.conn_cv.wait_timeout(g, SLOT_WAIT_STEP) {
            Ok((g, _)) => g,
            Err(e) => e.into_inner().0,
        };
    }
    !ctx.stop.load(Ordering::SeqCst)
}

fn accept_loop(listener: TcpListener, ctx: Arc<Ctx>) {
    while wait_for_slot(&ctx) {
        let res = listener.accept();
        // Будящее подключение из `shutdown` попадает сюда и до `admit` не доходит.
        if ctx.stop.load(Ordering::SeqCst) {
            break;
        }
        match res {
            Ok((stream, _)) => admit(stream, &ctx),
            Err(e) if e.kind() == ErrorKind::Interrupted => {}
            // Нехватка дескрипторов, сбой сети — считаются временными: приём продолжается, иначе состояние
            // «Принимает записи» осталось бы ложью.
            Err(_) => thread::sleep(ACCEPT_ERROR_PAUSE),
        }
    }
    // Здесь закрывается слушающий сокет.
}

/// Разбудить поток приёма, стоящий в блокирующем `accept`, подключением к себе (на Windows закрытие копии
/// сокета `accept` не снимает). Не удалось — ещё пара попыток в пределах `STOP_WAIT`.
fn wake_accept(port: u16, handle: &JoinHandle<()>) {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    for _ in 0..3 {
        if handle.is_finished() || TcpStream::connect_timeout(&addr, WAKE_CONNECT).is_ok() {
            return;
        }
    }
}

fn admit(stream: TcpStream, ctx: &Arc<Ctx>) {
    let Some(guard) = ConnGuard::acquire(&ctx.shared) else {
        // Сюда попадает только гонка двух поколений сервера при смене порта: закрыть, ничего не читая.
        let _ = stream.shutdown(Shutdown::Both);
        return;
    };
    let ctx = ctx.clone();
    // Не запустился поток — замыкание удаляется вместе с guard и сокетом.
    let _ = thread::Builder::new().name("qd-ext-conn".into()).spawn(move || {
        let _guard = guard;
        serve(stream, &ctx);
    });
}

fn serve(mut stream: TcpStream, ctx: &Ctx) {
    // Страховка: слушающий сокет блокирующий, а Windows отдаёт принятому его режим.
    if stream.set_nonblocking(false).is_err() {
        return;
    }
    let _ = stream.set_nodelay(true);
    let _ = stream.set_write_timeout(Some(ctx.io_timeout));
    let reply = match read_head(&mut stream, Instant::now() + ctx.head_timeout) {
        Ok((raw, rest)) => match parse_head(&raw) {
            Some(head) => {
                let mut rq = HttpRequest { head, rest, stream: &mut stream, io_timeout: ctx.io_timeout };
                ctx.handle(&mut rq)
            }
            None => Reply::error(400, "Неверный формат запроса"),
        },
        Err(HeadError::TooLarge) => Reply::error(431, "Слишком большие заголовки"),
        Err(HeadError::Closed) => return,
    };
    if stream.write_all(&build_response(reply)).is_err() {
        return;
    }
    let _ = stream.flush();
    let _ = stream.shutdown(Shutdown::Write);
    linger(&mut stream);
}

// ---------- проверки и передача главному окну ----------

/// Общее для потока приёма и соединений одного поколения сервера.
struct Ctx {
    port: u16,
    gen: u64,
    config: Arc<Mutex<Config>>,
    shared: Arc<Shared>,
    stop: Arc<AtomicBool>,
    take_timeout: Duration,
    done_timeout: Duration,
    head_timeout: Duration,
    io_timeout: Duration,
    rate: Mutex<RateLimiter>,
}

impl Ctx {
    /// Проверки строго по порядку таблицы п. 2.14.4: токен (шаг 5) раньше частоты (шаг 6), запрос без верного
    /// токена в счёт частоты не идёт.
    fn handle(&self, rq: &mut HttpRequest<'_>) -> Reply {
        // 1. Host
        match rq.header("Host") {
            Ok(host) if host_matches(host, self.port) => {}
            _ => return Reply::error(403, "Недопустимый адрес"),
        }
        // 2. Origin: если есть — только расширение; для POST и OPTIONS обязателен.
        let origin = match rq.header("Origin") {
            Ok(None) => None,
            Ok(Some(o)) if is_extension_origin(o) => Some(o.to_string()),
            _ => return Reply::error(403, "Запрос не от расширения"),
        };
        let method = rq.head.method.clone();
        if matches!(method.as_str(), "POST" | "OPTIONS") && origin.is_none() {
            return Reply::error(403, "Запрос не от расширения");
        }
        // 3. Preflight
        if method == "OPTIONS" {
            return Reply { status: 204, body: None, origin: None, extra: Vec::new() }
                .origin(&origin)
                .with("Access-Control-Allow-Methods", "POST, GET")
                .with("Access-Control-Allow-Headers", "authorization, content-type")
                .with("Access-Control-Allow-Private-Network", "true")
                .with("Access-Control-Max-Age", "600");
        }
        // 4. Маршрут
        let is_ping = match rq.head.path.as_str() {
            "/v1/ping" => true,
            "/v1/capture" => false,
            _ => return Reply::error(404, "Не найдено").origin(&origin),
        };
        let allowed = if is_ping { "GET" } else { "POST" };
        if method != allowed {
            return Reply::error(405, "Метод не поддерживается").origin(&origin).with("Allow", allowed);
        }
        // 5. Токен (снимок настроек — замок не держится во время ожидания главного окна)
        let (token_ok, version, notify) = {
            let cfg = lock(&self.config);
            let token_ok = match rq.header("Authorization") {
                Ok(Some(v)) => v.strip_prefix("Bearer ").is_some_and(|t| ct_eq(t.as_bytes(), cfg.token.as_bytes())),
                _ => false,
            };
            (token_ok, cfg.version.clone(), cfg.notify.clone())
        };
        if !token_ok {
            return Reply::error(401, "Неверный токен").origin(&origin);
        }
        // 6. Частота — только запросы с верным токеном: чужие (страница без Origin на GET /v1/ping)
        // не могут занять окно и заблокировать расширение.
        if !lock(&self.rate).allow(Instant::now()) {
            return Reply::error(429, "Слишком много запросов, повторите позже")
                .origin(&origin)
                .with("Retry-After", "10");
        }
        // 7. Проверка связи
        if is_ping {
            return Reply::json(200, json!({ "ok": true, "app": "quickdrop", "version": version })).origin(&origin);
        }
        // 8. Тип содержимого
        let json_type = matches!(rq.header("Content-Type"),
            Ok(Some(v)) if v.as_bytes().get(..16).is_some_and(|p| p.eq_ignore_ascii_case(b"application/json")));
        if !json_type {
            return Reply::error(415, "Ожидается JSON").origin(&origin);
        }
        // 9. Размер (при Transfer-Encoding длины нет — тоже 411); тело ещё не читалось.
        if rq.has_header("Transfer-Encoding") {
            return Reply::error(411, "Не указан размер запроса").origin(&origin);
        }
        let len = match rq.header("Content-Length") {
            Ok(None) => return Reply::error(411, "Не указан размер запроса").origin(&origin),
            Ok(Some(v)) => match parse_content_length(v) {
                Some(n) if n > MAX_BODY as u64 => {
                    return Reply::error(413, "Слишком большой запрос").origin(&origin);
                }
                Some(n) => n as usize,
                None => return Reply::error(400, "Неверный формат запроса").origin(&origin),
            },
            Err(()) => return Reply::error(400, "Неверный формат запроса").origin(&origin),
        };
        // 10. Тело: UTF-8, JSON-объект с "v": 1
        let Some(buf) = rq.read_body(len) else {
            return Reply::error(400, "Неверный формат запроса").origin(&origin);
        };
        let message: Value = match serde_json::from_slice(&buf) {
            Ok(v @ Value::Object(_)) => v,
            _ => return Reply::error(400, "Неверный формат запроса").origin(&origin),
        };
        if message.get("v").and_then(Value::as_u64) != Some(1) {
            return Reply::error(400, "Неверный формат запроса").origin(&origin);
        }
        // 11. Передача главному окну и ожидание итога
        self.deliver(message, &notify).origin(&origin)
    }

    fn deliver(&self, message: Value, notify: &Notify) -> Reply {
        let id = self.shared.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let created = Instant::now();
        {
            let mut slots = lock(&self.shared.slots);
            // Флаг проверяется под тем же замком, что и очистка в `shutdown`: сообщение не повиснет в очереди.
            if self.stop.load(Ordering::SeqCst) {
                return Reply::error(503, "Приём выключен, запись не сохранена");
            }
            slots.push(Slot { id, gen: self.gen, message, taken_at: None, outcome: None });
        }
        notify(id);

        let mut slots = lock(&self.shared.slots);
        let mut was_taken = false;
        loop {
            let Some(pos) = slots.iter().position(|s| s.id == id) else {
                // Убрано остановкой сервера.
                return Reply::error(
                    503,
                    if was_taken { "Приём выключен. Проверьте «Входящие»" } else { "Приём выключен, запись не сохранена" },
                );
            };
            if slots[pos].outcome.is_some() {
                let slot = slots.remove(pos);
                return slot.outcome.map(outcome_reply).unwrap_or_else(|| Reply::error(500, "Внутренняя ошибка"));
            }
            let taken_at = slots[pos].taken_at;
            was_taken = taken_at.is_some();
            let deadline = match taken_at {
                None => created + self.take_timeout,
                Some(t) => t + self.done_timeout,
            };
            let now = Instant::now();
            if now >= deadline {
                slots.remove(pos);
                return Reply::error(
                    504,
                    if was_taken {
                        "QuickDrop не подтвердил сохранение. Проверьте «Входящие»"
                    } else {
                        "QuickDrop не отвечает, запись не сохранена"
                    },
                );
            }
            slots = match self.shared.cv.wait_timeout(slots, deadline - now) {
                Ok((guard, _)) => guard,
                Err(e) => e.into_inner().0,
            };
        }
    }
}

// ---------- команды ----------

fn main_only(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("Недоступно из этого окна".into())
    }
}

#[tauri::command]
pub fn ext_server_apply(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ExtServer>,
    enabled: bool,
    port: u16,
    token: String,
) -> Result<ExtStatus, String> {
    main_only(&window)?;
    let app = window.app_handle().clone();
    let version = app.package_info().version.to_string();
    state.apply(enabled, port, &token, &version, move |id| {
        // В событии только номер — содержимое главное окно забирает командой ext_take_pending.
        let _ = app.emit_to("main", EVENT_EXT_CAPTURE, id);
    })
}

#[tauri::command]
pub fn ext_server_status(state: tauri::State<'_, ExtServer>) -> ExtStatus {
    state.status()
}

#[tauri::command]
pub fn ext_take_pending(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ExtServer>,
) -> Result<Vec<ExtPending>, String> {
    main_only(&window)?;
    Ok(state.take_pending())
}

#[tauri::command]
pub fn ext_capture_done(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, ExtServer>,
    request_id: u64,
    ok: bool,
    duplicate: bool,
    error: Option<String>,
) -> Result<(), String> {
    main_only(&window)?;
    state.complete(request_id, ExtOutcome { ok, duplicate, error });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpStream;
    use std::sync::mpsc::{self, Receiver};

    const TOKEN: &str = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO_-";
    const TOKEN2: &str = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFG";
    const ORIGIN: &str = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    const SHORT: Duration = Duration::from_millis(300);

    fn free_port() -> u16 {
        TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
    }

    /// Сервер на свободном порту; номера сообщений из `notify` приходят в канал (вместо события главному окну).
    fn start(take: Duration, done: Duration) -> (Arc<ExtServer>, u16, Receiver<u64>) {
        let srv = Arc::new(ExtServer::with_timeouts(take, done));
        let (tx, rx) = mpsc::channel::<u64>();
        let tx = Arc::new(Mutex::new(tx));
        let port = apply_free_port(&srv, move |id| {
            let _ = lock(&tx).send(id);
        });
        (srv, port, rx)
    }

    /// Тесты идут параллельно: «свободный» порт мог занять соседний тест — тогда берём другой.
    fn apply_free_port(srv: &ExtServer, notify: impl Fn(u64) + Clone + Send + Sync + 'static) -> u16 {
        for _ in 0..20 {
            let port = free_port();
            if let Ok(st) = srv.apply(true, port, TOKEN, "0.1.0", notify.clone()) {
                assert_eq!(st, ExtStatus { running: true, port: Some(port) });
                return port;
            }
        }
        panic!("не нашлось свободного порта");
    }

    /// Вместо главного окна: по «будильнику» забирает сообщения и подтверждает итог, если `f` даёт `Some`.
    /// Возвращает забранные сообщения.
    fn worker(
        srv: Arc<ExtServer>,
        rx: Receiver<u64>,
        count: usize,
        f: impl Fn(&Value) -> Option<ExtOutcome> + Send + 'static,
    ) -> thread::JoinHandle<Vec<(u64, Value)>> {
        thread::spawn(move || {
            let mut seen = Vec::new();
            while seen.len() < count {
                let Ok(id) = rx.recv_timeout(Duration::from_secs(10)) else { break };
                for p in srv.take_pending() {
                    assert_eq!(p.request_id, id);
                    if let Some(o) = f(&p.message) {
                        srv.complete(p.request_id, o);
                    }
                    seen.push((p.request_id, p.message));
                }
            }
            seen
        })
    }

    struct Resp {
        status: u16,
        headers: Vec<(String, String)>,
        body: String,
    }

    impl Resp {
        fn header(&self, name: &str) -> Option<&str> {
            self.headers.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
        }
        fn json(&self) -> Value {
            serde_json::from_str(&self.body).unwrap_or(Value::Null)
        }
        fn error(&self) -> String {
            self.json()["error"].as_str().unwrap_or_default().to_string()
        }
    }

    struct Req {
        method: &'static str,
        path: String,
        headers: Vec<(String, String)>,
        body: Vec<u8>,
        auto_len: bool,
    }

    impl Req {
        fn new(port: u16, method: &'static str, path: &str) -> Self {
            let mut headers = vec![
                ("Host".to_string(), format!("127.0.0.1:{port}")),
                ("Origin".to_string(), ORIGIN.to_string()),
                ("Authorization".to_string(), format!("Bearer {TOKEN}")),
            ];
            if method == "POST" {
                headers.push(("Content-Type".into(), "application/json".into()));
            }
            Req { method, path: path.into(), headers, body: Vec::new(), auto_len: method == "POST" }
        }
        fn ping(port: u16) -> Self {
            Self::new(port, "GET", "/v1/ping")
        }
        fn capture(port: u16, body: &Value) -> Self {
            Self::new(port, "POST", "/v1/capture").body(body.to_string().into_bytes())
        }
        /// Заменить заголовок (`None` — убрать).
        fn set(mut self, name: &str, value: Option<&str>) -> Self {
            self.headers.retain(|(n, _)| !n.eq_ignore_ascii_case(name));
            if let Some(v) = value {
                self.headers.push((name.into(), v.into()));
            }
            self
        }
        fn body(mut self, body: Vec<u8>) -> Self {
            self.body = body;
            self
        }
        fn no_len(mut self) -> Self {
            self.auto_len = false;
            self
        }
        fn raw(&self) -> Vec<u8> {
            let mut head = format!("{} {} HTTP/1.1\r\n", self.method, self.path);
            for (n, v) in &self.headers {
                head.push_str(&format!("{n}: {v}\r\n"));
            }
            if self.auto_len {
                head.push_str(&format!("Content-Length: {}\r\n", self.body.len()));
            }
            head.push_str("Connection: close\r\n\r\n");
            let mut out = head.into_bytes();
            out.extend_from_slice(&self.body);
            out
        }
        fn send(&self, port: u16) -> Resp {
            send_raw(port, &self.raw(), Duration::from_secs(20)).expect("нет ответа")
        }
    }

    fn send_raw(port: u16, raw: &[u8], wait: Duration) -> Option<Resp> {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(wait)).unwrap();
        s.write_all(raw).unwrap();
        let mut buf = Vec::new();
        let mut chunk = [0u8; 8192];
        loop {
            match s.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => buf.extend_from_slice(&chunk[..n]),
                Err(_) => break,
            }
        }
        parse_response(&buf)
    }

    fn parse_response(buf: &[u8]) -> Option<Resp> {
        let split = buf.windows(4).position(|w| w == b"\r\n\r\n")?;
        let head = std::str::from_utf8(&buf[..split]).ok()?;
        let mut lines = head.split("\r\n");
        let status: u16 = lines.next()?.split(' ').nth(1)?.parse().ok()?;
        let headers: Vec<(String, String)> = lines
            .filter_map(|l| l.split_once(':'))
            .map(|(n, v)| (n.trim().to_string(), v.trim().to_string()))
            .collect();
        let mut body = buf[split + 4..].to_vec();
        let chunked = headers
            .iter()
            .any(|(n, v)| n.eq_ignore_ascii_case("Transfer-Encoding") && v.contains("chunked"));
        if chunked {
            let mut out = Vec::new();
            let mut rest = &body[..];
            while let Some(p) = rest.windows(2).position(|w| w == b"\r\n") {
                let size = usize::from_str_radix(std::str::from_utf8(&rest[..p]).ok()?.trim(), 16).ok()?;
                if size == 0 {
                    break;
                }
                out.extend_from_slice(&rest[p + 2..p + 2 + size]);
                rest = &rest[p + 2 + size + 2..];
            }
            body = out;
        }
        Some(Resp { status, headers, body: String::from_utf8_lossy(&body).into_owned() })
    }

    fn page_msg() -> Value {
        json!({ "v": 1, "kind": "page", "url": "https://example.com/", "title": "Пример" })
    }

    fn ok_outcome(duplicate: bool) -> Option<ExtOutcome> {
        Some(ExtOutcome { ok: true, duplicate, error: None })
    }

    fn assert_common_headers(r: &Resp) {
        assert_eq!(r.header("Content-Type"), Some("application/json; charset=utf-8"));
        assert_eq!(r.header("Cache-Control"), Some("no-store"));
        assert_eq!(r.header("X-Content-Type-Options"), Some("nosniff"));
        assert_eq!(r.header("Vary"), Some("Origin"));
        assert_eq!(r.header("Access-Control-Allow-Credentials"), None);
    }

    fn port_is_free(port: u16) -> bool {
        // Сокет закрывается, когда завершится поток приёма, — даём ему немного времени.
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            if TcpListener::bind(("127.0.0.1", port)).is_ok() {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            thread::sleep(Duration::from_millis(20));
        }
    }

    // ---------- чистые функции ----------

    #[test]
    fn token_format() {
        assert_eq!(TOKEN.len(), 43);
        assert!(is_valid_token(TOKEN));
        assert!(is_valid_token(TOKEN2));
        assert!(!is_valid_token(""));
        assert!(!is_valid_token(&TOKEN[..42]));
        assert!(!is_valid_token(&format!("{TOKEN}a")));
        assert!(!is_valid_token("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO+/"));
        assert!(!is_valid_token("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP="));
        assert!(!is_valid_token("абвгдежзийклмнопрстуфхцчшщъ"));
    }

    #[test]
    fn constant_time_eq() {
        assert!(ct_eq(b"", b""));
        assert!(ct_eq(TOKEN.as_bytes(), TOKEN.as_bytes()));
        assert!(!ct_eq(TOKEN.as_bytes(), TOKEN2.as_bytes()));
        assert!(!ct_eq(b"abc", b"abd"));
        assert!(!ct_eq(b"abc", b"abcd"));
        assert!(!ct_eq(b"abc", b""));
    }

    #[test]
    fn extension_origin() {
        assert!(is_extension_origin(ORIGIN));
        assert!(!is_extension_origin("chrome-extension://abcdefghijklmnopabcdefghijklmno"));
        assert!(!is_extension_origin("chrome-extension://abcdefghijklmnopabcdefghijklmnopa"));
        assert!(!is_extension_origin("chrome-extension://abcdefghijklmnopabcdefghijklmnoq"));
        assert!(!is_extension_origin("chrome-extension://ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP"));
        assert!(!is_extension_origin("chrome-extension://abcdefghijklmnopabcdefghijklmnop/"));
        assert!(!is_extension_origin("moz-extension://abcdefghijklmnopabcdefghijklmnop"));
        assert!(!is_extension_origin("https://example.com"));
        assert!(!is_extension_origin("null"));
        assert!(!is_extension_origin(""));
    }

    #[test]
    fn host_check() {
        assert!(host_matches(Some("127.0.0.1:47821"), 47821));
        assert!(!host_matches(Some("127.0.0.1:47822"), 47821));
        assert!(!host_matches(Some("localhost:47821"), 47821));
        assert!(!host_matches(Some("127.0.0.1"), 47821));
        assert!(!host_matches(Some("evil.example:47821"), 47821));
        assert!(!host_matches(Some("127.0.0.1:47821 "), 47821));
        assert!(!host_matches(None, 47821));
    }

    #[test]
    fn rate_limiter_window() {
        let mut r = RateLimiter::default();
        let t0 = Instant::now();
        for _ in 0..RATE_MAX {
            assert!(r.allow(t0));
        }
        assert!(!r.allow(t0 + Duration::from_secs(9)));
        assert!(r.allow(t0 + RATE_WINDOW));
    }

    #[test]
    fn error_text_is_truncated() {
        let long = "я".repeat(ERROR_MAX_CHARS + 10);
        assert_eq!(truncate_chars(&long, ERROR_MAX_CHARS).chars().count(), ERROR_MAX_CHARS);
        assert_eq!(truncate_chars("abc", 10), "abc");
    }

    // ---------- apply / stop ----------

    #[test]
    fn apply_validates_port_and_token() {
        let srv = ExtServer::default();
        let e = srv.apply(true, 80, TOKEN, "0.1.0", |_| {}).unwrap_err();
        assert_eq!(e, "Порт должен быть от 1024 до 65535");
        let e = srv.apply(true, free_port(), "короткий", "0.1.0", |_| {}).unwrap_err();
        assert_eq!(e, "Токен расширения не создан");
        assert_eq!(srv.status(), ExtStatus { running: false, port: None });
    }

    #[test]
    fn disabled_does_not_listen() {
        let srv = ExtServer::default();
        let port = free_port();
        let st = srv.apply(false, port, TOKEN, "0.1.0", |_| {}).unwrap();
        assert_eq!(st, ExtStatus { running: false, port: None });
        assert_eq!(srv.generation(), None, "сервер не создавался");
        assert!(port_is_free(port));
    }

    #[test]
    fn binds_only_loopback() {
        let (srv, port, _rx) = start(SHORT, SHORT);
        assert_eq!(Req::ping(port).send(port).status, 200);
        let run = lock(&srv.running);
        assert_eq!(run.as_ref().unwrap().addr, SocketAddr::from(([127, 0, 0, 1], port)));
    }

    #[test]
    fn same_params_do_not_restart() {
        let (srv, port, _rx) = start(SHORT, SHORT);
        let gen = srv.generation();
        srv.apply(true, port, TOKEN, "0.1.0", |_| {}).unwrap();
        assert_eq!(srv.generation(), gen);
        assert_eq!(Req::ping(port).send(port).status, 200);
    }

    #[test]
    fn token_change_rejects_old_token() {
        let (srv, port, _rx) = start(SHORT, SHORT);
        srv.apply(true, port, TOKEN2, "0.2.0", |_| {}).unwrap();
        let old = Req::ping(port).send(port);
        assert_eq!(old.status, 401);
        assert_eq!(old.error(), "Неверный токен");
        let new = Req::ping(port).set("Authorization", Some(&format!("Bearer {TOKEN2}"))).send(port);
        assert_eq!(new.status, 200);
        assert_eq!(new.json()["version"], "0.2.0");
    }

    #[test]
    fn port_change_opens_new_then_closes_old() {
        let (srv, port, _rx) = start(SHORT, SHORT);
        let port2 = apply_free_port(&srv, |_| {});
        assert_ne!(port2, port);
        assert_eq!(srv.status(), ExtStatus { running: true, port: Some(port2) });
        assert_eq!(Req::ping(port2).send(port2).status, 200);
        assert!(port_is_free(port));
    }

    #[test]
    fn busy_port_keeps_previous_server() {
        let (srv, port, _rx) = start(SHORT, SHORT);
        let busy = TcpListener::bind("127.0.0.1:0").unwrap();
        let busy_port = busy.local_addr().unwrap().port();
        let e = srv.apply(true, busy_port, TOKEN, "0.1.0", |_| {}).unwrap_err();
        assert_eq!(e, format!("Порт {busy_port} занят другой программой"));
        assert!(!e.contains(TOKEN));
        assert_eq!(srv.status(), ExtStatus { running: true, port: Some(port) });
        assert_eq!(Req::ping(port).send(port).status, 200);
    }

    #[test]
    fn stop_frees_port_and_reapply_works() {
        let (srv, port, _rx) = start(SHORT, SHORT);
        srv.stop();
        assert_eq!(srv.status(), ExtStatus { running: false, port: None });
        assert!(port_is_free(port));
        // Повторное включение на том же порту сразу после остановки.
        srv.apply(true, port, TOKEN, "0.1.0", |_| {}).unwrap();
        assert_eq!(Req::ping(port).send(port).status, 200);
        srv.apply(false, port, TOKEN, "0.1.0", |_| {}).unwrap();
        assert!(port_is_free(port));
    }

    // ---------- таблица HTTP ----------

    #[test]
    fn row1_host() {
        let (_srv, port, _rx) = start(SHORT, SHORT);
        for host in [Some("localhost:{p}"), Some("127.0.0.1"), Some("evil.example:{p}"), None] {
            let host = host.map(|h| h.replace("{p}", &port.to_string()));
            let r = Req::ping(port).set("Host", host.as_deref()).send(port);
            assert_eq!(r.status, 403, "{host:?}");
            assert_eq!(r.error(), "Недопустимый адрес");
            assert_common_headers(&r);
            assert_eq!(r.header("Access-Control-Allow-Origin"), None);
        }
    }

    #[test]
    fn row2_origin() {
        let (_srv, port, _rx) = start(SHORT, SHORT);
        // Чужой origin — отказ на любом методе.
        for (m, path) in [("GET", "/v1/ping"), ("POST", "/v1/capture"), ("OPTIONS", "/v1/capture")] {
            let r = Req::new(port, m, path).set("Origin", Some("https://evil.example")).send(port);
            assert_eq!(r.status, 403, "{m}");
            assert_eq!(r.error(), "Запрос не от расширения");
            assert_eq!(r.header("Access-Control-Allow-Origin"), None);
        }
        // Без Origin: POST и OPTIONS — отказ, GET /v1/ping — можно.
        let r = Req::capture(port, &page_msg()).set("Origin", None).send(port);
        assert_eq!(r.status, 403);
        let r = Req::new(port, "OPTIONS", "/v1/capture").set("Origin", None).send(port);
        assert_eq!(r.status, 403);
        let r = Req::ping(port).set("Origin", None).send(port);
        assert_eq!(r.status, 200);
        assert_eq!(r.header("Access-Control-Allow-Origin"), None);
    }

    #[test]
    fn row3_preflight() {
        let (_srv, port, _rx) = start(SHORT, SHORT);
        let r = Req::new(port, "OPTIONS", "/v1/capture")
            .set("Authorization", None)
            .set("Access-Control-Request-Method", Some("POST"))
            .send(port);
        assert_eq!(r.status, 204);
        assert_eq!(r.body, "");
        assert_eq!(r.header("Access-Control-Allow-Origin"), Some(ORIGIN));
        assert_eq!(r.header("Access-Control-Allow-Methods"), Some("POST, GET"));
        assert_eq!(r.header("Access-Control-Allow-Headers"), Some("authorization, content-type"));
        assert_eq!(r.header("Access-Control-Allow-Private-Network"), Some("true"));
        assert_eq!(r.header("Access-Control-Max-Age"), Some("600"));
        assert_common_headers(&r);
    }

    #[test]
    fn row4_route() {
        let (_srv, port, _rx) = start(SHORT, SHORT);
        for path in ["/v1/items", "/", "/v1/ping?x=1", "/v1/capture/"] {
            let r = Req::new(port, "GET", path).send(port);
            assert_eq!(r.status, 404, "{path}");
        }
        let r = Req::new(port, "GET", "/v1/capture").send(port);
        assert_eq!(r.status, 405);
        assert_eq!(r.header("Allow"), Some("POST"));
        let r = Req::new(port, "POST", "/v1/ping").send(port);
        assert_eq!(r.status, 405);
        assert_eq!(r.header("Allow"), Some("GET"));
        let r = Req::new(port, "DELETE", "/v1/capture").send(port);
        assert_eq!(r.status, 405);
    }

    #[test]
    fn row5_rate_limit() {
        let (_srv, port, _rx) = start(SHORT, SHORT);
        for i in 0..RATE_MAX {
            assert_eq!(Req::ping(port).send(port).status, 200, "запрос {i}");
        }
        let r = Req::ping(port).send(port);
        assert_eq!(r.status, 429);
        assert_eq!(r.header("Retry-After"), Some("10"));
        assert_eq!(r.header("Access-Control-Allow-Origin"), Some(ORIGIN));
        // Отказы до шага частоты предел не трогают; неверный токен проверяется раньше частоты.
        assert_eq!(Req::new(port, "GET", "/nope").send(port).status, 404);
        assert_eq!(Req::ping(port).set("Authorization", None).send(port).status, 401);
    }

    #[test]
    fn unauth_does_not_consume_rate() {
        let (srv, port, rx) = start(Duration::from_secs(5), Duration::from_secs(5));
        // Так приходит <img src> или fetch no-cors со страницы: GET без Origin и без токена.
        for i in 0..RATE_MAX + 10 {
            let r = Req::ping(port).set("Origin", None).set("Authorization", None).send(port);
            assert_eq!(r.status, 401, "запрос {i}");
        }
        assert_eq!(Req::ping(port).send(port).status, 200);
        let w = worker(srv.clone(), rx, 1, |_| ok_outcome(false));
        let r = Req::capture(port, &page_msg()).send(port);
        assert_eq!(r.status, 200, "{}", r.body);
        w.join().unwrap();
    }

    #[test]
    fn row6_token() {
        let (_srv, port, _rx) = start(SHORT, SHORT);
        let bad = [
            None,
            Some(format!("Bearer {TOKEN2}")),
            Some(format!("Bearer {}", &TOKEN[..42])),
            Some(format!("bearer{TOKEN}")),
            Some(TOKEN.to_string()),
            Some(format!("Basic {TOKEN}")),
        ];
        for auth in bad {
            let r = Req::ping(port).set("Authorization", auth.as_deref()).send(port);
            assert_eq!(r.status, 401, "{auth:?}");
            assert_eq!(r.error(), "Неверный токен");
            assert!(!r.body.contains(TOKEN));
            assert_eq!(r.header("Access-Control-Allow-Origin"), Some(ORIGIN));
        }
        let r = Req::capture(port, &page_msg()).set("Authorization", None).send(port);
        assert_eq!(r.status, 401);
    }

    #[test]
    fn row7_ping() {
        let (_srv, port, rx) = start(SHORT, SHORT);
        let r = Req::ping(port).send(port);
        assert_eq!(r.status, 200);
        assert_eq!(r.json(), json!({ "ok": true, "app": "quickdrop", "version": "0.1.0" }));
        assert_eq!(r.header("Access-Control-Allow-Origin"), Some(ORIGIN));
        assert_common_headers(&r);
        assert!(rx.try_recv().is_err(), "ping не будит главное окно");
    }

    #[test]
    fn row8_content_type() {
        let (_srv, port, _rx) = start(SHORT, SHORT);
        for ct in [Some("text/plain"), Some("application/x-www-form-urlencoded"), None] {
            let r = Req::capture(port, &page_msg()).set("Content-Type", ct).send(port);
            assert_eq!(r.status, 415, "{ct:?}");
        }
    }

    #[test]
    fn row9_content_length() {
        let (srv, port, rx) = start(SHORT, SHORT);
        let r = Req::new(port, "POST", "/v1/capture").no_len().send(port);
        assert_eq!(r.status, 411);
        let chunked = Req::new(port, "POST", "/v1/capture")
            .no_len()
            .set("Transfer-Encoding", Some("chunked"))
            .body(b"0\r\n\r\n".to_vec());
        assert_eq!(chunked.send(port).status, 411);

        // Ровно MAX_BODY — принимается, на байт больше — 413.
        let prefix = r#"{"v":1,"kind":"selection","text":""#;
        let fill = MAX_BODY - prefix.len() - 2;
        let exact = format!("{prefix}{}\"}}", "a".repeat(fill)).into_bytes();
        assert_eq!(exact.len(), MAX_BODY);
        let w = worker(srv.clone(), rx, 1, |_| ok_outcome(false));
        let r = Req::new(port, "POST", "/v1/capture").body(exact).send(port);
        assert_eq!(r.status, 200, "{}", r.body);
        let seen = w.join().unwrap();
        assert_eq!(seen[0].1["text"].as_str().unwrap().len(), fill);

        let over = format!("{prefix}{}\"}}", "a".repeat(fill + 1)).into_bytes();
        let r = Req::new(port, "POST", "/v1/capture").body(over).send(port);
        assert_eq!(r.status, 413);
        assert_eq!(r.error(), "Слишком большой запрос");
        assert!(srv.take_pending().is_empty());
    }

    /// Ждёт, пока сервер не отпустит все соединения.
    fn wait_idle(srv: &ExtServer, within: Duration) -> bool {
        let deadline = Instant::now() + within;
        while srv.active_connections() > 0 {
            if Instant::now() >= deadline {
                return false;
            }
            thread::sleep(Duration::from_millis(20));
        }
        true
    }

    /// Соединение закрыто сервером: чтение даёт конец потока или ошибку, а не таймаут.
    fn is_closed_by_server(s: &mut TcpStream, wait: Duration) -> bool {
        s.set_read_timeout(Some(wait)).unwrap();
        let mut buf = [0u8; 256];
        loop {
            match s.read(&mut buf) {
                Ok(0) => return true,
                Ok(_) => {}
                Err(e) => return !matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut),
            }
        }
    }

    #[test]
    fn huge_declared_length_does_not_crash() {
        let (srv, port, _rx) = start(SHORT, SHORT);
        let raw = format!(
            "POST /v1/capture HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: {ORIGIN}\r\n\
             Authorization: Bearer {TOKEN}\r\nContent-Type: application/json\r\n\
             Content-Length: 99999999999999\r\nConnection: close\r\n\r\n{{}}"
        );
        // Ответ сразу, тело не читается и память под него не выделяется.
        let r = send_raw(port, raw.as_bytes(), Duration::from_secs(5)).expect("нет ответа");
        assert_eq!(r.status, 413);
        assert_eq!(Req::ping(port).send(port).status, 200);
        // Чужой запрос с недочитанным телом (клиент молчит) не останавливает приём.
        let raw = "POST /v1/capture HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100000\r\nConnection: close\r\n\r\n";
        let mut slow = TcpStream::connect(("127.0.0.1", port)).unwrap();
        slow.write_all(raw.as_bytes()).unwrap();
        thread::sleep(Duration::from_millis(200));
        assert_eq!(Req::ping(port).send(port).status, 200);
        drop(slow);
        assert!(wait_idle(&srv, Duration::from_secs(3)), "осталось {}", srv.active_connections());
    }

    #[test]
    fn no_leak_on_huge_length() {
        let (srv, port, _rx) = start(SHORT, SHORT);
        let raw = format!(
            "POST / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: https://evil.example\r\n\
             Content-Length: 99999999999999\r\n\r\n"
        );
        for _ in 0..200 {
            // Очередь входящих при всплеске может переполниться — такой отказ тоже годится.
            if let Ok(mut s) = TcpStream::connect(("127.0.0.1", port)) {
                let _ = s.write_all(raw.as_bytes());
            }
        }
        assert!(wait_idle(&srv, Duration::from_secs(3)), "осталось {}", srv.active_connections());
        assert_eq!(Req::ping(port).send(port).status, 200);
        assert_eq!(srv.status(), ExtStatus { running: true, port: Some(port) });
    }

    #[test]
    fn slow_clients_bounded() {
        let head = Duration::from_millis(500);
        let srv = Arc::new(ExtServer::with_timeouts(SHORT, SHORT).with_head_timeout(head));
        let port = apply_free_port(&srv, |_| {});
        let mut conns: Vec<TcpStream> =
            (0..20).map(|_| TcpStream::connect(("127.0.0.1", port)).unwrap()).collect();
        // Сверх предела соединения не сбрасываются, а ждут в очереди; ping встаёт за ними.
        let started = Instant::now();
        let ping = thread::spawn(move || Req::ping(port).send(port).status);
        let mut max_active = 0;
        while !ping.is_finished() && started.elapsed() < Duration::from_secs(5) {
            max_active = max_active.max(srv.active_connections());
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(ping.join().unwrap(), 200);
        let waited = started.elapsed();
        assert!(max_active <= MAX_CONN, "{max_active}");
        // 20 молчащих: два полных захода по MAX_CONN, третий — вместе с ping.
        assert!(waited <= 2 * head + Duration::from_millis(700), "ping ждал {waited:?}");
        assert!(wait_idle(&srv, head + Duration::from_secs(2)), "осталось {}", srv.active_connections());
        assert!(conns.iter_mut().all(|s| is_closed_by_server(s, Duration::from_secs(1))));
    }

    /// Похоже на TLS ClientHello: так шлёт браузер, когда страница обращается к `https://127.0.0.1:{порт}`.
    const TLS_HELLO: [u8; 16] = [0x16, 0x03, 0x01, 0x02, 0x00, 0x01, 0x00, 0x01, 0xfc, 0x03, 0x03, 0x8a, 0x1f, 0, 0, 0];

    #[test]
    fn binary_and_silent_clients_do_not_block_ping() {
        let (srv, port, _rx) = start(SHORT, SHORT);
        let mut tls: Vec<TcpStream> = (0..MAX_CONN)
            .map(|_| {
                let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
                s.write_all(&TLS_HELLO).unwrap();
                s
            })
            .collect();
        // Молчащие (как `<link rel=preconnect>`) занимают все места до срока заголовков.
        let _silent: Vec<TcpStream> =
            (0..MAX_CONN).map(|_| TcpStream::connect(("127.0.0.1", port)).unwrap()).collect();
        let started = Instant::now();
        assert_eq!(Req::ping(port).send(port).status, 200);
        let waited = started.elapsed();
        assert!(waited <= HEAD_TIMEOUT + Duration::from_millis(700), "ping ждал {waited:?}");
        // TLS закрыт сразу, без ответа и без срока заголовков.
        for s in tls.iter_mut() {
            assert!(is_closed_by_server(s, Duration::from_millis(300)));
        }
        assert!(wait_idle(&srv, Duration::from_secs(3)), "осталось {}", srv.active_connections());
    }

    #[test]
    fn non_http_bytes_close_at_once() {
        let (srv, port, _rx) = start(SHORT, SHORT);
        let cases: [&[u8]; 4] =
            [&TLS_HELLO, b"get /v1/ping HTTP/1.1\r\n", b"GET /v1/ping\x00 HTTP/1.1\r\n", b"\x7fELF"];
        for raw in cases {
            let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
            s.write_all(raw).unwrap();
            let started = Instant::now();
            assert!(is_closed_by_server(&mut s, Duration::from_millis(500)), "{raw:?}");
            assert!(started.elapsed() < Duration::from_millis(500), "{raw:?}");
        }
        assert!(wait_idle(&srv, Duration::from_secs(2)), "осталось {}", srv.active_connections());
        assert_eq!(Req::ping(port).send(port).status, 200);
    }

    #[test]
    fn head_split_across_reads() {
        let (_srv, port, _rx) = start(SHORT, SHORT);
        // Конец заголовков разрезан: `\r\n\r` в одном пакете, `\n` — в следующем.
        let raw = Req::ping(port).raw();
        let cut = raw.len() - 1;
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_nodelay(true).unwrap();
        s.write_all(&raw[..cut]).unwrap();
        thread::sleep(Duration::from_millis(100));
        s.write_all(&raw[cut..]).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let mut out = Vec::new();
        let _ = s.read_to_end(&mut out);
        assert_eq!(parse_response(&out).expect("нет ответа").status, 200);
    }

    #[test]
    fn head_bytes() {
        assert!(is_head_start(b'G') && is_head_start(b'\r') && is_head_start(b'\n'));
        assert!(!is_head_start(b'g') && !is_head_start(0x16) && !is_head_start(b' '));
        assert!(b"GET /x HTTP/1.1\r\nA:\tb".iter().copied().all(is_head_byte));
        assert!(is_head_byte(0xd0), "obs-text проверит разбор UTF-8");
        for b in [0x00, 0x01, 0x16, 0x1b, 0x7f] {
            assert!(!is_head_byte(b), "{b:#x}");
        }
    }

    #[test]
    fn sequential_requests_are_fast() {
        let (_srv, port, _rx) = start(SHORT, SHORT);
        assert_eq!(Req::ping(port).send(port).status, 200);
        for i in 0..5 {
            let started = Instant::now();
            assert_eq!(Req::ping(port).send(port).status, 200);
            let took = started.elapsed();
            assert!(took < Duration::from_millis(20), "запрос {i}: {took:?}");
        }
    }

    #[test]
    fn stop_returns_quickly_and_port_rebinds() {
        let (srv, port, _rx) = start(SHORT, SHORT);
        assert_eq!(Req::ping(port).send(port).status, 200);
        let started = Instant::now();
        srv.stop();
        let took = started.elapsed();
        assert!(took < Duration::from_millis(200), "stop занял {took:?}");
        drop(TcpListener::bind(("127.0.0.1", port)).expect("порт свободен сразу после stop"));
        let started = Instant::now();
        srv.apply(true, port, TOKEN, "0.1.0", |_| {}).unwrap();
        assert!(started.elapsed() < REBIND_STEP, "apply ждал {:?}", started.elapsed());
        assert_eq!(Req::ping(port).send(port).status, 200);
    }

    #[test]
    fn stop_while_all_slots_busy() {
        let (srv, port, _rx) = start(SHORT, SHORT);
        let _silent: Vec<TcpStream> =
            (0..MAX_CONN + 2).map(|_| TcpStream::connect(("127.0.0.1", port)).unwrap()).collect();
        thread::sleep(Duration::from_millis(100));
        let started = Instant::now();
        srv.stop();
        assert!(started.elapsed() < Duration::from_millis(300), "stop занял {:?}", started.elapsed());
        assert_eq!(srv.status(), ExtStatus { running: false, port: None });
        assert!(port_is_free(port));
    }

    #[test]
    fn header_too_large() {
        let (srv, port, _rx) = start(SHORT, SHORT);
        let raw = format!(
            "GET /v1/ping HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-Pad: {}\r\n\r\n",
            "a".repeat(MAX_HEAD + 100)
        );
        let r = send_raw(port, raw.as_bytes(), Duration::from_secs(5)).expect("нет ответа");
        assert_eq!(r.status, 431);
        assert!(wait_idle(&srv, Duration::from_secs(3)), "осталось {}", srv.active_connections());
        assert_eq!(Req::ping(port).send(port).status, 200);
    }

    #[test]
    fn malformed_requests_are_400() {
        let (_srv, port, _rx) = start(SHORT, SHORT);
        let host = format!("Host: 127.0.0.1:{port}\r\n");
        for raw in [
            format!("GET /v1/ping\r\n{host}\r\n"),
            format!("GET /v1/ping HTTP/2.0\r\n{host}\r\n"),
            format!("GET  /v1/ping HTTP/1.1\r\n{host}\r\n"),
            format!("GET /v1/ping HTTP/1.1\r\n{host} folded\r\n\r\n"),
            format!("GET /v1/ping HTTP/1.1\r\n{host}Bad Name: x\r\n\r\n"),
            "\r\n\r\n".to_string(),
        ] {
            let r = send_raw(port, raw.as_bytes(), Duration::from_secs(5)).expect("нет ответа");
            assert_eq!(r.status, 400, "{raw:?}");
        }
        // Повтор заголовка и негодная длина.
        let r = Req::capture(port, &page_msg()).set("Content-Length", Some("12, 12")).no_len().send(port);
        assert_eq!(r.status, 400);
        let twice = format!(
            "GET /v1/ping HTTP/1.1\r\n{host}{host}Authorization: Bearer {TOKEN}\r\nConnection: close\r\n\r\n"
        );
        let r = send_raw(port, twice.as_bytes(), Duration::from_secs(5)).expect("нет ответа");
        assert_eq!(r.status, 403);
    }

    #[test]
    fn expect_continue_is_answered() {
        let (srv, port, rx) = start(Duration::from_secs(5), Duration::from_secs(5));
        let w = worker(srv.clone(), rx, 1, |_| ok_outcome(false));
        let body = page_msg().to_string();
        let head = format!(
            "POST /v1/capture HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: {ORIGIN}\r\n\
             Authorization: Bearer {TOKEN}\r\nContent-Type: application/json\r\n\
             Content-Length: {}\r\nExpect: 100-continue\r\nConnection: close\r\n\r\n",
            body.len()
        );
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        s.write_all(head.as_bytes()).unwrap();
        let mut buf = [0u8; 64];
        let n = s.read(&mut buf).unwrap();
        assert!(buf[..n].starts_with(b"HTTP/1.1 100 Continue\r\n\r\n"));
        s.write_all(body.as_bytes()).unwrap();
        let mut out = Vec::new();
        let _ = s.read_to_end(&mut out);
        assert_eq!(parse_response(&out).unwrap().status, 200);
        w.join().unwrap();
    }

    #[test]
    fn head_parsing() {
        let h = parse_head(b"POST /v1/capture HTTP/1.1\r\nHost: 127.0.0.1:1\r\nX-Empty:\r\nA:  b c \t").unwrap();
        assert_eq!(h.method, "POST");
        assert_eq!(h.path, "/v1/capture");
        assert_eq!(
            h.headers,
            vec![
                ("Host".into(), "127.0.0.1:1".into()),
                ("X-Empty".into(), String::new()),
                ("A".into(), "b c".into())
            ]
        );
        assert!(parse_head(b"GET /x HTTP/1.0").is_some());
        assert!(parse_head(b"").is_none());
        assert!(parse_head(b"GET /x HTTP/1.1 extra").is_none());
        assert!(parse_head(b"G(T /x HTTP/1.1").is_none());
        assert!(parse_head(b"GET /x\x01 HTTP/1.1").is_none());
        assert!(parse_head(b"GET /x HTTP/1.1\r\nNoColon").is_none());
        assert!(parse_head(b"GET /x HTTP/1.1\r\n\tfolded: x").is_none());
        assert!(parse_head(b"GET /x HTTP/1.1\r\nA: b\nInjected: c").is_none());
        assert!(parse_head(b"GET /x HTTP/1.1\r\nA: \xff").is_none());
    }

    #[test]
    fn content_length_parsing() {
        assert_eq!(parse_content_length("0"), Some(0));
        assert_eq!(parse_content_length("1048576"), Some(1_048_576));
        assert_eq!(parse_content_length("99999999999999999999999"), Some(u64::MAX));
        assert_eq!(parse_content_length(""), None);
        assert_eq!(parse_content_length("-1"), None);
        assert_eq!(parse_content_length("12, 12"), None);
        assert_eq!(parse_content_length("+5"), None);
    }

    #[test]
    fn response_format() {
        let raw = build_response(Reply::error(404, "Не найдено").origin(&Some(ORIGIN.into())).with("Bad\r\nX", "1"));
        let text = String::from_utf8(raw.clone()).unwrap();
        assert!(text.starts_with("HTTP/1.1 404 Not Found\r\n"));
        assert!(text.contains("\r\nConnection: close\r\n"));
        assert!(!text.contains("Bad"), "заголовок с переводом строки не пропускается");
        let r = parse_response(&raw).unwrap();
        assert_eq!(r.header("Content-Length"), Some(r.body.len().to_string().as_str()));
        let no_content = String::from_utf8(build_response(Reply {
            status: 204,
            body: None,
            origin: None,
            extra: Vec::new(),
        }))
        .unwrap();
        assert!(!no_content.contains("Content-Length"));
        assert!(no_content.ends_with("\r\n\r\n"));
    }

    #[test]
    fn row10_body() {
        let (srv, port, rx) = start(SHORT, SHORT);
        let bodies: Vec<Vec<u8>> = vec![
            b"not json".to_vec(),
            b"[1,2]".to_vec(),
            b"\"text\"".to_vec(),
            br#"{"v":2,"kind":"page"}"#.to_vec(),
            br#"{"v":"1","kind":"page"}"#.to_vec(),
            br#"{"kind":"page"}"#.to_vec(),
            vec![b'{', b'"', 0xff, 0xfe, b'"', b':', b'1', b'}'],
            Vec::new(),
        ];
        for b in bodies {
            let r = Req::new(port, "POST", "/v1/capture").body(b.clone()).send(port);
            assert_eq!(r.status, 400, "{:?}", String::from_utf8_lossy(&b));
            assert_eq!(r.error(), "Неверный формат запроса");
        }
        assert!(rx.try_recv().is_err());
        assert!(srv.take_pending().is_empty());
    }

    // ---------- шаг 11: передача главному окну ----------

    #[test]
    fn capture_saved_and_duplicate() {
        let (srv, port, rx) = start(Duration::from_secs(5), Duration::from_secs(5));
        let w = worker(srv.clone(), rx, 2, |m| ok_outcome(m["url"] == "https://dup.example/"));
        let r = Req::capture(port, &page_msg()).send(port);
        assert_eq!(r.status, 200);
        assert_eq!(r.json(), json!({ "ok": true, "duplicate": false }));
        assert_eq!(r.header("Access-Control-Allow-Origin"), Some(ORIGIN));
        assert_common_headers(&r);
        let dup = json!({ "v": 1, "kind": "link", "url": "https://dup.example/" });
        let r = Req::capture(port, &dup).send(port);
        assert_eq!(r.status, 200);
        assert_eq!(r.json(), json!({ "ok": true, "duplicate": true }));
        let seen = w.join().unwrap();
        assert_eq!(seen.len(), 2);
        assert_eq!(seen[0].1, page_msg());
        assert_eq!(seen[1].1, dup);
        assert!(seen[0].0 < seen[1].0);
        assert!(srv.take_pending().is_empty());
    }

    #[test]
    fn capture_error_is_422() {
        let (srv, port, rx) = start(Duration::from_secs(5), Duration::from_secs(5));
        let w = worker(srv.clone(), rx, 2, |m| {
            let error = if m["kind"] == "page" { "Адрес не поддерживается".to_string() } else { "я".repeat(2000) };
            Some(ExtOutcome { ok: false, duplicate: false, error: Some(error) })
        });
        let r = Req::capture(port, &page_msg()).send(port);
        assert_eq!(r.status, 422);
        assert_eq!(r.json(), json!({ "ok": false, "error": "Адрес не поддерживается" }));
        let r = Req::capture(port, &json!({ "v": 1, "kind": "selection", "text": "x" })).send(port);
        assert_eq!(r.status, 422);
        assert_eq!(r.error().chars().count(), ERROR_MAX_CHARS);
        w.join().unwrap();
    }

    #[test]
    fn not_taken_is_504_and_slot_cleared() {
        let (srv, port, rx) = start(SHORT, SHORT);
        let started = Instant::now();
        let r = Req::capture(port, &page_msg()).send(port);
        assert_eq!(r.status, 504);
        assert_eq!(r.error(), "QuickDrop не отвечает, запись не сохранена");
        assert!(started.elapsed() >= SHORT);
        assert!(rx.try_recv().is_ok(), "будильник был");
        assert!(srv.take_pending().is_empty());
    }

    #[test]
    fn taken_without_confirm_is_504() {
        let (srv, port, rx) = start(SHORT, SHORT);
        let w = worker(srv.clone(), rx, 1, |_| None);
        let r = Req::capture(port, &page_msg()).send(port);
        assert_eq!(r.status, 504);
        assert_eq!(r.error(), "QuickDrop не подтвердил сохранение. Проверьте «Входящие»");
        let seen = w.join().unwrap();
        // Опоздавшее подтверждение и неизвестный номер игнорируются.
        srv.complete(seen[0].0, ExtOutcome { ok: true, duplicate: false, error: None });
        srv.complete(9999, ExtOutcome { ok: true, duplicate: false, error: None });
        assert!(srv.take_pending().is_empty());
        assert_eq!(Req::ping(port).send(port).status, 200);
    }

    #[test]
    fn stop_with_pending_is_503() {
        let (srv, port, rx) = start(Duration::from_secs(10), Duration::from_secs(10));
        let client = thread::spawn(move || Req::capture(port, &page_msg()).send(port));
        rx.recv_timeout(Duration::from_secs(5)).expect("будильник");
        srv.stop();
        let r = client.join().unwrap();
        assert_eq!(r.status, 503);
        assert_eq!(r.error(), "Приём выключен, запись не сохранена");
        assert!(srv.take_pending().is_empty());
        assert!(port_is_free(port));
    }

    #[test]
    fn pending_message_is_taken_once() {
        let (srv, port, rx) = start(Duration::from_secs(5), Duration::from_secs(5));
        let client = thread::spawn(move || Req::capture(port, &page_msg()).send(port));
        let id = rx.recv_timeout(Duration::from_secs(5)).expect("будильник");
        let first = srv.take_pending();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].request_id, id);
        assert!(srv.take_pending().is_empty(), "забранное не отдаётся повторно");
        let as_json = serde_json::to_value(&first[0]).unwrap();
        assert_eq!(as_json["requestId"], id);
        assert_eq!(as_json["message"], page_msg());
        srv.complete(id, ExtOutcome { ok: true, duplicate: false, error: None });
        assert_eq!(client.join().unwrap().status, 200);
    }

    #[test]
    fn state_is_send_sync() {
        // tauri::State требует Send + Sync + 'static.
        fn assert_state<T: Send + Sync + 'static>() {}
        assert_state::<ExtServer>();
    }

    #[test]
    fn status_serializes_camel_case() {
        let v = serde_json::to_value(ExtStatus { running: true, port: Some(47821) }).unwrap();
        assert_eq!(v, json!({ "running": true, "port": 47821 }));
    }
}
