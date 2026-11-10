import type { ItemType } from '@/types'

/** Результат разбора ввода в форме быстрого добавления. */
export interface DetectResult {
  type: ItemType
  /** Для type === 'link': нормализованный адрес. */
  url?: string
  /** Для type === 'code': идентификатор языка из LANGUAGES (если удалось определить). */
  language?: string
  /** Заголовок не выводится: для текста UI берёт первую строку, для ссылки — метаданные страницы. */
  title?: string
  /** Если ввод был fenced-блоком (```lang … ```) — содержимое без обёртки. */
  stripped?: string
}

/** Языки для выпадающего списка в UI. id совпадают с тем, что возвращает detectInput. */
export const LANGUAGES: Array<{ id: string; label: string }> = [
  { id: 'ts', label: 'TypeScript' },
  { id: 'tsx', label: 'TSX' },
  { id: 'js', label: 'JavaScript' },
  { id: 'jsx', label: 'JSX' },
  { id: 'python', label: 'Python' },
  { id: 'json', label: 'JSON' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'scss', label: 'SCSS' },
  { id: 'sql', label: 'SQL' },
  { id: 'bash', label: 'Bash / Shell' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'rust', label: 'Rust' },
  { id: 'go', label: 'Go' },
  { id: 'java', label: 'Java' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'php', label: 'PHP' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'swift', label: 'Swift' },
  { id: 'yaml', label: 'YAML' },
  { id: 'toml', label: 'TOML' },
  { id: 'xml', label: 'XML' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'plaintext', label: 'Обычный текст' },
]

const LANGUAGE_ALIASES: Record<string, string> = {
  typescript: 'ts', mts: 'ts', cts: 'ts', 'ts-node': 'ts', deno: 'ts',
  javascript: 'js', mjs: 'js', cjs: 'js', node: 'js', nodejs: 'js', ecmascript: 'js',
  py: 'python', py3: 'python', python3: 'python', python2: 'python', pyw: 'python',
  jsonc: 'json', json5: 'json', geojson: 'json',
  htm: 'html', xhtml: 'html', vue: 'html', svelte: 'html',
  sass: 'scss', less: 'css', postcss: 'css',
  mysql: 'sql', postgres: 'sql', postgresql: 'sql', pgsql: 'sql', psql: 'sql', sqlite: 'sql',
  plsql: 'sql', tsql: 'sql', mssql: 'sql',
  sh: 'bash', shell: 'bash', zsh: 'bash', ksh: 'bash', fish: 'bash', console: 'bash',
  shellsession: 'bash', terminal: 'bash',
  ps: 'powershell', ps1: 'powershell', psm1: 'powershell', pwsh: 'powershell', posh: 'powershell',
  rs: 'rust', golang: 'go', kt: 'kotlin', kts: 'kotlin',
  h: 'c', 'c++': 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
  cs: 'csharp', 'c#': 'csharp', dotnet: 'csharp',
  rb: 'ruby', yml: 'yaml', md: 'markdown', mdx: 'markdown',
  xsd: 'xml', xsl: 'xml', plist: 'xml', rss: 'xml',
  docker: 'dockerfile', containerfile: 'dockerfile',
  text: 'plaintext', txt: 'plaintext', plain: 'plaintext', none: 'plaintext',
}
for (const { id } of LANGUAGES) LANGUAGE_ALIASES[id] = id

/** Приводит метку языка (из ```ts, имени файла и т.п.) к id из LANGUAGES; неизвестную — к нижнему регистру. */
export function normalizeLanguage(tag: string): string | undefined {
  const t = tag
    .trim()
    .toLowerCase()
    .replace(/^language-/, '')
    .replace(/^[.{]+|[}]+$/g, '')
  if (!t) return undefined
  return Object.hasOwn(LANGUAGE_ALIASES, t) ? LANGUAGE_ALIASES[t] : t
}

/** Язык по имени файла (для перетащенных исходников); undefined, если расширение не код. */
export function languageFromFileName(name: string): string | undefined {
  const base = (name.trim().toLowerCase().split(/[\\/]/).pop() ?? '')
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile'
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return undefined
  const ext = base.slice(dot + 1)
  return Object.hasOwn(LANGUAGE_ALIASES, ext) ? LANGUAGE_ALIASES[ext] : undefined
}

// ───────────────────────────── Ссылки ─────────────────────────────

const SCHEME_RE = /^[a-z][a-z\d+.-]*:\/\//i
const WEB_SCHEME_RE = /^(?:https?|ftp):\/\//i
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const LABEL_RE = /^[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?$/u

/**
 * «Длинные» зоны, которые засчитываются у голого домена без пути (example.com).
 * С путём (что-то.zone/путь) принимается любая буквенная зона.
 */
const KNOWN_TLDS = new Set([
  'com', 'net', 'org', 'edu', 'gov', 'mil', 'int', 'info', 'biz', 'name', 'pro', 'mobi', 'asia',
  'tel', 'travel', 'jobs', 'museum', 'aero', 'coop', 'cat', 'dev', 'app', 'page', 'cloud', 'tech',
  'site', 'online', 'store', 'shop', 'blog', 'wiki', 'news', 'media', 'live', 'life', 'world',
  'today', 'xyz', 'top', 'club', 'space', 'link', 'click', 'art', 'design', 'studio', 'agency',
  'digital', 'network', 'systems', 'solutions', 'software', 'tools', 'team', 'social', 'chat',
  'fun', 'games', 'game', 'love', 'one', 'plus', 'zone', 'guru', 'ninja', 'rocks', 'codes', 'run',
  'host', 'website', 'press', 'center', 'company', 'group', 'global', 'email', 'academy', 'school',
  'education', 'science', 'expert', 'works', 'build', 'fyi', 'icu', 'lol', 'moe', 'bot', 'how',
  'land', 'city', 'moscow', 'tatar', 'google', 'youtube', 'video', 'photo', 'photos', 'music',
  'review', 'reviews', 'help', 'support', 'finance', 'money', 'capital', 'ventures', 'events',
])
const CYRILLIC_TLDS = new Set([
  'рф', 'рус', 'москва', 'онлайн', 'сайт', 'орг', 'ком', 'дети', 'бел', 'укр', 'срб', 'мкд', 'қаз', 'мон',
])
/**
 * Двухбуквенные «зоны», которые в одиночном слове почти всегда расширение файла
 * (main.py, README.md, script.pl, main.cc, libfoo.so, Makefile.am, config.in).
 * ai и io сюда намеренно не входят: claude.ai, github.io набирают как адрес чаще, чем пишут
 * одним словом имя файла .ai/.io. С путём (wp.pl/news, docs.rs/serde) это по-прежнему ссылки.
 */
const FILE_LIKE_TLDS = new Set([
  'md', 'py', 'rs', 'sh', 'ps', 'pm', 'js', 'ts', 'cs', 'rb', 'go', 'kt', 'db', 'gz', 'xz', 'hs', 'ex',
  'pl', 'cc', 'so', 'am', 'in', 'ml', 'mm', 'sc', 'st', 'vb', 'fs',
])
/** Второй уровень национальной зоны (google.co.in, bbc.co.uk): адрес, а не имя файла. */
const SECOND_LEVEL_LABELS = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'gob', 'nic', 'mil'])
/**
 * Расширения, которые не бывают зонами вовсе: «Node.js/Express», «Chart.js/docs» — названия
 * технологий, а не адреса, даже если за ними «путь».
 */
const NOT_TLDS = new Set([
  'js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs', 'cs', 'rb', 'kt', 'kts', 'go', 'db', 'gz', 'xz', 'hs', 'ex', 'exs',
  'vb', 'fs', 'cpp', 'hpp', 'txt', 'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'log', 'csv', 'pdf',
  'exe', 'dll', 'html', 'htm', 'css', 'scss', 'php', 'java', 'swift', 'sql', 'lua', 'jpg', 'jpeg', 'png',
  'gif', 'svg', 'webp', 'mp3', 'mp4', 'doc', 'docx', 'xls', 'xlsx', 'pptx', 'rar', 'tmp', 'bak',
])

function parseUrl(s: string): URL | null {
  try {
    return new URL(s)
  } catch {
    return null
  }
}

function splitHostPort(authority: string): { host: string; port?: string } | null {
  if (authority.startsWith('[')) {
    const m = /^(\[[\da-f:.]+\])(?::(\d{1,5}))?$/i.exec(authority)
    return m ? { host: m[1], port: m[2] } : null
  }
  const i = authority.lastIndexOf(':')
  if (i === -1) return { host: authority }
  const port = authority.slice(i + 1)
  return /^\d{1,5}$/.test(port) ? { host: authority.slice(0, i), port } : null
}

function isDomain(host: string, hasPathOrPort: boolean): boolean {
  const labels = host.split('.')
  if (labels.length < 2 || !labels.every((l) => LABEL_RE.test(l))) return false
  const tld = labels[labels.length - 1]
  if (/^xn--[a-z\d-]+$/.test(tld)) return true
  if (!/^\p{L}{2,63}$/u.test(tld)) return false
  if (CYRILLIC_TLDS.has(tld)) return true
  if (/[^a-z]/.test(tld)) return hasPathOrPort
  if (NOT_TLDS.has(tld)) return false
  if (hasPathOrPort || (labels[0] === 'www' && labels.length >= 3)) return true
  if (tld.length === 2) {
    return !FILE_LIKE_TLDS.has(tld) || (labels.length >= 3 && SECOND_LEVEL_LABELS.has(labels[labels.length - 2]))
  }
  return KNOWN_TLDS.has(tld)
}

/**
 * Весь ввод — одна «голая» ссылка (без пробелов и переносов): http(s)/ftp, www.…, домен[/путь],
 * localhost:порт, IP. Не ссылки: «1.2.3», «file.txt», email, «слово.» в конце предложения.
 */
export function isUrl(s: string): boolean {
  const v = s.trim()
  if (!v || v.length > 8192 || /\s/.test(v)) return false

  if (SCHEME_RE.test(v)) {
    if (!WEB_SCHEME_RE.test(v)) return false
    const u = parseUrl(v)
    return !!u && u.hostname !== ''
  }

  const rest = v.startsWith('//') ? v.slice(2) : v
  const m = /^([^/?#]+)(.*)$/.exec(rest)
  if (!m) return false
  const [, authority, tail] = m
  if (authority.includes('@')) return false // email, а не ссылка
  const hp = splitHostPort(authority)
  if (!hp) return false
  const host = hp.host.toLowerCase()
  const hasPathOrPort = !!hp.port || tail !== ''

  let ok: boolean
  if (host.startsWith('[')) ok = true
  else if (host === 'localhost') ok = hasPathOrPort // одно слово «localhost» — не ссылка
  // Голый публичный IPv4 — скорее версия (1.0.0.1) или адрес DNS (8.8.8.8), чем страница;
  // локальный (192.168.1.1) — адрес роутера/dev-сервера, его открывают.
  else if (IPV4_RE.test(host)) ok = hasPathOrPort || isLocalHost(host)
  // «ASP.NET», «Node.JS» — так пишут названия технологий; набранный руками адрес зону не капслочит.
  else if (!hasPathOrPort && !host.startsWith('www.') && /[A-Z]/.test(hp.host.slice(hp.host.lastIndexOf('.') + 1))) ok = false
  else ok = isDomain(host, hasPathOrPort)
  return ok && parseUrl(normalizeUrl(v)) !== null
}

function isLocalHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '[::1]' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
  )
}

/** trim + схема по умолчанию: https://, а для localhost и частных IP — http:// (dev-серверы без TLS). */
export function normalizeUrl(s: string): string {
  const v = s.trim()
  if (!v || SCHEME_RE.test(v)) return v
  if (v.startsWith('//')) return `https:${v}`
  const host = (v.split(/[/?#]/)[0] ?? '').replace(/:\d+$/, '').toLowerCase()
  return `${isLocalHost(host) ? 'http' : 'https'}://${v}`
}

// ───────────────────────────── Файлы ─────────────────────────────

const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|avif|bmp|heic|heif|ico)$/i
/**
 * Формально image/*, но ни один браузер их не показывает — превью не построить.
 * HEIC/HEIF/TIFF сюда не входят: Safari (iPhone, macOS) их рисует, а Chromium/WebView2 — нет;
 * это проверяет repo.createItem декодированием и при неудаче сохраняет запись как 'file'.
 */
const NON_RENDERABLE_IMAGE_MIME = new Set(['image/vnd.adobe.photoshop', 'image/x-photoshop', 'image/x-psd'])

export function detectFileType(file: { type: string; name: string }): 'image' | 'file' {
  const mime = (file.type || '').toLowerCase()
  if (mime.startsWith('image/')) return NON_RENDERABLE_IMAGE_MIME.has(mime) ? 'file' : 'image'
  return IMAGE_EXT_RE.test(file.name || '') ? 'image' : 'file'
}

// ───────────────────────────── Код ─────────────────────────────

/** Длинные вставки анализируем по началу: эвристикам хватает, а регэкспы остаются быстрыми. */
const MAX_ANALYZE = 20_000

/**
 * \r\n → \n, хвостовые пробелы строк убраны, серии пустых строк сжаты до одной.
 * Правила ниже якорятся на начало строки (флаг m) и не должны перескакивать переводы строк:
 * `^\s*` на каждой из тысяч пустых строк сканировал всю серию — квадратичное время
 * (19 000 пустых строк — 5 с на каждый ввод). Поэтому в правилах `^[ \t]*`, а пустых серий нет.
 */
function compactLines(text: string): string {
  const out: string[] = []
  let blank = false
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    if (!line) {
      if (!blank && out.length) out.push('')
      blank = true
      continue
    }
    blank = false
    out.push(line)
  }
  return out.join('\n')
}

type Rule = readonly [re: RegExp, weight: number, cap?: number]

function scoreRules(text: string, rules: readonly Rule[]): number {
  let sum = 0
  for (const [re, weight, cap] of rules) {
    if (cap) sum += weight * Math.min(cap, text.match(re)?.length ?? 0)
    else if (re.test(text)) sum += weight
  }
  return sum
}

const JS_RULES: readonly Rule[] = [
  [/\b(?:const|let|var)\s+(?:[\w$]+|\{[^}\n]*\}|\[[^\]\n]*\])\s*(?::[^=\n]+)?=/, 3],
  // Длины ограничены: незакрытая скобка не должна заставлять каждый «function» сканировать текст до конца.
  [/\bfunction\s*\*?\s*[\w$]*\s*\([^)]{0,1000}\)\s*(?::[^{\n]{1,300})?\{/, 3],
  [/\([^()\n]*\)\s*=>|\b[\w$]+\s*=>/, 2],
  [/\bconsole\.(?:log|error|warn|info|debug|table|dir)\s*\(/, 3],
  [/^[ \t]*import\s+(?:[\w$*{][^'"\n]*?\s+from\s+)?['"][^'"\n]+['"][ \t]*;?[ \t]*$/m, 3],
  [/^[ \t]*export\s+(?:default\b|const\b|let\b|function\b|class\b|async\b|\{|\*)/m, 3],
  [/\brequire\s*\(\s*['"]/, 2],
  [/\bmodule\.exports\b/, 3],
  [/===|!==/, 2],
  [/\b(?:document|window|localStorage|navigator)\.\w+/, 2],
  [/\bawait\s+[\w$.]+/, 1],
  [/\.(?:map|filter|reduce|forEach|then|catch|push|includes)\s*\(/, 1],
  [/\bundefined\b/, 1],
  [/`[^`\n]*\$\{[^}\n]+\}[^`\n]*`/, 2],
  [/\bnew\s+(?:Promise|Map|Set|Error|URL|Date|RegExp)\s*\(/, 1],
  [/\btypeof\s+[\w$]+/, 1],
]

const TS_RULES: readonly Rule[] = [
  [/^[ \t]*(?:export\s+)?(?:declare\s+)?interface\s+\w+(?:<[^>\n]*>)?\s*(?:extends\s+[^{\n]+)?\{/m, 4],
  [/^[ \t]*(?:export\s+)?type\s+\w+(?:<[^>\n]*>)?\s*=/m, 4],
  [/[\w$)\]]\??\s*:\s*(?:string|number|boolean|void|any|unknown|never|bigint|object)(?:\[\])?\s*[,;)=|&{\n]/, 3],
  [/\bimport\s+type\b|\bexport\s+type\s*\{/, 4],
  [/\bas\s+(?:const|unknown|any|string|number)\b/, 3],
  [/\b(?:Record|Partial|Pick|Omit|Readonly|ReadonlyArray|Promise|Array)<[^>\n]+>/, 2],
  [/\b(?:private|protected|public|readonly)\s+[\w$]+\s*[?!]?:/, 2],
  // \b обязателен: без него на длинном слове поиск становится квадратичным
  [/\b\w+<(?:string|number|boolean|[A-Z][\w$]*)(?:\[\])?(?:\s*\|\s*[\w$]+)*>\s*\(/, 2],
]

const JSX_RULES: readonly Rule[] = [
  [/\bclassName\s*=\s*[{"']/, 4],
  [/\bon[A-Z]\w*\s*=\s*\{/, 4],
  [/(?:^|[(=>?:]|\breturn)\s*<[A-Z][\w.]*(?:\s+[\w-]+(?:=(?:\{[^}\n]*\}|"[^"\n]*"))?)*\s*\/?>/m, 2],
  [/\breturn\s*\(\s*<[\w>]/, 4],
  [/<\w+[^<>\n]*=\{[^}\n]*\}[^<>\n]*\/?>/, 3],
  [/<>\s*(?:\n|<)|<\/>/, 2],
]

const C_RULES: readonly Rule[] = [
  [/^[ \t]*#\s*include\s*[<"][\w./+-]+[>"]/m, 4],
  [/\bint\s+main\s*\(/, 3],
  [/\b(?:printf|fprintf|sprintf|scanf|malloc|calloc|realloc|free|strlen|strcpy|memcpy|memset)\s*\(/, 2],
  [/^[ \t]*#\s*(?:define|ifdef|ifndef|endif|pragma)\b/m, 3],
  [/\btypedef\s+(?:struct|enum|unsigned|int|char|void)\b/, 3],
  [/\b(?:unsigned|signed)\s+(?:int|char|long|short)\b|\bsize_t\b|\buint\d+_t\b/, 2],
  [/\b(?:int|char|float|double|void|long)\s*\*+\s*\w+/, 2],
  [/\breturn\s+0\s*;/, 1],
  [/\bNULL\b/, 1],
]

const CPP_RULES: readonly Rule[] = [
  [/\bstd::\w+/, 4],
  [/\bcout\s*<<|\bcin\s*>>|\bendl\b/, 4],
  [/\btemplate\s*</, 3],
  [/\bnullptr\b/, 3],
  [/^[ \t]*#\s*include\s*<(?:iostream|vector|string|map|unordered_map|set|memory|algorithm|thread|fstream|sstream|cstdio|cstdlib|array|optional|functional)>/m, 4],
  [/\busing\s+namespace\s+\w+\s*;/, 4],
  [/^[ \t]*(?:public|private|protected):[ \t]*$/m, 3],
  [/\bvirtual\s+\w+|\bconst\s+\w+\s*&|::\w+\s*\(/, 2],
  [/\bauto\s+\w+\s*=/, 1],
]

/** Правила остальных языков; порядок ключей — приоритет при равенстве очков. */
const RULES: Record<string, readonly Rule[]> = {
  python: [
    [/^[ \t]*(?:async\s+)?def\s+\w+\s*\([^)]*\)\s*(?:->\s*[^:\n]+)?:[ \t]*(?:#.*)?$/m, 4],
    [/^[ \t]*class\s+\w+(?:\([^)]*\))?:[ \t]*$/m, 4],
    [/^[ \t]*from\s+[\w.]+\s+import\s+[\w*(]/m, 4],
    [/^[ \t]*import\s+[\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+)*[ \t]*$/m, 2],
    [/^[ \t]*(?:if|elif|for|while|with|try|except|else|finally)\b[^\n]*:[ \t]*$/m, 1],
    [/\bprint\s*\(/, 2],
    [/\bself\.\w+/, 2],
    [/\b(?:True|False|None)\b/, 1],
    [/__\w+__/, 2],
    [/\belif\b/, 3],
    [/\blambda\s+[\w, ]{0,200}:/, 2],
    [/\bf["'][^"'\n]{0,200}\{[^}\n]{1,200}\}/, 2],
    [/\b(?:len|range|enumerate|isinstance|zip)\s*\(/, 1],
    [/^[ \t]*@\w+(?:\.\w+)*(?:\([^)\n]*\))?[ \t]*$/m, 1],
  ],
  sql: [
    // SELECT…FROM сам по себе бывает и в прозе — см. SQL_SELECT_FROM в guessLanguage.
    [/\bselect\s+(?:\*|[\w.]+\s*,\s*[\w.]+)[\s\S]{0,2000}?\bfrom\s+[\w."`]+/i, 2],
    [/\bSELECT\s+(?:DISTINCT\s+)?[\w.]+\s+FROM\s+[\w."`]+/, 2],
    [/\bINSERT\s+INTO\b|\binsert\s+into\s+[\w."`]+\s*(?:\([^)]*\)\s*)?values\b/i, 4],
    [/\bUPDATE\s+[\w."`]+\s+SET\b/, 4],
    [/\bDELETE\s+FROM\b/, 4],
    [/\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|INDEX|UNIQUE\s+INDEX|VIEW|DATABASE|SCHEMA|FUNCTION|PROCEDURE|TRIGGER|EXTENSION)\b|\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?[\w."`]+\s*\(/i, 4],
    [/\b(?:ALTER|DROP|TRUNCATE)\s+TABLE\b/, 4],
    [/\b(?:INNER|LEFT|RIGHT|FULL|CROSS)\s+(?:OUTER\s+)?JOIN\b/i, 3],
    [/\b(?:GROUP|ORDER)\s+BY\b/, 2],
    [/\bWHERE\b/, 1],
    [/\bVALUES\s*\(/i, 2],
    [/\b(?:VARCHAR|INTEGER|BIGINT|SERIAL|PRIMARY\s+KEY|NOT\s+NULL|FOREIGN\s+KEY|REFERENCES|TIMESTAMP)\b/, 2],
  ],
  bash: [
    [/\|\s*(?:grep|awk|sed|sort|uniq|head|tail|wc|xargs|tee|jq|less|cut|tr)\b/, 3],
    [/^[ \t]*(?:if\s+\[\[?\s|fi[ \t]*$|done[ \t]*$|esac[ \t]*$|then[ \t]*$|for\s+\w+\s+in\s)/m, 3],
    [/\s2>&1\b|>\s*\/dev\/null|\s&>\s/, 3],
    [/^[ \t]*export\s+[A-Z_][A-Z\d_]*=/m, 3],
    [/^[A-Z_][A-Z\d_]*=\S*$/gm, 1, 3],
    [/\$\{?[A-Za-z_]\w*\}?/, 1],
    [/\$\(\s*[\w-]+/, 2],
    [/^[ \t]*(?:alias|unset|source)\s+\S/m, 2],
    [/\becho\s+["'$]/, 2],
    [/(?:^|\s)-{1,2}[a-z][\w-]*(?:=\S+)?(?=\s|$)/m, 1],
  ],
  powershell: [
    [/\b(?:Get|Set|New|Remove|Add|Clear|Copy|Move|Rename|Write|Read|Invoke|Start|Stop|Restart|Test|Import|Export|Select|Where|ForEach|Sort|Group|Measure|Out|Format|ConvertTo|ConvertFrom|Install|Uninstall|Enable|Disable|Update|Join|Split|Resolve|Push|Pop|Register|Unregister|Wait|Expand|Compress)-[A-Z][A-Za-z]+\b/, 4],
    [/\$env:\w+/, 4],
    [/\$_\b|\$_\./, 2],
    [/\s-(?:eq|ne|gt|ge|lt|le|like|notlike|match|notmatch|contains|in|and|or|not)\b/, 1],
    [/\[(?:string|int|bool|array|hashtable|datetime|PSCustomObject|System\.[\w.]+)\]/i, 3],
    [/\bparam\s*\(/i, 2],
    [/@\{|@\(/, 1],
    [/\$\w+\s*=/, 1],
    [/\$(?:true|false|null)\b/i, 3],
  ],
  rust: [
    [/\bfn\s+\w+\s*(?:<[^>\n]*>)?\s*\(/, 3],
    [/\blet\s+mut\b/, 4],
    [/\bimpl(?:<[^>\n]*>)?\s+[\w:<>]+(?:\s+for\s+[\w:<>]+)?\s*\{/, 4],
    [/\bpub\s+(?:fn|struct|enum|mod|trait|use|crate|const|type)\b/, 4],
    [/^[ \t]*use\s+(?:std|crate|super|self|\w+)::/m, 4],
    [/\b(?:println|print|eprintln|format|vec|panic|assert|assert_eq|macro_rules|write|writeln)!\s*[([{]/, 4],
    [/->\s*(?:Self|Result|Option|Vec|String|&?str|u\d+|i\d+|f\d+|bool|usize|Box)\b/, 3],
    [/&(?:mut\s+)?self\b/, 4],
    [/#\[(?:derive|test|cfg|tokio|allow)/, 4],
    [/\b(?:Option|Result|Vec|Box|Rc|Arc)<[^>\n]+>/, 2],
    [/\.unwrap\(\)/, 3],
    [/\bmatch\s+[\w.&*]+\s*\{/, 2],
  ],
  go: [
    [/^[ \t]*package\s+\w+[ \t]*$/m, 4],
    [/\bfunc\s+(?:\([^)]*\)\s*)?\w+\s*\(/, 3],
    [/:=/, 2],
    [/\bfmt\.\w+\(/, 4],
    [/\bimport\s+\(\s*\n?\s*"/, 4],
    [/\berr\s*!=\s*nil\b/, 4],
    [/\bgo\s+func\b|\bchan\s+\w+|\bdefer\s+\w+/, 3],
    [/\bmake\(\s*(?:\[\]|map|chan)/, 3],
  ],
  java: [
    [/\bpublic\s+(?:static\s+)?(?:final\s+)?(?:abstract\s+)?class\s+\w+/, 3],
    [/\bpublic\s+static\s+void\s+main\s*\(\s*String/, 6],
    [/\bSystem\.out\.print(?:ln|f)?\s*\(/, 6],
    [/^[ \t]*import\s+(?:static\s+)?[\w.]+(?:\.\*)?;[ \t]*$/m, 3],
    [/^[ \t]*package\s+[\w.]+;[ \t]*$/m, 4],
    [/@Override\b|@Autowired\b|@Test\b/, 2],
    [/\b(?:private|public|protected)\s+(?:static\s+)?(?:final\s+)?(?:int|long|double|boolean|String|void|List<[^>\n]*>|Map<[^>\n]*>)\s+\w+/, 2],
    [/\bString\[\]|\bArrayList<|\bHashMap<|\bnew\s+\w+<>\s*\(/, 3],
    [/\bthrows\s+\w+/, 3],
  ],
  kotlin: [
    [/\bfun\s+(?:<[^>\n]*>\s*)?[\w.]+\s*\(/, 4],
    [/\bval\s+\w+\s*[:=]/, 3],
    [/\bdata\s+class\b|\bcompanion\s+object\b|\bwhen\s*\([^)]*\)\s*\{/, 4],
    [/\bprintln\s*\(/, 1],
  ],
  csharp: [
    [/^[ \t]*using\s+System(?:\.[\w.]+)?;[ \t]*$/m, 6],
    [/^[ \t]*using\s+[\w.]+;[ \t]*$/m, 2],
    [/\bnamespace\s+[\w.]+\s*[;{]?/, 2],
    [/\bConsole\.(?:WriteLine|Write|ReadLine|ReadKey)\s*\(/, 6],
    [/\{\s*get;\s*(?:(?:private\s+|init;?\s*)?set;)?\s*\}/, 5],
    [/\b(?:public|private|internal|protected)\s+(?:static\s+)?(?:async\s+)?(?:string|bool)\b/, 3],
    [/\basync\s+Task\b|\bTask<\w+>/, 4],
    [/\bvar\s+\w+\s*=\s*new\b/, 1],
    [/\[(?:HttpGet|HttpPost|Fact|Test|Serializable|ApiController|Route)\b/, 3],
    [/\binternal\s+(?:class|static|sealed)|\bsealed\s+class\b/, 3],
  ],
  php: [
    [/<\?php/, 10],
    [/\$this->/, 4],
    [/\$\w+->\w+/, 3],
    [/\bfunction\s+\w+\s*\([^)]*\$\w+/, 3],
    [/\bpublic\s+function\b/, 4],
    [/\b(?:namespace|use)\s+[A-Z][\w\\]+;/, 3],
    [/\barray\s*\(|\[\s*['"]\w+['"]\s*=>/, 2],
    [/\$\w+\s*=\s*[^=]/, 1],
  ],
  ruby: [
    [/^[ \t]*def\s+\w+[?!]?\s*(?:\([^)]*\))?[ \t]*$/m, 3],
    [/^[ \t]*end[ \t]*$/m, 2],
    [/\bputs\s+/, 3],
    [/^[ \t]*require(?:_relative)?\s+['"]/m, 3],
    [/\bdo\s*\|[\w,\s]+\|/, 4],
    [/\battr_(?:accessor|reader|writer)\b/, 4],
    [/\.each\s+do\b|\.each\s*\{/, 3],
    [/^[ \t]*class\s+\w+\s*<\s*\w+/m, 3],
    [/\bnil\b/, 1],
  ],
  swift: [
    [/^[ \t]*import\s+(?:UIKit|SwiftUI|Foundation|Combine|AppKit)[ \t]*$/m, 6],
    [/\bfunc\s+\w+\s*(?:<[^>\n]*>)?\s*\([^)]*\)\s*(?:async\s+)?(?:throws\s+)?->/, 4],
    [/\b(?:guard|if)\s+let\s+\w+/, 4],
    [/@(?:State|Published|Binding|ObservedObject|MainActor|objc)\b|\bsome\s+View\b/, 5],
    [/\bvar\s+\w+\s*:\s*[A-Z]\w*[?!]?\s*(?:=|\{|$)/m, 2],
    [/\bstruct\s+\w+\s*:\s*\w+\s*\{/, 3],
  ],
  css: [
    [/^[ \t]*(?:-?[a-z]+(?:-[a-z]+)+|color|background|margin|padding|display|width|height|border|position|top|left|right|bottom|opacity|transform|transition|flex|grid|gap|overflow|cursor|content|outline|float|clear|visibility|animation|filter|inset|order|resize|fill|stroke)[ \t]*:[ \t]*(?!(?:string|number|boolean|any|unknown)\b)[^;{}\n]+;[ \t]*$/gm, 2, 4],
    // каждое повторение начинается с разделителя — иначе на обычной фразе регэксп уходит в экспоненциальный перебор
    [/^[ \t]*(?:[.#]?[\w-]+|\*|\[[^\]\n]+\])(?:(?:[ \t>+~,]+(?:[.#]|::?)?|[.#]|::?)[\w-]+(?:\([^)\n]*\))?)*[ \t]*\{[ \t]*$/m, 1],
    [/@media\b|@import\s+(?:url\(|["'])|@keyframes\b|@font-face\b|@supports\b|:root\s*\{|@tailwind\b|@apply\b|@layer\b/, 4],
    [/!important\b/, 3],
    [/\bvar\(--[\w-]+/, 3],
    [/^[ \t]*--[\w-]+\s*:\s*[^;\n]+;/m, 3],
    [/\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw)\b/, 1],
    [/#[\da-fA-F]{3,8}\s*;/, 2],
  ],
  html: [
    [/<\/(?:div|span|p|a|ul|ol|li|html|body|head|section|header|footer|main|table|tr|td|th|form|button|h[1-6]|script|style|nav|article|aside|label|select|option|textarea|strong|em|b|i|code|pre|title)>/i, 3],
    [/<(?:div|span|p|a|ul|ol|li|img|br|hr|input|button|section|header|footer|main|table|form|label|meta|link|script|style|h[1-6]|nav|article|body|head|html|template|iframe|video|source|picture)\b[^<>]*\/?>/i, 2],
    [/\s(?:class|href|src|id|style|alt|type|rel|charset|lang)\s*=\s*"[^"]*"/, 1],
    [/<!--[\s\S]{0,2000}?-->/, 1],
  ],
  xml: [
    [/^[ \t]*<\?xml\b/, 10],
    [/<\/?[a-z]+:[a-z]+[\s>]/i, 2],
    [/<svg\b[^>]*\bxmlns=/, 4],
  ],
  dockerfile: [
    [/^[ \t]*FROM\s+[\w./:@${}-]+(?:\s+(?:AS|as)\s+\w+)?[ \t]*$/m, 2],
    [/^[ \t]*(?:RUN|COPY|ADD|CMD|ENTRYPOINT|WORKDIR|EXPOSE|ENV|ARG|LABEL|USER|VOLUME|HEALTHCHECK)\s+\S/gm, 2, 3],
  ],
}

/**
 * «SELECT лучший вариант FROM списка» — обычная фраза, поэтому SELECT…FROM засчитывается
 * только вместе с другим признаком SQL (WHERE, JOIN, *, список столбцов, ORDER BY, …).
 * Длина между ними ограничена: иначе каждый SELECT без FROM сканировал бы текст до конца.
 */
const SQL_SELECT_FROM = /\bSELECT\b[\s\S]{1,2000}?\bFROM\b/

const SCSS_SIGNS =/^[ \t]*\$[\w-]+\s*:|&(?::|\.|\s*\{)|@(?:mixin|include|extend|use)\b/m
const TOML_SECTION = /^[ \t]*\[\[?[\w.\-" ]+\]\]?[ \t]*$/m
const TOML_KV = /^[ \t]*[\w.\-"]+[ \t]*=[ \t]*(?:"[^"\n]*"|'[^'\n]*'|\d[\d._:\-TZ+]*|true|false|\[[^\n]*\]|\{[^\n]*\})[ \t]*(?:#.*)?$/gm

const SHELL_COMMANDS = new Set([
  'apt', 'apt-get', 'brew', 'npm', 'npx', 'yarn', 'pnpm', 'bun', 'pip', 'pip3', 'pipx', 'poetry',
  'uv', 'git', 'gh', 'docker', 'docker-compose', 'podman', 'kubectl', 'helm', 'cargo', 'rustup',
  'go', 'make', 'cmake', 'curl', 'wget', 'ssh', 'scp', 'rsync', 'tar', 'unzip', 'zip', 'chmod',
  'chown', 'mkdir', 'rm', 'cp', 'mv', 'ls', 'cd', 'cat', 'grep', 'sed', 'awk', 'find', 'echo',
  'export', 'source', 'systemctl', 'journalctl', 'service', 'node', 'deno', 'python', 'python3',
  'composer', 'gem', 'bundle', 'dotnet', 'mvn', 'gradle', 'flutter', 'winget', 'choco', 'scoop',
  'touch', 'ln', 'kill', 'pkill', 'tail', 'head', 'less', 'vim', 'nano', 'code', 'open',
  'xdg-open', 'sh', 'bash', 'zsh', 'ffmpeg', 'openssl', 'ping', 'tauri', 'vite', 'tsc', 'eslint',
  'prettier', 'pm2', 'nvm', 'conda', 'jq', 'terraform', 'ansible', 'heroku', 'vercel', 'firebase',
])
const SHELL_SUBCOMMANDS = new Set([
  'install', 'i', 'add', 'remove', 'rm', 'uninstall', 'run', 'exec', 'init', 'create', 'build',
  'start', 'stop', 'test', 'dev', 'update', 'upgrade', 'clone', 'commit', 'push', 'pull', 'fetch',
  'checkout', 'switch', 'status', 'log', 'diff', 'merge', 'rebase', 'branch', 'reset', 'stash',
  'tag', 'compose', 'up', 'down', 'ps', 'images', 'restart', 'apply', 'get', 'describe', 'logs',
  'new', 'publish', 'login', 'config', 'list', 'ls', 'show', 'ci', 'audit', 'link', 'version',
  'info', 'search', 'cache', 'clean', 'prune', 'serve', 'watch', 'deploy', 'enable', 'disable',
  'reload', 'daemon-reload', 'outdated', 'tidy', 'mod', 'fmt', 'clippy',
])

const CYRILLIC_RE = /\p{Script=Cyrillic}/u
const CYRILLIC_WORD_RE = /\p{Script=Cyrillic}{2,}/gu

/**
 * Строковые литералы → "". Одним проходом: регэксп `(["'`])(?:\\.|…)*\1` от каждой незакрытой
 * кавычки сканировал строку до конца — на строке из `\"` это квадратично (20 000 символов — 3 с).
 */
function stripStrings(line: string): string {
  let out = ''
  // Для этих кавычек закрывающей до конца строки уже нет: дальше их не ищем.
  const unclosed = new Set<string>()
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if ((c === '"' || c === "'" || c === '`') && !unclosed.has(c)) {
      let j = i + 1
      while (j < line.length && line[j] !== c) j += line[j] === '\\' ? 2 : 1
      if (j < line.length) {
        out += '""'
        i = j
        continue
      }
      unclosed.add(c)
    }
    out += c
  }
  return out
}

/** Убирает /* … *\/ без регэкспа: `/\*.*?\*\//` от каждого незакрытого /* шёл до конца строки. */
function stripBlockComments(line: string): string {
  let out = ''
  let pos = 0
  for (;;) {
    const open = line.indexOf('/*', pos)
    if (open < 0) break
    const close = line.indexOf('*/', open + 2)
    if (close < 0) break
    out += line.slice(pos, open) + ' '
    pos = close + 2
  }
  return out + line.slice(pos)
}

/** Убирает строковые литералы и комментарии — чтобы кириллица в них не мешала распознать код. */
function stripStringsAndComments(line: string): string {
  return stripBlockComments(stripStrings(line)).replace(/(?:^|\s)(?:\/\/|#|--\s).*$/, '')
}

/** Срезает хвостовую пунктуацию без регэкспа `[…]+$` (он квадратичен на длинной серии точек). */
function trimTrailingPunct(s: string): string {
  let end = s.length
  while (end > 0 && '.,!?;:'.includes(s[end - 1])) end--
  return s.slice(0, end)
}

function isShellCommandLine(line: string): boolean {
  const t = stripStringsAndComments(line.trim().replace(/^\$\s+/, '')).trim()
  if (!t || CYRILLIC_RE.test(t)) return false
  const tokens = t.split(/\s+/)
  let i = 0
  while (i < tokens.length && (tokens[i] === 'sudo' || /^[A-Z_][A-Z\d_]*=\S*$/.test(tokens[i]))) i++
  const cmd = tokens[i]
  if (!cmd || !SHELL_COMMANDS.has(cmd)) return false
  const args = tokens.slice(i + 1).map(trimTrailingPunct)
  if (!args.length) return false
  return (
    SHELL_SUBCOMMANDS.has(args[0]) ||
    args.some((a) => /^-{1,2}[\w-]|[/\\=@$|&>~*]|\w\.\w|^\.{1,2}$/.test(a))
  )
}

/** Строки, которые почти наверняка код (проверяются до «похоже на прозу»). */
const STRONG_LINE: readonly RegExp[] = [
  /\{\s*$/,
  /^[}\])]+[\s;,)\]}]*(?:(?:else|catch|finally|while)\b.*)?$/,
  /=>|===|!==|&&|\|\||::|:=|\+\+|\+=|-=|\*=|\?\?|\?\.[\w$]/,
  /^<\/?[A-Za-z][\w.:-]*(?:\s[^<>]*)?\/?>|^<!(?:--|doctype)/i,
  /^@[\w.]+(?:\(.*\))?$/,
  /^[\w$.]+\(.*\)[;,]?$/,
  // Присваивание. «budget = 500», «owner = me» без «;» — это заметка-список, а не код:
  // голое «слово = слово» сильным признаком не считается.
  /^(?![A-Za-z_]\w*[ \t]*=[ \t]*[\w.-]+$)[\w$.[\]'"]+\s*[-+*/%|&]?=\s*[^=\s]/,
  /^(?:SELECT|FROM|WHERE|AND|OR|ORDER BY|GROUP BY|HAVING|LIMIT|OFFSET|(?:LEFT |RIGHT |INNER |FULL |CROSS )?JOIN|ON|INSERT INTO|VALUES|UPDATE|SET|DELETE FROM|CREATE|ALTER|DROP|WITH|UNION|RETURNING)(?:\s|$)/,
  /^(?:FROM|RUN|COPY|ADD|CMD|ENTRYPOINT|WORKDIR|EXPOSE|ENV|ARG|LABEL|USER|VOLUME|HEALTHCHECK)\s+\S/,
  /^(?:[A-Z][a-z]+-[A-Z][A-Za-z]+|\$[\w:]+\s*=)/,
  /^\$\s+\S/,
  /^#\s*(?:include|define|ifn?def|endif|pragma|import)\b/,
  /^(?:import\s+(?:type\s+)?(?:[\w$]+\s*,?\s*)?(?:\{[^}]*\}|\*\s+as\s+[\w$]+)?\s*from\s+['"]|import\s+['"]|from\s+[\w.]+\s+import\s|import\s+[\w.]+(?:\s+as\s+\w+)?$|import\s+(?:static\s+)?[\w.]+(?:\.\*)?;$)/,
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s*[\w$]*\s*\(/,
  /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+[A-Z][\w$]*/,
  /^(?:export\s+)?(?:declare\s+)?(?:interface|enum)\s+[A-Z][\w$]*/,
  /^(?:export\s+)?type\s+[\w$]+(?:<[^>]*>)?\s*=/,
  /^(?:export\s+)?(?:const|let|var)\s+(?:[\w$]+|\{[^}]*\}|\[[^\]]*\])\s*(?::[^=]+)?=/,
  /^export\s+(?:default\b|\{|\*)/,
  /^(?:async\s+)?def\s+\w+\s*\(/,
  /^(?:pub(?:\([\w:]+\))?\s+)?(?:async\s+)?(?:fn\s+\w+|struct\s+[A-Z]|enum\s+[A-Z]|trait\s+[A-Z]|impl\b|mod\s+\w+|use\s+[\w:]+::)/,
  /^func\s+(?:\([^)]*\)\s*)?\w+\s*\(/,
  /^package\s+[\w.]+;?$/,
  /^using\s+[\w.]+;$|^namespace\s+[\w.\\]+/,
  /^(?:public|private|protected|internal|static)\s.*[({;=]/,
  /^return(?:\s.*)?[;)\]}]$|^return;?$/,
]

/** Ключевые слова в начале строки: код, если строка не оказалась обычной фразой. */
const WEAK_LINE: readonly RegExp[] = [
  /^(?:if|elif|else|for|while|with|try|except|finally|switch|case|default|match|loop|do)\b.*[:{(]$/,
  /^(?:if|while|for|switch|catch)\s*\(/,
  /^(?:return|yield|await|throw|raise|break|continue|pass|print|echo|puts|printf|import|export|from|class|struct|def|fn|func|let|var|const|val|use|template|typedef|delete|new|unset|local|declare)\b/,
  /^[[{]/,
  /^[A-Z_][A-Z\d_]*=\S/,
]

function endsWithStatement(t: string): boolean {
  if (!/;\s*$/.test(t)) return false
  return (
    // Скобки — только вызов вплотную (foo(…)) или хвост многострочного вызова («bar);»):
    // «call John (again);» — фраза с пояснением в скобках, а не код.
    /[=[\]<>{}]|[\w$\]>)]\(|[\w$]\.[\w$]|^(?:return|break|continue|import|using|package|use|let|var|const|int|char|float|double|long|auto)\b/.test(t) ||
    (!t.includes('(') && t.includes(')')) ||
    /^[\w$<>[\]*&:]+\s+[\w$*&]+\s*;$/.test(t) ||
    /^-?[\w$-]+\??\s*:\s*[^;]+;$/.test(t)
  )
}

/** Фраза естественного языка: 4+ слов, три подряд, почти без «синтаксических» символов. */
function isProseLine(t: string): boolean {
  const words = t.match(/\p{L}{2,}/gu)
  if (!words || words.length < 4) return false
  if (!/\p{L}{2,}[,:;]?\s+\p{L}{2,}[,:;]?\s+\p{L}{2,}/u.test(t)) return false
  const chars = [...t]
  const plain = chars.filter((c) => /[\p{L}\p{N}\s.,!?:;'"«»()\-–—…%№]/u.test(c)).length
  return plain / chars.length >= 0.9
}

type LineKind = 'code' | 'prose' | 'other' | 'skip'

const COMMENT_LINE = /^(?:\/\/|\/\*|\*\/|\*(?:\s|$)|<!--|--\s|#(?!\s*(?:include|define|ifn?def|endif|pragma|import)\b|!))/
const LIST_ITEM = /^(?:[-+•—–]\s|\d{1,3}[.)]\s)/

function classifyLine(raw: string): LineKind {
  const t = raw.trim()
  if (!t || COMMENT_LINE.test(t)) return 'skip'
  if (LIST_ITEM.test(t)) return 'prose'
  const bare = stripStringsAndComments(t)
  // строка из одного литерала (docstring, элемент массива) ничего не говорит о типе
  if (!bare.replace(/[\s"',;]/g, '')) return 'skip'
  if (CYRILLIC_RE.test(bare)) return (bare.match(CYRILLIC_WORD_RE)?.length ?? 0) >= 2 ? 'prose' : 'other'
  if (STRONG_LINE.some((re) => re.test(t)) || endsWithStatement(t)) return 'code'
  if (isShellCommandLine(t)) return 'code'
  if (isProseLine(t)) return 'prose'
  if (WEAK_LINE.some((re) => re.test(t))) return 'code'
  return 'other'
}

function syntaxDensity(t: string): number {
  const nonSpace = t.replace(/\s+/g, '').length
  return nonSpace ? (t.match(/[{}[\]();=<>]/g)?.length ?? 0) / nonSpace : 0
}

/**
 * YAML: строки «ключ: значение» плюс хотя бы один СТРУКТУРНЫЙ признак — вложенность, список
 * отображений, `---`, блочный скаляр, якорь. Типизированные значения (числа, true, кавычки)
 * сами по себе не в счёт: «Login: admin / Password: 12345 / Port: 8080» — заметка, а не конфиг.
 */
function looksLikeYaml(lines: string[]): boolean {
  let kv = 0
  let list = 0
  let other = 0
  let structural = 0
  let scalar = 0
  let openKeyIndent = -1
  let blockIndent = -1
  for (const line of lines) {
    if (!line.trim() || /^\s*#/.test(line)) continue
    const indent = line.length - line.trimStart().length
    if (blockIndent >= 0) {
      if (indent > blockIndent) continue // содержимое блочного скаляра `key: |`
      blockIndent = -1
    }
    const t = line.trim()
    if (t === '---' || t === '...') {
      structural++
      continue
    }
    const nested = openKeyIndent >= 0 && indent > openKeyIndent
    const m = /^(-\s+)?([A-Za-z_][\w.-]*|"[^"\n]*"|'[^'\n]*')\s*:(?:\s+(.*))?$/.exec(t)
    if (m) {
      kv++
      if (m[1] || nested) structural++
      const value = (m[3] ?? '').trim()
      openKeyIndent = value === '' ? indent : -1
      if (/^[|>][-+]?$/.test(value) || /^[&*]\w+$/.test(value)) {
        if (value[0] === '|' || value[0] === '>') blockIndent = indent
        structural++
      } else if (/^(?:true|false|null|~|-?\d+(?:\.\d+)?|"[^"]*"|'[^']*'|\[.*\]|\{.*\})$/.test(value)) {
        scalar++
      }
      continue
    }
    if (/^-(?:\s+\S|$)/.test(t)) {
      list++
      // Список, вложенный под «ключ:», — структура; список вровень с ключом бывает и в заметках.
      if (nested) structural++
      continue
    }
    other++
  }
  const total = kv + list + other
  return kv >= 2 && (kv + list) / total >= 0.8 && structural >= 1 && structural + scalar >= 2
}

function guessLanguage(text: string, lines: string[]): { id?: string; score: number } {
  const scores = new Map<string, number>()

  const js = scoreRules(text, JS_RULES)
  const ts = scoreRules(text, TS_RULES)
  const jsx = scoreRules(text, JSX_RULES)
  const jsId = jsx >= 4 ? (ts >= 2 ? 'tsx' : 'jsx') : ts >= 3 ? 'ts' : 'js'
  scores.set(jsId, js + ts + jsx)

  const c = scoreRules(text, C_RULES)
  const cpp = scoreRules(text, CPP_RULES)
  scores.set(cpp > 0 ? 'cpp' : 'c', c + cpp)

  for (const [id, rules] of Object.entries(RULES)) scores.set(id, scoreRules(text, rules))
  const sql = scores.get('sql') ?? 0
  if (sql > 0 && SQL_SELECT_FROM.test(text)) scores.set('sql', sql + 4)

  const shellLines = lines.filter(isShellCommandLine).length
  scores.set('bash', (scores.get('bash') ?? 0) + 3 * Math.min(3, shellLines))

  if (TOML_SECTION.test(text)) scores.set('toml', 3 + Math.min(4, text.match(TOML_KV)?.length ?? 0))

  let bestId: string | undefined
  let best = 0
  for (const [id, s] of scores) {
    if (s > best) {
      best = s
      bestId = id
    }
  }
  if (bestId === 'css' && SCSS_SIGNS.test(text)) bestId = 'scss'
  return { id: bestId, score: best }
}

const SHEBANG_LANG: Record<string, string> = {
  bash: 'bash', sh: 'bash', zsh: 'bash', ksh: 'bash', dash: 'bash', fish: 'bash',
  python: 'python', node: 'js', nodejs: 'js', deno: 'ts', bun: 'ts', 'ts-node': 'ts', tsx: 'ts',
  pwsh: 'powershell', powershell: 'powershell', ruby: 'ruby', php: 'php',
}

function languageFromShebang(line: string): string | undefined {
  const parts = line.slice(2).trim().split(/\s+/)
  let prog = parts[0]?.split('/').pop() ?? ''
  if (prog === 'env') prog = parts.slice(1).find((p) => !p.startsWith('-')) ?? ''
  prog = prog.replace(/[\d.]+$/, '')
  return Object.hasOwn(SHEBANG_LANG, prog) ? SHEBANG_LANG[prog] : undefined
}

interface CodeAnalysis {
  isCode: boolean
  language?: string
}

function analyzeCode(input: string): CodeAnalysis {
  const full = input.trim()
  if (!full) return { isCode: false }

  if (/^[[{]/.test(full) && /[\]}]$/.test(full)) {
    try {
      const v: unknown = JSON.parse(full)
      if (v && typeof v === 'object') return { isCode: true, language: 'json' }
    } catch {
      // не JSON — разбираем дальше
    }
  }

  const t = compactLines(full.length > MAX_ANALYZE ? full.slice(0, MAX_ANALYZE) : full)
  if (/^<!doctype\s+html\b|^<html[\s>]/i.test(t)) return { isCode: true, language: 'html' }
  if (/^<\?xml\b/i.test(t)) return { isCode: true, language: 'xml' }
  if (/^<\?php\b/i.test(t)) return { isCode: true, language: 'php' }
  if (/^#!\s*\/\S+/.test(t)) return { isCode: true, language: languageFromShebang(t.split('\n', 1)[0]) }

  const lines = t.split(/\r?\n/)
  if (looksLikeYaml(lines)) return { isCode: true, language: 'yaml' }

  let code = 0
  let prose = 0
  let other = 0
  for (const line of lines) {
    const kind = classifyLine(line)
    if (kind === 'code') code++
    else if (kind === 'prose') prose++
    else if (kind === 'other') other++
  }
  const total = code + prose + other
  const best = guessLanguage(t, lines)
  const language = best.score >= 2 ? best.id : undefined
  if (!total) return { isCode: false, language }

  const codeRatio = code / total
  const proseRatio = prose / total
  // Одна-две строки: без уверенно опознанного языка это скорее заметка («x = 5», «A -> B»).
  const isCode =
    total <= 2
      ? codeRatio >= 0.5 && best.score >= 2
      : (codeRatio >= 0.5 && proseRatio <= 0.35 && (best.score >= 2 || syntaxDensity(t) >= 0.04)) ||
        (codeRatio >= 0.3 && proseRatio <= 0.5 && best.score >= 6)
  return { isCode, language }
}

/** Язык фрагмента кода (для подсказки в UI, когда тип «Код» выбран вручную). */
export function detectLanguage(code: string): string | undefined {
  return analyzeCode(code).language
}

interface Fence {
  lang?: string
  body: string
}

/** Убирает хвостовые пробелы и табы (без регэкспа `[ \t]+$`, квадратичного на длинных сериях). */
function trimEndSpaces(s: string): string {
  let end = s.length
  while (end > 0 && (s[end - 1] === ' ' || s[end - 1] === '\t')) end--
  return s.slice(0, end)
}

/**
 * Весь ввод — один fenced-блок: первая строка ```lang, последняя — та же «ограда».
 * Без регэкспа на весь текст: ленивое тело `([\s\S]*?)\n?[ \t]*\1` проверяло закрытие на каждой
 * позиции и на мегабайте пробелов работало минутами — а сюда приходит вставка целиком.
 */
function parseFence(text: string): Fence | null {
  const inline = /^```([^`\n]+)```$/.exec(text)
  if (inline) return { body: inline[1].trim() }

  const nl = text.indexOf('\n')
  if (nl < 0) return null
  const open = /^(`{3,}|~{3,})([^\n]*)$/.exec(text.slice(0, nl))
  if (!open) return null
  const [, fence, info] = open
  const rest = trimEndSpaces(text.slice(nl + 1))
  if (!rest.endsWith(fence)) return null
  // Между телом и закрывающей «оградой»: необязательный перевод строки и отступ.
  let body = trimEndSpaces(rest.slice(0, rest.length - fence.length))
  if (body.endsWith('\n')) body = body.slice(0, -1)
  if (fence[0] === '`' && info.includes('`')) return null
  // внутри ещё одна такая же «ограда» — значит это несколько блоков с текстом между ними
  const inner = new RegExp(`^[ \\t]*\\${fence[0]}{${fence.length},}`, 'm')
  if (inner.test(body)) return null
  const lang = info.trim().split(/[\s{:,]/)[0]
  return { lang: lang || undefined, body }
}

/**
 * Определяет тип записи по вставленному/набранному тексту.
 * 'idea' автоматически не ставится — её выбирает пользователь.
 */
export function detectInput(raw: string): DetectResult {
  const text = raw.trim()
  if (!text) return { type: 'text' }

  if (isUrl(text)) return { type: 'link', url: normalizeUrl(text) }

  const fence = parseFence(text)
  if (fence) {
    const language = (fence.lang && normalizeLanguage(fence.lang)) || analyzeCode(fence.body).language
    return language
      ? { type: 'code', language, stripped: fence.body }
      : { type: 'code', stripped: fence.body }
  }

  const code = analyzeCode(text)
  if (code.isCode) return code.language ? { type: 'code', language: code.language } : { type: 'code' }
  return { type: 'text' }
}
