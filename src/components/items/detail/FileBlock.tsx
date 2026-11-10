import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { actDownload } from '@/lib/actions'
import { formatBytes } from '@/lib/itemTitle'
import type { Item } from '@/types'
import { FilePreview } from '../FilePreview'
import { useImageUrl } from '../safeFileUrl'

function Lightbox({ item, open, onOpenChange }: { item: Item; open: boolean; onOpenChange: (o: boolean) => void }) {
  const url = useImageUrl(open ? item.fileId : undefined, 'full')
  const name = item.fileName || item.title || 'Изображение'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-0 left-0 flex h-dvh max-h-none w-screen max-w-none translate-x-0 translate-y-0 items-center justify-center rounded-none bg-black/90 p-4 text-white ring-0 sm:max-w-none">
        <DialogTitle className="sr-only">{name}</DialogTitle>
        <DialogDescription className="sr-only">Просмотр изображения</DialogDescription>
        {url && (
          <img
            src={url}
            alt={name}
            draggable={false}
            onClick={() => onOpenChange(false)}
            className="max-h-full max-w-full cursor-zoom-out object-contain"
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Файл или изображение: предпросмотр, сведения и скачивание. */
export function FileBlock({ item }: { item: Item }) {
  const [zoom, setZoom] = useState(false)
  const isImage = item.type === 'image'
  const info = [
    item.fileName,
    item.fileSize !== undefined ? formatBytes(item.fileSize) : undefined,
    item.mimeType,
  ].filter(Boolean)

  return (
    <div className="flex flex-col gap-2">
      {isImage ? (
        <button
          type="button"
          onClick={() => setZoom(true)}
          aria-label="Открыть изображение на весь экран"
          className="block w-full cursor-zoom-in rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <FilePreview item={item} variant="full" />
        </button>
      ) : (
        <FilePreview item={item} variant="full" />
      )}
      {isImage && <Lightbox item={item} open={zoom} onOpenChange={setZoom} />}
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {isImage ? info.join(' · ') : item.mimeType}
        </div>
        {isImage && (
          <Button variant="outline" size="sm" onClick={() => void actDownload(item)}>
            <Download strokeWidth={1.75} className="size-4" aria-hidden />
            Скачать
          </Button>
        )}
      </div>
    </div>
  )
}
