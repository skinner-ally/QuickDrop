# data-pdf

Задача: этап 2, волна 1 (`.progress/spec-stage2.md` §2.8, §3 `pdfText`, §4, §6 п. 2) — извлечение текста из PDF:
`src/lib/pdfText.ts` (+тест), `src/lib/pdfEngine.ts`.

Статус: готово

## Результат

- `src/lib/pdfText.ts` — `extractPdfText`, `isPdf`, константы и типы по §2.8 (+ `PDF_MIN_TEXT_CHARS = 20`).
  Никогда не бросает. Кроме проверок между страницами каждое ожидание (загрузка движка, чтение Blob, открытие,
  страница) состязается с `signal` и таймером 30 с: зависший worker не держит вызывающего. Документ, открывшийся
  после прерывания, закрывается; `close()` ждётся не дольше 2 с.
- `src/lib/pdfEngine.ts` — `loadPdfEngine()` (ленивый чанк) и `createPdfEngine(pdfjs)` (адаптер без worker-файла,
  на нём идут тесты с настоящим pdf.js).
- `src/lib/pdfText.test.ts` — 44 теста: 38 на движке-подделке (§3) и 6 на настоящем pdf.js с PDF, собранным
  строкой в тесте (текстовый слой, кириллица через ToUnicode, предел страниц, страницы без текста, пароль, не-PDF).

## Сверка с пакетом pdfjs-dist@6.5.438

- Файлы на месте: `build/pdf.mjs`, `build/pdf.worker.min.mjs`, `legacy/build/pdf.mjs`,
  `legacy/build/pdf.worker.min.mjs` (1 327 591 байт), типы `legacy/build/pdf.d.mts` → `export * from "pdfjs-dist"`.
- Обычная сборка в Node 22.23 падает: `TypeError: Promise.try is not a function` (в ней без полифилов ещё
  `Map.prototype.getOrInsertComputed`, `Math.sumPrecise`). Legacy-сборка читает тот же PDF. Взята legacy.
- Параметра `isEvalSupported` в 6.5.438 нет (ни в типах, ни в коде), `eval`/`new Function` в сборке нет.
- `getDocument({ data, disableFontFace, useSystemFonts, verbosity })`, `page.getTextContent()` → `items[].str/hasEOL`,
  `task.destroy()`; пароль — исключение с `name === 'PasswordException'`, битый файл — `InvalidPDFException`.

## Проверено

- `npm run typecheck` — зелёный в 21:32 на итоговых файлах (в 21:29–21:31 был красным из-за чужого
  `src/search/search.test.ts`, который в это время правил `data-search`). `npx oxlint` по трём файлам — код 0.
- `npx vitest run src/lib/pdfText.test.ts` — 44/44, четыре запуска подряд.
- `npm test` (21:29) — 1079 из 1081; два красных в чужих файлах: `actions.test.ts` (ожидаемый по §4) и
  `itemTitle.test.ts › formatDayLabel › негодная отметка` (`data-search`).
- Браузер (панель Browser, Chromium), dev-сервер `vite --port 5247`: `extractPdfText` без `engine` на настоящем
  PDF — `ok`, текст с кириллицей; создаётся `new Worker('/node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  { type: 'module' })`; пароль → «PDF защищён паролем»; не-PDF и пустой файл → `failed`; страницы без текста →
  `empty`; 120 страниц — 398 мс; прерывание через `signal` → `aborted`, следующий вызов работает.
- Отдельная production-сборка только этих модулей в scratchpad (`vite build`, `base: '/sub/'`, в `index.html` —
  meta с CSP веб-версии из `vite.config.ts`), `vite preview --port 5248`: worker выпущен как
  `assets/pdf.worker.min-<hash>.mjs` (1 327 591 байт), чанки `pdfEngine-*.js` (0,67 КБ) и `pdf-*.js` (500 КБ)
  грузятся только при первом извлечении; текст извлекается, нарушений CSP нет (контроль: worker из blob: той же
  политикой блокируется).

## Не проверено

- Настоящая сборка приложения (`npm run build`): попадание worker в precache после правки `globPatterns`, работа
  из service worker офлайн.
- Tauri (WebView2, WKWebView), Safari/iOS, Firefox.
- PDF из жизни: большие, со сжатыми потоками, CJK с невстроенными CMap, реально зашифрованные (в тесте пароль —
  файл с произвольными ключами O/U).

## Изменённые файлы

- `src/lib/pdfText.ts` (новый)
- `src/lib/pdfEngine.ts` (новый)
- `src/lib/pdfText.test.ts` (новый)
- `.progress/agents/data-pdf.md`
