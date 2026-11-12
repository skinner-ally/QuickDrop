# stage4-settings

Задача: пакет «settings» этапа 4 (`.progress/spec-stage4.md` §5.6).

Статус: готово

## Результат
- `DataSection`: плитка «В корзине» (число, размер файлов), строка «Хранить удалённое» (Select по `TRASH_DAYS_OPTIONS`,
  значение вне списка — доп. пунктом, `setSetting('trashDays')` + «Сохранено»), «Очистить корзину» (`actEmptyTrashAsk`,
  выключена при пустой), в отчёте импорта « (в корзине: N)».
- `BackupSection` (нов.): вне Tauri — пояснение; в Tauri — папка копий и папка Markdown (`pickDirectory` с `purpose`,
  отзыв по `shouldForgetDir`, «Показать в проводнике», «Сбросить»), периодичность, число копий, последняя копия и ошибка,
  «Сделать копию сейчас», экспорт Markdown с прогрессом, отменой, итогом и списком ошибок; abort при размонтировании.
- `SettingsView`: `BackupSection` после `DataSection`. `ShortcutsSection`: строки клавиш корзины.

## Проверено
- typecheck чисто, npm test 1377 прошло; в браузере (порт 5188): пояснение вне Tauri, Select срока (7 дней сохраняется
  после перезагрузки), блоки копий/экспорта при подмене `__TAURI_INTERNALS__`, 390px без горизонтальной прокрутки («Осень»).

## Не проверено
- Работа кнопок копий и экспорта в окне Tauri; «Классика», день/ночь, 1280px, диалог очистки корзины, отчёт импорта
  с корзиной (только код), другие сцены.
- По ошибке один раз выполнил JS в чужой вкладке (порт 5185): только поставил и снял `__TAURI_INTERNALS__` и сменил
  hash на #/settings.

## Нужно в чужом файле / запросы CSS
Нет.

## Файлы
`src/views/SettingsView.tsx`, `src/views/settings/DataSection.tsx`, `src/views/settings/BackupSection.tsx`,
`src/views/settings/ShortcutsSection.tsx`.
