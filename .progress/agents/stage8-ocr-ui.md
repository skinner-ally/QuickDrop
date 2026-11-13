# stage8-ocr-ui

Задача: пакет «ocr-ui» этапа 8 (волна 1) — `.progress/spec-stage8.md` §4, §1 (Р12). Интерфейс распознавания.
Файлы: `src/hooks/useOcr.ts`, `src/components/items/detail/ocrView.ts` (+test), `OcrBlock.tsx`, `ItemContent.tsx`,
`src/views/settings/AiSection.tsx`, `docs/DESIGN.md`.

Статус: готово

## Сделано
- `src/hooks/useOcr.ts`: `useOcrJob(id)`, `useOcrNote(id)` над `subscribeOcr` (`useSyncExternalStore`).
- `ocrView.ts` (+`ocrView.test.ts`, 26 тестов): `ocrBlockView(item, job, note, aiBlocked, readOnly?)` — вся таблица §4.2,
  корзина, длинный текст; `ocrNetworkLine`, `ocrJobLabel`, `charsLabel`, `visibleOcrText`, `OCR_SCAN_PDF_NOTE`.
- `OcrBlock.tsx`: состояния job / failed / empty / start / note / text; текст — свёрнутый раздел, внутри `ContentEditor`;
  строка о сети с `aria-describedby`; автораскрытие после ручного распознавания по смене `ocrAt`.
- `ItemContent.tsx`: `OcrBlock` между `FileBlock` и заметкой (`key={item.id}`).
- `AiSection.tsx`: новый абзац/подсказки, блок «Распознавание текста» (модель, переключатель, «Проверить распознавание»).
- `docs/DESIGN.md`: §14 «Распознанный текст».

## Проверки
- `npm run typecheck` — чисто; `npm test` — 86 файлов, 2545 тестов; `oxlint` по файлам пакета — чисто.
- Не проверено глазами: оба стиля, 1200 и 375 px (браузер не запускался по правилам пакета).

