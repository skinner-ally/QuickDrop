# stage8-ocr-logic

Задача: пакет «ocr-logic» этапа 8 (spec-stage8.md §1 Р6–Р10, §3) — visionImage, растеризация PDF
(pdfText/pdfEngine/pdfRender), плагин quickdrop:pdf-decoders в vite.config.ts, очередь зрения в ocr.ts, startVisionAuto в main.tsx.

Статус: готово

## Результат
- `src/lib/visionImage.ts` (новый): `planVisionSize`, `prepareVisionImage(blob, { backend })`, `RasterBackend`/`DecodedImage`,
  `VISION_PNG_MAX_BYTES` (1,5 МБ), `VISION_SHRINK_STEPS`. Класс по типу Blob (`classifyBlobType`), SVG — `toImageBlob`,
  белый фон, PNG для png/gif/bmp/svg при ≤ 1,5 МБ, иначе JPEG 0.85 и ступени (2000/0.7, 1600/0.7, 1200/0.6), bitmap
  закрывается в finally. Сбой кодирования — исключение (временная ошибка, без отметки).
- `src/lib/pdfText.ts`: `PdfDocLike.pageImage?`; вынесены для pdfRender `createPdfGuard`, `openPdfGuarded`,
  `closePdfQuietly`, `describePdfFailure`, `PDF_ABORTED`, `PDF_TIMED_OUT`, `PDF_ERR_TOO_BIG` (поведение extractPdfText то же).
- `src/lib/pdfEngine.ts`: `createPdfEngine(pdfjs, makeWorker?, { wasmUrl })`, в getDocument `useWasm: false` и `wasmUrl`
  (с «/»); `pageImage` (масштаб `pageRenderScale` 0.5…4, canvas → render(background white) → JPEG 0.85, cleanup, холст 0);
  `loadPdfEngine` задаёт `wasmUrl = {origin}{BASE_URL}pdfjs/`.
- `src/lib/pdfRender.ts` (новый): `openPdfPages` (не бросает; ≤ 5 страниц; 20 с на открытие и на страницу; permanent для
  > 50 МБ, пароля, битого файла, 0 страниц; движок без pageImage — временно; close идемпотентен).
- `src/lib/ocr.ts`: ветки картинки и скана, задачи (`Pipeline`) с `OcrJob` и отменой, очередь зрения (1 исполнитель, ручная
  впереди, перевод фоновой в ручную), проверка настроек/корзины перед каждым запросом, интервал 3 с и предел 100 за сеанс
  для авто, остановки (config до смены отпечатка настроек, 429 — 60 с, 3 transient подряд — 10 мин, предел — до
  перезапуска) с одним toast, `setVisionText`/`markVisionTried`, `drainVisionBacklog`, `startVisionAuto`,
  `resetOcrSession` (для тестов), `ExtractOutcome = OcrOutcome`.
- `vite.config.ts`: плагин `quickdrop:pdf-decoders` (emitFile `pdfjs/*_nowasm_fallback.js` и
  `licenses/pdfjs-decoders-LICENSE.txt`, dev-middleware по белому списку), `workbox.globIgnores` += `pdfjs/**`. CSP не менялся.
- `src/main.tsx`: `startVisionAuto()`.

## Проверки
- `npm run typecheck` — проходит; `npm test` — 88 файлов, 2603 теста, все проходят; ocr/actions/pdfRender прогнаны 4 раза подряд.
- `npm run lint` — замечаний по файлам пакета нет.
- `npm run build` не запускался (запрещено правилами пакета) — содержимое dist/pdfjs не проверено.

## Изменённые файлы
src/lib/ocr.ts, src/lib/ocr.test.ts, src/lib/visionImage.ts (нов.), src/lib/visionImage.test.ts (нов.),
src/lib/pdfRender.ts (нов.), src/lib/pdfRender.test.ts (нов.), src/lib/pdfEngine.ts, src/lib/pdfEngine.test.ts,
src/lib/pdfText.ts, vite.config.ts, src/main.tsx.
