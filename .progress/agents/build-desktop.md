# build-desktop

Статус: готово (успех)

## Сборка
`npm run tauri build` прошла с первого раза, код выхода 0. Rust release-компиляция заняла 2 мин 07 с, предупреждений не было.
beforeBuildCommand (`npm run build`) собрал dist без service worker: TAURI_ENV_PLATFORM задан, VitePWA отключён.
NSIS 3.13, nsis_tauri_utils 0.5.3 и WiX 3.14 скачались и прошли проверку хеша. Кэш лежит в %LOCALAPPDATA%\tauri (NSIS, WixTools314).

## Что исправлено
Ничего. tauri.conf.json, capabilities, Cargo.toml, иконки и beforeBuildCommand не менялись.
bundle.targets = ["nsis", "msi", "app", "dmg"]: на Windows tauri собирает только nsis и msi, а app/dmg пропускает без ошибки. Эти цели нужны для macOS-сборки в CI.

## Артефакты
- src-tauri\target\release\quickdrop.exe: 5 224 960 байт (4,98 MiB)
- src-tauri\target\release\bundle\nsis\QuickDrop_0.1.0_x64-setup.exe: 2 338 446 байт (2,23 MiB)
- src-tauri\target\release\bundle\msi\QuickDrop_0.1.0_x64_en-US.msi: 2 985 984 байт (2,85 MiB)
Код не подписан (подпись не настраивалась).

## Дымовой тест
Запущен quickdrop.exe (PID 2840). Через 8 с процесс жив: Responding=True, окно «QuickDrop», рабочий набор около 33 МБ, дочерний msedgewebview2.exe.
Процесс виден в tasklist. Закрыт через CloseMainWindow (WM_CLOSE) именно по этому PID и завершился сам, принудительное завершение не понадобилось.
После закрытия не осталось ни процессов quickdrop, ни дочерних WebView2.

## Итоговые проверки
- `npm run build`: код 0, dist снова веб-сборка с service worker (sw.js, workbox-*.js, manifest.webmanifest, precache 40 записей).
- `npm run typecheck`: код 0.
- `npm test`: 10 файлов, 432 теста прошли.
