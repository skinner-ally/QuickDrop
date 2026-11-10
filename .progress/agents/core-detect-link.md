# core-detect-link

**Задача:** реализовать `src/lib/detect.ts` и `src/lib/linkMeta.ts` по контракту из CLAUDE.md
+ тесты `src/lib/detect.test.ts`, `src/lib/linkMeta.test.ts`.

**Статус:** готово

## Результат
- `npx vitest run src/lib/detect.test.ts src/lib/linkMeta.test.ts` — 225/225 пройдено (~0.3 с).
- `npx tsc -b` — без ошибок. `npx oxlint` по четырём файлам — чисто.

### detect.ts
- Контракт: `detectInput`, `isUrl`, `normalizeUrl`, `detectFileType`, а также `LANGUAGES`.
- Дополнительные экспорты: `DetectResult` (с полем `stripped?`), `normalizeLanguage(tag)`,
  `languageFromFileName(name)`, `detectLanguage(code)`.
- `isUrl`: схема http/https/ftp, www., домен[/путь], localhost:порт, IPv4, [IPv6], кириллические
  домены и punycode. Голый домен без пути принимается только с известной зоной; `main.py`, `README.md`,
  `node.js`, «1.2.3», email и «слово.» — не ссылки.
- Код и текст различаются построчно: строки с кириллицей вне строк и комментариев, пункты списков и
  обычные фразы считаются текстом; плюс очки по правилам для каждого языка. Отдельно распознаются
  JSON, HTML, XML, PHP, shebang, YAML, fenced-блоки (```/~~~, `stripped` без обёртки).

### linkMeta.ts
- Контракт: `fetchLinkMeta`, `titleFromUrl`, `parseHtmlMeta`.
- Дополнительные экспорты: `FetchLinkMetaOptions`, `decodeEntities`, `hostToUnicode`, `buildProxyUrl`,
  `LINK_FETCH_TIMEOUT_MS`, `LINK_FETCH_MAX_BYTES`.
- Порядок загрузки: Tauri `invoke('fetch_link_meta')` (динамический import) → прямой fetch (cors, 8 с,
  ≤512 КБ, остановка после `</head>`) → прокси из настроек. Кодировки: BOM / Content-Type / `<meta charset>`
  (windows-1251, cp1251 и др. через TextDecoder). Никогда не бросает, учитывает `signal`.

## Отклонения от контракта (небольшие)
- `normalizeUrl`: для localhost и частных IP добавляется `http://`, а не `https://` (у dev-серверов нет TLS).
- `detectFileType`: PSD (`image/vnd.adobe.photoshop`) → `'file'`, потому что браузер его не показывает.
- `fetchLinkMeta`: если страница скачана, но в ней нет title/description/siteName/image, возвращается
  `failed`, и прокси не пробуется (повторная загрузка метаданных не добавит).

## Изменённые файлы
- src/lib/detect.ts (новый)
- src/lib/linkMeta.ts (новый)
- src/lib/detect.test.ts (новый)
- src/lib/linkMeta.test.ts (новый)
- .progress/agents/core-detect-link.md
