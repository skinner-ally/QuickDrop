import { describeError } from '@/lib/errors'

/** Зависимости CommitInput: берутся при каждой попытке (обработчики меняются от отрисовки к отрисовке). */
export interface CommitDeps {
  onCommit(v: string): Promise<void> | void
  validate?: (v: string) => string | null
  /** Отказ onCommit — под полем (setError), иначе — toastError. */
  inlineCommitError: boolean
  setError(msg: string | null): void
  saved(): void
  toastError(msg: string): void
}

export interface Committer {
  /**
   * Попытка сохранить черновик. force — осознанная повторная попытка (Enter): значение, отвергнутое раньше,
   * отправляется снова. Без force (потеря фокуса) отвергнутое только что значение не повторяется: иначе
   * blur сразу после неудачного Enter запускал бы ту же попытку второй раз.
   */
  commit(draft: string, value: string, force?: boolean): Promise<void>
  /** Черновик изменён, Esc или новое сохранённое значение: прежний отказ больше не действует. */
  reset(): void
}

export function createCommitter(deps: () => CommitDeps): Committer {
  let rejected: string | null = null
  /** Попытка уже идёт: частые Enter и blur во время неё не запускают параллельный onCommit. */
  let inFlight = false
  return {
    reset() {
      rejected = null
    },
    async commit(draft, value, force = false) {
      const d = deps()
      const v = draft.trim()
      if (v === value) {
        d.setError(null)
        return
      }
      if (inFlight) return
      if (!force && v === rejected) return
      const err = d.validate?.(v) ?? null
      d.setError(err)
      if (err) return
      inFlight = true
      try {
        await d.onCommit(v)
        rejected = null
        d.saved()
      } catch (e) {
        if (!d.inlineCommitError) {
          d.toastError(describeError(e))
          return
        }
        rejected = v
        d.setError(describeError(e))
      } finally {
        inFlight = false
      }
    },
  }
}
