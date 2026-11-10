import { useEffect, useState } from 'react'
import {
  Download,
  ExternalLink,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getFile } from '@/db/repo'
import { actDownload } from '@/lib/actions'
import { formatBytes } from '@/lib/itemTitle'
import { cn } from '@/lib/utils'
import type { Item } from '@/types'
import { useImageUrl, usePdfUrl } from './safeFileUrl'

const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'yaml', 'yml', 'xml', 'ini', 'toml'])
const MAX_TEXT_BYTES = 200 * 1024

function extOf(name: string | undefined): string {
  const m = /\.([^./\\]+)$/.exec(name ?? '')
  return m ? m[1].toLowerCase() : ''
}

function iconFor(ext: string, mime: string): LucideIcon {
  if (mime.startsWith('image/')) return FileImage
  if (mime.startsWith('audio/')) return FileAudio
  if (mime.startsWith('video/')) return FileVideo
  if (['zip', 'rar', '7z', 'tar', 'gz', 'tgz'].includes(ext)) return FileArchive
  if (['xls', 'xlsx', 'csv', 'tsv', 'ods'].includes(ext)) return FileSpreadsheet
  if (['js', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'html', 'css', 'json', 'xml', 'sh'].includes(ext))
    return FileCode
  if (['txt', 'md', 'pdf', 'doc', 'docx', 'rtf', 'odt', 'log'].includes(ext)) return FileText
  return FileIcon
}

function isTextual(item: Item, ext: string): boolean {
  const mime = item.mimeType ?? ''
  return (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    TEXT_EXT.has(ext)
  )
}

function ImagePreview({ item, variant }: { item: Item; variant: 'thumb' | 'full' }) {
  const url = useImageUrl(item.fileId, variant === 'thumb' ? 'thumb' : 'full')
  const [loaded, setLoaded] = useState(false)
  useEffect(() => setLoaded(false), [url])
  const thumb = variant === 'thumb'
  return (
    <div className={cn('relative overflow-hidden', thumb ? 'size-full min-h-16 bg-muted' : 'rounded-lg bg-muted/50')}>
      {!loaded && <div className={cn('animate-pulse bg-muted', thumb ? 'absolute inset-0' : 'h-48 w-full')} aria-hidden />}
      {url && (
        <img
          src={url}
          alt={item.title || item.fileName || 'Изображение'}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
          draggable={false}
          className={cn(
            'transition-opacity duration-150',
            thumb ? 'size-full object-cover' : 'mx-auto max-h-[70vh] w-auto max-w-full object-contain',
            loaded ? 'opacity-100' : 'opacity-0',
            !loaded && !thumb && 'absolute inset-0',
          )}
        />
      )}
    </div>
  )
}

function FileTextBody({ item }: { item: Item }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setText(null)
    if (!item.fileId) return
    void getFile(item.fileId)
      .then((f) => (f && f.blob.size <= MAX_TEXT_BYTES ? f.blob.text() : null))
      .then((t) => {
        if (!cancelled) setText(t)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [item.fileId])
  if (text === null) return null
  return (
    <pre
      tabIndex={0}
      aria-label="Содержимое файла"
      className="max-h-80 overflow-auto rounded-lg border border-border bg-muted/50 px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words"
    >
      {text}
    </pre>
  )
}

function GenericFile({ item, variant }: { item: Item; variant: 'thumb' | 'full' }) {
  const ext = extOf(item.fileName)
  const mime = item.mimeType ?? ''
  const Icon = iconFor(ext, mime)
  const isPdf = mime === 'application/pdf' || ext === 'pdf'
  // «Открыть» — только если сам Blob является PDF: тип в записи и расширение имени могут быть подделаны.
  const pdfUrl = usePdfUrl(variant === 'full' && isPdf ? item.fileId : undefined)

  if (variant === 'thumb') {
    return (
      <div className="flex size-full min-h-16 flex-col items-center justify-center gap-1 bg-muted text-muted-foreground">
        <Icon size={24} strokeWidth={1.5} aria-hidden />
        {ext && <span className="text-xs">.{ext}</span>}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-3">
        <Icon size={28} strokeWidth={1.5} className="shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{item.fileName || item.title || 'Файл'}</div>
          {item.fileSize !== undefined && (
            <div className="text-xs text-muted-foreground">{formatBytes(item.fileSize)}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {pdfUrl && (
            <Button variant="ghost" size="sm" render={<a href={pdfUrl} target="_blank" rel="noopener noreferrer" />}>
              <ExternalLink strokeWidth={1.75} className="size-4" aria-hidden />
              Открыть
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void actDownload(item)}>
            <Download strokeWidth={1.75} className="size-4" aria-hidden />
            Скачать
          </Button>
        </div>
      </div>
      {isTextual(item, ext) && <FileTextBody item={item} />}
    </div>
  )
}

export function FilePreview({ item, variant }: { item: Item; variant: 'thumb' | 'full' }) {
  if (item.type === 'image') return <ImagePreview item={item} variant={variant} />
  return <GenericFile item={item} variant={variant} />
}
