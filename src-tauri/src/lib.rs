use futures_util::StreamExt;
use reqwest::{
    dns::{Addrs, Name, Resolve, Resolving},
    header,
    redirect::Policy,
};
use serde::Serialize;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, ToSocketAddrs};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

mod backup;
mod ext_server;
mod shell;

const MAX_BYTES: usize = 512 * 1024;
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkMeta {
    html: String,
    final_url: String,
}

fn check_scheme(u: &url::Url) -> bool {
    matches!(u.scheme(), "http" | "https")
}

const PRIVATE_REDIRECT: &str = "Перенаправление с внешнего адреса во внутреннюю сеть запрещено";

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_documentation()
        || a == 0
        || (a == 100 && (b & 0xc0) == 64) // 100.64.0.0/10, CGNAT
        || (a == 198 && (b & 0xfe) == 18) // 198.18.0.0/15
        || a >= 240)
}

/// Адрес из публичного интернета (не loopback, не частная сеть, не link-local и т.п.).
fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_v4(v4);
            }
            let seg0 = v6.segments()[0];
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (seg0 & 0xfe00) == 0xfc00 // fc00::/7, unique local
                || (seg0 & 0xffc0) == 0xfe80 // fe80::/10, link-local
                || (seg0 & 0xffc0) == 0xfec0) // fec0::/10, site-local
        }
    }
}

fn host_ip(u: &url::Url) -> Option<IpAddr> {
    match u.host()? {
        url::Host::Ipv4(ip) => Some(IpAddr::V4(ip)),
        url::Host::Ipv6(ip) => Some(IpAddr::V6(ip)),
        url::Host::Domain(_) => None,
    }
}

async fn lookup(host: String) -> std::io::Result<Vec<SocketAddr>> {
    tauri::async_runtime::spawn_blocking(move || {
        (host.as_str(), 0).to_socket_addrs().map(|a| a.collect())
    })
    .await
    .map_err(|e| std::io::Error::other(e.to_string()))?
}

/// Исходная ссылка ведёт в локальную сеть (прямые ссылки на роутер, NAS и т.п. разрешены намеренно).
async fn targets_private_network(u: &url::Url) -> bool {
    if let Some(ip) = host_ip(u) {
        return !is_public_ip(ip);
    }
    match u.host_str() {
        Some(host) => lookup(host.to_string())
            .await
            .map(|addrs| addrs.iter().any(|a| !is_public_ip(a.ip())))
            .unwrap_or(false),
        None => false,
    }
}

/// DNS с фильтром: для публичной исходной ссылки не подключаться к внутренним адресам —
/// ни после редиректа, ни при повторном резолве того же имени (DNS rebinding).
struct PublicOnlyResolver;

impl Resolve for PublicOnlyResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let addrs: Vec<SocketAddr> = lookup(host)
                .await?
                .into_iter()
                .filter(|a| is_public_ip(a.ip()))
                .collect();
            if addrs.is_empty() {
                return Err(PRIVATE_REDIRECT.into());
            }
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

/// charset из значения заголовка Content-Type.
fn charset_from_content_type(ct: &str) -> Option<String> {
    let lower = ct.to_ascii_lowercase();
    let idx = lower.find("charset=")?;
    let rest = &ct[idx + 8..];
    let v: String = rest
        .trim_start()
        .trim_start_matches(['"', '\''])
        .chars()
        .take_while(|c| !matches!(c, ';' | '"' | '\'' | ' ' | ','))
        .collect();
    if v.is_empty() { None } else { Some(v) }
}

/// charset из <meta> в начале документа (ищем по ASCII-байтам).
fn charset_from_meta(bytes: &[u8]) -> Option<String> {
    let head = &bytes[..bytes.len().min(4096)];
    let lower: Vec<u8> = head.iter().map(|b| b.to_ascii_lowercase()).collect();
    let needle = b"charset";
    let mut from = 0;
    while let Some(pos) = lower[from..].windows(needle.len()).position(|w| w == needle) {
        let mut i = from + pos + needle.len();
        while i < lower.len() && (lower[i] == b' ' || lower[i] == b'\t') {
            i += 1;
        }
        if i < lower.len() && lower[i] == b'=' {
            i += 1;
            while i < lower.len() && matches!(lower[i], b' ' | b'\t' | b'"' | b'\'') {
                i += 1;
            }
            let start = i;
            while i < lower.len()
                && (lower[i].is_ascii_alphanumeric() || matches!(lower[i], b'-' | b'_' | b':' | b'.'))
            {
                i += 1;
            }
            if i > start {
                return Some(String::from_utf8_lossy(&lower[start..i]).into_owned());
            }
        }
        from += pos + needle.len();
    }
    None
}

fn decode(bytes: &[u8], header_charset: Option<String>) -> String {
    if let Some((enc, _)) = encoding_rs::Encoding::for_bom(bytes) {
        return enc.decode_with_bom_removal(bytes).0.into_owned();
    }
    let label = header_charset.or_else(|| charset_from_meta(bytes));
    if let Some(enc) = label.and_then(|l| encoding_rs::Encoding::for_label(l.as_bytes())) {
        return enc.decode_without_bom_handling(bytes).0.into_owned();
    }
    String::from_utf8_lossy(bytes).into_owned()
}

/// HTTP-клиент для метаданных ссылки. Без allow_private внутренние адреса недоступны
/// ни через редирект (IP в адресе), ни через DNS.
fn link_client(allow_private: bool) -> reqwest::Result<reqwest::Client> {
    let policy = Policy::custom(move |attempt| {
        if !check_scheme(attempt.url()) {
            attempt.error("Редирект на недопустимую схему")
        } else if !allow_private && host_ip(attempt.url()).is_some_and(|ip| !is_public_ip(ip)) {
            attempt.error(PRIVATE_REDIRECT)
        } else if attempt.previous().len() >= 5 {
            attempt.error("Слишком много перенаправлений")
        } else {
            attempt.follow()
        }
    });

    let mut builder = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(policy)
        .user_agent(USER_AGENT);
    if !allow_private {
        builder = builder.dns_resolver(Arc::new(PublicOnlyResolver));
    }
    builder.build()
}

#[tauri::command]
async fn fetch_link_meta(url: String) -> Result<LinkMeta, String> {
    let parsed = url::Url::parse(url.trim()).map_err(|e| format!("Некорректная ссылка: {e}"))?;
    if !check_scheme(&parsed) {
        return Err("Разрешены только ссылки http и https".into());
    }

    // Нативный клиент обходит ограничения браузера (CORS, Private Network Access):
    // публичная страница не должна редиректом направить запрос на устройство в локальной сети.
    let allow_private = targets_private_network(&parsed).await;
    let client = link_client(allow_private).map_err(|e| e.to_string())?;

    let resp = client
        .get(parsed)
        .header(header::ACCEPT, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5")
        .header(header::ACCEPT_LANGUAGE, "ru,en;q=0.8")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let final_url = resp.url().clone();
    if !check_scheme(&final_url) {
        return Err("Редирект на недопустимую схему".into());
    }
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }

    let content_type = resp
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let ct_lower = content_type.to_ascii_lowercase();
    if !(ct_lower.contains("text/html") || ct_lower.contains("application/xhtml")) {
        return Err(format!("Не HTML: {}", if content_type.is_empty() { "тип не указан" } else { &content_type }));
    }

    let mut buf: Vec<u8> = Vec::with_capacity(64 * 1024);
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        let room = MAX_BYTES - buf.len();
        if chunk.len() >= room {
            buf.extend_from_slice(&chunk[..room]);
            break;
        }
        buf.extend_from_slice(&chunk);
    }

    Ok(LinkMeta {
        html: decode(&buf, charset_from_content_type(&content_type)),
        final_url: final_url.to_string(),
    })
}

/// Итог скачивания для фронтенда: в macOS файл сохраняется без системного интерфейса.
#[derive(Clone, Serialize)]
struct DownloadFinished {
    name: Option<String>,
    success: bool,
}

/// Событие, которое слушает src/lib/desktop.ts.
const DOWNLOAD_FINISHED: &str = "download-finished";

/// Обработчик скачиваний (`<a download>`: экспорт копии, «Скачать» у файла).
/// WKWebView без обработчика отменяет скачивание молча, поэтому в macOS он обязателен.
/// Путь по умолчанию wry уже подставил: «Загрузки/<имя>», с номером, если имя занято.
fn download_handler<R: tauri::Runtime>(
) -> impl Fn(tauri::Webview<R>, tauri::webview::DownloadEvent<'_>) -> bool + Send + Sync + 'static {
    use tauri::webview::DownloadEvent;
    use tauri::Emitter;
    // В macOS Finished приходит без пути: запоминаем его из Requested.
    let started: Arc<Mutex<HashMap<String, PathBuf>>> = Arc::default();
    move |webview, event| {
        match event {
            DownloadEvent::Requested { url, destination } => {
                if let Ok(mut map) = started.lock() {
                    map.insert(url.to_string(), destination.clone());
                }
            }
            DownloadEvent::Finished { url, path, success } => {
                let requested = started.lock().ok().and_then(|mut map| map.remove(url.as_str()));
                let name = path
                    .or(requested)
                    .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()));
                let _ = webview.emit(DOWNLOAD_FINISHED, DownloadFinished { name, success });
            }
            _ => {}
        }
        true
    }
}

/// Главное окно создаётся здесь, а не из конфига автоматически (`create: false`):
/// обработчик скачиваний задаётся только при создании окна.
/// `hidden` — запуск при входе в систему (`--autostart`): окно создаётся скрытым, его показывает трей.
fn create_main_window(app: &tauri::App, hidden: bool) -> tauri::Result<()> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
        .ok_or(tauri::Error::WindowNotFound)?;
    let builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?;
    // Скрытое окно не забирает ввод при создании (WebView2 переводит фокус даже в невидимое окно).
    let builder = if hidden { builder.visible(false).focused(false) } else { builder };
    // Windows (WebView2) скачивает сам и показывает свою панель загрузок — его не трогаем.
    let builder = if cfg!(target_os = "macos") {
        builder.on_download(download_handler())
    } else {
        builder
    };
    builder.build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // single-instance — первым: второй запуск exe не должен успеть поднять остальное.
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
                shell::on_second_instance(app, &args)
            }))
            .plugin(tauri_plugin_global_shortcut::Builder::new().build());
        // Автозапуск — без плагина, в shell::init (режим Windows только HKCU).
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;
            let config_dir = app.path().app_config_dir()?;
            app.manage(backup::ApprovedDirs::load(config_dir.join("approved-dirs.json")));
            app.manage(backup::OwnBackups::load(config_dir.join("own-backups.json")));
            app.manage(ext_server::ExtServer::default());
            shell::init(app)?;
            create_main_window(app, shell::started_hidden())?;
            Ok(())
        })
        .on_window_event(|window, event| shell::on_window_event(window, event))
        .invoke_handler(tauri::generate_handler![
            fetch_link_meta,
            backup::pick_directory,
            backup::forget_directory,
            backup::retain_directories,
            backup::save_backup,
            backup::prune_backups,
            backup::list_backups,
            backup::write_export_file,
            backup::discard_export_part,
            shell::set_shell_options,
            shell::toggle_capture_window,
            shell::capture_pointer_down,
            shell::show_main_window,
            shell::open_in_main,
            shell::quit_app,
            shell::get_autostart,
            shell::set_autostart,
            shell::extension_dir,
            ext_server::ext_server_apply,
            ext_server::ext_server_status,
            ext_server::ext_take_pending,
            ext_server::ext_capture_done
        ])
        .build(tauri::generate_context!())
        .expect("ошибка запуска QuickDrop")
        .run(|app, event| shell::on_run_event(app, &event));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn public_ip_classification() {
        for s in ["8.8.8.8", "93.184.216.34", "100.128.0.1", "2606:4700::1111", "::ffff:8.8.8.8"] {
            assert!(is_public_ip(ip(s)), "{s} должен быть публичным");
        }
        for s in [
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "0.0.0.0",
            "100.64.0.1",
            "198.18.0.1",
            "255.255.255.255",
            "240.0.0.1",
            "224.0.0.1",
            "::1",
            "::",
            "fd00::1",
            "fe80::1",
            "ff02::1",
            "::ffff:192.168.0.1",
            "::ffff:127.0.0.1",
        ] {
            assert!(!is_public_ip(ip(s)), "{s} должен считаться внутренним");
        }
    }

    #[test]
    fn host_ip_from_url() {
        let u = url::Url::parse("http://2130706433/").unwrap();
        assert_eq!(host_ip(&u), Some(ip("127.0.0.1")));
        let u = url::Url::parse("http://[::1]:8080/x").unwrap();
        assert_eq!(host_ip(&u), Some(ip("::1")));
        let u = url::Url::parse("https://example.com/").unwrap();
        assert_eq!(host_ip(&u), None);
    }

    #[test]
    fn private_target_detection() {
        let check = |s: &str| tauri::async_runtime::block_on(targets_private_network(&url::Url::parse(s).unwrap()));
        assert!(check("http://192.168.1.1/"));
        assert!(check("http://[fe80::1]/"));
        assert!(check("http://localhost:8080/"));
        assert!(!check("https://8.8.8.8/"));
    }

    /// Локальный сервер: на каждый запрос отвечает редиректом на `location`.
    fn redirect_server(location: &'static str) -> std::net::SocketAddr {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for mut stream in listener.incoming().flatten() {
                let mut buf = [0u8; 2048];
                let _ = stream.read(&mut buf);
                let resp = format!("HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                let _ = stream.write_all(resp.as_bytes());
            }
        });
        addr
    }

    fn error_chain(e: &dyn std::error::Error) -> String {
        let mut out = e.to_string();
        let mut cur = e.source();
        while let Some(s) = cur {
            out.push_str(" / ");
            out.push_str(&s.to_string());
            cur = s.source();
        }
        out
    }

    /// Клиент создаётся внутри рантайма: reqwest требует реактор tokio.
    fn get(allow_private: bool, url: String) -> Result<reqwest::Response, reqwest::Error> {
        tauri::async_runtime::block_on(async move { link_client(allow_private)?.get(url).send().await })
    }

    #[test]
    fn public_client_refuses_redirect_to_private_ip() {
        let addr = redirect_server("http://127.0.0.1:9/admin");
        let err = get(false, format!("http://{addr}/")).unwrap_err();
        assert!(error_chain(&err).contains(PRIVATE_REDIRECT), "{}", error_chain(&err));
    }

    #[test]
    fn public_client_refuses_private_dns_names() {
        let addr = redirect_server("http://127.0.0.1:9/admin");
        let err = get(false, format!("http://localhost:{}/", addr.port())).unwrap_err();
        assert!(error_chain(&err).contains(PRIVATE_REDIRECT), "{}", error_chain(&err));
    }

    #[test]
    fn private_link_may_redirect_inside_network() {
        let addr = redirect_server("/next");
        let err = get(true, format!("http://localhost:{}/", addr.port())).unwrap_err();
        // ходит по редиректам внутри сети, пока не упрётся в лимит
        assert!(error_chain(&err).contains("Слишком много перенаправлений"), "{}", error_chain(&err));
    }

    // Сетевой: запускать вручную, cargo test -- --ignored
    #[test]
    #[ignore]
    fn fetch_public_page() {
        let meta = tauri::async_runtime::block_on(fetch_link_meta("https://example.com/".into())).unwrap();
        assert!(meta.html.to_ascii_lowercase().contains("<title>"));
    }
}
