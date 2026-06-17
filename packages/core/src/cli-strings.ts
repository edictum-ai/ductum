export function quoteCliArg(value: string) {
  return /^[A-Za-z0-9._:/=-]+$/.test(value) ? value : JSON.stringify(value)
}
