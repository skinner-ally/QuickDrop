use futures_util::StreamExt;
use reqwest::{header, redirect::Policy};
use serde::Serialize;
use std::time::Duration;

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

#[tauri::command]
async fn fetch_link_meta(url: String) -> Result<LinkMeta, String> {
    let parsed = url::Url::parse(url.trim()).map_err(|e| format!("Некорректная ссылка: {e}"))?;
    if !check_scheme(&parsed) {
        return Err("Разрешены только ссылки http и https".into());
    }

    let policy = Policy::custom(|attempt| {
        if !check_scheme(attempt.url()) {
            attempt.error("Редирект на недопустимую схему")
        } else if attempt.previous().len() >= 5 {
            attempt.error("Слишком много перенаправлений")
        } else {
            attempt.follow()
        }
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(policy)
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        use tauri::Manager;
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.unminimize();
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }))
            .plugin(tauri_plugin_global_shortcut::Builder::new().build());
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![fetch_link_meta])
        .run(tauri::generate_context!())
        .expect("ошибка запуска QuickDrop");
}
