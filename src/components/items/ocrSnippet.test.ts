import { describe, expect, it } from 'vitest'
import type { Item } from '@/types'
import { ocrMatchSnippet } from './ocrSnippet'

const scan: Item = {
  id: 'i1',
  type: 'file',
  title: '',
  content: '',
  categoryId: null,
  tags: [],
  links: [],
  status: 'inbox',
  favorite: 0,
  source: 'manual',
  createdAt: 1,
  updatedAt: 1,
  fileId: 'f1',
  fileName: 'scan.pdf',
  ocrText: 'Типовой договор аренды нежилого помещения от первого января',
}

describe('ocrMatchSnippet', () => {
  it('даёт фрагмент вокруг слова из распознанного текста', () => {
    expect(ocrMatchSnippet(scan, ['аренды'])).toContain('аренды')
  })
  it('без запроса или без текста пусто', () => {
    expect(ocrMatchSnippet(scan, [])).toBe('')
    expect(ocrMatchSnippet({ ...scan, ocrText: undefined }, ['аренды'])).toBe('')
  })
  it('совпадение только по имени файла: пусто', () => {
    expect(ocrMatchSnippet(scan, ['scan'])).toBe('')
  })
})
