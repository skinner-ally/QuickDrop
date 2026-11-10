# HANDOFF — состояние основной сессии

Обновлено: 2026-11-10

## Текущий этап
Этап 1 (ядро) — запускается workflow `quickdrop-core`.

## Сделано
- Этап 0: каркас Vite/React/TS, Tailwind v4, shadcn (base-nova) + 19 компонентов, зависимости.
- `src/types.ts`, `src/db/db.ts`, `src/store/ui.ts`, `src/lib/platform.ts`.
- `CLAUDE.md` с контрактами всех модулей.

## В работе прямо сейчас
Workflow этапа 1: агенты пишут repo, settings, search, detect, linkMeta, exportImport, seed, hooks.
Статусы агентов — в `.progress/agents/*.md`.

## Следующий шаг
После завершения workflow: ревью (fable), `npm run typecheck && npm test && npm run build`, коммит «Этап 1».
Затем workflow этапа 2 (UI).

## Известные проблемы
- TypeScript 7: `baseUrl` удалён, используем только `paths`.
- shadcn стиль base-nova построен на Base UI, а не Radix (API отличается: `render` вместо `asChild`).
- macOS-сборку Tauri нельзя собрать на Windows — будет GitHub Actions.
