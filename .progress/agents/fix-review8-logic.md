# fix-review8-logic

Задача: исправления группы «logic» по ревью этапа 8 (9 находок).

Статус: готово. `npm run typecheck` и `npm test` проходят: 89 файлов, 2651 тест. Rust не трогал.

## Что сделано

1. «Очистить» у PDF со слоем больше не превращает его в скан. Новое поле `Item.ocrClearedAt` (types.ts).
   Добавлен `repo.clearOcrText(id, at?)`: удаляет ocrText и ставит ocrAt = ocrClearedAt. Отметку снимают
   setOcrText и setVisionText, в том числе с пустым текстом: это новый результат. isScanPdf не считает сканом
   запись с ocrClearedAt без ocrVisionAt; needsVision при ocrClearedAt возвращает false. actClearOcrText и
   actSaveOcrText с пустым текстом вызывают clearOcrText. Экспорт и импорт переносят поле (sanitizeItem — только
   при fileId и без текста); при слиянии отметка идёт вместе с победившим текстом (withNewerOcr).
2. ИИ выключили и снова включили, либо сменился хост: в `db/settings.setSettings` отсчёт aiAutoOcrSince
   сдвигается на «сейчас». Условие: автораспознавание стало действовать (aiAutoOcr && visionAvailability === null)
   или изменился aiHostLabel. Чтение и запись идут в одной транзакции. Явно переданный aiAutoOcrSince не меняется.
   setSetting теперь вызывает setSettings.
3. Импорт: новое поле `Item.ocrAutoSkipAt`, isVisionBacklog его исключает. Новые записи из копии (без локальной
   версии), которым нужно распознавание (needsVision), получают отметку. Если победила версия из копии, локальная
   отметка сохраняется. Из копии поле не читается и в экспорт не выгружается. Выбран вариант A: локальный задел
   сохраняется.
4. ai.ts: 400/415/422 с признаками ошибки изображения (IMAGE_REJECTED) дают VisionError('item'). VISION_REJECTED
   сужен. 408 считается transient. Непонятные 400/422 остаются config, но с флагом `unknown`. ocr.visionFailure для
   фона при unknown добавляет запись в autoSkip и увеличивает failStreak; остановка по config наступает только
   после VISION_AUTO_FAIL_STREAK таких ошибок подряд.
5. Сбой doc.page(n), кроме прерывания, стал VisionError('item'), запись получает отметку ocrVisionAt.
6. Длинные скриншоты: visionImage.planVisionTiles. Картинку, у которой длинная сторона больше короткой
   в VISION_TILE_RATIO = 3 раза, режем на полосы ≤ 2000 с перекрытием 80, не больше 5 полос. PreparedImage
   получил статус 'tiles'. RasterBackend.encode принимает необязательный source. ocr.ts отправляет каждую
   полосу отдельным запросом, проверяет предел сеанса заранее и склеивает тексты.
7. «Отменить» (cancel задачи) добавляет запись в autoSkip и пишет `repo.markVisionAutoSkip` (ocrAutoSkipAt).
   Задача завершается только после этой записи. Прерывание сигналом или resetOcrSession не помечает запись.
8. Временный отказ openPdfPages в фоне добавляет запись в autoSkip (failStreak не растёт). Предел времени
   открытия для зрения теперь PDF_OPEN_TIMEOUT_MS = PDF_TIMEOUT_MS (30 с), как у текстового слоя.
9. Мелочи: redirect: 'error' в обоих fetch к ИИ; message.refusal даёт VisionError('item'); блоки <think> убираются;
   ограду снимаем, только если внутри нет другой ограды; после паузы (429 или серия ошибок) задел разбирается по
   таймеру (только после startVisionAuto); drainVisionBacklog выбирает по индексу where('createdAt').aboveOrEqual(since).

## Не сделано (решает основная сессия или другие группы)
- ocrView.ts (UI): очищенный PDF без ocrVisionAt показывать как «Извлечь текст» с network: null.
- AiSection.tsx (UI): текст «Пока ИИ-помощник выключен, ничего не отправляется» уточнить.
- Предел 100 за сеанс, снятие config-остановки по времени, несколько вкладок, пустой повторный ответ,
  нехватка памяти при декодировании: эти пункты меняют спецификацию, они в skipped отчёта.
- spec-stage8.md и CLAUDE.proposed.md поправить под пункты 1–7 (Р3, Р8, таблица ошибок, ocrClearedAt/ocrAutoSkipAt).

## Изменённые файлы
src/types.ts, src/db/repo.ts, src/db/settings.ts, src/lib/ocrState.ts, src/lib/ocr.ts, src/lib/ai.ts,
src/lib/actions.ts, src/lib/exportImport.ts, src/lib/visionImage.ts, src/lib/pdfRender.ts;
тесты: src/db/repo.test.ts, src/lib/ocrState.test.ts, src/lib/ocr.test.ts, src/lib/ai.test.ts,
src/lib/actions.test.ts, src/lib/exportImport.test.ts, src/lib/visionImage.test.ts, src/lib/pdfRender.test.ts.
