import { describe, expect, it, vi } from 'vitest'
import { DESKTOP_ONLY_MESSAGE } from './desktop'
import type { SavedFile } from './desktop'
import { exportDocsToDir, exportMarkdownToDir } from './exportDir'
import type { ExportDoc } from './exportDir'
import { setSetting } from '@/db/settings'
import type { Item } from '@/types'

const DIR = 'D:\\Заметки\\Экспорт'

async function sizeOf(data: Blob | string): Promise<number> {
  return typeof data === 'string' ? new Blob([data]).size : data.size
}

/** Подставная запись: помнит порядок и содержимое, fail(path) — текст ошибки для файла. */
function recorder(fail?: (path: string) => unknown) {
  const written: Array<{ dir: string; path: string; data: Blob | string }> = []
  const write = vi.fn(async (dir: string, path: string, data: Blob | string): Promise<SavedFile> => {
    const failure = fail?.(path)
    if (failure !== undefined) throw failure
    written.push({ dir, path, data })
    return { path: `${dir}\\${path}`, size: await sizeOf(data), done: true }
  })
  return { write, written, paths: () => written.map((w) => w.path) }
}

const noFiles = async (): Promise<Blob | undefined> => undefined

const item = (id: string): Item => ({ id, title: `Запись ${id}` }) as unknown as Item

const docs: ExportDoc[] = [
  {
    path: 'Первая.md',
    markdown: '# Первая\n\n![[attachments/фото.png]]',
    attachments: [
      { path: 'attachments/фото.png', blob: new Blob([new Uint8Array(10)]) },
      { path: 'attachments/doc.pdf', fileId: 'f-pdf' },
    ],
  },
  { path: 'Вторая.md', markdown: 'текст' },
  { path: 'папка/Третья.md', markdown: '', attachments: [] },
]

describe('exportDocsToDir', () => {
  it('пишет вложения, затем документ; считает файлы и байты', async () => {
    const { write, written, paths } = recorder()
    const loadFile = vi.fn(async (fileId: string) => (fileId === 'f-pdf' ? new Blob([new Uint8Array(7)]) : undefined))
    const progress: Array<[number, number]> = []
    const report = await exportDocsToDir(DIR, docs, {
      write,
      loadFile,
      onProgress: (done, total) => progress.push([done, total]),
    })

    expect(paths()).toEqual([
      'attachments/фото.png',
      'attachments/doc.pdf',
      'Первая.md',
      'Вторая.md',
      'папка/Третья.md',
    ])
    expect(written.every((w) => w.dir === DIR)).toBe(true)
    expect(written[2].data).toBe(docs[0].markdown)
    expect(written[0].data).toBe(docs[0].attachments?.[0].blob)
    expect((written[1].data as Blob).size).toBe(7)
    expect(loadFile).toHaveBeenCalledExactlyOnceWith('f-pdf')
    expect(report).toEqual({
      dir: DIR,
      docs: 3,
      attachments: 2,
      bytes: 10 + 7 + new Blob([docs[0].markdown]).size + new Blob(['текст']).size,
      failed: [],
    })
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
  })

  it('передаёт signal в запись и обрезает пробелы в пути папки', async () => {
    const { write } = recorder()
    const controller = new AbortController()
    const report = await exportDocsToDir(`  ${DIR}  `, [docs[1]], { write, signal: controller.signal })
    expect(write).toHaveBeenCalledExactlyOnceWith(DIR, 'Вторая.md', 'текст', controller.signal)
    expect(report.dir).toBe(DIR)
  })

  it('отсутствующий файл вложения — в failed, документ всё равно записан', async () => {
    const { write, paths } = recorder()
    const report = await exportDocsToDir(
      DIR,
      [
        {
          path: 'a.md',
          markdown: 'a',
          attachments: [
            { path: 'attachments/нет.bin', fileId: 'missing' },
            { path: 'attachments/пусто.bin' },
          ],
        },
      ],
      { write, loadFile: noFiles },
    )
    expect(paths()).toEqual(['a.md'])
    expect(report.docs).toBe(1)
    expect(report.attachments).toBe(0)
    expect(report.failed).toEqual([
      { path: 'attachments/нет.bin', error: 'Файл вложения не найден' },
      { path: 'attachments/пусто.bin', error: 'Файл вложения не найден' },
    ])
  })

  it('сбой чтения вложения — в failed', async () => {
    const { write } = recorder()
    const report = await exportDocsToDir(
      DIR,
      [{ path: 'a.md', markdown: 'a', attachments: [{ path: 'attachments/x.bin', fileId: 'x' }] }],
      {
        write,
        loadFile: async () => {
          throw new Error('База недоступна')
        },
      },
    )
    expect(report.failed).toEqual([{ path: 'attachments/x.bin', error: 'База недоступна' }])
    expect(report.docs).toBe(1)
  })

  it('сбой одного файла не прерывает выгрузку', async () => {
    const { write, paths } = recorder((path) => {
      if (path === 'attachments/фото.png') return new Error('Не удалось записать файл: нет доступа')
      if (path === 'Вторая.md') return 'строка вместо Error'
      return undefined
    })
    const report = await exportDocsToDir(DIR, docs, { write, loadFile: async () => new Blob(['pdf']) })
    expect(paths()).toEqual(['attachments/doc.pdf', 'Первая.md', 'папка/Третья.md'])
    expect(report.docs).toBe(2)
    expect(report.attachments).toBe(1)
    expect(report.failed).toEqual([
      { path: 'attachments/фото.png', error: 'Не удалось записать файл: нет доступа' },
      { path: 'Вторая.md', error: 'Не удалось записать файл' },
    ])
    expect(report.bytes).toBe(3 + new Blob([docs[0].markdown]).size)
  })

  it.each([
    'Папка не найдена: D:\\Заметки\\Экспорт. Проверьте, что диск подключён',
    'Папка не подтверждена: выберите её заново в настройках',
    'Папка не выбрана',
    DESKTOP_ONLY_MESSAGE,
  ])('«%s» прерывает выгрузку', async (message) => {
    const { write } = recorder((path) => (path === 'attachments/doc.pdf' ? new Error(message) : undefined))
    const onProgress = vi.fn()
    await expect(
      exportDocsToDir(DIR, docs, { write, loadFile: async () => new Blob(['pdf']), onProgress }),
    ).rejects.toThrow(message)
    expect(write).toHaveBeenCalledTimes(2)
    expect(onProgress).not.toHaveBeenCalled()
  })

  it('отмена до начала — «Экспорт отменён», ничего не записано', async () => {
    const { write } = recorder()
    const loadFile = vi.fn(noFiles)
    const controller = new AbortController()
    controller.abort()
    await expect(exportDocsToDir(DIR, docs, { write, loadFile, signal: controller.signal })).rejects.toThrow(
      'Экспорт отменён',
    )
    expect(write).not.toHaveBeenCalled()
    expect(loadFile).not.toHaveBeenCalled()
  })

  it('отмена посреди выгрузки останавливает её перед следующим файлом', async () => {
    const controller = new AbortController()
    const { write, paths } = recorder((path) => {
      if (path === 'Первая.md') controller.abort()
      return undefined
    })
    await expect(
      exportDocsToDir(DIR, docs, { write, loadFile: async () => new Blob(['pdf']), signal: controller.signal }),
    ).rejects.toThrow('Экспорт отменён')
    expect(paths()).toEqual(['attachments/фото.png', 'attachments/doc.pdf', 'Первая.md'])
  })

  it('отмена во время записи файла — отмена, а не ошибка файла', async () => {
    const controller = new AbortController()
    const { write } = recorder((path) => {
      if (path !== 'Вторая.md') return undefined
      controller.abort()
      return new Error('Отменено')
    })
    await expect(exportDocsToDir(DIR, [docs[1], docs[2]], { write, signal: controller.signal })).rejects.toThrow(
      'Экспорт отменён',
    )
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('пустая папка — ошибка, запись не начинается', async () => {
    const { write } = recorder()
    for (const dir of ['', '   ']) {
      await expect(exportDocsToDir(dir, docs, { write })).rejects.toThrow('Не выбрана папка для экспорта Markdown')
    }
    expect(write).not.toHaveBeenCalled()
  })

  it('без подмены записи вне Tauri — «Доступно только в настольной версии»', async () => {
    await expect(exportDocsToDir(DIR, docs, { loadFile: noFiles })).rejects.toThrow(DESKTOP_ONLY_MESSAGE)
    await expect(exportDocsToDir('', docs)).rejects.toThrow('Не выбрана папка для экспорта Markdown')
  })

  it('пустой список документов — пустой отчёт', async () => {
    const { write } = recorder()
    expect(await exportDocsToDir(DIR, [], { write })).toEqual({
      dir: DIR,
      docs: 0,
      attachments: 0,
      bytes: 0,
      failed: [],
    })
  })
})

describe('exportMarkdownToDir', () => {
  const items = [item('a'), item('b'), item('c')]

  it('вызывает toDoc по одному на запись и пишет в указанную папку', async () => {
    const { write, paths } = recorder()
    const events: string[] = []
    const report = await exportMarkdownToDir(
      items,
      async (it) => {
        events.push(`doc:${it.id}`)
        return { path: `${it.id}.md`, markdown: it.id }
      },
      {
        dir: DIR,
        write: async (dir, path, data) => {
          events.push(`write:${path}`)
          return write(dir, path, data)
        },
      },
    )
    expect(events).toEqual(['doc:a', 'write:a.md', 'doc:b', 'write:b.md', 'doc:c', 'write:c.md'])
    expect(paths()).toEqual(['a.md', 'b.md', 'c.md'])
    expect(report).toMatchObject({ dir: DIR, docs: 3, attachments: 0, failed: [] })
  })

  it('исключение toDoc — в failed с id записи, выгрузка продолжается', async () => {
    const { write, paths } = recorder()
    const progress: Array<[number, number]> = []
    const report = await exportMarkdownToDir(
      items,
      (it) => {
        if (it.id === 'b') throw new Error('Не удалось собрать документ')
        return { path: `${it.id}.md`, markdown: it.id }
      },
      { dir: DIR, write, onProgress: (done, total) => progress.push([done, total]) },
    )
    expect(paths()).toEqual(['a.md', 'c.md'])
    expect(report.docs).toBe(2)
    expect(report.failed).toEqual([{ path: 'b', error: 'Не удалось собрать документ' }])
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
  })

  it('папка по умолчанию — settings.mdExportDir', async () => {
    const { write } = recorder()
    const toDoc = vi.fn((it: Item): ExportDoc => ({ path: `${it.id}.md`, markdown: it.id }))

    await setSetting('mdExportDir', '')
    await expect(exportMarkdownToDir(items, toDoc, { write })).rejects.toThrow(
      'Не выбрана папка для экспорта Markdown',
    )
    expect(toDoc).not.toHaveBeenCalled()

    await setSetting('mdExportDir', 'E:\\Vault')
    const report = await exportMarkdownToDir(items, toDoc, { write })
    expect(report.dir).toBe('E:\\Vault')
    expect(write).toHaveBeenCalledTimes(3)
    expect(write.mock.calls.every(([dir]) => dir === 'E:\\Vault')).toBe(true)

    // явная папка важнее настройки, пустая явная — ошибка
    expect((await exportMarkdownToDir(items, toDoc, { write, dir: DIR })).dir).toBe(DIR)
    await expect(exportMarkdownToDir(items, toDoc, { write, dir: '' })).rejects.toThrow(
      'Не выбрана папка для экспорта Markdown',
    )
    await setSetting('mdExportDir', '')
  })

  it('отмена — «Экспорт отменён», toDoc больше не вызывается', async () => {
    const { write } = recorder()
    const controller = new AbortController()
    const toDoc = vi.fn((it: Item): ExportDoc => {
      if (it.id === 'a') controller.abort()
      return { path: `${it.id}.md`, markdown: it.id }
    })
    await expect(exportMarkdownToDir(items, toDoc, { dir: DIR, write, signal: controller.signal })).rejects.toThrow(
      'Экспорт отменён',
    )
    expect(toDoc).toHaveBeenCalledTimes(1)
    expect(write).not.toHaveBeenCalled()
  })
})
