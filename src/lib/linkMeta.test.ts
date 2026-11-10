import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  tauri: false,
  invoke: vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(),
}))
vi.mock('@/lib/platform', () => ({
  isTauri: () => mocks.tauri,
  isMac: () => false,
  modKey: () => 'Ctrl',
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))

import {
  LINK_FETCH_TIMEOUT_MS,
  buildProxyUrl,
  decodeEntities,
  fetchLinkMeta,
  hostToUnicode,
  parseHtmlMeta,
  titleFromUrl,
} from './linkMeta'

const enc = new TextEncoder()

function htmlResponse(
  body: string | Uint8Array<ArrayBuffer>,
  contentType: string | null = 'text/html; charset=utf-8',
  status = 200,
): Response {
  return new Response(typeof body === 'string' ? enc.encode(body) : body, {
    status,
    headers: contentType ? { 'content-type': contentType } : {},
  })
}

/** Кодирует строку в windows-1251 (только ASCII и русский алфавит — для тестов достаточно). */
function cp1251(s: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out[i] =
      c < 0x80 ? c : c === 0x401 ? 0xa8 : c === 0x451 ? 0xb8 : c >= 0x410 && c <= 0x44f ? c - 0x410 + 0xc0 : 0x3f
  }
  return out
}

/** fetch, который висит, пока его не отменят через signal. */
function pendingUntilAbort(_input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
  })
}

describe('parseHtmlMeta', () => {
  const base = 'https://example.com/blog/post'

  it('Open Graph: произвольный порядок атрибутов, разные кавычки, относительная картинка', () => {
    const html = `<!doctype html><html><head>
      <meta charset="utf-8">
      <title>Запасной заголовок</title>
      <meta content="Статья про Tauri" property="og:title" />
      <meta property='og:description' content='Как собрать desktop-приложение'>
      <meta name="description" content="Обычное описание">
      <meta property="og:site_name" content="Example Blog">
      <meta content="/images/cover.png" property="og:image">
      <link rel="apple-touch-icon" href="/apple.png">
      <link sizes="32x32" href="/static/icon-32.png" rel="icon" type="image/png">
    </head><body>…</body></html>`
    expect(parseHtmlMeta(html, base)).toEqual({
      title: 'Статья про Tauri',
      description: 'Как собрать desktop-приложение',
      siteName: 'Example Blog',
      image: 'https://example.com/images/cover.png',
      favicon: 'https://example.com/static/icon-32.png',
    })
  })

  it('без OG: <title>, meta description и favicon.ico по умолчанию', () => {
    const html = '<html><head><title>  Просто   страница\n </title><meta name="Description" content="Описание"></head></html>'
    expect(parseHtmlMeta(html, 'https://site.ru/a/b?c=1')).toEqual({
      title: 'Просто страница',
      description: 'Описание',
      favicon: 'https://site.ru/favicon.ico',
    })
  })

  it('twitter:title и twitter:image как запасные', () => {
    const html = `<head>
      <meta name="twitter:title" content="Твит-заголовок">
      <meta name="twitter:description" content="Твит-описание">
      <meta name="twitter:image" content="https://cdn.example.com/t.jpg">
    </head>`
    expect(parseHtmlMeta(html, base)).toMatchObject({
      title: 'Твит-заголовок',
      description: 'Твит-описание',
      image: 'https://cdn.example.com/t.jpg',
    })
  })

  it('og:title важнее <title>, og:description важнее description', () => {
    const html = `<head><title>T</title><meta name="description" content="D">
      <meta property="og:title" content="OG T"><meta property="og:description" content="OG D"></head>`
    expect(parseHtmlMeta(html, base)).toMatchObject({ title: 'OG T', description: 'OG D' })
  })

  it('декодирует HTML-сущности и схлопывает пробелы', () => {
    const html = `<head><title>Tom &amp; Jerry &mdash; &laquo;серия&raquo; &#8470;&nbsp;5</title>
      <meta property="og:description" content="&quot;Цитата&quot; &#39;внутри&#39; &#x41;&#x42; &hellip;&#151;&unknown;"></head>`
    expect(parseHtmlMeta(html, base)).toMatchObject({
      title: 'Tom & Jerry — «серия» № 5',
      description: '"Цитата" \'внутри\' AB …—&unknown;',
    })
  })

  it('обрезает title до 300 и description до 500 символов', () => {
    const html = `<head><title>${'а'.repeat(400)}</title><meta name="description" content="${'б '.repeat(400)}"></head>`
    const meta = parseHtmlMeta(html, base)
    expect(meta.title!.length).toBeLessThanOrEqual(300)
    expect(meta.title!.endsWith('…')).toBe(true)
    expect(meta.description!.length).toBeLessThanOrEqual(500)
    expect(meta.description!.endsWith('…')).toBe(true)
  })

  it('игнорирует <title> и meta в скриптах и комментариях', () => {
    const html = `<head>
      <!-- <meta property="og:title" content="Закомментировано"> -->
      <script>document.write('<title>Из скрипта</title><meta property="og:title" content="JS">')</script>
      <title>Настоящий</title>
    </head>`
    expect(parseHtmlMeta(html, base).title).toBe('Настоящий')
  })

  it('атрибуты без кавычек, «>» внутри значения, верхний регистр тегов', () => {
    const html = `<HEAD><META NAME=description CONTENT=hello><TITLE>A &gt; B</TITLE>
      <META PROPERTY="og:site_name" CONTENT="x > y"></HEAD>`
    expect(parseHtmlMeta(html, base)).toMatchObject({ title: 'A > B', description: 'hello', siteName: 'x > y' })
  })

  it('учитывает <base href> и протокол-относительные адреса', () => {
    const html = `<head><base href="https://static.example.org/assets/">
      <meta property="og:image" content="img/cover.jpg">
      <link rel="shortcut icon" href="//cdn.example.net/fav.ico"></head>`
    expect(parseHtmlMeta(html, base)).toMatchObject({
      image: 'https://static.example.org/assets/img/cover.jpg',
      favicon: 'https://cdn.example.net/fav.ico',
    })
  })

  it('og:image с сущностями в адресе', () => {
    const html = '<head><meta property="og:image" content="/img?a=1&amp;b=2"></head>'
    expect(parseHtmlMeta(html, base).image).toBe('https://example.com/img?a=1&b=2')
  })

  it('favicon: icon важнее shortcut icon и apple-touch-icon; mask-icon не берётся', () => {
    const html = `<head><link rel="mask-icon" href="/mask.svg"><link rel="apple-touch-icon" href="/apple.png">
      <link rel="shortcut icon" href="/short.ico"><link rel="icon" href="/icon.svg"></head>`
    expect(parseHtmlMeta(html, base).favicon).toBe('https://example.com/icon.svg')
    const onlyApple = '<head><link rel="mask-icon" href="/mask.svg"><link rel="apple-touch-icon" href="/apple.png"></head>'
    expect(parseHtmlMeta(onlyApple, base).favicon).toBe('https://example.com/apple.png')
  })

  it('не берёт javascript:/data: адреса картинок', () => {
    const html = '<head><meta property="og:image" content="javascript:alert(1)"><title>x</title></head>'
    expect(parseHtmlMeta(html, base).image).toBeUndefined()
  })

  it('og-теги в <body> — запасной вариант, если в <head> ничего нет', () => {
    const html = '<html><head><meta charset="utf-8"></head><body><meta property="og:title" content="Из body"></body></html>'
    expect(parseHtmlMeta(html, base).title).toBe('Из body')
  })

  it('пустой или мусорный HTML', () => {
    expect(parseHtmlMeta('', base)).toEqual({ favicon: 'https://example.com/favicon.ico' })
    expect(parseHtmlMeta('{"json": true}', 'не адрес')).toEqual({})
  })

  it('битый тег не съедает следующий; <titlebar> — не <title>; </title > с пробелом', () => {
    const html = `<head><meta property="og:description" content="битый <meta name="description" content="Целый">
      <titlebar>нет</titlebar><title data-x="1">Заголовок</title ></head>`
    expect(parseHtmlMeta(html, base)).toMatchObject({ title: 'Заголовок', description: 'Целый' })
    expect(parseHtmlMeta('<head><title>Без конца<meta name="description" content="d"></head>', base)).toMatchObject({
      description: 'd',
    })
    expect(parseHtmlMeta('<head><title>Без конца</head>', base).title).toBeUndefined()
  })

  it('незакрытый <script> без «>» не прячет остаток документа', () => {
    expect(parseHtmlMeta('<head><title>T</title><script src="x"', base).title).toBe('T')
    expect(parseHtmlMeta('<head><script>var a = "<title>no</title>"</script><title>Да</title>', base).title).toBe('Да')
  })

  // регрессия: регэкспы <meta\b(...)*> и <title\b[^>]*>…</title> сканировали документ до конца
  // от каждого незакрытого тега — 512 КБ таких тегов блокировали UI на 5–30 секунд
  it.each(['<title>', '<title ', '<meta ', '<meta content="x', "<meta a='", '<link ', '<base ', '<script ', '<style ', '<!--', '<meta "<meta <meta '])(
    'линейно на 512 КБ повторов %j',
    (chunk) => {
      const html = chunk.repeat(Math.floor((512 * 1024) / chunk.length))
      const t = performance.now()
      parseHtmlMeta(html, base)
      expect(performance.now() - t).toBeLessThan(300)
    },
  )
})

describe('decodeEntities', () => {
  it('именованные, десятичные, шестнадцатеричные; неизвестные не трогает', () => {
    expect(decodeEntities('&lt;a&gt; &AMP; &#169; &#x1F600; &constructor; &#0; &#xD800;')).toBe('<a> & © 😀 &constructor; &#0; &#xD800;')
  })
  it('не декодирует дважды', () => {
    expect(decodeEntities('&amp;lt;')).toBe('&lt;')
  })
})

describe('titleFromUrl', () => {
  it.each([
    ['https://github.com/tauri-apps/tauri', 'github.com — tauri-apps/tauri'],
    ['https://github.com/tauri-apps/tauri/issues/123', 'github.com — tauri-apps/tauri #123'],
    ['https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/src/lib.rs', 'github.com — tauri-apps/tauri · lib.rs'],
    ['https://www.example.com/', 'example.com'],
    ['https://ru.wikipedia.org/wiki/%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0', 'ru.wikipedia.org — Москва'],
    ['https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API', 'developer.mozilla.org — Fetch API'],
    ['https://medium.com/@user/how-to-build-a-pwa-1a2b3c4d5e6f', 'medium.com — how to build a pwa'],
    ['https://habr.com/ru/articles/812345/', 'habr.com'],
    ['https://blog.example.com/2024/05/my-great-post.html', 'blog.example.com — my great post'],
    ['https://пример.рф/статья', 'пример.рф — статья'],
    ['https://xn--e1afmkfd.xn--p1ai/', 'пример.рф'],
    ['example.com/some_page', 'example.com — some page'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube.com'],
    ['https://www.google.com/search?q=tauri+2', 'google.com — tauri 2'],
    ['http://localhost:3000/dashboard', 'localhost:3000 — dashboard'],
    ['https://example.com/p/550e8400-e29b-41d4-a716-446655440000', 'example.com'],
    ['не ссылка', 'не ссылка'],
  ])('%s → %s', (url, expected) => {
    expect(titleFromUrl(url)).toBe(expected)
  })

  it('длинный хвост обрезается', () => {
    const t = titleFromUrl(`https://example.com/${'word-'.repeat(60)}end`)
    expect(t.startsWith('example.com — word word')).toBe(true)
    expect(t.length).toBeLessThanOrEqual('example.com — '.length + 80)
  })
})

describe('hostToUnicode / buildProxyUrl', () => {
  it('punycode → Unicode', () => {
    expect(hostToUnicode('xn--e1afmkfd.xn--p1ai')).toBe('пример.рф')
    expect(hostToUnicode('www.xn--80ak6aa92e.com')).toBe('www.аррӏе.com')
    expect(hostToUnicode('example.com')).toBe('example.com')
    expect(hostToUnicode('xn--!!!.com')).toBe('xn--!!!.com')
  })
  it('шаблон прокси', () => {
    const target = 'https://example.com/a?b=1&c=2'
    expect(buildProxyUrl('https://proxy.test/raw?url={url}', target)).toBe(
      `https://proxy.test/raw?url=${encodeURIComponent(target)}`,
    )
    expect(buildProxyUrl('https://corsproxy.test/?', target)).toBe(`https://corsproxy.test/?${encodeURIComponent(target)}`)
  })
})

describe('fetchLinkMeta', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    mocks.tauri = false
    mocks.invoke.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('успех: прямой fetch в режиме cors', async () => {
    fetchMock.mockResolvedValue(
      htmlResponse('<head><title>Заголовок</title><meta property="og:image" content="/c.png"></head>'),
    )
    const before = Date.now()
    const meta = await fetchLinkMeta('example.com/article')
    expect(meta).toEqual({
      title: 'Заголовок',
      image: 'https://example.com/c.png',
      favicon: 'https://example.com/favicon.ico',
      status: 'ok',
      fetchedAt: expect.any(Number),
    })
    expect(meta.fetchedAt).toBeGreaterThanOrEqual(before)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://example.com/article')
    expect(init?.mode).toBe('cors')
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('относительные адреса считаются от адреса после редиректа', async () => {
    const res = htmlResponse('<head><title>T</title><meta property="og:image" content="img.png"></head>')
    Object.defineProperty(res, 'url', { value: 'https://final.example.org/dir/page' })
    fetchMock.mockResolvedValue(res)
    const meta = await fetchLinkMeta('https://short.link/x')
    expect(meta.image).toBe('https://final.example.org/dir/img.png')
  })

  it('сетевой сбой без прокси → failed', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await fetchLinkMeta('https://example.com')).toEqual({ status: 'failed', fetchedAt: expect.any(Number) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fetch, бросающий синхронно, тоже не роняет', async () => {
    fetchMock.mockImplementation(() => {
      throw new Error('boom')
    })
    expect((await fetchLinkMeta('https://example.com')).status).toBe('failed')
  })

  it('прокси-фолбэк: {url} подставляется закодированным, база — исходный адрес', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        htmlResponse('<head><title>Через прокси</title><meta property="og:image" content="/img.png"></head>'),
      )
    const meta = await fetchLinkMeta('example.com/page?x=1', { proxyUrl: 'https://proxy.test/raw?url={url}' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe(
      `https://proxy.test/raw?url=${encodeURIComponent('https://example.com/page?x=1')}`,
    )
    expect(meta).toMatchObject({ status: 'ok', title: 'Через прокси', image: 'https://example.com/img.png' })
  })

  it('HTTP-ошибка → пробует прокси; оба неуспешны → failed', async () => {
    fetchMock.mockResolvedValue(htmlResponse('Not found', 'text/html', 404))
    const meta = await fetchLinkMeta('https://example.com/x', { proxyUrl: 'https://proxy.test/{url}' })
    expect(meta.status).toBe('failed')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('пустой прокси не используется', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await fetchLinkMeta('https://example.com', { proxyUrl: '   ' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('не-HTML ответ → failed', async () => {
    fetchMock.mockResolvedValue(htmlResponse(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png'))
    expect((await fetchLinkMeta('https://example.com/pic.png')).status).toBe('failed')
  })

  it('HTML без метаданных → failed (прокси не дергается)', async () => {
    fetchMock.mockResolvedValue(htmlResponse('<html><head></head><body>hi</body></html>'))
    const meta = await fetchLinkMeta('https://example.com', { proxyUrl: 'https://proxy.test/{url}' })
    expect(meta).toEqual({ status: 'failed', fetchedAt: expect.any(Number) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('некорректный адрес → failed без запросов', async () => {
    expect((await fetchLinkMeta('не ссылка вообще')).status).toBe('failed')
    expect((await fetchLinkMeta('ftp://files.example.com/a')).status).toBe('failed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('уже отменённый signal → failed без запросов', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    expect((await fetchLinkMeta('https://example.com', { signal: ctrl.signal })).status).toBe('failed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('отмена во время запроса → failed, прокси не пробуется', async () => {
    fetchMock.mockImplementation(pendingUntilAbort)
    const ctrl = new AbortController()
    const p = fetchLinkMeta('https://example.com', { signal: ctrl.signal, proxyUrl: 'https://proxy.test/{url}' })
    await Promise.resolve()
    ctrl.abort()
    expect(await p).toEqual({ status: 'failed', fetchedAt: expect.any(Number) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('таймаут 8 секунд', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(pendingUntilAbort)
    const p = fetchLinkMeta('https://slow.example.com')
    await vi.advanceTimersByTimeAsync(LINK_FETCH_TIMEOUT_MS - 100)
    let settled = false
    void p.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect((await p).status).toBe('failed')
  })

  it('windows-1251 по заголовку Content-Type', async () => {
    fetchMock.mockResolvedValue(
      htmlResponse(cp1251('<head><title>Привет, мир! Ёлка</title></head>'), 'text/html; charset=windows-1251'),
    )
    expect(await fetchLinkMeta('https://old.example.ru')).toMatchObject({ status: 'ok', title: 'Привет, мир! Ёлка' })
  })

  it('windows-1251 по <meta charset> и http-equiv', async () => {
    fetchMock.mockResolvedValueOnce(
      htmlResponse(cp1251('<head><meta charset="windows-1251"><title>Старый сайт</title></head>'), 'text/html'),
    )
    expect((await fetchLinkMeta('https://a.example.ru')).title).toBe('Старый сайт')

    fetchMock.mockResolvedValueOnce(
      htmlResponse(
        cp1251('<head><meta http-equiv="Content-Type" content="text/html; charset=cp1251"><title>Ещё старее</title></head>'),
        null,
      ),
    )
    expect((await fetchLinkMeta('https://b.example.ru')).title).toBe('Ещё старее')
  })

  it('UTF-8 по умолчанию', async () => {
    fetchMock.mockResolvedValue(htmlResponse('<head><title>Юникод ✓</title></head>', 'text/html'))
    expect((await fetchLinkMeta('https://example.com')).title).toBe('Юникод ✓')
  })

  it('читает не больше ~512 КБ и останавливается после </head>', async () => {
    const filler = enc.encode(`<!-- ${'x'.repeat(64 * 1024)} -->`)
    let pulled = 0
    const endless = (prefix: string) =>
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(prefix))
        },
        pull(c) {
          pulled += filler.byteLength
          c.enqueue(filler)
        },
      })

    // </head> так и не встретился: чтение обрывается на лимите
    fetchMock.mockResolvedValueOnce(new Response(endless('<html><head>'), { headers: { 'content-type': 'text/html' } }))
    expect((await fetchLinkMeta('https://huge.example.com')).status).toBe('failed')
    expect(pulled).toBeLessThan(1024 * 1024)

    // </head> в первом же куске: дальше не читаем
    pulled = 0
    fetchMock.mockResolvedValueOnce(
      new Response(endless('<html><head><title>Рано</title></head><body>'), { headers: { 'content-type': 'text/html' } }),
    )
    expect(await fetchLinkMeta('https://huge.example.com')).toMatchObject({ status: 'ok', title: 'Рано' })
    expect(pulled).toBeLessThanOrEqual(2 * filler.byteLength)
  })

  describe('в Tauri', () => {
    beforeEach(() => {
      mocks.tauri = true
    })

    it('использует команду fetch_link_meta и finalUrl как базу', async () => {
      mocks.invoke.mockResolvedValue({
        html: '<head><title>Из Rust</title><meta property="og:image" content="cover.jpg"></head>',
        finalUrl: 'https://final.example.com/dir/page',
      })
      const meta = await fetchLinkMeta('example.com/start')
      expect(mocks.invoke).toHaveBeenCalledWith('fetch_link_meta', { url: 'https://example.com/start' })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(meta).toMatchObject({ status: 'ok', title: 'Из Rust', image: 'https://final.example.com/dir/cover.jpg' })
    })

    it('ошибка команды → прямой fetch', async () => {
      mocks.invoke.mockRejectedValue(new Error('network'))
      fetchMock.mockResolvedValue(htmlResponse('<head><title>Из веба</title></head>'))
      expect(await fetchLinkMeta('https://example.com')).toMatchObject({ status: 'ok', title: 'Из веба' })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('отмена во время invoke → failed', async () => {
      mocks.invoke.mockImplementation(() => new Promise(() => {}))
      const ctrl = new AbortController()
      const p = fetchLinkMeta('https://example.com', { signal: ctrl.signal })
      await Promise.resolve()
      ctrl.abort()
      expect((await p).status).toBe('failed')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
