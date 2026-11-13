import { describe, expect, it } from 'vitest'
import { OCR_EDIT_MAX, OCR_VIEW_CHARS, type OcrJob, type OcrNote } from '@/lib/ocrState'
import type { Item } from '@/types'
import {
  OCR_SCAN_PDF_NOTE,
  charsLabel,
  isBlankOcrDraft,
  ocrBlockView,
  ocrJobLabel,
  ocrNetworkLine,
  visibleOcrText,
} from './ocrView'

const base: Item = {
  id: 'i1',
  type: 'image',
  title: '',
  content: '',
  categoryId: null,
  tags: [],
  links: [],
  status: 'inbox',
  favorite: 0,
  source: 'manual',
  createdAt: 1000,
  updatedAt: 1000,
  fileId: 'f1',
  fileName: 'shot.png',
  mimeType: 'image/png',
}
const image = (patch: Partial<Item> = {}): Item => ({ ...base, ...patch })
const pdf = (patch: Partial<Item> = {}): Item => ({
  ...base,
  type: 'file',
  fileName: 'doc.pdf',
  mimeType: 'application/pdf',
  ...patch,
})

const note = (status: OcrNote['status'], error?: string): OcrNote => ({ status, error, at: 5 })
const job = (patch: Partial<OcrJob> = {}): OcrJob => ({ phase: 'running', manual: true, ...patch })

describe('ocrBlockView: нет блока', () => {
  it('запись без вложения для распознавания', () => {
    expect(ocrBlockView({ ...base, type: 'text', fileId: undefined }, undefined, undefined, false).kind).toBe('none')
    expect(
      ocrBlockView({ ...base, type: 'file', mimeType: 'application/zip', fileName: 'a.zip' }, undefined, undefined, false)
        .kind,
    ).toBe('none')
    // даже при идущей задаче и тексте
    expect(ocrBlockView({ ...base, type: 'link', fileId: undefined, ocrText: 'x' }, job(), undefined, false).kind).toBe('none')
  })

  it('картинка при недоступном ИИ: блока нет', () => {
    expect(ocrBlockView(image(), undefined, undefined, true).kind).toBe('none')
    expect(ocrBlockView(image({ ocrVisionAt: 9 }), undefined, note('empty'), true).kind).toBe('none')
  })

  it('запись в корзине без текста и без задачи: блока нет', () => {
    expect(ocrBlockView(image({ deletedAt: 9 }), undefined, undefined, false).kind).toBe('none')
    expect(ocrBlockView(pdf({ deletedAt: 9 }), undefined, note('failed', 'сбой'), false).kind).toBe('none')
    expect(ocrBlockView(pdf({ deletedAt: 9, ocrAt: 3 }), undefined, undefined, true).kind).toBe('none')
  })
})

describe('ocrBlockView: задача', () => {
  it('задача важнее всего остального, в том числе текста и ошибки', () => {
    const v = ocrBlockView(image({ ocrText: 'старый' }), job({ phase: 'queued', cancel: () => {} }), note('failed', 'x'), false)
    expect(v).toEqual({ kind: 'job', label: 'В очереди…', cancellable: true })
  })

  it('подписи: очередь, запрос, страница n из m', () => {
    expect(ocrJobLabel({ phase: 'queued' })).toBe('В очереди…')
    expect(ocrJobLabel({ phase: 'running' })).toBe('Распознаётся…')
    expect(ocrJobLabel({ phase: 'running', page: 2, pages: 5 })).toBe('Распознаётся: страница 2 из 5…')
    expect(ocrJobLabel({ phase: 'running', page: 2 })).toBe('Распознаётся…')
  })

  it('«Отменить» — только если у задачи есть cancel', () => {
    expect(ocrBlockView(image(), job(), undefined, false)).toMatchObject({ kind: 'job', cancellable: false })
    expect(ocrBlockView(image(), job({ cancel: () => {} }), undefined, false)).toMatchObject({ cancellable: true })
  })

  it('задача показывается и у записи в корзине', () => {
    expect(ocrBlockView(image({ deletedAt: 1 }), job(), undefined, false).kind).toBe('job')
  })
})

describe('ocrBlockView: текст', () => {
  it('картинка с текстом при доступном ИИ: правка, очистка, «Распознать заново» со строкой о сети', () => {
    const v = ocrBlockView(image({ ocrText: 'привет', ocrAt: 1, ocrVisionAt: 1 }), undefined, undefined, false)
    expect(v).toEqual({
      kind: 'text',
      length: 6,
      readOnly: false,
      canEdit: true,
      tooLong: false,
      rerun: { label: 'Распознать заново', network: 'image' },
    })
  })

  it('картинка с текстом при выключенном ИИ: заново распознать нельзя, остальное есть', () => {
    const v = ocrBlockView(image({ ocrText: 'привет', ocrAt: 1, ocrVisionAt: 1 }), undefined, undefined, true)
    expect(v).toMatchObject({ kind: 'text', canEdit: true, rerun: null })
  })

  it('PDF с текстовым слоем: «Извлечь заново», сети нет — с ИИ и без него', () => {
    for (const blocked of [false, true]) {
      const v = ocrBlockView(pdf({ ocrText: 'слой', ocrAt: 1 }), undefined, undefined, blocked)
      expect(v).toMatchObject({ kind: 'text', rerun: { label: 'Извлечь заново', network: null } })
    }
  })

  it('PDF с текстом от зрения: «Распознать заново» с сетью PDF; без ИИ — кнопки нет', () => {
    const p = pdf({ ocrText: 'скан', ocrAt: 1, ocrVisionAt: 1 })
    expect(ocrBlockView(p, undefined, undefined, false)).toMatchObject({
      rerun: { label: 'Распознать заново', network: 'pdf' },
    })
    expect(ocrBlockView(p, undefined, undefined, true)).toMatchObject({ rerun: null })
  })

  it('корзина: только просмотр, без правки, очистки и повтора', () => {
    const v = ocrBlockView(image({ ocrText: 'x', ocrVisionAt: 1, deletedAt: 4 }), undefined, undefined, false)
    expect(v).toMatchObject({ kind: 'text', readOnly: true, canEdit: false, rerun: null })
    const p = pdf({ ocrText: 'x', ocrAt: 1, deletedAt: 4 })
    expect(ocrBlockView(p, undefined, undefined, false)).toMatchObject({ readOnly: true, canEdit: false, rerun: null })
  })

  it('readOnly снаружи (корзина в панели) равен корзине', () => {
    const v = ocrBlockView(image({ ocrText: 'x' }), undefined, undefined, false, true)
    expect(v).toMatchObject({ kind: 'text', readOnly: true, canEdit: false, rerun: null })
  })

  it('длинный текст: показ начала, правка доступна до OCR_EDIT_MAX включительно', () => {
    const at = (n: number) => ocrBlockView(image({ ocrText: 'a'.repeat(n) }), undefined, undefined, false)
    expect(at(OCR_VIEW_CHARS)).toMatchObject({ tooLong: false, canEdit: true })
    expect(at(OCR_VIEW_CHARS + 1)).toMatchObject({ tooLong: true, canEdit: true })
    expect(at(OCR_EDIT_MAX)).toMatchObject({ canEdit: true })
    expect(at(OCR_EDIT_MAX + 1)).toMatchObject({ tooLong: true, canEdit: false, readOnly: false })
  })

  it('текст важнее заметки об ошибке и «текста нет»', () => {
    expect(ocrBlockView(image({ ocrText: 'x' }), undefined, note('failed', 'сбой'), false).kind).toBe('text')
    expect(ocrBlockView(image({ ocrText: 'x' }), undefined, note('empty'), false).kind).toBe('text')
  })
})

describe('ocrBlockView: ошибка', () => {
  it('ошибка и «Повторить» со строкой о сети', () => {
    expect(ocrBlockView(image(), undefined, note('failed', 'Неверный API-ключ (401)'), false)).toEqual({
      kind: 'failed',
      error: 'Неверный API-ключ (401)',
      retry: { network: 'image' },
    })
    expect(ocrBlockView(pdf({ ocrAt: 1 }), undefined, note('failed', 'сбой'), false)).toMatchObject({
      retry: { network: 'pdf' },
    })
  })

  it('картинка без ИИ: ошибка видна, повторить нельзя; PDF — повтор локальный, без сети', () => {
    expect(ocrBlockView(image(), undefined, note('failed', 'сбой'), true)).toMatchObject({ kind: 'failed', retry: null })
    expect(ocrBlockView(pdf(), undefined, note('failed', 'сбой'), true)).toMatchObject({ retry: { network: null } })
  })

  it('пустой текст ошибки заменяется общим', () => {
    expect(ocrBlockView(image(), undefined, note('failed'), false)).toMatchObject({
      error: 'Не удалось распознать текст',
    })
  })
})

describe('ocrBlockView: «Текст не найден» и запуск', () => {
  it('картинка, ИИ доступен: пробовали (ocrVisionAt или note.empty) — «Текст не найден»', () => {
    expect(ocrBlockView(image({ ocrVisionAt: 1 }), undefined, undefined, false)).toEqual({ kind: 'empty', network: 'image' })
    expect(ocrBlockView(image(), undefined, note('empty'), false)).toEqual({ kind: 'empty', network: 'image' })
    expect(ocrBlockView(pdf({ ocrAt: 1, ocrVisionAt: 2 }), undefined, undefined, false)).toEqual({
      kind: 'empty',
      network: 'pdf',
    })
  })

  it('картинка, ИИ доступен, не пробовали — «Распознать текст» со строкой о сети', () => {
    expect(ocrBlockView(image(), undefined, undefined, false)).toEqual({
      kind: 'start',
      label: 'Распознать текст',
      network: 'image',
    })
  })

  it('PDF со слоем после «Очистить» (ocrAt есть, текста и ocrVisionAt нет) — «Извлечь текст», не «скан»', () => {
    const cleared = pdf({ ocrAt: 1, ocrText: undefined, ocrVisionAt: undefined })
    expect(ocrBlockView(cleared, undefined, undefined, true)).toEqual({
      kind: 'start',
      label: 'Извлечь текст',
      network: null,
    })
    expect(ocrBlockView(cleared, undefined, undefined, false)).toEqual({
      kind: 'start',
      label: 'Извлечь текст',
      network: 'pdf',
    })
  })

  it('скан PDF (слой проверен в этом сеансе, текста нет), ИИ доступен — «Текст не найден» с повтором', () => {
    expect(ocrBlockView(pdf({ ocrAt: 1 }), undefined, note('empty'), false)).toEqual({ kind: 'empty', network: 'pdf' })
  })

  it('скан PDF без ИИ — примечание о настройках: слой проверен (note.empty) или распознавали зрением', () => {
    expect(ocrBlockView(pdf({ ocrAt: 1 }), undefined, note('empty'), true)).toEqual({
      kind: 'note',
      text: OCR_SCAN_PDF_NOTE,
    })
    expect(ocrBlockView(pdf({ ocrAt: 1, ocrVisionAt: 2 }), undefined, undefined, true)).toEqual({
      kind: 'note',
      text: OCR_SCAN_PDF_NOTE,
    })
    expect(ocrBlockView(pdf({ ocrAt: 1, ocrVisionAt: 2 }), undefined, note('empty'), true).kind).toBe('note')
  })

  it('PDF без ocrAt — «Извлечь текст»; сеть указана, только если ИИ доступен', () => {
    expect(ocrBlockView(pdf(), undefined, undefined, false)).toEqual({
      kind: 'start',
      label: 'Извлечь текст',
      network: 'pdf',
    })
    expect(ocrBlockView(pdf(), undefined, undefined, true)).toEqual({
      kind: 'start',
      label: 'Извлечь текст',
      network: null,
    })
  })
})

describe('вспомогательные', () => {
  it('isBlankOcrDraft: пусто, пробелы, управляющие символы — пустой черновик', () => {
    expect(isBlankOcrDraft('')).toBe(true)
    expect(isBlankOcrDraft('  \n\t ')).toBe(true)
    expect(isBlankOcrDraft('\u0000 ')).toBe(true)
    expect(isBlankOcrDraft(' а ')).toBe(false)
  })

  it('ocrNetworkLine', () => {
    expect(ocrNetworkLine('image', 'api.openai.com')).toBe('Изображение будет отправлено на api.openai.com')
    expect(ocrNetworkLine('pdf', 'localhost:11434')).toBe(
      'Первые страницы (до 5) будут отправлены картинками на localhost:11434',
    )
  })

  it('charsLabel: склонение', () => {
    const plain = (n: number) => charsLabel(n).replace(/\s/g, ' ')
    expect(plain(1)).toBe('1 знак')
    expect(plain(2)).toBe('2 знака')
    expect(plain(5)).toBe('5 знаков')
    expect(plain(11)).toBe('11 знаков')
    expect(plain(14)).toBe('14 знаков')
    expect(plain(21)).toBe('21 знак')
    expect(plain(22)).toBe('22 знака')
    expect(plain(100)).toBe('100 знаков')
  })

  it('visibleOcrText: начало, весь текст, без разрыва суррогатной пары', () => {
    expect(visibleOcrText('abc', false)).toBe('abc')
    const long = 'a'.repeat(OCR_VIEW_CHARS + 50)
    expect(visibleOcrText(long, false)).toHaveLength(OCR_VIEW_CHARS)
    expect(visibleOcrText(long, true)).toBe(long)
    const pair = 'a'.repeat(OCR_VIEW_CHARS - 1) + '😀' + 'tail'
    const cut = visibleOcrText(pair, false)
    expect(cut).toHaveLength(OCR_VIEW_CHARS - 1)
    expect(cut.endsWith('a')).toBe(true)
  })
})
