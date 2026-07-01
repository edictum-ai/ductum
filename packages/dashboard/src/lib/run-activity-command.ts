import type { RunActivity } from '@/api/client'

import { redactSensitiveText } from './run-activity-labels'

/**
 * Extracts the shell command from an activity so the UI can render it in a
 * bounded code surface instead of wrapped prose. Recognizes:
 *  - direct Bash tool calls (`{"command": "...", ...}`)
 *  - approval requests to run a command (`approval requested: Bash {...}`)
 *
 * Returns the redacted command string, or null when the activity is not a
 * bounded shell command (so callers keep their existing rendering).
 */
export function activityShellCommand(activity: RunActivity): string | null {
  if (activity.toolName === 'Bash') {
    const command = parseCommandField(activity.content)
    if (command) return redactSensitiveText(command)
  }
  // Approval requests are free-text; mirror describeActivityMessage's parse so
  // the command is recovered with the same shape the activity labeler sees.
  const approval = activity.content.match(/^approval requested:\s*(\S+)?\s*([\s\S]*)$/i)
  if (approval) {
    const token = approval[1]
    const tokenIsPayload = token?.startsWith('{') || token?.startsWith('[')
    const tool = tokenIsPayload ? null : token
    if (tool === 'Bash') {
      const command = parseCommandField(approval[2] ?? '')
      if (command) return redactSensitiveText(command)
    }
  }
  return null
}

function parseCommandField(content: string): string | null {
  const trimmed = content.trim()
  if (trimmed === '') return null
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed != null && typeof parsed === 'object') {
      const command = (parsed as Record<string, unknown>).command
      if (typeof command === 'string' && command !== '') return command
    }
  } catch {
    // Not JSON — no command to bound.
  }
  return null
}
