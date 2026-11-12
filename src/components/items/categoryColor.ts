import { useContext, type CSSProperties } from 'react'
import type { Category, CategoryColor } from '@/types'
import { CategoriesContext } from './CategoryBadge'

/** 'var(--cat-blue)'; для записи без категории — 'var(--cat-none)'. */
export function catColorVar(color: CategoryColor | null | undefined): string {
  return color ? `var(--cat-${color})` : 'var(--cat-none)'
}

/** Стиль для px-catbar: { '--c': catColorVar(color) }. */
export function catBarStyle(color: CategoryColor | null | undefined): CSSProperties {
  return { '--c': catColorVar(color) } as CSSProperties
}

/** Категория из CategoriesContext (внутри ItemList). Вне провайдера и для null/undefined — undefined. Подписок на БД не создаёт. */
export function useListCategory(categoryId: string | null | undefined): Category | undefined {
  const categories = useContext(CategoriesContext)
  if (!categories || !categoryId) return undefined
  return categories.find((c) => c.id === categoryId)
}
