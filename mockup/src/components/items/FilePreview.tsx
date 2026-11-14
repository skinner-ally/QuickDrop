import { useEffect, useState } from 'react'
import { Icon, type IconName } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { getFile } from '@/db/repo'
import { actDownload } from '@/lib/actions'
import { formatBytes } from '@/lib/itemTitle'
import { isMarkdownFile } from '@/lib/markdown'
import { useUi } from '@/store/ui'
import { MarkdownText } from '@/components/markdown/MarkdownText'
import { ViewModeToggle } from '@/components/markdown/ViewModeToggle'
import { cn } from '@/lib/utils'
import type { Item } from '@/types'
import { useImageUrl, usePdfUrl } from './safeFileUrl'

const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'log', 'yaml', 'yml', 'xml', 'ini', 'toml'])
const MAX_TEXT_BYTES = 200 * 1024

function extOf(name: string | undefined): string {
  const m = /\.([^./\\]+)$/.exec(name ?? '')
  return m ? m[1].toLowerCase() : ''
}

function iconFor(ext: string, mime: string): IconName {
  if (mime.startsWith('image/')) return 'file-image'
  if (mime.startsWith('audio/')) return 'file-audio'
  if (mime.startsWith('video/')) return 'file-video'
  if (['zip', 'rar', '7z', 'tar', 'gz', 'tgz'].includes(ext)) return 'file-archive'
  if (['xls', 'xlsx', 'csv', 'tsv', 'ods'].includes(ext)) return 'file-spreadsheet'
  if (['js', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'html', 'css', 'json', 'xml', 'sh'].includes(ext))
    return 'file-code'
  if (['txt', 'md', 'pdf', 'doc', 'docx', 'rtf', 'odt', 'log'].includes(ext)) return 'file-text'
  return 'file'
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
      {!loaded && <div className={cn('animate-pulse bg-muted pixel:animate-none', thumb ? 'absolute inset-0' : 'h-48 w-full')} aria-hidden />}
      {url && (
        <img
          src={url}
          alt={item.title || item.fileName || 'Изображение'}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
          draggable={false}
          className={cn(
            'transition-opacity duration-150 pixel:transition-none',
            thumb ? 'size-full object-cover' : 'mx-auto max-h-[70vh] w-auto max-w-full object-contain',
            loaded ? 'opacity-100' : 'opacity-0',
            !loaded && !thumb && 'absolute inset-0',
          )}
        />
      )}
    </div>
  )
}

function FileTextBody({ item, onOpenItem }: { item: Item; onOpenItem?: (id: string) => void }) {
  const [text, setText] = useState<string | null>(null)
  const [tooBig, setTooBig] = useState(false)
  const mdPreview = useUi((s) => s.mdPreview)
  useEffect(() => {
    let cancelled = false
    setText(null)
    setTooBig(false)
    if (!item.fileId) return
    void getFile(item.fileId)
      .then(async (f) => {
        if (!f) return { text: null, big: false }
        if (f.blob.size > MAX_TEXT_BYTES) return { text: null, big: true }
        return { text: await f.blob.text(), big: false }
      })
      .then((r) => {
        if (cancelled) return
        setText(r.text)
        setTooBig(r.big)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [item.fileId])
  if (tooBig) {
    return <p className="text-xs text-muted-foreground">Файл больше 200 КБ — содержимое не показывается, скачайте файл</p>
  }
  if (text === null) return null
  const md = isMarkdownFile(item)
  const pre = (
    <pre
      role="region"
      tabIndex={0}
      aria-label="Содержимое файла"
      className="px-well max-h-80 overflow-auto rounded-lg border border-border bg-muted/50 px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words"
    >
      {text}
    </pre>
  )
  if (!md) return pre
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center">
        <ViewModeToggle className="ml-auto" />
      </div>
      {mdPreview ? (
        <div
          role="region"
          tabIndex={0}
          aria-label="Содержимое файла"
          className="px-well max-h-[70vh] overflow-auto rounded-lg border border-border bg-muted/50 px-3 py-2"
        >
          <MarkdownText source={text} selfId={item.id} onOpenItem={onOpenItem} />
        </div>
      ) : (
        pre
      )}
    </div>
  )
}

function GenericFile({ item, variant, onOpenItem }: { item: Item; variant: 'thumb' | 'full'; onOpenItem?: (id: string) => void }) {
  const ext = extOf(item.fileName)
  const mime = item.mimeType ?? ''
  const icon = iconFor(ext, mime)
  const isPdf = mime === 'application/pdf' || ext === 'pdf'
  // «Открыть» — только если сам Blob является PDF: тип в записи и расширение имени могут быть подделаны.
  const pdfUrl = usePdfUrl(variant === 'full' && isPdf ? item.fileId : undefined)

  if (variant === 'thumb') {
    return (
      <div className="flex size-full min-h-16 flex-col items-center justify-center gap-1 bg-muted text-muted-foreground">
        <Icon name={icon} size={24} strokeWidth={1.5} />
        {ext && <span className="text-xs">.{ext}</span>}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="px-well flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-3">
        <Icon name={icon} size={28} pixelSize={32} strokeWidth={1.5} className="shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{item.fileName || item.title || 'Файл'}</div>
          {item.fileSize !== undefined && (
            <div className="text-xs text-muted-foreground">{formatBytes(item.fileSize)}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {pdfUrl && (
            <Button variant="ghost" size="sm" render={<a href={pdfUrl} target="_blank" rel="noopener noreferrer" />}>
              <Icon name="external-link" className="size-4" />
              Открыть
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void actDownload(item)}>
            <Icon name="download" className="size-4" />
            Скачать
          </Button>
        </div>
      </div>
      {isTextual(item, ext) && <FileTextBody item={item} onOpenItem={onOpenItem} />}
    </div>
  )
}

/** onOpenItem — клик по вики-ссылке в тексте файла .md; не задан — запись открывается в панели деталей. */
export function FilePreview({
  item,
  variant,
  onOpenItem,
}: {
  item: Item
  variant: 'thumb' | 'full'
  onOpenItem?: (id: string) => void
}) {
  if (item.type === 'image') return <ImagePreview item={item} variant={variant} />
  return <GenericFile item={item} variant={variant} onOpenItem={onOpenItem} />
}
