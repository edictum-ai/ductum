import type { RunActivity, RunUpdate } from '@ductum/core'

const REVIEW_VERDICT_RE = /^\s*(PASS|WARN|FAIL):/i

function isDuctumComplete(toolName: string | null): boolean {
  if (toolName == null) return false
  return (
    toolName === 'ductum.complete'
    || toolName === 'mcp__ductum__ductum_complete'
    || /(^|_|\.)ductum_complete$/.test(toolName)
  )
}

function parseToolCompletion(content: string): { text: string | null; explicit: boolean } {
  try {
    const parsed = JSON.parse(content) as { result?: unknown }
    if (typeof parsed.result === 'string' && parsed.result.trim() !== '') {
      return { text: parsed.result, explicit: true }
    }
  } catch {
    if (REVIEW_VERDICT_RE.test(content)) {
      return { text: content, explicit: true }
    }
    return { text: content.trim() === '' ? null : content, explicit: false }
  }

  if (REVIEW_VERDICT_RE.test(content)) {
    return { text: content, explicit: true }
  }
  return { text: null, explicit: false }
}

function countStructuredReviewContracts(text: string): number {
  if (text.trim() === '') return 0
  return extractJsonObjects(text)
    .map((value) => {
      try {
        return JSON.parse(value) as Record<string, unknown>
      } catch {
        return null
      }
    })
    .filter((value): value is Record<string, unknown> => {
      return value?.kind === 'ductum-review-result'
        && (value.verdict === 'pass' || value.verdict === 'warn' || value.verdict === 'fail')
        && typeof value.summary === 'string'
        && Array.isArray(value.findings)
    })
    .length
}

function collectStructuredReviewActivityText(activities: readonly RunActivity[]): string | null {
  const matches: string[] = []
  for (const activity of activities) {
    if (activity.kind === 'tool_call' && isDuctumComplete(activity.toolName)) continue
    if (countStructuredReviewContracts(activity.content) > 0) {
      matches.push(activity.content)
    }
  }
  if (matches.length === 0) return null
  return matches.join('\n\n')
}

function extractJsonObjects(text: string): string[] {
  const objects: string[] = []
  const fenced: Array<{ start: number; end: number; content: string }> = []
  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi
  let match: RegExpExecArray | null
  while ((match = fencePattern.exec(text)) != null) {
    const content = match[1]?.trim()
    if (content != null && content !== '') {
      fenced.push({ start: match.index, end: fencePattern.lastIndex, content })
      objects.push(content)
    }
  }

  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    if (fenced.some((range) => i >= range.start && i < range.end)) continue
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') { inString = true; continue }
    if (char === '{') { if (depth === 0) start = i; depth += 1; continue }
    if (char !== '}') continue
    depth -= 1
    if (depth === 0 && start >= 0) {
      objects.push(text.slice(start, i + 1))
      start = -1
    }
  }
  return objects
}

export function resolveReviewCompletionText(
  activities: readonly RunActivity[],
  updates: readonly RunUpdate[],
  completionSummary?: string | null,
): string | null {
  if (completionSummary != null && completionSummary.trim() !== '') {
    return completionSummary
  }

  for (const activity of [...activities].reverse()) {
    if (activity.kind !== 'tool_call' || !isDuctumComplete(activity.toolName)) continue
    const parsed = parseToolCompletion(activity.content)
    if (parsed.explicit || parsed.text != null) return parsed.text
  }

  const structuredActivityText = collectStructuredReviewActivityText(activities)
  if (structuredActivityText != null) return structuredActivityText

  for (const update of [...updates].reverse()) {
    if (REVIEW_VERDICT_RE.test(update.message)) return update.message
  }
  return null
}
