import { Fragment, useMemo } from 'react'
import { Icon } from '@/components/icons'
import { copyText } from '@/lib/actions'
import { LANGUAGES } from '@/lib/detect'
import { cn } from '@/lib/utils'

// ───────────────────────── токенизация ─────────────────────────
// Намеренно простая: комментарии, строки, числа, ключевые слова. Без внешних библиотек.

type Kind = 'plain' | 'comment' | 'string' | 'number' | 'keyword'
type Token = { kind: Kind; text: string }

const KW = {
  js: 'abstract as async await break case catch class const continue debugger declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface is keyof let namespace new null of private protected public readonly return set static super switch this throw true try type typeof undefined var void while with yield',
  python:
    'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield match case',
  rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
  go: 'break case chan const continue default defer else fallthrough false for func go goto if import interface map nil package range return select struct switch true type var',
  java: 'abstract boolean break byte case catch char class const continue default do double else enum extends false final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch this throw throws true try void volatile while var val fun object when override data sealed',
  c: 'auto break case char const continue default do double else enum extern false float for goto if inline int long namespace new nullptr register return short signed sizeof static struct switch template this true typedef typename union unsigned using virtual void volatile while class public private protected include define',
  sql: 'select from where and or not insert into values update set delete create table alter drop index join left right inner outer full on group by order having limit offset as distinct union all null is in like between exists case when then else end primary key foreign references default unique with returning',
  bash: 'if then else elif fi for while until do done case esac in function return exit local export echo cd set unset readonly source alias sudo true false',
  powershell:
    'if else elseif foreach for while do switch function param return break continue try catch finally throw begin process end true false null',
  css: 'important inherit initial unset none auto',
  ruby: 'alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield',
  php: 'abstract and array as break case catch class const continue declare default do echo else elseif extends false final finally fn for foreach function if implements include interface namespace new null or private protected public require return static switch this throw trait true try use var while yield',
  config: 'true false null yes no on off',
} as const

type Family = {
  keywords: Set<string>
  ignoreCase?: boolean
  /** Строчные комментарии. */
  line: string[]
  block?: [string, string]
  strings: string
}

function family(words: string, line: string[], block?: [string, string], strings = '"\'`', ignoreCase = false): Family {
  const list = words.split(' ')
  return { keywords: new Set(ignoreCase ? list.map((w) => w.toLowerCase()) : list), line, block, strings, ignoreCase }
}

const SLASH: [string, string] = ['/*', '*/']

const FAMILIES: Record<string, Family> = {
  js: family(KW.js, ['//'], SLASH),
  python: family(KW.python, ['#'], undefined, '"\''),
  rust: family(KW.rust, ['//'], SLASH, '"\''),
  go: family(KW.go, ['//'], SLASH),
  java: family(KW.java, ['//'], SLASH, '"\''),
  c: family(KW.c, ['//'], SLASH, '"\''),
  sql: family(KW.sql, ['--'], SLASH, '"\'`', true),
  bash: family(KW.bash, ['#'], undefined, '"\'`'),
  powershell: family(KW.powershell, ['#'], ['<#', '#>'], '"\'', true),
  css: family(KW.css, [], SLASH, '"\''),
  html: family('', [], ['<!--', '-->'], '"\''),
  ruby: family(KW.ruby, ['#'], undefined, '"\'`'),
  php: family(KW.php, ['//', '#'], SLASH, '"\''),
  config: family(KW.config, ['#'], undefined, '"\''),
  json: family('true false null', [], undefined, '"'),
  plain: family('', [], undefined, ''),
}

const ALIAS: Record<string, string> = {
  ts: 'js', tsx: 'js', js: 'js', jsx: 'js', javascript: 'js', typescript: 'js', mjs: 'js', cjs: 'js',
  python: 'python', py: 'python',
  rust: 'rust', rs: 'rust',
  go: 'go',
  java: 'java', kotlin: 'java', kt: 'java', swift: 'java', scala: 'java', csharp: 'java', cs: 'java', dart: 'java',
  c: 'c', cpp: 'c', 'c++': 'c', h: 'c', hpp: 'c', objc: 'c',
  sql: 'sql',
  bash: 'bash', sh: 'bash', shell: 'bash', zsh: 'bash', dockerfile: 'bash', makefile: 'bash',
  powershell: 'powershell', ps1: 'powershell',
  css: 'css', scss: 'css', less: 'css',
  html: 'html', xml: 'html', svg: 'html', vue: 'html',
  ruby: 'ruby', rb: 'ruby',
  php: 'php',
  yaml: 'config', yml: 'config', toml: 'config', ini: 'config',
  json: 'json', jsonc: 'json',
}

/** Файлы крупнее не подсвечиваем: токенизация на главном потоке не должна подвесить интерфейс. */
const MAX_HIGHLIGHT_CHARS = 100_000

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\\-/]/g, '\\$&')
}

const regexCache = new Map<string, RegExp>()

function buildRegex(key: string, fam: Family): RegExp {
  const cached = regexCache.get(key)
  if (cached) return cached
  const parts: string[] = []
  if (fam.block) parts.push(`${escapeRe(fam.block[0])}[\\s\\S]*?(?:${escapeRe(fam.block[1])}|$)`)
  for (const l of fam.line) parts.push(`${escapeRe(l)}[^\\n]*`)
  for (const q of fam.strings) {
    const e = escapeRe(q)
    parts.push(`${e}(?:\\\\[\\s\\S]|[^\\\\${e === '`' ? '`' : e}${q === '`' ? '' : '\\n'}])*(?:${e}|$)`)
  }
  parts.push('\\b\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b|\\b0x[\\da-fA-F]+\\b')
  parts.push('[A-Za-z_$][\\w$]*')
  const re = new RegExp(parts.join('|'), 'g')
  regexCache.set(key, re)
  return re
}

export function tokenize(code: string, language?: string): Token[] {
  const key = language ? (ALIAS[language.toLowerCase()] ?? 'plain') : 'plain'
  const fam = FAMILIES[key]
  if (key === 'plain' || code.length > MAX_HIGHLIGHT_CHARS) return [{ kind: 'plain', text: code }]
  const re = new RegExp(buildRegex(key, fam))
  const out: Token[] = []
  let last = 0
  const push = (kind: Kind, text: string) => {
    if (!text) return
    const prev = out[out.length - 1]
    if (prev && prev.kind === kind) prev.text += text
    else out.push({ kind, text })
  }
  for (const m of code.matchAll(re)) {
    const text = m[0]
    if (m.index > last) push('plain', code.slice(last, m.index))
    last = m.index + text.length
    const c = text[0]
    let kind: Kind = 'plain'
    if (fam.block && text.startsWith(fam.block[0])) kind = 'comment'
    else if (fam.line.some((l) => text.startsWith(l))) kind = 'comment'
    else if (fam.strings.includes(c)) kind = 'string'
    else if (/\d/.test(c)) kind = 'number'
    else if (fam.keywords.has(fam.ignoreCase ? text.toLowerCase() : text)) kind = 'keyword'
    push(kind, text)
  }
  if (last < code.length) push('plain', code.slice(last))
  return out
}

const KIND_CLASS: Record<Kind, string | undefined> = {
  plain: undefined,
  comment: 'text-muted-foreground italic',
  string: 'text-[color-mix(in_oklab,var(--cat-green)_55%,var(--foreground))]',
  number: 'text-[color-mix(in_oklab,var(--cat-orange)_55%,var(--foreground))]',
  keyword: 'text-brand pixel:text-brand-lo pixel:dark:text-brand-hi',
}

export function CodeView({
  code,
  language,
  maxLines,
  bare,
  className,
}: {
  code: string
  language?: string
  maxLines?: number
  // без px-well: в пиксельных сценах он рисует рамку со всех сторон, а превью в карточке нужна только нижняя
  bare?: boolean
  className?: string
}) {
  const preview = maxLines !== undefined
  const shown = useMemo(() => {
    if (!preview) return code
    return code.split('\n').slice(0, maxLines).join('\n')
  }, [code, preview, maxLines])
  const tokens = useMemo(() => tokenize(shown, language), [shown, language])
  const label = language ? (LANGUAGES.find((l) => l.id === language)?.label ?? language) : undefined

  return (
    <div
      className={cn(
        !bare && 'px-well',
        'group/code relative rounded-lg border border-border bg-muted/50 text-foreground',
        className,
      )}
    >
      <pre
        className={cn(
          'font-mono text-xs leading-relaxed',
          preview ? 'overflow-hidden px-2.5 py-2' : 'overflow-x-auto px-3 py-2.5',
          !preview && label && 'pt-7',
        )}
        tabIndex={preview ? undefined : 0}
        aria-label={preview ? undefined : 'Код'}
      >
        <code>
          {tokens.map((t, i) => {
            const cls = KIND_CLASS[t.kind]
            return cls ? (
              <span key={i} className={cls}>
                {t.text}
              </span>
            ) : (
              <Fragment key={i}>{t.text}</Fragment>
            )
          })}
        </code>
      </pre>
      {!preview && (
        <div className="absolute top-1 right-1 left-2 flex items-center justify-between gap-2">
          <span className="truncate text-xs text-muted-foreground">{label}</span>
          <button
            type="button"
            onClick={() => void copyText(code)}
            aria-label="Копировать код"
            className="px-btn flex h-6 items-center gap-1 rounded-md bg-muted px-1.5 text-xs text-muted-foreground transition-opacity outline-none hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60 group-hover/code:opacity-100 pointer-fine:opacity-0"
          >
            <Icon name="copy" size={12} />
            Копировать
          </button>
        </div>
      )}
    </div>
  )
}
