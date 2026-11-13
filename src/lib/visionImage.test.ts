import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  VISION_JPEG_QUALITY,
  VISION_MAX_IMAGE_BYTES,
  VISION_MAX_SIDE,
  VISION_MAX_SOURCE_BYTES,
  VISION_MIN_SIDE,
  VISION_PDF_MAX_PAGES,
} from './ocrState'
import type { DecodedImage, RasterBackend } from './visionImage'
import { VISION_PNG_MAX_BYTES, VISION_SHRINK_STEPS, planVisionSize, planVisionTiles, prepareVisionImage } from './visionImage'

const mocks = vi.hoisted(() => ({ toImageBlob: vi.fn<(blob: Blob) => Promise<Blob | undefined>>() }))

// Растеризация SVG (canvas + Image) в Node недоступна — подменяется; classifyBlobType настоящий.
vi.mock('@/components/items/safeFileUrl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/items/safeFileUrl')>()),
  toImageBlob: mocks.toImageBlob,
}))

beforeEach(() => {
  mocks.toImageBlob.mockReset()
})

interface EncodeCall {
  width: number
  height: number
  type: string
  quality?: number
}

/**
 * Растровый слой-подделка: размеры картинки — из содержимого Blob («ширина×высота»), размер
 * результата кодирования задаёт тест.
 */
function fakeBackend(sizeOf: (call: EncodeCall) => number = () => 1000) {
  const state = { decoded: 0, closed: 0, encodes: [] as EncodeCall[] }
  const backend: RasterBackend = {
    async decode(blob: Blob): Promise<DecodedImage> {
      const text = await blob.text()
      const m = /^(\d+)x(\d+)$/.exec(text)
      if (!m) throw new Error('не картинка')
      state.decoded++
      return {
        width: Number(m[1]),
        height: Number(m[2]),
        close: () => {
          state.closed++
        },
      }
    },
    async encode(_image, width, height, type, quality) {
      const call = { width, height, type, quality }
      state.encodes.push(call)
      return new Blob([new Uint8Array(sizeOf(call))], { type })
    },
  }
  return { backend, state }
}

const picture = (width: number, height: number, type = 'image/png') => new Blob([`${width}x${height}`], { type })

describe('planVisionSize', () => {
  it('большая сторона — не больше 2000, пропорции сохранены', () => {
    expect(planVisionSize(4000, 3000)).toEqual({ width: 2000, height: 1500 })
    expect(planVisionSize(3000, 6000)).toEqual({ width: 1000, height: 2000 })
    expect(planVisionSize(2001, 1000)).toEqual({ width: 2000, height: 1000 })
    expect(planVisionSize(4000, 3000, 1200)).toEqual({ width: 1200, height: 900 })
    expect(VISION_MAX_SIDE).toBe(2000)
  })

  it('без увеличения', () => {
    expect(planVisionSize(800, 600)).toEqual({ width: 800, height: 600 })
    expect(planVisionSize(2000, 2000)).toEqual({ width: 2000, height: 2000 })
  })

  it('сторона меньше 24 px (исходная или после уменьшения) — null', () => {
    expect(planVisionSize(VISION_MIN_SIDE, VISION_MIN_SIDE)).toEqual({ width: 24, height: 24 })
    expect(planVisionSize(23, 500)).toBeNull()
    expect(planVisionSize(500, 23)).toBeNull()
    // 6000×60 → 2000×20
    expect(planVisionSize(6000, 60)).toBeNull()
  })

  it('негодные размеры — null', () => {
    expect(planVisionSize(0, 100)).toBeNull()
    expect(planVisionSize(-5, 100)).toBeNull()
    expect(planVisionSize(Number.NaN, 100)).toBeNull()
    expect(planVisionSize(100, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('planVisionTiles', () => {
  it('обычная картинка — одна полоса размера planVisionSize', () => {
    expect(planVisionTiles(800, 600)).toEqual([{ source: { x: 0, y: 0, width: 800, height: 600 }, width: 800, height: 600 }])
    expect(planVisionTiles(4000, 3000)).toEqual([
      { source: { x: 0, y: 0, width: 4000, height: 3000 }, width: 2000, height: 1500 },
    ])
    // скриншот телефона (1:2,2) режется не надо
    expect(planVisionTiles(1080, 2400)).toHaveLength(1)
    expect(planVisionTiles(20, 400)).toBeNull()
    expect(planVisionTiles(0, 100)).toBeNull()
  })

  it('длинный скриншот 1080×12000: не больше 5 полос шириной ≥ 800, высотой ≤ 2000, с перекрытием, до конца', () => {
    const tiles = planVisionTiles(1080, 12000)!
    expect(tiles.length).toBeGreaterThan(1)
    expect(tiles.length).toBeLessThanOrEqual(VISION_PDF_MAX_PAGES)
    for (const t of tiles) {
      expect(t.width).toBeGreaterThanOrEqual(800)
      expect(t.height).toBeLessThanOrEqual(VISION_MAX_SIDE)
      expect(t.source.x).toBe(0)
      expect(t.source.width).toBe(1080)
    }
    expect(tiles[0].source.y).toBe(0)
    for (let i = 1; i < tiles.length; i++) {
      const prev = tiles[i - 1].source
      expect(tiles[i].source.y).toBeLessThan(prev.y + prev.height)
    }
    const last = tiles.at(-1)!.source
    expect(last.y + last.height).toBe(12000)
  })

  it('1280×9000 — полосы в исходном масштабе (короткая сторона без уменьшения)', () => {
    const tiles = planVisionTiles(1280, 9000)!
    expect(tiles).toHaveLength(5)
    for (const t of tiles) {
      expect(t.width).toBe(1280)
      expect(t.height).toBeLessThanOrEqual(VISION_MAX_SIDE)
    }
  })

  it('широкая панорама режется по ширине', () => {
    const tiles = planVisionTiles(9000, 1000)!
    expect(tiles.length).toBeGreaterThan(1)
    for (const t of tiles) {
      expect(t.height).toBe(1000)
      expect(t.width).toBeLessThanOrEqual(VISION_MAX_SIDE)
      expect(t.source.y).toBe(0)
    }
  })
})

describe('prepareVisionImage', () => {
  it('длинный скриншот — полосы (tiles) из частей исходника, bitmap закрыт', async () => {
    const calls: Array<{ width: number; height: number; source?: { y: number; height: number } }> = []
    const { backend, state } = fakeBackend(() => 200_000)
    const encode = backend.encode
    backend.encode = (image, width, height, type, quality, source) => {
      calls.push({ width, height, source })
      return encode(image, width, height, type, quality, source)
    }
    const out = await prepareVisionImage(picture(1080, 12000), { backend })
    expect(out.status).toBe('tiles')
    if (out.status !== 'tiles') throw new Error('ожидались полосы')
    expect(out.images.length).toBeGreaterThan(1)
    expect(out.images.every((b) => b.type === 'image/png')).toBe(true)
    expect(calls.every((c) => c.source !== undefined && c.height <= VISION_MAX_SIDE)).toBe(true)
    expect(state.closed).toBe(1)
  })

  it('полоса не укладывается в 4 МБ ни при каком качестве — failed', async () => {
    const { backend } = fakeBackend(() => VISION_MAX_IMAGE_BYTES + 1)
    expect(await prepareVisionImage(picture(1080, 12000, 'image/jpeg'), { backend })).toEqual({
      status: 'failed',
      error: 'Изображение слишком большое для распознавания',
    })
  })

  it('исходник больше 30 МБ — failed без декодирования', async () => {
    const { backend, state } = fakeBackend()
    const huge = { size: VISION_MAX_SOURCE_BYTES + 1, type: 'image/png' } as Blob
    expect(await prepareVisionImage(huge, { backend })).toEqual({
      status: 'failed',
      error: 'Файл больше 30 МБ — не распознаётся',
    })
    expect(state.decoded).toBe(0)
  })

  it('формат не растровый и не SVG — failed; тип берётся у самого Blob', async () => {
    const { backend, state } = fakeBackend()
    for (const type of ['image/heic', 'image/tiff', 'application/pdf', 'text/html', '']) {
      expect(await prepareVisionImage(picture(100, 100, type), { backend })).toEqual({
        status: 'failed',
        error: 'Формат изображения не поддерживается',
      })
    }
    expect(state.decoded).toBe(0)
  })

  it('не декодируется — failed «Не удалось прочитать изображение»', async () => {
    const { backend } = fakeBackend()
    expect(await prepareVisionImage(new Blob(['мусор'], { type: 'image/jpeg' }), { backend })).toEqual({
      status: 'failed',
      error: 'Не удалось прочитать изображение',
    })
  })

  it('слишком маленькая — too-small, bitmap закрыт', async () => {
    const { backend, state } = fakeBackend()
    expect(await prepareVisionImage(picture(20, 400), { backend })).toEqual({ status: 'too-small' })
    expect(state.closed).toBe(1)
    expect(state.encodes).toEqual([])
  })

  it('PNG-скриншот, PNG укладывается в 1,5 МБ — PNG того же размера', async () => {
    const { backend, state } = fakeBackend(() => 200_000)
    const out = await prepareVisionImage(picture(2560, 1440), { backend })
    expect(out).toMatchObject({ status: 'ok', width: 2000, height: 1125 })
    if (out.status !== 'ok') throw new Error('ожидался ok')
    expect(out.image.type).toBe('image/png')
    expect(state.encodes).toEqual([{ width: 2000, height: 1125, type: 'image/png', quality: undefined }])
    expect(state.closed).toBe(1)
  })

  it('PNG больше 1,5 МБ — JPEG при качестве 0.85', async () => {
    const { backend, state } = fakeBackend((c) => (c.type === 'image/png' ? VISION_PNG_MAX_BYTES + 1 : 900_000))
    const out = await prepareVisionImage(picture(1000, 800, 'image/gif'), { backend })
    expect(out).toMatchObject({ status: 'ok', width: 1000, height: 800 })
    if (out.status !== 'ok') throw new Error('ожидался ok')
    expect(out.image.type).toBe('image/jpeg')
    expect(state.encodes.map((c) => c.type)).toEqual(['image/png', 'image/jpeg'])
    expect(state.encodes[1].quality).toBe(VISION_JPEG_QUALITY)
  })

  it('фото (JPEG, WebP) — сразу JPEG, PNG не пробуется', async () => {
    for (const type of ['image/jpeg', 'image/webp', 'image/avif']) {
      const { backend, state } = fakeBackend()
      const out = await prepareVisionImage(picture(4000, 3000, type), { backend })
      expect(out).toMatchObject({ status: 'ok', width: 2000, height: 1500 })
      expect(state.encodes).toEqual([{ width: 2000, height: 1500, type: 'image/jpeg', quality: VISION_JPEG_QUALITY }])
    }
  })

  it('ступени уменьшения: (2000, 0.7) → (1600, 0.7) → (1200, 0.6), пока не уложится в 4 МБ', async () => {
    expect(VISION_SHRINK_STEPS).toEqual([
      { side: 2000, quality: 0.7 },
      { side: 1600, quality: 0.7 },
      { side: 1200, quality: 0.6 },
    ])
    const { backend, state } = fakeBackend((c) =>
      c.width <= 1600 ? VISION_MAX_IMAGE_BYTES : VISION_MAX_IMAGE_BYTES + 1,
    )
    const out = await prepareVisionImage(picture(4000, 3000, 'image/jpeg'), { backend })
    expect(out).toMatchObject({ status: 'ok', width: 1600, height: 1200 })
    expect(state.encodes.map((c) => [c.width, c.quality])).toEqual([
      [2000, VISION_JPEG_QUALITY],
      [2000, 0.7],
      [1600, 0.7],
    ])
    expect(state.closed).toBe(1)
  })

  it('не уложилось ни на одной ступени — failed; одинаковые попытки не повторяются', async () => {
    const { backend, state } = fakeBackend(() => VISION_MAX_IMAGE_BYTES + 1)
    expect(await prepareVisionImage(picture(1000, 800, 'image/jpeg'), { backend })).toEqual({
      status: 'failed',
      error: 'Изображение слишком большое для распознавания',
    })
    // 1000 px меньше всех ступеней: 0.85, 0.7 (2000), 0.7 (1600) — то же самое, пропуск; 0.6 (1200)
    expect(state.encodes.map((c) => [c.width, c.quality])).toEqual([
      [1000, VISION_JPEG_QUALITY],
      [1000, 0.7],
      [1000, 0.6],
    ])
    expect(state.closed).toBe(1)
  })

  it('SVG — растеризованная копия (как для показа), дальше как PNG', async () => {
    mocks.toImageBlob.mockResolvedValueOnce(picture(800, 600, 'image/png'))
    const { backend, state } = fakeBackend()
    const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: 'image/svg+xml' })
    const out = await prepareVisionImage(svg, { backend })
    expect(out).toMatchObject({ status: 'ok', width: 800, height: 600 })
    expect(mocks.toImageBlob).toHaveBeenCalledWith(svg)
    expect(state.encodes[0].type).toBe('image/png')

    mocks.toImageBlob.mockResolvedValueOnce(undefined)
    expect(await prepareVisionImage(svg, { backend })).toEqual({
      status: 'failed',
      error: 'Не удалось прочитать изображение',
    })
  })

  it('сбой кодирования — исключение (временная ошибка), bitmap всё равно закрыт', async () => {
    const { backend, state } = fakeBackend()
    backend.encode = async () => {
      throw new Error('нет памяти')
    }
    await expect(prepareVisionImage(picture(800, 600, 'image/jpeg'), { backend })).rejects.toThrow('нет памяти')
    expect(state.closed).toBe(1)
  })

  it('без canvas и createImageBitmap (Node) рабочий слой отвечает «не удалось прочитать»', async () => {
    expect(await prepareVisionImage(picture(800, 600, 'image/jpeg'))).toEqual({
      status: 'failed',
      error: 'Не удалось прочитать изображение',
    })
  })
})
