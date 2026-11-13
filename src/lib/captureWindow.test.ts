import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const state: {
    shown: ((e: { payload: unknown }) => void) | null
    focus: ((e: { payload: boolean }) => void) | null
  } = { shown: null, focus: null }
  const unlistenShown = vi.fn()
  const unlistenFocus = vi.fn()
  return {
    state,
    unlistenShown,
    unlistenFocus,
    hide: vi.fn().mockResolvedValue(undefined),
    isVisible: vi.fn().mockResolvedValue(true),
    listen: vi.fn(async (_event: string, h: (e: { payload: unknown }) => void) => {
      state.shown = h
      return unlistenShown
    }),
    onFocusChanged: vi.fn(async (h: (e: { payload: boolean }) => void) => {
      state.focus = h
      return unlistenFocus
    }),
  }
})

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ listen: mocks.listen, onFocusChanged: mocks.onFocusChanged }),
}))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ hide: mocks.hide, isVisible: mocks.isVisible }) }))
const invoke = vi.hoisted(() => vi.fn<(cmd: string) => Promise<unknown>>())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

import {
  CAPTURE_BLUR_DELAY_MS,
  CAPTURE_WINDOW_LABEL,
  capturePointerDown,
  createBlurHider,
  hideCaptureWindow,
  hideOnBlur,
  initCaptureWindow,
  isCaptureWindowVisible,
} from './captureWindow'

describe('константы', () => {
  it('метка окна и задержка по спецификации', () => {
    expect(CAPTURE_WINDOW_LABEL).toBe('capture')
    expect(CAPTURE_BLUR_DELAY_MS).toBe(150)
  })
})

describe('createBlurHider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('скрывает через задержку после потери фокуса', () => {
    const hide = vi.fn()
    const b = createBlurHider(hide)
    b.onFocusChange(false)
    vi.advanceTimersByTime(CAPTURE_BLUR_DELAY_MS - 1)
    expect(hide).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('не скрывает, если фокус вернулся до срока', () => {
    const hide = vi.fn()
    const b = createBlurHider(hide)
    b.onFocusChange(false)
    vi.advanceTimersByTime(100)
    b.onFocusChange(true)
    vi.advanceTimersByTime(1000)
    expect(hide).not.toHaveBeenCalled()
  })

  it('пока кнопка мыши зажата (перетаскивание файла), скрытие откладывается', async () => {
    const hide = vi.fn()
    let down = true
    const isPointerDown = vi.fn(async () => down)
    const b = createBlurHider(hide, CAPTURE_BLUR_DELAY_MS, isPointerDown)
    b.onFocusChange(false)
    await vi.advanceTimersByTimeAsync(CAPTURE_BLUR_DELAY_MS * 3)
    expect(isPointerDown).toHaveBeenCalledTimes(3)
    expect(hide).not.toHaveBeenCalled()
    down = false
    await vi.advanceTimersByTimeAsync(CAPTURE_BLUR_DELAY_MS)
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('фокус вернулся во время перетаскивания — проверки прекращаются, окно не скрывается', async () => {
    const hide = vi.fn()
    const isPointerDown = vi.fn(async () => true)
    const b = createBlurHider(hide, CAPTURE_BLUR_DELAY_MS, isPointerDown)
    b.onFocusChange(false)
    await vi.advanceTimersByTimeAsync(CAPTURE_BLUR_DELAY_MS)
    b.onFocusChange(true)
    isPointerDown.mockResolvedValue(false)
    const calls = isPointerDown.mock.calls.length
    await vi.advanceTimersByTimeAsync(CAPTURE_BLUR_DELAY_MS * 5)
    expect(isPointerDown).toHaveBeenCalledTimes(calls)
    expect(hide).not.toHaveBeenCalled()
  })

  it('ответ о кнопке, пришедший после возврата фокуса, не скрывает окно', async () => {
    const hide = vi.fn()
    let answer!: (v: boolean) => void
    const isPointerDown = vi.fn(() => new Promise<boolean>((r) => (answer = r)))
    const b = createBlurHider(hide, CAPTURE_BLUR_DELAY_MS, isPointerDown)
    b.onFocusChange(false)
    await vi.advanceTimersByTimeAsync(CAPTURE_BLUR_DELAY_MS)
    b.onFocusChange(true)
    answer(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(hide).not.toHaveBeenCalled()
  })

  it('ошибка проверки кнопки — скрывает как обычно', async () => {
    const hide = vi.fn()
    const b = createBlurHider(hide, CAPTURE_BLUR_DELAY_MS, () => Promise.reject(new Error('нет команды')))
    b.onFocusChange(false)
    await vi.advanceTimersByTimeAsync(CAPTURE_BLUR_DELAY_MS)
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('пауза (файл тащат над окном) — скрытия нет и без проверки кнопки', async () => {
    const hide = vi.fn()
    const isPointerDown = vi.fn(async () => false)
    const b = createBlurHider(hide, CAPTURE_BLUR_DELAY_MS, isPointerDown)
    b.onFocusChange(false)
    b.suspend()
    await vi.advanceTimersByTimeAsync(CAPTURE_BLUR_DELAY_MS * 4)
    expect(isPointerDown).not.toHaveBeenCalled()
    expect(hide).not.toHaveBeenCalled()
  })

  it('своя задержка', () => {
    const hide = vi.fn()
    const b = createBlurHider(hide, 40)
    b.onFocusChange(false)
    vi.advanceTimersByTime(40)
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('suspend: потеря фокуса на время системного диалога не скрывает', () => {
    const hide = vi.fn()
    const b = createBlurHider(hide)
    b.suspend()
    b.onFocusChange(false)
    vi.advanceTimersByTime(1000)
    expect(hide).not.toHaveBeenCalled()
  })

  it('suspend отменяет уже ожидающее скрытие', () => {
    const hide = vi.fn()
    const b = createBlurHider(hide)
    b.onFocusChange(false)
    vi.advanceTimersByTime(50)
    b.suspend()
    vi.advanceTimersByTime(1000)
    expect(hide).not.toHaveBeenCalled()
  })

  it('resume и возврат фокуса после диалога не скрывают', () => {
    const hide = vi.fn()
    const b = createBlurHider(hide)
    b.suspend()
    b.onFocusChange(false)
    b.resume() // событие поля файла пришло раньше события фокуса
    vi.advanceTimersByTime(CAPTURE_BLUR_DELAY_MS - 10)
    b.onFocusChange(true)
    vi.advanceTimersByTime(1000)
    expect(hide).not.toHaveBeenCalled()
  })

  it('resume без возврата фокуса: окно скрывается как при обычной потере фокуса', () => {
    const hide = vi.fn()
    const b = createBlurHider(hide)
    b.suspend()
    b.onFocusChange(false)
    b.resume()
    vi.advanceTimersByTime(CAPTURE_BLUR_DELAY_MS)
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('resume при сохранённом фокусе ничего не планирует', () => {
    const hide = vi.fn()
    const b = createBlurHider(hide)
    b.suspend()
    b.resume()
    vi.advanceTimersByTime(1000)
    expect(hide).not.toHaveBeenCalled()
  })

  it('после resume потеря фокуса снова скрывает окно', () => {
    const hide = vi.fn()
    const b = createBlurHider(hide)
    b.suspend()
    b.resume()
    b.onFocusChange(false)
    vi.advanceTimersByTime(CAPTURE_BLUR_DELAY_MS)
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('повторная потеря фокуса не множит скрытие', () => {
    const hide = vi.fn()
    const b = createBlurHider(hide)
    b.onFocusChange(false)
    b.onFocusChange(false)
    vi.advanceTimersByTime(1000)
    expect(hide).toHaveBeenCalledTimes(1)
  })

  it('dispose отменяет ожидающее скрытие и глушит дальнейшие события', () => {
    const hide = vi.fn()
    const b = createBlurHider(hide)
    b.onFocusChange(false)
    b.dispose()
    vi.advanceTimersByTime(1000)
    b.onFocusChange(false)
    b.resume()
    vi.advanceTimersByTime(1000)
    expect(hide).not.toHaveBeenCalled()
  })
})

describe('hideCaptureWindow', () => {
  it('прячет текущее окно', async () => {
    await hideCaptureWindow()
    expect(mocks.hide).toHaveBeenCalledTimes(1)
  })
})

describe('capturePointerDown', () => {
  it('ответ команды; ошибка или не boolean — false', async () => {
    invoke.mockResolvedValueOnce(true)
    expect(await capturePointerDown()).toBe(true)
    expect(invoke).toHaveBeenLastCalledWith('capture_pointer_down')
    invoke.mockResolvedValueOnce(false)
    expect(await capturePointerDown()).toBe(false)
    invoke.mockResolvedValueOnce('да')
    expect(await capturePointerDown()).toBe(false)
    invoke.mockRejectedValueOnce('Command capture_pointer_down not found')
    expect(await capturePointerDown()).toBe(false)
  })
})

describe('isCaptureWindowVisible', () => {
  it('отдаёт состояние окна, при ошибке — false', async () => {
    mocks.isVisible.mockResolvedValueOnce(true)
    expect(await isCaptureWindowVisible()).toBe(true)
    mocks.isVisible.mockResolvedValueOnce(false)
    expect(await isCaptureWindowVisible()).toBe(false)
    mocks.isVisible.mockRejectedValueOnce(new Error('нет окна'))
    expect(await isCaptureWindowVisible()).toBe(false)
  })
})

describe('initCaptureWindow', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('подписывается через окно на capture-shown и фокус, отписка снимает обе', async () => {
    const onShown = vi.fn()
    const onFocusChange = vi.fn()
    const off = await initCaptureWindow({ onShown, blur: { onFocusChange } })
    expect(mocks.listen).toHaveBeenCalledWith('capture-shown', expect.any(Function))

    mocks.state.shown?.({ payload: null })
    expect(onShown).toHaveBeenCalledTimes(1)

    mocks.state.focus?.({ payload: false })
    expect(onFocusChange).toHaveBeenCalledWith(false)
    mocks.state.focus?.({ payload: true })
    expect(onFocusChange).toHaveBeenLastCalledWith(true)

    off()
    expect(mocks.unlistenShown).toHaveBeenCalledTimes(1)
    expect(mocks.unlistenFocus).toHaveBeenCalledTimes(1)
  })

  it('ошибка второй подписки снимает первую и пробрасывается', async () => {
    mocks.onFocusChanged.mockRejectedValueOnce(new Error('нет прав'))
    await expect(initCaptureWindow({ onShown: vi.fn(), blur: { onFocusChange: vi.fn() } })).rejects.toThrow('нет прав')
    expect(mocks.unlistenShown).toHaveBeenCalledTimes(1)
  })
})

describe('hideOnBlur', () => {
  it('форма не разрешает (файлы, сохранение) → запрос закрытия не вызывается вовсе', () => {
    // Запрос закрытия у формы с файлами переключает вопрос «Закрыть?»: при уходе фокуса его трогать нельзя.
    const requestClose = vi.fn()
    expect(hideOnBlur(() => false, requestClose)).toBe(false)
    expect(hideOnBlur(() => false, requestClose)).toBe(false)
    expect(requestClose).not.toHaveBeenCalled()
  })

  it('форма разрешает или её нет → обычный запрос закрытия', () => {
    const requestClose = vi.fn()
    expect(hideOnBlur(() => true, requestClose)).toBe(true)
    expect(hideOnBlur(null, requestClose)).toBe(true)
    expect(requestClose).toHaveBeenCalledTimes(2)
  })
})
