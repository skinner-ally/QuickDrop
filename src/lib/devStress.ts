// Только для разработки: заливка большого числа записей, чтобы посмотреть граф с большим лесом.
// Подключается из main.tsx под import.meta.env.DEV; в сборку не попадает.
import { db } from '@/db/db'
import { createCategory, deleteCategory, listCategories, purgeItems } from '@/db/repo'
import { newId } from '@/lib/id'
import { type CategoryColor, type Item, type ItemStatus, type ItemType } from '@/types'

const STRESS_TAG = 'стресс'
const CATS_KEY = 'qd-stress-cats'

const CATEGORY_SPECS: Array<{ name: string; color: CategoryColor }> = [
  { name: 'Работа', color: 'blue' },
  { name: 'Идеи', color: 'amber' },
  { name: 'Код', color: 'teal' },
  { name: 'Чтение', color: 'violet' },
  { name: 'Дом', color: 'green' },
  { name: 'Финансы', color: 'red' },
  { name: 'Путешествия', color: 'orange' },
  { name: 'Здоровье', color: 'pink' },
]

const VERBS = ['Разобрать', 'Обдумать', 'Записать', 'Сравнить', 'Проверить', 'Собрать', 'Придумать', 'Оформить', 'Найти', 'Обновить']
const NOUNS = ['план проекта', 'список покупок', 'заметки по встрече', 'идею для приложения', 'статью про базы данных', 'маршрут поездки',
  'бюджет на месяц', 'рецепт ужина', 'конфиг сервера', 'отчёт за квартал', 'книгу по дизайну', 'тренировку', 'расписание', 'черновик письма',
  'скрипт сборки', 'шпаргалку по git', 'видео-лекцию', 'договор аренды']
const TAILS = ['на этой неделе', 'до пятницы', 'на потом', 'для команды', 'по-новому', 'без спешки', 'с примерами', 'v2', 'в черновике', '']
const TAGS = ['срочно', 'важно', 'идея', 'читать', 'позже', 'проект', 'дом', 'работа', 'код', 'видео', 'заметка', 'шаблон']
const SITES = ['example.com', 'habr.com', 'github.com', 'wikipedia.org', 'news.ycombinator.com']
const LANGS = ['ts', 'python', 'bash', 'sql']
const TYPES: ItemType[] = ['text', 'text', 'idea', 'idea', 'link', 'link', 'code']

// Детерминированный генератор: один и тот же лес при повторной заливке.
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface StressReport {
  items: number
  categories: number
  createdCategories: number
  links: number
  ms: number
}

export async function seedStress(n = 1000): Promise<StressReport> {
  const t0 = performance.now()
  const rand = rng(Date.now() & 0xffff)
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rand() * a.length)]

  const before = new Set((await listCategories()).map((c) => c.id))
  const cats = []
  for (const spec of CATEGORY_SPECS) cats.push(await createCategory(spec.name, spec.color))
  const createdIds = cats.filter((c) => !before.has(c.id)).map((c) => c.id)
  try {
    const prev = JSON.parse(localStorage.getItem(CATS_KEY) ?? '[]') as string[]
    localStorage.setItem(CATS_KEY, JSON.stringify([...new Set([...prev, ...createdIds])]))
  } catch { /* без хранилища просто не удалим категории */ }

  const now = Date.now()
  const items: Item[] = []
  const byCat = new Map<string | null, Item[]>()
  for (let i = 0; i < n; i++) {
    const r = rand()
    const cat = rand() < 0.12 ? null : cats[Math.floor(rand() * cats.length)]
    const type = pick(TYPES)
    const status: ItemStatus = r < 0.4 ? 'inbox' : r < 0.9 ? 'library' : 'archive'
    const title = `${pick(VERBS)} ${pick(NOUNS)} ${pick(TAILS)}`.trim()
    const created = now - Math.floor(rand() * 60 * 86_400_000)
    const tagCount = Math.floor(rand() * 4)
    const tags = [...new Set([STRESS_TAG, ...Array.from({ length: tagCount }, () => pick(TAGS))])]
    const item: Item = {
      id: newId(),
      type,
      title,
      content: type === 'code' ? `const x = ${i}` : `Тестовая запись №${i + 1}. ${title}.`,
      categoryId: cat?.id ?? null,
      tags,
      links: [],
      status,
      favorite: rand() < 0.1 ? 1 : 0,
      source: 'demo',
      createdAt: created,
      updatedAt: created,
    }
    if (type === 'link') item.url = `https://${pick(SITES)}/stress/${i}`
    if (type === 'code') item.language = pick(LANGS)
    if (status === 'library') item.processedAt = created
    if (status === 'archive') item.prevStatus = 'library'
    items.push(item)
    const key = item.categoryId
    const list = byCat.get(key)
    if (list) list.push(item)
    else byCat.set(key, [item])
  }

  // Связи: у трети записей 1–2, в основном внутри категории, иногда между категориями.
  let links = 0
  const link = (a: Item, b: Item) => {
    if (a === b || a.links.includes(b.id)) return
    a.links.push(b.id)
    b.links.push(a.id)
    links++
  }
  for (const a of items) {
    if (rand() > 0.34) continue
    const count = 1 + Math.floor(rand() * 2)
    for (let k = 0; k < count; k++) {
      const pool = rand() < 0.8 ? (byCat.get(a.categoryId) ?? items) : items
      link(a, pick(pool))
    }
  }

  await db.transaction('rw', db.items, async () => {
    await db.items.bulkAdd(items)
  })

  return {
    items: items.length,
    categories: cats.length,
    createdCategories: createdIds.length,
    links,
    ms: Math.round(performance.now() - t0),
  }
}

export async function removeStress(): Promise<{ items: number; categories: number }> {
  const all = await db.items.toArray()
  const ids = all.filter((it) => it.tags.includes(STRESS_TAG)).map((it) => it.id)
  const removed = ids.length ? await purgeItems(ids) : 0
  let ours: string[] = []
  try {
    ours = JSON.parse(localStorage.getItem(CATS_KEY) ?? '[]') as string[]
  } catch { /* нет хранилища */ }
  const left = new Set((await db.items.toArray()).map((it) => it.categoryId))
  let cats = 0
  for (const id of ours) {
    if (left.has(id)) continue
    await deleteCategory(id)
    cats++
  }
  try {
    localStorage.removeItem(CATS_KEY)
  } catch { /* нет хранилища */ }
  return { items: removed, categories: cats }
}
