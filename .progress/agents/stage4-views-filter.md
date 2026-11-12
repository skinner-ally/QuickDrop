# stage4-views-filter

Задача: этап 4, волна 1, пакет views-filter (spec-stage4 §5.3): период поповером и своим периодом, строка активного
отбора при поиске, SaveSearchButton, дубль ссылки в QuickAdd, Markdown в TriageMode.

Статус: готово

## Результат
- FilterBar: PeriodFilter — Popover (radiogroup «Период»: Всё время / Сегодня / За неделю / За месяц; два поля даты,
  customDateRange, ошибка role="alert" + aria-invalid, фильтр при ошибке не меняется). PERIODS/periodStart/currentPeriod
  удалены. Один чип «Период: …». Строка отбора — при hasActive или непустом поиске; после чипов SaveSearchButton;
  «Сбросить фильтры» только при hasActive.
- SaveSearchButton (нов.): поповер, запрос currentSearchQuery, «Уже сохранён как «…»», имя, Enter/кнопка → actSaveCurrentSearch.
- InboxView: дубль ссылки (findDuplicateLinkIn по getAllItemsSnapshot) → openCapture({ text, source: 'manual' }), поле очищено, запись не создаётся.
- TriageMode: текст/идея через MarkdownText в div с классами размера в className.

## Изменённые файлы
src/components/items/FilterBar.tsx, src/components/items/SaveSearchButton.tsx, src/views/InboxView.tsx,
src/components/items/TriageMode.tsx

## Проверено
typecheck и npm test зелёные (46 файлов, 1377 тестов). Браузер (порт 5185, «Осень», ночь, окно ~800x600), по DOM:
периоды и подпись кнопки/чип; свой период 01–10.11 → чип с датами, ни один radio не отмечен; начало позже конца → ошибка;
сохранение: `is:library date:2026-11-01..2026-11-10` и `is:library date:week`, поиск появился в боковой панели, поповер
закрылся; дубль адреса во «Входящих» → открылась панель с адресом, запись не создана; «Разобрать»: Markdown отрисован в div, 15px.

## Нужно в pixel.css / CSS
Ничего.

## Не проверено
«Классика», день, 390px, Луг/Бумага/Зима; строка предупреждения о дубле (пакет capture-palette); проверка «Уже сохранён»
глазами; под конец сосед правил ItemList (ошибка dateGroup, потом исчезла).
