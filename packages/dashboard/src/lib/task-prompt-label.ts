import type { Task } from '@/api/client'
import { classifyTaskKind } from '@/lib/task-kind'

/**
 * Derive a concise, scan-friendly label from a task's prompt when the
 * stored name is missing or redacted. Returns null when no safe heading
 * can be extracted so callers keep the existing id-backed fallback.
 *
 * Why this exists: Ductum-generated review/fix tasks (and impl tasks
 * whose name was redacted at the API boundary) used to render as
 * `IMPL task <short-id>` even when the prompt carried a safe objective
 * or original task heading. Operators could not tell cards apart.
 *
 * Safety contract:
 *   - Never returns a candidate label containing `[redacted]`.
 *   - Never returns a candidate label that looks secret-shaped (tokens, env
 *     assignments, hex/base64 blobs, GitHub/Google key shapes).
 *   - Never returns a label longer than MAX_LABEL_LEN.
 *   - For review/fix tasks, only derives from the `### Original Task`
 *     section so a malformed review prompt cannot leak the wrapper
 *     heading (`## Review Task`).
 */

const MAX_LABEL_LEN = 80

/**
 * Match the `### Original Task` section inside review/fix prompts.
 * Captures the section body up to the next same-or-higher heading or
 * end of text. Tolerant of `##`/`###`/`####` so it works after prompt
 * builders change depth.
 */
const ORIGINAL_TASK_PATTERN = /(?:^|\n)(#{2,4})\s+Original Task\s*\n([\s\S]*?)(?=\n\1\s|\n#{2,3}\s|$)/

const SECRET_SHAPED_PATTERNS: ReadonlyArray<RegExp> = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bgh[opsu]_[A-Za-z0-9]{16,}\b/i,
  /\bgithub_pat_[A-Za-z0-9_]{16,}\b/i,
  /\bAIza[0-9A-Za-z_-]{20,}\b/,
  /\b[A-Z0-9_]{4,}=(?:[A-Za-z0-9+/]{16,}={0,2}|[^\s]{16,})\b/,
  /\b[a-f0-9]{32,}\b/i,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/,
]

/**
 * Input shape accepted by the helper. Narrowed so callers can pass
 * partial fixtures in tests without constructing a full Task.
 */
export type TaskPromptLabelInput = Pick<Task, 'prompt' | 'name' | 'requiredRole'>

export function deriveTaskLabelFromPrompt(task: TaskPromptLabelInput): string | null {
  const prompt = task.prompt?.trim()
  if (prompt == null || prompt === '') return null

  const kind = classifyTaskKind(task)
  const loopKind = inferLoopKind(prompt, task, kind.kind)
  if (loopKind != null) {
    const heading = extractLoopHeading(prompt)
    if (heading == null) return null
    const prefix = loopKind === 'review' ? 'Review' : 'Fix'
    return `${prefix}: ${stripPriorityPrefix(heading)}`
  }
  return extractImplHeading(prompt)
}

function inferLoopKind(prompt: string, task: TaskPromptLabelInput, storedKind: 'impl' | 'review' | 'fix'): 'review' | 'fix' | null {
  if (storedKind === 'review' || storedKind === 'fix') return storedKind
  const firstHeading = firstPromptHeading(prompt)
  if (firstHeading == null) return null
  if (/^review task\b/i.test(firstHeading) && task.requiredRole === 'reviewer') return 'review'
  if (/^(fix task|warning cleanup task)\b/i.test(firstHeading) && task.requiredRole === 'builder') return 'fix'
  return null
}

function extractLoopHeading(prompt: string): string | null {
  const match = ORIGINAL_TASK_PATTERN.exec(prompt)
  if (match == null) return null
  return extractSafeHeading(match[2] ?? '')
}

function extractImplHeading(prompt: string): string | null {
  return extractSafeHeading(prompt)
}

function extractSafeHeading(text: string): string | null {
  if (text === '') return null
  const lines = text.split('\n')
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('```')) continue
    const match = /^#{1,6}\s+(.+)$/.exec(line)
    if (match == null) continue
    return sanitizeLabel(match[1]!.trim())
  }
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('```') || line.startsWith('#')) continue
    return sanitizeLabel(line)
  }
  return null
}

function sanitizeLabel(value: string): string | null {
  const text = value.trim()
  if (text === '' || hasRedactionMarker(text)) return null
  if (looksSecretShaped(text)) return null
  if (text.length <= MAX_LABEL_LEN) return text
  const shortened = text.slice(0, MAX_LABEL_LEN)
  const lastSpace = shortened.lastIndexOf(' ')
  const trimmed = lastSpace > 30 ? shortened.slice(0, lastSpace) : shortened
  const clean = trimmed.replace(/[\s,.;:|-]+$/, '').trim()
  return clean === '' ? null : `${clean}…`
}

function stripPriorityPrefix(heading: string): string {
  return heading.replace(/^P\d+\s*[:\-]\s*/, '').trim()
}

function firstPromptHeading(prompt: string): string | null {
  for (const rawLine of prompt.split('\n')) {
    const match = /^#{1,6}\s+(.+)$/.exec(rawLine.trim())
    if (match != null) return match[1]!.trim()
  }
  return null
}

function looksSecretShaped(text: string): boolean {
  for (const pattern of SECRET_SHAPED_PATTERNS) {
    if (pattern.test(text)) return true
  }
  return false
}

function hasRedactionMarker(value: string | null | undefined): boolean {
  const text = value ?? ''
  if (/\[redacted\]/i.test(text)) return true
  try {
    return /\[redacted\]/i.test(decodeURIComponent(text))
  } catch {
    return false
  }
}
