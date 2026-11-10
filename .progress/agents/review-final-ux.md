# review-final-ux

Задача: финальное ревью, линза «сценарии и клавиатура» (только чтение, код не менялся).
Статус: готово
Изменённые файлы: только этот отчёт.

Как проверялось: чтение кода целиком (useHotkeys, store/ui, store/selection, AppShell, ThemeProvider, ItemList, ItemCard,
QuickCapture, CommandPalette, TriageMode, ItemDetail + detail/*, TagInput, CategorySelect, FilterBar, Sidebar, TopBar,
MobileNav, BulkBar, ItemMenu, settings/*, search/query+highlight, pwa.ts, desktop.ts, src-tauri). Часть находок
перепроверена в живом dev-сервере (localhost:5173): №1 воспроизведён (F изменил не ту запись), пустой e.code
подтверждён (синтетические keydown с key='n'/'j' без code ничего не делают), Ctrl+K поверх панели добавления и Esc
в меню строки работают корректно (в находки не вошли). Данные демо-базы возвращены в исходное состояние.
Не проверялось в живом окне: Tauri (№2, №14), iPhone/Android (№4, №9).

## Находки (по важности)

1. HIGH — ItemList.tsx:160-175, AppShell.tsx:80-87. Клавиши списка действуют на курсор, а не на запись, открытую в
   деталях. Открыть запись A → Ctrl+K → выбрать запись B того же раздела (или клик по связанной/похожей записи,
   «Открыть» в toast после сохранения) → детали показывают B, курсор и фокус остаются на A → Del/E/A/F меняют A.
   Воспроизведено. Тот же класс: запись выпала из выдачи при правке (курсор уходит на соседа, детали остаются).
   Исправление: синхронизировать cursorId с selectedId при внешнем select (эффект в ItemList по selectedId), в
   targets() при открытых деталях брать открытую запись; DetailPane не должен возвращать фокус на старую строку,
   когда открывается другая запись.
2. HIGH — src-tauri/tauri.conf.json:13-22. В окне не задано `dragDropEnabled: false`: в Tauri 2 на Windows при
   включённом по умолчанию нативном обработчике HTML5-события dragenter/drop для файлов в webview не приходят, а
   `tauri://drag-drop` приложение не слушает. Перетаскивание файлов в окно настольной версии не сработает.
   (По документации Tauri; в живом окне не проверено.) Исправление: `"dragDropEnabled": false` у окна main.
3. MEDIUM — useHotkeys.ts:59-94, ItemList.tsx:204-292, TriageMode.tsx:351-393. Все сочетания сравнивают только
   e.code; при пустом code (сенсорная клавиатура Windows, Android, часть IME, удалённый рабочий стол, расширения,
   синтетические события) не работает ничего: N, Alt+N, Ctrl+Shift+Space, Ctrl+K, /, 1-4, Esc, J/K/стрелки, Enter,
   O, E, A, F, X, Del/Backspace, Ctrl+A, Ctrl+Enter в разборе. Плюс «/» на раскладках, где это Shift+7, не
   фокусирует поиск. Предложение — src/lib/keys.ts, см. ниже.
4. MEDIUM — QuickCapture.tsx:358-366. Enter в поле содержимого сохраняет запись, пока текст однострочный. На
   телефоне Shift+Enter недоступен → многострочную заметку набрать нельзя (первый «ввод» сохраняет и закрывает).
   Исправление: на pointer:coarse Enter всегда перенос строки (сохранение кнопкой), либо enterKeyHint + отдельная логика.
5. MEDIUM — AppShell.tsx:16-20,174-176, InboxView.tsx:15-16,203-207. Ленивые чанки без ErrorBoundary и без повтора:
   отказ import() (офлайн без SW: первый визит, приватный режим, http-доступ по LAN; устаревшая вкладка после
   деплоя) роняет всё дерево React → пустой экран. CommandPalette монтируется сразу, поэтому сбой возможен уже на
   старте. React.lazy кеширует отказ навсегда. Исправление: ErrorBoundary вокруг каждого Suspense + lazy с повтором;
   .catch у фоновых предзагрузок (AppShell.tsx:22, InboxView.tsx:121).
6. MEDIUM — ItemList.tsx:197-215, AppShell.tsx:162-169. При модальном листе деталей (ширина < 1100px; у Tauri
   minWidth 720) клавиши списка активны: у листа нет data-open, OPEN_OVERLAY его не видит. Ctrl+A в деталях выделяет
   все записи скрытого/затемнённого списка, следующий Del удаляет их все. Исправление: добавить листу data-open
   (или проверять modalDetail/inert) и не обрабатывать Ctrl+A/массовые действия.
7. MEDIUM — useHotkeys.ts:98-110, QuickCapture.tsx:381-390. Вставка, где в буфере есть и текст, и картинка (ячейки
   Excel и т.п.): берётся файл, текст игнорируется — вместо текста прикрепляется PNG (и в глобальной вставке, и
   внутри панели). Исправление: файлы — только если нет непустого text/plain.
8. LOW — QuickCapture.tsx:132-138,233-237. Сохранённый черновик молча затирается: набрать текст → Esc → Ctrl+V на
   странице (панель открывается с содержимым буфера, черновик не восстановлен) → Esc или сохранение → прежний
   черновик потерян. Исправление: при открытии с draft не трогать сохранённый черновик (не писать/не чистить).
9. LOW — AppShell.tsx:38-53. Кнопка «Назад» (Android, жест iOS) при открытых деталях/панели добавления/разборе
   уходит из раздела или закрывает PWA вместо закрытия листа: в истории есть только раздел.
10. LOW — ItemList.tsx:221-230. В сетке J/K и стрелки двигают курсор линейно: ↓ переходит на карточку справа, ←/→ не
    работают. Исправление: в grid считать число колонок по DOM и двигать на ±cols, ←/→ на ±1.
11. LOW — TriageMode.tsx:345-396, ItemList.tsx:200, useHotkeys.ts:59-73. Обработчики смотрят DOM, а не состояние:
    (а) Alt+N/Ctrl+Shift+Space открывают добавление поверх разбора; при фокусе на кнопке панели E/A/F/Backspace
    разбирают запись под ней; (б) пока чанк палитры не загрузился, paletteOpen уже true, диалога нет — набранные
    после Ctrl+K буквы e/a/f/Backspace уходят в список. Исправление: проверять useUi.captureOpen/paletteOpen.
12. LOW — index.html, ThemeProvider.tsx:37-39. Тема применяется только при исполнении бандла: до этого страница
    рисуется светлой → вспышка при тёмной теме на холодном старте (заметно в PWA). Исправление: маленький
    блокирующий скрипт в head (внешний файл, чтобы не ломать CSP Tauri) или @media (prefers-color-scheme) для фона html.
13. LOW — useHotkeys.ts:57-73. macOS: Option+N — мёртвая клавиша «˜» (ñ), Ctrl+K — «удалить до конца строки» в
    полях ввода; оба перехватываются даже в полях. Исправление: на Mac модификатор только metaKey, Alt+N — вне полей.
14. LOW — desktop.ts:26-34. Если глобальное сочетание занято другой программой, при старте только console.warn;
    Ctrl+Shift+Space не работает и в окне (перехватывает чужая программа), пользователь не узнаёт причину.
15. LOW — useHotkeys.ts:78-82, ItemList.tsx:212-215, TagInput.tsx:129-135. Esc: (а) один Esc и закрывает детали, и
    снимает выбор чекбоксов; (б) из поля тегов в деталях Esc не закрывает панель никогда (фокус остаётся в поле).
16. LOW — useHotkeys.ts:146-150. Файлы, брошенные мимо формы при открытой панели добавления (на затемнение),
    молча игнорируются; должно быть openCapture({ files }) — форма их дополнит.
17. LOW — ItemsView.tsx:71-75, InboxView.tsx:193-201, ItemList.tsx:130-145. После E/A/Del по последней записи списка
    ItemList размонтируется раньше, чем отработает переход на соседа: детали остаются открытыми на уже
    обработанной записи (при непустом списке панель переходит дальше).

Не дефекты (проверено): утечек слушателей нет (все эффекты снимают подписки, Tauri listen — с флагом disposed);
двойных срабатываний в StrictMode в продакшене нет (в dev дважды покажется toast о слишком большом файле —
acceptFiles в инициализаторе useState, QuickCapture.tsx:146); Ctrl+K поверх панели добавления, Esc в меню строки,
Ctrl+Shift+Space/Alt+N в Chrome/Firefox на Windows конфликтов не дают; AltGr (Ctrl+Alt) исключён условием !mod.

## Предложение: matchKey

```ts
// src/lib/keys.ts
const KEY_BY_CODE: Record<string, string[]> = {
  Space: [' ', 'Spacebar'], Slash: ['/'], Escape: ['Escape', 'Esc'], Enter: ['Enter'], NumpadEnter: ['Enter'],
  Delete: ['Delete', 'Del'], Backspace: ['Backspace'],
  ArrowUp: ['ArrowUp', 'Up'], ArrowDown: ['ArrowDown', 'Down'], ArrowLeft: ['ArrowLeft', 'Left'], ArrowRight: ['ArrowRight', 'Right'],
}
function keysFor(code: string): string[] {
  if (KEY_BY_CODE[code]) return KEY_BY_CODE[code]
  if (code.startsWith('Key')) return [code.slice(3).toLowerCase()]   // KeyN → 'n' (только латиница)
  if (code.startsWith('Digit')) return [code.slice(5)]
  return [code]
}
/** Сначала физическая клавиша (любая раскладка); e.key — только когда code пуст. */
export function matchKey(e: KeyboardEvent, code: string, key?: string | string[]): boolean {
  if (e.code) return e.code === code
  if (!e.key || e.key === 'Unidentified' || e.key === 'Process' || e.key === 'Dead') return false
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
  const keys = key === undefined ? keysFor(code) : Array.isArray(key) ? key : [key]
  return keys.includes(k)
}
/** Для switch: канонический code события. */
export function eventCode(e: KeyboardEvent, codes: readonly string[]): string | undefined {
  return codes.find((c) => matchKey(e, c))
}
```
Замены: useHotkeys.ts:59,64,69,78,86,89,92-94; ItemList.tsx:204,212,217,220-292,235; TriageMode.tsx:351,362,367-393
(switch — через eventCode). Для «/» дополнительно `|| (e.key === '/' && !mod && !e.altKey)` при непустом code.
