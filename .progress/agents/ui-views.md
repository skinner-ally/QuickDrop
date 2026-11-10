# ui-views
Статус: готово
Результат: ItemsView, Library/Favorites/ArchiveView, FilterBar, CommandPalette. tsc чист, кроме отсутствующих чужих модулей (EmptyState, ItemList).
Файлы: src/views/{ItemsView,LibraryView,FavoritesView,ArchiveView}.tsx, src/components/items/FilterBar.tsx, src/components/palette/CommandPalette.tsx
Допущения: EmptyState({icon: LucideIcon, title, description, action?: ReactNode}); ItemList({hits, variant, layout}).
