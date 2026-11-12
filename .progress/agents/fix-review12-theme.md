# fix-review12-theme

Статус: готово

Исправлено:
- 1: px-row[data-cursor] и px-sel — золото с кромкой wood-dark (box-shadow 2px gold + outline 2px wood-dark), вылет 4px (src/styles/pixel.css).
- 2 (кнопка): значок во включённых кнопках/чипах/вкладках наследует цвет (`.px-icon { color: inherit }`) — pixel.css.
- 3: aria-invalid у полей и input-group — рамка danger (pixel.css).
- 4: theme-init.js ставит один meta theme-color без media по таблице THEME_COLOR; тест в src/lib/scene.test.ts (исполняет скрипт, сверяет со всеми сценами).
- 5: ночью пустой чекбокс с рамкой ink-dim; kbd на brand-кнопке ночью — фон brand-hi.

Не сделано (чужие файлы): звезда StarMark в ItemCard.tsx; правки spec-stage1.md §2.3, docs/DESIGN.md §3–4, spec-stage3.md:124/235/248/322/339/453.

Файлы: src/styles/pixel.css, public/theme-init.js, src/lib/scene.test.ts
