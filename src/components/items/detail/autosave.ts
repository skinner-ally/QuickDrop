import { useCallback, useEffect, useRef, useState } from 'react'

/** Автоширина textarea для браузеров без `field-sizing: content`. */
export function useAutoHeight(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content')) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [ref, value])
}

/**
 * Локальный черновик поля с сохранением: debounce (если задан delay), flush по blur и при размонтировании.
 * Внешние изменения `saved` подхватываются, пока черновик не изменён пользователем.
 */
export function useAutosave(
  saved: string,
  save: (value: string) => Promise<unknown> | unknown,
  delay?: number,
  /** Нормализация, с которой save сохраняет значение (напр. trim): сравнение идёт по ней. */
  normalize: (value: string) => string = (v) => v,
) {
  const [value, setValueState] = useState(saved)
  const valueRef = useRef(saved)
  const baseRef = useRef(normalize(saved))
  const saveRef = useRef(save)
  const normalizeRef = useRef(normalize)
  const savedRef = useRef(saved)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    saveRef.current = save
    normalizeRef.current = normalize
  })

  useEffect(() => {
    savedRef.current = saved
    const norm = normalizeRef.current
    const draft = norm(valueRef.current)
    // Черновик, совпадающий с сохранённым с точностью до нормализации, не трогаем (иначе съедается набираемый пробел).
    if (draft === baseRef.current && draft !== norm(saved)) {
      valueRef.current = saved
      setValueState(saved)
    }
    baseRef.current = norm(saved)
  }, [saved])

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    const v = valueRef.current
    const n = normalizeRef.current(v)
    const prev = baseRef.current
    if (n === prev) return
    baseRef.current = n
    // Неудачная запись (save вернул false или бросил) не должна оставлять правку «сохранённой»:
    // возвращаем базу, чтобы следующий blur/закрытие повторили попытку. Не трогаем, если база уже сменилась.
    const rollback = () => {
      if (baseRef.current === n) baseRef.current = prev
    }
    void Promise.resolve(saveRef.current(v)).then((ok) => {
      if (ok === false) rollback()
    }, rollback)
  }, [])

  // Уход в фон/закрытие вкладки: сбрасываем отложенную запись, не дожидаясь blur.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
    }
  }, [flush])

  const revert = useCallback(() => {
    clearTimeout(timer.current)
    // baseRef хранит нормализованное значение — возвращаем последнее сохранённое.
    valueRef.current = savedRef.current
    setValueState(savedRef.current)
  }, [])

  const setValue = useCallback(
    (v: string) => {
      valueRef.current = v
      setValueState(v)
      if (delay !== undefined) {
        clearTimeout(timer.current)
        timer.current = setTimeout(flush, delay)
      }
    },
    [delay, flush],
  )

  // Несохранённая правка при смене записи/закрытии панели не теряется.
  useEffect(() => flush, [flush])

  return { value, setValue, flush, revert }
}
