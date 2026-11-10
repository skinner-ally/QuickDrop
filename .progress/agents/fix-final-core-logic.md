# fix-final-core-logic

Задача: исправить находки финального ревью в области core-logic
(src/db/**, src/search/**, src/lib/** кроме desktop.ts, src/hooks/useItems.ts, src/hooks/computeVisible.ts и тесты).

Статус: готово. `npx tsc -b` — без ошибок; `npm test` — 16 файлов, 465 тестов, зелёные.

## Находки

1. medium, даты вне диапазона Date ломают приложение — **исправлено**.
   - exportImport.ts: помощник `ts(v, now)` (0..now+сутки, иначе undefined → now/createdAt) для createdAt/updatedAt/
     processedAt, linkMeta.fetchedAt, ai.generatedAt, createdAt категорий и файлов.
   - itemTitle.ts: `formatRelative`/`formatDateTime`/`formatShortDate` возвращают `NO_DATE` ('—') для невалидной даты —
     лечит и уже импортированные битые записи.
   - Тесты: exportImport.test.ts (9e15, -9e15, год вперёд), itemTitle.test.ts.
   - Требует чужого файла (желательно): ErrorBoundary вокруг ActiveView в src/components/layout/AppShell.tsx
     с кнопкой перехода в настройки.
2. medium, устаревший ответ fetchLinkMeta затирает метаданные — **исправлено**.
   - repo.ts: новый `applyLinkMeta(id, url, meta): Promise<boolean>` — в rw-транзакции пишет, только если url записи
     тот же; `updateItem` при смене адреса (без linkMeta в патче) сбрасывает метаданные прежней страницы.
   - actions.ts: реестр последнего запроса на запись (AbortController), прежний запрос отменяется, поздний ответ
     отбрасывается; refreshLinkMeta берёт адрес из БД (LinkCard передаёт ненормализованный ввод).
   - Тесты: actions.test.ts, repo.test.ts.
3. medium, pending застревает навсегда — **исправлено** в моей области.
   - actions.ts: исключение из fetchLinkMeta → 'failed'; итог пишется последним запросом; `isLinkMetaLoading(id)`.
   - normalize.ts: `settleLinkMeta` (pending → ok при наличии данных, иначе failed), `hasLinkContent`.
   - exportImport: pending не экспортируется и превращается в итог при импорте.
   - repo.restoreItems: отмена удаления не возвращает pending.
   - db.ts: при открытии базы (on('ready'), vip) прерванные прошлой сессией pending становятся итогом.
   - Тесты: actions.test.ts, repo.test.ts, exportImport.test.ts, db.test.ts.
   - Чужой файл (необязательно): LinkCard.tsx:56/133 — `pending = meta?.status === 'pending' && isLinkMetaLoading(item.id)`
     (на случай pending из закрытой другой вкладки); при pending можно показывать прежние данные вместо скелета.
4. medium, неудачное «Обновить данные» стирает метаданные — **исправлено**.
   - refreshLinkMeta: pending пишется как {...prev, status:'pending'}; при неудаче остаются прежние поля
     (status/fetchedAt прежние) + toast «Не удалось обновить данные ссылки — оставлены прежние».
     При смене адреса прежние поля уже сброшены updateItem — к новому адресу не прилипают. LinkCard менять не нужно.
5. medium, QuotaExceededError — **исправлено в моей области**, остальное требует чужих файлов.
   - Новый src/lib/errors.ts: `isQuotaError`, `describeError(e, fallback?)`, `readableError`, `QUOTA_MESSAGE`.
   - createItem, updateItem, restoreItems, importBackup, seedDemoData бросают Error с понятным текстом —
     существующие `toast.error(e.message)` в UI уже покажут его. actions.ts использует describeError.
   - Требует чужих файлов: заменить локальные errMsg/errText/fail на `describeError(e, '<прежний запасной текст>')`
     из '@/lib/errors': QuickCapture.tsx:74, DataSection.tsx:13, detail/save.ts:11, App.tsx:15, InboxView.tsx:50,
     BulkBar.tsx:21, TriageMode.tsx:37, ItemList.tsx:274, TagsSection, CategoriesSection, Section.tsx:105.
6. low, «Удалить все данные» оставляет ключ API — **исправлено**: clearAllData удаляет aiApiKey, aiBaseUrl, aiModel,
   aiEnabled, linkProxyUrl (тема, горячая клавиша, autoFetchLinkTitle, seeded остаются). Тест в seed.test.ts.
   - Чужой файл: текст диалога в DataSection.tsx:243 — добавить «…, а также ключ API и адрес прокси».
7. low, ошибки liveQuery/versionchange — **частично**.
   - useItems.ts: после ошибки чтения подписка повторяется сама (1 с → до 30 с), уже прочитанные записи остаются;
     новые экспорты `useAllItemsFailed()`/`getAllItemsFailed()`. Тест в useItems.test.ts.
   - Пропущено: обработчик versionchange с сообщением «Приложение обновлено в другой вкладке — перезагрузите» —
     нужен UI (Dexie по умолчанию уже закрывает соединение и переоткрывает его). Сценарий только при будущей version(2);
     авто-перезагрузка из db.ts могла бы потерять несохранённый ввод. При появлении version(2): в db.ts
     `db.on('versionchange', ...)` → флаг, в AppShell — баннер; а ItemList/AppShell может показать сообщение
     по `useAllItemsFailed()`.

## Изменённые файлы
- src/lib/errors.ts (новый), src/lib/errors.test.ts (новый), src/lib/actions.ts, src/lib/actions.test.ts (новый),
  src/lib/exportImport.ts, src/lib/exportImport.test.ts, src/lib/itemTitle.ts, src/lib/itemTitle.test.ts,
  src/lib/normalize.ts, src/db/db.ts, src/db/db.test.ts (новый), src/db/repo.ts, src/db/repo.test.ts,
  src/db/seed.ts, src/db/seed.test.ts, src/hooks/useItems.ts, src/hooks/useItems.test.ts

## Новые экспорты (контракты CLAUDE.md не менялись, только добавлены)
- repo: `applyLinkMeta`; actions: `isLinkMetaLoading`; errors: `describeError`, `isQuotaError`, `readableError`,
  `QUOTA_MESSAGE`; normalize: `settleLinkMeta`, `hasLinkContent`; itemTitle: `NO_DATE`;
  useItems: `useAllItemsFailed`, `getAllItemsFailed`, `ITEMS_RETRY_MIN_MS`.
- Изменение поведения: `updateItem` со сменой url сбрасывает linkMeta (если linkMeta нет в патче).
