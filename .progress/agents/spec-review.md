# spec-review — сверка спецификаций

- Задача: рецензия `.progress/spec-stage1.md`, `spec-stage2.md`, `spec-tauri.md`, `spec-stage3.md`, `docs/DESIGN.md`
  на противоречия между собой, расхождения с `plan-combined.md`, технические ошибки и дыры. Очевидное — исправить
  в файлах спецификаций с пометкой «(уточнено при сверке)».
- Статус: готово
- Код в `src/`, `src-tauri/`, `public/`, `package.json`, `CLAUDE.md`, git — не тронуты. Ничего не устанавливалось.

## Что проверено по коду и реестрам

- Все названные в спецификациях файлы, экспорты и внутренние имена существуют: `SOURCE_LABEL`, `VIEWS`,
  `VIEW_BY_DIGIT`, `PRIVATE_SETTINGS`, `CLEARED_SETTINGS`, `isPristineDemo`, `repairIntegrity`, `sanitizeItem`,
  `ParsedQuery.categoryName`, `resolveCategoryName`, `MAX_INDEXED_CONTENT`, `getSearchIndexStats`, `SearchOptions.within`,
  `settleLinkMeta`, `safe()` в `actions.ts`, `CaptureForm`, `CategoriesContext`, `StarMark`, `LeadCell`, `modKey`.
- Все `data-slot`, на которые опирается `pixel.css`, есть в `src/components/ui/*` (у `badge` — через `useRender`),
  `data-side` у листа есть, классы фона вариантов кнопки совпадают с §1.3 этапа 1.
- lucide: 41 файл с импортом, все `.tsx` внутри `components/` и `views/`; все 82 экспорта реестра есть в 1.71.0.
- `cn` (пакет `cn` 0.5.2): классы `px-*` примитивов не сливаются с отступами `px-N`; `text-2xs|2sm|md` распознаются
  как размер.
- npm: `@fontsource-variable/nunito` 5.3.0, `@fontsource-variable/handjet` 5.3.1, `@fontsource/tiny5` 5.3.0,
  `pdfjs-dist` 6.5.438 (Node ≥ 22.13, локально 22.23.2), `@tauri-apps/plugin-autostart` 2.7.0, `react-markdown` 10.1.0,
  `remark-gfm` 4.0.1. crates.io: `tiny_http` 0.12.0, `dunce` 1.0.5, `percent-encoding` 2.3.2; у плагинов Tauri
  `cargo search` показывает 3.0.0-alpha — в `Cargo.toml` писать `"2"`.
- Tauri 2.12.5 (исходники в локальном реестре cargo): `ipc::Request::body()/headers()`, `WebviewWindowBuilder::from_config`,
  `cursor_position`, `monitor_from_point`, `WindowConfig.create`, `blocking_pick_folder`; `.mjs` отдаётся как
  `text/javascript` (`tauri-utils` 2.10.2).
- Dexie 4.4.7: `update(id, { поле: undefined })` удаляет свойство (на это опирается корзина).
- CSP: `font-src 'self' data:` и `worker-src 'self'` (веб) / `default-src 'self'` (Tauri) достаточно для шрифтов и
  worker pdf.js.

## Исправлено в спецификациях

1. Пересечение владения этапов 1 и 2: `src/types.ts` и `src/db/settings.ts` значились и у `theme-core`, и у
   `data-contracts`. Оставлены только за `data-contracts` (шаг 0, общий первый шаг); `theme-core` стартует после него.
   Правки: spec-stage1 §0, §6.1, §6.2, §7.1, §8; spec-stage2 §1.
2. Разные имена одного и того же: `ScenePref`/`FontPref` + `SCENE_PREFS`/`FONT_PREFS` (этап 1) против
   `SceneSetting`/`FontSetting` + `SCENES`/`FONTS` (этап 2). Сведено к именам этапа 1, списки объявлены в `types.ts`,
   `lib/scene.ts` их реэкспортирует. Правки: spec-stage2 §1.1, §1.5, §6 п. 5; spec-stage1 §5.1.
3. Двойная проверка настроек (`ENUM_VALUES` этапа 1 и `isValidSetting` этапа 2) в одном файле — оставлена одна
   (`isValidSetting`).
4. `JSX.Element` в сигнатурах (spec-stage1 §4.2, spec-stage3 §5.1): в `@types/react` 19 глобального `JSX` нет — пояснение.
5. Тесты `ocr.test.ts` / `actions.test.ts` не могли подменить движок PDF — добавлено требование `vi.mock('@/lib/pdfText')`.
6. Клавиши разделов: этап 2 давал цифры «Графу» и «Корзине», этап 3 — только «Графу» (5). Сведено к этапу 3.
7. Автокопия пустой базы: правило было только пожеланием в spec-stage2; внесено в spec-tauri §1.7 и §1.10
   (`countItems()`, причина `'empty'`).
8. spec-tauri §1.11, §2.6, §2.11: предусловия по `types.ts`/`exportImport.ts` закрывает этап 2 — отмечено, чтобы не
   делать дважды.
9. spec-stage2 §6 п. 2: `.mjs` в Tauri проверен; предел workbox 2 МиБ для worker pdf.js.
10. spec-stage1 §2.1: `--label*` — в мокапе цвет табличек грядок; в приложении — подписи нод (грядок нет).
11. spec-stage3 §0, §2.7: стык с параллельным этапом 2; приведение `as CSSProperties` для пользовательских свойств.
12. docs/DESIGN.md §7: ряд размеров пиксельных значков приведён к `snapIconSize` (этап 3 использует 48 px).
13. spec-stage1 §0: в работы основной сессии добавлена замена раздела «Дизайн» в `CLAUDE.md` (этап 0 плана).

## Изменённые файлы

`.progress/spec-stage1.md`, `.progress/spec-stage2.md`, `.progress/spec-stage3.md`, `.progress/spec-tauri.md`,
`docs/DESIGN.md`, `.progress/agents/spec-review.md`.

## Не проверено

- Ничего не запускалось в браузере: поведение `@theme static`, варианта `pixel:`, `pixel:h-7.5`, `bg-(--var)`,
  `display: contents` у тела строки и специфичность правил `pixel.css` выведены из чтения кода.
- Наличие кириллических подмножеств в шрифтовых пакетах взято со слов автора spec-stage1 (сверка по `metadata.json`);
  пакеты не скачивались.
- Размер `pdf.worker.min.mjs` в 6.5.438 неизвестен (пакет не установлен).
