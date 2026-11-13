# fix-review7-web — исправления ревью этапа 7, группа «web»

Статус: готово

## Задача
9 находок ревью этапа 7 (быстрый захват) в src/**, README.md. git не трогал, Rust не менял.

## Исправлено
1–2 (дубль). «Удалить все данные» не останавливал приём от расширения.
   - `src/lib/desktop.ts`: `stopExtensionServer()` — ext_server_apply с enabled:false, порт по умолчанию, token ''.
   - Новый `src/lib/dataDesktop.ts`: `clearAllDataAndStopExtension()` (clearAllData + остановка в Tauri, возвращает
     текст ошибки для toast) и `applyImportedShellSettings()` (см. п. 6). Отдельный модуль: seed.ts не тянет
     desktop.ts, мини-окно (импортирует desktop.ts) не тянет демоданные.
   - `DataSection.doClear` вызывает его; в описании диалога (только Tauri) — «приём выключится, токен будет удалён».
   - Второй рубеж `src/lib/extInbox.ts` (`drainOnce`): после ext_take_pending читается `getSettings()`; если
     `extEnabled !== true` или чтение упало — каждому сообщению ext_capture_done ok:false, error «Приём выключен»
     (`RECEIVING_OFF`), записи не создаются. Пустая очередь настройки не читает.
   - Вариант 3 (useEffect в ExtensionBlock на extEnabled) НЕ сделан: гонка с `toggleEnabled(on)` — сервер
     запускается до записи extEnabled=true, эффект с устаревшим extEnabled=false остановил бы только что
     включённый приём. Расхождение состояния и так закрыто вторым рубежом.
3. Дубль ссылки в мини-окне сразу после показа.
   - `src/db/repo.ts`: новый экспорт `listLiveItems()` (записи вне корзины).
   - `src/lib/actions.ts`: `findDuplicateLinkNow(url)` — по снимку, без снимка — `repo.findDuplicateLink`
     (индекс type). `actApplyWikiLinks` без снимка читает `listLiveItems()` (вики-связи больше не теряются).
   - `CaptureForm.save` проверяет дубль через `findDuplicateLinkNow` (ошибка чтения → toast через catch).
5. Мини-окно не строит индекс поиска: `useItems.subscribeItems.next` — `schedulePrepareIndex()` только вне
   `isCaptureWindow()`. Повторное чтение таблицы после показа оставлено: TagInput (useAllTags) всё равно нужен
   полный снимок.
4, 9. Тексты: подсказка глобального сочетания зависит от `settings.captureWindow` (`shellUi.globalShortcutHint`);
   шаг 2 установки — «папку extension из исходников QuickDrop (в установщик она не входит)». README: абзац про
   сочетание исправлен (настройка теперь в «Быстром захвате»), добавлен раздел «Быстрый захват (настольная версия)».
6. Импорт «Заменить» применяет флаги трея и мини-окна в Rust сразу (`applyImportedShellSettings` в
   `DataSection.doImport`; отказ → toast «вступят в силу при следующем запуске»).
7. Порт: `CommitInput` получил проп `inlineCommitError` — отказ onCommit показывается под полем (aria-invalid,
   role=alert), значение помнится как отвергнутое (blur после Enter не повторяет попытку; правка или Esc
   сбрасывают). Другие поля ведут себя как раньше (toast). `commitPort` при отказе берёт состояние из Rust
   (`getExtServerStatus`, прежний сервер жив), текст — `shellUi.portRejectedText` («… Порт не изменён: N»).
   Попутно: поле глобального сочетания при отказе показывало «Сохранено» (onCommit не бросал) — теперь бросает,
   ошибка под полем; лишний toast «Глобальное сочетание применено» убран (остаётся «Сохранено»).
8. Потеря фокуса мини-окном больше не переключает вопрос «Закрыть?»: `captureWindow.hideOnBlur(canAutoHide,
   requestClose)`; CaptureForm кладёт в новый необязательный проп `autoHideRef` проверку без побочных эффектов
   (`!saving && !hasFiles`). С файлами окно просто остаётся.

## Тесты
- `src/lib/dataDesktop.test.ts` (новый): стирание + ext_server_apply {enabled:false, port:47821, token:''} ровно
  один раз; ошибка остановки → текст; вне Tauri без invoke; set_shell_options из настроек после импорта.
- `extInbox.test.ts`: extEnabled=false → createAndEnrich не вызван, ok:false «Приём выключен»; ошибка настроек →
  отказ; пустая очередь настройки не читает.
- `actions.test.ts`: `findDuplicateLinkNow` со снимком и без (корзина не в счёт); тест «снимка нет» для
  actApplyWikiLinks переписан под новое поведение (связь создаётся, корзина не в счёт).
- `useItems.test.ts`: в мини-окне индекс заранее не строится (проверено: без правки тест падает).
- `captureWindow.test.ts`: hideOnBlur. `shellUi.test.ts`: globalShortcutHint, шаг 2, portRejectedText.
- `npm run typecheck` — ок; `npm test` — 82 файла, 2381 тест, всё зелёное. Rust не менялся.

## Замечание
`toggleEnabled(on)` запускает сервер раньше, чем пишет extEnabled=true: сообщение, пришедшее в эти миллисекунды,
получит «Приём выключен». Сознательно не менял порядок (запись до запуска потребовала бы отката при отказе).

## Изменённые файлы
src/lib/desktop.ts, src/lib/dataDesktop.ts (новый), src/lib/dataDesktop.test.ts (новый), src/lib/extInbox.ts,
src/lib/extInbox.test.ts, src/views/settings/DataSection.tsx, src/db/repo.ts, src/lib/actions.ts,
src/lib/actions.test.ts, src/components/capture/CaptureForm.tsx, src/components/capture/CaptureWindowApp.tsx,
src/lib/captureWindow.ts, src/lib/captureWindow.test.ts, src/hooks/useItems.ts, src/hooks/useItems.test.ts,
src/lib/shellUi.ts, src/lib/shellUi.test.ts, src/views/settings/QuickCaptureSection.tsx,
src/views/settings/Section.tsx, README.md
