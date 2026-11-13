import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  VISION_TIMEOUT_MS,
  VisionError,
  aiBaseUrlError,
  aiHostLabel,
  cleanVisionAnswer,
  recognizeImage,
  suggestForItem,
  visionAvailability,
  visionModelOf,
} from './ai'
import { VISION_MAX_IMAGE_BYTES } from './ocrState'
import { DEFAULT_SETTINGS } from '@/types'
import type { Item, Settings } from '@/types'

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  aiEnabled: true,
  aiApiKey: 'k',
  aiBaseUrl: 'https://x.test/v1/',
}
const item: Item = {
  id: '1', type: 'text', title: '', content: 'Заметка про React', categoryId: null,
  tags: [], links: [], status: 'inbox', favorite: 0, source: 'manual', createdAt: 1, updatedAt: 1,
}

const reply = (content: string, status = 200) =>
  vi.fn().mockResolvedValue(
    new Response(
      status === 200 ? JSON.stringify({ choices: [{ message: { content } }] }) : content,
      { status },
    ),
  )

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('suggestForItem', () => {
  it('успех и нормализация тегов', async () => {
    const f = reply(
      JSON.stringify({
        title: 'Заг', summary: 'Опис',
        tags: ['#React', ' react ', 'Web Dev', 'a', 'b', 'c', 'd', 'e', 'f'],
      }),
    )
    vi.stubGlobal('fetch', f)
    const r = await suggestForItem(item, settings)
    expect(r.suggestedTitle).toBe('Заг')
    expect(r.suggestedTags).toEqual(['react', 'web-dev', 'a', 'b', 'c', 'd', 'e', 'f'])
    expect(r.model).toBe('deepseek-chat')
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://x.test/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer k')
  })
  it('json в обёртке из тройных кавычек', async () => {
    vi.stubGlobal('fetch', reply('```json\n{"title":"T","summary":"S","tags":["x"]}\n```'))
    const r = await suggestForItem(item, settings)
    expect(r.summary).toBe('S')
    expect(r.suggestedTags).toEqual(['x'])
  })
  it.each(['null', '[]', '"строка"', '42', 'вообще не json', '[1, 2]'])(
    'ответ модели %s — понятная ошибка, а не TypeError',
    async (content) => {
      vi.stubGlobal('fetch', reply(content))
      await expect(suggestForItem(item, settings)).rejects.toThrow('Не удалось разобрать ответ ИИ')
    },
  )
  it('объект внутри текста всё ещё достаётся', async () => {
    vi.stubGlobal('fetch', reply('Вот ответ: {"title":"T","tags":["a"]} — готово'))
    expect((await suggestForItem(item, settings)).suggestedTitle).toBe('T')
  })
  it('тело ответа сервиса null или не JSON — «пустой ответ»', async () => {
    for (const body of ['null', 'oops']) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })))
      await expect(suggestForItem(item, settings)).rejects.toThrow('ИИ вернул пустой ответ')
    }
  })
  it('401', async () => {
    vi.stubGlobal('fetch', reply('no', 401))
    await expect(suggestForItem(item, settings)).rejects.toThrow(/ключ/)
  })
  it('открытый http вне localhost — ошибка до запроса', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    for (const aiBaseUrl of ['http://api.example.com/v1', 'http://localhost:80@evil.example/v1', 'ftp://x.test', 'мусор']) {
      await expect(suggestForItem(item, { ...settings, aiBaseUrl })).rejects.toThrow(/https:\/\//)
    }
    expect(f).not.toHaveBeenCalled()
  })
  it('http разрешён только для локальной модели', async () => {
    for (const ok of ['https://x.test/v1', ' https://x.test ', 'http://localhost:11434/v1', 'http://127.0.0.1/v1', 'http://[::1]:8080']) {
      expect(aiBaseUrlError(ok), ok).toBeNull()
    }
    for (const bad of ['http://localhost.evil.example', 'http://192.168.1.5/v1', '', 'localhost:11434']) {
      expect(aiBaseUrlError(bad), bad).not.toBeNull()
    }
  })
  it('не настроено', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await expect(suggestForItem(item, { ...settings, aiEnabled: false })).rejects.toThrow(
      'AI-помощник не настроен',
    )
    await expect(suggestForItem(item, { ...settings, aiApiKey: '' })).rejects.toThrow(
      'AI-помощник не настроен',
    )
    expect(f).not.toHaveBeenCalled()
  })
})

// ───────────────────────── распознавание ─────────────────────────

const visionSettings: Settings = { ...settings, aiApiKey: 'sk-secret-key', aiVisionModel: 'gpt-4o-mini' }
const jpeg = (bytes = [0xff, 0xd8, 0xff, 0xe0]) => new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' })

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const answer = (content: unknown, finish_reason: string = 'stop') =>
  ok({ choices: [{ message: { content }, finish_reason }] })

type FetchInit = { body: string; signal: AbortSignal; headers: Record<string, string> }
const bodyOf = (f: ReturnType<typeof vi.fn>, call = 0) =>
  JSON.parse((f.mock.calls[call][1] as FetchInit).body) as Record<string, unknown>

/** fetch, который не отвечает, пока его не прервут. */
const hangingFetch = () =>
  vi.fn(
    (_url: string, init: FetchInit) =>
      new Promise<Response>((_resolve, reject) => {
        if (init.signal.aborted) reject(init.signal.reason)
        init.signal.addEventListener('abort', () => reject(init.signal.reason))
      }),
  )

async function untilCalled(f: ReturnType<typeof vi.fn>): Promise<void> {
  for (let i = 0; i < 200 && f.mock.calls.length === 0; i++) await new Promise((r) => setImmediate(r))
  expect(f).toHaveBeenCalled()
}

async function visionError(promise: Promise<unknown>): Promise<VisionError> {
  try {
    await promise
  } catch (e) {
    expect(e).toBeInstanceOf(VisionError)
    return e as VisionError
  }
  throw new Error('ошибки не было')
}

describe('visionModelOf и visionAvailability', () => {
  it('модель: aiVisionModel, пусто — aiModel', () => {
    expect(visionModelOf({ aiVisionModel: ' gpt-4o ', aiModel: 'deepseek-chat' })).toBe('gpt-4o')
    expect(visionModelOf({ aiVisionModel: '  ', aiModel: ' deepseek-chat ' })).toBe('deepseek-chat')
    expect(visionModelOf({ aiVisionModel: '', aiModel: '' })).toBe('')
  })
  it('причины по порядку', () => {
    expect(visionAvailability(visionSettings)).toBeNull()
    expect(visionAvailability({ ...visionSettings, aiEnabled: false })).toBe('Включите ИИ-помощника в настройках')
    expect(visionAvailability({ ...visionSettings, aiApiKey: ' ' })).toBe(
      'Укажите API-ключ в «Настройки → ИИ-помощник»',
    )
    expect(visionAvailability({ ...visionSettings, aiBaseUrl: 'http://api.example.com' })).toMatch(/https:\/\//)
    expect(visionAvailability({ ...visionSettings, aiVisionModel: '', aiModel: ' ' })).toBe(
      'Укажите модель в «Настройки → ИИ-помощник»',
    )
  })
})

describe('aiHostLabel', () => {
  it('хост с портом, без пути и учётных данных', () => {
    expect(aiHostLabel('https://api.openai.com/v1')).toBe('api.openai.com')
    expect(aiHostLabel(' http://localhost:11434/v1/ ')).toBe('localhost:11434')
    expect(aiHostLabel('https://user:pass@x.test:8443/v1')).toBe('x.test:8443')
    expect(aiHostLabel('http://[::1]:8080')).toBe('[::1]:8080')
  })
  it('негодный адрес — исходная строка до 60 символов', () => {
    expect(aiHostLabel('мусор')).toBe('мусор')
    expect(aiHostLabel('x'.repeat(100))).toBe('x'.repeat(60))
  })
})

describe('cleanVisionAnswer', () => {
  it('trim и ограда', () => {
    expect(cleanVisionAnswer('  строка 1\nстрока 2  ')).toBe('строка 1\nстрока 2')
    expect(cleanVisionAnswer('```\nТекст\n  с отступом\n```')).toBe('Текст\n  с отступом')
    expect(cleanVisionAnswer('```text\nИтого | 100\n```')).toBe('Итого | 100')
    // ограда внутри текста не снимается
    expect(cleanVisionAnswer('до\n```\nкод\n```\nпосле')).toBe('до\n```\nкод\n```\nпосле')
  })
  it.each(['NO_TEXT', 'no_text', ' "NO_TEXT". ', '«NO_TEXT»', '`NO_TEXT`', '```\nNO_TEXT\n```', 'NO TEXT', '**NO_TEXT**'])(
    '%j → пусто',
    (raw) => {
      expect(cleanVisionAnswer(raw)).toBe('')
    },
  )
  it('NO_TEXT внутри текста — это текст', () => {
    expect(cleanVisionAnswer('На табличке: NO_TEXT HERE')).toBe('На табличке: NO_TEXT HERE')
  })
  it('два блока в оградах с текстом между ними — разметка не теряется', () => {
    const two = '```\nблок 1\n```\nмежду\n```\nблок 2\n```'
    expect(cleanVisionAnswer(two)).toBe(two)
  })
  it('рассуждения <think>…</think> убираются', () => {
    expect(cleanVisionAnswer('<think>Вижу счёт.\nПеречислю.</think>\n\nСчёт № 5')).toBe('Счёт № 5')
    expect(cleanVisionAnswer('<think>пусто</think>NO_TEXT')).toBe('')
  })
})

describe('recognizeImage: запрос', () => {
  it('тело: модель зрения, data:image/jpeg;base64, temperature 0, без лишних полей', async () => {
    const f = vi.fn().mockResolvedValue(answer('Привет'))
    vi.stubGlobal('fetch', f)
    const r = await recognizeImage(jpeg([1, 2, 3]), visionSettings)
    expect(r).toEqual({ text: 'Привет', truncated: false, model: 'gpt-4o-mini' })
    const [url, init] = f.mock.calls[0] as [string, FetchInit]
    expect(url).toBe('https://x.test/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer sk-secret-key')
    expect(init.headers['Content-Type']).toBe('application/json')
    const body = bodyOf(f)
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.temperature).toBe(0)
    expect(body).not.toHaveProperty('response_format')
    expect(body).not.toHaveProperty('max_tokens')
    const messages = body.messages as Array<{ role: string; content: unknown }>
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toMatch(/NO_TEXT/)
    expect(messages[1].role).toBe('user')
    const parts = messages[1].content as Array<Record<string, unknown>>
    expect(parts[0]).toEqual({ type: 'text', text: 'Распознай текст на изображении.' })
    expect(parts[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AQID' } })
    expect(JSON.stringify(parts[1])).not.toContain('detail')
  })

  it('пустая aiVisionModel — основная модель; PNG проходит', async () => {
    const f = vi.fn().mockResolvedValue(answer('x'))
    vi.stubGlobal('fetch', f)
    const png = new Blob([new Uint8Array([137, 80])], { type: 'image/png' })
    const r = await recognizeImage(png, { ...visionSettings, aiVisionModel: '' })
    expect(r.model).toBe('deepseek-chat')
    expect(bodyOf(f).model).toBe('deepseek-chat')
    expect(JSON.stringify(bodyOf(f))).toContain('data:image/png;base64,')
  })

  it('ни одного fetch при выключенном ИИ, пустом ключе, http не-localhost, пустой модели', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const bad: Settings[] = [
      { ...visionSettings, aiEnabled: false },
      { ...visionSettings, aiApiKey: '' },
      { ...visionSettings, aiBaseUrl: 'http://api.example.com/v1' },
      { ...visionSettings, aiVisionModel: '', aiModel: '' },
    ]
    for (const s of bad) {
      const e = await visionError(recognizeImage(jpeg(), s))
      expect(e.kind).toBe('config')
    }
    expect(f).not.toHaveBeenCalled()
  })

  it('ИИ выключен — изображение даже не читается', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const image = jpeg()
    const read = vi.spyOn(image, 'arrayBuffer')
    const stream = vi.spyOn(image, 'stream')
    await visionError(recognizeImage(image, { ...visionSettings, aiEnabled: false }))
    expect(read).not.toHaveBeenCalled()
    expect(stream).not.toHaveBeenCalled()
  })

  it('не JPEG/PNG и слишком большое — item, без сети', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const webp = await visionError(recognizeImage(new Blob(['x'], { type: 'image/webp' }), visionSettings))
    expect(webp.kind).toBe('item')
    expect(webp.message).toBe('Изображение не подготовлено к отправке')
    const big = new Blob([new Uint8Array(VISION_MAX_IMAGE_BYTES + 1)], { type: 'image/jpeg' })
    const large = await visionError(recognizeImage(big, visionSettings))
    expect(large.kind).toBe('item')
    expect(large.message).toBe('Изображение слишком большое для распознавания')
    expect(f).not.toHaveBeenCalled()
  })
})

describe('recognizeImage: ответ', () => {
  it('content массивом частей склеивается', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        answer([
          { type: 'text', text: 'Строка 1\n' },
          { type: 'reasoning', text: 'не берётся' },
          { type: 'text', text: 'Строка 2' },
        ]),
      ),
    )
    expect((await recognizeImage(jpeg(), visionSettings)).text).toBe('Строка 1\nСтрока 2')
  })

  it('NO_TEXT и пустой ответ — пустой текст, не ошибка', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer('```\nNO_TEXT\n```')))
    expect((await recognizeImage(jpeg(), visionSettings)).text).toBe('')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(null)))
    expect((await recognizeImage(jpeg(), visionSettings)).text).toBe('')
  })

  it('finish_reason length — truncated; content_filter — item', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer('начало', 'length')))
    expect(await recognizeImage(jpeg(), visionSettings)).toMatchObject({ text: 'начало', truncated: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer('', 'content_filter')))
    const e = await visionError(recognizeImage(jpeg(), visionSettings))
    expect(e.kind).toBe('item')
    expect(e.message).toBe('Сервис ИИ отказался обрабатывать изображение')
  })

  it.each([
    ['не JSON', new Response('<html>', { status: 200 })],
    ['нет choices', ok({ id: 'x' })],
    ['choices пуст', ok({ choices: [] })],
    ['JSON null', new Response('null', { status: 200 })],
  ])('200, но %s — transient «непонятный ответ»', async (_name, res) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res))
    const e = await visionError(recognizeImage(jpeg(), visionSettings))
    expect(e.kind).toBe('transient')
    expect(e.message).toBe('ИИ вернул непонятный ответ')
  })
})

describe('recognizeImage: ошибки HTTP', () => {
  const cases: Array<[number, string, VisionError['kind'], string | RegExp]> = [
    [401, 'unauthorized', 'config', 'Неверный API-ключ (401)'],
    [403, 'forbidden', 'config', 'Неверный API-ключ (401)'],
    [404, 'not found', 'config', 'Модель «gpt-4o-mini» или адрес API не найдены (404)'],
    [400, 'Image input is not supported', 'config', /^Модель «gpt-4o-mini» не принимает изображения\./],
    [400, '{"error":"this model does not support vision"}', 'config', /не принимает изображения/],
    [415, 'multimodal input unsupported', 'config', /не принимает изображения/],
    [422, 'unknown variant `image_url`, expected `text`', 'config', /не принимает изображения/],
    [400, 'messages[1].content: expected string, got array', 'config', /не принимает изображения/],
    [413, 'payload too large', 'item', 'Изображение слишком большое для сервиса ИИ (413)'],
    [429, 'rate limit', 'transient', 'Превышен лимит запросов к ИИ (429), попробуйте позже'],
    [500, 'oops', 'transient', 'Сервис ИИ временно недоступен (500)'],
    [503, 'busy', 'transient', 'Сервис ИИ временно недоступен (503)'],
    [400, 'bad request: missing field', 'config', 'Ошибка ИИ-сервиса 400: bad request: missing field'],
    [409, 'conflict', 'config', 'Ошибка ИИ-сервиса 409: conflict'],
    // ошибка самого изображения — не настройка (в таких ответах почти всегда есть «image»)
    [400, 'image too large, max 4MB', 'item', 'Сервис ИИ не смог обработать это изображение (400)'],
    [400, 'Invalid image data', 'item', /не смог обработать это изображение/],
    [400, '{"error":{"code":"image_parse_error"}}', 'item', /не смог обработать это изображение/],
    [400, 'Could not process image', 'item', /не смог обработать это изображение/],
    [422, 'image exceeds 5 MB maximum', 'item', /не смог обработать это изображение/],
    [400, 'Invalid content type. image_url is only supported by certain models.', 'config', /не принимает изображения/],
    [408, 'timeout', 'transient', 'ИИ не ответил вовремя (408)'],
  ]
  it.each(cases)('%i %s → %s', async (status, body, kind, text) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status })))
    const e = await visionError(recognizeImage(jpeg(), visionSettings))
    expect(e.kind).toBe(kind)
    expect(e.status).toBe(status)
    if (typeof text === 'string') expect(e.message).toBe(text)
    else expect(e.message).toMatch(text)
  })

  it('непонятный 400/422 помечен unknown (авто остановится только после серии); 402 и опознанные — нет', async () => {
    for (const [status, body, unknown] of [
      [400, 'bad request: missing field', true],
      [422, 'unprocessable', true],
      [402, 'payment required', undefined],
      [401, 'unauthorized', undefined],
      [400, 'Image input is not supported', undefined],
    ] as const) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status })))
      const e = await visionError(recognizeImage(jpeg(), visionSettings))
      expect(e.unknown).toBe(unknown)
    }
  })

  it('перенаправления запрещены: ключ и изображение не уходят на чужой адрес', async () => {
    const f = vi.fn().mockResolvedValue(answer('Текст'))
    vi.stubGlobal('fetch', f)
    await recognizeImage(jpeg(), visionSettings)
    expect((f.mock.calls[0][1] as RequestInit).redirect).toBe('error')
    const g = vi.fn().mockResolvedValue(answer(JSON.stringify({ title: 'T', summary: '', tags: [] })))
    vi.stubGlobal('fetch', g)
    await suggestForItem(item, settings)
    expect((g.mock.calls[0][1] as RequestInit).redirect).toBe('error')
  })

  it('отказ модели (refusal при пустом content) — item, а не «текста нет»', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        ok({ choices: [{ message: { content: null, refusal: "I'm sorry, I can't help with that." }, finish_reason: 'stop' }] }),
      ),
    )
    const e = await visionError(recognizeImage(jpeg(), visionSettings))
    expect(e.kind).toBe('item')
    expect(e.message).toBe('Модель отказалась распознавать изображение')
  })

  it('тело в тексте ошибки — не длиннее 200 символов', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('я'.repeat(1000), { status: 418 })))
    const e = await visionError(recognizeImage(jpeg(), visionSettings))
    expect(e.message).toBe(`Ошибка ИИ-сервиса 418: ${'я'.repeat(200)}`)
  })

  it('ключ, повторённый сервисом в теле, в текст ошибки не попадает', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('invalid request for key sk-secret-key', { status: 400 })),
    )
    const e = await visionError(recognizeImage(jpeg(), visionSettings))
    expect(e.message).not.toContain('sk-secret-key')
    expect(e.message).toContain('***')
  })

  it('fetch бросил — transient «нет связи»', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const e = await visionError(recognizeImage(jpeg(), visionSettings))
    expect(e.kind).toBe('transient')
    expect(e.message).toBe('Нет связи с сервисом ИИ: проверьте адрес API и подключение к сети')
  })
})

describe('recognizeImage: повтор без temperature', () => {
  it('400 про temperature — ровно один повтор без неё', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response('Unsupported value: temperature', { status: 400 }))
      .mockResolvedValueOnce(answer('Текст'))
    vi.stubGlobal('fetch', f)
    expect((await recognizeImage(jpeg(), visionSettings)).text).toBe('Текст')
    expect(f).toHaveBeenCalledTimes(2)
    expect(bodyOf(f, 0).temperature).toBe(0)
    expect(bodyOf(f, 1)).not.toHaveProperty('temperature')
    expect(bodyOf(f, 1).model).toBe('gpt-4o-mini')
  })

  it('повтор тоже 400 про temperature — ошибка, третьего запроса нет', async () => {
    const f = vi.fn().mockImplementation(async () => new Response('temperature is not supported', { status: 400 }))
    vi.stubGlobal('fetch', f)
    const e = await visionError(recognizeImage(jpeg(), visionSettings))
    expect(e.kind).toBe('config')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('400 не про temperature — без повтора', async () => {
    const f = vi.fn().mockResolvedValue(new Response('image not supported', { status: 400 }))
    vi.stubGlobal('fetch', f)
    await visionError(recognizeImage(jpeg(), visionSettings))
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('recognizeImage: время и прерывание', () => {
  it('нет ответа 2 минуты — transient', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const f = hangingFetch()
    vi.stubGlobal('fetch', f)
    const pending = recognizeImage(jpeg(), visionSettings)
    const caught = visionError(pending)
    await untilCalled(f)
    await vi.advanceTimersByTimeAsync(VISION_TIMEOUT_MS - 1)
    expect(f).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    const e = await caught
    expect(e.kind).toBe('transient')
    expect(e.message).toBe('ИИ не ответил за 2 минуты')
  })

  it('прерывание вызывающим — исходный AbortError наружу', async () => {
    const f = hangingFetch()
    vi.stubGlobal('fetch', f)
    const ctrl = new AbortController()
    const pending = recognizeImage(jpeg(), visionSettings, ctrl.signal)
    await untilCalled(f)
    ctrl.abort()
    const e = await pending.then(
      () => null,
      (err: unknown) => err,
    )
    expect(e).not.toBeInstanceOf(VisionError)
    expect((e as Error).name).toBe('AbortError')
    expect(e).toBe(ctrl.signal.reason)
  })

  it('уже прерванный сигнал — без сети', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const ctrl = new AbortController()
    ctrl.abort()
    await expect(recognizeImage(jpeg(), visionSettings, ctrl.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(f).not.toHaveBeenCalled()
  })
})
