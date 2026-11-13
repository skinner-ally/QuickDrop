# fix-review8-ui

Статус: готово

Задача: исправления группы «ui» по ревью этапа 8 (5 находок).

## Сделано
1. Стёртый текст в правке OcrBlock: `isBlankOcrDraft` (ocrView.ts, через cleanOcrText); `onSave` для пустого черновика
   возвращает false (автосохранение откатывает базу, поле не исчезает); очистка — в `onCommitted` через
   `actClearOcrText` (toast «Отменить»). В ContentEditor добавлен необязательный `onEditingChange`.
2. PDF после «Очистить»: в `ocrBlockView` PDF без ocrVisionAt и без note.empty — «Извлечь текст» (сеть только при доступном ИИ);
   примечание «нет текстового слоя» — только при note.empty или ocrVisionAt. Тесты обновлены.
3. Повторное включение ИИ: `aiEnabledPatch` (src/views/settings/aiPatch.ts + тест) сдвигает aiAutoOcrSince, если
   aiAutoOcr уже включён; тексты в AiSection поправлены, «Сейчас недоступно» показывается и при включённом авто.
4. Строка о сети не рисуется во время правки (через onEditingChange).
5. Формулировка «ничего не отправляется» в AiSection уточнена (кнопки проверки отправляют проверочные данные).

## Изменённые файлы
src/components/items/detail/{ocrView.ts, ocrView.test.ts, OcrBlock.tsx, ContentEditor.tsx},
src/views/settings/{AiSection.tsx, aiPatch.ts, aiPatch.test.ts}

typecheck и npm test проходят.
