# stage3-triage

Задача: перенос TriageMode.tsx в пиксельный стиль (spec-stage3 §2.4, §4.4).
Статус: готово

## Результат
Применены все правки таблицы §2.4: pixel:border-b-2 шапки, трек прогресса pixel:h-2 bg-paper-line, pixel:font-semibold у заголовка, pixel:border-2 у картинки ссылки, pixel:border-t-2 у блока организации и нижней панели, px-chip у подсказки заголовка ИИ, кружок итогов + Icon pixelSize=48, h2 итогов font-heading text-2xl в П.
Классика: у h2 итогов оставлен font-medium (рецепт с font-semibold изменил бы вес). font-heading в Классике = Geist, как и body.

## Изменённые файлы
- src/components/items/TriageMode.tsx

## Нужно в pixel.css
нет

## Не проверено
- Скриншоты не снимались (таймаут), окно браузера имело ширину 0/320: проверено только по вычисленным стилям.
- 390px, шрифты ft-soft/ft-pixel, Луг/Бумага/Зима, сценарии клавиш и ИИ глазами/вручную не проверены.
