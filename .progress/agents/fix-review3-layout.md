# fix-review3-layout
Статус: готово
Исправлено: Sidebar nav (pixel:-m-1 pixel:p-1, запас под обводку фокуса); MobileNav FAB (calc(1rem+env) в пиксельных сценах); AppShell лист деталей md (6px+env по трём краям); spec-stage3 §2.1 строка nav.
Не сделано (чужие файлы): FilterBar.tsx:300 pixel:md:px-0.5 -> pixel:md:-mx-1 pixel:md:px-1; BulkBar.tsx:55 добавить pixel:pb-0; @property --px-pad в pixel.css не делали.
Файлы: src/components/layout/{Sidebar,MobileNav,AppShell}.tsx, .progress/spec-stage3.md
