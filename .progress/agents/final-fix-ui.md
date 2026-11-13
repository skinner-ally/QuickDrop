# final-fix-ui

Задача: исправления финального ревью, группа ui (находки 1-13).
Статус: готово (typecheck чист; npm test: 2661/2662, единственный провал — таймаут 5 с в effects.test.ts при полной нагрузке, плавающий: в изоляции проходит)

## Исправлено
1. ItemCard: сниппет по распознанному тексту у file/image (список и сетка), новый ocrSnippet.ts + тест; sameItem сравнивает ocrAt.
2. Граф: focus({preventScroll}) + прокрутка самого списка; overflow-clip у слоя и сцены; maxHeight списка по высоте сцены.
4. Мини-окно (частично, в своём файле): паузы скрытия на любые перетаскивания, отметка «бросок без фокуса» не даёт окну спрятаться до фокуса/нового показа.
5. ocrView: очищенный PDF — network null (и в ветке failed), скан после перезапуска — «Распознать текст»; тесты.
6. ContentEditor: проп normalize; OcrBlock передаёт cleanOcrText.
7. MarkdownView: вики-ссылка в графе идёт через openItemInSection.
8. CaptureWindowApp: CaptureErrorFallback (Закрыть, Esc, перерисовка по capture-shown).
9. CaptureWindowApp: toast при «Сохранить и добавить ещё», toast.dismiss() в close().
10. QuickCaptureSection: кнопка «Повторить» у неназначенного сочетания.
11. ContentEditor maxLength, OcrBlock передаёт OCR_EDIT_MAX.
12. ItemDetail: «из браузера».
13. DataSection: drainPdfBackfill() после импорта.

## Не сделано (чужие файлы)
- 3: src-tauri/src/shell.rs (вариант А из находки).
- 4: src/lib/captureWindow.ts + src-tauri/capabilities/capture.json (focusCaptureWindow, core:window:allow-set-focus).

## Изменённые файлы
src/components/items/ItemCard.tsx, ocrSnippet.ts (+test), ItemDetail.tsx, detail/ocrView.ts (+test), detail/ContentEditor.tsx, detail/OcrBlock.tsx,
src/components/graph/GraphCategoryPicker.tsx, GraphOverlay.tsx, src/views/GraphView.tsx,
src/components/capture/CaptureWindowApp.tsx, src/components/markdown/MarkdownView.tsx,
src/views/settings/QuickCaptureSection.tsx, DataSection.tsx
