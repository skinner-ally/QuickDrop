import { afterEach, describe, expect, it, vi } from 'vitest'
import { suggestForItem } from './ai'
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

afterEach(() => vi.unstubAllGlobals())

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
