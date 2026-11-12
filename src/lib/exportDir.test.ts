import { describe, expect, it, vi } from 'vitest'
import { DESKTOP_ONLY_MESSAGE } from './desktop'
import type { SavedFile } from './desktop'
import { exportDocsToDir, exportMarkdownToDir, exportReportSummary, FOLDER_FAILURES_TO_STOP } from './exportDir'
import type { ExportDirReport, ExportDoc } from './exportDir'
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

  describe('ошибка на всю папку (нет доступа, нет места)', () => {
    const NO_SPACE = 'Не удалось записать файл: на диске не осталось места'
    const NO_ACCESS = 'Не удалось записать файл: нет доступа (папка защищена от записи или файл занят)'
    const many = (n: number): ExportDoc[] =>
      Array.from({ length: n }, (_, i) => ({ path: `${i + 1}.md`, markdown: `заметка ${i + 1}` }))

    it(`${FOLDER_FAILURES_TO_STOP} отказа подряд прерывают выгрузку, записанное до них — в отчёте`, async () => {
      const { write, paths } = recorder((path) => (Number(path.split('.')[0]) > 2 ? new Error(NO_SPACE) : undefined))
      const onProgress = vi.fn()
      const report = await exportDocsToDir(DIR, many(10), { write, onProgress })
      expect(paths()).toEqual(['1.md', '2.md'])
      expect(write).toHaveBeenCalledTimes(2 + FOLDER_FAILURES_TO_STOP)
      expect(report.docs).toBe(2)
      expect(report.stopped).toBe(NO_SPACE)
      expect(report.failed).toHaveLength(FOLDER_FAILURES_TO_STOP)
      // ход выгрузки после остановки не сообщается
      expect(onProgress).toHaveBeenLastCalledWith(2 + FOLDER_FAILURES_TO_STOP - 1, 10)
    })

    it('ничего не записано — ошибка вместо отчёта «Готово: заметок 0»', async () => {
      const { write } = recorder(() => new Error(NO_ACCESS))
      await expect(exportDocsToDir(DIR, many(10), { write })).rejects.toThrow(NO_ACCESS)
      expect(write).toHaveBeenCalledTimes(FOLDER_FAILURES_TO_STOP)
    })

    it('остановка посреди вложений одного документа: сам документ не пишется', async () => {
      const { write, paths } = recorder((path) => (path.startsWith('attachments/') ? new Error(NO_SPACE) : undefined))
      const doc: ExportDoc = {
        path: 'с вложениями.md',
        markdown: 'x',
        attachments: ['a', 'b', 'c', 'd'].map((n) => ({ path: `attachments/${n}.bin`, blob: new Blob([n]) })),
      }
      const report = await exportDocsToDir(DIR, [many(1)[0], doc, many(2)[1]], { write })
      expect(paths()).toEqual(['1.md'])
      expect(report.stopped).toBe(NO_SPACE)
      expect(report.failed.map((f) => f.path)).toEqual(['attachments/a.bin', 'attachments/b.bin', 'attachments/c.bin'])
    })

    it('удачная запись между отказами и отказ другого рода сбрасывают счёт', async () => {
      const failing = new Set(['1.md', '2.md', '4.md', '5.md', '7.md', '8.md'])
      const { write } = recorder((path) =>
        failing.has(path) ? new Error(path === '5.md' ? 'Недопустимое имя файла: 5.md' : NO_ACCESS) : undefined,
      )
      const report = await exportDocsToDir(DIR, many(9), { write })
      expect(report.stopped).toBeUndefined()
      expect(report.docs).toBe(3)
      expect(report.failed).toHaveLength(6)
    })

    it('сбой чтения вложения счёт не меняет', async () => {
      const { write } = recorder((path) => (path.endsWith('.md') ? new Error(NO_SPACE) : undefined))
      const doc = (n: number): ExportDoc => ({
        path: `${n}.md`,
        markdown: 'x',
        attachments: [{ path: `attachments/${n}.bin`, fileId: 'нет' }],
      })
      // отказы записи: 1.md, 2.md; между ними — только сбои чтения вложений
      await expect(exportDocsToDir(DIR, [doc(1), doc(2), doc(3)], { write, loadFile: noFiles })).rejects.toThrow(
        NO_SPACE,
      )
    })
  })

  it('exportReportSummary: итог одной строкой', () => {
    const base: ExportDirReport = { dir: DIR, docs: 3, attachments: 1, bytes: 2048, failed: [] }
    const failed = [{ path: 'a.md', error: 'x' }]
    expect(exportReportSummary(base)).toBe('Готово: заметок 3, вложений 1, 2 КБ')
    expect(exportReportSummary({ ...base, failed })).toBe('Готово с ошибками: заметок 3, вложений 1, 2 КБ')
    expect(exportReportSummary({ ...base, docs: 0, attachments: 0, bytes: 0, failed })).toBe('Ничего не записано')
    expect(exportReportSummary({ ...base, failed, stopped: 'Не удалось записать файл: на диске не осталось места' })).toBe(
      'Экспорт прерван. Не удалось записать файл: на диске не осталось места. Записано: заметок 3, вложений 1, 2 КБ',
    )
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
