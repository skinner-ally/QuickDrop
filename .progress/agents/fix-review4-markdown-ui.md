# fix-review4-markdown-ui

Статус: готово

Задача: исправления ревью этапа 4, группа markdown-ui.

Исправлено:
- C1=C10=C13: TriageMode передаёт onOpenItem (закрыть разбор через ref на onClose, затем select(id)) в MarkdownText и FilePreview; FilePreview получил необязательный onOpenItem (-> GenericFile -> FileTextBody).
- C7: отступ в li/blockquote/td только перед блочными детьми (markdown.css, слой и пиксельная копия). Тест src/styles/markdown.test.ts.
- C9: aria-label флажка из текста пункта без подпунктов (taskLabel, <=120 символов), cursor: pointer / default для readonly. Тест MarkdownView.test.ts.
- M1: ContentEditor не вызывает onCommitted, если текст равен значению на входе в правку (Esc, blur без правок, размонтирование).
- M4 (экранная часть): MdImage проверяет адрес openableLinkUrl.
- M5: пояснение при тексте длиннее MD_RENDER_MAX.
- M21: overflow-wrap: break-word вместо anywhere.
- M24: пиксельное line-height: inherit перенесено в @layer components, leading-relaxed на MarkdownText работает. DESIGN.md §12 дополнен.

Пропущено:
- M3: в моих файлах нечего менять (вся логика в wikiLinks.ts, группа markdown-logic).
- M4 действие (toast в openLink) - actions.ts, не мой файл.
- ViewModeToggle.tsx, LinkCard.tsx, ItemContent.tsx, pixel.css не менялись.
- Компонентного теста для ContentEditor нет (нет DOM в vitest).

Файлы: src/components/markdown/MarkdownView.tsx, MarkdownText.tsx, src/styles/markdown.css, docs/DESIGN.md, src/components/items/TriageMode.tsx, FilePreview.tsx, detail/ContentEditor.tsx, новые тесты src/components/markdown/MarkdownView.test.ts, src/styles/markdown.test.ts.
