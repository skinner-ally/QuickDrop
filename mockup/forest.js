// Бесконечный фон поля: лес с чащами и полянами, кусты, камни, редкие пруды с камышами.
// Мир не хранится: всё вычисляется из координат, поэтому одно и то же место всегда выглядит одинаково.
// Рисуются только квадраты, попавшие на экран. Вся графика своя, процедурная.
// Единицы: «пиксель спрайта» = 2 px мира; квадрат — CH пикселей спрайта.

const CH = 256, PX = 2, WCH = CH * PX // сторона квадрата в пикселях спрайта и в px мира
const SC = CH * 3 // ячейка, в которой может оказаться один пруд

// ---------- случайность по координатам ----------
const h2 = (x, y, s = 0) => {
  let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}
const sm = (t) => t * t * (3 - 2 * t)
const vn = (x, y, s = 0) => {
  const xi = Math.floor(x), yi = Math.floor(y), fx = sm(x - xi), fy = sm(y - yi)
  const a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}
const step = (a, b, v) => (v <= a ? 0 : v >= b ? 1 : sm((v - a) / (b - a)))
// густота леса: крупные пятна чащи и полян плюс мелкая неровность опушек
const density = (gx, gy) => 0.65 * vn(gx / 420, gy / 420, 1) + 0.35 * vn(gx / 150 + 31, gy / 150 + 17, 2)

// ---------- спрайты ----------
const col = (h, a = 1) => {
  const n = parseInt(h.slice(1), 16)
  return ((Math.round(a * 255) << 24) | ((n & 255) << 16) | (((n >> 8) & 255) << 8) | (n >> 16)) >>> 0
}
let SHADOW = col('#3c1c08', 0.22) // задаётся темой перед сборкой спрайтов

function sprite(w, h, o, body) {
  const b = new Uint32Array(w * h)
  const set = (x, y, c) => { x = Math.floor(x); y = Math.floor(y); if (x >= 0 && y >= 0 && x < w && y < h) b[y * w + x] = c }
  body(set)
  const cv = document.createElement('canvas')
  cv.width = w; cv.height = h
  const g = cv.getContext('2d'), img = g.createImageData(w, h), out = new Uint32Array(img.data.buffer)
  if (o.shadow) {
    const [cx, cy, rx, ry] = o.shadow
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) out[y * w + x] = SHADOW
  }
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    if (b[i]) out[i] = b[i]
    else if (o.line && ((x > 0 && b[i - 1]) || (x < w - 1 && b[i + 1]) || (y > 0 && b[i - w]) || (y < h - 1 && b[i + w]))) out[i] = o.line
  }
  g.putImageData(img, 0, 0)
  return { cv, w, h, ax: o.ax ?? w / 2, ay: o.ay ?? h - 1 }
}
const ell = (set, cx, cy, rx, ry, fn) => {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
    const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2
    if (d <= 1) set(x, y, fn(x, y, d))
  }
}
// крона из нескольких шаров: свет слева сверху, у каждого шара своя тень — крона выходит комковатой
function crown(set, circles, tones, seed) {
  let x0 = 99, y0 = 99, x1 = 0, y1 = 0
  for (const [cx, cy, r] of circles) { x0 = Math.min(x0, cx - r); y0 = Math.min(y0, cy - r); x1 = Math.max(x1, cx + r); y1 = Math.max(y1, cy + r) }
  for (let y = Math.floor(y0); y <= y1; y++) for (let x = Math.floor(x0); x <= x1; x++) {
    let best = 0, l = 0
    for (const [cx, cy, r] of circles) {
      const dx = (x + 0.5 - cx) / r, dy = (y + 0.5 - cy) / r, hh = 1 - dx * dx - dy * dy
      if (hh > best) { best = hh; l = 0.5 - 0.36 * (dx + dy) + 0.12 * hh }
    }
    if (best <= 0) continue
    l += (h2((x + ((y >> 1) & 1)) >> 1, y >> 1, seed) - 0.5) * 0.34
    set(x, y, tones[l < 0.3 ? 0 : l < 0.52 ? 1 : l < 0.78 ? 2 : 3])
  }
}

const pal = (line, t) => ({ line: col(line), t: t.map((c) => col(c)) })
const WATER = { deep: '#3f8cb8', mid: '#4c9cc4', lit: '#7cc0dc', bank: '#2f729c', dash: '#9ad6ea', shore: ['#6a4a1c', 0.38] }
// Тема сцены: гаммы листвы и хвои, тень, вода и мелочь на полянах. Расстановка от темы не зависит.
const THEMES = {
  autumn: {
    shadow: ['#3c1c08', 0.22], water: WATER, lily: true, extra: 'pumpkin', reed: ['#4e6e2c', '#7a9a42'],
    leaf: [
      pal('#6e2a0e', ['#a8481a', '#d2691e', '#ee8f2c', '#ffc04a']), // рыжий
      pal('#5e1512', ['#93241c', '#c23a26', '#e2583a', '#f58a5a']), // красный
      pal('#6e4c0c', ['#b07c18', '#d9a520', '#f2c93c', '#ffe884']), // золотой
      pal('#4a123c', ['#7a1e5c', '#a52c78', '#c84a94', '#e67cb4']), // сливовый
    ],
    pine: pal('#12301e', ['#1c4a2c', '#2a6a3a', '#3c8a48', '#62a85a']),
  },
  meadow: {
    shadow: ['#143214', 0.24], water: WATER, lily: true, extra: 'flower', reed: ['#3c7a2c', '#6aa83e'],
    leaf: [
      pal('#1c4a1c', ['#2c6a2a', '#3f8c36', '#5cae48', '#8ccc62']),
      pal('#22502c', ['#327438', '#4a9a4c', '#70bc62', '#a2dc84']),
      pal('#3a5612', ['#56841e', '#78a82c', '#9cc444', '#c8e474']),
      pal('#7a2e52', ['#b85a86', '#dc86aa', '#f2aecb', '#ffd8e6']), // цветущее
    ],
    pine: pal('#102c20', ['#1a4630', '#26623e', '#35804c', '#58a060']),
  },
  winter: {
    shadow: ['#28324a', 0.2], lily: false, extra: 'drift', reed: ['#8a6a3c', '#b08a50'],
    water: { deep: '#a8c6da', mid: '#bcd6e6', lit: '#e6f1f7', bank: '#86a4bc', dash: '#ffffff', shore: ['#5b6f96', 0.3] },
    leaf: [
      pal('#5a6c88', ['#93a8c0', '#bccbdc', '#e2ebf2', '#ffffff']),
      pal('#566a80', ['#8aa2b4', '#b4c8d6', '#dce8ee', '#ffffff']),
      pal('#64708c', ['#a0aac6', '#c6cee0', '#e8ecf4', '#ffffff']),
      pal('#4e6478', ['#7f9aac', '#aac0ce', '#d6e4ea', '#f6fafc']),
    ],
    pine: pal('#12302a', ['#1c4a3a', '#2a6a52', '#d8e6f0', '#ffffff']), // свет слева — снег на лапах
  },
}
const BARK = ['#4a2a14', '#6e4220', '#8a5a2c'].map((c) => col(c))
const CROWNS = [
  [[15, 14, 10], [9, 18, 7], [21, 18, 7], [15, 9, 7]],
  [[15, 13, 9], [10, 11, 6], [20, 12, 7], [13, 20, 7], [20, 19, 5]],
  [[15, 11, 8], [15, 18, 9], [11, 14, 6], [20, 15, 6]],
]

function makeSprites(T) {
  SHADOW = col(...T.shadow)
  const LEAF = T.leaf, PINE = T.pine, snowy = T.extra === 'drift'
  const S = { tree: [], bush: [], pine: [], stone: [], small: [], reed: [], lily: [] }
  LEAF.forEach((p, pi) => {
    S.tree.push(CROWNS.map((cs, v) => sprite(30, 40, { line: p.line, shadow: [15, 36.5, 10, 3], ay: 37 }, (set) => {
      for (let y = 24; y <= 36; y++) for (let x = 13; x <= 16; x++) set(x, y, BARK[x === 13 ? 2 : x === 16 ? 0 : 1])
      set(12, 36, BARK[1]); set(17, 36, BARK[0]); set(12, 35, BARK[2])
      crown(set, cs, p.t, pi * 7 + v)
    })))
    S.bush.push([0, 1].map((v) => sprite(20, 15, { line: p.line, shadow: [10, 12.5, 8, 2.2], ay: 13 }, (set) => {
      crown(set, v ? [[7, 8, 5], [13, 8, 4], [10, 6, 4]] : [[6, 8, 4], [12, 8, 5], [9, 5, 4]], p.t, 40 + pi * 3 + v)
    })))
  })
  for (let v = 0; v < 2; v++) S.pine.push(sprite(20, 38, { line: PINE.line, shadow: [10, 34.5, 6, 2], ay: 35 }, (set) => {
    for (let y = 29; y <= 34; y++) { set(9, y, BARK[2]); set(10, y, BARK[0]) }
    const n = 3 + v, hh = v ? 10 : 12
    for (let i = 0; i < n; i++) {
      const ay = 2 + i * (v ? 6 : 7), hw = 3.6 + i * (v ? 1.7 : 2.2)
      for (let y = 0; y < hh; y++) {
        const w = ((y + 1) / hh) * hw
        for (let x = Math.ceil(10 - w); x < 10 + w; x++) {
          const rel = (x + 0.5 - 10) / w
          let tn = rel < -0.4 ? 2 : rel < 0.25 ? 1 : 0
          if (y === hh - 1) tn = 0
          else if (tn === 2 && h2(x, ay + y, 90 + v) < 0.3) tn = 3
          set(x, ay + y, PINE.t[tn])
        }
      }
    }
  }))
  const GRAY = ['#6f6a66', '#8f8a84', '#b3aea6', '#d6d2c8'].map((c) => col(c))
  for (const [w, h] of [[13, 10], [9, 7]]) S.stone.push(sprite(w, h, { line: col('#4a4542'), shadow: [w / 2, h - 2, w / 2 - 1, 1.6], ay: h - 2 }, (set) => {
    ell(set, w / 2, h / 2 - 0.5, w / 2 - 1.5, h / 2 - 2, (x, y) => {
      const l = 0.5 - ((x - w / 2) / w + (y - h / 2) / h) * 1.5
      return GRAY[l < 0.25 ? 0 : l < 0.55 ? 1 : l < 0.9 ? 2 : 3]
    })
  }))
  // пень
  S.small.push(sprite(12, 11, { line: BARK[0], shadow: [6, 8.5, 5, 1.8], ay: 9 }, (set) => {
    for (let y = 4; y <= 8; y++) for (let x = 2; x <= 9; x++) set(x, y, BARK[x < 4 ? 2 : x > 7 ? 0 : 1])
    ell(set, 6, 4, 4, 2, (x, y, d) => col(snowy ? (d < 0.5 ? '#ffffff' : '#d6e2ea') : d < 0.25 ? '#a87a40' : '#c89a5a'))
  }))
  if (T.extra === 'pumpkin') {
    const PUMP = ['#b8501a', '#e07a1e', '#f5a23a'].map((c) => col(c))
    S.small.push(sprite(11, 10, { line: col('#6e2a0e'), shadow: [5.5, 8, 4.5, 1.5], ay: 8 }, (set) => {
      ell(set, 5.5, 5.5, 4, 3, (x, y) => PUMP[x === 3 || x === 7 ? 0 : x < 5 && y < 6 ? 2 : 1])
      set(5, 1, col('#4a6a2a')); set(5, 2, col('#4a6a2a'))
    }))
  } else if (T.extra === 'flower') {
    // ромашка
    S.small.push(sprite(9, 11, { line: col('#2c5a26'), ay: 9 }, (set) => {
      for (let y = 5; y <= 9; y++) set(4, y, col('#4a9a3c'))
      set(3, 7, col('#6cbc4a')); set(5, 8, col('#6cbc4a'))
      for (const [x, y] of [[4, 2], [3, 3], [5, 3], [4, 4], [3, 2], [5, 4]]) set(x, y, col('#fff6dc'))
      set(4, 3, col('#f2c14e'))
    }))
  }
  if (snowy) {
    // сугробы вместо тыкв и грибов
    for (const [w, h] of [[15, 8], [10, 6]]) S.small.push(sprite(w, h, { line: col('#8fa6bc'), ay: h - 2 }, (set) => {
      ell(set, w / 2, h / 2 + 0.5, w / 2 - 1.5, h / 2 - 1.5, (x, y) => col(y < h / 2 ? '#ffffff' : x > w / 2 ? '#c4d2de' : '#e6eef4'))
    }))
  } else S.small.push(sprite(9, 10, { line: col('#5e1512'), shadow: [4.5, 8, 3, 1.2], ay: 8 }, (set) => {
    for (let y = 5; y <= 7; y++) { set(4, y, col('#f0e0c0')); set(5, y, col('#d8c4a0')) }
    for (let y = 2; y <= 4; y++) for (let x = (y === 2 ? 3 : 2); x <= (y === 2 ? 5 : 6); x++) set(x, y, col(x < 4 ? '#e2583a' : '#c23a26'))
    set(3, 3, col('#fff4e0')); set(5, 4, col('#fff4e0'))
  }))
  // камыш: три стебля с бурыми початками
  const REED = T.reed.map((c) => col(c)), HEAD = col('#6e4220')
  for (let v = 0; v < 3; v++) S.reed.push(sprite(12, 18, { line: 0, ay: 16 }, (set) => {
    const st = [[2, 6 + v], [5, 3], [9, 5 + ((v * 2) % 3)]]
    st.forEach(([x, top], i) => {
      for (let y = top; y <= 16; y++) set(x, y, REED[i === 1 ? 1 : 0])
      for (let y = top; y < top + 4; y++) { set(x, y, HEAD); if (i === 1) set(x + 1, y, col('#8a5a2c')) }
      set(x, top - 1, REED[1])
    })
    for (let k = 0; k < 5; k++) { set(6 + k, 15 - k * 2, REED[1]); set(4 - (k >> 1), 14 - k, REED[0]) }
  }))
  // кувшинка
  for (let v = 0; v < 2; v++) S.lily.push(sprite(9, 6, { line: 0, ay: 3 }, (set) => {
    ell(set, 4.5, 3, 4, 2.4, (x, y) => (x === 4 && y < 3 ? 0 : col(y < 3 ? '#62a85a' : '#3c8a48')))
    if (v) { set(5, 2, col('#f5a0c0')); set(6, 2, col('#fff0f6')); set(5, 3, col('#e07aa8')) }
  }))
  S.water = Object.fromEntries(Object.entries(T.water).map(([k, v]) => [k, Array.isArray(v) ? col(...v) : col(v)]))
  S.lilies = T.lily
  return S
}

// ---------- пруды ----------
const pondD = (p, x, y) => {
  const dx = x - p.x, dy = (y - p.y) / 0.72, a = Math.atan2(dy, dx)
  return Math.hypot(dx, dy) / (p.r * (1 + 0.16 * Math.sin(3 * a + p.a1) + 0.09 * Math.sin(5 * a + p.a2)))
}

export function createForest(layer, getView) {
  const sets = {}
  let theme = 'autumn', S = (sets.autumn = makeSprites(THEMES.autumn))
  const chunks = new Map(), objCache = new Map(), pondCache = new Map(), pondEls = new Map()
  let obs = [], obsKeys = new Set(), lastKey = ''

  function pondOf(sx, sy) {
    const k = sx + ',' + sy
    if (pondCache.has(k)) return pondCache.get(k)
    let p = null
    if (h2(sx, sy, 11) < 0.42) {
      const r = 26 + h2(sx, sy, 12) * 26, m = r * 1.3 + 14
      p = {
        k, r, x: sx * SC + m + h2(sx, sy, 13) * (SC - 2 * m), y: sy * SC + m + h2(sx, sy, 14) * (SC - 2 * m),
        a1: h2(sx, sy, 15) * 6.28, a2: h2(sx, sy, 16) * 6.28, objs: [], sparks: [],
      }
      const at = (a, dd) => {
        const R = p.r * (1 + 0.16 * Math.sin(3 * a + p.a1) + 0.09 * Math.sin(5 * a + p.a2)) * dd
        return [Math.round(p.x + Math.cos(a) * R), Math.round(p.y + Math.sin(a) * R * 0.72)]
      }
      const nr = 7 + Math.floor(h2(sx, sy, 17) * 8)
      for (let i = 0; i < nr; i++) {
        // камыши кучками: соседние углы, у самой кромки
        const a = h2(sx, sy, 20 + (i >> 1)) * 6.28 + (i & 1) * 0.22, [x, y] = at(a, 0.93 + h2(i, sx, sy + 3) * 0.14)
        p.objs.push({ x, y, s: S.reed[Math.floor(h2(i, sx + 5, sy) * 3)] })
      }
      const nl = S.lilies ? 2 + Math.floor(h2(sx, sy, 18) * 4) : 0
      for (let i = 0; i < nl; i++) {
        const [x, y] = at(h2(i, sx, sy + 40) * 6.28, 0.2 + h2(i, sx, sy + 41) * 0.45)
        p.objs.push({ x, y, s: S.lily[h2(i, sx, sy + 42) < 0.45 ? 1 : 0] })
      }
      for (let i = 0; i < 4; i++) p.sparks.push(at(h2(i, sx, sy + 50) * 6.28, 0.15 + h2(i, sx, sy + 51) * 0.5))
    }
    pondCache.set(k, p)
    return p
  }

  function objectsOf(cx, cy) {
    const k = cx + ',' + cy
    let list = objCache.get(k)
    if (list) return list
    if (objCache.size > 600) objCache.clear()
    list = []
    const G = 32, pond = pondOf(Math.floor(cx / 3), Math.floor(cy / 3))
    for (let j = 0; j < CH / G; j++) for (let i = 0; i < CH / G; i++) {
      const qx = cx * (CH / G) + i, qy = cy * (CH / G) + j
      const x = qx * G + Math.floor(h2(qx, qy, 3) * G), y = qy * G + Math.floor(h2(qx, qy, 4) * G)
      const d = density(x, y), wood = step(0.5, 0.64, d), r = h2(qx, qy, 5), kind = h2(qx, qy, 6), v = h2(qx, qy, 7)
      let s = null
      if (r < wood * 0.82) {
        // в роще преобладает один цвет листвы, но встречаются и чужие
        const pal = Math.floor(vn(x / 260 + 7, y / 260 + 3, 8) * 4 + v * 1.7) % 4
        s = kind < 0.16 ? S.pine[v < 0.5 ? 0 : 1] : kind < 0.27 ? S.bush[pal][v < 0.5 ? 0 : 1] : S.tree[pal][Math.floor(v * 3)]
      } else if (r > 0.93) {
        s = kind < 0.3 ? S.bush[Math.floor(v * 4)][0] : kind < 0.55 ? S.stone[v < 0.5 ? 0 : 1] : S.small[Math.floor(v * 3)]
      }
      if (!s) continue
      if (pond && pondD(pond, x, y - (s.h > 20 ? 10 : 0)) < (s.h > 20 ? 1.75 : 1.25)) continue
      list.push({ x, y, s })
    }
    objCache.set(k, list)
    return list
  }

  // объект спрятан, если стоит под грядкой или вплотную к ней
  const hidden = (o) => {
    const wx = o.x * PX, wy = o.y * PX, side = o.s.w + 48, bottom = o.s.h * PX + 40
    for (const r of obs) if (wx > r.x - side && wx < r.x + r.w + side && wy > r.y - 44 && wy < r.y + r.h + bottom) return true
    return false
  }
  const pondHidden = (p) => {
    const x0 = (p.x - p.r * 1.3) * PX - 30, x1 = (p.x + p.r * 1.3) * PX + 30, y0 = (p.y - p.r) * PX - 50, y1 = (p.y + p.r) * PX + 30
    for (const r of obs) if (x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h) return true
    return false
  }

  function paint(ch) {
    const g = ch.g, ox = ch.cx * CH, oy = ch.cy * CH
    g.clearRect(0, 0, CH, CH)
    const list = []
    const pond = pondOf(Math.floor(ch.cx / 3), Math.floor(ch.cy / 3))
    if (pond && !pondHidden(pond)) {
      const x0 = Math.max(ox, Math.floor(pond.x - pond.r * 1.45)), x1 = Math.min(ox + CH, Math.ceil(pond.x + pond.r * 1.45))
      const y0 = Math.max(oy, Math.floor(pond.y - pond.r * 1.1)), y1 = Math.min(oy + CH, Math.ceil(pond.y + pond.r * 1.1))
      if (x1 > x0 && y1 > y0) {
        const img = g.createImageData(x1 - x0, y1 - y0), d = new Uint32Array(img.data.buffer)
        for (let y = y0, k = 0; y < y1; y++) for (let x = x0; x < x1; x++, k++) {
          const q = pondD(pond, x + 0.5, y + 0.5)
          const WATER = S.water
          if (q > 1.12) continue
          if (q > 1) d[k] = WATER.shore
          else if (q > 0.9) d[k] = y < pond.y ? WATER.bank : WATER.lit
          else if (q < 0.84 && (x & 7) < 5 && h2(x >> 3, y, 5) < 0.04) d[k] = WATER.dash
          else d[k] = q > 0.55 ? WATER.mid : WATER.deep
        }
        g.putImageData(img, x0 - ox, y0 - oy)
      }
      for (const o of pond.objs) list.push(o)
    }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const o of objectsOf(ch.cx + dx, ch.cy + dy)) list.push(o)
    list.sort((a, b) => a.y - b.y)
    for (const o of list) {
      const x = o.x - Math.round(o.s.ax) - ox, y = o.y - o.s.ay - oy
      if (x >= CH || y >= CH || x + o.s.w <= 0 || y + o.s.h <= 0 || hidden(o)) continue
      g.drawImage(o.s.cv, x, y)
    }
    ch.dirty = false
  }

  function syncPonds(cx0, cy0, cx1, cy1) {
    const seen = new Set()
    for (let sy = Math.floor(cy0 / 3); sy <= Math.floor(cy1 / 3); sy++) for (let sx = Math.floor(cx0 / 3); sx <= Math.floor(cx1 / 3); sx++) {
      const p = pondOf(sx, sy)
      if (!p || pondHidden(p)) continue
      seen.add(p.k)
      if (pondEls.has(p.k)) continue
      pondEls.set(p.k, p.sparks.map(([x, y], i) => {
        const el = document.createElement('i')
        el.className = 'sp'
        el.style.cssText = `left:${x * PX}px;top:${y * PX}px;animation-delay:${(-h2(i, sx, sy + 60) * 4).toFixed(2)}s`
        layer.appendChild(el)
        return el
      }))
    }
    for (const [k, els] of pondEls) if (!seen.has(k)) { els.forEach((e) => e.remove()); pondEls.delete(k) }
  }

  return {
    /** Сцена сменилась: те же места, другие спрайты. Неизвестная тема оставляет прежнюю. */
    setTheme(name) {
      if (!THEMES[name] || name === theme) return
      theme = name
      S = sets[name] ??= makeSprites(THEMES[name])
      objCache.clear(); pondCache.clear()
      for (const ch of chunks.values()) ch.cv.remove()
      chunks.clear()
      for (const els of pondEls.values()) els.forEach((e) => e.remove())
      pondEls.clear()
      lastKey = ''
    },
    /** Прямоугольники грядок в координатах мира: под ними и рядом лес не растёт. */
    setObstacles(rects) {
      const keys = new Set(rects.map((r) => [r.x, r.y, r.w, r.h].join()))
      const changed = [...rects.filter((r) => !obsKeys.has([r.x, r.y, r.w, r.h].join())), ...obs.filter((r) => !keys.has([r.x, r.y, r.w, r.h].join()))]
      obs = rects.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }))
      obsKeys = keys
      if (!changed.length) return
      const M = 330 // пруд рядом с грядкой прячется целиком, поэтому запас больше его размера
      for (const ch of chunks.values()) {
        const x = ch.cx * WCH, y = ch.cy * WCH
        if (changed.some((r) => x < r.x + r.w + M && x + WCH > r.x - M && y < r.y + r.h + M && y + WCH > r.y - M)) ch.dirty = true
      }
      lastKey = ''
    },
    /** Вызывать каждый кадр: достраивает квадраты, попавшие на экран, и убирает ушедшие. */
    update(active) {
      if (!active) return
      const v = getView()
      const cx0 = Math.floor(v.x0 / WCH), cy0 = Math.floor(v.y0 / WCH), cx1 = Math.floor(v.x1 / WCH), cy1 = Math.floor(v.y1 / WCH)
      const key = [cx0, cy0, cx1, cy1].join()
      if (key === lastKey) return
      if (!((cx1 - cx0 + 1) * (cy1 - cy0 + 1) <= 160)) return
      lastKey = key
      for (const [k, ch] of chunks) {
        if (ch.cx < cx0 || ch.cx > cx1 || ch.cy < cy0 || ch.cy > cy1) { ch.cv.remove(); chunks.delete(k) }
        else if (ch.dirty) paint(ch)
      }
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        const k = cx + ',' + cy
        if (chunks.has(k)) continue
        const cv = document.createElement('canvas')
        cv.width = cv.height = CH
        cv.style.left = cx * WCH + 'px'
        cv.style.top = cy * WCH + 'px'
        const ch = { cx, cy, cv, g: cv.getContext('2d'), dirty: false }
        paint(ch)
        layer.appendChild(cv)
        chunks.set(k, ch)
      }
      syncPonds(cx0, cy0, cx1, cy1)
    },
  }
}
