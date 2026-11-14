import { createContext, memo, useContext, useMemo, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import Markdown, { type Components, type ExtraProps, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Icon } from '@/components/icons'
import { CodeView } from '@/components/items/CodeView'
import { Checkbox } from '@/components/ui/checkbox'
import { useAllItems } from '@/hooks/useItems'
import { openItemInSection, openLink } from '@/lib/actions'
import { normalizeLanguage } from '@/lib/detect'
import { mdUrlTransform, openableLinkUrl, parseWikiHref, remarkSoftBreaks, remarkWikiLinks, toggleTaskAt, WIKI_SCHEME } from '@/lib/markdown'
import { isTauri } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { buildTitleIndex, resolveWikiLink } from '@/lib/wikiLinks'
import { useUi } from '@/store/ui'
import type { Item } from '@/types'

export interface MarkdownViewProps {
  source: string
  /** id записи-владельца: ссылка на саму себя не разрешается. */
  selfId?: string
  /** Задан — задачи кликабельны; получает новый исходник целиком. */
  onChange?: (next: string) => void
  /** Клик по вики-ссылке; по умолчанию select(id), в графе — openItemInSection (показ архива). */
  onOpenItem?: (id: string) => void
  density?: 'normal' | 'compact'
  className?: string
}

type HastElement = NonNullable<ExtraProps['node']>
type HastChild = HastElement['children'][number]

interface ViewContext {
  source: string
  selfId?: string
  onChange?: (next: string) => void
  onOpenItem?: (id: string) => void
}

// Данные просмотра — через контекст: так объект components общий для всех просмотров и не меняется,
// а разобранное дерево пересоздаётся только при смене исходника.
const ViewCtx = createContext<ViewContext>({ source: '' })
/** Позиция пункта-задачи в исходнике и её текст — для флажка внутри этого пункта (позиции нет — флажок только для чтения). */
interface TaskInfo {
  offset?: number
  label: string
}
const TaskCtx = createContext<TaskInfo | undefined>(undefined)
/** Внутри ссылки: картинка-ссылка там рисуется без своей ссылки (ссылка в ссылке недопустима). */
const InLinkCtx = createContext(false)

// Один индекс заголовков на снимок записей — общий для всех вики-ссылок всех просмотров.
const indexCache = new WeakMap<readonly Item[], Map<string, Item>>()
function titleIndex(items: readonly Item[]): Map<string, Item> {
  let index = indexCache.get(items)
  if (!index) {
    index = buildTitleIndex(items)
    indexCache.set(items, index)
  }
  return index
}

function WikiLink({ target, children }: { target: string; children: ReactNode }) {
  const { selfId, onOpenItem } = useContext(ViewCtx)
  const items = useAllItems()
  const item = items ? resolveWikiLink(target, titleIndex(items), selfId) : undefined
  if (!item) {
    return (
      <span className="qd-md-wiki" data-missing="true" title={items ? 'Запись не найдена' : undefined}>
        {children}
      </span>
    )
  }
  return (
    <button
      type="button"
      className="qd-md-wiki"
      onClick={(e) => {
        e.stopPropagation()
        if (onOpenItem) onOpenItem(item.id)
        // В графе запись из скрытого архива должна попасть в сцену: иначе клавиши графа действуют на другую ноду.
        else if (useUi.getState().view === 'graph') openItemInSection(item)
        else useUi.getState().select(item.id)
      }}
    >
      {children}
    </button>
  )
}

/** Внешняя ссылка: новая вкладка, в Tauri — системный браузер (как в AutoLinkText). */
function openExternal(e: React.MouseEvent<HTMLAnchorElement>, href: string): void {
  e.stopPropagation()
  if (isTauri()) {
    e.preventDefault()
    void openLink(href)
  }
}

/** Якорь внутри своего просмотра (сноски): адрес страницы не меняется — в нём раздел приложения. */
function scrollToAnchor(e: React.MouseEvent<HTMLAnchorElement>, href: string): void {
  e.preventDefault()
  e.stopPropagation()
  const root = e.currentTarget.closest('.qd-md')
  if (!root) return
  let id = href.slice(1)
  try {
    id = decodeURIComponent(id)
  } catch {
    // битая кодировка — ищем как есть
  }
  const target = Array.from(root.querySelectorAll('[id]')).find((el) => el.id === id)
  target?.scrollIntoView({ block: 'nearest' })
}

function MdAnchor({ node: _node, href, children, ...rest }: ComponentProps<'a'> & ExtraProps) {
  if (href?.startsWith(WIKI_SCHEME)) {
    const target = parseWikiHref(href)
    return target ? <WikiLink target={target}>{children}</WikiLink> : <span>{children}</span>
  }
  // Небезопасный адрес mdUrlTransform превратил в пустой — показываем просто текст.
  if (!href) return <span>{children}</span>
  if (href.startsWith('#')) {
    return (
      <a {...rest} href={href} onClick={(e) => scrollToAnchor(e, href)}>
        {children}
      </a>
    )
  }
  return (
    <a {...rest} href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => openExternal(e, href)}>
      <InLinkCtx.Provider value>{children}</InLinkCtx.Provider>
    </a>
  )
}

/** Картинка Markdown никогда не загружается: удалённый адрес — ссылка со значком. */
function MdImage({ src, alt }: ComponentProps<'img'> & ExtraProps) {
  const inLink = useContext(InLinkCtx)
  const href = openableLinkUrl(src)
  if (!href) return alt ? <span>{alt}</span> : null
  if (inLink) {
    // [![значок](адрес картинки)](адрес) — ведёт внешняя ссылка, картинка лишь подпись.
    return (
      <span className="qd-md-img">
        <Icon name="file-image" size={14} />
        {alt || href}
      </span>
    )
  }
  return (
    <a
      className="qd-md-img"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => openExternal(e, href)}
    >
      <Icon name="file-image" size={14} />
      {alt || href}
    </a>
  )
}

function textOf(node: HastChild): string {
  if (node.type === 'text') return node.value
  if (node.type === 'element') return node.children.map(textOf).join('')
  return ''
}

/** Подпись флажка: текст самого пункта без вложенных подпунктов (иначе в неё попал бы весь подсписок). */
export function taskLabel(li: HastElement): string {
  const text = li.children
    .filter((c) => !(c.type === 'element' && (c.tagName === 'ul' || c.tagName === 'ol')))
    .map(textOf)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return 'Задача'
  return text.length > 120 ? text.slice(0, 119) + '…' : text
}

function MdPre({ node }: ComponentProps<'pre'> & ExtraProps) {
  const code = node?.children.find(
    (c): c is HastElement => c.type === 'element' && c.tagName === 'code',
  )
  const classes = code?.properties.className
  const tag = Array.isArray(classes) ? classes.map(String).find((c) => c.startsWith('language-')) : undefined
  const text = code ? textOf(code).replace(/\r?\n$/, '') : ''
  return <CodeView code={text} language={tag ? normalizeLanguage(tag) : undefined} />
}

/** Инлайн-код; код в блоке рисует MdPre. */
function MdCode({ children }: ComponentProps<'code'> & ExtraProps) {
  return <code>{children}</code>
}

function MdListItem({ node, className, children, ...rest }: ComponentProps<'li'> & ExtraProps) {
  const task = typeof className === 'string' && className.split(/\s+/).includes('task-list-item')
  // Позиция маркера пункта в исходнике: по ней флажок находит свою строку (порядковый номер ненадёжен).
  const info = useMemo<TaskInfo | undefined>(
    () => (task && node ? { offset: node.position?.start.offset, label: taskLabel(node) } : undefined),
    [task, node],
  )
  return (
    <li {...rest} className={className}>
      <TaskCtx.Provider value={info}>{children}</TaskCtx.Provider>
    </li>
  )
}

function MdTaskCheck({ type, checked }: ComponentProps<'input'> & ExtraProps) {
  const { source, onChange } = useContext(ViewCtx)
  const task = useContext(TaskCtx)
  const offset = task?.offset
  if (type !== 'checkbox') return null
  if (!onChange || offset === undefined) {
    return <Checkbox className="qd-md-check" checked={!!checked} readOnly tabIndex={-1} aria-label={task?.label} />
  }
  return (
    <Checkbox
      className="qd-md-check"
      aria-label={task?.label}
      checked={!!checked}
      onCheckedChange={() => {
        const next = toggleTaskAt(source, offset)
        if (next !== null) onChange(next)
      }}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

function MdTable({ node: _node, children, ...rest }: ComponentProps<'table'> & ExtraProps) {
  return (
    <div className="qd-md-table">
      <table {...rest}>{children}</table>
    </div>
  )
}

const COMPONENTS: Components = {
  a: MdAnchor,
  img: MdImage,
  pre: MdPre,
  code: MdCode,
  li: MdListItem,
  input: MdTaskCheck,
  table: MdTable,
}

const REMARK_PLUGINS: Options['remarkPlugins'] = [remarkGfm, remarkWikiLinks, remarkSoftBreaks]
const REHYPE_OPTIONS: Options['remarkRehypeOptions'] = { footnoteLabel: 'Сноски', footnoteBackLabel: 'К тексту' }

function MarkdownViewImpl({ source, selfId, onChange, onOpenItem, density, className }: MarkdownViewProps): ReactElement {
  const ctx = useMemo<ViewContext>(
    () => ({ source, selfId, onChange, onOpenItem }),
    [source, selfId, onChange, onOpenItem],
  )
  // Сырой HTML не разбирается (rehype-raw нет) и выводится текстом; skipHtml не включается — иначе он бы пропал.
  const tree = useMemo(
    () => (
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        remarkRehypeOptions={REHYPE_OPTIONS}
        urlTransform={mdUrlTransform}
        components={COMPONENTS}
      >
        {source}
      </Markdown>
    ),
    [source],
  )
  return (
    <div className={cn('qd-md', className)} data-density={density}>
      <ViewCtx.Provider value={ctx}>{tree}</ViewCtx.Provider>
    </div>
  )
}

/** Отрисованный Markdown. Отдельный чанк: импортировать только через MarkdownText. */
export const MarkdownView = memo(MarkdownViewImpl)
