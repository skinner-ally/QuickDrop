import { useEffect, useState } from 'react'
import { getFile } from '@/db/repo'

/** Растровые типы, которые безопасно отдавать в <img> и по blob-адресу. */
const RASTER = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp'])
const MAX_SVG_SIDE = 2048

export type BlobClass = 'raster' | 'svg' | 'pdf' | 'other'

/** Класс определяется по типу самого Blob, а не по полям записи (они приходят и из чужой копии). */
export function classifyBlobType(type: string): BlobClass {
  const t = type.split(';')[0].trim().toLowerCase()
  if (RASTER.has(t)) return 'raster'
  if (t === 'image/svg+xml') return 'svg'
  if (t === 'application/pdf') return 'pdf'
  return 'other'
}

/**
 * SVG может нести скрипты: blob-документ, открытый в новой вкладке, исполнился бы в origin приложения.
 * Поэтому показываем растеризованную копию (в <img> скрипты не выполняются).
 */
async function rasterizeSvg(blob: Blob): Promise<Blob | undefined> {
  const src = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('svg'))
      img.src = src
    })
    let w = img.naturalWidth || 1024
    let h = img.naturalHeight || 1024
    const k = Math.min(1, MAX_SVG_SIDE / Math.max(w, h))
    w = Math.max(1, Math.round(w * k))
    h = Math.max(1, Math.round(h * k))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')?.drawImage(img, 0, 0, w, h)
    return await new Promise<Blob | undefined>((resolve) => canvas.toBlob((b) => resolve(b ?? undefined), 'image/png'))
  } catch {
    return undefined
  } finally {
    URL.revokeObjectURL(src)
  }
}

/** Blob, который можно показать в <img>, или undefined. */
export async function toImageBlob(blob: Blob): Promise<Blob | undefined> {
  switch (classifyBlobType(blob.type)) {
    case 'raster':
      return blob
    case 'svg':
      return rasterizeSvg(blob)
    default:
      // Неизвестный тип (text/html и т.п.): без исполняемого типа — <img> всё равно распознаёт растр по содержимому.
      return new Blob([blob], { type: 'application/octet-stream' })
  }
}

/** objectURL изображения (или миниатюры) с безопасным типом. */
export function useImageUrl(fileId: string | undefined, kind: 'thumb' | 'full'): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    setUrl(undefined)
    if (!fileId) return
    let cancelled = false
    let created: string | undefined
    void getFile(fileId)
      .then(async (file) => {
        if (cancelled || !file) return
        const src = kind === 'thumb' && file.thumb ? file.thumb : file.blob
        const safe = await toImageBlob(src)
        if (cancelled || !safe) return
        created = URL.createObjectURL(safe)
        setUrl(created)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [fileId, kind])
  return url
}

/** objectURL для кнопки «Открыть» — только если сам Blob является PDF. */
export function usePdfUrl(fileId: string | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    setUrl(undefined)
    if (!fileId) return
    let cancelled = false
    let created: string | undefined
    void getFile(fileId)
      .then((file) => {
        if (cancelled || !file || classifyBlobType(file.blob.type) !== 'pdf') return
        created = URL.createObjectURL(new Blob([file.blob], { type: 'application/pdf' }))
        setUrl(created)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [fileId])
  return url
}
