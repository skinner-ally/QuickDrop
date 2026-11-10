# fix-final-ui-detail-capture-settings

Статус: готово (tsc без ошибок в моих файлах, npm test зелёный: 437 тестов)

## Находки
- high XSS через HTML под видом PDF (FilePreview): ИСПРАВЛЕНО частично. «Открыть» только если тип самого Blob = application/pdf, URL строится из Blob с типом application/pdf (items/safeFileUrl.ts, тест safeFileUrl.test.ts). ТРЕБУЕТ ЧУЖИХ ФАЙЛОВ: src/lib/exportImport.ts decodeFile — белый список mimeType (image/* кроме svg+xml, pdf, text/plain, audio/*, video/*, иначе octet-stream) и thumbType (png/jpeg/webp); index.html — meta CSP.
- medium SVG в origin приложения: ИСПРАВЛЕНО в UI — SVG показывается растеризованным в PNG (useImageUrl), неизвестные типы оборачиваются в octet-stream, Lightbox draggable={false}. ТРЕБУЕТ ЧУЖОГО: CSP в index.html/хостинге (script-src 'self').
- medium ContentEditor теряется при закрытии: ИСПРАВЛЕНО — delay 800 мс, flush на visibilitychange(hidden)/pagehide в useAutosave; Esc откатывает к значению на входе в правку.
- medium автосохранение помечает правку сохранённой до успеха: ИСПРАВЛЕНО — откат baseRef при false/исключении; LinkCard возвращает успех и откатывает поле при ошибке; TriageMode TitleField откатывает savedRef.
- medium Enter на телефоне: ИСПРАВЛЕНО — (pointer: coarse): Enter = перенос, подсказка на кнопке скрыта, enterKeyHint.
- high macOS-экспорт/скачивание в Tauri: ТРЕБУЕТ ЧУЖИХ ФАЙЛОВ, не исправлено. Нужно: src-tauri/src/lib.rs (on_download для окна, либо tauri-plugin-dialog + tauri-plugin-fs, Cargo.toml, capabilities/default.json dialog:allow-save, fs:allow-write-file, package.json) и общий helper saveBlob(blob, name) в src/lib/actions.ts (actDownload); после этого DataSection.doExport переключить на него (в моей области, сделаю по готовности helper).
- low предпросмотр заголовка до сохранения: ИСПРАВЛЕНО — предпросмотр с сетевыми запросами убран из QuickCapture (метаданные подтягивает createAndEnrich).
- low http:// в адресе ИИ: ИСПРАВЛЕНО в AiSection (https или http только localhost/127.0.0.1/[::1]). ТРЕБУЕТ ЧУЖОГО: та же проверка в suggestForItem (src/lib/ai.ts) перед fetch.
- low удалённые превью ссылок: ИСПРАВЛЕНО частично — image/favicon в LinkCard, ItemCard, TriageMode показываются только при autoFetchLinkTitle=true (items/remoteImages.ts). ТРЕБУЕТ ЧУЖОГО: sanitizeLinkMeta в src/lib/exportImport.ts — не переносить image/favicon при импорте.
- low теги целым массивом: ИСПРАВЛЕНО — saveTags (дельта через addTags/removeTag) в ItemDetail, AiSuggest, TriageMode (tag accept и TagInput).
- low висячий categoryId из черновика: ИСПРАВЛЕНО — в save() категория проверяется через listCategories, иначе null.
- low файлы/дубль черновика: ИСПРАВЛЕНО — закрытие во время сохранения блокируется, writeDraft(null) до проверки mountedRef, при закрытии с файлами confirm.
- low затирание сохранённого черновика внешним draft: ИСПРАВЛЕНО — при открытии с внешним содержимым сохранённый черновик не перезаписывается и не очищается.

## Изменённые файлы
items: FilePreview, ItemDetail, ItemCard, TriageMode, safeFileUrl.ts(+test), remoteImages.ts; items/detail: autosave, ContentEditor, LinkCard, FileBlock, AiSuggest, save; capture/QuickCapture; views/settings/AiSection.
