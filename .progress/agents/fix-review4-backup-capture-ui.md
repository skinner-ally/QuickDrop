# fix-review4-backup-capture-ui

Статус: готово. typecheck и npm test проходят (1592).

Исправлено: C5 (forgetPrevDir вместо forgetDirectory), C6/M30 (disabled у DirRow на время экспорта/копии), C8 (flex-[1_1_14rem]),
M15 (useSyncExternalStore + autoBackupDirChanged, в т.ч. после «Сбросить»), M16 (экранная часть — через forgetPrevDir; сверка при старте уже в initDesktop),
M17 (exportReportSummary, красный текст при ошибках), M19 (aria-label кнопок, путь с break-all, aria-describedby), M25 (key/ремонт строки, aria-describedby),
M27 (source: manual/paste/drop), А1 (строка «Хранить копий»: подпись слева, поле w-20 справа).

Пропущено: pwa.ts share_target — в ITEM_SOURCES нет значения 'share' (types.ts вне границ), остаётся умолчание 'paste'.
FilePreview role=region (M25, последняя часть) — файл вне границ.

Файлы: src/views/settings/BackupSection.tsx, src/components/capture/QuickCapture.tsx, src/views/InboxView.tsx, src/hooks/useHotkeys.ts
