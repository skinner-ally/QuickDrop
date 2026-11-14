/** Передача двоичных данных командам Rust частями. Без импортов Tauri: модуль тестируется в node. */

export const IPC_ARGS_HEADER = 'x-qd-args'
export const IPC_CHUNK_BYTES = 8 * 1024 * 1024

export type InvokeFn = <T>(
  cmd: string,
  args?: Record<string, unknown> | Uint8Array,
  options?: { headers: Record<string, string> },
) => Promise<T>

/** JSON → значение заголовка (ASCII). */
export function encodeIpcArgs(args: Record<string, unknown>): string {
  // Значения заголовков обязаны быть ASCII, а пути бывают кириллические.
  return encodeURIComponent(JSON.stringify(args))
}

/** Строка ошибки из Rust → Error с тем же текстом; иное → Error(fallback). Error возвращается как есть. */
export function ipcError(e: unknown, fallback: string): Error {
  if (e instanceof Error) return e
  if (typeof e === 'string' && e.trim()) return new Error(e)
  return new Error(fallback)
}

export interface InvokeChunkedOptions {
  chunkBytes?: number
  fallback?: string
  signal?: AbortSignal
  /**
   * Убрать временный файл на стороне Rust, если передача оборвалась (отмена, сбой) после хотя бы одной
   * принятой части. Сбой уборки не заменяет исходную ошибку.
   */
  discard?: () => Promise<unknown>
}

/** Шлёт data частями; к args добавляет offset и last; возвращает ответ последней части. Отказ → ipcError. */
export async function invokeChunked<T>(
  invokeFn: InvokeFn,
  cmd: string,
  args: Record<string, unknown>,
  data: Blob,
  options: InvokeChunkedOptions = {},
): Promise<T> {
  const fallback = options.fallback ?? 'Не удалось записать файл'
  const requested = Math.floor(options.chunkBytes ?? IPC_CHUNK_BYTES)
  const chunkBytes = requested >= 1 ? requested : IPC_CHUNK_BYTES
  const total = data.size
  let offset = 0
  const abandon = async (error: Error): Promise<never> => {
    if (offset > 0 && options.discard) {
      try {
        await options.discard()
      } catch (e) {
        console.warn('[ipc] не удалось убрать временный файл', e)
      }
    }
    throw error
  }
  // Пустой файл — тоже один вызов: Rust должен создать его.
  for (;;) {
    if (options.signal?.aborted) return abandon(new Error('Отменено'))
    const end = Math.min(offset + chunkBytes, total)
    const last = end >= total
    try {
      const body = new Uint8Array(await data.slice(offset, end).arrayBuffer())
      const result = await invokeFn<T>(cmd, body, {
        headers: { [IPC_ARGS_HEADER]: encodeIpcArgs({ ...args, offset, last }) },
      })
      if (last) return result
    } catch (e) {
      return abandon(ipcError(e, fallback))
    }
    offset = end
  }
}
