# stage8-ocr-facade

Задача: пакет «ocr-facade» этапа 8 (волна 0) — `.progress/spec-stage8.md` §1 (Р5–Р8), §2.2.
Файлы: `src/lib/ocrState.ts` (+test), `src/lib/ai.ts` (+test), `src/lib/actions.ts` (+test).

Статус: готово

## Сделано
- `src/lib/ocrState.ts` (новый, без React и сети): все пределы §2.2; `ocrKindOf`, `isScanPdf`, `needsVision`,
  `isVisionBacklog` (since <= 0 или не число → false); типы `OcrOutcome`, `OcrJob`, `OcrNote`; хранилище сеанса
  `get/setOcrJob`, `get/setOcrNote`, `subscribeOcr`, `resetOcrState` (ссылки стабильны, снятие отсутствующего —
  без уведомления, сбой одного подписчика не мешает остальным).
- `src/lib/ai.ts` (только добавления; `suggestForItem`, `aiBaseUrlError`, `parseAiJson`, `normalizeTags` не тронуты):
  `VISION_TIMEOUT_MS`, `VisionError(kind, message, status?)`, `visionModelOf`, `visionAvailability`, `aiHostLabel`,
  `VisionReply`, `cleanVisionAnswer`, `recognizeImage` — проверка доступности первой (до чтения Blob и сети), тип
  JPEG/PNG и предел 4 МБ, data-URL через `blobToBase64`, тело по §2.2 (temperature 0, без response_format/max_tokens/
  detail), один общий предел 120 с на вызов вместе с повтором, повтор без temperature ровно один, таблица ошибок,
  content строкой или массивом частей, content_filter → item, length → truncated. Ключ, повторённый сервисом в теле
  ошибки, заменяется на `***`.
- `src/lib/actions.ts`: `actRecognize`, `actCancelRecognize`, `actSaveOcrText`, `actClearOcrText` (с «Отменить»);
  `createAndEnrich` — фоновая `extractInBackground`: настройки → `vision = aiEnabled && aiAutoOcr` (ошибка чтения =
  выключено), PDF всегда, картинка только при vision. Импорт `textSourceOf` заменён на `ocrKindOf`.
- Тесты: `ocrState.test.ts` (новый), `ai.test.ts` (+ распознавание), `actions.test.ts` (+ подмена `@/lib/ocr` с
  проходом в настоящий `extractItemText` по умолчанию; создание записи, actRecognize по исходам, отмена, правка, очистка).

## Проверки
- `npm run typecheck` — без ошибок; `npm test` — 84 файла, 2499 тестов; `oxlint` по файлам пакета — чисто.
