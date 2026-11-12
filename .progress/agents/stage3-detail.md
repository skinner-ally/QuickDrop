# stage3-detail

Задача: пакет «detail» этапа 3 — панель деталей записи в пиксельном стиле (spec-stage3 §2.5, §4.5), «Классика» без изменений.

Статус: готово

## Результат
- ItemDetail.tsx: шапка (gap/border-b-2), квадратные кнопки (px-btn pixel:size-7.5), TypeSwitch (px-btn px-btn-ghost), метка статуса (px-chip), тело, Meta (border-t-2); убран устаревший pixel:text-inherit у звезды.
- detail/ContentEditor.tsx: просмотр при !mono — px-well. detail/LinkCard.tsx: карточка px-well, скелет без пульсации, картинка border-b-2.
- detail/FileBlock.tsx: data-skin="none" у DialogContent лайтбокса. detail/LinkedItems.tsx: заголовки и li px-nav. detail/AiSuggest.tsx: px-well у «Кратко» и блока результата, h3.

## Изменённые файлы
src/components/items/ItemDetail.tsx; src/components/items/detail/{AiSuggest,ContentEditor,FileBlock,LinkCard,LinkedItems}.tsx

## Нужно в pixel.css
Ничего.

## Не проверено
- ИИ-блок (AiSuggest) и скелет карточки ссылки глазами не видел (нет ключа ИИ / нет сети); проверены только по коду.
- Классика на 390px сверена не снимком, а рассуждением (px-*/pixel:* действуют только под .pixel); снимок до правок — на 1280 день/ночь.
