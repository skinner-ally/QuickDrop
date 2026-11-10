import { useMemo } from 'react'
import { highlight } from '@/search'

export function Highlighted({
  text,
  terms,
  className,
}: {
  text: string
  terms: string[]
  className?: string
}) {
  const parts = useMemo(() => (terms.length ? highlight(text, terms) : null), [text, terms])
  if (!parts) return <span className={className}>{text}</span>
  return (
    <span className={className}>
      {parts.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : p.text))}
    </span>
  )
}
