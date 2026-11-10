# ui-list-inbox

Задача: ItemList, ItemCard, EmptyState, BulkBar, InboxView, TriageMode, store/selection.
Статус: готово

Результат: `npx tsc -b` без ошибок. Файлы: src/store/selection.ts, src/components/items/{ItemList,ItemCard,EmptyState,BulkBar,TriageMode}.tsx, src/views/InboxView.tsx.
Заметки: ItemCard.tsx экспортирует ItemRow, ItemCard (оба memo), ItemVariant. TriageMode({open,onClose}). BulkBar({variant}) встроен в ItemList.
Не проверено в браузере.
