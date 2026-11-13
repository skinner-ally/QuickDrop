import { db } from '@/db/db'
import { readableError } from '@/lib/errors'
import { categoryNameKey, normalizeTags } from '@/lib/normalize'
import type { Category, CategoryColor, Item, ItemStatus, ItemType, Settings, StoredFile } from '@/types'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

const CAT = {
  work: 'demo-cat-work',
  learn: 'demo-cat-learn',
  ideas: 'demo-cat-ideas',
  life: 'demo-cat-life',
  dev: 'demo-cat-dev',
} as const

function buildCategories(now: number): Category[] {
  const defs: Array<[string, string, CategoryColor]> = [
    [CAT.work, 'Работа', 'blue'],
    [CAT.learn, 'Обучение', 'green'],
    [CAT.ideas, 'Идеи', 'amber'],
    [CAT.life, 'Рецепты и личное', 'pink'],
    [CAT.dev, 'Разработка', 'violet'],
  ]
  return defs.map(([id, name, color], order) => ({
    id,
    name,
    color,
    order,
    createdAt: now - 60 * DAY + order * MIN,
  }))
}

// ---------- программно сгенерированные файлы ----------

function svgCover(title: string, c1: string, c2: string, variant: number): string {
  const shapes = [
    `<circle cx="640" cy="130" r="170" fill="#fff" opacity=".14"/><circle cx="130" cy="420" r="120" fill="#fff" opacity=".10"/><rect x="330" y="300" width="260" height="14" rx="7" fill="#fff" opacity=".35"/>`,
    `<g fill="none" stroke="#fff" stroke-width="3" opacity=".6"><rect x="90" y="120" width="190" height="90" rx="14"/><rect x="520" y="120" width="190" height="90" rx="14"/><rect x="305" y="300" width="190" height="90" rx="14"/><path d="M280 165H520M185 210L400 300M615 210L400 300"/></g>`,
    `<path d="M0 380 Q200 280 400 360 T800 300 V500 H0Z" fill="#fff" opacity=".18"/><path d="M0 430 Q220 350 420 410 T800 380 V500 H0Z" fill="#fff" opacity=".14"/><circle cx="620" cy="120" r="55" fill="#fff" opacity=".4"/>`,
    `<g fill="#fff" opacity=".22"><rect x="80" y="90" width="120" height="120" rx="20"/><rect x="230" y="150" width="120" height="120" rx="20"/><rect x="380" y="210" width="120" height="120" rx="20"/><rect x="530" y="270" width="120" height="120" rx="20"/></g>`,
  ]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="800" height="500" fill="url(#g)"/>${shapes[variant % shapes.length]}<text x="60" y="450" font-family="Segoe UI, Arial, sans-serif" font-size="34" font-weight="600" fill="#fff">${title}</text></svg>`
}

interface FileSpec {
  id: string
  itemId: string
  name: string
  mimeType: string
  body: string
}

const IMAGE_FILES: FileSpec[] = [
  { id: 'demo-file-01', itemId: 'demo-06', name: 'схема-архитектуры.svg', mimeType: 'image/svg+xml', body: svgCover('Схема архитектуры', '#4f6bed', '#7c5ce0', 1) },
  { id: 'demo-file-02', itemId: 'demo-14', name: 'референс-интерфейса.svg', mimeType: 'image/svg+xml', body: svgCover('Референс интерфейса', '#0f9d8a', '#3b82c4', 0) },
  { id: 'demo-file-03', itemId: 'demo-22', name: 'маршрут-поездки.svg', mimeType: 'image/svg+xml', body: svgCover('Маршрут поездки', '#e8845c', '#d9578a', 2) },
  { id: 'demo-file-04', itemId: 'demo-29', name: 'старый-макет.svg', mimeType: 'image/svg+xml', body: svgCover('Старый макет', '#64748b', '#94a3b8', 3) },
]

const TEXT_FILES: FileSpec[] = [
  {
    id: 'demo-file-05',
    itemId: 'demo-10',
    name: 'расходы.csv',
    mimeType: 'text/csv',
    body: 'Дата,Категория,Сумма\n2025-01-03,Продукты,3420\n2025-01-07,Транспорт,1150\n2025-01-12,Подписки,899\n2025-01-18,Продукты,2780\n',
  },
  {
    id: 'demo-file-06',
    itemId: 'demo-16',
    name: 'заметки-встречи.md',
    mimeType: 'text/markdown',
    body: '# Встреча по релизу\n\n- Заморозка кода в четверг\n- Отвечает за релиз-ноты: Анна\n- Риск: миграция базы данных\n\n## Действия\n1. Проверить откат миграции\n2. Согласовать окно релиза\n',
  },
  {
    id: 'demo-file-07',
    itemId: 'demo-20',
    name: 'конфиг.json',
    mimeType: 'application/json',
    body: JSON.stringify({ name: 'quickdrop', theme: 'system', shortcuts: { capture: 'Alt+N', search: 'Ctrl+K' } }, null, 2),
  },
]

function buildFiles(now: number, itemCreated: Map<string, number>): StoredFile[] {
  return [...IMAGE_FILES, ...TEXT_FILES].map((f) => {
    const blob = new Blob([f.body], { type: f.mimeType })
    return {
      id: f.id,
      itemId: f.itemId,
      blob,
      name: f.name,
      mimeType: f.mimeType,
      size: blob.size,
      createdAt: itemCreated.get(f.itemId) ?? now,
    }
  })
}

// ---------- записи ----------

type Def = Partial<Item> & { n: number; type: ItemType; status: ItemStatus; age: number }

const ok = (title: string, description: string, siteName: string, now: number, age: number) => ({
  status: 'ok' as const,
  title,
  description,
  siteName,
  fetchedAt: now - age,
})

function defs(now: number): Def[] {
  const imgOf = (id: string) => {
    const f = IMAGE_FILES.find((x) => x.id === id)!
    return { fileId: id, fileName: f.name, mimeType: f.mimeType, fileSize: new Blob([f.body]).size }
  }
  const fileOf = (id: string) => {
    const f = TEXT_FILES.find((x) => x.id === id)!
    return { fileId: id, fileName: f.name, mimeType: f.mimeType, fileSize: new Blob([f.body]).size }
  }

  return [
    // ===== Входящие (10) =====
    { n: 1, type: 'link', status: 'inbox', age: 5 * MIN, url: 'https://v2.tauri.app/start/', title: '', content: 'Посмотреть, как подключить глобальные горячие клавиши' },
    { n: 2, type: 'text', status: 'inbox', age: 20 * MIN, title: '', content: '«Простота — это высшая степень совершенства.»\nЛеонардо да Винчи' },
    { n: 3, type: 'code', status: 'inbox', age: HOUR, language: 'python', title: 'Группировка по ключу', content: 'from collections import defaultdict\n\ngroups = defaultdict(list)\nfor item in items:\n    groups[item["category"]].append(item)\n' },
    { n: 4, type: 'idea', status: 'inbox', age: 3 * HOUR, title: 'Напоминания о неразобранном', content: 'Раз в неделю показывать, сколько записей лежит во входящих дольше 7 дней.' },
    { n: 5, type: 'link', status: 'inbox', age: 5 * HOUR, url: 'https://habr.com/ru/articles/', title: '', content: '', tags: ['статья'], linkMeta: ok('Хабр — статьи', 'Статьи о программировании, дизайне и технологиях', 'Хабр', now, 5 * HOUR) },
    { n: 6, type: 'image', status: 'inbox', age: DAY, title: 'Схема архитектуры', content: 'Набросок слоёв приложения: UI, хранилище, поиск.', ...imgOf('demo-file-01') },
    { n: 7, type: 'text', status: 'inbox', age: DAY + 4 * HOUR, title: 'Чек-лист перед поездкой', content: '- [ ] Паспорт и билеты\n- [ ] Зарядки и павербанк\n- [ ] Страховка\n- [ ] Забронировать такси до аэропорта\n- [ ] Оставить ключи соседям' },
    { n: 8, type: 'link', status: 'inbox', age: 2 * DAY, url: 'https://developer.mozilla.org/ru/docs/Web/API/IndexedDB_API', title: '', content: '' },
    { n: 9, type: 'code', status: 'inbox', age: 2 * DAY + 12 * HOUR, language: 'bash', title: 'Найти крупные файлы', content: 'du -ah . | sort -rh | head -n 20' },
    { n: 10, type: 'file', status: 'inbox', age: 3 * DAY, title: 'Расходы за январь', content: 'Выгрузка из банка, надо разобрать по категориям.', ...fileOf('demo-file-05') },

    // ===== База знаний (16) =====
    { n: 11, type: 'link', status: 'library', age: 4 * DAY, url: 'https://dexie.org/docs/Tutorial/React', categoryId: CAT.dev, tags: ['dexie', 'indexeddb', 'react'], favorite: 1, title: 'Dexie и React', content: 'Хуки useLiveQuery — основа реактивного чтения из IndexedDB.', linkMeta: ok('Dexie.js — Tutorial: React', 'Как использовать Dexie.js с React и useLiveQuery', 'Dexie.js', now, 4 * DAY) },
    { n: 12, type: 'link', status: 'library', age: 6 * DAY, url: 'https://developer.mozilla.org/ru/docs/Web/API/File_API', categoryId: CAT.dev, tags: ['indexeddb', 'веб', 'документация'], title: '', content: '', linkMeta: ok('File API — Веб API | MDN', 'Интерфейсы для работы с файлами и Blob в браузере', 'MDN Web Docs', now, 6 * DAY) },
    { n: 13, type: 'code', status: 'library', age: 7 * DAY, language: 'ts', categoryId: CAT.dev, tags: ['typescript', 'react'], title: 'Хук debounce', content: 'export function useDebounced<T>(value: T, delay = 250): T {\n  const [v, setV] = useState(value)\n  useEffect(() => {\n    const t = setTimeout(() => setV(value), delay)\n    return () => clearTimeout(t)\n  }, [value, delay])\n  return v\n}' },
    { n: 14, type: 'image', status: 'library', age: 9 * DAY, categoryId: CAT.ideas, tags: ['дизайн', 'интерфейс'], favorite: 1, title: 'Референс интерфейса', content: 'Цветовая гамма и сетка карточек для главной.', ...imgOf('demo-file-02') },
    { n: 15, type: 'code', status: 'library', age: 10 * DAY, language: 'sql', categoryId: CAT.work, tags: ['sql', 'отчёты'], title: 'Топ клиентов по выручке', content: "SELECT c.name, SUM(o.total) AS revenue\nFROM orders o\nJOIN customers c ON c.id = o.customer_id\nWHERE o.created_at >= date_trunc('month', now())\nGROUP BY c.name\nORDER BY revenue DESC\nLIMIT 10;" },
    { n: 16, type: 'file', status: 'library', age: 12 * DAY, categoryId: CAT.work, tags: ['встречи', 'релиз'], title: 'Заметки встречи по релизу', content: 'Протокол еженедельной встречи.', ...fileOf('demo-file-06') },
    { n: 17, type: 'text', status: 'library', age: 14 * DAY, categoryId: CAT.work, tags: ['встречи', 'процессы'], title: 'Как проводить ретроспективу', content: 'Три вопроса: что получилось, что мешало, что попробуем в следующем спринте. Не более одного часа, не больше трёх действий на выходе.' },
    { n: 18, type: 'link', status: 'library', age: 16 * DAY, url: 'https://habr.com/ru/articles/local-first/', categoryId: CAT.learn, tags: ['статья', 'local-first'], favorite: 1, title: 'Local-first приложения', content: 'Почему данные лучше хранить у пользователя.', linkMeta: ok('Local-first: данные принадлежат вам', 'Разбор подхода local-first и его компромиссов', 'Хабр', now, 16 * DAY) },
    { n: 19, type: 'code', status: 'library', age: 18 * DAY, language: 'rust', categoryId: CAT.dev, tags: ['rust', 'tauri'], title: 'Команда Tauri', content: '#[tauri::command]\nfn greet(name: &str) -> String {\n    format!("Привет, {}!", name)\n}' },
    { n: 20, type: 'file', status: 'library', age: 20 * DAY, categoryId: CAT.dev, tags: ['настройки', 'tauri'], title: 'Конфигурация приложения', content: 'Пример конфига с горячими клавишами.', ...fileOf('demo-file-07') },
    { n: 21, type: 'text', status: 'library', age: 22 * DAY, categoryId: CAT.learn, tags: ['книги', 'продуктивность'], favorite: 1, title: 'Заметки по «Как делать дела»', content: 'Главная мысль: фиксировать всё во внешнюю систему, чтобы голова оставалась свободной. Разбор — отдельный ритуал, а не побочное занятие.' },
    { n: 22, type: 'image', status: 'library', age: 25 * DAY, categoryId: CAT.life, tags: ['путешествия'], title: 'Маршрут поездки', content: 'Общая схема по городам.', ...imgOf('demo-file-03') },
    { n: 23, type: 'text', status: 'library', age: 28 * DAY, categoryId: CAT.life, tags: ['рецепты', 'ужин'], favorite: 1, title: 'Паста с томатами и базиликом', content: 'Спагетти 200 г, томаты 400 г, чеснок 2 зубчика, базилик, оливковое масло. Томаты томить 10 минут, смешать с пастой и немного воды от варки.' },
    { n: 24, type: 'idea', status: 'library', age: 33 * DAY, categoryId: CAT.ideas, tags: ['продуктивность', 'интерфейс'], title: 'Режим фокуса для разбора', content: 'Показывать входящие по одной записи — решение за пару кликов.' },
    { n: 25, type: 'idea', status: 'library', age: 40 * DAY, categoryId: CAT.ideas, tags: ['local-first', 'синхронизация'], favorite: 1, title: 'Синхронизация через файл', content: 'Экспорт в JSON и автоимпорт из выбранной папки — дёшево и без сервера.' },
    { n: 26, type: 'code', status: 'library', age: 45 * DAY, language: 'ts', categoryId: CAT.dev, tags: ['typescript', 'indexeddb'], title: 'Поиск дубликатов по url', content: 'const seen = new Set<string>()\nconst dups = items.filter((i) => {\n  if (!i.url) return false\n  if (seen.has(i.url)) return true\n  seen.add(i.url)\n  return false\n})' },

    // ===== Архив (4) =====
    { n: 27, type: 'link', status: 'archive', prevStatus: 'library', age: 50 * DAY, url: 'https://developer.mozilla.org/ru/docs/Web/CSS/CSS_grid_layout', categoryId: CAT.dev, tags: ['css', 'веб'], title: 'CSS Grid', content: 'Базовое руководство, уже усвоено.', linkMeta: ok('CSS Grid Layout — CSS | MDN', 'Двумерная система раскладки для веба', 'MDN Web Docs', now, 50 * DAY) },
    { n: 28, type: 'idea', status: 'archive', prevStatus: 'inbox', age: 55 * DAY, title: 'Тёмная тема по расписанию', content: 'Переключать тему по закату — отложено, хватает системной.' },
    { n: 29, type: 'image', status: 'archive', prevStatus: 'library', age: 58 * DAY, categoryId: CAT.ideas, tags: ['дизайн'], title: 'Старый макет', content: 'Первая версия главной, устарела.', ...imgOf('demo-file-04') },
    { n: 30, type: 'text', status: 'archive', prevStatus: 'library', age: 60 * DAY, categoryId: CAT.work, tags: ['процессы'], title: 'Правила код-ревью (старые)', content: 'Заменены новым регламентом команды.' },
  ]
}

/** Попарные связи между записями базы знаний (и пара входящих). */
const LINK_PAIRS: Array<[number, number]> = [
  [11, 12], [11, 13], [11, 26], [12, 26], [13, 26], [14, 24], [16, 17], [18, 25],
  [19, 20], [21, 24], [23, 22], [1, 19], [8, 12], [3, 15],
]

const id = (n: number) => `demo-${String(n).padStart(2, '0')}`

function buildItems(now: number): Item[] {
  const links = new Map<string, Set<string>>()
  for (const [a, b] of LINK_PAIRS) {
    if (!links.has(id(a))) links.set(id(a), new Set())
    if (!links.has(id(b))) links.set(id(b), new Set())
    links.get(id(a))!.add(id(b))
    links.get(id(b))!.add(id(a))
  }
  return defs(now).map(({ n, age, ...rest }) => {
    const createdAt = now - age
    // Запись, побывавшая в базе знаний (в т.ч. архивная из library), уже обработана —
    // иначе «Вернуть из архива» поставило бы processedAt = сейчас.
    const isLib = rest.status === 'library' || rest.prevStatus === 'library'
    return {
      title: '',
      content: '',
      categoryId: null,
      favorite: 0,
      source: 'demo',
      createdAt,
      updatedAt: createdAt + Math.min(age / 4, 2 * DAY),
      processedAt: isLib ? createdAt + Math.min(age / 2, 6 * HOUR) : undefined,
      ...rest,
      id: id(n),
      tags: normalizeTags(rest.tags ?? []),
      links: [...(links.get(id(n)) ?? [])],
    } as Item
  })
}

const sameSet = (a: readonly string[] | undefined, b: readonly string[] | undefined) => {
  const x = a ?? []
  const y = b ?? []
  return x.length === y.length && x.every((v) => y.includes(v))
}

/**
 * Демо-запись не тронута пользователем: совпадает с определением по всему, что он может
 * поменять. Даты и linkMeta не сравниваем — их меняет и автоподгрузка заголовка ссылки.
 */
function isPristineDemo(existing: Item, fresh: Item): boolean {
  const same = (k: keyof Item) => (existing[k] ?? null) === (fresh[k] ?? null)
  return (
    existing.source === 'demo' &&
    // Запись в корзине тронута пользователем: повторный засев не должен её воскрешать.
    existing.deletedAt === undefined &&
    (['type', 'title', 'content', 'url', 'language', 'categoryId', 'status', 'prevStatus', 'favorite', 'fileId'] as const).every(same) &&
    sameSet(existing.tags, fresh.tags) &&
    sameSet(existing.links, fresh.links)
  )
}

// ---------- публичное API ----------

/**
 * Засевает демоданные (повторно — только с force). Пользовательские данные не трогает:
 * отредактированные/перенесённые демо-записи остаются как есть, существующие категории
 * (в т.ч. переименованные демо-категории) не перезаписываются, новые встают в конец списка.
 */
export async function seedDemoData(force = false): Promise<boolean> {
  const seeded = await db.meta.get('seeded')
  if (seeded?.value === true && !force) return false

  const now = Date.now()
  const builtItems = buildItems(now)
  const created = new Map(builtItems.map((i) => [i.id, i.createdAt]))
  const builtFiles = buildFiles(now, created)
  const categories = buildCategories(now)

  const write = db.transaction('rw', db.items, db.files, db.categories, db.meta, async () => {
    // ── категории: существующие по id или по имени не трогаем ──
    const local = await db.categories.toArray()
    const localIds = new Set(local.map((c) => c.id))
    const localByName = new Map(local.map((c) => [categoryNameKey(c.name), c.id]))
    let nextOrder = local.reduce((max, c) => Math.max(max, c.order), -1) + 1
    const catTarget = new Map<string, string>()
    const catsToAdd: Category[] = []
    for (const cat of categories) {
      const sameName = localByName.get(categoryNameKey(cat.name))
      if (localIds.has(cat.id)) catTarget.set(cat.id, cat.id)
      else if (sameName) catTarget.set(cat.id, sameName)
      else {
        catTarget.set(cat.id, cat.id)
        catsToAdd.push({ ...cat, order: nextOrder++ })
      }
    }

    // ── записи: изменённые пользователем демо-записи остаются ──
    const fresh = builtItems.map((it) =>
      it.categoryId ? { ...it, categoryId: catTarget.get(it.categoryId) ?? it.categoryId } : it,
    )
    const existing = await db.items.bulkGet(fresh.map((it) => it.id))
    const kept = new Map<string, Item>()
    fresh.forEach((it, i) => {
      const ex = existing[i]
      if (ex && !isPristineDemo(ex, it)) kept.set(ex.id, ex)
    })
    const toPut = fresh.filter((it) => !kept.has(it.id))
    const putIds = new Set(toPut.map((it) => it.id))

    // Связи остаются двунаправленными: связь с оставленной записью — только если та ссылается в ответ;
    // ссылки остальных записей на перезаписываемые демо сохраняем обратной связью.
    const referrers = await db.items.where('links').anyOf([...putIds]).toArray()
    const backLinks = new Map<string, string[]>()
    for (const r of referrers) {
      if (putIds.has(r.id)) continue
      for (const l of r.links) if (putIds.has(l)) backLinks.set(l, [...(backLinks.get(l) ?? []), r.id])
    }
    const items = toPut.map((it) => {
      const own = it.links.filter((l) => {
        const k = kept.get(l)
        return !k || k.links.includes(it.id)
      })
      return { ...it, links: [...new Set([...own, ...(backLinks.get(it.id) ?? [])])] }
    })

    // ── файлы: только для перезаписываемых записей ──
    if (putIds.size) await db.files.where('itemId').anyOf([...putIds]).delete()
    const files = builtFiles.filter((f) => putIds.has(f.itemId))

    if (catsToAdd.length) await db.categories.bulkAdd(catsToAdd)
    if (items.length) await db.items.bulkPut(items)
    if (files.length) await db.files.bulkPut(files)
    await db.meta.put({ key: 'seeded', value: true })
  })
  try {
    await write
  } catch (e) {
    throw readableError(e)
  }
  return true
}

/**
 * Настройки, которые «Удалить все данные» стирает вместе с записями: ключ API хранится открытым
 * текстом, а в адресе ИИ и шаблоне прокси может быть токен — следующему пользователю устройства
 * они не должны достаться. То же с секретом расширения браузера (и самим приёмом записей от него)
 * и распознаванием через ИИ. Оформление и горячая клавиша остаются.
 * backupLastAt не сбрасывается: иначе первая же запись после стирания (или демо) вызвала бы автокопию
 * почти пустой базы, а обрезка по backupKeep вытеснила бы рабочие копии — единственный способ
 * откатить ошибочное «Удалить все данные». Следующая копия придёт по обычному расписанию.
 */
const CLEARED_SETTINGS: ReadonlyArray<keyof Settings> = [
  'aiApiKey',
  'aiBaseUrl',
  'aiModel',
  'aiEnabled',
  'linkProxyUrl',
  'aiVisionModel',
  'aiAutoOcr',
  'aiAutoOcrSince',
  'extEnabled',
  'extToken',
]

export async function clearAllData(): Promise<void> {
  const tables = [db.items, db.files, db.categories, db.meta, db.positions, db.searches]
  await db.transaction('rw', tables, async () => {
    await db.items.clear()
    await db.files.clear()
    await db.categories.clear()
    await db.positions.clear()
    await db.searches.clear()
    await db.meta.bulkDelete([...CLEARED_SETTINGS])
    // seeded остаётся true, чтобы демо не вернулись сами
    await db.meta.put({ key: 'seeded', value: true })
  })
}
