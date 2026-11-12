# docs-sync

Задача: привести документы в соответствие с кодом после ревью этапов 1–2 (код, git, CLAUDE.md не трогать).

Статус: готово

## Сделано
- docs/DESIGN.md: запрет `!`; запас ≥ 4px у прокручиваемых блоков; правило про золото (заливка с тёмной рамкой /
  линия с кромкой, значок наследует цвет, aria-invalid → danger); §5: `px-fab`, `px-icon`, `data-skin="panel"|"none"`,
  `--px-pad`, `--px-sheet-pad`; §7: `pixelSize`. Таблица §5 сверена с `grep '\.px-' pixel.css`.
- spec-stage3: рецепт pixel:text-inherit помечен устаревшим (и ссылки на него), звезда и курсор — по правилу про золото,
  P0 отмечен выполненным (§0, §5, §5.4).
- spec-stage2: импорт (корзина +7 суток, положения по клеткам и Р8, OCR при слиянии, PRIVATE_SETTINGS с backupEvery/
  backupKeep, clearAllData не сбрасывает backupLastAt), PdfTextResult.permanent, PdfEngine.open(data, signal),
  createPdfEngine(pdfjs, makeWorker?), очередь и ocrAt, drainPdfBackfill, composeQuery/relativeDates,
  prepareSearchIndexAsync.
- spec-tauri: OwnBackups, prune protect, discard_export_part, pick_directory purpose, resolve, checkDir и пауза
  retry-later в автокопии, discard в invokeChunked, PRIVATE_SETTINGS.

Файлы: docs/DESIGN.md, .progress/spec-stage3.md, .progress/spec-stage2.md, .progress/spec-tauri.md
