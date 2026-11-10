import { useState } from 'react'
import { Copy, ExternalLink, Globe, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { actOpen, copyText, refreshLinkMeta } from '@/lib/actions'
import { safeImageUrl, safeLinkUrl } from '@/lib/normalize'
import type { Item } from '@/types'
import { useAutosave } from './autosave'
import { saveItem } from './save'

function domainOf(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function Favicon({ src }: { src: string | undefined }) {
  const [failed, setFailed] = useState(false)
  const safe = safeImageUrl(src)
  if (!safe || failed) return <Globe size={16} strokeWidth={1.75} className="shrink-0 text-muted-foreground" aria-hidden />
  return (
    <img
      src={safe}
      alt=""
      width={16}
      height={16}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="size-4 shrink-0 rounded-sm"
    />
  )
}

function OgImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
      className="max-h-48 w-full border-b border-border bg-muted object-cover"
    />
  )
}

/** Карточка ссылки: метаданные страницы, действия и редактируемый адрес. */
export function LinkCard({ item }: { item: Item }) {
  const meta = item.linkMeta
  const pending = meta?.status === 'pending'
  const failed = meta?.status === 'failed'
  const href = safeLinkUrl(item.url)
  const image = safeImageUrl(meta?.image)

  const url = useAutosave(
    item.url ?? '',
    async (v) => {
      const next = v.trim()
      if (!next || next === item.url) return
      // Новый адрес — старые заголовок/превью неактуальны: перезапрашиваем (pending заменяет прежние метаданные).
      if (await saveItem(item.id, { url: next })) await refreshLinkMeta({ ...item, url: next })
    },
    undefined,
    (v) => v.trim(),
  )

  // Пустой адрес не сохраняем и не оставляем пустым в поле — возвращаем прежний.
  function commit() {
    if (!url.value.trim()) url.revert()
    else url.flush()
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {pending ? (
          <div className="flex animate-pulse flex-col gap-2 p-3" aria-busy="true" aria-label="Загрузка данных ссылки">
            <div className="h-3 w-1/3 rounded bg-muted" />
            <div className="h-4 w-4/5 rounded bg-muted" />
            <div className="h-3 w-full rounded bg-muted" />
          </div>
        ) : (
          <>
            {image && <OgImage src={image} />}
            <div className="flex flex-col gap-1 p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Favicon src={meta?.favicon} />
                <span className="truncate">{meta?.siteName || domainOf(item.url)}</span>
              </div>
              {meta?.title && <div className="text-sm leading-snug font-medium break-words">{meta.title}</div>}
              {meta?.description && (
                <div className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{meta.description}</div>
              )}
              {failed && <div className="text-xs text-muted-foreground">Не удалось получить заголовок</div>}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="outline" size="sm" disabled={!href} onClick={() => actOpen(item)}>
          <ExternalLink strokeWidth={1.75} className="size-4" aria-hidden />
          Открыть
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!item.url}
          onClick={() => item.url && void copyText(item.url, 'Ссылка скопирована')}
        >
          <Copy strokeWidth={1.75} className="size-4" aria-hidden />
          Копировать ссылку
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => void refreshLinkMeta(item)}>
          <RefreshCw strokeWidth={1.75} aria-hidden className={pending ? 'size-4 animate-spin' : 'size-4'} />
          Обновить данные
        </Button>
      </div>

      <Input
        value={url.value}
        aria-label="Адрес ссылки"
        placeholder="https://"
        inputMode="url"
        autoCapitalize="none"
        spellCheck={false}
        onChange={(e) => url.setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            url.revert()
            e.currentTarget.blur()
          }
        }}
        className="font-mono text-xs md:text-xs"
      />
    </div>
  )
}
