import { describe, expect, it, vi } from 'vitest'
import { createCommitter, type CommitDeps } from './commitInput'

function setup(over: Partial<CommitDeps> = {}) {
  const state = { error: null as string | null }
  const deps: CommitDeps = {
    onCommit: vi.fn<(v: string) => Promise<void>>(),
    inlineCommitError: true,
    setError: (m) => {
      state.error = m
    },
    saved: vi.fn(),
    toastError: vi.fn(),
    ...over,
  }
  return { c: createCommitter(() => deps), deps, state }
}

describe('createCommitter', () => {
  it('Enter после отказа — повторная попытка; blur сразу после отказа — нет', async () => {
    const onCommit = vi
      .fn<(v: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('Порт 5000 занят другой программой'))
      .mockResolvedValueOnce(undefined)
    const { c, deps, state } = setup({ onCommit })
    await c.commit('5000', '47821', true) // Enter
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(state.error).toBe('Порт 5000 занят другой программой')
    await c.commit('5000', '47821') // blur после Enter
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(state.error).toBe('Порт 5000 занят другой программой')
    await c.commit('5000', '47821', true) // порт освободили, снова Enter
    expect(onCommit).toHaveBeenCalledTimes(2)
    expect(state.error).toBeNull()
    expect(deps.saved).toHaveBeenCalledTimes(1)
  })

  it('после reset (правка текста, Esc) blur снова пробует', async () => {
    const onCommit = vi.fn<(v: string) => Promise<void>>().mockRejectedValue(new Error('занято'))
    const { c } = setup({ onCommit })
    await c.commit('Alt+Q', 'Alt+N', true)
    c.reset()
    await c.commit('Alt+Q', 'Alt+N')
    expect(onCommit).toHaveBeenCalledTimes(2)
  })

  it('пока попытка идёт, повторные Enter и blur не запускают вторую', async () => {
    let release!: () => void
    const onCommit = vi.fn<(v: string) => Promise<void>>(() => new Promise<void>((r) => (release = r)))
    const { c } = setup({ onCommit })
    const first = c.commit('5000', '47821', true)
    await c.commit('5000', '47821', true)
    await c.commit('5000', '47821')
    expect(onCommit).toHaveBeenCalledTimes(1)
    release()
    await first
  })

  it('то же значение — без вызова; ошибка проверки — без вызова', async () => {
    const { c, deps, state } = setup({ validate: (v) => (v === 'x' ? 'Неверно' : null) })
    await c.commit(' 47821 ', '47821', true)
    expect(deps.onCommit).not.toHaveBeenCalled()
    await c.commit('x', '47821', true)
    expect(deps.onCommit).not.toHaveBeenCalled()
    expect(state.error).toBe('Неверно')
  })

  it('без inlineCommitError отказ уходит во всплывающее сообщение', async () => {
    const onCommit = vi.fn<(v: string) => Promise<void>>().mockRejectedValue(new Error('сбой'))
    const { c, deps, state } = setup({ onCommit, inlineCommitError: false })
    await c.commit('a', 'b')
    expect(deps.toastError).toHaveBeenCalledWith('сбой')
    expect(state.error).toBeNull()
  })
})
