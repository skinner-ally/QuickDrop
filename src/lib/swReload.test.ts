import { describe, expect, it, vi } from 'vitest'
import { createReloadGate, isTextEntry, isUserBusy } from './swReload'

function el(props: Record<string, unknown>): Element {
  return props as unknown as Element
}

function makeGate(state: { busy: boolean; hidden: boolean }) {
  const reload = vi.fn()
  const onDeferred = vi.fn()
  const gate = createReloadGate({
    isBusy: () => state.busy,
    isHidden: () => state.hidden,
    reload,
    onDeferred,
  })
  return { gate, reload, onDeferred }
}

describe('isTextEntry', () => {
  it('поля ввода текста и contenteditable', () => {
    expect(isTextEntry(el({ tagName: 'INPUT', type: 'text' }))).toBe(true)
    expect(isTextEntry(el({ tagName: 'INPUT', type: 'search' }))).toBe(true)
    expect(isTextEntry(el({ tagName: 'INPUT', type: '' }))).toBe(true)
    expect(isTextEntry(el({ tagName: 'TEXTAREA' }))).toBe(true)
    expect(isTextEntry(el({ tagName: 'DIV', isContentEditable: true }))).toBe(true)
  })

  it('кнопки, флажки и пустой фокус — не ввод', () => {
    expect(isTextEntry(el({ tagName: 'INPUT', type: 'checkbox' }))).toBe(false)
    expect(isTextEntry(el({ tagName: 'INPUT', type: 'FILE' }))).toBe(false)
    expect(isTextEntry(el({ tagName: 'BUTTON' }))).toBe(false)
    expect(isTextEntry(el({ tagName: 'BODY', isContentEditable: false }))).toBe(false)
    expect(isTextEntry(null)).toBe(false)
  })
})

describe('isUserBusy', () => {
  const doc = (active: Element | null, dialog = false) => ({
    activeElement: active,
    querySelector: () => (dialog ? el({ tagName: 'DIV' }) : null),
  })

  it('открытая панель добавления, фокус в поле или открытый диалог', () => {
    expect(isUserBusy(doc(null), true)).toBe(true)
    expect(isUserBusy(doc(el({ tagName: 'TEXTAREA' })), false)).toBe(true)
    expect(isUserBusy(doc(null, true), false)).toBe(true)
  })

  it('ничего не вводится', () => {
    expect(isUserBusy(doc(el({ tagName: 'BODY' })), false)).toBe(false)
  })
})

describe('createReloadGate', () => {
  it('без ввода перезагружает сразу', () => {
    const { gate, reload, onDeferred } = makeGate({ busy: false, hidden: false })
    gate.request()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(onDeferred).not.toHaveBeenCalled()
    expect(gate.pending).toBe(false)
  })

  it('во время ввода откладывает и перезагружает, только когда страница скрыта и ввода нет', () => {
    const state = { busy: true, hidden: false }
    const { gate, reload, onDeferred } = makeGate(state)
    gate.request()
    expect(reload).not.toHaveBeenCalled()
    expect(onDeferred).toHaveBeenCalledTimes(1)
    expect(gate.pending).toBe(true)

    // ввод закончен, но страница на экране — не мешаем
    state.busy = false
    gate.retry()
    expect(reload).not.toHaveBeenCalled()

    // страница скрыта, но в поле остался текст
    state.busy = true
    state.hidden = true
    gate.retry()
    expect(reload).not.toHaveBeenCalled()

    state.busy = false
    gate.retry()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(gate.pending).toBe(false)

    gate.retry()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('повторное обновление во время ожидания не дублирует предложение', () => {
    const { gate, onDeferred } = makeGate({ busy: true, hidden: false })
    gate.request()
    gate.request()
    expect(onDeferred).toHaveBeenCalledTimes(1)
  })

  it('retry без ожидающего обновления ничего не делает', () => {
    const { gate, reload } = makeGate({ busy: false, hidden: true })
    gate.retry()
    expect(reload).not.toHaveBeenCalled()
  })
})
