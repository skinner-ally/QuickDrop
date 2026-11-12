import { displayTitle } from '@/lib/itemTitle'
import { buildTitleIndex, parseWikiLinks, resolveWikiLink, unclosedFence } from '@/lib/wikiLinks'
import type { Category, Item } from '@/types'

/** path — относительно корня экспорта, разделитель '/'. */
export interface MdAttachment {
  path: string
  fileId: string
  name: string
}

/** Структурно совместим с ExportDoc из src/lib/exportDir.ts: { path, markdown, attachments: [{ path, fileId }] }. */
export interface MdExportEntry {
  id: string
  path: string
  markdown: string
  attachments: MdAttachment[]
}

export interface MdExportPlan {
  /** id записи → имя заметки без .md */
  notes: Map<string, string>
  /** id записи → 'attachments/…' */
  attachments: Map<string, string>
}

const ATTACHMENTS_DIR = 'attachments'
const NOTE_EXT = '.md'
const EMPTY_NAME = 'Без названия'
/** Предел имени файла вместе с суффиксом и расширением. */
const MAX_FILE_NAME = 80
const NOTE_NAME_MAX = 72
const ATTACHMENT_NAME_MAX = 74

// ───────────────────────── имена файлов ─────────────────────────

// # ^ [ ] | — служебные в вики-ссылках Obsidian: имя с ними нельзя было бы сослать через [[…]].
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[<>:"/\\|?*#^[\]\u0000-\u001f\u007f]/g
// Управление направлением текста и невидимые символы: «отчёт‮gnp.exe» Проводник показал бы как
// «отчётexe.png». Соединители U+200C/U+200D не трогаются — они нужны письменностям и эмодзи.
const INVISIBLE_CHARS = /[؜​‎‏‪-‮⁠-⁤⁦-⁩﻿]/g
// Половина суррогатной пары не кодируется в UTF-8: на ней падает encodeURI и передача имени в Rust.
const LONE_SURROGATE = /[\uD800-\uDFFF]/gu
const EDGE_HEAD = /^[. ]+/
const EDGE_TAIL = /[. ]+$/
const QDPART_TAIL = /\.qdpart$/i
const EXTENSION = /\.[^.\s]{1,10}$/

const RESERVED_NAMES: ReadonlySet<string> = new Set([
  'CON', 'PRN', 'AUX', 'NUL', 'CONIN$', 'CONOUT$',
  ...['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '¹', '²', '³'].flatMap((d) => [`COM${d}`, `LPT${d}`]),
])

/** Windows считает устройством и «con.txt», и «CON .txt»: сравнивается часть до первой точки. */
function isReservedName(name: string): boolean {
  const dot = name.indexOf('.')
  return RESERVED_NAMES.has((dot === -1 ? name : name.slice(0, dot)).trim().toUpperCase())
}

function cutTail(s: string, max: number): string {
  let end = Math.max(0, Math.min(s.length, max))
  const last = s.charCodeAt(end - 1)
  if (end < s.length && last >= 0xd800 && last <= 0xdbff) end--
  return s.slice(0, end).replace(EDGE_TAIL, '')
}

function splitExtension(name: string): [stem: string, ext: string] {
  const m = EXTENSION.exec(name)
  return m && m.index > 0 ? [name.slice(0, m.index), m[0]] : [name, '']
}

function clipName(name: string, max: number): string {
  if (name.length <= max) return name
  const [stem, ext] = splitExtension(name)
  if (ext && max > ext.length) {
    const head = cutTail(stem, max - ext.length)
    if (head) return head + ext
  }
  return cutTail(name, max)
}

/** Обрезка сама может дать запрещённое имя («CONSOLE.txt» → «CON.txt»), поэтому проверка повторяется. */
function fitName(name: string, max: number): string {
  let out = clipName(name, max)
  for (let i = 0; i < 4; i++) {
    if (QDPART_TAIL.test(out)) out = cutTail(out, out.length - 1)
    else if (isReservedName(out)) out = clipName(`_${out}`, max)
    else break
  }
  return out || '_'
}

/**
 * Имя файла, которое примет Windows и проверка safe_rel_path на стороне Rust (она ничего не чинит,
 * только отклоняет). Расширение при обрезке сохраняется.
 */
export function safeFileName(raw: string, maxLen = 80): string {
  const max = Number.isFinite(maxLen) ? Math.max(1, Math.floor(maxLen)) : MAX_FILE_NAME
  let name = String(raw ?? '')
    .normalize('NFC')
    .replace(LONE_SURROGATE, ' ')
    .replace(INVISIBLE_CHARS, '')
    .replace(FORBIDDEN_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .replace(EDGE_HEAD, '')
    .replace(EDGE_TAIL, '')
  if (!name) name = EMPTY_NAME
  if (isReservedName(name)) name = `_${name}`
  if (QDPART_TAIL.test(name)) name += '_'
  return fitName(name, max)
}

// ───────────────────────── план имён ─────────────────────────

function hasAttachment(item: Item): item is Item & { fileId: string } {
  return (item.type === 'file' || item.type === 'image') && typeof item.fileId === 'string' && item.fileId !== ''
}

function exportOrder(items: readonly Item[]): Item[] {
  const ts = (item: Item) => (Number.isFinite(item.createdAt) ? item.createdAt : 0)
  return items
    .filter((item) => item.deletedAt === undefined)
    .sort((a, b) => ts(a) - ts(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * Ключ совпадения имён. Файловые системы Windows и macOS не различают регистр; двойное
 * преобразование сливает и редкие пары вроде «ß»/«SS» — лишний суффикс безвреден, затёртый файл нет.
 */
function nameKey(name: string): string {
  return name.toUpperCase().toLowerCase()
}

class NameRegistry {
  private readonly used = new Set<string>()
  private readonly next = new Map<string, number>()

  /** variant(n) — имя с суффиксом « (n)»; вызывается только при совпадении. */
  claim(name: string, variant: (n: number) => string): string {
    const key = nameKey(name)
    if (!this.used.has(key)) {
      this.used.add(key)
      return name
    }
    // Счётчик продолжается с последнего выданного номера: тысяча одноимённых записей — не квадрат.
    for (let n = this.next.get(key) ?? 2; ; n++) {
      const candidate = variant(n)
      const candidateKey = nameKey(candidate)
      if (this.used.has(candidateKey)) continue
      this.used.add(candidateKey)
      this.next.set(key, n + 1)
      return candidate
    }
  }
}

function noteVariant(name: string, n: number): string {
  const suffix = ` (${n})`
  return cutTail(name, MAX_FILE_NAME - NOTE_EXT.length - suffix.length) + suffix
}

function attachmentVariant(name: string, n: number): string {
  const suffix = ` (${n})`
  const [stem, ext] = splitExtension(name)
  return cutTail(stem, MAX_FILE_NAME - ext.length - suffix.length) + suffix + ext
}

const MD_TAIL = /(?:\.md)+$/i

/**
 * Заголовок «README.md» (имя файла у записи-файла) дал бы файл «README.md.md», а ссылку [[README.md]]
 * Obsidian отнёс бы к заметке «README» — конечное «.md» срезается. Обрезка длины или краёв может
 * снова оставить его в конце, поэтому повтор.
 */
function noteName(item: Item): string {
  let name = displayTitle(item).trim()
  for (let i = 0; i < 3; i++) {
    name = safeFileName(name.replace(MD_TAIL, ''), NOTE_NAME_MAX)
    if (!MD_TAIL.test(name)) break
  }
  return name
}

/** Имя записи вне плана: суффикс из id, чтобы не совпасть с заметкой из плана и не затереть её файл. */
function unplannedNoteName(item: Item): string {
  const suffix = ` (${String(item.id).replace(/[^0-9a-z-]/gi, '').slice(0, 8) || 'x'})`
  return cutTail(noteName(item), MAX_FILE_NAME - NOTE_EXT.length - suffix.length) + suffix
}

function attachmentName(item: Item): string {
  return safeFileName(item.fileName ?? '', ATTACHMENT_NAME_MAX)
}

export function planMarkdownExport(items: readonly Item[]): MdExportPlan {
  const notes = new Map<string, string>()
  const attachments = new Map<string, string>()
  const noteNames = new NameRegistry()
  const attachmentNames = new NameRegistry()
  for (const item of exportOrder(items)) {
    if (notes.has(item.id)) continue
    const note = noteName(item)
    notes.set(item.id, noteNames.claim(note, (n) => noteVariant(note, n)))
    if (hasAttachment(item)) {
      const file = attachmentName(item)
      attachments.set(item.id, `${ATTACHMENTS_DIR}/${attachmentNames.claim(file, (n) => attachmentVariant(file, n))}`)
    }
  }
  return { notes, attachments }
}

// ───────────────────────── текст заметки ─────────────────────────

interface RenderEnv {
  plan: MdExportPlan
  categoryName(id: string | null | undefined): string | undefined
  titleIndex(): ReadonlyMap<string, Item>
}

/** Индекс заголовков строится один раз на выгрузку и только если в тексте встретилась вики-ссылка. */
function makeEnv(categories: readonly Category[], items: readonly Item[], plan: MdExportPlan): RenderEnv {
  let names: Map<string, string> | undefined
  let index: Map<string, Item> | undefined
  return {
    plan,
    categoryName(id) {
      if (id == null) return undefined
      names ??= new Map(categories.map((c) => [c.id, c.name]))
      return names.get(id)
    },
    titleIndex: () => (index ??= buildTitleIndex(items)),
  }
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\ufeff]/g

/** Заголовок и описание попадают в строку разметки: переводы строк → пробел, управляющие символы убираются. */
function singleLine(s: string): string {
  return s.replace(/[\s\u0085]/g, ' ').replace(CONTROL_CHARS, '').replace(/ +/g, ' ').trim()
}

/**
 * Строка YAML в двойных кавычках. Переводы строк и табуляция → пробел; прочие управляющие символы
 * и U+FEFF в YAML недопустимы даже в кавычках — убираются.
 */
function yamlString(value: string): string {
  const clean = value
    .replace(/\r\n|[\n\r\t\u0085\u2028\u2029]/g, ' ')
    .replace(CONTROL_CHARS, '')
    .replace(/[\\"]/g, '\\$&')
  return `"${clean}"`
}

/** toISOString бросает RangeError на отметке вне диапазона Date (запись из старой копии). */
function isoDate(ts: number): string | undefined {
  const d = new Date(ts)
  return typeof ts === 'number' && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined
}

function frontMatter(item: Item, title: string, env: RenderEnv): string {
  const lines = [
    '---',
    `id: ${yamlString(item.id)}`,
    `title: ${yamlString(title)}`,
    `type: ${yamlString(item.type)}`,
    `status: ${yamlString(item.status)}`,
  ]
  const category = env.categoryName(item.categoryId)
  if (category !== undefined) lines.push(`category: ${yamlString(category)}`)
  const tags = Array.isArray(item.tags) ? item.tags : []
  lines.push(`tags: [${tags.map(yamlString).join(', ')}]`)
  if (item.favorite === 1) lines.push('favorite: true')
  if (item.type === 'link' && item.url?.trim()) lines.push(`url: ${yamlString(item.url.trim())}`)
  const created = isoDate(item.createdAt)
  if (created) lines.push(`created: ${yamlString(created)}`)
  const updated = isoDate(item.updatedAt)
  if (updated) lines.push(`updated: ${yamlString(updated)}`)
  lines.push('source: "quickdrop"', '---')
  return lines.join('\n')
}

function linkText(s: string): string {
  return singleLine(s).replace(/[\\[\]]/g, '\\$&')
}

/** Адрес ссылки: пробел или непарная скобка обрывают (…) в Markdown. Готовые %XX не трогаются. */
function linkDestination(url: string): string {
  return url.trim().replace(/[\s()<>]/g, (c) => (c === '(' ? '%28' : c === ')' ? '%29' : encodeURIComponent(c)))
}

/** Путь к вложению: имя файла — не адрес, «%» в нём буквальный, поэтому кодируется целиком. */
function attachmentDestination(path: string): string {
  return encodeURI(path).replace(/\(/g, '%28').replace(/\)/g, '%29')
}

function rewriteWikiLinks(text: string, selfId: string, env: RenderEnv): string {
  const links = parseWikiLinks(text)
  if (links.length === 0) return text
  const index = env.titleIndex()
  let out = ''
  let last = 0
  for (const link of links) {
    const target = resolveWikiLink(link.target, index, selfId)
    const name = target && env.plan.notes.get(target.id)
    if (!name) continue
    out += text.slice(last, link.start) + (link.label === name ? `[[${name}]]` : `[[${name}|${link.label}]]`)
    last = link.end
  }
  return out + text.slice(last)
}

/** Незакрытый блок кода поглотил бы всё, что дописано ниже (в том числе раздел «Связанные»). */
function closeFence(text: string): string {
  const fence = unclosedFence(text)
  return fence ? `${text}\n${fence}` : text
}

function cleanBlock(raw: string | undefined): string {
  return (raw ?? '').replace(/\r\n?/g, '\n').replace(/^(?:[ \t]*\n)+/, '').trimEnd()
}

function noteContent(item: Item, env: RenderEnv): string {
  const text = cleanBlock(item.content)
  return text ? closeFence(rewriteWikiLinks(text, item.id, env)) : ''
}

function codeBlock(item: Item): string {
  const code = (item.content ?? '').replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  let longest = 0
  for (const run of code.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  const fence = '`'.repeat(Math.max(3, longest + 1))
  const language = (item.language ?? '').replace(/[`\s]+/g, '')
  return code ? `${fence}${language}\n${code}\n${fence}` : `${fence}${language}\n${fence}`
}

function bodyParts(item: Item, title: string, env: RenderEnv): string[] {
  const parts: string[] = []
  const push = (part: string) => {
    if (part) parts.push(part)
  }

  switch (item.type) {
    case 'code':
      parts.push(codeBlock(item))
      break
    case 'link': {
      const url = item.url?.trim()
      parts.push(url ? `[${linkText(title)}](${linkDestination(url)})` : linkText(title))
      const description = singleLine(item.linkMeta?.description ?? '')
      if (description) parts.push(`> ${description}`)
      push(noteContent(item, env))
      break
    }
    case 'file':
    case 'image': {
      push(noteContent(item, env))
      const path = hasAttachment(item) ? env.plan.attachments.get(item.id) : undefined
      if (path) {
        const link = `[${linkText(item.fileName?.trim() || title)}](${attachmentDestination(path)})`
        parts.push(item.type === 'image' ? `!${link}` : link)
      }
      break
    }
    default: {
      const own = singleLine(item.title ?? '')
      if (own) parts.push(`# ${own}`)
      push(noteContent(item, env))
    }
  }

  const ocr = cleanBlock(item.ocrText)
  if (ocr) parts.push(`## Распознанный текст\n\n${closeFence(ocr)}`)

  const seen = new Set([item.id])
  const related: string[] = []
  for (const id of Array.isArray(item.links) ? item.links : []) {
    if (seen.has(id)) continue
    seen.add(id)
    const name = env.plan.notes.get(id)
    if (name) related.push(`- [[${name}]]`)
  }
  if (related.length > 0) parts.push(`## Связанные\n\n${related.join('\n')}`)

  return parts
}

function renderItem(item: Item, env: RenderEnv): MdExportEntry {
  const title = displayTitle(item)
  // Записи нет в плане (корзина, чужой план): совпадения с именами плана не проверялись.
  const name = env.plan.notes.get(item.id) ?? unplannedNoteName(item)
  const markdown = [frontMatter(item, title, env), ...bodyParts(item, title, env)].join('\n\n') + '\n'

  const attachments: MdAttachment[] = []
  if (hasAttachment(item)) {
    const path = env.plan.attachments.get(item.id)
    if (path) {
      const fileName = path.slice(path.lastIndexOf('/') + 1)
      attachments.push({ path, fileId: item.fileId, name: item.fileName?.trim() || fileName })
    }
  }
  return { id: item.id, path: name + NOTE_EXT, markdown, attachments }
}

export function itemToMarkdown(
  item: Item,
  ctx: { categories: readonly Category[]; items: readonly Item[]; plan: MdExportPlan },
): MdExportEntry {
  return renderItem(item, makeEnv(ctx.categories, ctx.items, ctx.plan))
}

export function buildMarkdownExport(items: readonly Item[], categories: readonly Category[]): MdExportEntry[] {
  const plan = planMarkdownExport(items)
  const env = makeEnv(categories, items, plan)
  const seen = new Set<string>()
  const entries: MdExportEntry[] = []
  for (const item of exportOrder(items)) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    entries.push(renderItem(item, env))
  }
  return entries
}
