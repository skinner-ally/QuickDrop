# final-fix-docs

Задача: исправления финального ревью, группа docs.
Статус: готово

## Результат
1. CLAUDE.proposed.md: добавлены ocrClearedAt/ocrAutoSkipAt, clearOcrText/markVisionAutoSkip (setOcrText больше не «очистка»),
   сдвиг aiAutoOcrSince в setSettings, planVisionTiles и статус 'tiles', ocrAutoSkipAt в isVisionBacklog/правилах, слияние копий,
   поля копии, список полей без updatedAt. Полные сигнатуры статусов/категорий (unarchive, deleteCategory, listCategories и др.)
   возвращены как в CLAUDE.md. gen-icons — только PWA, значки Tauri — tauri icon. Оговорка про проверочные запросы при aiEnabled=false.
   NSIS вместо «NSIS и MSI».
2. README: порядок выпуска (lock-файлы, пять файлов), ручной запуск release.yml, ИИ-формулировка, nsis/ без msi/, описание CI.
   scripts/check-version.mjs читает и src-tauri/Cargo.lock, подсказывает cargo update. Проверено на подмене версии в lock.
3. docs/ИНСТРУКЦИЯ.md: убрано «(или .msi)».
4. .oxlintrc.json: ignorePatterns mockup/** (oxlint теперь код 0). ci.yml: шаг «Линт» в web.
5. ci.yml: rust-задача собирает фронтенд с TAURI_ENV_PLATFORM=windows и проверяет capture.html есть, sw.js нет;
   web-задача проверяет sw.js есть, capture.html нет (обе проверки прогнаны локально).
6. release.yml: шаг в web, запрещающий ручной запуск не с тега, если опубликованный релиз v<версия> уже есть.
7. spec-stage8.md: раздел «Поправки после ревью» (clear/skip/импорт/сдвиг since/классы ошибок/tiles).

## Изменённые файлы
README.md, docs/ИНСТРУКЦИЯ.md, .progress/CLAUDE.proposed.md, .progress/spec-stage8.md, .github/workflows/ci.yml,
.github/workflows/release.yml, scripts/check-version.mjs, .oxlintrc.json

## Проверка
typecheck чист; vitest: 2661 из 2662, падение одного теста в ambient/effects (таймаут 5 с под нагрузкой, отдельный прогон 56/56, не мои файлы);
npm run build в обоих вариантах (с TAURI_ENV_PLATFORM и без) проходит.
