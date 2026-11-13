# fix-review8-docs-ci

Статус: готово

Задача: две мелочи ревью этапа 8 (docs-ci).

1. docs/ИНСТРУКЦИЯ.md:182 — переключатель «Просмотр / Исходник» стоит под текстом справа рядом с «Изменить»
   (ContentEditor toolbar), у файлов .md — над предпросмотром (FilePreview). Формулировка исправлена.
2. .progress/CLAUDE.proposed.md — возвращены: токены bg-surface/bg-sidebar; правило ThemeProvider / next-themes / sonner;
   примечание к TagInput; сигнатура pickDirectory({ purpose?, defaultPath? }).

Проверено по коду: обе находки верны. typecheck и npm test пройдены.

Изменённые файлы: docs/ИНСТРУКЦИЯ.md, .progress/CLAUDE.proposed.md
