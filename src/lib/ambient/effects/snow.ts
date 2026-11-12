/**
 * Снег (зима): точки, падающие по экрану. Привязан к экрану (screen), поверх нод. Формулы падения и покачивания — как
 * `drawFx` мокапа (скорость 10 + (i % 7)·3 арт-пикселей в секунду, качание ±8). Положения заданы в абсолютных
 * арт-пикселях от левого верхнего угла растра: колонки шириной CELL_W, в каждой снежинки падают по кругу с периодом
 * PERIOD_Y по вертикали (повторяются через PERIOD_Y строк). Поэтому смена размера растра (панель деталей сужает сцену,
 * окно меняет высоту) не двигает снежинки и не сбивает фазу падения, а шва посреди экрана нет, пока растр ниже PERIOD_Y.
 * Начальные места — от хеша колонки, чтобы при большом числе снежинок не вставала решётка. Чистая функция от f.t.
 */

import { ditherPx, hexColor } from '@/lib/ambient/raster'
import type { AmbientEffect } from '@/lib/ambient/types'
import { hash, rand, wrap } from '@/lib/pixelfx/math'

const SNOW = hexColor('#ffffff')
const SEED = 501
/** Ширина колонки и период падения, арт-пиксели. */
const CELL_W = 512
const PERIOD_Y = 1024
/** Одна снежинка на столько арт-пикселей: ~98 на растре 640×400 (1280×800 px при 100 %). */
const SNOW_AREA = 2600
const PER_CELL = Math.round((CELL_W * PERIOD_Y) / SNOW_AREA)
/** Покачивание по x, арт-пиксели. */
const SWAY = 8

/** Число снежинок на растр w×h (оценка по площади; рисуется по колонкам). */
export function snowCount(w: number, h: number): number {
  return Math.round((w * h) / SNOW_AREA)
}

export const snow: AmbientEffect = {
  id: 'snow',
  plane: 'over',
  anchor: 'screen',
  draw(out, f) {
    const { w, h } = out
    if (w === 0 || h === 0) return
    const t = f.t
    for (let cx = 0; cx * CELL_W - SWAY < w; cx++) {
      const seed = hash(SEED, cx)
      for (let i = 0; i < PER_CELL; i++) {
        const x = cx * CELL_W + rand(seed, i, 2) * CELL_W + SWAY * Math.sin(t * 0.6 + i)
        if (x < -SWAY - 2 || x >= w + 1) continue
        let y = wrap(rand(seed, i, 1) * PERIOD_Y + t * (10 + (i % 7) * 3), PERIOD_Y)
        // обычно одна копия; выше PERIOD_Y строк узор повторяется без шва
        for (; y < h; y += PERIOD_Y) {
          ditherPx(out, x, y, SNOW, i % 3 ? 0.9 : 0.75)
          // двухпиксельные — яркие (i % 3 === 1): бледные одиночные мигают реже, а заметных точек больше
          if (i % 3 === 1) ditherPx(out, x + 1, y, SNOW, 0.9)
        }
      }
    }
  },
}
