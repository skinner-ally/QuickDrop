import { useCallback, useRef } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { useAutoHeight } from './autosave'

type Props = Omit<React.ComponentProps<'textarea'>, 'value'> & { value: string }

/** Textarea, растущая по содержимому. */
export function AutoTextarea({ value, ref: outerRef, ...props }: Props) {
  const inner = useRef<HTMLTextAreaElement | null>(null)
  useAutoHeight(inner, value)
  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      inner.current = el
      if (typeof outerRef === 'function') outerRef(el)
      else if (outerRef) outerRef.current = el
    },
    [outerRef],
  )
  return <Textarea ref={setRef} value={value} rows={1} {...props} />
}
