# review-final-data

Задача: финальное ревью, линза «данные и надёжность» (только чтение кода, без запуска приложения).

Статус: готово

Прочитано целиком: types, db/db, db/repo, db/settings, db/seed (публичное API), lib/actions, lib/exportImport,
lib/filter, lib/linkMeta (сетевая часть), hooks/useItems, hooks/computeVisible, hooks/useHotkeys, search/engine,
store/ui, store/selection, pwa.ts, lib/desktop, vite.config, src-tauri (lib.rs, conf, capabilities),
components: QuickCapture, ItemDetail, detail/* (autosave, save, ContentEditor, TitleField, LinkCard, ItemContent,
AiSuggest, LinkedItems, LinkPicker, FileBlock), TagInput, TagChip, BulkBar, ItemMenu, TriageMode, CategorySelect,
ItemList (эффекты и клавиатура), FilePreview, views: InboxView (QuickAdd), settings/DataSection, TagsSection,
CategoriesSection. Проверено по node_modules: dexie 4.4.7 (versionchange → close({disableAutoOpen:false})),
dexie-react-hooks (useLiveQuery бросает ошибку в render), vite-plugin-pwa register (autoUpdate → location.reload()).

## Находки (по важности)

1. HIGH — vite.config.ts:18 + src/pwa.ts:52. `registerType: 'autoUpdate'` перезагружает страницу при активации
   нового SW; несохранённый ввод (QuickCapture — черновик пишется в sessionStorage только при закрытии; ContentEditor —
   сохраняет только по blur; QuickAdd) теряется. Сценарий: после деплоя открыть PWA и сразу печатать заметку — через
   несколько секунд страница перезагружается, текст пропал. Исправление: registerType 'prompt' (toast «Обновить») либо
   откладывать reload, пока открыт capture/идёт правка; плюс писать черновик capture при вводе.
2. MEDIUM — detail/ContentEditor.tsx:28. Содержимое записи сохраняется только по blur/Ctrl+Enter/размонтированию
   (useAutosave без delay), обработчиков pagehide/visibilitychange/beforeunload в проекте нет. Закрытие вкладки или
   окна Tauri, выгрузка PWA в фоне на iPhone во время правки → весь набранный текст потерян. Исправление: debounce
   (как у заголовка) + flush на visibilitychange/pagehide.
3. MEDIUM — lib/actions.ts:36-44, detail/LinkCard.tsx:61-67. loadLinkMeta пишет результат без проверки, что url записи
   не изменился. Сценарий (Tauri, запрос до 8–24 с): добавить ссылку A, сразу исправить адрес на B → ответ по A,
   пришедший позже, затирает linkMeta B: запись с адресом B показывает заголовок/картинку A (или 'failed').
   Исправление: в loadLinkMeta в транзакции сверять item.url с запрошенным (или токен запроса).
4. MEDIUM — lib/actions.ts:54,67; LinkCard.tsx:124. linkMeta.status 'pending' хранится в БД и нигде не сбрасывается.
   Закрыли приложение/перезагрузка во время запроса, удаление+«Отменить» во время запроса (updateItem по удалённой
   записи — no-op, снимок возвращает pending), экспорт во время запроса → вечный скелетон, а «Обновить данные»
   disabled при pending. Исправление: не блокировать кнопку по сохранённому pending / сбрасывать pending старше N секунд
   при старте и при импорте.
5. MEDIUM — lib/actions.ts:63-70. refreshLinkMeta сначала заменяет linkMeta на {status:'pending'}, а при неудаче
   записывает {status:'failed'} — прежние title/description/image/favicon уничтожаются. В вебе без прокси запрос
   падает всегда (CORS): нажали «Обновить данные» у ссылки с заголовком (например, импортированной с desktop) →
   заголовок и описание потеряны безвозвратно. Исправление: при failed сохранять прежние поля (менять только status).
6. MEDIUM — нет ErrorBoundary (src/App.tsx), а useLiveQuery (useCategories, useSettings, useItem, useLinkedItems)
   бросает ошибку запроса в render. IndexedDB недоступна/сломана (Safari «блокировать все cookie», «Internal error
   opening backing store», диск полон при открытии, DatabaseClosedError) → всё дерево размонтируется, белый экран без
   сообщения (Toaster тоже размонтирован). Исправление: ErrorBoundary с понятным текстом и кнопкой «Перезагрузить».
7. MEDIUM — QuotaExceededError нигде не обрабатывается (grep по quota — пусто). createItem/import/seed/updateItem
   показывают сырой e.message Dexie на английском («QuotaExceededError …» или «AbortError/Transaction aborted» с
   inner). Сценарий: хранилище заполнено, добавляем файл → непонятный toast. Исправление: общий переводчик ошибок
   (name/inner.name === 'QuotaExceededError' → «Недостаточно места…»), использовать в actions.safe, saveItem,
   QuickCapture, DataSection.
8. MEDIUM — detail/autosave.ts:50-56 (и TriageMode TitleField:437-446). flush помечает значение сохранённым
   (baseRef = n) ДО завершения save. Если updateItem упал (квота, БД закрыта, недопустимый URL), поле продолжает
   показывать черновик как сохранённый, повторный flush (blur/закрытие панели) — no-op: правка молча пропадает после
   одного toast. Для URL: ввести `javascript:x` → ошибка, но в поле остаётся невалидный адрес, в БД старый.
   Исправление: откатывать baseRef при неудаче (save возвращает false/бросает).
9. LOW — ItemDetail.tsx:164, TriageMode.tsx:781-784, AiSuggest.tsx:111, TagInput.tsx:73. Теги пишутся целым
   массивом из снимка рендера (updateItem({tags})), хотя в repo есть атомарные addTags/removeTag. Два изменения
   до прихода liveQuery (набрали «foo» без Enter и нажали × у другого чипа или AI-чип: blur добавляет foo, click
   пишет массив без foo; быстрый тап/трекпад, медленное устройство) → один из тегов теряется.
10. LOW — db/db.ts:21-33, hooks/useItems.ts:53-59. Нет стратегии на обновление схемы и многовкладочность: нет
    обработчиков versionchange/blocked; при ошибке liveQuery общий список делает `subscription = null` и больше не
    переподписывается, пока есть слушатели (сайдбар есть всегда) — список застывает до перезагрузки, при первой
    ошибке показывается пустым (`snapshot ??= []`), будто данные пропали. Старая вкладка со старым JS после
    version(2) продолжит писать записи старой формы. Исправление: on('versionchange') → сообщение + reload;
    переподписка/сообщение об ошибке в useItems.
11. LOW — QuickCapture.tsx:47-63,144; repo.createItem. Восстановленный черновик несёт categoryId без проверки.
    Сценарий: в capture выбрать категорию X, набрать текст, Esc; в настройках удалить X; открыть capture
    («Черновик восстановлен», в селекте «Без категории»), сохранить → запись с висячим categoryId: не попадает ни в
    «без категории», ни в cat:none, ни в «неразобранные». Исправление: проверять категорию в readDraft/createItem.
12. LOW — QuickCapture.tsx:235, 334. (а) Закрытие панели (Esc/клик мимо) с прикреплёнными файлами: файлы молча
    отбрасываются, без текста черновик не пишется вовсе (вставленный скриншот теряется). (б) Закрытие панели во время
    долгого сохранения (файлы + комментарий): snapshot пишет черновик, после успешного сохранения
    `if (!mountedRef.current) return` стоит ДО writeDraft(null) → при следующем открытии «Черновик восстановлен» с
    уже сохранённым текстом → дубликат.

## Не подтверждено / не проверялось запуском
- Скачивание blob через `<a download>` (экспорт копии, «Скачать») в WKWebView на macOS: обработчика загрузок в
  src-tauri нет, toast «Резервная копия сохранена» показывается безусловно. Нужна ручная проверка на Mac.
- Импорт копии, близкой к пределу 480 МБ: пик памяти (text + JSON + atob) порядка 1.5 ГБ, на iPhone вкладка
  вероятно упадёт (до транзакции, локальные данные не страдают).

## Проверено и дефектов не найдено
Каскад удаления и отмена (связи, файл, исчезнувшая категория), prevStatus/processedAt, отмена статусов,
переименование/слияние тегов, удаление категории, merge/replace импорт в одной транзакции (откат при ошибке),
repairIntegrity, повторный сид (не трогает изменённые демо-записи), очистка данных при открытой панели
(панель закрывается, flush по удалённой записи — no-op), синхронизация поискового индекса, лимит размера файла,
HEIC в Chromium → 'file'.

Изменённые файлы: только этот отчёт.
