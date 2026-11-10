# core-export-import
Статус: готово
Задача: src/lib/exportImport.ts (exportBackup / importBackup / backupFileName) + тесты src/lib/exportImport.test.ts

## Результат
- Формат: `{ app: 'quickdrop', version: 1, exportedAt: number, settings, categories, items, files[] }`,
  files: `{ id, itemId, name, mimeType, size, createdAt, data: base64, thumb?: base64, thumbType? }`.
- Экспорт: снимок в одной r-транзакции, base64 кусками по 48 КБ (кратно 3, < лимита аргументов Safari),
  каждый файл — отдельная часть Blob. aiApiKey и seeded не экспортируются никогда.
- Импорт: строгая проверка (app, целая version 1..1, массивы items/categories/files) → Error на русском;
  починка каждой записи (неизвестный type/status/без id → skipped; теги через normalizeTag из repo;
  favorite → 0|1; links — только строки, без самоссылок и дублей); base64 → Blob до транзакции.
- replace: очистка items/files/categories, запись, настройки из копии (кроме aiApiKey/seeded).
- merge: свежий updatedAt побеждает (равенство → локальная, skipped); категории по id (локальная остаётся),
  по имени без регистра → переиспользование локальной и перемаппинг categoryId; новые категории встают
  после локальных; файлы по id — пишутся, только если на них ссылается итоговая запись.
  Настройки в merge не трогаются.
- Починка всей базы в той же rw-транзакции: связи на несуществующие записи убираются и становятся
  двунаправленными, categoryId на несуществующую → null, fileId без файла убирается,
  файлы без ссылающейся записи удаляются. updatedAt при починке не меняется.
- После импорта meta.seeded = true (иначе seedDemoData подмешал бы демо к восстановленным данным).
- Доп. экспорты: backupFileName(date?), blobToBase64, base64ToBytes, sanitizeItem, sanitizeSettings,
  типы ImportMode, ImportReport, BackupData, BackupFileEntry, константы BACKUP_APP/BACKUP_VERSION.

## Проверка
- `npx vitest run src/lib/exportImport.test.ts` — 13/13.
- `npx tsc -b` — без ошибок; oxlint — чисто.

## Изменённые файлы
- src/lib/exportImport.ts (новый)
- src/lib/exportImport.test.ts (новый)
- .progress/agents/core-export-import.md
