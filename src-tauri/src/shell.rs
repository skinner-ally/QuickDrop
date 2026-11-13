//! Оболочка настольного приложения: мини-окно быстрой записи, значок в трее, закрытие главного окна,
//! второй запуск exe, автозапуск и путь к папке расширения Chrome из установщика. Модуль самодостаточен (не ссылается на `crate::…`).

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, Window, WindowEvent};

pub const MAIN_LABEL: &str = "main";
pub const CAPTURE_LABEL: &str = "capture";
pub const AUTOSTART_ARG: &str = "--autostart";
/// → окно capture, без данных.
pub const EVENT_CAPTURE_SHOWN: &str = "capture-shown";
/// → окно main, без данных.
pub const EVENT_OPEN_CAPTURE: &str = "open-capture";
/// → окно main, `{ "id": "…" }`.
pub const EVENT_OPEN_ITEM: &str = "open-item";

/// Верх мини-окна — на этой доле высоты рабочей области монитора (в процентах).
const CAPTURE_TOP_PERCENT: i64 = 22;
/// Предел длины id записи в `open_in_main` (id из чужой копии бывают не UUID).
const MAX_ITEM_ID_CHARS: usize = 128;

const TRAY_ID: &str = "main";
const MENU_OPEN: &str = "open";
const MENU_CAPTURE: &str = "capture";
const MENU_QUIT: &str = "quit";

/// Каталог расширения в ресурсах (ключ-назначение `extension/` в `bundle.resources`).
const EXTENSION_DIR_NAME: &str = "extension";
const EXTENSION_DIR_MISSING: &str = "Папка расширения не найдена";

const AUTOSTART_DEBUG_REASON: &str = "В отладочной сборке автозапуск не настраивается";
const AUTOSTART_UNAVAILABLE: &str = "Автозапуск недоступен";
const AUTOSTART_STUCK: &str = "Автозапуск не выключился: он записан для всех пользователей компьютера. \
     Выключите его в «Диспетчере задач» → «Автозагрузка» или запустите QuickDrop от имени администратора \
     и выключите здесь";

/// Флаги приходят из JS (`set_shell_options`); до этого вызова оба `false`: если веб-слой не загрузился,
/// крестик закрывает приложение, мини-окна нет.
#[derive(Default)]
pub struct ShellState {
    close_to_tray: AtomicBool,
    capture_window: AtomicBool,
    /// Выход уже запрошен: `Destroyed` главного окна при выходе не просит его второй раз.
    exiting: AtomicBool,
    /// Создание и уничтожение мини-окна по очереди: два одновременных вызова не создают окно дважды.
    window_lock: Mutex<()>,
    /// Фокус мини-окна — по событиям `Focused`, а не по `is_focused()`: в Windows фокус уходит в дочернее окно
    /// WebView2, и геттер (состояние tao) даёт false, пока курсор стоит в поле. События же Tauri синтезирует
    /// из GotFocus/LostFocus самого WebView2 — на них работает и `onFocusChanged` в JS.
    capture_focused: AtomicBool,
}

impl ShellState {
    fn close_to_tray(&self) -> bool {
        self.close_to_tray.load(Ordering::SeqCst)
    }
    fn capture_window(&self) -> bool {
        self.capture_window.load(Ordering::SeqCst)
    }
    fn capture_focused(&self) -> bool {
        self.capture_focused.load(Ordering::SeqCst)
    }
}

/// Событие фокуса мини-окна; при скрытии и уничтожении флаг сбрасывается явно (LostFocus тогда не обязателен).
fn note_capture_focus(state: &ShellState, focused: bool) {
    state.capture_focused.store(focused, Ordering::SeqCst);
}

/// Повторное нажатие сочетания прячет мини-окно, только если оно видно и в фокусе; иначе — показать и сфокусировать.
fn should_hide_capture(visible: bool, focused: bool) -> bool {
    visible && focused
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AutostartState {
    enabled: bool,
    available: bool,
    reason: Option<String>,
}

#[derive(Serialize, Clone)]
struct OpenItem {
    id: String,
}

// ---------- чистые функции ----------

/// Есть ли среди аргументов запуска `--autostart`.
pub fn has_autostart_arg<I: IntoIterator<Item = S>, S: AsRef<str>>(args: I) -> bool {
    args.into_iter().any(|a| a.as_ref() == AUTOSTART_ARG)
}

/// Левый верхний угол мини-окна в физических пикселях: по центру рабочей области монитора по горизонтали,
/// верх на 22 % её высоты; окно целиком в пределах области (окно больше области — прижато к левому/верхнему краю).
pub fn capture_position(area_pos: (i32, i32), area_size: (u32, u32), win_size: (u32, u32)) -> (i32, i32) {
    let (ax, ay) = (i64::from(area_pos.0), i64::from(area_pos.1));
    let (aw, ah) = (i64::from(area_size.0), i64::from(area_size.1));
    let (ww, wh) = (i64::from(win_size.0), i64::from(win_size.1));
    let x = ax + ((aw - ww) / 2).max(0);
    let top = ah * CAPTURE_TOP_PERCENT / 100;
    let y = ay + top.min(ah - wh).max(0);
    (clamp_i32(x), clamp_i32(y))
}

fn clamp_i32(v: i64) -> i32 {
    v.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

/// Физический размер окна при переходе на монитор с другим масштабом.
fn scale_size(size: (u32, u32), from_scale: f64, to_scale: f64) -> (u32, u32) {
    if !(from_scale.is_finite() && to_scale.is_finite()) || from_scale <= 0.0 || to_scale <= 0.0 {
        return size;
    }
    let k = to_scale / from_scale;
    let f = |v: u32| (f64::from(v) * k).round().clamp(0.0, f64::from(u32::MAX)) as u32;
    (f(size.0), f(size.1))
}

/// id записи из веб-слоя: непустой, до 128 символов, без управляющих символов.
fn is_valid_item_id(id: &str) -> bool {
    !id.trim().is_empty() && id.chars().count() <= MAX_ITEM_ID_CHARS && !id.chars().any(char::is_control)
}

/// Каталог расширения Chrome внутри ресурсов приложения (`bundle.resources` в tauri.conf.json): `extension`
/// с файлом `manifest.json`. Путь — без префикса `\\?\` (его Chrome в диалоге выбора папки не примет) и, если
/// удалось, канонический: короткие имена вида `USER~1` раскрыты, чтобы путь совпал с видимым в проводнике.
pub fn extension_dir_in(resource_dir: &Path) -> Option<PathBuf> {
    let dir = resource_dir.join(EXTENSION_DIR_NAME);
    if !dir.is_dir() || !dir.join("manifest.json").is_file() {
        return None;
    }
    Some(dunce::canonicalize(&dir).unwrap_or_else(|_| dunce::simplified(&dir).to_path_buf()))
}

/// Состояние автозапуска по итогу чтения из системы (`None` — плагин не подключён).
fn autostart_state(debug: bool, read: Option<Result<bool, String>>) -> AutostartState {
    if debug {
        return AutostartState { enabled: false, available: false, reason: Some(AUTOSTART_DEBUG_REASON.into()) };
    }
    match read {
        None => AutostartState { enabled: false, available: false, reason: Some(AUTOSTART_UNAVAILABLE.into()) },
        Some(Ok(enabled)) => AutostartState { enabled, available: true, reason: None },
        Some(Err(e)) => AutostartState {
            enabled: false,
            available: true,
            reason: Some(format!("Не удалось прочитать состояние автозапуска: {e}")),
        },
    }
}

// ---------- окна ----------

fn shell_state(app: &AppHandle) -> Option<tauri::State<'_, ShellState>> {
    app.try_state::<ShellState>()
}

fn request_exit(app: &AppHandle) {
    if let Some(state) = shell_state(app) {
        if state.exiting.swap(true, Ordering::SeqCst) {
            return;
        }
    }
    app.exit(0);
}

/// Показать главное окно (в т.ч. скрытое в трей или свёрнутое).
fn show_main(app: &AppHandle) -> Result<(), String> {
    let win = app
        .get_webview_window(MAIN_LABEL)
        .ok_or_else(|| "Главное окно не найдено".to_string())?;
    let _ = win.unminimize();
    win.show().map_err(|e| format!("Не удалось показать главное окно: {e}"))?;
    let _ = win.set_focus();
    Ok(())
}

/// Создать мини-окно скрытым по записи `capture` из tauri.conf.json.
/// В Windows `build()` виснет в синхронной команде и в обработчиках событий — вызывать только из
/// `async`-команд или `tauri::async_runtime::spawn`.
/// Без фокуса: окно создаётся заранее, пока пользователь работает в главном, а WebView2 с `focus: true`
/// при создании забирает ввод даже у скрытого окна. Фокус ставит `show_capture`.
fn create_capture(app: &AppHandle) -> Result<WebviewWindow, String> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == CAPTURE_LABEL)
        .cloned()
        .ok_or_else(|| "В настройках приложения нет окна быстрой записи".to_string())?;
    tauri::WebviewWindowBuilder::from_config(app, &config)
        .and_then(|b| b.visible(false).focused(false).build())
        .map_err(|e| format!("Не удалось создать окно быстрой записи: {e}"))
}

/// Существующее мини-окно либо новое (под `window_lock`).
fn ensure_capture(app: &AppHandle) -> Result<WebviewWindow, String> {
    let state = shell_state(app);
    let _guard = state.as_ref().map(|s| s.window_lock.lock().unwrap_or_else(|e| e.into_inner()));
    match app.get_webview_window(CAPTURE_LABEL) {
        Some(win) => Ok(win),
        None => create_capture(app),
    }
}

/// Поставить мини-окно на монитор под курсором (запасной — основной монитор).
fn place_capture(app: &AppHandle, win: &WebviewWindow) {
    let monitor = app
        .cursor_position()
        .ok()
        .and_then(|p| app.monitor_from_point(p.x, p.y).ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let (Some(monitor), Ok(size)) = (monitor, win.outer_size()) else {
        return;
    };
    // Размер окна в физических пикселях зависит от масштаба монитора, на котором оно сейчас.
    let from_scale = win.scale_factor().unwrap_or(1.0);
    let win_size = scale_size((size.width, size.height), from_scale, monitor.scale_factor());
    let area = monitor.work_area();
    let (x, y) = capture_position(
        (area.position.x, area.position.y),
        (area.size.width, area.size.height),
        win_size,
    );
    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
}

fn show_capture(app: &AppHandle, win: &WebviewWindow) -> Result<(), String> {
    place_capture(app, win);
    win.show().map_err(|e| format!("Не удалось показать окно быстрой записи: {e}"))?;
    let _ = win.set_focus();
    win.emit_to(CAPTURE_LABEL, EVENT_CAPTURE_SHOWN, ())
        .map_err(|e| format!("Не удалось открыть быструю запись: {e}"))
}

/// Пункт трея «Быстрая запись»: мини-окно (без скрытия видимого) либо диалог в главном окне.
fn tray_capture(app: &AppHandle) -> Result<(), String> {
    let use_window = shell_state(app).is_some_and(|s| s.capture_window());
    capture_or_main(
        use_window,
        || {
            let win = ensure_capture(app)?;
            show_capture(app, &win)
        },
        || {
            show_main(app)?;
            app.emit_to(MAIN_LABEL, EVENT_OPEN_CAPTURE, ())
                .map_err(|e| format!("Не удалось открыть быструю запись: {e}"))
        },
    )
}

/// Мини-окно; если оно выключено, не создалось или не показалось — диалог в главном окне, как у
/// глобального сочетания (иначе пункт трея молча ничего бы не делал: в релизе вывода в консоль нет).
fn capture_or_main(
    use_window: bool,
    window: impl FnOnce() -> Result<(), String>,
    main: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    if use_window {
        match window() {
            Ok(()) => return Ok(()),
            Err(e) => eprintln!("QuickDrop: {e}"),
        }
    }
    main()
}

// ---------- трей ----------

#[cfg(desktop)]
fn create_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let menu = Menu::with_items(
        app,
        &[
            &MenuItem::with_id(app, MENU_OPEN, "Открыть QuickDrop", true, None::<&str>)?,
            &MenuItem::with_id(app, MENU_CAPTURE, "Быстрая запись", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, MENU_QUIT, "Выход", true, None::<&str>)?,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("QuickDrop")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let app = app.clone();
            match event.id().as_ref() {
                MENU_OPEN => {
                    tauri::async_runtime::spawn(async move {
                        let _ = show_main(&app);
                    });
                }
                MENU_CAPTURE => {
                    // Окно создаётся вне обработчика: в Windows build() здесь виснет.
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = tray_capture(&app) {
                            eprintln!("QuickDrop: {e}");
                        }
                    });
                }
                MENU_QUIT => request_exit(&app),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            let open = matches!(
                event,
                TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. }
                    | TrayIconEvent::DoubleClick { button: MouseButton::Left, .. }
            );
            if open {
                let app = tray.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    let _ = show_main(&app);
                });
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    // Значок хранится в реестре ресурсов приложения — возвращённый дескриптор можно отпустить.
    builder.build(app)?;
    Ok(())
}

// ---------- автозапуск ----------

/// Свой `auto_launch` вместо tauri-plugin-autostart: плагин не даёт выбрать режим Windows, а его режим
/// (Dynamic) из процесса, запущенного от имени администратора, пишет в HKLM — общую для компьютера запись,
/// которую обычный процесс потом не снимет. Здесь — только HKCU (`CurrentUser`).
#[cfg(desktop)]
struct Autostart(auto_launch::AutoLaunch);

/// Путь к exe для строки запуска Windows — в кавычках: иначе путь с пробелом (профиль «Ivan Petrov»)
/// система разбирает перебором вариантов.
pub fn quoted_exe_path(exe: &str) -> String {
    format!("\"{exe}\"")
}

/// Имя значения то же, что было у плагина (имя приложения), — прежние записи HKCU подхватываются.
#[cfg(desktop)]
fn autostart_launcher(name: &str, app_path: &str) -> Result<auto_launch::AutoLaunch, String> {
    let mut b = auto_launch::AutoLaunchBuilder::new();
    b.set_app_name(name).set_app_path(app_path).set_args(&[AUTOSTART_ARG]);
    #[cfg(windows)]
    b.set_windows_enable_mode(auto_launch::WindowsEnableMode::CurrentUser);
    #[cfg(target_os = "macos")]
    b.set_macos_launch_mode(auto_launch::MacOSLaunchMode::LaunchAgent);
    b.build().map_err(|e| e.to_string())
}

/// Путь для строки запуска — как его брал плагин (macOS: исполняемый файл внутри .app; Linux: AppImage).
#[cfg(desktop)]
fn autostart_app_path(app: &tauri::App) -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let path = quoted_exe_path(&exe.display().to_string());
    #[cfg(target_os = "macos")]
    let path = exe.canonicalize().map_err(|e| e.to_string())?.display().to_string();
    #[cfg(target_os = "linux")]
    let path = app
        .env()
        .appimage
        .and_then(|p| p.to_str().map(|s| s.to_string()))
        .unwrap_or_else(|| exe.display().to_string());
    #[cfg(not(target_os = "linux"))]
    let _ = app;
    Ok(path)
}

/// Выключение прошло, но система всё ещё видит запись: она общая для компьютера (HKLM, осталась от
/// прежних версий, писавших туда), и снять её может только администратор. Не делать вид, что выключено.
fn disable_outcome(still_enabled: Result<bool, String>) -> Result<(), String> {
    match still_enabled {
        Ok(true) => Err(AUTOSTART_STUCK.into()),
        _ => Ok(()),
    }
}

#[cfg(desktop)]
fn read_autostart(app: &AppHandle) -> Option<Result<bool, String>> {
    let autostart = app.try_state::<Autostart>()?;
    Some(autostart.0.is_enabled().map_err(|e| e.to_string()))
}

#[cfg(not(desktop))]
fn read_autostart(_app: &AppHandle) -> Option<Result<bool, String>> {
    None
}

#[cfg(desktop)]
fn write_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let autostart = app.try_state::<Autostart>().ok_or_else(|| AUTOSTART_UNAVAILABLE.to_string())?;
    let failed = |e: auto_launch::Error| format!("Не удалось изменить автозапуск: {e}");
    if enabled {
        return autostart.0.enable().map_err(failed);
    }
    match autostart.0.disable() {
        Ok(()) => {}
        // Как в плагине: значения уже нет — значит, выключено.
        Err(auto_launch::Error::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(failed(e)),
    }
    disable_outcome(autostart.0.is_enabled().map_err(|e| e.to_string()))
}

#[cfg(not(desktop))]
fn write_autostart(_app: &AppHandle, _enabled: bool) -> Result<(), String> {
    Err(AUTOSTART_UNAVAILABLE.into())
}

// ---------- точки входа для lib.rs ----------

/// Вызывается из setup: manage(ShellState), значок в трее, обновление пути автозапуска.
pub fn init(app: &tauri::App) -> tauri::Result<()> {
    app.manage(ShellState::default());
    #[cfg(desktop)]
    create_tray(app)?;
    // Не собрался — состояния нет, в настройках «Автозапуск недоступен».
    #[cfg(desktop)]
    match autostart_app_path(app).and_then(|path| autostart_launcher(&app.package_info().name, &path)) {
        Ok(launcher) => {
            app.manage(Autostart(launcher));
        }
        Err(e) => eprintln!("QuickDrop: автозапуск недоступен: {e}"),
    }
    // Повторная запись обновляет путь к exe после переустановки; в отладке — не трогать реестр.
    if !cfg!(debug_assertions) && read_autostart(app.handle()) == Some(Ok(true)) {
        let _ = write_autostart(app.handle(), true);
    }
    Ok(())
}

/// Запуск с --autostart: главное окно создаётся скрытым.
pub fn started_hidden() -> bool {
    has_autostart_arg(std::env::args())
}

/// Второй запуск exe: с --autostart — ничего, иначе показать главное окно.
pub fn on_second_instance(app: &AppHandle, args: &[String]) {
    if has_autostart_arg(args) {
        return;
    }
    let _ = show_main(app);
}

/// События цикла приложения (lib.rs: `.build(…)?.run(…)`).
pub fn on_run_event(app: &AppHandle, event: &tauri::RunEvent) {
    // macOS: клик по значку в Dock, когда главное окно скрыто (запуск с --autostart, «в трей при закрытии»)
    // или свёрнуто, — показать его; сама система этого не делает.
    #[cfg(target_os = "macos")]
    if let tauri::RunEvent::Reopen { .. } = event {
        let hidden = app
            .get_webview_window(MAIN_LABEL)
            .is_some_and(|w| !w.is_visible().unwrap_or(true) || w.is_minimized().unwrap_or(false));
        if hidden {
            let _ = show_main(app);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, event);
}

/// Общий обработчик событий окон (подключается в lib.rs через Builder::on_window_event).
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    match (window.label(), event) {
        (MAIN_LABEL, WindowEvent::CloseRequested { api, .. }) => {
            if shell_state(window.app_handle()).is_some_and(|s| s.close_to_tray()) {
                api.prevent_close();
                let _ = window.hide();
            }
        }
        // Tauri завершает процесс, только когда закрыты все окна, а скрытое мини-окно — тоже окно.
        (MAIN_LABEL, WindowEvent::Destroyed) => request_exit(window.app_handle()),
        (CAPTURE_LABEL, WindowEvent::Focused(focused)) => {
            if let Some(s) = shell_state(window.app_handle()) {
                note_capture_focus(&s, *focused);
            }
        }
        // Alt+F4 в мини-окне: окно прячется, а не уничтожается.
        (CAPTURE_LABEL, WindowEvent::CloseRequested { api, .. }) => {
            api.prevent_close();
            let _ = window.hide();
            if let Some(s) = shell_state(window.app_handle()) {
                note_capture_focus(&s, false);
            }
        }
        (CAPTURE_LABEL, WindowEvent::Destroyed) => {
            if let Some(s) = shell_state(window.app_handle()) {
                note_capture_focus(&s, false);
            }
        }
        _ => {}
    }
}

// ---------- команды ----------

#[tauri::command]
pub async fn set_shell_options(app: AppHandle, close_to_tray: bool, capture_window: bool) -> Result<(), String> {
    let state = shell_state(&app).ok_or_else(|| "Оболочка приложения не готова".to_string())?;
    state.close_to_tray.store(close_to_tray, Ordering::SeqCst);
    state.capture_window.store(capture_window, Ordering::SeqCst);
    let _guard = state.window_lock.lock().unwrap_or_else(|e| e.into_inner());
    match (capture_window, app.get_webview_window(CAPTURE_LABEL)) {
        (true, None) => create_capture(&app).map(|_| ()),
        // destroy() освобождает процесс WebView2 и не вызывает CloseRequested (и LostFocus тоже).
        (false, Some(win)) => {
            note_capture_focus(&state, false);
            win.destroy().map_err(|e| format!("Не удалось закрыть окно быстрой записи: {e}"))
        }
        _ => Ok(()),
    }
}

/// true — мини-окно показано, false — скрыто.
#[tauri::command]
pub async fn toggle_capture_window(app: AppHandle) -> Result<bool, String> {
    let win = ensure_capture(&app)?;
    let state = shell_state(&app);
    let focused = state.as_ref().is_some_and(|s| s.capture_focused());
    if should_hide_capture(win.is_visible().unwrap_or(false), focused) {
        win.hide().map_err(|e| format!("Не удалось скрыть окно быстрой записи: {e}"))?;
        if let Some(s) = state {
            note_capture_focus(&s, false);
        }
        return Ok(false);
    }
    show_capture(&app, &win)?;
    Ok(true)
}

/// Зажата ли сейчас основная кнопка мыши (физически, с учётом «поменять кнопки местами»). Мини-окно не
/// прячется по потере фокуса, пока идёт перетаскивание: нажатие на файл в Проводнике отнимает у окна фокус
/// раньше, чем файл донесён. Вне Windows — всегда false (прежнее поведение).
#[tauri::command]
pub fn capture_pointer_down() -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_SWAPBUTTON};
        // SAFETY: функции user32 без указателей; любые значения аргументов допустимы.
        unsafe {
            let btn = if GetSystemMetrics(SM_SWAPBUTTON) != 0 { VK_RBUTTON } else { VK_LBUTTON };
            (GetAsyncKeyState(i32::from(btn)) as u16 & 0x8000) != 0
        }
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[tauri::command]
pub async fn show_main_window(app: AppHandle) -> Result<(), String> {
    show_main(&app)
}

#[tauri::command]
pub async fn open_in_main(app: AppHandle, id: String) -> Result<(), String> {
    if !is_valid_item_id(&id) {
        return Err("Некорректный идентификатор записи".into());
    }
    show_main(&app)?;
    app.emit_to(MAIN_LABEL, EVENT_OPEN_ITEM, OpenItem { id })
        .map_err(|e| format!("Не удалось открыть запись: {e}"))
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    request_exit(&app);
}

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> AutostartState {
    if cfg!(debug_assertions) {
        return autostart_state(true, None);
    }
    autostart_state(false, read_autostart(&app))
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    // Иначе в реестр попадёт путь к target/debug.
    if cfg!(debug_assertions) {
        return Err(AUTOSTART_DEBUG_REASON.into());
    }
    write_autostart(&app, enabled)
}

/// Путь к папке расширения Chrome из установщика (для «Загрузить распакованное расширение»).
#[tauri::command]
pub fn extension_dir(app: AppHandle) -> Result<String, String> {
    let resources = app.path().resource_dir().map_err(|_| EXTENSION_DIR_MISSING.to_string())?;
    extension_dir_in(&resources)
        .map(|p| p.display().to_string())
        .ok_or_else(|| EXTENSION_DIR_MISSING.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Временный каталог теста; удаляется при выходе из области видимости.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            use std::sync::atomic::AtomicUsize;
            static COUNTER: AtomicUsize = AtomicUsize::new(0);
            let n = COUNTER.fetch_add(1, Ordering::SeqCst);
            let path = std::env::temp_dir().join(format!("quickdrop-shell-{name}-{}-{n}", std::process::id()));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).unwrap();
            // Канонический вид: temp_dir() в Windows бывает с коротким именем (USER~1).
            Self(dunce::canonicalize(&path).unwrap())
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn extension_dir_found_with_manifest() {
        let tmp = TempDir::new("ext-ok");
        let ext = tmp.0.join("extension");
        std::fs::create_dir_all(ext.join("icons")).unwrap();
        std::fs::write(ext.join("manifest.json"), b"{}").unwrap();
        let found = extension_dir_in(&tmp.0).expect("папка расширения");
        assert_eq!(found, ext);
        assert!(!found.display().to_string().starts_with(r"\\?\"), "без префикса \\\\?\\");
    }

    #[test]
    fn extension_dir_missing() {
        let tmp = TempDir::new("ext-none");
        assert_eq!(extension_dir_in(&tmp.0), None);
        // каталога ресурсов нет вовсе
        assert_eq!(extension_dir_in(&tmp.0.join("нет-такой")), None);
    }

    #[test]
    fn extension_dir_without_manifest() {
        let tmp = TempDir::new("ext-empty");
        let ext = tmp.0.join("extension");
        std::fs::create_dir_all(&ext).unwrap();
        std::fs::write(ext.join("background.js"), b"").unwrap();
        assert_eq!(extension_dir_in(&tmp.0), None);
        // manifest.json — каталог, а не файл
        std::fs::create_dir_all(ext.join("manifest.json")).unwrap();
        assert_eq!(extension_dir_in(&tmp.0), None);
    }

    #[test]
    fn extension_dir_must_be_directory() {
        let tmp = TempDir::new("ext-file");
        std::fs::write(tmp.0.join("extension"), b"").unwrap();
        assert_eq!(extension_dir_in(&tmp.0), None);
    }

    #[test]
    fn bundle_includes_extension_resources() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let resources = &conf["bundle"]["resources"];
        assert_eq!(resources["../extension/"], "extension/", "каталог extension копируется в ресурсы как extension/");
        // Источник в репозитории действительно содержит манифест.
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("../extension");
        assert!(extension_dir_in(src.parent().unwrap()).is_some());
    }

    #[test]
    fn capture_position_centers_and_sets_top() {
        // 1920×1040 (без панели задач), окно 640×440: x = (1920-640)/2, y = 1040*22%
        assert_eq!(capture_position((0, 0), (1920, 1040), (640, 440)), (640, 228));
        // нечётная разница — округление вниз
        assert_eq!(capture_position((0, 0), (1001, 800), (640, 440)), (180, 176));
    }

    #[test]
    fn capture_position_on_offset_monitors() {
        // второй монитор слева от основного и выше: отрицательные координаты
        assert_eq!(capture_position((-1920, -200), (1920, 1080), (640, 440)), (-1280, 37));
        // монитор справа, рабочая область сдвинута панелью задач сверху
        assert_eq!(capture_position((2560, 40), (2560, 1400), (960, 660)), (3360, 348));
    }

    #[test]
    fn capture_position_keeps_window_inside_area() {
        // окно почти во всю высоту: 22 % не помещается — прижать так, чтобы низ совпал с низом области
        assert_eq!(capture_position((0, 0), (800, 600), (640, 500)), (80, 100));
        // окно больше области — левый верхний угол области
        assert_eq!(capture_position((-1024, -50), (800, 400), (960, 660)), (-1024, -50));
        // нулевая область
        assert_eq!(capture_position((10, 20), (0, 0), (640, 440)), (10, 20));
        // крайние значения не переполняются
        assert_eq!(capture_position((i32::MAX, i32::MAX), (u32::MAX, u32::MAX), (0, 0)), (i32::MAX, i32::MAX));
        assert_eq!(capture_position((i32::MIN, i32::MIN), (0, 0), (u32::MAX, u32::MAX)), (i32::MIN, i32::MIN));
    }

    #[test]
    fn scale_size_between_monitors() {
        assert_eq!(scale_size((640, 440), 1.0, 1.5), (960, 660));
        assert_eq!(scale_size((960, 660), 1.5, 1.0), (640, 440));
        assert_eq!(scale_size((640, 440), 1.25, 1.25), (640, 440));
        assert_eq!(scale_size((640, 440), 0.0, 2.0), (640, 440));
        assert_eq!(scale_size((640, 440), f64::NAN, 2.0), (640, 440));
    }

    #[test]
    fn autostart_arg_detection() {
        assert!(has_autostart_arg(["quickdrop.exe", "--autostart"]));
        assert!(has_autostart_arg(vec![String::from("--autostart")]));
        let args: Vec<String> = vec!["C:\\QuickDrop\\quickdrop.exe".into(), "--autostart".into()];
        assert!(has_autostart_arg(&args));
        assert!(!has_autostart_arg(["quickdrop.exe"]));
        assert!(!has_autostart_arg(Vec::<String>::new()));
        assert!(!has_autostart_arg(["quickdrop.exe", "--autostart=1", "--AUTOSTART", "autostart", " --autostart"]));
    }

    #[test]
    fn item_id_validation() {
        assert!(is_valid_item_id("0b6f3c1e-8f0a-4d3e-9a51-2a7c9e1f0d11"));
        assert!(is_valid_item_id("старая-запись_42"));
        assert!(is_valid_item_id(&"я".repeat(MAX_ITEM_ID_CHARS)));
        assert!(!is_valid_item_id(""));
        assert!(!is_valid_item_id("   "));
        assert!(!is_valid_item_id(&"a".repeat(MAX_ITEM_ID_CHARS + 1)));
        assert!(!is_valid_item_id("abc\n"));
        assert!(!is_valid_item_id("a\u{0}b"));
        assert!(!is_valid_item_id("a\u{7f}b"));
        assert!(!is_valid_item_id("a\u{85}b"));
    }

    #[test]
    fn autostart_state_mapping() {
        let debug = autostart_state(true, Some(Ok(true)));
        assert_eq!(debug, AutostartState { enabled: false, available: false, reason: Some(AUTOSTART_DEBUG_REASON.into()) });
        assert_eq!(autostart_state(false, Some(Ok(true))), AutostartState { enabled: true, available: true, reason: None });
        assert_eq!(autostart_state(false, Some(Ok(false))), AutostartState { enabled: false, available: true, reason: None });
        let failed = autostart_state(false, Some(Err("нет доступа".into())));
        assert!(!failed.enabled && failed.available);
        assert_eq!(failed.reason.as_deref(), Some("Не удалось прочитать состояние автозапуска: нет доступа"));
        let missing = autostart_state(false, None);
        assert!(!missing.enabled && !missing.available);
    }

    #[test]
    fn autostart_state_serializes_camel_case() {
        let json = serde_json::to_value(autostart_state(true, None)).unwrap();
        assert_eq!(json["enabled"], false);
        assert_eq!(json["available"], false);
        assert_eq!(json["reason"], AUTOSTART_DEBUG_REASON);
        let json = serde_json::to_value(autostart_state(false, Some(Ok(true)))).unwrap();
        assert!(json["reason"].is_null());
    }

    /// Разбор строки запуска Windows в упрощённом виде: кавычки группируют, пробел разделяет.
    fn split_command_line(s: &str) -> Vec<String> {
        let (mut out, mut cur, mut quoted) = (Vec::new(), String::new(), false);
        for c in s.chars() {
            match c {
                '"' => quoted = !quoted,
                ' ' if !quoted => {
                    if !cur.is_empty() {
                        out.push(std::mem::take(&mut cur));
                    }
                }
                _ => cur.push(c),
            }
        }
        if !cur.is_empty() {
            out.push(cur);
        }
        out
    }

    #[test]
    fn autostart_path_is_quoted() {
        let exe = r"C:\Users\Ivan Petrov\AppData\Local\QuickDrop\quickdrop.exe";
        let quoted = quoted_exe_path(exe);
        assert!(quoted.starts_with('"') && quoted.ends_with('"'));
        // Так строку собирает auto-launch: format!("{} {}", app_path, args.join(" ")).
        let args = split_command_line(&format!("{} {}", quoted, AUTOSTART_ARG));
        assert_eq!(args, vec![exe.to_string(), AUTOSTART_ARG.to_string()]);
        assert!(has_autostart_arg(&args));
    }

    #[test]
    fn autostart_disable_reports_stuck_entry() {
        assert_eq!(disable_outcome(Ok(false)), Ok(()));
        assert_eq!(disable_outcome(Ok(true)), Err(AUTOSTART_STUCK.to_string()));
        // Не смогли перепроверить — выключение само прошло без ошибки.
        assert_eq!(disable_outcome(Err("нет доступа".into())), Ok(()));
    }

    /// Пишет в HKCU текущего пользователя (и убирает за собой). Запуск вручную: cargo test -- --ignored
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn autostart_writes_current_user_only() {
        let name = format!("QuickDropTest-{}", std::process::id());
        let launcher = autostart_launcher(&name, &quoted_exe_path(r"C:\Нет такой папки\quickdrop.exe")).unwrap();
        let in_hive = |hive: &str| {
            std::process::Command::new("reg")
                .args(["query", &format!(r"{hive}\Software\Microsoft\Windows\CurrentVersion\Run"), "/v", &name])
                .output()
                .is_ok_and(|o| o.status.success())
        };
        launcher.enable().unwrap();
        let (hkcu, hklm) = (in_hive("HKCU"), in_hive("HKLM"));
        launcher.disable().unwrap();
        assert!(hkcu, "запись должна быть в HKCU");
        assert!(!hklm, "в HKLM писать нельзя");
        assert!(!launcher.is_enabled().unwrap());
        assert!(!in_hive("HKCU"));
    }

    #[test]
    fn tray_capture_falls_back_to_main() {
        use std::cell::Cell;
        let main_calls = Cell::new(0);
        let main = || {
            main_calls.set(main_calls.get() + 1);
            Ok(())
        };
        // Мини-окно показалось — главное не трогается.
        assert_eq!(capture_or_main(true, || Ok(()), main), Ok(()));
        assert_eq!(main_calls.get(), 0);
        // Не создалось или не показалось — диалог в главном окне.
        assert_eq!(capture_or_main(true, || Err("сбой WebView2".into()), main), Ok(()));
        assert_eq!(main_calls.get(), 1);
        // Мини-окно выключено — сразу главное.
        let window_called = Cell::new(false);
        let window = || {
            window_called.set(true);
            Ok(())
        };
        assert_eq!(capture_or_main(false, window, main), Ok(()));
        assert!(!window_called.get());
        assert_eq!(main_calls.get(), 2);
        // Ошибка главного окна доходит до вызывающего.
        assert_eq!(
            capture_or_main(true, || Err("a".into()), || Err("b".into())),
            Err("b".to_string())
        );
    }

    #[test]
    fn capture_window_config_does_not_take_focus() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let windows = conf["app"]["windows"].as_array().unwrap();
        let capture = windows.iter().find(|w| w["label"] == CAPTURE_LABEL).expect("окно capture в конфиге");
        assert_eq!(capture["focus"], false, "скрытое окно не должно забирать фокус при создании");
        assert_eq!(capture["visible"], false);
        assert_eq!(capture["create"], false);
    }

    #[test]
    fn shell_state_defaults_off() {
        let s = ShellState::default();
        assert!(!s.close_to_tray());
        assert!(!s.capture_window());
        assert!(!s.exiting.load(Ordering::SeqCst));
        assert!(!s.capture_focused());
    }

    #[test]
    fn capture_focus_is_tracked_by_events() {
        let s = ShellState::default();
        note_capture_focus(&s, true);
        assert!(s.capture_focused());
        note_capture_focus(&s, false);
        assert!(!s.capture_focused());
    }

    #[test]
    fn second_press_hides_only_visible_focused_window() {
        assert!(should_hide_capture(true, true));
        // Видно, но фокус в другой программе — поднять, а не прятать.
        assert!(!should_hide_capture(true, false));
        assert!(!should_hide_capture(false, true));
        assert!(!should_hide_capture(false, false));
    }

    #[test]
    fn pointer_down_does_not_panic() {
        // Значение зависит от мыши на машине теста; важно, что вызов безопасен.
        let _ = capture_pointer_down();
    }
}
