# HANDOFF — состояние основной сессии

Обновлено: 2026-11-10

## Текущий этап
Этап 2 (интерфейс) — workflow `quickdrop-ui`.

## Сделано
- Этап 0 (551f09b) и этап 1 (ядро) закоммичены. Ядро: 432 теста зелёные, typecheck и build проходят.
  Ревью ядра: 22 находки, исправлены (см. .progress/agents/fix-core-review.md).
- Дизайн-токены (src/index.css), разделы «Дизайн», «Уточнения по ядру», «Контракты UI» в CLAUDE.md.
- Справка по Tauri/PWA: .progress/agents/docs-platform.md.

## В работе прямо сейчас
Workflow этапа 2: фаза A — примитивы и actions (sonnet); фаза B — оболочка, быстрое добавление, списки+входящие,
детали, разделы+палитра, настройки (6 агентов sonnet параллельно); проверка (haiku) / починка (opus); ревью (fable) / правки (sonnet).
Статусы — в .progress/agents/ui-*.md.

## Следующий шаг
После workflow: проверка в браузере основной сессией (npm run dev), ревью, коммит «Этап 2».
Затем этап 3 (Tauri 2 + PWA + CI) и этап 4 (финальное ревью).

## Известные проблемы
- TypeScript 7: `baseUrl` удалён, используем только `paths`.
- shadcn стиль base-nova построен на Base UI, а не Radix (API отличается: `render` вместо `asChild`).
- macOS-сборку Tauri нельзя собрать на Windows — будет GitHub Actions.
