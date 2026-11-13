# stage8-ocr-data

Задача: пакет «ocr-data» этапа 8 (волна 0) — `.progress/spec-stage8.md` §2.1, Р1–Р4, §5.1 (источник share).

Статус: готово

## Сделано
- `src/types.ts`: `Item.ocrVisionAt?` (после `ocrAt`, с комментарием), `Settings.aiAutoOcrSince` (умолчание 0),
  комментарий `aiAutoOcr` дополнен («изображение отправляется на aiBaseUrl»), комментарий `ocrText` — пишут
  `setOcrText` и `setVisionText`; `ITEM_SOURCES` += `'share'`.
- `src/lib/settingsSchema.ts`: `aiAutoOcrSince` — конечное число >= 0 (правило `backupLastAt`).
- `src/db/repo.ts`: `setVisionText(id, text, at?)` (ocrText через cleanOcrText, ocrAt = ocrVisionAt = at ?? now,
  updatedAt не меняется, корзина обновляется), `markVisionTried(id, at?)` (только ocrVisionAt). `setOcrText` не тронут.
- `src/lib/exportImport.ts`: `aiAutoOcrSince` в PRIVATE_SETTINGS; `sanitizeItem` — `ocrVisionAt` через `ts()`,
  только при `fileId`; `withNewerOcr` — итоговый `ocrVisionAt` = наибольший из двух версий (при том же вложении),
  без изменений возвращает тот же объект; комментарий о версиях формата. Версии схемы/копии не менялись.
- `src/db/seed.ts`: `aiAutoOcrSince` в CLEARED_SETTINGS.
- `src/components/items/ItemDetail.tsx`: `SOURCE_LABEL.share = 'из «Поделиться»'`.
- Тесты: repo (setVisionText ×3, markVisionTried, setOcrText не снимает ocrVisionAt), exportImport (sanitizeItem,
  полный цикл с ocrVisionAt и share, слияние — 6 случаев, приватность aiAutoOcrSince при экспорте и replace),
  seed (стирание aiAutoOcrSince), settingsSchema (проверка и mergeSettings).

## Проверки
- `npm run typecheck` — без ошибок; `npm test` — 83 файла, 2410 тестов прошли.
