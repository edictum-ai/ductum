import { INTERNAL_PAYLOAD_KEYS, redactSensitiveText } from '@/lib/run-activity-labels'

const REDACTED_RECORD = { redacted: 'internal payload hidden' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && !Array.isArray(value) && typeof value === 'object'
}

function tryParseJson(value: string): unknown {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const first = trimmed[0]
  if (first !== '{' && first !== '[') return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return undefined
  }
}

function sanitizeValue(value: unknown): { value: unknown; removed: boolean } {
  if (Array.isArray(value)) {
    let removed = false
    const items = value.map((item) => {
      const sanitized = sanitizeValue(item)
      removed ||= sanitized.removed
      return sanitized.value
    })
    return { value: items, removed }
  }
  if (!isRecord(value)) {
    if (typeof value !== 'string') return { value, removed: false }
    const parsed = tryParseJson(value)
    if (parsed === undefined) return { value, removed: false }
    return sanitizeValue(parsed)
  }

  let removed = false
  const next: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (INTERNAL_PAYLOAD_KEYS.has(key)) {
      removed = true
      continue
    }
    const sanitized = sanitizeValue(entry)
    removed ||= sanitized.removed
    next[key] = sanitized.value
  }
  if (removed && Object.keys(next).length === 0) return { value: REDACTED_RECORD, removed }
  return { value: next, removed }
}

function sanitizeJsonText(value: string): string | null {
  const parsed = tryParseJson(value)
  if (parsed === undefined) return null
  const sanitized = sanitizeValue(parsed)
  return redactSensitiveText(sanitized.removed ? JSON.stringify(sanitized.value, null, 2) : value)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function redactInternalKeyText(value: string): string {
  let redacted = value
  for (const key of INTERNAL_PAYLOAD_KEYS) {
    const escaped = escapeRegex(key)
    redacted = redacted.replace(
      new RegExp(`(["'])${escaped}\\1\\s*:\\s*(["'])(?:\\\\.|(?!\\2).)*\\2`, 'g'),
      '"redacted":"internal payload hidden"',
    )
    redacted = redacted.replace(
      new RegExp(`(["'])${escaped}\\1\\s*:\\s*(?:-?\\d+(?:\\.\\d+)?|true|false|null)`, 'g'),
      '"redacted":"internal payload hidden"',
    )
  }
  return redacted
}

export function sanitizeActivityRaw(content: string): string {
  const sanitized = sanitizeJsonText(content)
  if (sanitized != null) return sanitized

  const approval = content.match(/^(approval requested:\s*)(?:(\S+)\s*)?([\s\S]*)$/i)
  if (approval) {
    const token = approval[2] ?? ''
    const tokenIsPayload = token.startsWith('{') || token.startsWith('[')
    const prefix = tokenIsPayload ? approval[1]! : `${approval[1]!}${token}${token ? ' ' : ''}`
    const payload = tokenIsPayload ? `${token}${approval[3] ? ` ${approval[3]}` : ''}` : approval[3] ?? ''
    const sanitizedPayload = sanitizeJsonText(payload)
    if (sanitizedPayload != null) return `${prefix}${sanitizedPayload}`
  }

  return redactSensitiveText(redactInternalKeyText(content))
}
