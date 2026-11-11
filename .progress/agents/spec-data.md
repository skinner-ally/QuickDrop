# spec-data

- Задача: спецификация этапа 2 (данные и логика без интерфейса) + данные этапов 4, 5, 8 → `.progress/spec-stage2.md`.
- Статус: готово
- Результат: `.progress/spec-stage2.md` — 7 разделов: решения (Р1–Р14), шаг контрактов с готовым кодом
  (`types.ts`, `db.ts` v2, `filter.ts`, `normalize.ts`, `settingsSchema.ts`, `store/ui.ts`), контракты всех новых и
  изменённых экспортов (repo, dedupe, search + грамматика запроса, dates, plainText, computeVisible, exportImport v2,
  seed, graphLayout, store/graph, wikiLinks, markdownExport, pdfText/pdfEngine, useItems, actions, trashCleanup, ocr),
  изменения существующих тестов и обязательные новые, разбивка на 8 исполнителей в 3 волны без пересечения файлов,
  влияние корзины на UI (этапы 3–5, 8), точки интеграции и вопросы.
- Сведено с `.progress/spec-tauri.md`: имена настроек (`backupDir`, `backupEvery`, `backupKeep`, `backupLastAt`,
  `mdExportDir`, `closeToTray`, `extEnabled`, `extPort`, `extToken`), `ItemSource += 'extension'`, форма документа
  экспорта Markdown (`ExportDoc`), правила имён файлов (`safe_rel_path`).
- Не сведено: `.progress/spec-stage1.md` на момент сдачи не существовал — имена типов `SceneSetting`/`FontSetting`,
  списков `SCENES`/`FONTS` нужно сверить до шага 0.
- Код в `src/`, `src-tauri/`, `public/`, `package.json`, `CLAUDE.md`, git — не трогал. Ничего не устанавливал
  (`npm view pdfjs-dist` → 6.5.438).
- Изменённые файлы: `.progress/spec-stage2.md` (новый), `.progress/agents/spec-data.md`
