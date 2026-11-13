# Этап 8. Распознавание и приёмка — спецификация

Дата: 2026-11-13. Автор: архитектор этапа 8 (отчёт — `.progress/agents/spec-stage8.md`).
Основание: `.progress/plan-combined.md` («Этап 8», «Отложено», «Отклонено»), `.progress/HANDOFF.md`, `CLAUDE.md`,
`docs/DESIGN.md`, `.progress/spec-stage2.md` (§2.8, §2.10, §7 — заделы под распознавание).

Правила этапа: сигнатуры из `CLAUDE.md` не меняются (только добавления); запись в БД — через `db/repo.ts`;
сетевые запросы — только метаданные ссылок и ЯВНО включённый ИИ; тексты — по-русски; `verbatimModuleSyntax`,
`erasableSyntaxOnly`, `noUnusedLocals/Parameters`; зависимости не добавляются; `CLAUDE.md` не правится (новая
редакция — в `.progress/CLAUDE.proposed.md`). После каждого пакета `npm run typecheck` и `npm test` проходят.
Каждый исполнитель ведёт `.progress/agents/stage8-<ключ>.md`, git не трогает.

## Поправки после ревью 8 и финального ревью (истина — код; текст ниже не переписан)

Ниже в спецификации сохранены решения до ревью. Где они расходятся с этим разделом, верен этот раздел.

- Очистка текста пользователем — `repo.clearOcrText(id, at?)`: удаляет `ocrText`, ставит `ocrAt = ocrClearedAt`.
  Поле `Item.ocrClearedAt` (необязательное, вне `ItemPatch`): PDF с ним и без `ocrVisionAt` не считается сканом
  (`isScanPdf`), `needsVision` для него ложно. `setOcrText` и `setVisionText` отметку снимают. Очищать через
  `setOcrText(id, '')` нельзя: PDF со слоем без текста неотличим от скана и ушёл бы в ИИ. UI идёт через
  `actClearOcrText`/`actSaveOcrText` (`lib/actions.ts`).
- Поле `Item.ocrAutoSkipAt` — автораспознавание запись не берёт; ставит только `repo.markVisionAutoSkip(id, at?)`.
  `isVisionBacklog(item, since)` его исключает. Причины: «Отменить» у задачи пользователем (`ocr.ts`, `p.cancel`; сброс
  сеанса и прерывание сигналом — не решение) и импорт копии. Ручное «Распознать» работает.
- Резервная копия: `ocrClearedAt` выгружается и читается (только у записи с вложением и без текста); `ocrAutoSkipAt`
  не выгружается и из копии не читается — это решение этого устройства. Слияние: `ocrClearedAt` переносится вместе с
  победившим текстом, существующий локально `ocrAutoSkipAt` версия из копии не снимает.
- Импорт ставит `ocrAutoSkipAt = now` каждой НОВОЙ здесь записи с распознаваемым вложением (`ocrKindOf`), без
  `ocrVisionAt`, без текста и без `ocrClearedAt` — включая записи в корзине и PDF без проверенного слоя (`ocrAt` ещё
  нет), чтобы авто не отправило их ни сейчас, ни после восстановления из корзины или разбора слоя. Распознавание — кнопкой.
- `db/settings.setSettings` сдвигает `aiAutoOcrSince` на `Date.now()`, когда автораспознавание снова начинает
  действовать (ИИ включили, вернули ключ или модель при включённом `aiAutoOcr`) или меняется хост API (`aiHostLabel`).
  Явно переданный `aiAutoOcrSince` не трогается.
- Классы ошибок зрения (`VisionError.kind`): `item` — повтор даст то же: `markVisionTried` и итог «не удалось»;
  `config` — остановка авто (непонятный 400/422 с `unknown` — запись в сторону до конца сеанса, настройкой считается
  серия `VISION_AUTO_FAIL_STREAK` таких ошибок на разных записях); остальные (`transient`) — запись в сторону на
  сеанс, 429 — пауза `VISION_RATE_PAUSE_MS`, серия — пауза `VISION_AUTO_COOLDOWN_MS`.
- `visionImage.ts`: `planVisionTiles(width, height, maxSide?, overlap?, maxTiles?)`; `prepareVisionImage` возвращает
  `'ok' | 'tiles' | 'too-small' | 'failed'`. Вытянутая картинка режется на полосы (не больше `VISION_PDF_MAX_PAGES`, 5),
  каждая полоса — отдельный запрос (`status: 'tiles'`, `images: Blob[]`).
- Проверка подключения и распознавания в настройках (`AiSection`) вызывает `suggestForItem`/`recognizeImage` с
  `aiEnabled: true` даже при выключенном переключателе (нужен ключ) и отправляет только проверочные данные.

## 0. Что уже есть в коде (проверено)

| Что | Где | Состояние |
|---|---|---|
| `Item.ocrText`, `Item.ocrAt` | `src/types.ts` | есть; пишет только `repo.setOcrText` (не меняет `updatedAt`) |
| `Settings.aiAutoOcr` (false), `aiVisionModel` ('') | `src/types.ts` | есть, нигде не используются; в копию не попадают (`PRIVATE_SETTINGS`), стираются «Удалить все данные» (`CLEARED_SETTINGS`) |
| Индексация `ocrText` | `src/search/engine.ts` (поле `ocrText`, вес 1, сверка по `ocrAt`), `highlight.ts` (сниппет: третий источник) | готово, **не меняется** |
| Резервная копия | `src/lib/exportImport.ts`: `ocrText`/`ocrAt` экспортируются и импортируются (`cleanOcrText`), при слиянии свежий `ocrAt` переносится (`withNewerOcr`) | готово; добавить `ocrVisionAt` |
| Экспорт Markdown | `src/lib/markdownExport.ts:386`: раздел `## Распознанный текст` | готово, **не меняется** |
| Текст PDF | `src/lib/pdfText.ts`, `pdfEngine.ts`, `ocr.ts` (очередь по одному, `drainPdfBackfill`, отметка `ocrAt` при неустранимой ошибке) | готово; ветка картинок и сканов возвращает `skipped` |
| Запрос к ИИ | `src/lib/ai.ts`: `suggestForItem` (`POST {base}/chat/completions`, `Bearer`), `aiBaseUrlError`, `httpError` | есть; запроса с изображением нет |
| Показ распознанного текста | — | **нет нигде в интерфейсе** |
| CSP | Tauri: `connect-src … https: http:`, `default-src 'self'` (без `wasm-unsafe-eval`); веб: `script-src 'self'` | запрос к ИИ разрешён; WebAssembly запрещён |
| pdf.js 6.5.438 | `node_modules/pdfjs-dist` | JBIG2, **CCITT** и JPX декодируются модулем из `wasmUrl` (`jbig2.wasm`/`openjpeg.wasm` либо `*_nowasm_fallback.js`); сейчас `wasmUrl` не задан — для текста не нужен, для растеризации сканов обязателен |
| Значок `scan-text` | `src/components/icons/names.ts` | есть |

## 1. Решения этапа

| № | Решение | Почему |
|---|---|---|
| Р1 | Новое поле `Item.ocrVisionAt?: number` — «когда запись пробовали распознать зрением» (успех, «текста нет» или неустранимая ошибка) | `ocrAt` у PDF ставится уже после проверки текстового слоя; без отдельного признака автораспознавание либо не трогало бы сканы, либо отправляло их повторно |
| Р2 | `MAX_OCR_TEXT` остаётся 200 000 символов и действует для любого источника (обрезка в `cleanOcrText`) | текст зрением мал (до 5 страниц); предел нужен только слою PDF. В индекс идут первые 100 000 (`MAX_INDEXED_CONTENT`), в интерфейсе показываются первые 20 000 с кнопкой «Показать весь», правка — до 50 000 |
| Р3 | Новая настройка `aiAutoOcrSince: number` (0) — момент включения «Распознавать автоматически». Авто касается только записей с `createdAt >= aiAutoOcrSince` | включение настройки не должно молча отправить в ИИ весь накопленный архив картинок; при этом записи из мини-окна и после сбоя сети подхватываются позже |
| Р4 | Версия схемы Dexie и `BACKUP_VERSION` не меняются | `ocrVisionAt` — необязательное неиндексируемое поле; старые копии читаются как есть, старые версии приложения поле игнорируют |
| Р5 | Запрос с изображением — в `src/lib/ai.ts` (`recognizeImage`): тот же адрес, ключ и проверка `aiBaseUrlError`; модель — `aiVisionModel`, пусто → `aiModel` | один модуль знает формат OpenAI-совместимого API и условия «ИИ настроен» |
| Р6 | Одна страница/картинка — один запрос. PDF-скан: первые 5 страниц, по очереди | проще пределы и ошибки; провайдеры по-разному ограничивают число изображений в запросе |
| Р7 | Параллельность 1; авто — не чаще одного запроса в 3 с и не больше 100 запросов за сеанс; ручной запрос идёт вне очереди авто | защита от неожиданных расходов и лимитов провайдера |
| Р8 | Ошибки трёх видов: `config` (ключ, модель без зрения, адрес) — авто останавливается, отметка не ставится; `item` (файл не читается, слишком большой, отказ сервиса по содержимому) — ставится `ocrVisionAt`, повторов нет; `transient` (сеть, 429, 5xx, время) — отметки нет, в этом сеансе запись авто больше не берёт | «без повторов при постоянной ошибке» и без потери записей при временной |
| Р9 | Декодеры сканов pdf.js подключаются JS-вариантами (`jbig2_nowasm_fallback.js`, `openjpeg_nowasm_fallback.js`, `useWasm: false`), файлы кладёт в сборку свой плагин Vite | CSP не ослабляется (`wasm-unsafe-eval` не нужен), зависимостей не прибавляется |
| Р10 | Мини-окно быстрой записи зрением не распознаёт: запись подхватит главное окно (Р3) | окно прячется сразу после сохранения, запрос на 10–60 с в нём ненадёжен |
| Р11 | Расширение Chrome кладётся в установщик (`bundle.resources`), в настройках — путь к папке и «Показать папку» | просто и безопасно: файлы только читаются, новая команда Rust возвращает путь; см. §5.3 |
| Р12 | Пункт «Распознать» в меню записи и в разборе входящих не добавляется | `ItemMenu` рисуется в каждой карточке — подписка на настройки в каждой была бы дорогой; требование этапа — кнопка в подробностях |

## 2. Волна 0 — данные и контракты

### 2.1 Пакет `ocr-data` (opus)

**`src/types.ts`**
- `Item.ocrVisionAt?: number` — после `ocrAt`, с комментарием: «Когда вложение в последний раз пробовали распознать
  моделью со зрением (успешно, без текста или с неустранимой ошибкой). Поля нет — не пробовали. Пишут только
  `repo.setVisionText` и `repo.markVisionTried`; `updatedAt` не меняется».
- `Settings.aiAutoOcrSince: number` (умолчание `0`) — после `aiAutoOcr`: «Когда включили автораспознавание (мс).
  Автоматически распознаются только записи, созданные не раньше этого момента».
- Комментарий `aiAutoOcr` дополнить: «изображение отправляется на `aiBaseUrl`».
- `ITEM_SOURCES`: добавить `'share'` (долг этапа 4, §5.1).

**`src/lib/settingsSchema.ts`** — `aiAutoOcrSince`: конечное число `>= 0` (то же правило, что у `backupLastAt`).

**`src/db/repo.ts`** (добавления, существующее не трогать):
```ts
/** Итог распознавания зрением: ocrText (очистка cleanOcrText; пусто — поле удаляется), ocrAt = ocrVisionAt = at ?? Date.now().
 *  updatedAt не меняется. false — записи нет. Запись в корзине обновляется как обычная (результат уже получен). */
setVisionText(id: string, text: string, at?: number): Promise<boolean>
/** Неустранимая ошибка распознавания зрением: ставит только ocrVisionAt; ocrText и ocrAt не трогает. false — записи нет. */
markVisionTried(id: string, at?: number): Promise<boolean>
```
`setOcrText` не меняется: им пишутся текст слоя PDF, ручная правка и очистка (`ocrVisionAt` при этом остаётся).

**`src/lib/exportImport.ts`**
- `PRIVATE_SETTINGS` += `'aiAutoOcrSince'` (комментарий: «состояние этого компьютера, включает отправку»).
- `sanitizeItem`: `ocrVisionAt` через `ts()`; пишется, только если у записи есть `fileId`.
- `withNewerOcr`: вместе с более свежим распознаванием переносится `ocrVisionAt`; независимо от того, чей текст
  победил, итоговый `ocrVisionAt` = наибольший из определённых у двух версий (иначе после слияния копий картинка
  ушла бы в ИИ повторно).
- Комментарий о версиях формата: «2 — … у записей также `ocrVisionAt` (с этапа 8, необязательное)».

**`src/db/seed.ts`** — `CLEARED_SETTINGS` += `'aiAutoOcrSince'`.

**`src/components/items/ItemDetail.tsx`** — только `SOURCE_LABEL.share = 'из «Поделиться»'` (иначе не соберётся).

Тесты (`repo.test.ts`, `exportImport.test.ts`, `seed.test.ts`, `settingsSchema.test.ts`): `setVisionText` — текст,
пустой текст (поле удалено, обе отметки стоят), нет записи → false, `updatedAt` прежний, обрезка до `MAX_OCR_TEXT`;
`markVisionTried` не трогает `ocrText`/`ocrAt`; `setOcrText('')` не снимает `ocrVisionAt`; полный цикл копии с
`ocrVisionAt`; слияние: наибольший `ocrVisionAt`; `ocrVisionAt` без `fileId` отбрасывается; `aiAutoOcrSince` не
экспортируется и не импортируется, стирается «Удалить все данные»; источник `share` переживает экспорт/импорт.

### 2.2 Пакет `ocr-facade` (opus), после `ocr-data`

Создаёт всё, что нужно интерфейсу, чтобы пакеты волны 1 шли параллельно.

**`src/lib/ocrState.ts`** (новый; без React, без сети) — правила и состояние распознавания в этом сеансе.
```ts
// Пределы (единственное место)
export const VISION_MAX_SIDE = 2000                 // px по большей стороне после подготовки
export const VISION_MIN_SIDE = 24                   // меньше — распознавать нечего
export const VISION_MAX_SOURCE_BYTES = 30 * 1024 * 1024   // исходная картинка
export const VISION_MAX_IMAGE_BYTES = 4 * 1024 * 1024     // подготовленная картинка (до base64)
export const VISION_PDF_MAX_PAGES = 5
export const VISION_JPEG_QUALITY = 0.85
export const VISION_AUTO_INTERVAL_MS = 3_000
export const VISION_AUTO_SESSION_LIMIT = 100
export const VISION_AUTO_FAIL_STREAK = 3
export const VISION_AUTO_COOLDOWN_MS = 10 * 60_000
export const VISION_RATE_PAUSE_MS = 60_000
export const VISION_BACKLOG_BATCH = 20
export const VISION_BACKLOG_MIN_GAP_MS = 60_000
export const OCR_VIEW_CHARS = 20_000
export const OCR_EDIT_MAX = 50_000

export type OcrKind = 'image' | 'pdf'
type OcrFields = Pick<Item, 'type' | 'mimeType' | 'fileName' | 'fileId' | 'ocrText' | 'ocrAt' | 'ocrVisionAt' | 'deletedAt' | 'createdAt'>
/** Что за вложение: то же правило, что ocr.textSourceOf (isPdf из pdfText; картинка — type === 'image' с fileId). */
export function ocrKindOf(item: Pick<Item, 'type' | 'mimeType' | 'fileName' | 'fileId'>): OcrKind | null
/** PDF, у которого проверен текстовый слой и текста в нём нет, либо текст получен зрением. */
export function isScanPdf(item: OcrFields): boolean          // pdf && ocrAt !== undefined && (!ocrText || ocrVisionAt !== undefined)
/** Запись ждёт распознавания зрением: вне корзины, ocrVisionAt нет, текста нет; картинка или скан PDF. */
export function needsVision(item: OcrFields): boolean
/** needsVision и запись создана не раньше since (since > 0). */
export function isVisionBacklog(item: OcrFields, since: number): boolean

export interface OcrOutcome {
  status: 'ok' | 'empty' | 'failed' | 'skipped'
  error?: string                                    // русский текст для failed
  via?: 'text-layer' | 'vision'
  pages?: { read: number; total: number }           // PDF-скан: сколько страниц отправлено из скольких
  truncated?: boolean                               // модель оборвала ответ (finish_reason length) или текст обрезан пределом
}
export interface OcrJob { phase: 'queued' | 'running'; manual: boolean; page?: number; pages?: number; cancel?: () => void }
export interface OcrNote { status: 'failed' | 'empty'; error?: string; at: number }

export function getOcrJob(id: string): OcrJob | undefined    // ссылка стабильна до следующего setOcrJob
export function setOcrJob(id: string, job: OcrJob | null): void
export function getOcrNote(id: string): OcrNote | undefined
export function setOcrNote(id: string, note: OcrNote | null): void
export function subscribeOcr(listener: () => void): () => void
export function resetOcrState(): void                         // для тестов
```

**`src/lib/ai.ts`** (добавления; `suggestForItem`, `aiBaseUrlError`, `parseAiJson`, `normalizeTags` не меняются)
```ts
export const VISION_TIMEOUT_MS = 120_000
export type VisionErrorKind = 'config' | 'item' | 'transient'
export class VisionError extends Error { kind: VisionErrorKind; status?: number }   // без parameter properties
export function visionModelOf(settings: Pick<Settings, 'aiVisionModel' | 'aiModel'>): string   // trim(aiVisionModel) || trim(aiModel)
/** null — распознавать можно; иначе причина по-русски. Те же условия, что у suggestForItem, плюс модель не пуста. */
export function visionAvailability(settings: Settings): string | null
/** Хост (с портом) из адреса API — для текста «изображение отправится на …». Негодный адрес → исходная строка, до 60 символов. */
export function aiHostLabel(baseUrl: string): string
export interface VisionReply { text: string; truncated: boolean; model: string }
export function cleanVisionAnswer(raw: string): string
export function recognizeImage(image: Blob, settings: Settings, signal?: AbortSignal): Promise<VisionReply>
```
- `visionAvailability`: `!aiEnabled` → «Включите ИИ-помощника в настройках»; пустой ключ → «Укажите API-ключ в
  «Настройки → ИИ-помощник»»; `aiBaseUrlError` → его текст; пустая модель → «Укажите модель в «Настройки → ИИ-помощник»».
- `recognizeImage`:
  1. **Первым делом** `visionAvailability(settings)`; не `null` → `VisionError('config')`. До этой проверки нет ни
     чтения изображения, ни сети. Это единственная функция приложения, отправляющая изображение.
  2. `image.type` — только `image/jpeg` или `image/png`, размер ≤ `VISION_MAX_IMAGE_BYTES`; иначе `VisionError('item')`
     («Изображение не подготовлено к отправке» / «Изображение слишком большое для распознавания»).
  3. data-URL: `data:${type};base64,${blobToBase64(image)}` (`blobToBase64` — из `lib/exportImport.ts`).
  4. `POST {aiBaseUrl без хвостовых '/'}/chat/completions`, заголовки как у `suggestForItem`, тело:
     ```json
     { "model": "<visionModelOf>", "temperature": 0,
       "messages": [
         { "role": "system", "content": "<VISION_PROMPT>" },
         { "role": "user", "content": [
             { "type": "text", "text": "Распознай текст на изображении." },
             { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,…" } } ] } ] }
     ```
     Без `response_format`, `max_tokens` и `detail` (у разных провайдеров разные имена и допустимые значения).
     `VISION_PROMPT`: «Ты распознаёшь текст на изображениях. Верни ТОЛЬКО текст с изображения: без пояснений, без
     перевода, на языке оригинала, сохраняя порядок чтения, строки и абзацы. Ячейки таблиц разделяй « | ». Картинку
     не описывай. Если текста на изображении нет, ответь ровно: NO_TEXT».
  5. Время: свой `AbortController` на `VISION_TIMEOUT_MS`, связанный с `signal`. Время вышло →
     `VisionError('transient', 'ИИ не ответил за 2 минуты')`. Прерывание вызывающим — исходный `AbortError` наружу.
  6. Ответ 400 с телом, где упомянут `temperature`: один повтор того же запроса без `temperature`.
  7. Ошибки HTTP (тело читается до 500 символов, в текст ошибки — до 200):

     | Ответ | Вид | Текст |
     |---|---|---|
     | 401, 403 | config | «Неверный API-ключ (401)» |
     | 404 | config | «Модель «{model}» или адрес API не найдены (404)» |
     | 400/415/422, тело по `/image|vision|multi-?modal|unknown variant|content.{0,40}(string|array)/i` | config | «Модель «{model}» не принимает изображения. Укажите модель со зрением в «Настройки → ИИ-помощник»» |
     | 413 | item | «Изображение слишком большое для сервиса ИИ (413)» |
     | 429 | transient | «Превышен лимит запросов к ИИ (429), попробуйте позже» |
     | 5xx | transient | «Сервис ИИ временно недоступен ({status})» |
     | прочие 4xx | config | «Ошибка ИИ-сервиса {status}: {тело}» |
     | `fetch` бросил (не прерывание) | transient | «Нет связи с сервисом ИИ: проверьте адрес API и подключение к сети» |
     | 200, но не JSON / нет `choices` | transient | «ИИ вернул непонятный ответ» |
  8. Разбор: `choices[0].message.content` — строка либо массив частей (`{ type: 'text', text }` склеиваются);
     `finish_reason === 'content_filter'` → `VisionError('item', 'Сервис ИИ отказался обрабатывать изображение')`;
     `finish_reason === 'length'` → `truncated: true`. Пустой ответ — это `text: ''` (не ошибка).
  9. `cleanVisionAnswer`: trim; ответ целиком в ограде ``` — ограда снимается; `NO_TEXT` (без учёта регистра, с
     возможными кавычками, точкой, оградой) → `''`. Дальнейшая очистка — `cleanOcrText` в репозитории.
- Распознанный текст — данные: он только записывается в `ocrText`. В запросы `suggestForItem` он не добавляется.

**`src/lib/actions.ts`** (добавления + одна правка)
```ts
actRecognize(item: Item): Promise<void>          // кнопки «Распознать текст», «Распознать заново», «Повторить»
actCancelRecognize(id: string): void             // getOcrJob(id)?.cancel?.()
actSaveOcrText(id: string, text: string): Promise<void>   // правка: repo.setOcrText через safe
actClearOcrText(item: Item): Promise<void>       // очистка + toast «Распознанный текст очищен» с «Отменить» (setOcrText прежним текстом)
```
- `actRecognize`: запись в корзине или без `ocrKindOf` → ничего. `settings = await getSettings()`,
  `blocked = visionAvailability(settings)`. Картинка при `blocked` → `toast.error(blocked)`, выход. PDF при `blocked`
  идёт без зрения (локальное извлечение слоя). Затем `setOcrNote(id, null)` и
  `const outcome: OcrOutcome = await extractItemText(item, { vision: blocked === null, force: true })`
  (сигнатура `extractItemText` уже такая; `force: true` означает ручной запуск).
  Итог: `ok` → `toast.success` «Текст распознан» (`via === 'text-layer'` → «Текст извлечён из PDF»; при
  `pages.read < pages.total` — описание «Распознаны первые {read} из {total} страниц»; при `truncated` — «Ответ модели
  оборван, текст неполный»); `empty` → `setOcrNote(empty)` + `toast('Текст не найден')`; `failed` →
  `setOcrNote(failed, error)` + `toast.error(error)`; `skipped` → ничего (отмена или уже идёт).
- `createAndEnrich`: вместо `if (textSourceOf(item) === 'pdf') void extractItemText(item)` — фоновая функция:
  источник есть → прочитать настройки (ошибка чтения = авто выключено), `vision = aiEnabled && aiAutoOcr`; PDF —
  `void extractItemText(item, { vision })`; картинка — только при `vision`. Возврат записи не задерживается.
- До сдачи пакета `ocr-logic` картинки и сканы дают `skipped` — это ожидаемо, typecheck и тесты проходят.

Тесты: `ai.test.ts` — тело запроса (модель из `aiVisionModel`/`aiModel`, часть `image_url` с `data:image/jpeg;base64,`),
ни одного `fetch` при выключенном ИИ, пустом ключе, `http://` не-localhost; таблица ошибок построчно; повтор без
`temperature` ровно один; время и прерывание; `content` массивом; `NO_TEXT`, ограда; `aiHostLabel`.
`ocrState.test.ts` — правила (`isScanPdf`, `needsVision`, `isVisionBacklog` на границе `since`, корзина), подписка,
стабильность ссылок. `actions.test.ts` — `actRecognize` по исходам (с подменой `@/lib/ocr`), картинка при
выключенном ИИ не доходит до `extractItemText`, `createAndEnrich` передаёт `vision` по настройкам, очистка и отмена.

## 3. Волна 1 — логика распознавания: пакет `ocr-logic` (opus)

### 3.1 `src/lib/visionImage.ts` (новый) — подготовка изображения
```ts
export function planVisionSize(width: number, height: number, maxSide?: number): { width: number; height: number } | null
export type PreparedImage =
  | { status: 'ok'; image: Blob; width: number; height: number }
  | { status: 'too-small' }
  | { status: 'failed'; error: string }                       // неустранимо для этого файла
export function prepareVisionImage(blob: Blob, options?: { backend?: RasterBackend }): Promise<PreparedImage>
```
- Вход — `StoredFile.blob`. Больше `VISION_MAX_SOURCE_BYTES` → `failed` «Файл больше 30 МБ — не распознаётся».
- Класс — по типу самого Blob (`classifyBlobType` из `components/items/safeFileUrl.ts`): `raster` — как есть; `svg` —
  растеризованная копия (`toImageBlob`, тот же код, что для показа); прочее → `failed` «Формат изображения не
  поддерживается» (HEIC/TIFF в Chromium и так сохраняются как «файл»).
- Декодирование `createImageBitmap` (ориентация EXIF учитывается движком; у GIF — первый кадр). Не декодируется →
  `failed` «Не удалось прочитать изображение».
- `planVisionSize`: большая сторона ≤ `VISION_MAX_SIDE`, без увеличения, пропорции сохранены; любая сторона
  < `VISION_MIN_SIDE` → `null` → `too-small`.
- Кодирование на белом фоне (прозрачность → белый). JPEG `VISION_JPEG_QUALITY`; если исходник без потерь
  (png/gif/bmp/svg) и PNG той же картинки ≤ 1,5 МБ — берётся PNG (скриншоты читаются лучше). Результат больше
  `VISION_MAX_IMAGE_BYTES` → ступени (2000 px, 0.7) → (1600, 0.7) → (1200, 0.6); не уложилось → `failed`
  «Изображение слишком большое для распознавания».
- `RasterBackend` (декодирование и кодирование) подменяется в тестах: в vitest нет ни canvas, ни `createImageBitmap`.
  Рабочая реализация — `OffscreenCanvas`, иначе `document.createElement('canvas')` (как `repo.scaleBitmap`).
  `ImageBitmap` закрывается в `finally`.

### 3.2 Растеризация PDF: `pdfText.ts`, `pdfEngine.ts`, `src/lib/pdfRender.ts` (новый), `vite.config.ts`
- `PdfDocLike` (в `pdfText.ts`) получает **необязательный** метод
  `pageImage?(page: number, maxSide: number): Promise<Blob>` — JPEG страницы на белом фоне.
- `createPdfEngine(pdfjs, makeWorker?, options?: { wasmUrl?: string })` — третий необязательный аргумент. В
  `getDocument` добавляются `useWasm: false` и, если задан, `wasmUrl` (с хвостовым `/`). `pageImage`: `getPage` →
  `getViewport({ scale })`, где `scale = clamp(maxSide / max(ширина, высота при scale 1), 0.5, 4)` → canvas → `render`
  → `toBlob('image/jpeg', VISION_JPEG_QUALITY)` → `page.cleanup()`, canvas обнуляется (ширина 0). Точные имена
  параметров `render` сверить по `node_modules/pdfjs-dist/types`. `PdfJsApi` при необходимости расширить.
- `loadPdfEngine`: `wasmUrl = new URL(`${import.meta.env.BASE_URL}pdfjs/`, window.location.origin).href`.
- `pdfRender.ts`:
  ```ts
  export interface PdfPages { total: number; count: number; page(n: number): Promise<Blob>; close(): Promise<void> }
  export type PdfPagesResult = { status: 'ok'; doc: PdfPages } | { status: 'aborted' } | { status: 'failed'; error: string; permanent?: true }
  export function openPdfPages(data: Blob, options?: { maxPages?: number; signal?: AbortSignal; engine?: () => Promise<PdfEngine> }): Promise<PdfPagesResult>
  ```
  Те же пределы и тексты, что у `extractPdfText`: `PDF_MAX_BYTES` (неустранимо), пароль и битый файл — неустранимо,
  сбой движка — временно; открытие и каждая страница — под сторожем времени (20 с на страницу), зависший worker
  останавливается (`close` движка уже это умеет). `count = min(total, maxPages ?? VISION_PDF_MAX_PAGES)`. Страницы
  растеризуются по одной, прямо перед отправкой. Не бросает. Движок без `pageImage` → `failed` (временная).
- `vite.config.ts` — плагин `quickdrop:pdf-decoders` (без новых зависимостей):
  - сборка (`generateBundle`): `emitFile` с фиксированными именами `pdfjs/jbig2_nowasm_fallback.js` и
    `pdfjs/openjpeg_nowasm_fallback.js` из `node_modules/pdfjs-dist/wasm/`; лицензии декодеров
    (`LICENSE_JBIG2`, `LICENSE_PDFJS_JBIG2`, `LICENSE_OPENJPEG`, `LICENSE_PDFJS_OPENJPEG`) — одним файлом
    `licenses/pdfjs-decoders-LICENSE.txt`;
  - dev (`configureServer`): отдавать эти два файла по `{base}pdfjs/<имя>` (только по белому списку имён);
  - PWA: `workbox.globIgnores: ['pdfjs/**']` — без сети распознавание всё равно невозможно, в precache не нужны.
  Работает и в веб-сборке, и в сборке Tauri (обе страницы). CSP не меняется: модуль подгружается worker'ом с
  `'self'`. Проверка после пакета: `npm run build` → в `dist/pdfjs/` два файла, в `dist/licenses/` — лицензия.

### 3.3 `src/lib/ocr.ts` — исполнение, очередь, авто
Сигнатуры `textSourceOf`, `extractItemText`, `backfillPdfText`, `drainPdfBackfill` сохраняются. `ExtractOutcome`
становится псевдонимом `OcrOutcome` (только добавленные необязательные поля).

`extractItemText(item, { vision?, force?, signal? })`:
- `force: true` — ручной запуск (кнопка), иначе фоновый.
- Источника нет, запись в корзине → `skipped`. Перед работой запись перечитывается (`getItem`): удалена, в корзине,
  уже обработана без `force` → `skipped`.
- **PDF.** Без `ocrVisionAt` — прежний путь (текст слоя, очередь извлечений по одному). Слой пуст (`empty`) или
  запись уже скан (`isScanPdf`) и `vision` → задача зрения. PDF с `ocrVisionAt` при `force && vision` идёт сразу в
  зрение, слой повторно не разбирается. `force` без `vision` для скана → `empty` (текста нет, ИИ выключен).
- **Картинка.** Без `vision` → `skipped`. С `vision` → задача зрения.
- Мини-окно (`isCaptureWindow()`): задачи зрения не создаются → `skipped` (Р10).
- Уже имеющийся `ocrText` не стирается, пока нет нового результата: при ошибке, отмене и «текста нет» у повторного
  распознавания прежний текст остаётся (исключение — успешный пустой ответ: тогда запись получает «текста нет»).

Задача зрения (одна запись):
1. Перед **каждым** запросом заново: `getSettings()` → `visionAvailability`; для фоновой — ещё `aiAutoOcr` и
   `isVisionBacklog(item, aiAutoOcrSince)`; запись существует и не в корзине. Не выполняется → фоновая `skipped`,
   ручная `failed` с причиной. Так выключение ИИ действует на уже стоящие в очереди задачи.
2. Файл: `getFile`; нет → `failed` «Файл не найден» + `markVisionTried`.
3. Картинка: `prepareVisionImage` → `too-small` → `setVisionText(id, '')` → `empty`; `failed` → `markVisionTried`,
   `failed`; `ok` → `recognizeImage`.
4. PDF: `openPdfPages`; страницы `1..count` по очереди: `page(n)` → `recognizeImage`; тексты склеиваются через
   `\n\n`; `setOcrJob` обновляет `page`/`pages`. Любая ошибка на любой странице — ошибка всей задачи, частичный
   текст не пишется. `close()` — в `finally`.
5. Итог: текст → `setVisionText(id, text)` → `ok` (`via: 'vision'`, `pages`, `truncated`); пусто → `setVisionText(id, '')`
   → `empty`. `setVisionText` вернул `false` (запись удалена окончательно) → `skipped`.
6. `VisionError`: `item` → `markVisionTried` + `failed`; `config` и `transient` → `failed` без отметки. Прерывание →
   `skipped`, ничего не пишется.

Очередь зрения:
- Один исполнитель (параллельность 1), две очереди: ручная (впереди) и фоновая. Очередь извлечения текста PDF
  (`enqueue`) остаётся отдельной.
- Повторный вызов для записи, которая ждёт или распознаётся, возвращает тот же промис; ручной вызов переводит
  ожидающую фоновую задачу в ручную очередь.
- `setOcrJob(id, { phase: 'queued' | 'running', manual, page, pages, cancel })`; по завершении — `setOcrJob(id, null)`.
  `cancel` прерывает и ожидание, и запрос, и растеризацию.
- Фоновые запросы: между началами не меньше `VISION_AUTO_INTERVAL_MS`; не больше `VISION_AUTO_SESSION_LIMIT` за
  сеанс (каждая страница PDF — запрос). Ручные не задерживаются и в предел не входят.
- Остановка авто (ручные задачи продолжают работать):
  - ошибка `config` — до смены настроек ИИ (сравнивается отпечаток: включён, адрес, ключ, обе модели, `aiAutoOcr`);
  - ответ 429 — на `VISION_RATE_PAUSE_MS`;
  - `VISION_AUTO_FAIL_STREAK` ошибок `transient` подряд — на `VISION_AUTO_COOLDOWN_MS`;
  - исчерпан предел сеанса — до перезапуска.
  О каждой остановке — один `toast` (sonner): «Автораспознавание остановлено: {причина}» (для `config` — с действием
  «Настройки», открывающим раздел настроек); предел сеанса — «Автораспознавание приостановлено: 100 изображений за
  сеанс. Остальные — после перезапуска или кнопкой «Распознать»». Ожидающие фоновые задачи при остановке снимаются
  (`skipped`), записи остаются в заделе.
- Запись, у которой фоновая попытка закончилась `transient`, в этом сеансе авто больше не берёт (набор в памяти,
  как `triedThisSession` у PDF).

Задел (`drainVisionBacklog(): Promise<number>` — сколько поставлено; `startVisionAuto(): void`):
- `startVisionAuto()` (вызов из `src/main.tsx`, только главное окно; вне него и повторно — ничего): через 20 с после
  старта и при `visibilitychange → visible` / `focus` окна, не чаще `VISION_BACKLOG_MIN_GAP_MS`.
- `drainVisionBacklog`: `aiEnabled && aiAutoOcr && aiAutoOcrSince > 0 && visionAvailability === null`, авто не
  остановлено → выборка `db.items.filter(isVisionBacklog)` без пробованных в сеансе, не больше `VISION_BACKLOG_BATCH`
  → фоновые задачи. Сюда попадают записи из мини-окна, сканы после `drainPdfBackfill` и записи после сбоя сети.
- Импортированные записи и всё созданное до включения настройки авто не трогает (Р3).

`src/main.tsx`: после запуска `drainPdfBackfill` — `startVisionAuto()` (импорт из `./lib/ocr`).

Тесты `ocr.test.ts` (подмена `@/lib/ai.recognizeImage`, `@/lib/visionImage`, `@/lib/pdfRender`, `@/lib/pdfText`;
фальшивые таймеры): картинка → текст, обе отметки; пусто → `empty` и обе отметки; ИИ выключен → ни одного вызова
`recognizeImage` (в т.ч. если выключили, пока задача ждала); запись в корзине не распознаётся; корзина во время
ожидания → `skipped`; мини-окно → `skipped`; `item`-ошибка ставит `ocrVisionAt` и не повторяется; `transient` не
ставит отметку, повтор в сеансе авто не делает, вручную — делает; `config` останавливает авто и не ставит отметку;
серия `transient` → пауза; предел сеанса; интервал между фоновыми; ручная обгоняет фоновые; повторный вызов — тот
же промис; отмена: ничего не записано, прежний текст цел; PDF: слой пуст → зрение, ≤ 5 страниц, `pages`, ошибка на
3-й странице — текст не записан; PDF с `ocrVisionAt` при повторе не разбирает слой; задел уважает `since`,
`ocrVisionAt`, корзину и размер порции; состояние `OcrJob` (queued → running с номером страницы → нет).
`visionImage.test.ts`: `planVisionSize` (границы, пропорции, без увеличения), выбор PNG/JPEG, ступени уменьшения,
пределы, закрытие bitmap. `pdfRender.test.ts`/`pdfEngine.test.ts`: предел страниц, пароль/битый — `permanent`,
прерывание, время, `close` в любом исходе, `wasmUrl` и `useWasm: false` доходят до `getDocument`.

## 4. Волна 1 — интерфейс: пакет `ocr-ui` (sonnet)

Правила — `docs/DESIGN.md` (токены, `px-*`, вариант `pixel:`, без `!`, значки через `Icon`). Проверка: «Классика»
день/ночь и «Осень» день/ночь, 1200 и 375 px.

### 4.1 `src/hooks/useOcr.ts` (новый)
`useOcrJob(id)`, `useOcrNote(id)` — `useSyncExternalStore(subscribeOcr, () => getOcrJob(id))`.

### 4.2 `src/components/items/detail/ocrView.ts` (новый, чистый, с тестом)
`ocrBlockView(item, job, note, aiBlocked): OcrBlockView` — вся логика выбора состояния (в vitest нет DOM):

| Условие (по порядку) | Вид |
|---|---|
| `ocrKindOf(item) === null` | блока нет |
| идёт задача (`job`) | строка состояния: «В очереди…», «Распознаётся…», «Распознаётся: страница {n} из {m}…» + «Отменить» |
| есть `ocrText` | раздел с текстом (4.3) |
| запись в корзине | блока нет |
| `note.status === 'failed'` | текст ошибки (`text-destructive`) + «Повторить» |
| картинка или скан PDF, ИИ доступен, `ocrVisionAt` есть (или `note.empty`) | «Текст не найден» + «Распознать заново» |
| картинка или скан PDF, ИИ доступен | кнопка «Распознать текст» + строка о сети |
| скан PDF, ИИ недоступен | примечание: «В PDF нет текстового слоя. Распознать скан можно через ИИ-помощника: «Настройки → ИИ-помощник»» |
| PDF без `ocrAt` (слой ещё не проверен) | кнопка «Извлечь текст» (локально; при доступном ИИ скан пойдёт дальше в зрение — строка о сети показывается) |
| картинка, ИИ недоступен | блока нет (ИИ выключен по умолчанию — не шумим) |

Строка о сети (обязательна рядом с любой кнопкой, запускающей отправку): картинка — «Изображение будет отправлено
на {aiHostLabel(aiBaseUrl)}»; PDF — «Первые страницы (до 5) будут отправлены картинками на {хост}».

### 4.3 `src/components/items/detail/OcrBlock.tsx` (новый): `OcrBlock({ item, readOnly })`
- Место: `ItemContent.tsx`, ветка `file`/`image` — между `FileBlock` и заметкой.
- Раздел с текстом: заголовок-кнопка (значок `chevron-right`/`chevron-down`, «Распознанный текст», справа
  «{N} знаков»), `aria-expanded`, `aria-controls`; **по умолчанию свёрнут**. После ручного распознавания в открытой
  панели раздел раскрывается сам.
- Раскрыт: текст в колодце (`px-well`, `whitespace-pre-wrap break-words`, `max-h-80 overflow-auto`, `tabIndex={0}`,
  `role="region"`), показываются первые `OCR_VIEW_CHARS` символов и кнопка «Показать весь текст», если длиннее.
  Под текстом действия: «Копировать» (`copyText`), «Изменить» (при длине ≤ `OCR_EDIT_MAX`; правка — существующий
  `ContentEditor` с `onSave = actSaveOcrText`, стёртый целиком текст равен очистке), «Очистить» (`actClearOcrText`),
  «Распознать заново» (`actRecognize`; для PDF с текстовым слоем подпись «Извлечь заново», сети нет; для картинки и
  скана — только при доступном ИИ, со строкой о сети).
- `readOnly` (корзина): только просмотр и «Копировать».
- Состояние задачи — `role="status"`, `aria-live="polite"`; значок `loader` (`animate-spin`, в пиксельных сценах без
  анимации — как в остальных местах). «Отменить» — `actCancelRecognize(item.id)`.
- Новых клавиш нет. Кнопки на телефоне — высота 36 px (`pointer-coarse:h-9`).

### 4.4 `src/views/settings/AiSection.tsx`
- Описание секции: «Предлагает заголовок, краткое описание и теги для записи; по желанию распознаёт текст на
  картинках и сканах PDF. Работает с любым OpenAI-совместимым API.»
- Подсказка у ключа: «…Запросы уходят напрямую провайдеру и содержат текст записи, а при распознавании — изображение.»
- Новый блок «Распознавание текста» (после проверки подключения):
  - абзац: «Текст на картинках и сканах PDF распознаёт модель со зрением. При распознавании изображение (у PDF —
    первые 5 страниц в виде картинок) отправляется на адрес API: {хост}. Пока ИИ-помощник выключен, ничего не
    отправляется.»
  - поле «Модель для распознавания» (`aiVisionModel`, `CommitInput`, placeholder — текущая `aiModel`), подсказка:
    «Пусто — используется основная модель. Нужна модель, которая принимает изображения.»
  - переключатель «Распознавать автоматически» (`aiAutoOcr`); недоступен, пока `visionAvailability` не `null`;
    подсказка: «Новые картинки и сканы PDF будут отправляться на {хост} сразу после добавления, без вопроса. Записи,
    добавленные раньше, не трогаются: их можно распознать кнопкой в подробностях записи.» Включение —
    `setSettings({ aiAutoOcr: true, aiAutoOcrSince: Date.now() })`, выключение — `setSetting('aiAutoOcr', false)`.
  - кнопка «Проверить распознавание»: на canvas рисуется проверочная картинка (белый фон, чёрный текст
    «QuickDrop 2468», ≈480×160) → PNG → `recognizeImage(blob, { ...settings, aiEnabled: true })`. В ответе есть
    «2468» → «Распознавание работает (модель {model})»; ответ без цифр → «Модель ответила, но текст не прочитала»;
    ошибка → её текст. Отправляется только эта картинка.
- `docs/DESIGN.md`: короткий раздел «Распознанный текст» (состояния блока, строка о сети — обязательна).

Тест `ocrView.test.ts`: вся таблица 4.2, корзина, длинный текст (правка недоступна), подписи для PDF со слоем.

## 5. Долги из HANDOFF

### 5.1 Закрываются на этапе 8

| Долг (этап) | Пакет | Что сделать |
|---|---|---|
| Признак «пробовали зрением» и судьба `MAX_OCR_TEXT` (1–2) | `ocr-data`, `ocr-logic` | Р1, Р2 |
| `share_target` создаёт запись с источником `paste` (4) | `ocr-data` (тип, подпись), `debts-ui` (`src/pwa.ts`: `openCapture({ text, source: 'share' })`) | |
| `composeQuery`: «Без категории» + `cat:x` → `cat:none cat:x` (4) | `debts-search` | если в строке поиска есть оператор `cat:` (`parseQuery(text).categoryName !== undefined`), `categoryId` фильтра не сериализуется — побеждает строка, как у типов; тесты: `cat:none` не дублируется, одинаковая категория не дублируется |
| `deleteTag`/`deleteCategory` и сохранённые поиски: подсказка в пустой выдаче (4) | `debts-search` | §5.2 |
| Сортировка на телефоне в ряду фильтров (4) | `debts-ui` | `FilterBar.tsx`: при < 768 px сортировка и вид — закреплены справа вне прокручиваемого ряда, компактно: кнопка сортировки без подписи значения (значок, `aria-label` «Сортировка: {текущая}») и одна кнопка-переключатель вида (`aria-label` «Вид: список. Переключить на карточки» и наоборот); высота 36 px; ≥ 768 px — без изменений |
| README pixelfx и имя теста утверждают, что шапка `math.ts` попадает в сборку (6) | `debts-ui` | `src/lib/pixelfx/README.md`: шапка — только для исходников, в сборку лицензия идёт файлом `public/licenses/pixelfx-LICENSE.txt`; `pixelfx.test.ts`: переименовать тест («в шапке math.ts полный текст MIT (для исходников; в сборке — public/licenses)»), проверки не менять |
| `docs/ИНСТРУКЦИЯ.md`: «Быстрое добавление» → «Быстрая запись» (3) | `docs-user` | вместе с полной переработкой инструкции; то же в таблице клавиш `README.md` |
| `cargo test` в CI (1–2) | `ci` | §7 |
| Расширение не входит в установщик (7) | `ext-bundle` | §5.3 |

### 5.2 Подсказка в пустой выдаче — `src/lib/queryHints.ts` (новый, чистый)
```ts
export interface QueryHint { kind: 'category' | 'tag' | 'filter-category'; name: string }
/** Чего из запроса и фильтров нет в базе. knownTags === null — теги не проверять (корзина). */
export function missingQueryTargets(query: string, filter: Pick<ItemFilter, 'categoryId' | 'tags'>,
  categories: readonly Category[], knownTags: readonly string[] | null, now?: number): QueryHint[]
export function queryHintText(hints: readonly QueryHint[]): string | null
```
- `cat:имя` из строки не разрешается (`resolveCategoryName === undefined`) → «Категории «имя» нет — возможно, её
  удалили или переименовали.»
- Тег из строки или из фильтра, которого нет ни у одной записи → «Тега #имя нет ни у одной записи.»
- `filter.categoryId` — id, которого нет в списке → «Выбранной категории больше нет.»
- Несколько подсказок — через пробел, не больше двух.
- Показ: `ItemsView.tsx`, `InboxView.tsx` — в описании «Ничего не найдено» перед общим текстом; `TrashView.tsx` —
  только подсказка о категории (`knownTags = null`). Сохранённые поиски при удалении тега и категории **не
  переписываются**: удаление оператора расширило бы выдачу без ведома пользователя.

### 5.3 Расширение в установщике — пакет `ext-bundle` (opus)
- `src-tauri/tauri.conf.json`: `bundle.resources = { "../extension/": "extension/" }` (рекурсивная копия каталога;
  точную форму записи сверить по `tauri-utils` в `~/.cargo/registry` и по `cargo check`).
- `src-tauri/src/shell.rs`: чистая `extension_dir_in(resource_dir: &Path) -> Option<PathBuf>` (каталог
  `extension` с файлом `manifest.json`; путь упрощается `dunce`) + команда
  `#[tauri::command] extension_dir(app) -> Result<String, String>` («Папка расширения не найдена»). Регистрация в
  `lib.rs`. Тесты Rust на `extension_dir_in` (есть каталог, нет каталога, каталог без манифеста).
- `src/lib/desktop.ts`: `getExtensionDir(): Promise<string | null>` (вне Tauri и при отказе — `null`, не бросает).
- `src/views/settings/QuickCaptureSection.tsx` (блок расширения): путь к папке (моноширинно, выделяется), кнопки
  «Показать папку» (`revealInExplorer(<папка>/manifest.json)`) и «Копировать путь»; `null` → строка «Папка
  расширения — `extension` в исходниках QuickDrop».
- `src/lib/shellUi.ts` (`EXTENSION_INSTALL_STEPS`, шаг 2): «Нажмите «Загрузить распакованное расширение» и выберите
  папку расширения: её путь показан ниже, кнопка «Показать папку» откроет её в проводнике».
- `extension/README.md`: шаг установки — то же; примечание: после обновления QuickDrop нажать «Обновить» на
  карточке расширения в `chrome://extensions`.
- Не делается: упаковка `.crx`, публикация в магазине, автообновление расширения.
- Не удалось уложить (`bundle.resources` ломает сборку) — пакет сдаёт только то, что не зависит от ресурсов, и
  пишет причину в отчёт; долг остаётся.

### 5.4 Оставлены в долгах

| Долг | Причина |
|---|---|
| Протокол v2 расширения (удостоверение сервера) (7) | принятый риск с оговоркой в настройках и README; нужен отдельный проект протокола |
| Разбор `[[…]]` расходится с micromark на редких входах, нет фаззера (4) | редкие входы, цена ошибки — несозданная связь; фаззер — отдельная работа |
| Логика корзины и клавиш внутри `ItemList.tsx` не покрыта; нет тестов хуков жестов графа (4, 5) | в vitest нет DOM; выносить логику — отдельный рефакторинг перед финальным ревью нежелателен |
| Перенос ноды и выбор связи без мыши (M19) (5) | новая функция, не долг качества |
| ~5 % нод вне зоны при 3000 записей и 12 категориях (5) | лечится «Разложить заново»; правка раскладки рискованна |
| Лес на масштабе 12,5 % пёстрый (6) | визуальная подстройка — нужен глаз пользователя |
| Холсты графа не слушают `contextrestored` (6) | проверяется на приёмке Windows (§10, п. 4.4); чинится, только если воспроизводится |
| `--px-pad` наследуется вложенными панелями (3) | дефекта сейчас нет |
| Отставшие спецификации (`spec-stage2`, `spec-stage4`, `spec-stage6`, `spec-tauri`) | не правятся; основная сессия помечает в HANDOFF (§11) |
| «Распознать» в меню записи, в разборе входящих и для группы записей | Р12; при желании — после финального ревью |

## 6. Документация

### 6.1 Пакет `docs-user` (sonnet): `README.md`, `docs/ИНСТРУКЦИЯ.md`
Источник правды — код и эта спецификация (§2–§5 для того, что пишется параллельно). Без воды: что есть, где
находится, какие клавиши. Названия элементов — как в интерфейсе (сверять по коду: `src/views`, `src/components`).

`README.md` (для того, кто собирает и поддерживает):
1. Что это; платформы (Windows — основная; веб и macOS собираются, на устройствах в этом обновлении не проверялись).
2. Возможности после обновления, по пунктам: сцены оформления («Луг», «Осень», «Бумага», «Зима», «Классика»; день и
   ночь; четыре шрифта), граф записей, живой фон графа, корзина с автоочисткой, Markdown (просмотр/исходник,
   задачи, вики-ссылки, экспорт в папку), сохранённые поиски, поиск по дате, предупреждение о дубле ссылки,
   автоматические резервные копии, текст PDF в поиске, быстрый захват (мини-окно, трей, автозапуск, один
   экземпляр), расширение Chrome (входит в установщик), распознавание текста через модель со зрением.
3. Стек, требования, команды (добавить `cargo test --manifest-path src-tauri/Cargo.toml`, `npm run lint`).
4. Сборка установщиков, macOS, выпуск версии; CI (`ci.yml` — проверки на push и PR, `release.yml` — релиз).
5. Веб-версия и PWA (сохранить существующее; добавить: папка `dist/pdfjs/` — декодеры сканов PDF).
6. Данные и резервные копии (JSON, автокопии, что не попадает в копию).
7. Горячие клавиши (свериться с `ShortcutsSection.tsx` и `useHotkeys.ts`; «Быстрая запись», разделы, граф, корзина).
8. Поиск: все операторы, включая `is:trash`, `date:`/`after:`/`before:` и их русские псевдонимы (по `search/query.ts`).
9. ИИ-помощник и распознавание: что и куда отправляется (текст записи — при подсказке; изображение или первые 5
   страниц PDF картинками — при распознавании; адрес — «Адрес API»); по умолчанию всё выключено; пределы (§2.2);
   «кроме метаданных ссылок и явно включённого ИИ приложение сетевых запросов не делает».
10. Сторонний код и лицензии: pixelfx (сохранить существующий текст), pdf.js и его декодеры (файл
    `licenses/pdfjs-decoders-LICENSE.txt`), шрифты, остальные зависимости из `package.json` — название и лицензия
    **по полю `license` в `node_modules/<пакет>/package.json`**, не по памяти.

`docs/ИНСТРУКЦИЯ.md` (для пользователя; обновить существующие разделы и добавить новые):
схема работы · запуск (Windows, трей, автозапуск) · как добавить запись (панель «Быстрая запись», мини-окно из
любой программы, вставка, перетаскивание, строка во «Входящих», расширение Chrome, предупреждение о дубле ссылки) ·
разбор входящих · подробности записи (точные даты, Markdown: просмотр/исходник, задачи, вики-ссылки `[[…]]`) ·
**распознанный текст** (кнопка, что отправляется и куда, автораспознавание, правка, очистка, пределы: 5 страниц,
30 МБ) · категории и теги · поиск (операторы, даты, фильтр периода, сохранённые поиски) · разделы (добавить «Граф»
и «Корзина», клавиши) · **граф** (ноды, зоны, связи, масштаб, отбор, «Разложить заново», живой фон) · **корзина**
(срок, восстановление, «Удалить навсегда») · **оформление** (сцены, день/ночь, шрифты, живой фон) · все горячие
клавиши · данные (резервная копия, **автокопии**, **экспорт в Markdown**) · ссылки · ИИ-помощник · **быстрый захват
и расширение** · «Если что-то не так» (в т.ч.: модель не принимает изображения; «Удалили по ошибке» → корзина).
Убрать устаревшее: «корзины нет», «Быстрое добавление», «Настройки → Горячие клавиши» для глобального сочетания
(теперь «Быстрый захват»).

### 6.2 Пакет `docs-claude` (sonnet): `.progress/CLAUDE.proposed.md`
**Полная** предлагаемая редакция `CLAUDE.md` (сам `CLAUDE.md` не открывать на запись). Первая строка файла:
«Предлагаемая редакция CLAUDE.md после этапа 8. Применяет только пользователь.» Структура:
1. Шапка и «Возобновление работы» — как сейчас (обновить перечень файлов `.progress`).
2. Стек и команды — по `package.json` и `Cargo.toml` (pdfjs-dist, react-markdown, remark-gfm, шрифты; `cargo test`).
3. Структура — дерево по фактическому `src/`, `src-tauri/src/`, `extension/`, `scripts/`, `docs/`, `public/`
   (каждому каталогу и ключевому файлу — одна строка назначения).
4. Модель данных — корзина (`deletedAt`), `ocrText`/`ocrAt`/`ocrVisionAt`, таблицы `positions`, `searches`,
   источники записей, настройки по группам (в т.ч. что не попадает в копию).
5. Контракты модулей — существующие разделы сохранить (сверив с кодом) и добавить по экспортам кода: дополнения
   `repo` (корзина, положения, сохранённые поиски, `setOcrText`, `setVisionText`, `markVisionTried`, дубли),
   `search` (`serializeFilter`, `composeQuery`, `renameQueryOperators`, даты), `lib/ai` (в т.ч. `recognizeImage`),
   `lib/ocr`, `lib/ocrState`, `lib/visionImage`, `lib/pdfText`/`pdfEngine`/`pdfRender`, `lib/markdown`,
   `lib/markdownExport`, `lib/graphLayout` и `lib/graph/*`, `lib/ambient/*` (контракт слоя), `lib/autoBackup`,
   `lib/dataDesktop`, `lib/exportDir`, `lib/trash`, `lib/savedSearch`, `lib/dedupe`, `lib/dates`, `lib/extInbox`,
   `lib/captureWindow`, `lib/shellUi`, `lib/desktop`, `lib/actions` (полный перечень `act*`), `store/ui`,
   `store/graph`, `store/confirm`, хуки. Контракты этапа 8 — по §2–§3 этой спецификации.
6. Горячие клавиши — по коду.
7. Правила кода — как сейчас + правила этапов 2–8 (корзина не меняет `updatedAt`; сеть — только метаданные ссылок и
   явно включённый ИИ, изображение отправляет только `recognizeImage`; распознанный текст — данные).
8. **Дизайн** — раздел заменён: «Правила — в `docs/DESIGN.md`» + 5–7 строк самого важного (два стиля, токены,
   `px-*`, `Icon`, запрет `!`).
9. Платформы: PWA (сохранить), Tauri (окна main/capture, трей, автозапуск, один экземпляр, команды Rust по
   модулям `lib.rs`/`backup.rs`/`shell.rs`/`ext_server.rs`, capabilities, ресурсы установщика), расширение Chrome.
10. Безопасность данных — существующее + подтверждённые папки автокопий, сервер расширения (127.0.0.1, токен,
    принятый риск), распознавание (что уходит в сеть, `PRIVATE_SETTINGS`, `CLEARED_SETTINGS`), CSP без WebAssembly.
В отчёте пакета — перечень расхождений между нынешним `CLAUDE.md` и кодом.

## 7. CI — пакет `ci` (sonnet)
- Новый `.github/workflows/ci.yml`: `on: push (main), pull_request`. Задачи:
  - `web` (ubuntu-latest): checkout, Node 22 + кэш npm, `node scripts/check-version.mjs` (без тега), `npm ci`,
    `npm run typecheck`, `npm test`, `npm run build`;
  - `rust` (windows-latest): checkout, Node 22, `dtolnay/rust-toolchain@stable`, `swatinem/rust-cache@v2`
    (`workspaces: src-tauri`), `npm ci`, `npm run build` (каталог `dist` должен существовать для сборки контекста
    Tauri), `cargo test --manifest-path src-tauri/Cargo.toml --locked`.
  Права — `contents: read`. Версии действий — те же, что в `release.yml`.
- `release.yml`: в задаче `desktop` перед `tauri-action` — шаги «Сборка фронтенда для тестов Rust» (`npm run build`)
  и «Тесты Rust» (`cargo test --manifest-path src-tauri/Cargo.toml --locked`), **только** при
  `matrix.platform == 'windows-latest'` (на macOS тесты Rust не прогонялись — не должны блокировать выпуск).
  Остальное не менять. Сборка расширения не нужна.
- Проверка пакета: YAML разбирается (`node -e` с простым разбором не требуется — достаточно сверки отступов и
  `git diff`), локально `cargo test` и `npm run build` проходят.

## 8. Пакеты

| Ключ | Волна | Модель | Файлы |
|---|---|---|---|
| `ocr-data` | 0 | opus | `src/types.ts`, `src/lib/settingsSchema.ts`, `src/lib/settingsSchema.test.ts`, `src/db/repo.ts`, `src/db/repo.test.ts`, `src/lib/exportImport.ts`, `src/lib/exportImport.test.ts`, `src/db/seed.ts`, `src/db/seed.test.ts`, `src/components/items/ItemDetail.tsx` |
| `ocr-facade` | 0 (после `ocr-data`) | opus | `src/lib/ai.ts`, `src/lib/ai.test.ts`, `src/lib/ocrState.ts`, `src/lib/ocrState.test.ts`, `src/lib/actions.ts`, `src/lib/actions.test.ts` |
| `ocr-logic` | 1 | opus | `src/lib/ocr.ts`, `src/lib/ocr.test.ts`, `src/lib/visionImage.ts`, `src/lib/visionImage.test.ts`, `src/lib/pdfRender.ts`, `src/lib/pdfRender.test.ts`, `src/lib/pdfEngine.ts`, `src/lib/pdfEngine.test.ts`, `src/lib/pdfText.ts`, `src/lib/pdfText.test.ts`, `vite.config.ts`, `src/main.tsx` |
| `ocr-ui` | 1 | sonnet | `src/components/items/detail/OcrBlock.tsx`, `src/components/items/detail/ocrView.ts`, `src/components/items/detail/ocrView.test.ts`, `src/components/items/detail/ItemContent.tsx`, `src/hooks/useOcr.ts`, `src/views/settings/AiSection.tsx`, `docs/DESIGN.md` |
| `debts-search` | 1 | opus | `src/search/serialize.ts`, `src/search/search.test.ts`, `src/lib/queryHints.ts`, `src/lib/queryHints.test.ts`, `src/views/ItemsView.tsx`, `src/views/InboxView.tsx`, `src/views/TrashView.tsx` |
| `debts-ui` | 1 | sonnet | `src/components/items/FilterBar.tsx`, `src/pwa.ts`, `src/lib/pixelfx/README.md`, `src/lib/pixelfx/pixelfx.test.ts` |
| `ext-bundle` | 1 | opus | `src-tauri/tauri.conf.json`, `src-tauri/src/shell.rs`, `src-tauri/src/lib.rs`, `src/lib/desktop.ts`, `src/lib/desktop.test.ts`, `src/lib/shellUi.ts`, `src/lib/shellUi.test.ts`, `src/views/settings/QuickCaptureSection.tsx`, `extension/README.md` |
| `docs-user` | 1 | sonnet | `README.md`, `docs/ИНСТРУКЦИЯ.md` |
| `docs-claude` | 1 | sonnet | `.progress/CLAUDE.proposed.md` |
| `ci` | 1 | sonnet | `.github/workflows/release.yml`, `.github/workflows/ci.yml` |

Файлы пакетов не пересекаются. Пакеты волны 1 зависят только от волны 0. Нужен файл вне своего списка — не
править, записать запрос в отчёт. `ext-bundle` дополнительно прогоняет `cargo test`.

## 9. Проверка основной сессией после пакетов
1. `npm run typecheck`, `npm test`, `cargo test --manifest-path src-tauri/Cargo.toml`, `npm run build` (в `dist/`
   есть `pdfjs/*.js` и `licenses/pdfjs-decoders-LICENSE.txt`; в precache их нет), сборка с `TAURI_ENV_PLATFORM`.
2. Браузер, ИИ выключен: в подробностях картинки блока распознавания нет; в сетевой панели при добавлении картинок
   и PDF нет ни одного запроса; у скана PDF — примечание про ИИ.
3. Браузер, ИИ включён (свой ключ или локальная модель; иначе — подмена `fetch` в консоли): «Проверить
   распознавание», «Распознать текст» у картинки (PNG-скриншот, фото JPEG, SVG), у скана PDF (в т.ч. чёрно-белый
   офисный скан CCITT/JBIG2 — страница не должна уйти пустой), отмена, «Распознать заново», правка, очистка и
   «Отменить», поиск находит слово из распознанного текста, сниппет в списке, экспорт Markdown и резервная копия
   содержат текст; запись в корзине — только просмотр и копирование.
4. Автораспознавание: включить → новая картинка распознаётся сама, старые не трогаются; неверный ключ → одно
   сообщение об остановке, повторов нет; выключить ИИ при непустой очереди → запросов больше нет.
5. Долги: подсказка «категории нет», сохранение поиска с `cat:`, сортировка на 375 px, источник «из «Поделиться»».
6. Ревью этапа (безопасность: что и когда уходит в сеть; сохранность данных: копии и слияние; интерфейс), затем
   коммит этапа 8, затем финальное ревью всего обновления.

## 10. Приёмка Windows (контрольный список основной сессии)

Сборка: `npm run tauri build`; установщики — `src-tauri/target/release/bundle/nsis` и `msi`. Устанавливать на
чистый профиль или после удаления прежней версии; отдельно — установка поверх 0.1.0 с существующей базой.

1. **Сборка и размер.** Обе цели собраны; записать размеры установщиков NSIS/MSI и установленного каталога,
   сравнить с прежними (0.1.0); в ресурсах есть `extension/manifest.json`. Версия в трёх файлах совпадает
   (`node scripts/check-version.mjs`).
2. **Запуск и база.** Чистый запуск — демоданные, сцена по календарю. Установка поверх старой базы — записи на
   месте, схема v2, корзина пуста, ошибок в консоли нет (DevTools: отладочная сборка `npm run tauri build -- --debug`).
3. **Шрифты и CSP в WebView2.** Все четыре шрифта пиксельных сцен и Geist в «Классике» отображаются (в
   DevTools → Network нет отказов по `font-src`), кириллица не подменяется системным шрифтом; в консоли нет
   нарушений CSP при: открытии графа, Markdown, PDF (worker `pdf.worker…mjs` грузится), растеризации скана
   (модуль `pdfjs/jbig2_nowasm_fallback.js` подгружается из worker), запросе к ИИ (`connect-src`), показе
   картинки ссылки. Ранняя тема (`theme-init.js`) — нет вспышки чужой сцены при старте.
4. **Canvas.** 4.1 Граф: зоны, подписи, сдвиг, масштаб колесом, перетаскивание ноды, протяжка связи с Shift.
   4.2 Масштаб экрана Windows 100, 125, 150 %: ноды и текст резкие, сетка пикселей фона не «плывёт».
   4.3 Живой фон: «Осень», «Луг», «Зима» днём и ночью, «Бумага» (без пейзажа), «Классика» (без фона); свёрнутое
   окно и раздел не «Граф» — отрисовка стоит (загрузка процессора падает); `prefers-reduced-motion` (Параметры →
   Специальные возможности → Визуальные эффекты → Эффекты анимации выкл.) — фон статичен.
   4.4 Потеря контекста: свернуть/развернуть, заблокировать и разблокировать сеанс, подключиться по RDP — граф и
   фон перерисовываются (долг §5.4). 4.5 Нагрузка: 1–2 тыс. записей — сдвиг и масштаб без рывков.
5. **Мини-окно.** Глобальное сочетание из другой программы показывает окно, повтор — прячет; Esc; потеря фокуса
   прячет (кроме открытого диалога файла и перетаскивания файла из Проводника); сохранение текста, ссылки, файла;
   запись появляется в главном окне без перезапуска; настройка «Мини-окно» выкл. — поднимается главное окно;
   занятое сочетание — ошибка в поле и прежнее сочетание; второй монитор и масштаб 150 % — окно по центру экрана
   с курсором.
6. **Трей.** Значок, меню (быстрая запись, открыть, выход); «Сворачивать в трей при закрытии» вкл. — крестик
   прячет, процесс жив, сочетание работает; выкл. — крестик завершает процесс (мини-окно не держит его); запись
   из мини-окна при окне в трее сохраняется.
7. **Автозапуск.** Включить → запись только в `HKCU\…\Run`, после входа в систему приложение стартует скрытым в
   трей; выключить → запись удалена. Путь с пробелами.
8. **Один экземпляр.** Повторный запуск exe поднимает существующее окно; второй процесс не остаётся.
9. **Расширение.** «Настройки → Быстрый захват»: путь к папке показан, «Показать папку» открывает проводник,
   Chrome загружает папку из каталога установки; приём выключен по умолчанию; включить, порт и токен,
   «Проверить соединение»; страница, ссылка, выделенный текст, `Alt+Shift+Q`; повтор той же ссылки — «уже
   сохранено»; неверный токен — отказ; приложение закрыто — понятная ошибка; запись при окне в трее;
   в DevTools расширения нет ошибок CORS/Private Network.
10. **Файлы и папки.** Выбор папки автокопий, автокопия по расписанию и «хранить N копий», экспорт в Markdown с
    прогрессом и отменой, скачивание файла и резервной копии (панель загрузок WebView2), импорт копии 0.1.0
    (формат v1) и новой.
11. **Ссылки.** `fetch_link_meta`: заголовок публичной страницы; адрес во внутренней сети с публичной ссылки не
    запрашивается; открытие ссылки в системном браузере.
12. **Распознавание.** ИИ выключен — запросов нет (проверить, например, Fiddler или журнал локальной модели);
    включён — пункты 3–4 из §9 в установленном приложении; мини-окно: картинка, добавленная через него при
    включённом авто, распознаётся главным окном в течение минуты после возврата фокуса.
13. **Общее.** Перетаскивание файлов в главное окно, `Ctrl+V` с картинкой, все разделы и клавиши `1`–`5`, поиск,
    корзина (`Del`, восстановление, «Удалить навсегда»), сцены и шрифты в настройках, ширина окна 720 px
    (минимальная) — вёрстка цела.
14. **Удаление.** Деинсталляция убирает программу и запись автозапуска; данные пользователя (база WebView2)
    остаются — отметить в инструкции, если поведение иное.

Результаты (что проверено, что нет и почему) — в `.progress/HANDOFF.md`.

## 11. Что вносит основная сессия в HANDOFF
- Раздел «Этап 8»: состояние, решения Р1–Р12, принятые без пользователя.
- «Спецификации, отставшие от кода (не правятся; истина — код)»: `spec-stage2.md` §2.5, §2.8, §2.10, §6 и теперь
  §7 (заделы этапа 8 реализованы иначе: `ocrVisionAt`, `aiAutoOcrSince`); `spec-stage4.md` §2.1, §2.8, §2.12, §5.7;
  `spec-stage6.md` (плотность снега и светлячков, размер арт-пикселя); `spec-tauri.md` §1.1.5, §1.3, §1.4 и
  пп. 2.1–2.12 (действует п. 2.14; расширение теперь в установщике).
- Оставшиеся долги — таблица §5.4. Итоги приёмки Windows — §10.
- `CLAUDE.md`: предложена редакция `.progress/CLAUDE.proposed.md`, ждёт пользователя.

## 12. Открытые вопросы (работа из-за них не стоит)
1. Автораспознавание только для записей, созданных после включения настройки (Р3). Нужна ли кнопка «Распознать все
   накопившиеся картинки (N)» с подтверждением?
2. Пределы: 5 страниц скана, 2000 px, 100 автозапросов за сеанс, пауза 3 с — подходят?
3. Расширение в установщике (Р11): оставить, если сборка и MSI проходят приёмку; иначе вернуть установку из исходников.
4. Версия приложения всё ещё 0.1.0. Поднять до 0.2.0 (три файла) перед сборкой приёмки?
5. Распознанный текст не передаётся в «Предложить заголовок и теги». Добавить (больше текста уходит в ИИ)?
6. Пресеты ИИ: DeepSeek (`deepseek-chat`) изображения не принимает; имя модели со зрением пользователь вводит сам.
   Добавить пресет модели со зрением?
7. Замена раздела «Дизайн» в `CLAUDE.md` и применение `.progress/CLAUDE.proposed.md` — решение пользователя.
