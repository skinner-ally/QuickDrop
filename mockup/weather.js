// Погода на холсте графа: листопад и солнечные лучи.
// Переработка эффектов pixelfx weather/falling-leaves и weather/god-rays (MIT, Copyright (c) 2026 Patch,
// Copyright (c) 2026 Hugo Duprez — https://www.spritefusion.com/pixel-art-vfx) под вид сверху и произвольный
// размер холста: исходные рассчитаны на сцену 320×180 с тёмной дымкой и линией пола внизу.
import { fit, rand, wrap, mix, hex, TAU } from './pixelfx/core/index.js'
import { trips } from './pixelfx/fx/weather/_lib.js'

// ---------- листопад ----------
const LD = 16 // длина петли, с: вдвое спокойнее исходной
const gust = (t) => 16 * Math.sin((TAU * t) / LD - 1.2) + 5 * Math.sin((TAU * 3 * t) / LD)
// ∫|cos| от начала качания: лист ускоряется в нижней точке дуги
const Hc = (th) => {
  const k = Math.floor((th + Math.PI / 2) / Math.PI)
  return 2 * k + 1 + Math.sin(th - k * Math.PI)
}
// контур листа в его осях: u вдоль (-1 черешок .. 1 кончик), v поперёк; до 1 — внутри
const SHAPES = [
  (u, v) => (Math.abs(u) >= 1 ? 9 : (v * v) / (0.36 * (1 - u * u) * (1.15 - 0.3 * u))), // бук
  (u, v) => {
    const r = Math.hypot(u, v * 1.1), a = Math.atan2(v, u)
    return r / (0.62 + 0.38 * Math.abs(Math.cos(2.5 * a)) ** 1.5) // клён
  },
  (u, v) => (Math.abs(u) >= 1 ? 9 : (v * v) / (0.16 * (1 - u * u))), // ива
]
const DAY = [
  ['#4a1d0c', '#8a3a14', '#c8621e', '#f0982e', '#ffcf72', '#fff0c4'],
  ['#40101a', '#7c1c22', '#b8302a', '#e85a3c', '#ff9a72', '#ffd8c4'],
  ['#3e300c', '#7a5c14', '#b8901e', '#e8c23a', '#fff09a', '#fffbe0'],
].map((r) => fit(r, 6))
const DUSK = hex('#2c2132')
const NIGHT = DAY.map((r) => r.map((c) => mix(c, DUSK, 0.5)))

/** Листья падают «с неба» на случайные места поля, лежат и тают. p — painter кадра, W×H — его размер. */
export function drawLeaves(p, t, W, H, night) {
  const R3 = night ? NIGHT : DAY, S = 8
  const n = Math.max(8, Math.round((W * H) / 11000))
  trips(t, LD, n, S * 19, 2, 3, (u, k, m, i) => {
    const j = wrap(k, m), R = (q) => rand(S * 19, i, j, q), near = R(1) < 0.35
    const dur = LD / m, tf = dur * 0.72, a = Math.min(u * dur, tf), rest = u * dur - tf
    const w = 1.7 + R(2) * 1.2, ph0 = R(3) * TAU, amp = (near ? 14 : 8) + R(4) * 10
    // вид сверху: у каждого листа своя точка приземления, а не общая линия пола
    const yLand = -10 + R(13) * (H + 20), drop = 130 + R(12) * 70, x0 = -30 + R(5) * (W + 30), y0 = yLand - drop
    const path = (aa) => 0.45 * aa + (0.9 * (Hc(w * aa + ph0) - Hc(ph0))) / w, vy = drop / path(tf)
    const born = t - u * dur
    const xAt = (aa) => x0 + 7 * aa + Math.sin(w * aa + ph0) * amp + (gust(born + aa) - gust(born)) * (near ? 1 : 0.7)
    const size = (near ? 5.8 : 4.2) + R(6) * 1.6, shape = Math.floor(R(7) * 3), col = R3[Math.floor(R(8) * 3)]
    if (rest > 0) {
      leaf(p, xAt(tf), yLand, size, (R(9) - 0.5) * 0.5, 0.42, shape, col, 1 - rest / (dur - tf))
      return
    }
    const g = a / tf // 0 — только появился высоко над полем, 1 — у земли
    const x = xAt(a), y = y0 + vy * path(a), tilt = Math.cos(w * a + ph0) * 0.75 + (near ? 0 : 0.3)
    const flip = Math.cos(R(10) * TAU + a * (R(11) < 0.3 ? 5 : 1.2)), sz = size * (1.3 - 0.3 * g)
    leaf(p, x, y, sz, tilt, flip, shape, col, Math.min(1, a / 0.5))
    if (flip > 0.86 && !night) {
      const kk = (flip - 0.86) / 0.14, hx = x - Math.cos(tilt) * sz * 0.3, hy = y - Math.sin(tilt) * sz * 0.3 - 1
      p.px(hx, hy, col[5])
      p.glow(hx, hy, 5 + sz * 0.5, col[4], 0.22 * kk)
    }
  })
}

// лист: сжат поперёк на flip (знак — какая сторона видна), повёрнут, с контуром и жилкой; изнанка бледнее
function leaf(q, x, y, size, ang, flip, shape, col, a) {
  const back = flip < -0.25, fs = 0.35 + 0.65 * Math.abs(flip), c = Math.cos(ang), s = Math.sin(ang)
  const L = size, Wd = size * 0.9, ext = L + 1.5, shapeFn = SHAPES[shape]
  const face = back ? [mix(col[1], hex('#9c8a78'), 0.2), mix(col[2], hex('#c8b49c'), 0.22), mix(col[3], hex('#e0d0b8'), 0.22)] : [col[2], col[3], col[4]]
  const rim = col[0], vein = back ? mix(col[2], hex('#e8dcc8'), 0.5) : col[1]
  q.shade(x - ext, y - ext, x + ext, y + ext, (px, py, out) => {
    const dx = px - x, dy = py - y, lu = (dx * c + dy * s) / L, lv = (-dx * s + dy * c) / (Wd * fs)
    const d = shapeFn(lu, lv)
    if (lu < -1.25 || lu > 1.1) return
    if (lu < -0.92 && Math.abs(lv * Wd * fs) < 0.5) return void ((out.c = rim), (out.a = a))
    if (d > 1.32) return
    out.a = a
    if (d > 1) out.c = rim
    else if (Math.abs(lv * Wd * fs) < 0.45 && lu > -0.9 && lu < 0.75) out.c = vein
    else out.c = lv < -0.15 ? face[2] : lv < 0.35 ? face[1] : face[0]
  })
}

// ---------- солнечные лучи ----------
const RD = 10
// ось веера (вниз и вправо) и нормаль к ней; место пикселя в веере — его угол от оси
const AX = Math.cos(0.94), AY = Math.sin(0.94), NX = -AY, NY = AX
// лучи: угол от оси, полуширина, сила, «дыхание» (циклов за петлю), покачивание
const SHAFTS = [
  { c: -0.27, h: 0.03, k: 0.65, b: 1, sw: 0.006 },
  { c: -0.17, h: 0.022, k: 0.55, b: 2, sw: 0.005 },
  { c: -0.07, h: 0.05, k: 1, b: 1, sw: 0.008 },
  { c: 0.03, h: 0.018, k: 0.6, b: 3, sw: 0.004 },
  { c: 0.12, h: 0.042, k: 0.85, b: 2, sw: 0.007 },
  { c: 0.23, h: 0.026, k: 0.6, b: 1, sw: 0.005 },
]
const STR = new Float32Array(512)
const rgba = (h, a) => { const c = hex(h); return ((Math.round(a * 255) << 24) | (c & 0xffffff)) >>> 0 }
// ступени света: без затемнения сцены, только тёплая полупрозрачная заливка — жёсткие пиксельные полосы
const LV = [0, 0, rgba('#f2d27a', 0.05), rgba('#f2d27a', 0.09), rgba('#f6dc92', 0.13), rgba('#fff2c4', 0.17), rgba('#ffffff', 0.2)]
const MOTE = [rgba('#f2d27a', 0.75), rgba('#fff2c4', 0.9), rgba('#ffffff', 1)]

/** Лучи из-за левого верхнего угла и пылинки, вспыхивающие в них. img — ImageData холста (перезаписывается). */
export function drawRays(img, t) {
  const W = img.width, H = img.height, d = new Uint32Array(img.data.buffer)
  const s = Math.max(W / 320, H / 180), SX = -70 * s, SY = -130 * s
  for (let i = 0; i < 512; i++) {
    const a = i / 512
    STR[i] = 0.5 + 0.5 * Math.sin(a * 190 + Math.sin((TAU * t) / RD) * 2 + 3) * Math.sin(a * 77 - (TAU * t) / RD + 6)
  }
  const n = SHAFTS.length, SC = new Float32Array(n), SI = new Float32Array(n), SK = new Float32Array(n)
  SHAFTS.forEach((sh, j) => {
    SC[j] = sh.c + sh.sw * Math.sin((TAU * t) / RD + j * 1.3)
    SI[j] = 1 / (sh.h * (1 + 0.15 * Math.sin((TAU * sh.b * t) / RD + j)))
    SK[j] = sh.k * (0.72 + 0.28 * Math.sin((TAU * sh.b * t) / RD + j * 2.1))
  })
  const lightAt = (r, nn) => {
    const ang = nn / r
    let e = 0
    for (let j = 0; j < n; j++) {
      const q = (ang - SC[j]) * SI[j]
      if (q > -1 && q < 1) { const w = 1 - q * q; e += SK[j] * w * Math.sqrt(w) }
    }
    if (e <= 0) return 0
    const fall = 1.35 - (r / s - 200) / 330, si = ((ang + 0.36) * 700) | 0
    return e * (fall > 1 ? 1 : fall < 0 ? 0 : fall) * (0.7 + 0.45 * STR[si < 0 ? 0 : si > 511 ? 511 : si])
  }
  d.fill(0)
  for (let y = 0; y < H; y++) {
    const dy = y + 0.5 - SY
    let r = (0.5 - SX) * AX + dy * AY, nn = (0.5 - SX) * NX + dy * NY
    for (let x = 0, k = y * W; x < W; x++, k++, r += AX, nn += NX) {
      const e = lightAt(r, nn)
      if (e >= 0.06) d[k] = LV[e > 1.05 ? 6 : e > 0.78 ? 5 : e > 0.52 ? 4 : e > 0.3 ? 3 : 2]
    }
  }
  // пылинки медленно плавают и видны только там, где пересекают луч
  const count = Math.round((W * H) / 2600)
  for (let i = 0; i < count; i++) {
    const R = (q) => rand(3, i, q), n1 = 1 + Math.floor(R(1) * 2), n2 = 1 + Math.floor(R(2) * 2)
    const x = Math.round(-10 + R(3) * (W + 20) + (8 + R(4) * 14) * Math.sin((TAU * n1 * t) / RD + R(5) * TAU))
    const y = Math.round(-10 + R(6) * (H + 20) + (6 + R(7) * 10) * Math.sin((TAU * n2 * t) / RD + R(8) * TAU) + 4 * Math.sin((TAU * 3 * t) / RD + i))
    if (x < 0 || y < 0 || x >= W - 1 || y >= H - 1) continue
    const e = lightAt((x + 0.5 - SX) * AX + (y + 0.5 - SY) * AY, (x + 0.5 - SX) * NX + (y + 0.5 - SY) * NY)
    if (e < 0.12) continue
    const k = y * W + x
    d[k] = MOTE[e > 0.6 ? 2 : e > 0.3 ? 1 : 0]
    if (R(9) < 0.3 && e > 0.5) { d[k + 1] = MOTE[0]; d[k + W] = MOTE[0] }
  }
}
