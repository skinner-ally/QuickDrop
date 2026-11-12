import { afterEach, describe, expect, it } from 'vitest'
import { confirmDialog, useConfirm } from './confirm'

afterEach(() => {
  // Незакрытый вопрос не должен перетечь в следующий тест.
  useConfirm.getState().settle(false)
})

describe('confirmDialog', () => {
  it('показывает вопрос с подписями по умолчанию; «да» решает промис true и убирает вопрос', async () => {
    const answer = confirmDialog({ title: 'Удалить?', destructive: true })
    const { request } = useConfirm.getState()
    expect(request).toMatchObject({
      title: 'Удалить?',
      destructive: true,
      confirmLabel: 'Подтвердить',
      cancelLabel: 'Отмена',
    })
    expect(request?.id).toBeTypeOf('number')

    useConfirm.getState().settle(true)
    await expect(answer).resolves.toBe(true)
    expect(useConfirm.getState().request).toBeNull()
  })

  it('«нет» решает промис false; свои подписи сохраняются', async () => {
    const answer = confirmDialog({
      title: 'Очистить корзину?',
      description: 'Без возможности восстановления.',
      confirmLabel: 'Очистить',
      cancelLabel: 'Оставить',
    })
    expect(useConfirm.getState().request).toMatchObject({
      description: 'Без возможности восстановления.',
      confirmLabel: 'Очистить',
      cancelLabel: 'Оставить',
    })
    useConfirm.getState().settle(false)
    await expect(answer).resolves.toBe(false)
  })

  it('второй вопрос поверх первого: первый получает false, на экране — второй', async () => {
    const first = confirmDialog({ title: 'Первый' })
    const firstId = useConfirm.getState().request!.id
    const second = confirmDialog({ title: 'Второй' })
    await expect(first).resolves.toBe(false)

    const { request } = useConfirm.getState()
    expect(request?.title).toBe('Второй')
    expect(request?.id).not.toBe(firstId)

    useConfirm.getState().settle(true)
    await expect(second).resolves.toBe(true)
  })

  it('settle без вопроса ничего не делает; повторный settle не меняет ответ', async () => {
    expect(() => useConfirm.getState().settle(true)).not.toThrow()
    expect(useConfirm.getState().request).toBeNull()

    const answer = confirmDialog({ title: 'Вопрос' })
    useConfirm.getState().settle(false)
    useConfirm.getState().settle(true)
    await expect(answer).resolves.toBe(false)
    expect(useConfirm.getState().request).toBeNull()
  })
})
