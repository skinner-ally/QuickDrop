# core-repo

**Задача:** реализовать `src/db/repo.ts`, `src/db/settings.ts` по контракту CLAUDE.md + тесты `src/db/repo.test.ts` (vitest + fake-indexeddb).

**Статус:** готово

## Результат
- `npx vitest run src/db/repo.test.ts` — 35/35 тестов прошли.
- `npx tsc -b` — без ошибок (на момент проверки во всём проекте), oxlint по моим файлам — чисто.
- Все сигнатуры контракта соблюдены; `deleteItem` возвращает `Promise<DeletedSnapshot>`.

## Дополнительные экспорты
- repo: `DeletedSnapshot`, `THUMB_MAX`, `normalizeTags`, `makeThumb`, `deleteItems(ids)` → `DeletedSnapshot[]`,
  `restoreItems(snapshots)`, `setFavorite(ids, bool)`.
- settings: `mergeSettings(records)`, `setSettings(patch)`.

## Поведение, важное для UI/других модулей
- `deleteItem` бросает `Error`, если записи нет (для пакетного удаления — `deleteItems`, он пропускает отсутствующие).
- `restoreItem` возвращает запись с исходными createdAt/updatedAt (отмена «как будто ничего не было»); связи — только с существующими записями; если категория за это время удалена — `categoryId = null`.
- Удаление записи бампает `updatedAt` у записей, из `links` которых она убрана.
- `thumb` отсутствует, если картинка ≤ 480px, SVG, или нет `createImageBitmap` — UI должен показывать `blob`.
- `matchesFilter`: `favorite`/`untagged` фильтруют только при `true` (как галочки); пустые `status: []`/`types: []` — без ограничения; теги фильтра нормализуются.
- `sortItems('title')`: Intl.Collator('ru', numeric), записи без заголовка — в конце.
- `createCategory`: пустое имя → `Error`; имя-дубль (без учёта регистра) → возвращает существующую категорию.
- `setStatus`: no-op для записей, уже имеющих этот статус; при выходе из archive `prevStatus` удаляется.
- `getSettings`: игнорирует чужие ключи meta и значения неверного типа.

## Изменённые файлы
- `src/db/repo.ts` (новый)
- `src/db/settings.ts` (новый)
- `src/db/repo.test.ts` (новый)
- `.progress/agents/core-repo.md`
