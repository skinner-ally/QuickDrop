# ui-shell

Задача: оболочка приложения (App, main, layout/*, useHotkeys, useMediaQuery, index.html meta).
Статус: готово (npx tsc -b: в моих файлах ошибок нет; остались «module not found» для чужих ItemDetail, InboxView и др.)
Файлы: src/App.tsx, src/main.tsx, src/components/layout/{AppShell,Sidebar,TopBar,MobileNav,ThemeProvider}.tsx,
src/hooks/{useHotkeys,useMediaQuery}.ts, index.html (viewport-fit=cover, description, theme-color).
Доп. экспорты: AppShell.applyInitialHash (вызывается из main.tsx), useMediaQuery.useIsDesktop.
