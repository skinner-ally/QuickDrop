# fix-ui-review-shell
Все 13 находок подтверждены по коду. Исправлено: useHotkeys (overlayOpen, drop capture, internal drag), ThemeProvider (ref + theme-color), index.css (16px вне layer, reduced-motion), MobileNav (FAB при выделении), AppShell (breakpoint 1100, модальный лист, safe-area, pb под FAB), Sidebar (счётчики library), новый ui/kbd.tsx (Sidebar, TopBar).
Не сделано (чужие файлы): Kbd в TriageMode, CommandPalette, ShortcutsSection, InboxView, QuickCapture; safe-area L/R в полноэкранных диалогах (QuickCapture, TriageMode).
tsc -b: чисто.
