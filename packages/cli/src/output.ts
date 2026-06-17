import { redactPublicOutput, redactPublicText } from '@ductum/core'

import { formatJson } from './format.js'

export type OutputMode = 'auto' | 'json' | 'ndjson' | 'human'
export type ResolvedOutputMode = Exclude<OutputMode, 'auto'>

export interface OutputFlags {
  json?: boolean
  ndjson?: boolean
  human?: boolean
}

export interface SchemaEnvelope<K extends string = string, D = unknown> {
  schemaVersion: 1
  kind: K
  data: D
  ts: string
}

export function resolveOutputMode(input: {
  flags?: OutputFlags
  env?: Record<string, string | undefined>
  stdoutIsTTY?: boolean
}): ResolvedOutputMode {
  const flagMode = modeFromFlags(input.flags ?? {})
  const configured =
    flagMode ??
    parseOutputMode(input.env?.DUCTUM_OUTPUT) ??
    'auto'
  return configured === 'auto'
    ? input.stdoutIsTTY === true ? 'human' : 'json'
    : configured
}

export function modeFromFlags(flags: OutputFlags): OutputMode | null {
  const enabled = [
    flags.json === true ? 'json' : null,
    flags.ndjson === true ? 'ndjson' : null,
    flags.human === true ? 'human' : null,
  ].filter((item): item is OutputMode => item != null)
  if (enabled.length > 1) {
    throw new Error('Choose only one output mode flag: --json, --ndjson, or --human')
  }
  return enabled[0] ?? null
}

export function parseOutputMode(value: string | undefined | null): OutputMode | null {
  const normalized = value?.trim().toLowerCase()
  if (
    normalized === 'auto' ||
    normalized === 'json' ||
    normalized === 'ndjson' ||
    normalized === 'human'
  ) {
    return normalized
  }
  return null
}

export function createEnvelope<K extends string, D>(
  kind: K,
  data: D,
  now: () => Date = () => new Date(),
): SchemaEnvelope<K, D> {
  return { schemaVersion: 1, kind, data, ts: now().toISOString() }
}

export function formatEnvelope<K extends string, D>(
  mode: ResolvedOutputMode,
  kind: K,
  data: D,
  human: string,
  now: () => Date = () => new Date(),
): string {
  if (mode === 'human') return ensureTrailingNewline(redactPublicText(human))
  const envelope = createEnvelope(kind, data, now)
  return mode === 'ndjson'
    ? `${JSON.stringify(redactPublicOutput(envelope))}\n`
    : `${formatJson(redactPublicOutput(envelope))}\n`
}

export function formatStreamClosed(reason = 'client_disconnect', now: () => Date = () => new Date()): string {
  return `${JSON.stringify(redactPublicOutput(createEnvelope('stream.closed', { reason }, now)))}\n`
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`
}
