# fix-review3-views

Статус: готово

Задача: в пиксельных сценах блоки секций настроек слипались (pixel:gap-0 рассчитан только на Row/Field).

Исправлено (вариант A из находки):
- Section.tsx: обёртка детей `pixel:gap-0` -> `pixel:gap-2`.
- Section.tsx: Field `pixel:py-2` -> `pixel:pt-2`; Row `pixel:py-2` -> `pixel:pt-2`.
- AppearanceSection.tsx: блок «Живой фон» `pixel:py-2` -> `pixel:pt-2`.
Между Row/Field: 8 (gap) + линия 2px + 8 (pt), как в мокапе; между прочими блоками ровно 8px. «Классика» не затронута (gap-3).

Не делалось: необязательный `pixel:border-t-0` для Field в ShortcutsSection (линия уже отделена зазором 8px).
Проверки: typecheck чист, 1242 теста зелёные. Визуально не проверялось (браузер запрещён).

Изменённые файлы: src/views/settings/Section.tsx, src/views/settings/AppearanceSection.tsx
