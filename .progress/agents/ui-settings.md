# ui-settings
Задача: раздел «Настройки» (src/views/SettingsView.tsx + src/views/settings/*.tsx)
Статус: готово (npx tsc -b без ошибок в этих файлах)
Файлы: src/views/SettingsView.tsx, src/views/settings/{Section,AppearanceSection,CategoriesSection,TagsSection,LinksSection,AiSection,ShortcutsSection,DataSection,AboutSection}.tsx
Отклонения: якорное оглавление не делалось (необязательно); тема переключается только через setSetting('theme') — применение к next-themes ожидается в ThemeProvider (AppShell).
