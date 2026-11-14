// Казнь ноды графа. Латник со щитом выходит, заносит меч за голову и рубит ноду сверху: клинок входит в неё, кадр
// замирает, нода раскалывается и разлетается обломками своего цвета, искры, пыль и взрыв. Иногда нода уклоняется от
// первого удара — отскакивает и втягивает грань, клинок уходит в землю рядом, — и тогда её добивает второй удар.
// Серп удара — по рецепту из melee/_lib.js (Sprite Fusion, MIT), взрыв — explosions/small-explosion.
import { Particles, Bits, Lights, P, B, Rng, clamp, smooth, ease, hex, mix, scale, WHITE, sparkle, band, skeleton, chain } from "../../core/index.js";
import { swing, smear, glowAlong, trace, star } from "../melee/_lib.js";
import * as blast from "../explosions/small-explosion.js";

/** Где стоит нода: x её середины от начала координат сцены (ноги рыцаря на замахе — в x = −6, на ударе — в −2). */
export const TX = 28;
/** Клинок встречает ноду (или землю, если она уклонилась). */
const HIT = 0.3;
/** Второй удар (только при уклонении) позже первого на это время. */
const SECOND = 1.0;
/** Нода разлетается через столько после удара, по часам эффекта (заморозка кадра в них не входит). */
const BURST = 0.08;
/** От кулака до острия меча knightly (rig.js). */
const BLADE = 24.8;
const STEEL = ["#1c1830", "#3a3f66", "#6a78a8", "#a8b8e0", "#e4ecff", "#ffffff"].map(hex);
const DUST = hex("#8f8896");
const PI = Math.PI;

export const meta = {
  name: "Node smite",
  desc: "A knight with sword and shield cuts a graph node down; sometimes it bends away from the first blow and the second lands: flash, chunks, sparks, dust, a blast.",
  tags: ["move", "melee", "sword", "shield", "knight", "explosion", "one-shot"],
  size: [240, 220],
  origin: [104, 194],
  // до последнего следа взрыва (small-explosion живёт 5,4 с); хост заканчивает сцену раньше — по последнему ключу позы
  duration: SECOND + HIT + BURST + 5.5,
  loop: false,
  fps: 30,
  bg: "ground",
  actor: 2,
  options: { color: "#5b8bd0", edge: "#4a2416", node: 12, dodge: false, seed: 3 },
};

// ---- позы. Рыцарь смотрит вправо: меч в ближней к нам руке, щит — в дальней. Правило всей сцены: ближняя рука и щит
// нигде не встречаются. В стойке щит впереди корпуса, а меч опущен назад; на замахе меч за головой, щит выставлен
// вперёд; на ударе рука с мечом идёт вперёд, а щит уходит за спину дальней стороной (bz < 0) и поворачивается ребром (sw).
// Когда рука и щит меняются местами (возврат после удара, второй замах), щит проходит за корпусом ребром и не виден.
const K = { knight: 2, weapon: "knightly", offWeapon: "kite", sw: 1, plume: 0, skirt: 0, fz: 4.5 };
/** Стойка: щит перед собой, меч опущен назад остриём к земле. */
const GUARD = { ...K, crouch: 3, fx: -6, fy: -16, sa: 2.72, bx: 10, by: -22, bz: 3, sb: 1.62, ffx: -6, fbx: 7 };
/** Меч широким кругом уходит назад и вверх: рука отведена за спину, клинок смотрит назад. */
const RAISE = { ...K, crouch: 3, lean: -1, fx: -13, fy: -26, sa: 3.55, bx: 11, by: -23, bz: 3.5, sb: 1.58, ffx: -6, fbx: 7, plume: -0.2 };
/** Замах: меч за головой, щит выставлен вперёд, вес на задней ноге. */
const WIND = { ...K, crouch: 3, lean: -3, fx: -8, fy: -37, sa: 3.95, bx: 12, by: -25, bz: 4, sb: 1.5, ffx: -7, fbx: 7, plume: -0.35 };
/** Довод замаха: клинок проваливается за спину. */
const WIND2 = { ...WIND, crouch: 4, lean: -4, fx: -9, fy: -36, sa: 3.65, bx: 13, plume: -0.1 };
/** Удар пошёл: рука уже над головой, клинок отстаёт; щит уходит на дальнюю сторону. */
const S1 = { ...K, crouch: 1, lean: 0, fx: 2, fy: -42, sa: 4.3, bx: 9, by: -22, bz: -6, sb: 1.7, sw: 0.8, ffx: -8, fbx: 8, plume: 0.3 };
/** Рука впереди, клинок догоняет. */
const S2 = { ...K, crouch: 3, lean: 3, fx: 14, fy: -32, sa: 5.6, bx: -2, by: -20, bz: -6, sb: 1.95, sw: 0.5, ffx: -9, fbx: 9, toeF: true, plume: 0.7 };
/** Контакт: клинок вошёл в верхний левый угол ноды, выпад, щит за спиной. */
const CUT = { ...K, crouch: 5, lean: 5, fx: 17, fy: -17, sa: 6.9, bx: -6, by: -17, bz: -6, sb: 2.15, sw: 0.7, ffx: -9, fbx: 9, toeF: true, plume: 0.9 };
/** Проводка: клинок прошёл ноду насквозь и встал в землю. */
const DOWN = { ...K, crouch: 6, lean: 6, fx: 17, fy: -14, sa: 7.25, bx: -7, by: -16, bz: -6, sb: 2.25, sw: 0.7, ffx: -10, fbx: 9, toeF: true, plume: 0.2 };
const DOWN2 = { ...DOWN, crouch: 5, lean: 5, plume: -0.3 };
/** Промах: провалился за клинком глубже, остриё в земле там, где была нода. */
const MISS = { ...K, crouch: 7, lean: 7, fx: 17, fy: -15, sa: 7.33, bx: -8, by: -15, bz: -6, sb: 2.35, sw: 0.7, ffx: -10, fbx: 9, toeF: true, plume: 1 };
/** Понял, что промахнулся: приподнялся и поднял голову на ноду. */
const MISS2 = { ...MISS, crouch: 4, lean: 3, hy: -2, fx: 16, fy: -18, plume: -0.4 };
/** Рывком выдернул меч вверх; щит в это время проходит за корпусом ребром. */
const YANK = { ...K, crouch: 3, lean: 1, fx: 7, fy: -30, sa: 5.3, bx: 0.7, by: -22, bz: -6, sb: 1.62, sw: 0.2, ffx: -8, fbx: 8, plume: 0.5 };
/** Меч пошёл за голову, щит вышел вперёд с дальней стороны. */
const YANK2 = { ...K, crouch: 3, lean: -1, fx: -1, fy: -36, sa: 4.6, bx: 9, by: -24, bz: -6, sb: 1.6, sw: 0.8, ffx: -7, fbx: 7, plume: 0.1 };
/** Возврат после удара: выпрямляется, вытягивая меч из земли; щит ещё за спиной. */
const RISE = { ...K, crouch: 4, lean: 3, fx: 10, fy: -17, sa: 6.95, bx: -6, by: -18, bz: -6, sb: 2.0, sw: 0.7, ffx: -9, fbx: 8, plume: 0.25 };
/** Рука с мечом у бедра перед корпусом, щит проходит за корпусом ребром — они не встречаются. */
const REC = { ...K, crouch: 3, lean: 1, fx: 3, fy: -21, sa: 7.0, bx: 0.7, by: -22, bz: -6, sb: 1.62, sw: 0.2, ffx: -8, fbx: 8, plume: -0.2 };
/** Меч опускается вдоль ноги, щит выходит вперёд с дальней стороны. */
const REC2 = { ...K, crouch: 3, fx: -2, fy: -25, fz: 7.5, sa: 8.05, bx: 6.5, by: -21.5, bz: -6, sb: 1.63, sw: 0.5, ffx: -7, fbx: 7, plume: 0 };
const GUARD2 = { ...GUARD, sa: GUARD.sa + 2 * PI };
const EASE = { ...GUARD2, crouch: 1, fx: -5, by: -21, ffx: -3, fbx: 4, plume: 0.15 };
/** Разворот через «лицом к нам»: щит переходит на ближнюю к нам сторону. */
const TURN1 = { ...EASE, yaw: 0.9, bx: 9, bz: 0, ffx: -2, fbx: 3 };
const TURN2 = { ...EASE, yaw: 2.3, crouch: 2, bx: 7, bz: -5, ffx: -1, fbx: 2 };
/** Спиной к ноде, уходит налево: щит теперь на ближней руке и закрывает корпус. */
const AWAY = { ...EASE, yaw: PI, crouch: 2, bx: 6, by: -21, bz: -6, sb: 1.6 };

// шаг: две опорные позы (ноги врозь, корпус просел) и две проходные (нога проносится, корпус поднялся); рука с мечом
// качается в противоход ногам, плюмаж подбрасывает на опоре
const STEP = [
  { crouch: 3, lean: 1, ffx: -6, fbx: 6, toeF: true, toeB: false, ffy: -4, fby: -4, fx: -5, sa: 2.5, by: -22, plume: 0.35 },
  { crouch: 1, lean: 1, ffx: 1, fbx: 0, toeF: false, toeB: false, ffy: -8, fby: -4, fx: -6, sa: 2.6, by: -23, plume: -0.15 },
  { crouch: 3, lean: 1, ffx: 6, fbx: -6, toeF: false, toeB: true, ffy: -4, fby: -4, fx: -7.5, sa: 2.7, by: -22, plume: 0.35 },
  { crouch: 1, lean: 1, ffx: 0, fbx: 1, toeF: false, toeB: false, ffy: -4, fby: -8, fx: -6, sa: 2.6, by: -23, plume: -0.15 },
];
/** Проход от x0 до x1 за n полушагов, начиная с фазы phase; base — поза верха тела. */
const walk = (base, t0, t1, x0, x1, n, phase = 0) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const st = STEP[(phase + i) % 4];
    return [t0 + ((t1 - t0) * i) / n, { ...base, ...st, sa: base.sa + st.sa - 2.55, x: x0 + ((x1 - x0) * i) / n }, "line"];
  });

/** Замах и удар; t — время контакта, x — где стоят ноги на замахе, miss — нода уклонилась. */
const strike = (t, x, miss) => [
  [t - 0.34, { ...WIND, x: x - 1 }],
  [t - 0.16, { ...WIND2, x: x - 1.5 }],
  [t - 0.1, { ...S1, x: x + 1 }, "snap"],
  [t - 0.06, { ...S2, x: x + 3 }, "snap"],
  ...(miss
    ? [[t, { ...MISS, x: x + 5 }, "snap"], [t + 0.3, { ...MISS2, x: x + 5 }]]
    : [[t, { ...CUT, x: x + 4 }, "snap"], [t + 0.1, { ...DOWN, x: x + 5 }, "out"], [t + 0.5, { ...DOWN2, x: x + 5 }]]),
];

/** Ключи рыцаря для варианта с уклонением (dodge) или без. */
function keysFor(dodge) {
  const end = (dodge ? SECOND : 0) + HIT;
  const out = [...walk(GUARD, -0.85, -0.35, -26, -6, 4), [-0.29, { ...GUARD, x: -6 }], [-0.19, { ...RAISE, x: -6.5 }], ...strike(HIT, -6, dodge)];
  // промах: выдернул меч и сразу понёс его на второй замах
  if (dodge) out.push([HIT + 0.42, { ...YANK, x: -3 }, "out"], [HIT + 0.5, { ...YANK2, x: -5 }], ...strike(SECOND + HIT, -6, false));
  out.push(
    [end + 0.62, { ...RISE, x: -1 }],
    [end + 0.74, { ...REC, x: -2 }, "out"],
    [end + 0.82, { ...REC2, x: -3 }],
    [end + 0.92, { ...GUARD2, x: -3 }],
    [end + 1.02, { ...EASE, x: -3 }],
    [end + 1.12, { ...TURN1, x: -3 }, "snap"],
    [end + 1.2, { ...TURN2, x: -3 }, "snap"],
    ...walk(AWAY, end + 1.28, end + 1.78, -3, -23, 4).map(([t, q], i) => [t, q, i ? "line" : "snap"]),
  );
  return out;
}

export const act = {
  poses: keysFor(false),
  hits: [{ t: HIT, stop: 0.14, shake: 0.26, amp: 3, target: false }],
  dust: [{ t: HIT - 0.06, x: 7, n: 4, dir: 1 }, { t: HIT - 0.06, x: -11, n: 3, dir: -1 }],
};
/** Акт для варианта с уклонением: первый удар — в землю (заморозка короче), второй — в ноду. */
export const actDodge = {
  poses: keysFor(true),
  hits: [{ t: HIT, stop: 0.06, shake: 0.14, amp: 2, target: false }, { t: SECOND + HIT, stop: 0.14, shake: 0.26, amp: 3, target: false }],
  dust: [{ t: HIT - 0.06, x: 7, n: 4, dir: 1 }, { t: HIT - 0.06, x: -11, n: 3, dir: -1 }, { t: SECOND + HIT - 0.06, x: 7, n: 4, dir: 1 }, { t: SECOND + HIT - 0.06, x: -11, n: 3, dir: -1 }],
};

/** Когда нода гибнет (в этот момент хост удаляет запись). */
export const deathAt = (dodge) => (dodge ? SECOND : 0) + HIT;

// ---- геометрия удара: всё берётся из поз, чтобы серп и вспышка шли за клинком, а не рядом с ним
/** Кулак и остриё в позе, в координатах сцены. */
function bladeOf(q) {
  const h = skeleton(q).joints.handN, x = h[0] + (q.x ?? 0), y = h[1] + (q.y ?? 0), dx = Math.cos(q.sa), dy = Math.sin(q.sa);
  return { x, y, dx, dy, tx: x + dx * BLADE, ty: y + dy * BLADE };
}
/** Окружность через три точки. */
function circle3([ax, ay], [bx, by], [cx, cy]) {
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  return { cx: ux, cy: uy, R: Math.hypot(ax - ux, ay - uy) };
}
/**
 * Дуга острия для удара: от замаха через «руку впереди» до контакта (или до земли при промахе). Возвращает дугу и
 * углы вдоль неё (u — радианы от начала), на которых стоит остриё в каждой из поз удара.
 */
function arcFor(t, x, miss) {
  const keys = strike(t, x, miss), at = (i) => bladeOf(keys[i][1]);
  const w = at(1), s1 = at(2), s2 = at(3), c = at(4);
  // при промахе остриё уходит под землю: дугу ведём до точки на клинке у самой земли
  const end = miss ? [c.x + (c.dx * -c.y) / c.dy, 0] : [c.tx, c.ty];
  const o = circle3([w.tx, w.ty], [s2.tx, s2.ty], end), a0 = Math.atan2(w.ty - o.cy, w.tx - o.cx);
  const u = (px, py) => { let a = Math.atan2(py - o.cy, px - o.cx) - a0; while (a < 0) a += 2 * PI; return a; };
  return { s: swing({ cx: o.cx, cy: o.cy, R: o.R, a0, dir: 1 }), u1: u(s1.tx, s1.ty), u2: u(s2.tx, s2.ty), u3: u(end[0], end[1]), t1: keys[2][0], t2: keys[3][0], t3: t, w, c, end };
}

/**
 * Нода сбоку: квадрат S на земле в TX. bend 0 — ровная; 1 — уклонилась от клинка: отскочила вправо, вытянулась и
 * выгнулась дугой — левая грань втянута (перед ней встаёт клинок), правая выпирает; меньше нуля — качнулась обратно.
 * hot — вспышка. cut — раскол по линии клинка { x, y, dx, dy, gap }: половины расходятся на gap пикселей.
 */
function paintNode(p, S, col, { bend = 0, hot = false, cut = null } = {}) {
  const away = Math.max(0, bend);
  const h = S * (1 + 0.2 * away - 0.12 * Math.max(0, -bend)), slide = bend * S * 0.42;
  const whole = (x, y) => {
    const v = -y / h;
    if (v < 0 || v > 1) return false;
    // ось тела уходит дугой от клинка, а в середине нода ещё и «втягивает живот»
    const mid = TX + slide + bend * S * (0.4 * Math.sin(PI * Math.pow(v, 0.9)) + 0.12 * v), half = (S / 2) * (1 - 0.08 * away) * (1 - 0.18 * away * Math.sin(PI * v));
    return x >= mid - half && x <= mid + half;
  };
  // раскол: верхняя половина уезжает вверх-вправо от линии клинка, нижняя — влево
  const inside = !cut
    ? whole
    : (x, y) => ((x - cut.x) * cut.dy - (y - cut.y) * cut.dx > 0 ? whole(x - cut.dy * cut.gap, y + cut.dx * cut.gap) : whole(x + cut.gap * 0.6, y));
  const pad = S * 0.8 + 4;
  p.shade(TX - S / 2 - pad, -S * 1.3 - pad, TX + S / 2 + S + pad, 1, (x, y) => {
    if (!inside(x, y)) return undefined;
    const rim = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
    const lit = !inside(x - 2, y) || !inside(x, y - 2), dark = !inside(x + 2, y) || !inside(x, y + 2);
    if (hot) return rim ? WHITE : dark && !lit ? col.hot2 : col.hot;
    return rim ? col.edge : lit ? col.light : dark ? col.shade : col.fill;
  });
}
/** Сторона ноды в пикселях сцены: не меньше 4, без числа — 12. */
const sizeOf = (o) => Math.max(4, Math.round(+o.node || 12));
const colorsOf = (o) => {
  const fill = hex(o.color);
  return { fill, edge: hex(o.edge), light: mix(scale(fill, 1.25), WHITE, 0.15), shade: scale(fill, 0.72), hot: mix(fill, WHITE, 0.55), hot2: mix(fill, WHITE, 0.3) };
};

/** Нода до начала эффекта (рыцарь ещё идёт): хост рисует её сам, эффект в это время не рисуется. */
export function drawNodeIdle(p, o) {
  paintNode(p, sizeOf(o), colorsOf(o));
}

export function create(o) {
  const dodge = !!o.dodge, S = sizeOf(o), R = new Rng(o.seed), col = colorsOf(o);
  const DIE = deathAt(dodge), floor = () => 0;
  const ps = new Particles({ rng: R, ground: floor, sparks: [WHITE, STEEL[4], STEEL[3], STEEL[2]] }), bits = new Bits({ ground: floor }), lights = new Lights();
  const boom = chain([{ fx: blast, t: DIE + BURST, x: TX, size: 0.3 }])(o);
  // удары: при уклонении первый — мимо, в землю
  const blows = dodge ? [{ ...arcFor(HIT, -6, true), miss: true }, { ...arcFor(SECOND + HIT, -6, false), miss: false }] : [{ ...arcFor(HIT, -6, false), miss: false }];
  const kill = blows[blows.length - 1];
  // где клинок встречает ноду: на её левой грани у верхнего угла (у маленькой ноды — на крышке)
  const cs = (TX - S / 2 + 1.5 - kill.c.x) / kill.c.dx, CP = [TX - S / 2 + 1.5, Math.max(-S + 0.5, kill.c.y + kill.c.dy * cs)];
  const spikes = [-2.9, -2.2, -1.5, -0.8, -0.1, 0.7].map((a, i) => ({ a: a + R.range(-0.1, 0.1), len: (i % 2 ? 6 : 9) + R.range(0, 2), w: 1.2 + R.range(0, 0.4) }));
  let t = 0;
  for (const b of blows) b.done = false;
  let burst = false;

  // изгиб ноды: 0 — ровная, 1 — увернулась; уходит рывком под самый удар, держится, пока клинок в земле, и пружинит обратно
  const bendAt = (tt) => {
    if (!dodge) return 0;
    const a = HIT - 0.1, b = HIT + 0.46;
    if (tt < a) return 0;
    if (tt < HIT) return ease.outCubic(clamp((tt - a) / 0.09));
    if (tt < b) return 1 + 0.06 * Math.sin((tt - HIT) * 40) * Math.exp(-(tt - HIT) * 9);
    const u = clamp((tt - b) / 0.5);
    return Math.cos(u * PI * 2.5) * (1 - u) * (1 - u);
  };

  // серп: его кромка стоит там же, где клинок в текущей позе; хвост догоняет после удара
  const arc = (p, b) => {
    const U = t < b.t1 ? 0 : t < b.t2 ? b.u1 : t < b.t3 ? b.u2 : b.u3 - (b.miss ? 0 : 0.14);
    if (U <= 0) return;
    const gone = smooth(b.t3 + 0.05, b.t3 + 0.25, t), T = b.u3 * gone, n = STEEL.length;
    if (T >= U - 0.02) return;
    // в начале удара серп — тонкий росчерк за остриём, к контакту набирает ширину
    const grow = Math.pow(clamp(U / b.u3), 1.3);
    for (const [sw, wide, lag, rim] of [[{ ...b.s, R: b.s.R * 0.82 }, 3, 0.02, false], [b.s, 9, 0, true]]) {
      const w0 = Math.max(1.5, wide * grow);
      smear(p, sw, T, U, w0, (u, r, out) => {
        const v = (u - T) / (U - T), w = w0 * (1 - 0.6 * gone) * Math.pow(Math.sin(PI * Math.pow(v, 2.2)), 0.6);
        if (w < 0.4) return;
        const q = (sw.R - r) / w;
        if (q < 0 || q > 1) return;
        const age = Math.max(0, t - lag - b.t3);
        const ci = rim && q < 0.25 && age < 0.1 ? 0 : Math.round(q * (n - 1) * 0.7 + age * 9 - v * 0.8 + (rim ? 0.6 : 1.6));
        out.c = STEEL[n - 1 - clamp(ci, 0, n - 1)];
        out.a = Math.min(1, v / 0.35) * (1.15 - gone);
      });
    }
    glowAlong(p, b.s, b.s.R - 4, T, U, 8, STEEL[3], (u) => 0.16 * grow * (1 - gone) * ((u - T) / (U - T)));
    if (gone > 0.02) trace(p, b.s, b.s.R - 0.5, 0, T, STEEL[2], (u) => 0.7 * (1 - gone) * (0.4 + (0.6 * u) / b.u3));
  };

  return {
    update(dt) {
      t += dt;
      boom.update(dt);
      for (const b of blows) {
        if (b.done || t < b.t3) continue;
        b.done = true;
        if (b.miss) {
          // клинок в землю: искры, крошка, короткая пыль
          const [x, y] = b.end;
          lights.add(x, y - 2, 20, WHITE, 0.7, 0.1);
          for (let i = 0; i < 10; i++) {
            const a = -PI / 2 + R.range(-1.2, 1.2), sp = R.range(90, 240);
            ps.spawn(P.SPARK, x, y - 1, Math.cos(a) * sp, Math.sin(a) * sp, R.range(0.12, 0.35));
          }
          for (let i = 0; i < 6; i++) ps.spawn(P.DUST, x + R.range(-2, 2), -R.range(1, 3), R.sign() * R.range(15, 55), -R.range(4, 18), R.range(0.3, 0.6), DUST, R.range(1.6, 2.8));
          for (let i = 0; i < 8; i++) {
            const a = -PI / 2 + R.range(-0.9, 0.9), sp = R.range(40, 130);
            ps.spawn(P.GRIT, x + R.range(-1, 1), -1, Math.cos(a) * sp, Math.sin(a) * sp, R.range(0.6, 1.0), R.pick([DUST, scale(DUST, 0.7)]), 1);
          }
        } else {
          // клинок в ноду: белая вспышка и искры из точки контакта
          lights.add(CP[0], CP[1], 14, WHITE, 0.6, 0.1);
          for (let i = 0; i < 18; i++) {
            const a = -PI / 2 + R.range(-1.5, 1.1), sp = R.range(110, 320);
            ps.spawn(P.SPARK, CP[0], CP[1], Math.cos(a) * sp, Math.sin(a) * sp, R.range(0.15, 0.45));
          }
        }
      }
      if (!burst && t >= DIE + BURST) {
        burst = true;
        lights.add(TX, -S / 2, 46, WHITE, 0.9, 0.35);
        // обломки ноды её же цвета, пыль по земле в обе стороны
        for (let i = 0; i < 14; i++) {
          const a = -PI / 2 + R.range(-1.25, 1.25), sp = R.range(90, 230);
          bits.add({ kind: B.CHUNK, x: TX + R.range(-S / 3, S / 3), y: -S / 2 + R.range(-3, 3), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, a: R.range(0, 6.28), va: R.range(-14, 14), s: R.range(1.5, 3.2), c: R.next() < 0.3 ? col.edge : R.next() < 0.5 ? col.light : col.fill, g: 1, drag: 0.6, bounce: 0.35, life: R.range(0.9, 1.6) });
        }
        for (let i = 0; i < 8; i++) {
          const s = i % 2 ? -1 : 1;
          ps.spawn(P.DUST, TX + s * R.range(0, S / 2), -R.range(1, 4), s * R.range(25, 80), -R.range(3, 16), R.range(0.35, 0.75), DUST, R.range(1.8, 3.2));
        }
      }
      ps.update(dt);
      bits.update(dt);
      lights.update(dt);
    },
    // серп и нода — за рыцарем: клинок и рука остаются поверх них и читаются на контакте; нода — поверх серпа
    drawBack(p) {
      for (const b of blows) arc(p, b);
      if (t < DIE + BURST) {
        const q = t - DIE, k = kill.c;
        paintNode(p, S, col, { bend: bendAt(t), hot: q > -0.015, cut: q >= 0.04 ? { x: k.x, y: k.y, dx: k.dx, dy: k.dy, gap: 0.5 + 2.5 * clamp((q - 0.04) / (BURST - 0.04)) } : null });
      }
      // вспышка контакта: звезда из точки, где клинок вошёл в ноду (за рыцарем: клинок виден поверх неё)
      const c = t - DIE;
      if (c >= 0 && c < 0.04) star(p, CP[0], CP[1], spikes, 0.9, 0.55, WHITE, STEEL[4], WHITE, STEEL[3]);
      else if (c >= 0.04 && c < 0.08) star(p, CP[0], CP[1], spikes, 1.3, 0.45, WHITE, STEEL[4], STEEL[4], STEEL[2]);
      boom.drawBack(p);
      // ударная волна по земле: дальняя половина кольца
      const q = t - DIE - BURST;
      if (q >= 0 && q < 0.4) band(p, TX, 0.5, 5 + 34 * ease.outCubic(q / 0.4), 0.16, Math.max(1, 2.5 * (1 - q / 0.4)), 1.1 - q / 0.4, [STEEL[2], STEEL[3], col.light, WHITE], (g) => Math.sin(g) < 0);
      ps.draw(p, "back");
    },
    draw(p) {
      // блик на занесённом клинке перед ударом
      for (const b of blows) {
        const g = t - (b.t1 - 0.2);
        if (g > 0 && t < b.t1) {
          const k = ease.outBack(clamp(g / 0.08)) * (1 - 0.6 * clamp((t - b.t1 + 0.05) / 0.05)), x = b.w.x + b.w.dx * BLADE * 0.8, y = b.w.y + b.w.dy * BLADE * 0.8;
          sparkle(p, x, y, 1 + 5 * k, WHITE, STEEL[2], 0.6);
          p.glow(x, y, 14, STEEL[3], 0.3 * k);
        }
      }
      const q = t - DIE;
      if (q >= 0 && q < 0.2) p.glow(CP[0], CP[1], 16, col.light, 0.45 * Math.exp(-q / 0.05));
      // при промахе — короткая звёздочка от земли
      for (const b of blows) {
        const m = t - b.t3;
        if (b.miss && m >= 0 && m < 0.05) star(p, b.end[0], b.end[1] - 1, spikes.slice(1, 5), 0.7, 0.6, WHITE, STEEL[4], WHITE, STEEL[3]);
      }
      const w = t - DIE - BURST;
      if (w >= 0 && w < 0.4) band(p, TX, 0.5, 5 + 34 * ease.outCubic(w / 0.4), 0.16, Math.max(1, 2.5 * (1 - w / 0.4)), 1.1 - w / 0.4, [STEEL[2], STEEL[3], col.light, WHITE], (g) => Math.sin(g) >= 0);
      boom.draw(p);
      bits.draw(p);
      ps.draw(p, "front");
      lights.draw(p);
    },
  };
}
