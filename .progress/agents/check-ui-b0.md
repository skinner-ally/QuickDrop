# check-ui-b0 — результат проверки (<корень проекта>)

Дата: 2026-11-10T16:43 (+03:00). Ничего не исправлялось.

| Шаг | Команда | Результат |
|---|---|---|
| typecheck | `npm run typecheck` (`tsc -b`) | PASS, ошибок нет |
| test | `npm test` (`vitest run`) | PASS: 10/10 файлов, 432/432 тестов |
| build | `npm run build` (`tsc -b && vite build`) | PASS, сборка прошла; предупреждение о размере чанка `index-*.js` 939 kB (>500 kB), не ошибка |
| lint (справочно) | `npx oxlint src` | 0 ошибок, 31 предупреждение |

## Предупреждения oxlint (справочно, на ok не влияют)

- src/views/settings/LinksSection.tsx:8:17 react(only-export-components)
- src/components/ui/tabs.tsx:81:52 react(only-export-components)
- src/views/settings/Section.tsx:60:17 react(only-export-components)
- src/views/settings/Section.tsx:88:5 react(set-state-in-effect)
- src/components/ui/button.tsx:57:18 react(only-export-components)
- src/components/layout/ThemeProvider.tsx:14:14 react(refs)
- src/components/layout/ThemeProvider.tsx:16:11 react(refs)
- src/components/items/TypeIcon.tsx:5:14 react(only-export-components)
- src/components/ui/badge.tsx:51:17 react(only-export-components)
- src/components/layout/AppShell.tsx:26:17 react(only-export-components)
- src/components/items/CategoryBadge.tsx:17:14 react(only-export-components)
- src/hooks/useItems.ts:150:5 react(set-state-in-effect)
- src/components/items/FilePreview.tsx:56:19 react(set-state-in-effect)
- src/components/items/FilePreview.tsx:84:5 react(set-state-in-effect)
- src/components/items/FilePreview.tsx:118:10 react(static-components)
- src/components/items/FilePreview.tsx:127:10 react(static-components)
- src/components/items/ItemMenu.tsx:51:17 react(only-export-components)
- src/components/items/CodeView.tsx:110:17 react(only-export-components)
- src/components/items/CodeView.tsx:123:24 oxc(bad-match-all-arg)
- src/components/items/ItemCard.tsx:63:19 react(set-state-in-effect)
- src/components/palette/CommandPalette.tsx:132:85 react-hooks(exhaustive-deps)
- src/components/items/TriageMode.tsx:134:11 react(refs)
- src/components/items/TriageMode.tsx:343:11 react(refs)
- src/components/items/TriageMode.tsx:296:5 react(set-state-in-effect)
- src/components/items/TriageMode.tsx:325:45 react(set-state-in-effect)
- src/components/items/ItemList.tsx:345:17 react(purity)
- src/components/items/ItemList.tsx:101:9 react(refs)
- src/components/items/ItemList.tsx:104:19 react(set-state-in-effect)
- src/components/capture/QuickCapture.tsx:99:5 react(set-state-in-effect)
- src/components/capture/QuickCapture.tsx:196:5 react(set-state-in-effect)
- src/components/capture/QuickCapture.tsx:223:7 react(set-state-in-effect)

## Итог

ok = true: typecheck, test и build прошли. Lint дал 0 ошибок и 31 предупреждение (справочно).
