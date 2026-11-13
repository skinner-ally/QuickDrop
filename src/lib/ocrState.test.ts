import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Item } from '@/types'
import {
  getOcrJob,
  getOcrNote,
  isScanPdf,
  isVisionBacklog,
  needsVision,
  ocrKindOf,
  resetOcrState,
  setOcrJob,
  setOcrNote,
  subscribeOcr,
  type OcrJob,
} from './ocrState'

type Fields = Parameters<typeof needsVision>[0]

const image = (patch: Partial<Item> = {}): Fields => ({
  type: 'image',
  mimeType: 'image/png',
  fileName: 'shot.png',
  fileId: 'f1',
  createdAt: 1000,
  ...patch,
})

const pdf = (patch: Partial<Item> = {}): Fields => ({
  type: 'file',
  mimeType: 'application/pdf',
  fileName: 'scan.pdf',
  fileId: 'f2',
  createdAt: 1000,
  ...patch,
})

afterEach(() => resetOcrState())

describe('ocrKindOf', () => {
  it('картинка и PDF с вложением; прочее — null', () => {
    expect(ocrKindOf(image())).toBe('image')
    expect(ocrKindOf(pdf())).toBe('pdf')
    // PDF узнаётся и по имени файла
    expect(ocrKindOf(pdf({ mimeType: 'application/octet-stream', fileName: 'Договор.PDF' }))).toBe('pdf')
    expect(ocrKindOf(image({ fileId: undefined }))).toBeNull()
    expect(ocrKindOf(pdf({ fileId: undefined }))).toBeNull()
    expect(ocrKindOf({ type: 'file', mimeType: 'text/plain', fileName: 'a.txt', fileId: 'f' })).toBeNull()
    expect(ocrKindOf({ type: 'text' })).toBeNull()
  })
})

describe('isScanPdf', () => {
  it('слой проверен и пуст — скан; не проверен — нет', () => {
    expect(isScanPdf(pdf())).toBe(false)
    expect(isScanPdf(pdf({ ocrAt: 5 }))).toBe(true)
    expect(isScanPdf(pdf({ ocrAt: 5, ocrText: '' }))).toBe(true)
  })
  it('текст слоя — не скан; текст зрением — скан', () => {
    expect(isScanPdf(pdf({ ocrAt: 5, ocrText: 'слой' }))).toBe(false)
    expect(isScanPdf(pdf({ ocrAt: 5, ocrVisionAt: 5, ocrText: 'зрение' }))).toBe(true)
  })
  it('картинка — не PDF', () => {
    expect(isScanPdf(image({ ocrAt: 5 }))).toBe(false)
  })
})

describe('needsVision', () => {
  it('картинка без текста и отметки — ждёт', () => {
    expect(needsVision(image())).toBe(true)
  })
  it('отметка, текст или корзина — не ждёт', () => {
    expect(needsVision(image({ ocrVisionAt: 1 }))).toBe(false)
    expect(needsVision(image({ ocrText: 'есть', ocrAt: 1 }))).toBe(false)
    expect(needsVision(image({ deletedAt: 1 }))).toBe(false)
  })
  it('PDF: только скан без отметки зрения', () => {
    expect(needsVision(pdf())).toBe(false) // слой ещё не проверен
    expect(needsVision(pdf({ ocrAt: 5 }))).toBe(true)
    expect(needsVision(pdf({ ocrAt: 5, ocrText: 'слой' }))).toBe(false)
    expect(needsVision(pdf({ ocrAt: 5, ocrVisionAt: 6 }))).toBe(false)
    expect(needsVision(pdf({ ocrAt: 5, deletedAt: 7 }))).toBe(false)
  })
  it('без вложения — не ждёт', () => {
    expect(needsVision(image({ fileId: undefined }))).toBe(false)
  })
})

describe('isVisionBacklog', () => {
  it('граница since: созданная ровно в since входит, раньше — нет', () => {
    expect(isVisionBacklog(image({ createdAt: 1000 }), 1000)).toBe(true)
    expect(isVisionBacklog(image({ createdAt: 1001 }), 1000)).toBe(true)
    expect(isVisionBacklog(image({ createdAt: 999 }), 1000)).toBe(false)
  })
  it('since = 0 (авто ни разу не включали) или негодное — задела нет', () => {
    expect(isVisionBacklog(image({ createdAt: 5 }), 0)).toBe(false)
    expect(isVisionBacklog(image({ createdAt: 5 }), Number.NaN)).toBe(false)
    expect(isVisionBacklog(image({ createdAt: 5 }), -1)).toBe(false)
  })
  it('корзина, отметка и текст исключают', () => {
    expect(isVisionBacklog(image({ createdAt: 2000, deletedAt: 3000 }), 1000)).toBe(false)
    expect(isVisionBacklog(image({ createdAt: 2000, ocrVisionAt: 2500 }), 1000)).toBe(false)
    expect(isVisionBacklog(pdf({ createdAt: 2000, ocrAt: 2100 }), 1000)).toBe(true)
    expect(isVisionBacklog(pdf({ createdAt: 2000 }), 1000)).toBe(false)
  })
  it('ocrAutoSkipAt (отмена пользователем, импорт) исключает из задела, но запись по-прежнему ждёт кнопки', () => {
    expect(isVisionBacklog(image({ createdAt: 2000, ocrAutoSkipAt: 2500 }), 1000)).toBe(false)
    expect(isVisionBacklog(pdf({ createdAt: 2000, ocrAt: 2100, ocrAutoSkipAt: 2200 }), 1000)).toBe(false)
    expect(needsVision(image({ createdAt: 2000, ocrAutoSkipAt: 2500 }))).toBe(true)
  })
})

describe('текст убрал пользователь (ocrClearedAt)', () => {
  it('PDF со слоем после «Очистить» — не скан: не ждёт зрения и не входит в задел', () => {
    const cleared = pdf({ createdAt: 2000, ocrAt: 5000, ocrClearedAt: 5000 })
    expect(isScanPdf(cleared)).toBe(false)
    expect(needsVision(cleared)).toBe(false)
    expect(isVisionBacklog(cleared, 1000)).toBe(false)
  })
  it('скан, распознанный зрением, после очистки остаётся сканом, но зрения не ждёт', () => {
    const cleared = pdf({ ocrAt: 5000, ocrVisionAt: 4000, ocrClearedAt: 5000 })
    expect(isScanPdf(cleared)).toBe(true)
    expect(needsVision(cleared)).toBe(false)
  })
  it('картинка с очищенным текстом без отметки зрения (старая копия) — авто её не берёт', () => {
    const cleared = image({ createdAt: 2000, ocrAt: 5000, ocrClearedAt: 5000 })
    expect(needsVision(cleared)).toBe(false)
    expect(isVisionBacklog(cleared, 1000)).toBe(false)
  })
})

describe('состояние сеанса', () => {
  it('задача: установка, стабильная ссылка, снятие', () => {
    const job: OcrJob = { phase: 'queued', manual: true }
    setOcrJob('a', job)
    expect(getOcrJob('a')).toBe(job)
    expect(getOcrJob('a')).toBe(getOcrJob('a'))
    expect(getOcrJob('b')).toBeUndefined()
    const next: OcrJob = { ...job, phase: 'running', page: 1, pages: 3 }
    setOcrJob('a', next)
    expect(getOcrJob('a')).toBe(next)
    setOcrJob('a', null)
    expect(getOcrJob('a')).toBeUndefined()
  })

  it('примечание: установка и снятие', () => {
    setOcrNote('a', { status: 'failed', error: 'Нет связи', at: 1 })
    expect(getOcrNote('a')).toEqual({ status: 'failed', error: 'Нет связи', at: 1 })
    setOcrNote('a', null)
    expect(getOcrNote('a')).toBeUndefined()
  })

  it('подписчики получают уведомления; снятие несуществующего — без уведомления; отписка', () => {
    const listener = vi.fn()
    const off = subscribeOcr(listener)
    setOcrJob('a', { phase: 'queued', manual: false })
    setOcrNote('a', { status: 'empty', at: 1 })
    expect(listener).toHaveBeenCalledTimes(2)
    setOcrJob('missing', null)
    setOcrNote('missing', null)
    expect(listener).toHaveBeenCalledTimes(2)
    setOcrJob('a', null)
    expect(listener).toHaveBeenCalledTimes(3)
    off()
    setOcrJob('a', { phase: 'running', manual: true })
    expect(listener).toHaveBeenCalledTimes(3)
    off()
  })

  it('ошибка одного подписчика не мешает остальным', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bad = subscribeOcr(() => {
      throw new Error('сбой')
    })
    const good = vi.fn()
    const off = subscribeOcr(good)
    setOcrJob('a', { phase: 'queued', manual: false })
    expect(good).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()
    bad()
    off()
    warn.mockRestore()
  })

  it('отписка прямо из уведомления не ломает рассылку', () => {
    const second = vi.fn()
    const offFirst = subscribeOcr(() => offFirst())
    const offSecond = subscribeOcr(second)
    setOcrJob('a', { phase: 'queued', manual: false })
    setOcrJob('a', null)
    expect(second).toHaveBeenCalledTimes(2)
    offSecond()
  })

  it('resetOcrState стирает всё и уведомляет, если было что стирать', () => {
    const listener = vi.fn()
    const off = subscribeOcr(listener)
    resetOcrState()
    expect(listener).not.toHaveBeenCalled()
    setOcrJob('a', { phase: 'queued', manual: false })
    setOcrNote('b', { status: 'empty', at: 1 })
    listener.mockClear()
    resetOcrState()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(getOcrJob('a')).toBeUndefined()
    expect(getOcrNote('b')).toBeUndefined()
    off()
  })
})
