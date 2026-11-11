# spec-tauri

- Задача: спецификация оболочки Tauri — автобэкап и экспорт в папку (этап 2), мини-окно, трей, автозапуск,
  один экземпляр, канал для расширения Chrome (этап 7), приёмка Windows (этап 8).
- Статус: готово
- Результат: `.progress/spec-tauri.md` из двух частей.
  - Часть 1 (исполнитель `tauri-backup`): `src-tauri/src/backup.rs` (команды `pick_directory`, `save_backup`,
    `prune_backups`, `list_backups`, `write_export_file`; список подтверждённых папок `approved-dirs.json`),
    передача данных частями по 8 МиБ сырым телом `invoke` с параметрами в заголовке `x-qd-args`,
    `src/lib/ipc.ts`, добавления в `src/lib/desktop.ts`, `src/lib/autoBackup.ts`, `src/lib/exportDir.ts`, тесты JS и Rust.
    Зависимости: cargo `tauri-plugin-dialog = "2"`, `percent-encoding = "2"`, `dunce = "1"`; npm — нет.
  - Часть 2: мини-окно `capture` (отдельная точка входа `capture.html`), трей, закрытие в трей, автозапуск,
    один экземпляр, канал расширения — HTTP на 127.0.0.1 с токеном (протокол v1), структура `extension/` (MV3),
    владение файлами этапа 7, риски NSIS/MSI и CSP, список приёмки Windows.
- Проверено: версии плагинов по индексу crates.io и `npm view`; API — по исходникам tauri 2.12.5,
  tauri-plugin-dialog, tauri-plugin-single-instance в локальном реестре cargo и по исходникам
  plugins-workspace (autostart, deep-link). Код проекта не менялся, пакеты не устанавливались.
- Не согласовано (спецификации соседних архитекторов на момент сдачи отсутствовали): форма результата
  `markdownExport.ts` (в `exportDir.ts` принята структурно, с внедрением `toDoc`), значения по умолчанию
  настроек `backup*`/`mdExportDir`, включение путей в `PRIVATE_SETTINGS`.
- Изменённые файлы: `.progress/spec-tauri.md`, `.progress/agents/spec-tauri.md`
