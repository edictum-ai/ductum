import { initCancelledError } from './errors.js'

export interface SigintGuard {
  signal: AbortSignal
  dispose: () => void
}

export function withSigintAbort(): SigintGuard {
  const controller = new AbortController()
  const onSigint = () => controller.abort()
  process.once('SIGINT', onSigint)
  return {
    signal: controller.signal,
    dispose: () => process.off('SIGINT', onSigint),
  }
}

export async function rejectOnAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw initCancelledError()
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(initCancelledError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw initCancelledError()
}
