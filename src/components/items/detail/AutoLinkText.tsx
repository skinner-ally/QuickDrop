import { Fragment } from 'react'
import { openLink } from '@/lib/actions'
import { isTauri } from '@/lib/platform'
import { safeLinkUrl } from '@/lib/normalize'

const URL_RE = /\bhttps?:\/\/[^\s<>"]+/gi
const TRAILING = /[.,;:!?)\]}»"']+$/

/** Текст с сохранением переносов; http(s)-адреса становятся ссылками (только через safeLinkUrl). */
export function AutoLinkText({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0
    const raw = m[0].replace(TRAILING, '')
    const href = safeLinkUrl(raw)
    if (!href) continue
    if (start > last) parts.push(<Fragment key={key++}>{text.slice(last, start)}</Fragment>)
    parts.push(
      <a
        key={key++}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.stopPropagation()
          if (isTauri()) {
            e.preventDefault()
            void openLink(href)
          }
        }}
        className="text-foreground underline underline-offset-2 hover:opacity-80 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
      >
        {raw}
      </a>,
    )
    last = start + raw.length
  }
  if (last < text.length) parts.push(<Fragment key={key++}>{text.slice(last)}</Fragment>)
  return <div className="text-sm leading-relaxed break-words whitespace-pre-wrap">{parts}</div>
}
