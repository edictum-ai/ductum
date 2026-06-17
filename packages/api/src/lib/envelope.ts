export interface SchemaEnvelope<K extends string = string, D = unknown> {
  schemaVersion: 1
  kind: K
  data: D
  ts: string
}

export function envelope<K extends string, D>(
  kind: K,
  data: D,
  now: () => Date = () => new Date(),
): SchemaEnvelope<K, D> {
  return {
    schemaVersion: 1,
    kind,
    data,
    ts: now().toISOString(),
  }
}

export function listEnvelope<K extends string, T>(
  kind: K,
  items: T[],
  options: { nextCursor?: string | null; now?: () => Date } = {},
): SchemaEnvelope<K, { items: T[]; nextCursor?: string | null }> {
  return envelope(
    kind,
    options.nextCursor === undefined
      ? { items }
      : { items, nextCursor: options.nextCursor },
    options.now,
  )
}
