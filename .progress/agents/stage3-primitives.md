# stage3-primitives

Задача: пакет primitives этапа 3 (spec-stage3 §2.7, §4.7) — перенос TagChip, TagInput, CategoryBadge/CategoryDot, CategorySelect, CodeView, FilePreview, Highlighted в пиксельный стиль.

Статус: готово

## Результат
- TagChip: `px-chip`, `data-on`, `pixel:h-auto pixel:min-h-6 pixel:leading-tight`.
- TagInput: `px-field` на обёртке; список `px-pop`, отступ `pixel:mt-2/mb-2`; пункты `px-nav`.
- CategoryDot: `px-sw pixel:size-2.5`. BadgeView: фон через `--cat-bg` (`as CSSProperties`) + `bg-(--cat-bg)`, в П прозрачный, без отступов, min-h.
- CodeView: корень `px-well`, кнопка `px-btn`, ключевые слова `pixel:text-brand-lo pixel:dark:text-brand-hi`.
- FilePreview: `px-well` на контейнере файла и pre; скелет `pixel:animate-none`; картинка `pixel:transition-none`; значок полного вида `pixelSize={32}`.
- CategorySelect, Highlighted: без правок (вид проверен).

## Изменённые файлы
src/components/items/TagChip.tsx, TagInput.tsx, CategoryBadge.tsx, CodeView.tsx, FilePreview.tsx

## Нужно в pixel.css
Ничего.

## Не проверено
- Скриншоты не снимались (панель браузера не отрисовывалась, таймаут): проверка только по DOM и вычисленным стилям.
- «Классика»: сверка вычисленных стилей до/после по элементам чипов, плашек категории, кода, кнопки «Копировать» — высоты, цвета, радиусы, фоны совпали; ширины отличаются из-за момента загрузки шрифта. Классика ночью до/после отдельно не сверялась.
- Мобильный 390px проверен только на отсутствие переполнения внутри листа деталей.
- Тест «раскрытие вверх» TagInput, клавиши Tab/Backspace/Enter, PDF и архив не прогонялись.
