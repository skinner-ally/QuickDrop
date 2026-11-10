# review-final-security

Задача: финальное ревью, линза «безопасность и приватность». Только чтение.
Статус: готово

Прочитано целиком: src-tauri (tauri.conf.json, capabilities/default.json, src/lib.rs, Cargo.toml), vite.config.ts, index.html,
src/pwa.ts, src/main.tsx, src/lib/{exportImport,linkMeta,normalize,ai,desktop,actions,itemTitle,platform}.ts, src/db/settings.ts,
src/types.ts, src/store/ui.ts, src/hooks/{useItems,useHotkeys}.ts, QuickCapture, FilePreview, FileBlock, LinkCard, AutoLinkText,
ItemContent, AiSuggest, AppShell, settings/{AiSection,DataSection,LinksSection,Section}.tsx; выборочно repo.ts, detect.ts, seed.ts,
ItemCard, TriageMode, CodeView, release.yml.

## Находки (по убыванию важности)

1. HIGH — src/components/items/FilePreview.tsx:112-136 + src/lib/exportImport.ts:395-401. Хранимый XSS из чужой резервной копии.
   В копии запись `{type:'file', fileName:'отчёт.pdf', mimeType:'application/pdf', fileId:'f1'}` и файл `{id:'f1', mimeType:'text/html', data: base64('<script>…</script>')}`.
   decodeFile создаёт Blob с типом из копии; isPdf считается по item.mimeType/расширению, кнопка «Открыть» — `<a href=blob: target=_blank>`.
   Клик открывает HTML-документ в origin приложения: скрипт читает IndexedDB (все записи, aiApiKey). В вебе CSP нет; в Tauri blob наследует CSP окна.
   Исправление: показывать «Открыть» только при `file.blob.type === 'application/pdf'`; при импорте приводить тип Blob к безопасному
   (всё кроме белого списка image/*, application/pdf, text/plain → application/octet-stream); добавить CSP в веб-сборку.

2. MEDIUM — src/components/items/FilePreview.tsx:62, src/components/items/detail/FileBlock.tsx:20. SVG пользователя показывается через
   `<img src=blob:>` с типом image/svg+xml. В `<img>` скрипты не идут, но «Открыть изображение в новой вкладке» (контекстное меню) или
   перетаскивание картинки из лайтбокса на панель вкладок открывает blob-документ в origin приложения — `<svg onload=…>` исполняется.
   Исправление: CSP для веба (script-src 'self' наследуется blob-документом) и/или показывать SVG через растеризованное превью / blob,
   пропущенный через санитайзер; draggable={false} и onContextMenu для лайтбокса не заменяют CSP.

3. MEDIUM — index.html (веб/PWA). CSP задан только в tauri.conf.json; у веб-сборки нет ни meta CSP, ни заголовков. Любая инъекция
   (п. 1, 2) получает полный доступ к IndexedDB и ключу. Исправление: `<meta http-equiv="Content-Security-Policy">` в index.html
   (default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; img-src 'self' data: blob: https: http:; connect-src 'self' https: http:;
   style-src 'self' 'unsafe-inline'; font-src 'self' data:), в Tauri-сборке не мешает.

4. MEDIUM — src/lib/exportImport.ts:321-334, 361 + src/lib/itemTitle.ts:79-87 + ItemCard.tsx:381. Импорт копии с `createdAt: 9e15`
   (конечное число проходит `num`) → `Intl.DateTimeFormat.format` бросает RangeError «Invalid time value» при рендере карточки;
   ErrorBoundary нет → белый экран при каждом запуске (запись со status inbox сортируется первой). В Tauri нет адресной строки,
   чтобы уйти в #/settings и удалить данные. Исправление: в sanitizeItem ограничить даты диапазоном (0 … now+сутки, |ts| ≤ 8.64e15),
   в formatRelative/formatDateTime — защита от невалидной даты, добавить ErrorBoundary с кнопкой «Настройки/Удалить данные».

5. LOW — src-tauri/src/lib.rs:76-104. fetch_link_meta не фильтрует адреса назначения: loopback/частные сети/169.254.169.254 и
   редиректы на них с публичного сайта. Сохранение ссылки `https://evil.example/x` (302 → `http://192.168.1.1/reboot.cgi`) выполняет
   слепой GET к устройству в локальной сети с машины пользователя, минуя защиту браузера (Private Network Access, CORS). При XSS
   команда отдаёт до 512 КБ HTML внутренних страниц. Исправление: в redirect-политике запрещать переход с публичного хоста на
   loopback/private/link-local (проверка IP после резолва — свой resolver/`resolve_to_addrs`), запретить понижение https → http.

6. LOW — src/components/capture/QuickCapture.tsx:195-217. Предпросмотр заголовка делает сетевой запрос до сохранения записи:
   (а) Ctrl+V вне полей со ссылкой в буфере — GET уходит через 500 мс без подтверждения; (б) при наборе «example.com/secret» с паузами
   запросы уходят на недонабранные адреса («example.co», «example.com/se»); (в) веб + настроенный прокси: чужая страница со ссылкой
   `https://<приложение>/?url=https://evil.example/t` (src/pwa.ts:20-37) открывает панель и сама отправляет адрес на прокси.
   Исправление: предпросмотр только по явному действию или после сохранения; для черновика из параметров запуска предпросмотр не запускать.

7. LOW — src/views/settings/AiSection.tsx:35, src/lib/ai.ts:85-91. Адрес API допускает `http://`: ключ (Authorization: Bearer) и текст
   записи уходят открытым текстом. Исправление: требовать https, http разрешать только для localhost/127.0.0.1/[::1].

8. LOW — src/db/seed.ts:295-303 + DataSection. «Удалить все данные» не трогает таблицу meta: aiApiKey, aiBaseUrl, linkProxyUrl
   (в шаблоне может быть токен) остаются на устройстве, хотя пользователь считает данные удалёнными. Исправление: очищать секреты
   (или явно написать в диалоге и дать флажок «и настройки/ключ»).

9. LOW — LinkCard.tsx:38-50, ItemCard.tsx:62-77, TriageMode.tsx:71-85 + exportImport.ts:293-296. og:image/favicon грузятся с чужих
   хостов при каждом показе списка/карточки, в т.ч. при выключенном «подтягивать заголовок»; в импортированной копии linkMeta.image
   может быть произвольным http(s)-адресом (пиксель слежения: IP и время каждого открытия приложения). Исправление: при импорте
   сбрасывать image/favicon (или status → failed), не грузить картинки при autoFetchLinkTitle=false; опционально кэшировать превью локально.

## Проверено, дефектов не найдено
- safeLinkUrl/safeImageUrl: javascript:/data:/file: и варианты с табами/переводами строк отсекаются (`new URL().protocol`).
- dangerouslySetInnerHTML/innerHTML в src нет; заголовки/описания страниц и ответы ИИ выводятся текстом.
- Экспорт: aiApiKey и сетевые настройки не попадают в копию (PRIVATE_SETTINGS применяется и при экспорте, и при импорте).
- Импорт: прототипное загрязнение не воспроизводится (Map, Object.hasOwn, фиксированные ключи); предел 480 МБ; url с чужой схемой → текст.
- lib.rs: схемы http/https на входе и на редиректах, ≤5 редиректов, таймаут 8 с, предел 512 КБ после распаковки, паник на кривом
  Content-Type/charset нет, команда async (UI не блокирует).
- capabilities: opener ограничен http/https, лишних прав (fs, shell, http) нет; withGlobalTauri выключен.
- Service worker: только precache бандла, runtime-кэширования чужих ответов нет; в Tauri SW отключён.
- Ключ ИИ не попадает в логи, URL и тексты ошибок приложения.

Изменённые файлы: только этот отчёт.
