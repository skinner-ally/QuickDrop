# stage3-settings

Задача: пакет «settings» этапа 3 (перенос экрана настроек в пиксельный стиль, «Классика» без изменений).
Статус: готово

## Результат
- Section: `px-panel-thin pixel:gap-1.5 pixel:[--px-pad:10px]` (без последнего отступ 8px наследовался от `main`), h2 без font-heading, приглушённый в П; Row/Field: `px-divider pixel:py-2`.
- SettingsView: поля и ширина 720px в П, h1 `pixel:text-2xl`.
- Segmented: `px-btn pixel:h-7.5`, группа без фона в П. Строка «Живой фон» — свой flex вместо Row (чтобы не удвоить px-divider).
- Категории/теги/клавиши: `px-well pixel:divide-y-2`; образцы цвета `px-sw`, выбранный цвет `px-sel`; Stat — `px-well`.
- DataSection: отчёт импорта показывает «положений на графе» и «сохранённых поисков» при > 0.

## Файлы
src/views/SettingsView.tsx, src/views/settings/{Section,AppearanceSection,CategoriesSection,TagsSection,ShortcutsSection,DataSection,AiSection,LinksSection}.tsx

## Нужно в pixel.css
Ничего.

## Не проверено
Скриншоты снять не удалось (панель браузера не отображалась), кроме одного кадра «Осень» 1280. Остальное — по DOM и вычисленным стилям.
