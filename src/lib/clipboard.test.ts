import { describe, expect, it } from 'vitest'
import { filesFromClipboard, isRichTextPaste, pastedFiles } from './clipboard'

/** Минимальный DataTransfer: jsdom своего не даёт. */
function clip(data: Record<string, string>, files: File[] = [], viaItems = false) {
  const list = Object.assign([...files], { item: (i: number) => files[i] ?? null }) as unknown as FileList
  return {
    types: [...Object.keys(data), ...(files.length ? ['Files'] : [])],
    files: viaItems ? (Object.assign([], { item: () => null }) as unknown as FileList) : list,
    items: (viaItems
      ? files.map((f) => ({ kind: 'file', getAsFile: () => f }))
      : []) as unknown as DataTransferItemList,
    getData: (t: string) => data[t] ?? '',
  }
}

const png = () => new File([new Uint8Array([1])], 'image.png', { type: 'image/png' })
const doc = () => new File([new Uint8Array([1])], 'отчёт.docx', { type: 'application/vnd.openxmlformats' })

describe('вставка из буфера', () => {
  it('ячейки Excel (текст + html + PNG) — текст, не картинка', () => {
    const dt = clip({ 'text/plain': 'a\tb', 'text/html': '<table/>' }, [png()])
    expect(isRichTextPaste(dt, [png()], 'a\tb')).toBe(true)
    expect(pastedFiles(dt)).toEqual([])
  })

  it('скриншот без текста и файл из проводника с именем — файлы', () => {
    const shot = png()
    expect(pastedFiles(clip({}, [shot]))).toEqual([shot])
    const file = doc()
    expect(pastedFiles(clip({ 'text/plain': 'отчёт.docx' }, [file]))).toEqual([file])
    // не-картинка рядом с html — всё равно файл
    expect(pastedFiles(clip({ 'text/plain': 'x', 'text/html': '<b>x</b>' }, [file]))).toEqual([file])
  })

  it('картинка с текстом, но без html/rtf — файл', () => {
    const shot = png()
    expect(pastedFiles(clip({ 'text/plain': 'image.png' }, [shot]))).toEqual([shot])
  })

  it('файлы через items, если files пуст', () => {
    const shot = png()
    expect(filesFromClipboard(clip({}, [shot], true))).toEqual([shot])
  })
})
