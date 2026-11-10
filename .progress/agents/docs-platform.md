# docs-platform

Статус: готово (исследование; код проекта не менялся)

Задача: справка для этапа «Платформы» — Tauri 2, global-shortcut, vite-plugin-pwa (iOS), GitHub Actions tauri-action, предпосылки сборки Windows.

## 0. Версии (из node_modules, node_modules)
- @tauri-apps/cli 2.12.4 (node_modules/@tauri-apps/cli/package.json)
- @tauri-apps/api 2.12.4 (node_modules/@tauri-apps/api/package.json)
- @tauri-apps/plugin-global-shortcut 2.4.1 (node_modules/@tauri-apps/plugin-global-shortcut/package.json)
- vite 8.3.7 (node_modules/vite/package.json)
- vite-plugin-pwa 2.0.0. peerDependencies: vite `^3 || ... || ^8.0.0` (Vite 8 входит), workbox-build `^7.4.1`, workbox-window `^7.4.1`, @vite-pwa/assets-generator `^1 || ^2` (опционально). Вывод: совместим с Vite 8. Наличие workbox-* в node_modules не проверялось.
- В корневом package.json уже есть @tauri-apps/api, @tauri-apps/plugin-global-shortcut (dependencies), @tauri-apps/cli (devDependencies), script "tauri": "tauri".

## 1. Tauri 2: инициализация в существующем Vite-проекте
Источники: https://v2.tauri.app/start/create-project/ , https://v2.tauri.app/reference/config/

- Команда: `npx tauri init` из корня. Prompts: appName, windowTitle, frontendDist (`../dist`), devUrl (`http://localhost:5173`), beforeDevCommand (`npm run dev`), beforeBuildCommand (`npm run build`). Полный набор флагов на странице не описан.
- Создаётся `src-tauri/` с файлами: `Cargo.toml`, `tauri.conf.json`, `build.rs`, `src/main.rs`, `src/lib.rs`, `capabilities/default.json`, `icons/`. Состав взят из стандартного шаблона Tauri 2; на загруженной странице явно не перечислен.
- В vite.config.ts: `server: { watch: { ignored: ['**/src-tauri/**'] } }` (из гайда).
- Минимальный tauri.conf.json (проверено по референсу):
```json
{
  "productName": "QuickDrop",
  "version": "0.1.0",
  "identifier": "com.example.quickdrop",
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://localhost:5173",
    "frontendDist": "../dist"
  },
  "app": { "windows": [ { "title": "QuickDrop", "width": 1100, "height": 720 } ] },
  "bundle": { "active": true, "targets": ["nsis", "msi", "app", "dmg"] }
}
```
  - `identifier` обязателен; только буквы, цифры, дефис и точка. Дефолт `com.tauri.dev` отвергается `tauri build`, его нужно заменить.
  - `productName` не может содержать символы `/ \ : * ? " < > |`.
  - `bundle.active` по умолчанию false, его нужно ставить в true. `targets` регистронезависимы, по умолчанию "all".
  - Windows: `nsis` (.exe), `msi`. macOS: `app` (.app), `dmg`.

- Rust-команда и вызов из фронта (стандартный API Tauri 2; `invoke` экспортируется из `@tauri-apps/api/core`):
```rust
// src-tauri/src/lib.rs
#[tauri::command]
fn add_item(text: String) -> String { format!("saved: {text}") }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![add_item])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```
```ts
import { invoke } from '@tauri-apps/api/core';
const res = await invoke<string>('add_item', { text: 'hello' }); // camelCase в JS, аргументы Rust-функции сопоставляются по имени
```
  - `src-tauri/src/main.rs` вызывает `quickdrop_lib::run()` (имя lib задаётся в Cargo.toml `[lib] name`). Стандартный шаблон.
  - Core-разрешения по умолчанию (`core:default`) уже входят в шаблон capabilities/default.json.

## 2. global-shortcut (Tauri 2)
Источники: https://v2.tauri.app/plugin/global-shortcut/ ; node_modules/@tauri-apps/plugin-global-shortcut/dist-js/index.d.ts (v2.4.1)

- Cargo (в src-tauri): `cargo add tauri-plugin-global-shortcut --target 'cfg(any(target_os = "macos", windows, target_os = "linux"))'`. Либо `npm run tauri add global-shortcut`, который ставит и Rust, и JS.
- Регистрация в lib.rs с handler, показом/фокусом окна и событием во фронт:
```rust
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(desktop)]
            {
                let quick: Shortcut = "CommandOrControl+Shift+Space".parse()?;
                let quick_for_handler = quick.clone();
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, shortcut, event| {
                            if shortcut == &quick_for_handler && event.state() == ShortcutState::Pressed {
                                if let Some(win) = app.get_webview_window("main") {
                                    let _ = win.unminimize();
                                    let _ = win.show();
                                    let _ = win.set_focus();
                                }
                                let _ = app.emit("quick-add", ());
                            }
                        })
                        .build(),
                )?;
                app.global_shortcut().register(quick)?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```
  - Подтверждено гайдом: `Shortcut::new(Some(Modifiers::CONTROL), Code::KeyN)`, `Builder::new().with_handler(move |_app, shortcut, event| ...)`, `event.state()` с `ShortcutState::Pressed/Released`, `app.global_shortcut().register(...)`.
  - Не подтверждено страницами этой сессии (из памяти API Tauri 2): парсинг строки через `.parse::<Shortcut>()`, `Emitter` и `app.emit`. Уточнить компилятором при сборке.
- Capabilities (src-tauri/capabilities/default.json):
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "main-capability",
  "description": "Main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "global-shortcut:allow-register",
    "global-shortcut:allow-unregister",
    "global-shortcut:allow-is-registered",
    "global-shortcut:allow-unregister-all"
  ]
}
```
  - Есть также `global-shortcut:allow-register-all`. По умолчанию разрешений нет.
  - Если регистрация только в Rust, `global-shortcut:*` не нужны. Они нужны, когда JS сам вызывает register/isRegistered.
- JS API (подтверждено по index.d.ts v2.4.1):
  - `register(shortcuts: string | string[], handler: (e: {shortcut: string; id: number; state: 'Pressed' | 'Released'}) => void): Promise<void>`
  - `unregister(shortcuts)`, `unregisterAll()`, `isRegistered(shortcut): Promise<boolean>`
  - Формат строки: модификаторы и клавиша через `+`, например `'CommandOrControl+Shift+Space'` или `'CmdOrControl+Q'`.
```ts
import { register, isRegistered } from '@tauri-apps/plugin-global-shortcut';
if (!(await isRegistered('CommandOrControl+Shift+Space'))) {
  await register('CommandOrControl+Shift+Space', (e) => { if (e.state === 'Pressed') openQuickAdd(); });
}
```
- Получение события во фронте из Rust: `import { listen } from '@tauri-apps/api/event'; await listen('quick-add', () => openQuickAdd());`
- Важно для продукта: глобальный шорткат срабатывает вне приложения и может быть занят ОС или другим приложением (тогда handler не вызовется). Требование «горячая клавиша, пока приложение открыто» решается обычным keydown в окне (работает и в браузере, и в webview) без плагина. Глобальный шорткат — отдельная опция только для Tauri.

## 3. vite-plugin-pwa 2.0.0 и iOS
Источники: node_modules/vite-plugin-pwa/package.json; https://vite-pwa-org.netlify.app/frameworks/vue.html; https://webkit.org/blog/14403/updates-to-storage-policy/

- Совместимость: peerDependencies включают vite ^8.0.0, значит совместим с установленным Vite 8.3.7.
- Регистрация SW. В пакете есть `client.d.ts` и `react.d.ts`. Для React: в tsconfig `"types": ["vite-plugin-pwa/react"]`, в коде `import { useRegisterSW } from 'virtual:pwa-register/react'`. Для простого варианта: `import { registerSW } from 'virtual:pwa-register'; registerSW({ immediate: true });`. Гайд показывает такой же подход для Vue (`useRegisterSW` с onNeedRefresh/updateServiceWorker).
- Минимальная конфигурация. Загруженная страница её не содержала, поэтому это по документации плагина из памяти, перед использованием проверить по https://vite-pwa-org.netlify.app/guide/:
```ts
import { VitePWA } from 'vite-plugin-pwa';
// plugins: [react(), VitePWA({ ... })]
VitePWA({
  registerType: 'autoUpdate',
  includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
  manifest: {
    name: 'QuickDrop', short_name: 'QuickDrop',
    theme_color: '#0f172a', background_color: '#0f172a',
    display: 'standalone', start_url: '/',
    icons: [
      { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
      { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  workbox: { globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'] },
})
```
- iOS Safari:
  - `<link rel="apple-touch-icon" href="/apple-touch-icon.png">` (180x180).
  - `<meta name="apple-mobile-web-app-capable" content="yes">`, `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`.
  - `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`; отступы через `env(safe-area-inset-top)` и `env(safe-area-inset-bottom)`.
  - Установка PWA на iOS только через «Поделиться → На экран «Домой»». Событий beforeinstallprompt нет (из памяти).
  - Хранилище (WebKit blog, Safari 17 / iOS 17): квота origin до 60% диска для браузерных приложений; общая квота до 80%. Возможна eviction при нехватке места или при неиспользовании по ITP. `navigator.storage.persist()` поддерживается с Safari 17, WebKit выдаёт по эвристикам и не гарантирует. `navigator.storage.estimate()` показывает квоту.
  - Ограничение «script-writable storage 7 дней без взаимодействия» (ITP) — из памяти, на загруженной странице не подтверждено; проверить перед релизом.
  - Вывод для QuickDrop: IndexedDB (Dexie) работает, но при старте вызывать `navigator.storage.persist()` и предлагать экспорт/бэкап (JSON), чтобы данные не потерялись при eviction.

## 4. GitHub Actions: tauri-action (Windows + macOS)
Источник: https://v2.tauri.app/distribute/pipelines/github/. Страница показывает отдельные записи для macOS aarch64 и x86_64; universal-вариант там не приведён.
```yaml
name: release
on:
  push:
    tags: ['v*']
  workflow_dispatch:
jobs:
  publish:
    permissions:
      contents: write
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: macos-latest
            args: '--target universal-apple-darwin'
          - platform: windows-latest
            args: ''
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with: { node-version: lts/*, cache: npm }
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}
      - uses: swatinem/rust-cache@v2
        with: { workspaces: './src-tauri -> target' }
      - run: npm ci
      - uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # опционально подпись: APPLE_CERTIFICATE, APPLE_CERTIFICATE_PASSWORD, APPLE_SIGNING_IDENTITY,
          # APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID; для updater: TAURI_SIGNING_PRIVATE_KEY
        with:
          tagName: v__VERSION__
          releaseName: 'QuickDrop v__VERSION__'
          releaseDraft: true
          args: ${{ matrix.args }}
```
- Версии actions (checkout v7, setup-node v6, tauri-action v1) взяты из официального гайда. Universal-флаг `--target universal-apple-darwin` и набор Apple-секретов — из памяти, не подтверждено страницей.
- Для GITHUB_TOKEN в настройках репозитория Actions → General выставить Read and write permissions.

## 5. Предпосылки сборки Windows (проверено на этой машине)
- `cargo --version`: cargo 1.99.1 (5f94df478 2026-08-27).
- `rustup show`: default host x86_64-pc-windows-msvc; active toolchain stable-x86_64-pc-windows-msvc; installed target x86_64-pc-windows-msvc. Toolchain MSVC есть.
- MSVC Build Tools: `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools`. vswhere: версия 17.14.37806.7, компонент VC.Tools.x86.x64 установлен. MSVC 14.44.35207 находится в `VC\Tools\MSVC`, `vcvars64.bat` существует.
- `where cl`: не найден в текущем PATH. Это нормально, cl.exe виден только из VS Dev Shell / vcvars64. rustup находит link.exe сам, но реальная сборка (`cargo build`) не запускалась.
- WebView2: Edge WebView2 Runtime установлен, версия 157.0.4341.42 (реестр `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`, поле pv). Каталог `C:\Program Files (x86)\Microsoft\EdgeWebView\Application` существует.
- Не проверено: `npx tauri info`, `cargo check` в src-tauri (src-tauri ещё не создан).

## Не удалось проверить и риски
- Точные флаги `tauri init` и полный список файлов src-tauri на страницах не описаны.
- ITP-ограничение 7 дней: из памяти.
- Парсинг Shortcut из строки и `Emitter`/`app.emit`: из памяти API Tauri 2, уточнить компилятором.
- Universal macOS и Apple-секреты: из памяти.
- Версии GitHub Actions брать из официальных гайдов перед использованием.

## Изменённые файлы
- .progress\agents\docs-platform.md (только этот файл; код, конфиги и package.json не менялись)
