// Тема, сцена и шрифт до загрузки бандла: иначе холодный старт рисуется в чужом оформлении.
// Логика совпадает с src/lib/scene.ts и ThemeProvider (ключи qd-theme, qd-scene, qd-font).
// Отдельный файл, а не inline-скрипт: CSP веб-сборки и Tauri (script-src 'self') inline запрещает.
;(function () {
  function read(key) {
    try {
      return localStorage.getItem(key)
    } catch (e) {
      return null // хранилище недоступно (приватный режим) — значения по умолчанию
    }
  }
  var theme = read('qd-theme')
  var scene = read('qd-scene')
  var font = read('qd-font')
  var dark =
    theme === 'dark' ||
    (theme !== 'light' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
  if (['meadow', 'autumn', 'paper', 'winter', 'classic'].indexOf(scene) < 0) {
    var m = new Date().getMonth() // 'auto', пусто или мусор — по календарю
    scene = m === 11 || m < 2 ? 'winter' : m >= 8 ? 'autumn' : 'meadow'
  }
  if (['round', 'plain', 'soft', 'pixel'].indexOf(font) < 0) font = 'round'
  var root = document.documentElement
  root.classList.add('sc-' + scene, 'ft-' + font)
  if (scene !== 'classic') root.classList.add('pixel')
  if (dark) root.classList.add('dark')
  root.style.colorScheme = dark ? 'dark' : 'light'
  // theme-color до React: иначе панель браузера красится цветом «Классики». Таблица = THEME_COLOR в scene.ts
  var colors = {
    classic: ['#FBFAF8', '#1a1816'],
    meadow: ['#4a2e1a', '#14111d'],
    autumn: ['#4a2416', '#170f18'],
    paper: ['#5a4630', '#0f0f16'],
    winter: ['#3a3440', '#0e1220'],
  }
  var metas = document.querySelectorAll('meta[name="theme-color"]')
  var meta = metas[0]
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'theme-color'
    document.head.appendChild(meta)
  }
  for (var i = 1; i < metas.length; i++) metas[i].remove()
  meta.removeAttribute('media')
  meta.content = colors[scene][dark ? 1 : 0]
})()
