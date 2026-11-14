import type { KeyboardEvent } from 'react'

/** Навигация стрелками для role="radiogroup": фокус и выбор переходят на соседний radio. */
export function radioGroupKeyDown(e: KeyboardEvent<HTMLElement>) {
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const radios = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
  const cur = radios.indexOf(document.activeElement as HTMLButtonElement)
  if (cur < 0) return
  e.preventDefault()
  let next = cur
  if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = radios.length - 1
  else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (cur + 1) % radios.length
  else next = (cur - 1 + radios.length) % radios.length
  radios[next].focus()
  radios[next].click()
}
