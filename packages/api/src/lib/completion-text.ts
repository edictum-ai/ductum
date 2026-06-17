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
    break
  }

  for (const update of [...updates].reverse()) {
    if (REVIEW_VERDICT_RE.test(update.message)) return update.message
  }
  return null
}
