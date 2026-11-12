# fix-review3-detail

Статус: готово

Задача: находки 1-2 ревью этапа 3 (зоны нажатия, pixel:size-7.5 перебивает pointer-coarse:size-9).

Исправлено: в src/components/items/ItemDetail.tsx (Назад, звезда, Закрыть) добавлен `pixel:pointer-coarse:size-9`, как в ItemMenu.

Не в моей группе (нужны правки в чужих файлах):
- FilterBar.tsx:352 переключатель вида: добавить `pixel:pointer-coarse:size-9`.
- FilterBar.tsx:67 FilterButton: `pointer-coarse:h-9 pixel:max-md:h-9`.
- QuickCapture.tsx:611-616 кнопки «Закрыть»/«Остаться»: `max-md:h-9`.

Изменённые файлы: src/components/items/ItemDetail.tsx
