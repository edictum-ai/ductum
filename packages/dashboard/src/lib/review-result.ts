export interface ReviewResultSummary {
  verdict: string
  summary: string | null
  findings: string[]
}

export function parseReviewResultSummary(text: string): ReviewResultSummary | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed.kind !== 'ductum-review-result') return null
  const verdict = typeof parsed.verdict === 'string' && parsed.verdict.trim() !== ''
    ? parsed.verdict.trim().toUpperCase()
    : 'UNKNOWN'
  const summary = textValue(parsed.summary) ?? textValue(parsed.message) ?? textValue(parsed.result)
  const findings = [
    ...findingValues(parsed.findings),
    ...findingValues(parsed.blockingFindings),
    ...findingValues(parsed.warnings),
  ]
  return { verdict, summary, findings }
}

function findingValues(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(findingText).filter((item): item is string => item != null)
}

function findingText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (!isRecord(value)) return null
  const parts = [
    textValue(value.severity),
    textValue(value.file),
    typeof value.line === 'number' ? String(value.line) : textValue(value.line),
    textValue(value.title) ?? textValue(value.message) ?? textValue(value.summary),
  ].filter((item): item is string => item != null && item.trim() !== '')
  return parts.length > 0 ? parts.join(' · ') : null
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null
}
