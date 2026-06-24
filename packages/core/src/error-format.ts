export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (error == null) return String(error)
  const json = safeJson(error)
  return json ?? String(error)
}

function safeJson(value: unknown): string | null {
  try {
    return JSON.stringify(value, replaceCircular())
  } catch {
    return null
  }
}

function replaceCircular() {
  const seen = new WeakSet<object>()
  return (_key: string, value: unknown) => {
    if (value == null || typeof value !== 'object') return value
    if (seen.has(value as object)) return '[Circular]'
    seen.add(value as object)
    return value
  }
}
