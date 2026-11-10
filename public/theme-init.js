// Тема до загрузки бандла: иначе тёмная тема на холодном старте сначала рисуется светлой.
// Логика совпадает с src/components/layout/ThemeProvider.tsx (ключ qd-theme: system | light | dark).
// Отдельный файл, а не inline-скрипт: CSP веб-сборки и Tauri (script-src 'self') inline запрещает.
;(function () {
  var theme = null
  try {
    theme = localStorage.getItem('qd-theme')
  } catch (e) {
    // хранилище недоступно (приватный режим) — берём системную тему
  }
  var dark =
    theme === 'dark' ||
    (theme !== 'light' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
  var root = document.documentElement
  if (dark) root.classList.add('dark')
  root.style.colorScheme = dark ? 'dark' : 'light'
})()
