import { classifyBlobType, toImageBlob } from '@/components/items/safeFileUrl'
import {
  VISION_JPEG_QUALITY,
  VISION_MAX_IMAGE_BYTES,
  VISION_MAX_SIDE,
  VISION_MAX_SOURCE_BYTES,
  VISION_MIN_SIDE,
  VISION_PDF_MAX_PAGES,
} from './ocrState'

/** PNG берётся вместо JPEG, если исходник без потерь и PNG не больше этого: скриншоты так читаются лучше. */
export const VISION_PNG_MAX_BYTES = 1.5 * 1024 * 1024

/** Ступени уменьшения, когда JPEG при обычном качестве больше VISION_MAX_IMAGE_BYTES. */
export const VISION_SHRINK_STEPS: ReadonlyArray<{ side: number; quality: number }> = [
  { side: 2000, quality: 0.7 },
  { side: 1600, quality: 0.7 },
  { side: 1200, quality: 0.6 },
]

const ERR_SOURCE_TOO_BIG = 'Файл больше 30 МБ — не распознаётся'
const ERR_FORMAT = 'Формат изображения не поддерживается'
const ERR_READ = 'Не удалось прочитать изображение'
const ERR_TOO_BIG = 'Изображение слишком большое для распознавания'
const ERR_ENCODE = 'Не удалось подготовить изображение'

/** Форматы без потерь: для них сначала пробуется PNG. */
const LOSSLESS = new Set(['image/png', 'image/gif', 'image/bmp'])

/** Декодированная картинка; close() освобождает память (ImageBitmap подходит как есть). */
export interface DecodedImage {
  readonly width: number
  readonly height: number
  close(): void
}

/** Растровый слой: в vitest нет ни canvas, ни createImageBitmap, поэтому он подменяется. */
export interface RasterBackend {
  /** Бросает, если картинка не декодируется. Ориентацию EXIF учитывает движок; у GIF — первый кадр. */
  decode(blob: Blob): Promise<DecodedImage>
  /**
   * Рисует картинку (или её часть source в пикселях исходника) в размер width×height на белом фоне и кодирует.
   * Бросает при сбое кодирования.
   */
  encode(
    image: DecodedImage,
    width: number,
    height: number,
    type: 'image/jpeg' | 'image/png',
    quality?: number,
    source?: SourceRect,
  ): Promise<Blob>
}

export interface SourceRect {
  x: number
  y: number
  width: number
  height: number
}

export type PreparedImage =
  | { status: 'ok'; image: Blob; width: number; height: number }
  /** Вытянутая картинка (длинный скриншот), разрезанная на полосы по длинной стороне; порядок — порядок чтения. */
  | { status: 'tiles'; images: Blob[] }
  | { status: 'too-small' }
  /** Неустранимо для этого файла. */
  | { status: 'failed'; error: string }

/**
 * Длинная сторона больше короткой во столько раз — картинка режется на полосы: уменьшение целиком до
 * VISION_MAX_SIDE сделало бы текст нечитаемым (1080×12000 → 180×2000).
 */
export const VISION_TILE_RATIO = 3
/** Перекрытие соседних полос (px результата): строка на границе целиком попадает хотя бы в одну. */
export const VISION_TILE_OVERLAP = 80

/** Полоса: часть исходника (source) и размер результата. */
export interface VisionTile {
  source: SourceRect
  width: number
  height: number
}

/**
 * План нарезки. Обычная картинка — одна полоса размера planVisionSize. Вытянутая (сторон больше
 * VISION_TILE_RATIO) — короткая сторона до maxSide (без увеличения), длинная — полосами не длиннее maxSide
 * с перекрытием overlap; полос не больше maxTiles: если не укладывается, картинка уменьшается сильнее.
 * null — распознавать нечего (сторона меньше VISION_MIN_SIDE) или размеры негодные.
 */
export function planVisionTiles(
  width: number,
  height: number,
  maxSide: number = VISION_MAX_SIDE,
  overlap: number = VISION_TILE_OVERLAP,
  maxTiles: number = VISION_PDF_MAX_PAGES,
): VisionTile[] | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const side = Number.isFinite(maxSide) && maxSide > 0 ? maxSide : VISION_MAX_SIDE
  const short = Math.min(width, height)
  const long = Math.max(width, height)
  if (long / short <= VISION_TILE_RATIO) {
    const size = planVisionSize(width, height, side)
    return size ? [{ source: { x: 0, y: 0, width, height }, ...size }] : null
  }
  const lap = Math.max(0, Math.min(Math.floor(side / 4), Number.isFinite(overlap) ? overlap : VISION_TILE_OVERLAP))
  const step = side - lap
  const most = Math.max(1, Math.floor(Number.isFinite(maxTiles) ? maxTiles : VISION_PDF_MAX_PAGES))
  let k = Math.min(1, side / short)
  // Не больше most полос: длинная сторона результата — не больше most·step + lap.
  k = Math.min(k, (most * step + lap) / long)
  const outShort = Math.round(short * k)
  const outLong = long * k
  if (outShort < VISION_MIN_SIDE) return null
  const count = outLong <= side ? 1 : Math.min(most, Math.ceil((outLong - lap) / step - 1e-9))
  const srcLen = Math.min(long, side / k)
  const srcStep = step / k
  const tiles: VisionTile[] = []
  for (let i = 0; i < count; i++) {
    // Последняя полоса прижата к концу: она полной длины, перекрытие с предыдущей — больше.
    const start = Math.max(0, Math.min(Math.floor(i * srcStep), Math.floor(long - srcLen)))
    const len = Math.min(long - start, Math.ceil(srcLen))
    const out = Math.max(1, Math.min(side, Math.round(len * k)))
    tiles.push(
      height >= width
        ? { source: { x: 0, y: start, width, height: len }, width: outShort, height: out }
        : { source: { x: start, y: 0, width: len, height }, width: out, height: outShort },
    )
  }
  return tiles
}

/**
 * Размер для отправки: большая сторона ≤ maxSide, без увеличения, пропорции сохранены.
 * null — любая сторона (исходная или итоговая) меньше VISION_MIN_SIDE: распознавать нечего.
 */
export function planVisionSize(
  width: number,
  height: number,
  maxSide: number = VISION_MAX_SIDE,
): { width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const side = Number.isFinite(maxSide) && maxSide > 0 ? maxSide : VISION_MAX_SIDE
  const k = Math.min(1, side / Math.max(width, height))
  const w = Math.max(1, Math.round(width * k))
  const h = Math.max(1, Math.round(height * k))
  if (w < VISION_MIN_SIDE || h < VISION_MIN_SIDE) return null
  return { width: w, height: h }
}

const baseType = (type: string): string => type.split(';')[0].trim().toLowerCase()

/**
 * Готовит картинку к отправке модели: уменьшение до VISION_MAX_SIDE, белый фон вместо прозрачности,
 * PNG (без потерь, если укладывается в VISION_PNG_MAX_BYTES) или JPEG со ступенями уменьшения.
 * SVG отправляется растеризованной копией (тем же кодом, что для показа).
 * Сбой кодирования (нет canvas, нехватка памяти) — исключение: это не свойство файла, повтор возможен.
 */
export async function prepareVisionImage(
  blob: Blob,
  options: { backend?: RasterBackend } = {},
): Promise<PreparedImage> {
  if (blob.size > VISION_MAX_SOURCE_BYTES) return { status: 'failed', error: ERR_SOURCE_TOO_BIG }
  const backend = options.backend ?? browserBackend

  const kind = classifyBlobType(blob.type)
  let source: Blob
  if (kind === 'raster') {
    source = blob
  } else if (kind === 'svg') {
    const raster = await toImageBlob(blob)
    if (!raster || classifyBlobType(raster.type) !== 'raster') return { status: 'failed', error: ERR_READ }
    source = raster
  } else {
    return { status: 'failed', error: ERR_FORMAT }
  }

  let image: DecodedImage
  try {
    image = await backend.decode(source)
  } catch {
    return { status: 'failed', error: ERR_READ }
  }
  try {
    const lossless = kind === 'svg' || LOSSLESS.has(baseType(blob.type))
    const tiles = planVisionTiles(image.width, image.height)
    if (!tiles) return { status: 'too-small' }
    if (tiles.length > 1) {
      const images: Blob[] = []
      for (const tile of tiles) {
        const part = await encodeTile(backend, image, tile, lossless)
        if (!part) return { status: 'failed', error: ERR_TOO_BIG }
        images.push(part)
      }
      return { status: 'tiles', images }
    }
    const size = planVisionSize(image.width, image.height)
    if (!size) return { status: 'too-small' }

    if (lossless) {
      const png = await backend.encode(image, size.width, size.height, 'image/png')
      if (png.size <= VISION_PNG_MAX_BYTES) return { status: 'ok', image: png, ...size }
    }

    const steps = [{ side: VISION_MAX_SIDE, quality: VISION_JPEG_QUALITY }, ...VISION_SHRINK_STEPS]
    let tried = ''
    for (const step of steps) {
      const next = planVisionSize(image.width, image.height, step.side)
      if (!next) break
      // Маленькая картинка на крупной ступени даёт тот же размер — тот же JPEG второй раз не кодируется.
      const key = `${next.width}x${next.height}@${step.quality}`
      if (key === tried) continue
      tried = key
      const jpeg = await backend.encode(image, next.width, next.height, 'image/jpeg', step.quality)
      if (jpeg.size <= VISION_MAX_IMAGE_BYTES) return { status: 'ok', image: jpeg, ...next }
    }
    return { status: 'failed', error: ERR_TOO_BIG }
  } finally {
    image.close()
  }
}

/**
 * Одна полоса: PNG для исходников без потерь, если укладывается в VISION_PNG_MAX_BYTES, иначе JPEG с понижением
 * качества (размер полосы не меняется — он уже выбран планом). undefined — не уложилось в VISION_MAX_IMAGE_BYTES.
 */
async function encodeTile(
  backend: RasterBackend,
  image: DecodedImage,
  tile: VisionTile,
  lossless: boolean,
): Promise<Blob | undefined> {
  if (lossless) {
    const png = await backend.encode(image, tile.width, tile.height, 'image/png', undefined, tile.source)
    if (png.size <= VISION_PNG_MAX_BYTES) return png
  }
  const qualities = [VISION_JPEG_QUALITY, ...new Set(VISION_SHRINK_STEPS.map((s) => s.quality))]
  for (const quality of qualities) {
    const jpeg = await backend.encode(image, tile.width, tile.height, 'image/jpeg', quality, tile.source)
    if (jpeg.size <= VISION_MAX_IMAGE_BYTES) return jpeg
  }
  return undefined
}

// ───────────────────────── растровый слой браузера ─────────────────────────

type Ctx2d = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function paint(ctx: Ctx2d, image: DecodedImage, width: number, height: number, source?: SourceRect): void {
  ctx.fillStyle = 'white'
  ctx.fillRect(0, 0, width, height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (source) {
    ctx.drawImage(image as ImageBitmap, source.x, source.y, source.width, source.height, 0, 0, width, height)
  } else {
    ctx.drawImage(image as ImageBitmap, 0, 0, width, height)
  }
}

/** Тот же порядок, что repo.scaleBitmap: OffscreenCanvas, иначе холст документа. */
const browserBackend: RasterBackend = {
  async decode(blob) {
    if (typeof createImageBitmap !== 'function') throw new Error(ERR_READ)
    return createImageBitmap(blob)
  },
  async encode(image, width, height, type, quality, source) {
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error(ERR_ENCODE)
      paint(ctx, image, width, height, source)
      const blob = await canvas.convertToBlob({ type, quality })
      if (blob.type !== type) throw new Error(ERR_ENCODE)
      return blob
    }
    if (typeof document === 'undefined') throw new Error(ERR_ENCODE)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    try {
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error(ERR_ENCODE)
      paint(ctx, image, width, height, source)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
      if (!blob || blob.type !== type) throw new Error(ERR_ENCODE)
      return blob
    } finally {
      canvas.width = 0
      canvas.height = 0
    }
  },
}
