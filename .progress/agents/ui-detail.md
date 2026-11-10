# ui-detail

Задача: панель подробностей записи — src/components/items/ItemDetail.tsx + detail/*.
Статус: готово (npx tsc -b: ошибок в моих файлах нет; остались чужие — нет InboxView, ItemList)
Файлы: src/components/items/ItemDetail.tsx; src/components/items/detail/{AiSuggest,AutoLinkText,AutoTextarea,ContentEditor,FileBlock,ItemContent,LinkCard,LinkPicker,LinkedItems,TitleField}.tsx; detail/{autosave,save}.ts
Чужие импорты: items/{CategorySelect,TagInput,TagChip,TypeIcon,CodeView,FilePreview,ItemMenu}, lib/actions, hooks/useItems, db/settings.
