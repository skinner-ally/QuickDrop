import { useEffect, useRef } from 'react'
import { GRAPH_NODE_SIZE } from '@/lib/graphLayout'
import { smiteAbortAll, smiteFinished, smiteStruck, useSmite, type SmiteRun } from '@/lib/graph/smite'
import { useGraph } from '@/store/graph'
// pixelfx (MIT, lib/pixelfx-kit/LICENSE): ядро и эффект «казни» ноды
import { actSpan, clearFrame, composite, createAct, createFrame, painterFor } from '@/lib/pixelfx-kit/core/index.js'
import * as smite from '@/lib/pixelfx-kit/fx/moves/node-smite.js'

/** Последние секунды сцены гаснут: дым ещё висит, а рыцарь уже ушёл. */
const FADE_S = 0.5

interface Live {
  act: ReturnType<typeof createAct>
  opts: Record<string, unknown>
  die: number
  start: number
  end: number
}

/** Рыцарь проявляется за это время: он появляется в паре шагов от ноды, а не входит из-за края. */
const FADE_IN_S = 0.25

/** Размер «пикселя» сцены, CSS-пиксели: растёт с масштабом, но не мельче 2 (иначе рыцаря не разглядеть). */
const artPxOf = (zoom: number): number => Math.max(2, Math.round(2 * zoom))

/**
 * Сцена казни ноды поверх графа: свой canvas в низком разрешении (один пиксель — artPx CSS-пикселей), растянутый с
 * image-rendering: pixelated. Положение каждой сцены пересчитывается из мировой точки ноды на каждый кадр, так что
 * граф можно двигать и масштабировать во время сцены.
 */
export function GraphSmite() {
  const active = useSmite((s) => s.runs.length > 0)
  const ref = useRef<HTMLCanvasElement>(null)
  const lives = useRef(new Map<number, Live>())

  // Время сцен ведёт этот компонент: без него удар не наступит — при уходе с графа удаление доводится сразу.
  useEffect(
    () => () => {
      lives.current.clear()
      smiteAbortAll()
    },
    [],
  )

  useEffect(() => {
    if (!active) return
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const tmp = document.createElement('canvas')
    const tctx = tmp.getContext('2d')
    if (!tctx) return
    let raf = 0
    let last = performance.now()
    let frame = createFrame(1, 1)
    let img = new ImageData(1, 1)

    const liveFor = (run: SmiteRun, S: number): Live => {
      let l = lives.current.get(run.key)
      if (l) return l
      // свой акт у варианта с уклонением; эффект один и тот же, вариант — опцией dodge
      const mod = { ...smite, act: run.dodge ? smite.actDodge : smite.act }
      const opts = { x: 0, y: 0, color: run.color, edge: run.edge, node: S, dodge: run.dodge, seed: run.seed }
      // конец — когда рыцарь ушёл (последний ключ позы), а не когда рассеялся весь дым: дым гаснет вместе с ним
      const keys = mod.act.poses
      l = { act: createAct(mod, opts), opts, die: smite.deathAt(run.dodge), start: actSpan(mod).from, end: keys[keys.length - 1][0] }
      lives.current.set(run.key, l)
      return l
    }

    /**
     * Время сцен — по настоящим часам, шагами не больше 1/30 с (предел — секунда за вызов). Зовут и кадры, и таймер:
     * в скрытой или фоновой вкладке кадров нет вовсе, а запись должна уйти в корзину вовремя и сцена — кончиться.
     */
    const step = (now: number) => {
      const dt = Math.min(1, Math.max(0, (now - last) / 1000))
      last = now
      const S = Math.max(4, Math.round((GRAPH_NODE_SIZE * useGraph.getState().camera.zoom) / artPxOf(useGraph.getState().camera.zoom)))
      for (const run of useSmite.getState().runs) {
        const l = liveFor(run, S)
        for (let left = dt; left > 1e-6; left -= 1 / 30) l.act.update(Math.min(1 / 30, left))
        if (!run.struck && l.act.t >= l.die) smiteStruck(run.key)
        if (l.act.t >= l.end) {
          lives.current.delete(run.key)
          smiteFinished(run.key)
        }
      }
    }
    const timer = window.setInterval(() => {
      const now = performance.now()
      if (now - last > 150) step(now)
    }, 200)

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      step(now)
      const { camera, viewSize } = useGraph.getState()
      const runs = useSmite.getState().runs
      const a = artPxOf(camera.zoom)
      const W = Math.max(1, Math.ceil(viewSize.width / a))
      const H = Math.max(1, Math.ceil(viewSize.height / a))
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W
        canvas.height = H
        canvas.style.width = `${W * a}px`
        canvas.style.height = `${H * a}px`
      }
      if (frame.w !== W || frame.h !== H) {
        frame = createFrame(W, H)
        img = new ImageData(W, H)
        tmp.width = W
        tmp.height = H
      }
      ctx.clearRect(0, 0, W, H)

      for (const run of runs) {
        const l = lives.current.get(run.key)
        if (!l) continue
        const t = l.act.t
        // ноги рыцаря: нода стоит в TX от них, её центр — на S/2 выше земли
        const ax = ((run.at.x - camera.x) * camera.zoom + viewSize.width / 2) / a
        const ay = ((run.at.y - camera.y) * camera.zoom + viewSize.height / 2) / a
        const X = Math.round(ax - smite.TX)
        const Y = Math.round(ay + (l.opts.node as number) / 2)
        frame.ox = -X
        frame.oy = -Y
        // пока рыцарь идёт, эффект ещё не начался: ноду рисуем сами и отдельно — она не проявляется вместе с ним
        if (t < 0) {
          clearFrame(frame)
          smite.drawNodeIdle(painterFor(frame).place(0, 0, false), l.opts)
          composite(frame, img.data, null)
          tctx.putImageData(img, 0, 0)
          ctx.drawImage(tmp, 0, 0)
        }
        clearFrame(frame)
        l.act.draw(frame)
        composite(frame, img.data, null)
        tctx.putImageData(img, 0, 0)
        const [sx, sy] = l.act.shake
        const fadeIn = (t - l.start) / FADE_IN_S
        const fadeOut = (l.end - t) / FADE_S
        ctx.globalAlpha = Math.max(0, Math.min(1, fadeIn, fadeOut))
        ctx.drawImage(tmp, sx, sy)
        ctx.globalAlpha = 1
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(timer)
    }
  }, [active])

  if (!active) return null
  return (
    <canvas
      ref={ref}
      aria-hidden
      data-graph-smite
      className="pointer-events-none absolute top-0 left-0 z-[5]"
      style={{ imageRendering: 'pixelated' }}
    />
  )
}
