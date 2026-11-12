# stage4-core-ui

Задача: этап 4, волна 0, пакет `core-ui` (`.progress/spec-stage4.md` §3): весь Markdown (lib/markdown.ts + тесты,
MarkdownView отдельным чанком, MarkdownText, ViewModeToggle), ContentEditor/ItemContent/LinkCard (renderView с api,
readOnly, toolbar, onCommitted), ConfirmHost + App.tsx, стили этапа (markdown.css, px-flag trash, color-scheme дат),
дополнение docs/DESIGN.md.

Статус: готово

## Ход
- Первый запуск оборван на паузе. Код всех файлов пакета к тому моменту уже был написан.
- Второй запуск: каждый файл сверен со спецификацией §3 по пунктам (`git diff HEAD` и новые файлы). Расхождений,
  которые нужно было бы исправлять, не нашлось, код не переписывался. Затем проверки и браузер.

## Результат (по пунктам §3)
- §3.1 `src/lib/markdown.ts`: `MdNode` (экспорт), `WIKI_SCHEME`, `MD_RENDER_MAX`, `wikiHref`/`parseWikiHref`,
  `remarkWikiLinks` (в link/linkReference/code/inlineCode/html не заходит; разбор цели как в `parseWikiLinks`, с `\|`),
  `remarkSoftBreaks` (`\r\n` — один перевод), `mdUrlTransform`, `toggleTaskAt` (липкое выражение, остальное байт
  в байт), `isMarkdownFile`. Тесты `markdown.test.ts` через `renderToStaticMarkup` с зондами: задачи (вложенные,
  цитата, нумерованные, `* [X]`, CRLF, код, пустые, неверный offset), вики-ссылки (подпись, несколько, таблица с `\|`,
  код, внутри ссылки, `c++`/скобки), переносы, безопасность (адреса, сырой HTML, src картинки с зондом `img`), сноски.
- §3.2 `MarkdownView.tsx`: `memo`, стабильные `components`, данные через контекст; `a` (вики / пустой href → span /
  `#` → прокрутка внутри своего `.qd-md` / внешняя: `_blank`, в Tauri `openLink`), вики-ссылка через
  `buildTitleIndex` с кэшем `WeakMap`, `img` → ссылка `.qd-md-img` со значком `file-image`, `pre` → `CodeView`,
  инлайн `code`, `li` + флажок `ui/checkbox` по `position.start.offset`, `table` в `.qd-md-table`.
- §3.3 `MarkdownText.tsx`: `lazyRetry` + `ErrorBoundary` + `Suspense`, запасной вид `AutoLinkText`, `import type`,
  догрузка в простое под `typeof window`, граница сбрасывается при смене `source` после сбоя (`key`).
- §3.4 `ViewModeToggle.tsx`: `role="group"`, «Просмотр»/«Исходник» с `aria-pressed`, К 24px, П 30px (на телефоне 36px).
- §3.5 `ContentEditor` (`renderView(value, api)`, `readOnly`, `toolbar`, `onCommitted` — blur, Ctrl/⌘+Enter, Esc,
  размонтирование, ровно один раз), `ItemContent` (текст/идея и заметки к ссылке/файлу через Markdown, `readOnly`),
  `LinkCard` (`readOnly`: нет «Обновить данные» и поля адреса).
- §3.6 `ConfirmHost` (`initialFocus` на «Отмена», последний вопрос держится до конца анимации) и `App.tsx`.
- §3.7 `markdown.css` (К в `@layer components`, П под `.pixel`, `line-height: inherit`), `pixel.css`
  (`px-flag[data-flag="trash"]`), `index.css` (импорт и `.dark input[type="date"] { color-scheme: dark; }`),
  `docs/DESIGN.md` (§5 `trash`, §12 «Markdown»).

## Проверки
- `npm run typecheck` — чисто; `npm test` — 46 файлов / 1377 тестов.
- Браузер (порт 5182, остановлен, порт свободен), запись «Проверка Markdown» с заголовками, списком, задачами,
  цитатой, таблицей с `[[…\|…]]`, кодом, ссылкой, картинкой, вики-ссылками (есть / нет), сырым `<script>`, сноской:
  - «Классика» день 1280 и 390, «Осень» день 1280 и 390, «Осень» ночь 1280 — скриншоты сняты; вычисленные стили
    К и П совпадают с таблицей §3.7; на 390 нет горизонтальной прокрутки.
  - Флажок меняет исходник (видно в «Исходнике» и после перезагрузки), правка не открывается, фокус остаётся на флажке.
  - Клик по тексту — правка; Esc откатывает; «Исходник»/«Просмотр» сохраняется после перезагрузки (`qd-md-preview`).
  - Новая `[[Группировка по ключу]]` + уход из поля → toast «Добавлена связь: «Группировка по ключу»», связь
    появилась; клик по вики-ссылке открыл запись. Тестовая правка и связь потом убраны, флажок возвращён.
  - Заметка к ссылке — `data-density="compact"`, заголовок 14px; переключатель и поле адреса на месте.
  - Сноска: клик по `1` не меняет адрес страницы (`#/inbox`), правка не открывается.
  - Запросов к чужим хостам нет (performance entries и сеть), ошибок в консоли нет.
  - `confirmDialog` из консоли: К и П-ночь; фокус на «Отмена»; Esc и «Отмена» → `false`, «Подтвердить» → `true`;
    Esc не закрывает панель деталей; фокус возвращается на элемент, который был в фокусе до вопроса.
  - `.dark input[type="date"]` → `color-scheme: dark` даже под предком со светлой схемой;
    `.pixel .px-flag[data-flag="trash"]` → цвет `--danger`.
  - Сцена и тема в dev-базе 5182 возвращены как были («Классика», светлая).

## Изменённые файлы
src/lib/markdown.ts (нов.), src/lib/markdown.test.ts (нов.), src/components/markdown/MarkdownView.tsx (нов.),
src/components/markdown/MarkdownText.tsx (нов.), src/components/markdown/ViewModeToggle.tsx (нов.),
src/components/items/detail/ContentEditor.tsx, src/components/items/detail/ItemContent.tsx,
src/components/items/detail/LinkCard.tsx, src/components/layout/ConfirmHost.tsx (нов.), src/App.tsx,
src/styles/markdown.css (нов.), src/styles/pixel.css, src/index.css, docs/DESIGN.md.

## Отступления (осознанные)
- `MdImage` внутри обычной ссылки (`[![alt](img)](url)`) рисуется `span.qd-md-img` без своей ссылки — ссылка в ссылке
  недопустима.
- Список со смешанными пунктами: маркер снимается только у задач, отступ `padding-left: 0` — только у списка, где все
  пункты — задачи (`:has`), иначе у обычных пунктов пропали бы точки.
- `.qd-md-check` вынесено из слоя: утилита `relative` у `ui/checkbox` перебила бы правило в `@layer components`.
- Вики-ссылка без записи получает `title="Запись не найдена"` только после загрузки снимка записей.
- `ContentEditor` экспортирует тип `ContentViewApi`; при переходе записи в `readOnly` посреди правки правка завершается.

## Запросы CSS
Нет (все стили этапа в файлах этого пакета).

## Не проверено
- `npm run build` (запрещён исполнителям): что `MarkdownView` — отдельный чанк, подтверждено только по коду
  (импорт только `import()` и `import type`).
- Сброс границы ошибок `MarkdownText` после сбоя отрисовки и сбоя загрузки чанка — только по коду.
- `readOnly` у `ItemContent`/`LinkCard` в живом интерфейсе: потребитель (`ItemDetail`, пакет `detail`) ещё не передаёт проп.
- Внешние ссылки в Tauri (`openLink`) — только по коду. «Классика» ночь, «Луг», «Бумага», «Зима» — не смотрел.
