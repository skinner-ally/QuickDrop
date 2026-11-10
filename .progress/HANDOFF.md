# HANDOFF — состояние основной сессии

Обновлено: 2026-11-10

## Текущий этап
Этап 4 (финальное ревью) — workflow `quickdrop-final`.

## Сделано
- Этапы 0–3 закоммичены. typecheck / 432 теста / build (с sw.js и manifest) — зелёные.
- Этап 3: src-tauri (Tauri 2: fetch_link_meta, global-shortcut, single-instance, opener), PWA (vite-plugin-pwa, иконки,
  share_target, отключается при TAURI_ENV_PLATFORM), свой ThemeProvider вместо next-themes, ленивые чанки, README, CI.
- Windows-сборка прошла: src-tauri/target/release/bundle/nsis/QuickDrop_0.1.0_x64-setup.exe и msi/QuickDrop_0.1.0_x64_en-US.msi;
  дымовой тест exe — окно открывается (см. .progress/agents/build-desktop.md).
- Основная сессия перепроверила в браузере: курсор списка виден, Enter открывает запись под курсором, «/» фокусирует поиск,
  ссылка без заголовка показывается как «dexie.org — React».

## В работе прямо сейчас
Workflow этапа 4: ревью fable по 4 линзам → проверка находок → исправления (opus/sonnet) → проверки (haiku) → пересборка desktop.

## Следующий шаг
Итоговая проверка основной сессией (браузер + команды), коммит «Этап 4», отметить PROGRESS.md, итоговый отчёт пользователю.

## Известные проблемы / ограничения
- macOS-сборка — только на Mac или через GitHub Actions (.github/workflows/release.yml), не проверялась.
- Установка PWA на iPhone и глобальная клавиша в живом окне Tauri не проверялись вручную.
- В вебе заголовки ссылок недоступны из-за CORS (без прокси) — показывается заголовок из адреса.
- Обработчики клавиш опираются на e.code; добавить запасной вариант по e.key (в этапе 4).
