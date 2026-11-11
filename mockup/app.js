// Мокап нового визуала QuickDrop: граф записей нодами на «грядках»-категориях.
// Данные вымышленные, ничего не сохраняется. Эффекты — pixelfx (см. ./pixelfx/LICENSE).
import { createFrame, clearFrame, createFx, composite, painterFor, hex } from './pixelfx/core/index.js'
import { createForest } from './forest.js'
import * as butterfly from './pixelfx/fx/critters/butterfly.js'
import * as bloom from './pixelfx/fx/nature/healing-bloom.js'
import * as burst from './pixelfx/fx/pickups/collect-burst.js'
import { drawLeaves, drawRays } from './weather.js'

const $ = (s) => document.querySelector(s)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// ---------- иконки: карты пикселей → SVG из прямоугольников ----------
const PAL = { k: '#3b2616', w: '#fff4d6', y: '#f2c14e', g: '#3f7a3a', G: '#86c84e', b: '#7fb2e0', r: '#d2603a', n: '#8a5a30', N: '#c08a4e', s: '#b9b3a6', d: '#2b2f3a', '#': 'currentColor' }
function svg(rows) {
  const w = rows[0].length
  let s = ''
  rows.forEach((r, y) => {
    for (let x = 0; x < w; x++) {
      const c = r[x]
      if (c === '.') continue
      let x2 = x
      while (x2 + 1 < w && r[x2 + 1] === c) x2++
      s += `<rect x="${x}" y="${y}" width="${x2 - x + 1}" height="1" fill="${PAL[c]}"/>`
      x = x2
    }
  })
  return `<svg viewBox="0 0 ${w} ${rows.length}" shape-rendering="crispEdges">${s}</svg>`
}
const TYPE_IC = {
  text: ['.kkkkkk...', '.kwwwwkk..', '.kwwwwwk..', '.kwnnwwk..', '.kwwwwwk..', '.kwnnnwk..', '.kwwwwwk..', '.kwnnnwk..', '.kwwwwwk..', '.kkkkkkk..'],
  link: ['..........', '....kkkkk.', '...kbbbbbk', '...kbkkkbk', '.kkkbk.kbk', 'kbbkbbbbbk', 'kbkkkkkkk.', 'kbk.kbk...', 'kbbbbbk...', '.kkkkk....'],
  code: ['kkkkkkkkkk', 'kssssssssk', 'kkkkkkkkkk', 'kddddddddk', 'kdGddddddk', 'kddGdddddk', 'kdGddGGGdk', 'kddddddddk', 'kkkkkkkkkk', '..........'],
  idea: ['..........', '.gg...gg..', 'gGGg.gGGg.', 'gGGGgGGGg.', '.gGGGGGg..', '..ggGgg...', '....G.....', '....G.....', '.nnnGnnn..', '..nnnnn...'],
  file: ['..........', '.kkkkkkkk.', 'kNNNNNNNNk', 'knnnnnnnnk', 'kkkkyykkkk', 'kNNNyyNNNk', 'kNNNNNNNNk', 'knnnnnnnnk', '.kkkkkkkk.', '..........'],
  image: ['kkkkkkkkkk', 'kbbbbbbyyk', 'kbbbbbbyyk', 'kbbbgbbbbk', 'kbbgGgbbbk', 'kbgGGGgbgk', 'kgGGGGGgGk', 'kGGGGGGGGk', 'kkkkkkkkkk', '..........'],
}
const UI_IC = {
  sprout: TYPE_IC.idea,
  inbox: ['...##...', '...##...', '.######.', '..####..', '#..##..#', '#......#', '########', '########'],
  book: ['#######.', '##....#.', '##....#.', '##....#.', '##....#.', '#######.', '#.....#.', '#######.'],
  star: ['...#....', '...#....', '..###...', '#######.', '.#####..', '..###...', '.##.##..', '.#...#..'],
  graph: ['###.....', '###.....', '.#......', '.#######', '.#...###', '.#...###', '###.....', '###.....'],
  sun: ['..#..#..', '........', '#.####.#', '..####..', '..####..', '#.####.#', '........', '..#..#..'],
  moon: ['..####..', '.###....', '###.....', '###.....', '###.....', '###....#', '.######.', '..####..'],
  gear: ['..#..#..', '.######.', '###..###', '.#....#.', '.#....#.', '###..###', '.######.', '..#..#..'],
  search: ['.####...', '#....#..', '#....#..', '#....#..', '.####...', '.....#..', '......#.', '.......#'],
  archive: ['########', '#......#', '########', '.#....#.', '.#.##.#.', '.#....#.', '.#....#.', '.######.'],
  trash: ['..####..', '########', '.#....#.', '.#.##.#.', '.#.##.#.', '.#.##.#.', '.#....#.', '.######.'],
  menu: ['########', '########', '........', '########', '########', '........', '########', '########'],
  plus: ['...##...', '...##...', '...##...', '########', '########', '...##...', '...##...', '...##...'],
}
const ic = (name, cls = '') => `<span class="ic ${cls}">${svg(UI_IC[name] ?? TYPE_IC[name])}</span>`
const paintIcons = (root = document) => root.querySelectorAll('.ic[data-ic]').forEach((el) => (el.innerHTML = svg(UI_IC[el.dataset.ic])))

// ---------- демоданные ----------
const TYPE = { text: 'Текст', link: 'Ссылка', code: 'Код', idea: 'Идея', file: 'Файл', image: 'Изображение' }
const cats = [
  { id: 'work', name: 'Работа', color: '#5b8bd0' },
  { id: 'ideas', name: 'Идеи', color: '#e2a83a' },
  { id: 'read', name: 'Чтение', color: '#63a35c' },
  { id: 'home', name: 'Дом', color: '#d9739a' },
]
const NO_CAT = '#a7a294'
const I = (id, type, title, content, tags, cat, x, y, fav = 0, when = 'вчера') => ({ id, type, title, content, tags, cat, x, y, fav, when, status: cat ? 'library' : 'inbox' })
const items = [
  I('n1', 'link', 'vite.dev/guide', 'https://vite.dev/guide', [], null, 70, 110, 0, '5 мин назад'),
  I('n2', 'text', 'Позвонить насчёт лицензий', 'Уточнить сроки продления и количество рабочих мест.', [], null, 70, 194, 0, '20 мин назад'),
  I('n3', 'code', 'const id = crypto.randomUUID()', "const id = crypto.randomUUID()\n// по HTTP недоступно — нужен запасной вариант", [], null, 70, 278, 0, 'час назад'),
  I('n4', 'idea', 'Быстрый ввод голосом', 'Зажал клавишу — надиктовал — запись во «Входящих».', [], null, 70, 362, 0, 'сегодня'),

  I('w1', 'text', 'Регламент обмена 1С и iiko', 'Что выгружаем, как часто и кто отвечает за сверку остатков.', ['1с', 'iiko'], 'work', 620, 110, 1),
  I('w2', 'code', 'Скрипт выгрузки номенклатуры', 'Запрос.Текст = "ВЫБРАТЬ Ссылка, Артикул\n  ИЗ Справочник.Номенклатура";', ['1с', 'код'], 'work', 470, 194),
  I('w3', 'file', 'Договор с поставщиком.pdf', 'PDF, 412 КБ. Приложение 2 — график поставок.', ['договоры'], 'work', 780, 194),
  I('w4', 'link', 'Tauri: глобальные клавиши', 'https://tauri.app/plugin/global-shortcut/', ['tauri', 'код'], 'work', 470, 278),
  I('w5', 'image', 'Скан акта сверки', 'PNG, 1,2 МБ. Октябрь.', ['договоры'], 'work', 780, 278),

  I('i1', 'idea', 'QuickDrop: граф заметок', 'Показывать связи между записями — как в Obsidian, но со своим характером.', ['quickdrop'], 'ideas', 1250, 110, 1),
  I('i2', 'idea', 'Ноды как в Houdini', 'Запись — нода: вход сверху, выход снизу, флаги по бокам, подпись рядом.', ['quickdrop', 'дизайн'], 'ideas', 1120, 194),
  I('i3', 'idea', 'Пиксельный интерфейс', 'Дерево, бумага, грядки. Категория — грядка, запись — то, что на ней растёт.', ['quickdrop', 'дизайн'], 'ideas', 1420, 194),
  I('i4', 'image', 'Референсы: уютные фермы', 'Подборка скриншотов: рамки, шрифты, палитры дня и ночи.', ['дизайн'], 'ideas', 1250, 290),

  I('r1', 'link', 'Как устроен Zettelkasten', 'https://zettelkasten.de/introduction/', ['заметки'], 'read', 620, 490, 1),
  I('r2', 'text', 'Конспект: связывать, а не сортировать', 'Ценность заметки — в связях с другими, а не в папке, где она лежит.', ['заметки'], 'read', 470, 574),
  I('r3', 'text', 'Цитата про входящие', '«Сначала поймай мысль. Разложишь потом».', ['заметки', 'цитаты'], 'read', 780, 574),
  I('r4', 'link', 'Obsidian: обзор графа', 'https://help.obsidian.md/plugins/graph', ['заметки', 'quickdrop'], 'read', 620, 658),

  I('h1', 'text', 'Рецепт: тыквенный суп', 'Тыква, морковь, имбирь, сливки. Запечь, пробить блендером.', ['рецепты'], 'home', 1250, 490),
  I('h2', 'text', 'Список покупок', 'Тыква 1 кг · сливки 20% · имбирь · семечки', ['рецепты'], 'home', 1120, 574),
  I('h3', 'image', 'Фото грядок, октябрь', 'JPG, 3,4 МБ.', ['огород'], 'home', 1420, 574),
  I('h4', 'idea', 'Когда сажать чеснок', 'За 3–4 недели до устойчивых заморозков.', ['огород'], 'home', 1250, 658, 1),
]
const links = [
  ['w1', 'w2'], ['w1', 'w3'], ['w2', 'w4'], ['w3', 'w5'],
  ['i1', 'i2'], ['i1', 'i3'], ['i2', 'i4'], ['i3', 'i4'],
  ['r1', 'r2'], ['r1', 'r3'], ['r2', 'r4'], ['r4', 'i1'], ['w4', 'i1'], ['r2', 'i2'],
  ['h1', 'h2'], ['h3', 'h4'],
]
// Архивные записи лежат отдельно: на графе их нет, связи снимаются до возврата
const archived = []
const byId = (id) => items.find((i) => i.id === id) ?? archived.find((i) => i.id === id)
// «Без грядки» — запись в базе знаний без категории; у «Входящих» категория null
const NONE = { id: 'none', name: 'Без грядки', color: NO_CAT }
const cat = (id) => (id === 'none' ? NONE : cats.find((c) => c.id === id))
const catColor = (id) => cat(id)?.color ?? NO_CAT
const nb = (id) => new Set(links.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : [])))

// ---------- состояние ----------
// Нода-карточка: заголовок внутри; отступы грядки вокруг нод
const NODE_W = 200, NODE_H = 44, PAD = { padL: 18, padR: 16, padB: 24 }
const ZOOMS = [0.5, 0.75, 1, 2]
const view = { z: 1, px: 20, py: 30 }
const narrow = matchMedia('(max-width: 767px)')
// на телефоне детали — лист на весь экран, поэтому при запуске ничего не выбрано
let selId = narrow.matches ? null : 'w1', hoverId = null, q = '', tagF = null, mode = 'graph'
const typeF = new Set()
let drag = null, rects = []

const graph = $('#graph'), detail = $('#detail'), listEl = $('#list')
const plotsEl = $('#plots'), nodesEl = $('#nodes'), forestEl = $('#forest')
// лес за грядками: достраивается по мере сдвига, ему нужна видимая часть мира
const forest = createForest(forestEl, () => ({
  x0: -view.px / view.z, y0: -view.py / view.z,
  x1: (graph.clientWidth - view.px) / view.z, y1: (graph.clientHeight - view.py) / view.z,
}))

// ---------- отрисовка ----------
function plotRects(ex) {
  const out = []
  for (const c of [{ id: null, name: 'Входящие' }, ...cats, NONE]) {
    const ms = items.filter((i) => i.cat === c.id && i !== ex)
    if (!ms.length) continue
    const x0 = Math.min(...ms.map((i) => i.x)) - PAD.padL, y0 = Math.min(...ms.map((i) => i.y)) - 36
    const x1 = Math.max(...ms.map((i) => i.x)) + NODE_W + PAD.padR, y1 = Math.max(...ms.map((i) => i.y)) + NODE_H + PAD.padB
    out.push({ cat: c, x: x0, y: y0, w: x1 - x0, h: y1 - y0, n: ms.length })
  }
  return out
}
function layoutPlots(ex) {
  rects = plotRects(ex)
  plotsEl.innerHTML = rects
    .map((r) => `<div class="plot ${r.cat.id === null ? 'inbox' : r.cat.id === 'none' ? 'none' : ''}" data-cat="${r.cat.id ?? ''}" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px">
      <div class="sign">${r.cat.id === 'none' ? ic('book') : r.cat.id ? `<i class="sw" style="background:${r.cat.color}"></i>` : ic('inbox')}${esc(r.cat.name)} <small>${r.n}</small></div></div>`)
    .join('')
  forest.setObstacles(rects)
}
function renderWorld() {
  nodesEl.innerHTML = items
    .map((it) => `<div class="node" data-id="${it.id}" title="${esc(it.title)}" style="left:${it.x}px;top:${it.y}px">
      <div class="pin in"></div>
      <div class="body" style="--c:${catColor(it.cat)}"><span class="flag fav ${it.fav ? 'on' : ''}"></span><span class="core"><span class="ic t">${svg(TYPE_IC[it.type])}</span><span class="in"><b>${esc(it.title)}</b><i>${TYPE[it.type].toLowerCase()}${it.tags.length ? ' · ' + it.tags.map((t) => '#' + t).join(' ') : ''}</i></span></span><span class="flag st ${it.status}"></span></div>
      <div class="pin out" title="Потяните к другой ноде, чтобы связать"></div></div>`)
    .join('')
  layoutPlots()
  refresh()
}
const passes = (it) =>
  (!q || (it.title + ' ' + it.content + ' ' + it.tags.join(' ')).toLowerCase().includes(q)) &&
  (!typeF.size || typeF.has(it.type)) && (!tagF || it.tags.includes(tagF))
const isDim = (it) => !passes(it) || (hoverId && it.id !== hoverId && !nb(hoverId).has(it.id))
function refresh() {
  nodesEl.querySelectorAll('.node').forEach((el) => {
    const it = byId(el.dataset.id)
    el.classList.toggle('sel', it.id === selId)
    el.classList.toggle('dim', !!isDim(it))
    el.classList.toggle('hot', it.id === hoverId)
  })
}
function renderSide() {
  $('#c-inbox').textContent = items.filter((i) => i.status === 'inbox').length
  $('#c-library').textContent = items.filter((i) => i.status === 'library').length
  $('#c-fav').textContent = items.filter((i) => i.fav).length
  $('#c-archive').textContent = archived.length
  $('#cats').innerHTML = cats
    .map((c) => `<div class="cat" data-cat="${c.id}"><i class="sw" style="background:${c.color}"></i>${c.name}<em class="count">${items.filter((i) => i.cat === c.id).length}</em></div>`)
    .join('')
  const tags = [...new Set(items.flatMap((i) => i.tags))].sort()
  $('#tags').innerHTML = tags.map((t) => `<span class="chip ${t === tagF ? 'on' : ''}" data-tag="${t}">#${t}</span>`).join('')
  $('#types').innerHTML = Object.keys(TYPE)
    .map((t) => `<button class="btn sq ${typeF.has(t) ? 'on' : ''}" data-type="${t}" title="${TYPE[t]}">${ic(t)}</button>`)
    .join('')
}
function renderDetail() {
  const it = byId(selId)
  detail.hidden = !it
  $('#stage').classList.toggle('has-detail', !!it)
  if (!it) return
  const ns = [...nb(it.id)].map(byId), arch = it.status === 'archive'
  const st = { inbox: 'не разобрано', library: 'в базе знаний', archive: 'в архиве' }[it.status]
  detail.innerHTML = `
    <div class="head">${ic(it.type)}<h3>${esc(it.title)}</h3><button class="btn sq" data-act="close" title="Закрыть (Esc)">×</button></div>
    <div class="meta">${TYPE[it.type]} · ${st} · ${it.when}</div>
    <div class="content ${it.type === 'code' ? 'code' : ''}">${esc(it.content)}</div>
    ${arch ? '' : `<h4>Грядка</h4>
    <div class="chips">${[...cats, NONE].map((c) => `<span class="chip ${c.id === it.cat ? 'on' : ''}" data-setcat="${c.id}"><i class="sw" style="background:${c.color}"></i>${c.name}</span>`).join('')}</div>`}
    ${it.tags.length ? `<h4>Теги</h4><div class="chips">${it.tags.map((t) => `<span class="chip" data-tag="${t}">#${t}</span>`).join('')}</div>` : ''}
    ${arch ? '' : `<h4>Связи · ${ns.length}</h4>
    <div class="links">${ns.map((n) => `<a data-go="${n.id}">${ic(n.type)}<span>${esc(n.title)}</span><button class="x" data-unlink="${n.id}" title="Убрать связь">×</button></a>`).join('') || '<span class="hint">Потяните от нижнего разъёма ноды к другой записи.</span>'}</div>`}
    <div class="acts">
      ${arch ? `<button class="btn" data-act="restore">${ic('inbox')}Вернуть</button>` : `
      <button class="btn ${it.fav ? 'on' : ''}" data-act="fav">${ic('star')}Избранное</button>
      ${mode !== 'graph' ? `<button class="btn" data-act="show">${ic('graph')}В графе</button>` : ''}
      ${it.cat ? `<button class="btn" data-act="inbox">${ic('inbox')}Во входящие</button>` : ''}
      <button class="btn" data-act="archive">${ic('archive')}В архив</button>`}
      <button class="btn sq" data-act="delete" title="Удалить (Del)">${ic('trash')}</button>
    </div>`
}

// ---------- списки разделов ----------
const LIST = { inbox: 'Входящие', library: 'База знаний', fav: 'Избранное', archive: 'Архив' }
const EMPTY = {
  inbox: ['Входящие разобраны', 'Новые записи появятся здесь. Нажмите N, чтобы добавить.'],
  library: ['На грядках пока пусто', 'Разберите входящие — записи переедут сюда.'],
  fav: ['Избранного пока нет', 'Отметьте запись клавишей F.'],
  archive: ['В архиве пусто', 'Сюда попадает то, что убрано с глаз, но не удалено.'],
}
let curId = null, pickId = null
function listRows() {
  const src = mode === 'archive' ? archived : items.filter((i) => (mode === 'fav' ? i.fav : i.status === mode))
  return src.filter(passes)
}
function rowHtml(it) {
  const arch = it.status === 'archive'
  const b = (act, icon, title, on) => `<button class="btn sq ${on ? 'on' : ''}" data-ract="${act}" title="${title}">${ic(icon)}</button>`
  return `<div class="rowi ${it.id === curId ? 'cur' : ''}" data-id="${it.id}">
    <span class="rflag fav ${it.fav ? 'on' : ''}"></span>
    <div class="rbody" style="--c:${catColor(it.cat)}">${ic(it.type)}
      <div class="tx"><b>${esc(it.title)}</b><p>${esc(it.content)}</p>
        ${it.tags.length ? `<div class="chips">${it.tags.map((t) => `<span class="chip">#${t}</span>`).join('')}</div>` : ''}
        ${it.id === pickId ? `<div class="rpick"><span class="hint">Куда?</span>${[...cats, NONE].map((c, n) => `<span class="chip ${c.id === it.cat ? 'on' : ''}" data-rcat="${c.id}"><i class="sw" style="background:${c.color}"></i>${c === NONE ? 0 : n + 1} · ${c.name}</span>`).join('')}</div>` : ''}</div>
      <div class="rmeta">${it.cat && it.cat !== 'none' ? `<span class="cat-tag"><i class="sw" style="background:${catColor(it.cat)}"></i>${cat(it.cat).name}</span>` : ''}<span>${it.when}</span></div>
      <div class="racts">${arch
        ? b('restore', 'inbox', 'Вернуть из архива') + b('delete', 'trash', 'Удалить (Del)')
        : b('pick', 'book', it.cat ? 'Пересадить на другую грядку (E)' : 'В базу знаний (E)') + b('fav', 'star', 'Избранное (F)', it.fav) + b('archive', 'archive', 'В архив (A)') + b('delete', 'trash', 'Удалить (Del)')}</div>
    </div>
    <span class="rflag st ${it.status}"></span></div>`
}
function renderList() {
  const rows = listRows()
  if (!rows.some((r) => r.id === curId)) curId = null
  if (!rows.some((r) => r.id === pickId)) pickId = null
  const keys = mode === 'archive' ? 'J/K — выбор · Enter — открыть · Del — удалить' : 'J/K — выбор · E — в базу знаний · F — избранное · A — архив'
  listEl.innerHTML = `<div class="lhead"><h3>${LIST[mode]}</h3><span class="count">${rows.length}</span><span class="hint">${keys}</span></div>` +
    (rows.map(rowHtml).join('') || `<div class="empty">${ic('sprout')}<b>${EMPTY[mode][0]}</b><span class="hint">${EMPTY[mode][1]}</span></div>`)
  listEl.querySelector('.rowi.cur')?.scrollIntoView({ block: 'nearest' })
}
function renderAll() {
  renderWorld(); renderSide(); renderDetail()
  if (LIST[mode]) renderList()
}
function setMode(m) {
  mode = m
  pickId = null
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === m))
  $('#settings-btn').classList.toggle('on', m === 'settings')
  graph.hidden = m !== 'graph'
  listEl.hidden = !LIST[m]
  $('#settings').hidden = m !== 'settings'
  $('#zoom').style.visibility = m === 'graph' ? '' : 'hidden'
  if (m === 'settings') selId = null
  renderDetail()
  if (LIST[m]) renderList()
  else if (m === 'graph') { resize(); refresh() }
}

// ---------- архив, удаление, отмена ----------
const linksOf = (id) => links.filter(([a, b]) => a === id || b === id)
const dropLinks = (cut) => cut.forEach((l) => links.splice(links.indexOf(l), 1))
const live = (id) => items.some((i) => i.id === id)
function forget(it) {
  if (selId === it.id) selId = null
  renderAll()
}
function doArchive(it) {
  const k = items.indexOf(it)
  if (k < 0) return
  it.cutLinks = linksOf(it.id)
  dropLinks(it.cutLinks)
  items.splice(k, 1)
  it.prev = it.status
  it.status = 'archive'
  archived.push(it)
  forget(it)
  toast('Убрано в архив', () => doRestore(it))
}
function doRestore(it) {
  const k = archived.indexOf(it)
  if (k < 0) return
  archived.splice(k, 1)
  it.status = it.prev ?? (it.cat ? 'library' : 'inbox')
  items.push(it)
  links.push(...(it.cutLinks ?? []).filter((l) => l.every(live)))
  renderAll()
  toast('Возвращено из архива')
}
function doDelete(it) {
  const src = items.includes(it) ? items : archived, k = src.indexOf(it)
  if (k < 0) return
  const cut = linksOf(it.id)
  dropLinks(cut)
  src.splice(k, 1)
  forget(it)
  toast('Удалено', () => {
    src.splice(Math.min(k, src.length), 0, it)
    if (src === items) links.push(...cut.filter((l) => l.every(live)))
    renderAll()
  })
}
function rowAct(act, it) {
  if (act === 'pick') { pickId = pickId === it.id ? null : it.id; curId = it.id; renderList(); return }
  if (act === 'fav') { it.fav = it.fav ? 0 : 1; renderAll(); return }
  const i = listRows().indexOf(it)
  if (act === 'archive') doArchive(it)
  else if (act === 'restore') doRestore(it)
  else if (act === 'delete') doDelete(it)
  const after = listRows()
  curId = after[Math.min(Math.max(i, 0), after.length - 1)]?.id ?? null
  renderList()
}

let toastT
function toast(msg, undo) {
  const t = $('#toast')
  t.innerHTML = `<span>${esc(msg)}</span>` + (undo ? '<button class="btn" id="undo">Отменить</button>' : '')
  if (undo) $('#undo').onclick = () => { t.hidden = true; undo() }
  t.hidden = false
  clearTimeout(toastT)
  toastT = setTimeout(() => (t.hidden = true), undo ? 5000 : 2200)
}

// ---------- вид: сдвиг и масштаб ----------
const even = (v) => Math.round(v / 2) * 2
function applyView() {
  view.px = even(view.px); view.py = even(view.py)
  forestEl.style.transform = plotsEl.style.transform = nodesEl.style.transform = `translate(${view.px}px,${view.py}px) scale(${view.z})`
  graph.style.backgroundSize = `${256 * view.z}px`
  graph.style.backgroundPosition = `${view.px}px ${view.py}px`
  graph.classList.toggle('z05', view.z <= 0.5)
  $('#zl').textContent = view.z * 100 + '%'
}
function zoomTo(z, mx = graph.clientWidth / 2, my = graph.clientHeight / 2) {
  const wx = (mx - view.px) / view.z, wy = (my - view.py) / view.z
  view.z = z
  view.px = mx - wx * z; view.py = my - wy * z
  applyView()
}
function centerOn(wx, wy) {
  const free = graph.clientWidth - (detail.hidden || graph.clientWidth < 700 ? 0 : 320)
  view.px = free / 2 - wx * view.z; view.py = graph.clientHeight / 2 - wy * view.z
  applyView()
}
function fitAll() {
  const x0 = Math.min(...rects.map((r) => r.x)), y0 = Math.min(...rects.map((r) => r.y))
  const x1 = Math.max(...rects.map((r) => r.x + r.w)), y1 = Math.max(...rects.map((r) => r.y + r.h))
  view.z = 0.5
  centerOn((x0 + x1) / 2, (y0 + y1) / 2)
}


// ---------- автораскладка ----------
// Внутри грядки — дерево по связям (корень — самая связанная запись), одиночки — столбиком;
// грядки — в две колонки справа от «Входящих». Связи между грядками на раскладку не влияют.
function computeLayout() {
  const SLOT = NODE_W + 24, ROW = 84, blocks = []
  for (const c of [null, ...cats.map((k) => k.id), 'none']) {
    const ms = items.filter((i) => i.cat === c)
    if (!ms.length) continue
    const ids = new Set(ms.map((i) => i.id)), adj = new Map(ms.map((i) => [i.id, []]))
    for (const [a, b] of links) if (ids.has(a) && ids.has(b)) { adj.get(a).push(b); adj.get(b).push(a) }
    const seen = new Set(), local = new Map(), singles = []
    let cx = 0
    const order = [...ms].sort((a, b) => adj.get(b.id).length - adj.get(a.id).length || a.y - b.y || a.x - b.x)
    for (const root of order) {
      if (seen.has(root.id)) continue
      seen.add(root.id)
      if (!adj.get(root.id).length) { singles.push(root); continue }
      const kids = new Map(), depth = new Map([[root.id, 0]]), q = [root.id]
      while (q.length) {
        const u = q.shift()
        kids.set(u, [])
        for (const v of adj.get(u)) if (!seen.has(v)) { seen.add(v); depth.set(v, depth.get(u) + 1); kids.get(u).push(v); q.push(v) }
        kids.get(u).sort((a, b) => byId(a).x - byId(b).x)
      }
      const place = (u) => {
        const xs = kids.get(u).map(place)
        const x = xs.length ? (xs[0] + xs[xs.length - 1]) / 2 : (cx += SLOT) - SLOT
        local.set(u, { x, y: depth.get(u) * ROW })
        return x
      }
      place(root.id)
    }
    singles.sort((a, b) => a.y - b.y).forEach((it, k) => local.set(it.id, { x: cx, y: k * ROW }))
    if (singles.length) cx += SLOT
    blocks.push({ cat: c, local, w: cx - 24, h: Math.max(...[...local.values()].map((p) => p.y)) + NODE_H })
  }
  const pos = new Map(), GAPX = PAD.padL + PAD.padR + 40, GAPY = 36 + PAD.padB + 44
  const put = (b, ox, oy) => b.local.forEach((p, id) => pos.set(id, { x: even(ox + p.x), y: even(oy + p.y) }))
  const inbox = blocks.find((b) => b.cat === null), rest = blocks.filter((b) => b.cat !== null)
  let x0 = 70, y = 110
  if (inbox) { put(inbox, x0, y); x0 += inbox.w + GAPX }
  const col0 = Math.max(0, ...rest.filter((_, i) => i % 2 === 0).map((b) => b.w))
  for (let r = 0; r < rest.length; r += 2) {
    const row = rest.slice(r, r + 2)
    row.forEach((b, i) => put(b, x0 + (i ? col0 + GAPX : 0), y))
    y += Math.max(...row.map((b) => b.h)) + GAPY
  }
  return pos
}
function tidy() {
  const to = computeLayout(), from = new Map(items.map((i) => [i.id, { x: i.x, y: i.y }])), t0 = performance.now()
  const step = (now) => {
    const k = still ? 1 : Math.min(1, (now - t0) / 280), e = 1 - (1 - k) ** 3
    for (const it of items) {
      const a = from.get(it.id), b = to.get(it.id)
      it.x = even(a.x + (b.x - a.x) * e); it.y = even(a.y + (b.y - a.y) * e)
    }
    renderWorld()
    if (k < 1) requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

// ---------- действия ----------
const GOLD = ['#2a1a05', '#5a3a0a', '#8a5a10', '#c8901e', '#f2c14e', '#ffe08a', '#fff4c8', '#ffffff']
function select(id, fx = true) {
  selId = id
  renderDetail(); refresh()
  const it = byId(id)
  if (it && fx) spawn(burst, it.x + NODE_W / 2, it.y + NODE_H, { palette: GOLD, light: 0.6 })
}
function assign(it, catId, reposition) {
  if (reposition) {
    const ms = items.filter((i) => i.cat === catId && i !== it)
    it.x = ms.length ? Math.min(...ms.map((i) => i.x)) : 70
    it.y = ms.length ? Math.max(...ms.map((i) => i.y)) + 84 : catId ? Math.max(...items.map((i) => i.y)) + 150 : 110
  }
  it.cat = catId
  it.status = catId ? 'library' : 'inbox'
  renderAll()
  spawn(burst, it.x + NODE_W / 2, it.y + NODE_H, { palette: GOLD })
  toast(catId === 'none' ? 'Перенесено в базу знаний без грядки' : catId ? `Посажено на грядку «${cat(catId).name}»` : 'Возвращено во «Входящие»')
}
function addItem(raw) {
  const text = raw.trim()
  if (!text) return
  const type = /^https?:\/\/\S+$/i.test(text) ? 'link' : /[;{}]|=>|^\s*(const|let|function|import)\b/m.test(text) ? 'code' : /^идея/i.test(text) ? 'idea' : 'text'
  const inbox = items.filter((i) => !i.cat)
  const it = I('u' + Date.now(), type, text.split('\n')[0].slice(0, 60), text, [], null, 70, inbox.length ? Math.max(...inbox.map((i) => i.y)) + 84 : 110, 0, 'только что')
  items.push(it)
  setMode('graph')
  selId = it.id
  renderAll()
  centerOn(it.x + 150, it.y)
  nodesEl.querySelector(`[data-id="${it.id}"]`)?.classList.add('pop')
  spawn(bloom, it.x + NODE_W / 2, it.y + 2, {})
  toast('Посажено во «Входящие»')
}

// ---------- провода: растровые «верёвки» от выхода к входу ----------
const wc = $('#wires'), wctx = wc.getContext('2d')
let colors = {}
function readColors() {
  const cs = getComputedStyle(document.body)
  for (const k of ['rope-a', 'rope-b', 'rope-edge', 'gold']) colors[k] = cs.getPropertyValue('--' + k).trim()
}
function wirePoints(x0, y0, x1, y1, cell) {
  const d = y1 > y0 + 16 ? Math.max(14, (y1 - y0) * 0.5) : 30 + Math.abs(x1 - x0) * 0.2
  const n = Math.max(10, Math.ceil((Math.abs(x1 - x0) + Math.abs(y1 - y0)) / 3))
  const pts = []
  let lx, ly
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t
    const x = Math.round((u * u * u * x0 + 3 * u * u * t * x0 + 3 * u * t * t * x1 + t * t * t * x1) / cell)
    const y = Math.round((u * u * u * y0 + 3 * u * u * t * (y0 + d) + 3 * u * t * t * (y1 - d) + t * t * t * y1) / cell)
    if (i === 0) { pts.push([x, y]); lx = x; ly = y; continue }
    // Брезенхэм между соседними отсчётами — линия без разрывов и без сглаживания
    const dx = Math.abs(x - lx), dy = -Math.abs(y - ly), sx = lx < x ? 1 : -1, sy = ly < y ? 1 : -1
    let e = dx + dy
    while (lx !== x || ly !== y) {
      const e2 = 2 * e
      if (e2 >= dy) { e += dy; lx += sx }
      if (e2 <= dx) { e += dx; ly += sy }
      pts.push([lx, ly])
    }
  }
  return pts
}
function drawWires(time) {
  const z = view.z, cell = Math.max(1, Math.round(2 * z))
  const W = Math.ceil(graph.clientWidth / cell), H = Math.ceil(graph.clientHeight / cell)
  if (wc.width !== W || wc.height !== H) { wc.width = W; wc.height = H }
  wctx.clearRect(0, 0, W, H)
  const sx = (wx) => wx * z + view.px, sy = (wy) => wy * z + view.py
  const wires = links.map(([a, b]) => {
    const A = byId(a), B = byId(b), top = A.y <= B.y ? A : B, bot = top === A ? B : A
    const hot = [hoverId, selId].some((f) => f && (f === a || f === b))
    const dim = !passes(A) || !passes(B) || (hoverId && hoverId !== a && hoverId !== b)
    return { hot, dim, cross: A.cat !== B.cat, pts: wirePoints(sx(top.x + NODE_W / 2), sy(top.y + NODE_H + 6), sx(bot.x + NODE_W / 2), sy(bot.y - 6), cell) }
  })
  if (drag?.kind === 'wire') wires.push({ hot: true, dim: false, pts: wirePoints(sx(drag.it.x + NODE_W / 2), sy(drag.it.y + NODE_H + 6), drag.mx, drag.my, cell) })
  wires.sort((a, b) => a.hot - b.hot)
  const phase = Math.floor(time / 90)
  for (const w of wires) {
    wctx.globalAlpha = w.dim ? 0.25 : 1
    wctx.fillStyle = colors['rope-edge']
    // связь между грядками — пунктиром, чтобы деревья внутри грядок читались первыми
    const gap = (i) => w.cross && !w.hot && i % 8 >= 5
    w.pts.forEach(([x, y], i) => { if (!gap(i)) wctx.fillRect(x - 1, y - 1, 3, 3) })
    w.pts.forEach(([x, y], i) => {
      if (gap(i)) return
      wctx.fillStyle = w.hot ? ((i - phase) & 7) < 3 ? '#fffbe6' : colors.gold : (i >> 1) & 1 ? colors['rope-a'] : colors['rope-b']
      wctx.fillRect(x, y, 1, 1)
    })
  }
  wctx.globalAlpha = 1
}

// ---------- слой эффектов pixelfx ----------
const fxc = $('#fx'), fctx = fxc.getContext('2d')
const still = matchMedia('(prefers-reduced-motion: reduce)').matches
let frame, img, fxs = [], fxOk = true, ambientOn = true
function spawn(mod, wx, wy, opts) {
  if (still || !fxOk || mode !== 'graph') return
  fxs.push({ fx: createFx(mod, opts), wx, wy })
}
const ambient = still ? [] : [
  { fx: createFx(butterfly, { seed: 3 }), wx: 420, wy: 420, ph: 0 },
  { fx: createFx(butterfly, { seed: 9, palette: ['#2a1206', '#6a2a0c', '#b2501a', '#e8862a', '#ffc15a', '#ffe9a8', '#ffffff'] }), wx: 1080, wy: 60, ph: 2 },
]
const FLY = [hex('#9ad02a'), hex('#d6ff5a'), hex('#f4ffb8')]
function drawFx(time, dt) {
  if (!frame) return
  const night = document.body.classList.contains('night'), t = time / 1000
  clearFrame(frame)
  const fx2 = (wx) => Math.round((wx * view.z + view.px) / 2), fy2 = (wy) => Math.round((wy * view.z + view.py) / 2)
  const run = (e, wx = e.wx, wy = e.wy) => {
    e.fx.options.x = fx2(wx); e.fx.options.y = fy2(wy)
    e.fx.update(dt)
    e.fx.draw(frame)
  }
  const sc = SCENES[scene]
  // верхний слой пуст — не гоняем сведение кадра впустую
  const busy = fxs.length || (!still && ambientOn && (sc.snow || (night && sc.flies) || (!night && sc.butterflies && view.z >= 0.75)))
  if (!busy) {
    if (fxDirty) { fctx.clearRect(0, 0, fxc.width, fxc.height); fxDirty = false }
    return
  }
  fxDirty = true
  if (!still && ambientOn && (sc.snow || (night && sc.flies))) {
    const p = painterFor(frame)
    p.place(0, 0); p.fade = 1; p.lightK = 1; p.layer = 'front'
    if (sc.snow) {
      for (let i = 0; i < 46; i++) {
        const y = (i * 53 + t * (10 + (i % 7) * 3)) % frame.h, x = (i * 97 + 8 * Math.sin(t * 0.6 + i)) % frame.w
        p.dot(x, y, SNOW, i % 3 ? 0.9 : 0.55)
        if (i % 5 === 0) p.dot(x + 1, y, SNOW, 0.9)
      }
    } else {
      for (let i = 0; i < 18; i++) {
        const bx = 60 + ((i * 397) % 1700), by = 40 + ((i * 211) % 720)
        const x = fx2(bx + 46 * Math.sin(t * 0.31 + i * 1.7)), y = fy2(by + 30 * Math.sin(t * 0.43 + i * 2.3))
        const u = (t / (3 + (i % 4)) + i * 0.37) % 1, g = u < 0.08 ? u / 0.08 : u < 0.2 ? 1 : u < 0.5 ? 1 - (u - 0.2) / 0.3 : 0
        if (g < 0.06) continue
        p.px(x, y, g > 0.6 ? FLY[2] : FLY[1])
        p.glow(x, y, 8, FLY[0], 0.5 * g)
        p.glow(x, y, 3, FLY[2], 0.5 * g)
      }
    }
  }
  // бабочки рисуются в размере экрана: на общем плане они были бы крупнее нод
  if (ambientOn && !night && sc.butterflies && view.z >= 0.75) for (const e of ambient) run(e, e.wx + 160 * Math.sin(t * 0.07 + e.ph), e.wy + 90 * Math.sin(t * 0.05 + e.ph * 2))
  fxs = fxs.filter((e) => (run(e), !e.fx.done()))
  composite(frame, img.data, null)
  fctx.putImageData(img, 0, 0)
}
// Погода: листопад — под нодами (карточки остаются читаемыми), лучи — поверх всего, но реже по кадрам
const wxc = $('#wx'), wxctx = wxc.getContext('2d'), raysC = $('#rays'), raysCtx = raysC.getContext('2d')
let wxFrame, wxImg, raysImg, raysAt = 0, wxDirty = false, raysDirty = false, fxDirty = true
function drawWeather(time) {
  if (!wxFrame) return
  const night = document.body.classList.contains('night'), sc = SCENES[scene], on = !still && ambientOn
  if (on && sc.leaves) {
    clearFrame(wxFrame)
    const p = painterFor(wxFrame)
    p.place(0, 0); p.fade = 1; p.lightK = 1; p.layer = 'front'
    drawLeaves(p, time / 1000, wxFrame.w, wxFrame.h, night)
    composite(wxFrame, wxImg.data, null)
    wxctx.putImageData(wxImg, 0, 0)
    wxDirty = true
  } else if (wxDirty) { wxctx.clearRect(0, 0, wxc.width, wxc.height); wxDirty = false }
  if (on && sc.rays && !night) {
    if (time - raysAt > 80) {
      raysAt = time
      drawRays(raysImg, time / 1000)
      raysCtx.putImageData(raysImg, 0, 0)
      raysDirty = true
    }
  } else if (raysDirty) { raysCtx.clearRect(0, 0, raysC.width, raysC.height); raysDirty = false }
}
function resize() {
  const W = Math.max(1, Math.ceil(graph.clientWidth / 2)), H = Math.max(1, Math.ceil(graph.clientHeight / 2))
  fxc.width = wxc.width = raysC.width = W
  fxc.height = wxc.height = raysC.height = H
  frame = createFrame(W, H)
  img = new ImageData(W, H)
  wxFrame = createFrame(W, H)
  wxImg = new ImageData(W, H)
  raysImg = new ImageData(W, H)
  raysAt = 0
}
let last = 0
function loop(time) {
  const dt = Math.min(0.05, (time - last) / 1000)
  last = time
  if (mode === 'graph') {
    drawWires(time)
    forest.update(scene !== 'paper')
    if (fxOk) try { drawWeather(time); drawFx(time, dt) } catch (e) { fxOk = false; console.error('pixelfx', e) }
  }
  requestAnimationFrame(loop)
}

// ---------- сцены: палитра и фон холста ----------
const SNOW = hex('#ffffff')
const SCENES = {
  meadow: { name: 'Луг', butterflies: true, flies: true, rays: true,
    day: { kind: 'grass', base: '#86ab5e', dk: '#74994f', lt: '#98bd6e', dot: '#fff6dc', dot2: '#f2c14e' },
    night: { kind: 'grass', base: '#1f3038', dk: '#18262d', lt: '#283c44', dot: '#4a6470', dot2: '#6c8a94' } },
  autumn: { name: 'Осень', leaves: true, rays: true,
    day: { kind: 'leaves', base: '#c2a55e', dk: '#a98c4a', lt: '#d4ba74', green: '#99a052',
      leaves: ['#b9482a', '#e2812c', '#e8b83a', '#8c3a22'], cap: '#c2452d', stem: '#f6ead0' },
    night: { kind: 'leaves', base: '#2c2132', dk: '#241a29', lt: '#382b3f', green: '#2f3a36',
      leaves: ['#6a3838', '#86563a', '#8a7a3a', '#4a2a2a'], cap: '#7a3440', stem: '#b9a9b0' } },
  paper: { name: 'Бумага',
    day: { kind: 'dots', base: '#eadbb4', dk: '#dccb9e', lt: '#f2e6c6', dot: '#bfa672' },
    night: { kind: 'dots', base: '#23232f', dk: '#1d1d28', lt: '#2a2a38', dot: '#44445c' } },
  winter: { name: 'Зима', snow: true,
    day: { kind: 'snow', base: '#dde7ee', dk: '#c4d2de', lt: '#f5f9fb', dot: '#ffffff', dot2: '#8fa6bc' },
    night: { kind: 'snow', base: '#1c2740', dk: '#172036', lt: '#25334f', dot: '#6c80a8', dot2: '#3a4a70' } },
}
let scene = 'meadow'
function sceneTile(c) {
  const N = 128
  const cv = document.createElement('canvas')
  cv.width = cv.height = N
  const g = cv.getContext('2d')
  g.fillStyle = c.base
  g.fillRect(0, 0, N, N)
  let s = 11
  const r = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const at = (m = N - 4) => [(r() * m) | 0, (r() * m) | 0]
  const px = (col, x, y, w = 1, h = 1) => { g.fillStyle = col; g.fillRect(x, y, w, h) }
  const tuft = (col) => { const [x, y] = at(); px(col, x, y, 1, 2); px(col, x + 2, y, 1, 2); px(col, x + 1, y + 1, 1, 2) }
  const speck = (col, w = 2) => { const [x, y] = at(N - 2); px(col, x, y, w, 1) }
  if (c.kind === 'dots') {
    for (let i = 0; i < 56; i++) speck(i % 2 ? c.lt : c.dk, 3)
    for (let y = 8; y < N; y += 16) for (let x = 8; x < N; x += 16) px(c.dot, x, y)
    return cv.toDataURL()
  }
  const tufts = { grass: 160, leaves: 44, snow: 20 }[c.kind]
  for (let i = 0; i < tufts; i++) tuft(c.kind === 'snow' ? c.dot2 : c.dk)
  for (let i = 0; i < 104; i++) speck(c.lt)
  if (c.kind === 'snow') {
    for (let i = 0; i < 64; i++) speck(c.dk, 3)
    for (let i = 0; i < 28; i++) px(c.dot, ...at())
  } else if (c.kind === 'grass') {
    for (let i = 0; i < 12; i++) {
      const [x, y] = at(N - 8).map((v) => v + 2)
      px(c.dot, x - 1, y, 3, 1); px(c.dot, x, y - 1, 1, 3); px(c.dot2, x, y)
    }
  } else {
    // осень: остатки зелёной травы, опавшие листья трёх форм, пара грибов
    for (let i = 0; i < 26; i++) tuft(c.green)
    for (let i = 0; i < 28; i++) {
      const [x, y] = at(N - 8).map((v) => v + 2), col = c.leaves[i % c.leaves.length]
      if (i % 3 === 0) { px(col, x, y, 3, 2); px(col, x + 1, y - 1); px(c.dk, x + 1, y + 2) }
      else if (i % 3 === 1) { px(col, x, y, 2, 2); px(col, x + 2, y + 1); px(c.dk, x - 1, y + 2) }
      else { px(col, x, y, 2, 1); px(col, x + 1, y + 1) }
    }
    for (let i = 0; i < 3; i++) {
      const [x, y] = at(N - 12).map((v) => v + 4)
      px(c.cap, x, y, 5, 2); px(c.cap, x + 1, y - 1, 3, 1); px(c.stem, x + 1, y); px(c.stem, x + 3, y - 1)
      px(c.stem, x + 2, y + 2, 1, 2); px(c.dk, x + 1, y + 4, 3, 1)
    }
  }
  return cv.toDataURL()
}
function applyTheme(night) {
  document.body.classList.toggle('night', night)
  const c = SCENES[scene][night ? 'night' : 'day']
  graph.style.backgroundImage = 'url(' + sceneTile(c) + ')'
  graph.style.backgroundColor = c.base
  $('#theme').innerHTML = ic(night ? 'sun' : 'moon') + (night ? 'День' : 'Ночь')
  document.querySelectorAll('#daynight .btn').forEach((b) => b.classList.toggle('on', (b.dataset.night === '1') === night))
  readColors()
}
// Сцена по времени года; «Бумага» включается только вручную
function seasonScene(d = new Date()) {
  const m = d.getMonth()
  return m === 11 || m < 2 ? 'winter' : m >= 8 ? 'autumn' : 'meadow'
}
let sceneMode = 'auto'
function setScene(s) {
  sceneMode = SCENES[s] ? s : 'auto'
  scene = sceneMode === 'auto' ? seasonScene() : sceneMode
  forest.setTheme(scene)
  document.body.className = document.body.className.replace(/sc-[a-z]+/g, '').trim() + ' sc-' + scene
  const btn = (k, text, title) => '<button class="btn ' + (k === sceneMode ? 'on' : '') + '" data-scene="' + k + '" title="' + title + '">' + text + '</button>'
  $('#scenes').innerHTML = btn('auto', 'Авто', 'По календарю: сейчас «' + SCENES[seasonScene()].name + '»') +
    Object.entries(SCENES).map(([k, o]) => btn(k, o.name, 'Всегда «' + o.name + '»')).join('')
  try { localStorage.setItem('qd-mock-scene2', sceneMode) } catch {}
  applyTheme(document.body.classList.contains('night'))
}

// ---------- шрифт текста ----------
const FONTS = { round: 'Округлый', plain: 'Строгий', soft: 'Мягкий пиксель', pixel: 'Пиксельный' }
function setFont(f) {
  const k = FONTS[f] ? f : 'round'
  document.body.className = document.body.className.replace(/ft-[a-z]+/g, '').trim() + ' ft-' + k
  $('#fonts').innerHTML = Object.entries(FONTS).map(([id, n]) => '<button class="btn ' + (id === k ? 'on' : '') + '" data-font="' + id + '">' + n + '</button>').join('')
  try { localStorage.setItem('qd-mock-font', k) } catch {}
}

// ---------- палитра команд (Ctrl/⌘+K) ----------
const pal = $('#palette'), palQ = $('#pal-q'), palList = $('#pal-list')
let palRows = [], palCur = 0
const fold = (s) => s.toLowerCase().replace(/ё/g, 'е')
function goItem(it) {
  if (it.status === 'archive') { setMode('archive'); curId = selId = it.id; renderDetail(); renderList(); return }
  setMode('graph')
  select(it.id, false)
  centerOn(it.x + NODE_W / 2, it.y + NODE_H / 2)
}
function goPlot(id) {
  setMode('graph')
  const r = rects.find((x) => x.cat.id === id)
  if (r) centerOn(r.x + r.w / 2, r.y + r.h / 2)
  else toast('На этой грядке пока пусто')
}
function palSource() {
  const night = document.body.classList.contains('night')
  const cmd = (icon, title, run, key = '') => ({ group: 'Команды', icon, title, run, key })
  const where = (it) => (it.status === 'archive' ? 'архив' : it.status === 'inbox' ? 'входящие' : cat(it.cat)?.name ?? 'без грядки')
  return [
    cmd('plus', 'Добавить запись', openCap, 'N'),
    cmd('inbox', 'Перейти: Входящие', () => setMode('inbox')),
    cmd('book', 'Перейти: База знаний', () => setMode('library')),
    cmd('star', 'Перейти: Избранное', () => setMode('fav')),
    cmd('archive', 'Перейти: Архив', () => setMode('archive')),
    cmd('graph', 'Перейти: Граф', () => setMode('graph')),
    cmd('gear', 'Настройки', () => setMode('settings')),
    cmd('graph', 'Разложить ноды по связям', () => { setMode('graph'); tidy() }),
    cmd('search', 'Показать весь граф', () => { setMode('graph'); fitAll() }),
    cmd(night ? 'sun' : 'moon', night ? 'Дневная тема' : 'Ночная тема', () => applyTheme(!night)),
    cmd('sprout', 'Сцена: по календарю', () => setScene('auto')),
    ...Object.entries(SCENES).map(([k, o]) => cmd('sprout', 'Сцена: ' + o.name, () => setScene(k))),
    ...cats.map((c) => ({ group: 'Грядки', sw: c.color, title: c.name, sub: items.filter((i) => i.cat === c.id).length + ' зап.', run: () => goPlot(c.id) })),
    ...[...items, ...archived].map((it) => ({ group: 'Записи', icon: it.type, title: it.title, sub: where(it), text: it.content + ' ' + it.tags.join(' '), run: () => goItem(it) })),
    ...[...new Set(items.flatMap((i) => i.tags))].sort().map((t) => ({
      group: 'Теги', icon: 'search', title: '#' + t, sub: t === tagF ? 'снять отбор' : 'отобрать',
      run: () => { tagF = tagF === t ? null : t; renderSide(); refresh(); if (LIST[mode]) renderList() },
    })),
  ]
}
function renderPal() {
  const s = fold(palQ.value.trim()), all = palSource()
  palRows = (s ? all.filter((r) => fold(r.title + ' ' + (r.text ?? '')).includes(s)) : all.filter((r) => r.group === 'Команды')).slice(0, 40)
  palCur = Math.max(0, Math.min(palCur, palRows.length - 1))
  let g = ''
  palList.innerHTML = palRows.map((r, i) => (r.group !== g ? '<div class="pg">' + (g = r.group) + '</div>' : '') +
    '<div class="pr ' + (i === palCur ? 'cur' : '') + '" data-i="' + i + '">' + (r.sw ? '<i class="sw" style="background:' + r.sw + '"></i>' : ic(r.icon)) +
    '<span class="t">' + esc(r.title) + '</span>' + (r.sub ? '<small>' + esc(r.sub) + '</small>' : '') + (r.key ? '<kbd>' + r.key + '</kbd>' : '') + '</div>').join('') ||
    '<div class="empty">' + ic('search') + '<b>Ничего не нашлось</b><span class="hint">Попробуйте другое слово или #тег.</span></div>'
  palList.querySelector('.pr.cur')?.scrollIntoView({ block: 'nearest' })
}
function openPal() { closeMenu(); pal.hidden = false; palQ.value = ''; palCur = 0; renderPal(); palQ.focus() }
function closePal() { pal.hidden = true }
function runPal(i) { const r = palRows[i]; if (!r) return; closePal(); r.run() }
palQ.addEventListener('input', () => { palCur = 0; renderPal() })
palList.addEventListener('click', (e) => { const r = e.target.closest('.pr'); if (r) runPal(+r.dataset.i) })
pal.addEventListener('pointerdown', (e) => { if (e.target === pal) closePal() })
$('#pal-btn').addEventListener('click', openPal)

// ---------- телефон: выезжающее меню, плавающая кнопка, щипок ----------
function closeMenu() { document.body.classList.remove('menu-open') }
$('#menu-btn').addEventListener('click', () => document.body.classList.toggle('menu-open'))
$('#scrim').addEventListener('click', closeMenu)
$('.side').addEventListener('click', (e) => { if (e.target.closest('nav a, .cat, .chip, #settings-btn, #add')) closeMenu() })
const touches = new Map()
let pinch = null
const pinchDist = () => { const [a, b] = [...touches.values()]; return Math.hypot(a.x - b.x, a.y - b.y) }

// ---------- ввод ----------
graph.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('.detail,.legend,.variants')) return
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (touches.size === 2) {
      // второй палец: начатое перетаскивание отменяется, дальше — масштаб щипком
      if (drag) { drag = null; graph.classList.remove('panning'); renderWorld() }
      pinch = { d: pinchDist(), z: view.z }
      return
    }
  }
  const el = e.target.closest('.node[data-id]')
  const base = { sx: e.clientX, sy: e.clientY, moved: false }
  if (el && e.target.closest('.pin.out')) {
    const b = graph.getBoundingClientRect()
    drag = { ...base, kind: 'wire', it: byId(el.dataset.id), mx: e.clientX - b.left, my: e.clientY - b.top }
  } else if (el) {
    const it = byId(el.dataset.id)
    drag = { ...base, kind: 'node', it, el, ox: it.x, oy: it.y, target: null }
  } else {
    drag = { ...base, kind: 'pan', ox: view.px, oy: view.py }
    graph.classList.add('panning')
  }
  graph.setPointerCapture(e.pointerId)
})
graph.addEventListener('pointermove', (e) => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pinch && touches.size === 2) {
    const k = pinchDist() / pinch.d, i = ZOOMS.indexOf(pinch.z) + (k > 1.35 ? 1 : k < 0.74 ? -1 : 0)
    if (ZOOMS[i] && ZOOMS[i] !== view.z) {
      const [a, b] = [...touches.values()], box = graph.getBoundingClientRect()
      zoomTo(ZOOMS[i], (a.x + b.x) / 2 - box.left, (a.y + b.y) / 2 - box.top)
      pinch = { d: pinchDist(), z: view.z }
    }
    return
  }
  if (!drag) return
  const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy
  if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
  if (drag.kind === 'pan') { view.px = drag.ox + dx; view.py = drag.oy + dy; applyView() }
  else if (drag.kind === 'wire') {
    const b = graph.getBoundingClientRect()
    drag.mx = e.clientX - b.left; drag.my = e.clientY - b.top
  } else if (drag.moved) {
    const it = drag.it
    it.x = even(drag.ox + dx / view.z); it.y = even(drag.oy + dy / view.z)
    drag.el.style.left = it.x + 'px'; drag.el.style.top = it.y + 'px'
    drag.el.classList.add('drag')
    layoutPlots(it)
    const cx = it.x + NODE_W / 2, cy = it.y + NODE_H / 2
    drag.target = rects.find((r) => cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) ?? null
    if (drag.target && drag.target.cat.id !== it.cat) plotsEl.querySelector(`[data-cat="${drag.target.cat.id ?? ''}"]`)?.classList.add('drop')
  }
})
graph.addEventListener('pointerup', (e) => {
  touches.delete(e.pointerId)
  if (pinch) { if (touches.size < 2) pinch = null; return }
  const d = drag
  drag = null
  graph.classList.remove('panning')
  if (!d) return
  if (d.kind === 'node') {
    if (!d.moved) select(d.it.id)
    else if (d.target && d.target.cat.id !== d.it.cat) assign(d.it, d.target.cat.id, false)
    else renderWorld()
  } else if (d.kind === 'wire') {
    const to = document.elementFromPoint(e.clientX, e.clientY)?.closest('.node[data-id]')?.dataset.id
    if (to && to !== d.it.id && !nb(d.it.id).has(to)) {
      links.push([d.it.id, to])
      const t = byId(to)
      spawn(burst, t.x + NODE_W / 2, t.y + NODE_H, { palette: GOLD })
      renderDetail()
      toast('Записи связаны')
    }
  } else if (!d.moved && selId) { selId = null; renderDetail(); refresh() }
})
graph.addEventListener('pointercancel', (e) => { touches.delete(e.pointerId); pinch = null; drag = null; graph.classList.remove('panning'); renderWorld() })
nodesEl.addEventListener('pointerover', (e) => {
  const id = e.target.closest('.node')?.dataset.id ?? null
  if (id !== hoverId && !drag) { hoverId = id; refresh() }
})
nodesEl.addEventListener('pointerleave', () => { if (hoverId) { hoverId = null; refresh() } })
graph.addEventListener('wheel', (e) => {
  if (e.target.closest('.detail')) return
  e.preventDefault()
  const i = ZOOMS.indexOf(view.z) + (e.deltaY < 0 ? 1 : -1)
  if (i < 0 || i >= ZOOMS.length) return
  const b = graph.getBoundingClientRect()
  zoomTo(ZOOMS[i], e.clientX - b.left, e.clientY - b.top)
}, { passive: false })

$('#zoom').addEventListener('click', (e) => {
  const z = e.target.closest('[data-z]')
  if (z) { const i = ZOOMS.indexOf(view.z) + +z.dataset.z; if (ZOOMS[i]) zoomTo(ZOOMS[i]) }
  else if (e.target.closest('#fit')) fitAll()
})
detail.addEventListener('click', (e) => {
  const un = e.target.closest('[data-unlink]')?.dataset.unlink
  if (un) {
    const k = links.findIndex(([a, b]) => (a === selId && b === un) || (b === selId && a === un))
    if (k >= 0) links.splice(k, 1)
    renderDetail()
    toast('Связь убрана')
    return
  }
  const it = byId(selId), act = e.target.closest('[data-act]')?.dataset.act
  const go = e.target.closest('[data-go]')?.dataset.go, sc = e.target.closest('[data-setcat]')?.dataset.setcat
  if (act === 'close') { selId = null; renderDetail(); refresh() }
  else if (act === 'fav') { it.fav = it.fav ? 0 : 1; renderAll() }
  else if (act === 'inbox') assign(it, null, true)
  else if (act === 'archive') doArchive(it)
  else if (act === 'restore') doRestore(it)
  else if (act === 'delete') doDelete(it)
  else if (act === 'show') { setMode('graph'); centerOn(it.x + 100, it.y) }
  else if (sc && sc !== it.cat) assign(it, sc, true)
  else if (go) { select(go); if (mode === 'graph') centerOn(byId(go).x + 100, byId(go).y) }
})
listEl.addEventListener('click', (e) => {
  const row = e.target.closest('.rowi')
  if (!row) return
  const it = byId(row.dataset.id), act = e.target.closest('[data-ract]')?.dataset.ract, rc = e.target.closest('[data-rcat]')?.dataset.rcat
  if (rc) { pickId = null; if (rc !== it.cat) assign(it, rc, true); else renderList() }
  else if (act) rowAct(act, it)
  else { curId = it.id; selId = it.id; renderDetail(); renderList() }
})
$('#settings-btn').addEventListener('click', () => setMode(mode === 'settings' ? 'graph' : 'settings'))
$('#daynight').addEventListener('click', (e) => { const b = e.target.closest('[data-night]'); if (b) applyTheme(b.dataset.night === '1') })
$('#ambient').addEventListener('change', (e) => { ambientOn = e.target.checked })
$('#settings').addEventListener('click', (e) => { if (e.target.closest('[data-stub]')) toast('В мокапе не работает') })
$('#nav').addEventListener('click', (e) => { const a = e.target.closest('a'); if (a) setMode(a.dataset.view) })
$('#cats').addEventListener('click', (e) => {
  const r = rects.find((x) => x.cat.id === e.target.closest('.cat')?.dataset.cat)
  if (!r) return
  setMode('graph'); centerOn(r.x + r.w / 2, r.y + r.h / 2)
})
document.addEventListener('click', (e) => {
  const tg = e.target.closest('[data-tag]')
  if (tg) { tagF = tagF === tg.dataset.tag ? null : tg.dataset.tag; renderSide(); refresh(); if (LIST[mode]) renderList() }
  const ty = e.target.closest('[data-type]')
  if (ty) { typeF.has(ty.dataset.type) ? typeF.delete(ty.dataset.type) : typeF.add(ty.dataset.type); renderSide(); refresh(); if (LIST[mode]) renderList() }
})
$('#q').addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); refresh(); if (LIST[mode]) renderList() })
$('#tidy').addEventListener('click', tidy)
$('#fonts').addEventListener('click', (e) => { const b = e.target.closest('[data-font]'); if (b) setFont(b.dataset.font) })
$('#theme').addEventListener('click', () => applyTheme(!document.body.classList.contains('night')))
$('#scenes').addEventListener('click', (e) => { const b = e.target.closest('[data-scene]'); if (b) setScene(b.dataset.scene) })

const cap = $('#capture'), capText = $('#cap-text')
const openCap = () => { cap.hidden = false; capText.value = ''; capText.focus() }
const saveCap = () => { cap.hidden = true; addItem(capText.value) }
$('#add').addEventListener('click', openCap)
$('#fab').addEventListener('click', openCap)
$('#cap-cancel').addEventListener('click', () => (cap.hidden = true))
$('#cap-ok').addEventListener('click', saveCap)
cap.addEventListener('pointerdown', (e) => { if (e.target === cap) cap.hidden = true })
document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName ?? '')
  // e.code — чтобы сочетание работало и в русской раскладке
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') { e.preventDefault(); if (pal.hidden) { cap.hidden = true; openPal() } else closePal(); return }
  if (!pal.hidden) {
    if (e.key === 'Escape') closePal()
    else if (e.key === 'Enter') { e.preventDefault(); runPal(palCur) }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      palCur = (palCur + (e.key === 'ArrowDown' ? 1 : palRows.length - 1)) % Math.max(1, palRows.length)
      renderPal()
    }
    return
  }
  if (e.key === 'Escape') {
    if (!cap.hidden) cap.hidden = true
    else if (document.body.classList.contains('menu-open')) closeMenu()
    else if (typing) document.activeElement.blur()
    else if (selId) { selId = null; renderDetail(); refresh() }
  } else if (!cap.hidden && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveCap()
  else if (!typing && (e.key === 'n' || e.key === 'т' || e.key === 'N' || e.key === 'Т')) { e.preventDefault(); openCap() }
  else if (!typing && e.key === '/') { e.preventDefault(); $('#q').focus() }
  else if (!typing && cap.hidden && LIST[mode] && !e.ctrlKey && !e.metaKey && !e.altKey) {
    // курсор и разбор в списке; русская раскладка — те же клавиши
    const rows = listRows(), i = rows.findIndex((r) => r.id === curId), cur = rows[i], k = e.key.toLowerCase()
    const move = (d) => { e.preventDefault(); pickId = null; curId = rows[Math.max(0, Math.min(rows.length - 1, i + d))]?.id ?? null; renderList() }
    if (k === 'j' || k === 'о' || e.key === 'ArrowDown') move(1)
    else if (k === 'k' || k === 'л' || e.key === 'ArrowUp') move(i < 0 ? 1 : -1)
    else if (!cur) return
    else if (pickId && (e.key === '0' || cats[+e.key - 1])) {
      const c = e.key === '0' ? 'none' : cats[+e.key - 1].id
      pickId = null
      if (c !== cur.cat) assign(cur, c, true)
      else renderList()
    }
    else if (e.key === 'Enter') { selId = cur.id; renderDetail() }
    else if (e.key === 'Delete') rowAct('delete', cur)
    else if (cur.status === 'archive') return
    else if (k === 'e' || k === 'у') rowAct('pick', cur)
    else if (k === 'f' || k === 'а') rowAct('fav', cur)
    else if (k === 'a' || k === 'ф') rowAct('archive', cur)
  }
})
new ResizeObserver(resize).observe(graph)

// ---------- запуск ----------
paintIcons()
let savedScene = 'auto'
try { savedScene = localStorage.getItem('qd-mock-scene2') ?? 'auto' } catch {}
setScene(savedScene)
let savedFont = 'round'
try { savedFont = localStorage.getItem('qd-mock-font') ?? 'round' } catch {}
setFont(savedFont)
renderAll()
applyView()
resize()
requestAnimationFrame(loop)

// для отладки мокапа из консоли: qd.go(x, y, z) — показать точку мира
window.qd = { go: (x, y, z = view.z) => { view.z = z; centerOn(x, y) } }
// qd.bench() — среднее время одного кадра нашей отрисовки, мс (без растеризации браузером)
// qd.rebuild() — мс на достройку леса для целого экрана в новом месте (худший случай сдвига)
window.qd.rebuild = (n = 10) => {
  const keep = { ...view }, t0 = performance.now()
  for (let i = 0; i < n; i++) { view.px = -40000 - i * 9000; view.py = 30000 + i * 7000; forest.update(true) }
  const ms = (performance.now() - t0) / n
  Object.assign(view, keep); forest.update(true)
  return +ms.toFixed(2)
}
window.qd.bench = (n = 30) => {
  const t0 = performance.now()
  for (let i = 0; i < n; i++) {
    const t = performance.now() + i * 16
    drawWires(t); drawWeather(t + i * 100); drawFx(t, 0.016)
  }
  return +((performance.now() - t0) / n).toFixed(2)
}
