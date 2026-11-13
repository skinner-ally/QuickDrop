# stage7-ui-capture
Задача: пакет ui-capture этапа 7 — мини-окно быстрой записи (спека .progress/spec-tauri.md п. 2.14.5, 2.2).
Статус: готово
Результат:
- CaptureForm.tsx — форма, перенесённая из QuickCapture механически; пропсы по п. 2.14.5 (+ экспорт SnapshotFn, CaptureFormProps).
  Отличия variant="window": форма занимает высоту окна и прокручивается внутри, поле текста растягивается (field-sizing-fixed, flex-1),
  «Отмена» видна и на широком экране; пауза скрытия на время системного диалога файла (onFilePicker(true) перед click(), false на change и cancel).
- QuickCapture.tsx — Dialog + CaptureForm variant="dialog" + notifySaved (прежнее поведение).
- capture.html, src/capture-main.tsx, src/styles/capture-window.css.
- CaptureWindowApp.tsx — ErrorBoundary > ThemeProvider > TooltipProvider > рамка (px-panel / bg-popover с рамкой) + Toaster; шапка data-tauri-drag-region.
  Esc: перехват запоминает открытый список (aria-expanded), всплытие закрывает окно, если никто не занял событие.
- captureWindow.ts (+ тест, 16 тестов): CAPTURE_WINDOW_LABEL, CAPTURE_BLUR_DELAY_MS, hideCaptureWindow, createBlurHider, initCaptureWindow;
  добавлено isCaptureWindowVisible (гонка первого показа: capture-shown мог прийти до подписки).
- vite.config.ts: build.rolldownOptions.input {main, capture} только при isTauriBuild (условное расширение конфига).
Файлы: capture.html, src/capture-main.tsx, src/styles/capture-window.css, src/components/capture/{CaptureForm,QuickCapture,CaptureWindowApp}.tsx,
  src/lib/captureWindow.ts, src/lib/captureWindow.test.ts, vite.config.ts
Проверено: typecheck, npm test (81 файл / 2364 теста), /capture.html в браузере (пиксельная «Осень» ночь 640x440; «Классика» — подменой класса).
