/**
 * Плитка живого фона в растр (spec-stage6 §4.4). Плитка — блок решётки устройства size×size; её содержимое зависит
 * только от места (ti, tj), ступени решётки, графики сцены и нод рядом — не от соседних плиток и порядка отрисовки.
 * Поэтому объект на стыке рисуется в обеих плитках в одни и те же пиксели решётки и швов нет.
 *
 * Порядок: узор сетки → мелочь земли → пруды (по пикселям) → объекты по (y, x, id). Земля не рисуется (CSS-фон сцены):
 * пустой пиксель плитки = поляна.
 */

import type { Bounds } from '@/lib/graph/types'
import type { ObjectKind, Raster, SceneArt, Sprite } from '@/lib/ambient/types'
import { SPRITE_LIMITS } from '@/lib/ambient/types'
import type { LatticeStep } from '@/lib/ambient/lattice'
import { tileBounds, toLattice } from '@/lib/ambient/lattice'
import { blendPx, blitSprite, clearRaster } from '@/lib/ambient/raster'
import type { Clearing } from '@/lib/ambient/clearing'
import { CLEAR_GROUND_R, objectCleared, pondCleared } from '@/lib/ambient/clearing'
import type { WorldObject } from '@/lib/ambient/world'
import {
  ART_PX,
  GROUND_CELL,
  compareObjects,
  eachGroundDetail,
  hash2,
  objectsIn,
  pondBox,
  pondDistance,
  pondsIn,
} from '@/lib/ambient/world'

/** Запас в пикселях решётки: наибольший спрайт. Объект с опорой дальше от плитки на неё не попадает. */
export const TILE_MARGIN_PX = 40
/**
 * Мир: дальше этого от края плитки (с запасом TILE_MARGIN_PX) нода на её содержимое не влияет. Наибольшее влияние —
 * у пруда: его рамка (до r·1.45 от центра) задевает плитку, а скрывает его нода ближе reach = r·1.45 + 56 к центру;
 * при наибольшем r = 104 это 151 + 207 = 358.
 */
export const CLEAR_REACH = 360

/** Узор сетки — точка в центре клетки графа (между нодами). */
const GRID_OFFSET = GROUND_CELL / 2
/** Узор сетки рисуется, только пока клетка графа не меньше стольких пикселей решётки (иначе — сплошная рябь). */
const GRID_MIN_PX = 8

function expand(b: Bounds, d: number): Bounds {
  return { minX: b.minX - d, minY: b.minY - d, maxX: b.maxX + d, maxY: b.maxY + d }
}

/** Мировые границы, от содержимого которых зависит плитка: сама плитка + запас наибольшего спрайта. */
function tileReach(ti: number, tj: number, step: LatticeStep): Bounds {
  return expand(tileBounds(step, ti, tj), TILE_MARGIN_PX * step.worldPerPx)
}

/**
 * Рисует плитку (ti, tj) в out (обнуляется здесь же). out — size×size; растр другого размера не ошибка: рисуется
 * с угла плитки и обрезается по out. Возвращает число нарисованных объектов (лес, камыши, кувшинки), задевших out.
 */
export function renderTile(
  out: Raster,
  ti: number,
  tj: number,
  step: LatticeStep,
  art: SceneArt,
  clearing: Clearing,
): number {
  clearRaster(out)
  if (out.w === 0 || out.h === 0) return 0
  const wpp = step.worldPerPx
  // Угол плитки в решётке: локальная координата пикселя = решётка − угол.
  const x0 = ti * step.size
  const y0 = tj * step.size
  const B = tileReach(ti, tj, step)

  // Спрайт с опорой в точке мира (x, y); опора — пиксель решётки toLattice.
  const place = (s: Sprite, x: number, y: number) => {
    blitSprite(out, s, toLattice(step, x) - s.ax - x0, toLattice(step, y) - s.ay - y0)
  }

  // 1. Узор сетки: полянами не убирается (он и есть разметка поля).
  const grid = art.grid
  if (grid && step.lod === 0 && GROUND_CELL / wpp >= GRID_MIN_PX) {
    const gx0 = Math.ceil((B.minX - GRID_OFFSET) / GROUND_CELL)
    const gx1 = Math.floor((B.maxX - GRID_OFFSET) / GROUND_CELL)
    const gy0 = Math.ceil((B.minY - GRID_OFFSET) / GROUND_CELL)
    const gy1 = Math.floor((B.maxY - GRID_OFFSET) / GROUND_CELL)
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) place(grid, gx * GROUND_CELL + GRID_OFFSET, gy * GROUND_CELL + GRID_OFFSET)
    }
  }

  // 2. Мелочь земли: только на lod 0 и не под нодами.
  if (step.lod === 0) {
    eachGroundDetail(B, (x, y, r1, r2) => {
      if (clearing.near(x, y, CLEAR_GROUND_R)) return
      const s = art.detail(r1, r2)
      if (s) place(s, x, y)
    })
  }

  // 3. Пруды: по пикселям решётки в рамке пруда ∩ плитка. Пруд у ноды скрыт целиком вместе с камышами.
  // Мир леса строится, только если у сцены есть спрайты объектов («Бумага» — без них).
  const objects: WorldObject[] = artHasObjects(art) ? objectsIn(B).filter((o) => !objectCleared(o, clearing)) : []
  const water = art.water
  if (water) {
    const w = Math.min(step.size, out.w)
    const h = Math.min(step.size, out.h)
    for (const p of pondsIn(B)) {
      if (pondCleared(p, clearing)) continue
      for (const o of p.objects) objects.push(o)
      const f = pondBox(p)
      const lx0 = Math.max(0, Math.floor(f.minX / wpp) - x0)
      const lx1 = Math.min(w, Math.ceil(f.maxX / wpp) - x0)
      const ly0 = Math.max(0, Math.floor(f.minY / wpp) - y0)
      const ly1 = Math.min(h, Math.ceil(f.maxY / wpp) - y0)
      for (let ly = ly0; ly < ly1; ly++) {
        // Центр пикселя решётки в мире.
        const wy = (ly + y0 + 0.5) * wpp
        const ay = Math.floor(wy / ART_PX)
        for (let lx = lx0; lx < lx1; lx++) {
          const wx = (lx + x0 + 0.5) * wpp
          const q = pondDistance(p, wx, wy)
          if (q > 1.12) continue
          let c: number
          if (q > 1) c = water.shore
          else if (q > 0.9) c = wy < p.y ? water.bank : water.lit
          else if (q < 0.84 && step.lod === 0 && dash(Math.floor(wx / ART_PX), ay)) c = water.dash
          else c = q > 0.55 ? water.mid : water.deep
          blendPx(out, lx, ly, c)
        }
      }
    }
  }

  // 4. Объекты: лес и камыши/кувшинки нескрытых прудов в общем порядке (y, x, id).
  objects.sort(compareObjects)
  let drawn = 0
  for (const o of objects) {
    const s = art.object(o.kind, o.pal, o.variant)
    if (!s) continue
    const left = toLattice(step, o.x) - s.ax - x0
    const top = toLattice(step, o.y) - s.ay - y0
    if (left >= out.w || top >= out.h || left + s.w <= 0 || top + s.h <= 0) continue
    blitSprite(out, s, left, top)
    drawn++
  }
  return drawn
}

const hasObjectsCache = new WeakMap<SceneArt, boolean>()

/** Даёт ли графика хоть один спрайт объекта (перебор всех видов, гамм и вариантов SPRITE_LIMITS; кэш на графику). */
export function artHasObjects(art: SceneArt): boolean {
  let v = hasObjectsCache.get(art)
  if (v === undefined) {
    v = false
    for (const kind of Object.keys(SPRITE_LIMITS) as ObjectKind[]) {
      const { pals, variants } = SPRITE_LIMITS[kind]
      for (let pal = 0; pal < pals && !v; pal++) for (let vr = 0; vr < variants && !v; vr++) v = art.object(kind, pal, vr) !== null
      if (v) break
    }
    hasObjectsCache.set(art, v)
  }
  return v
}

/**
 * Плитки ступени lod с этой графикой заведомо пусты: на lod ≥ 1 мелочи и узора нет (§4.4), а без воды и спрайтов
 * объектов рисовать нечего («Бумага» на обзоре). На lod 0 ответ всегда false: мелочь земли перебором не проверить.
 */
export function tilesBlank(art: SceneArt, lod: number): boolean {
  return lod > 0 && !art.water && !artHasObjects(art)
}

/** Блик на воде — правило мокапа по номинальным арт-координатам: штрихи по 5 из 8 пикселей, редко. */
function dash(ax: number, ay: number): boolean {
  return (ax & 7) < 5 && hash2(ax >> 3, ay, 5) < 0.04
}

/** Подпись полян, от которых зависит плитка: ноды в границах плитки + TILE_MARGIN_PX·worldPerPx + CLEAR_REACH. */
export function tileSignature(ti: number, tj: number, step: LatticeStep, clearing: Clearing): number {
  return clearing.signature(expand(tileReach(ti, tj, step), CLEAR_REACH))
}
