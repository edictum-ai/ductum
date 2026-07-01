import type { RunActivity } from '@/api/client'

import { redactSensitiveText } from './run-activity-labels'

/**
 * Extracts the shell command from an activity so the UI can render it in a
 * bounded code surface instead of wrapped prose. Recognizes the event shapes
 * the harness and API actually produce today:
 *  - direct Bash tool calls, where `content` is either a JSON payload like
 *    `{"command": "..."}` (Claude-style) or a plain command string like
 *    `tail -40` (Codex app-server and the run-activity route).
 *  - approval requests to run a command, where `content` is either
 *    `approval requested: Bash {...}` or `approval requested: Bash git push`.
 *
 * Returns the redacted command string, or null when the activity is not a
 * bounded shell command (so callers keep their existing rendering). The
 * `BLOCKED:` prefix is left untouched so the activity tab's blocked branch
 * keeps owning that presentation.
 */
export function activityShellCommand(activity: RunActivity): string | null {
  // Restrict the direct-command path to `tool_call` so a Bash `tool_result`
  // (stdout of a command) is not misread as the command itself. Blocked
  // commands keep their dedicated red branch in the activity tab.
  if (activity.toolName === 'Bash' && activity.kind === 'tool_call') {
    const raw = activity.content.trim()
    if (raw !== '' && !raw.startsWith('BLOCKED:')) {
      const command = parseCommandField(raw)
      if (command) return redactSensitiveText(command)
    }
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
    // Not JSON — fall through so a plain command string is still bounded.
  }
  // Codex app-server, the canonical-events approval producer, and the
  // run-activity route tests all post the raw command as `content`. Treat
  // that trimmed string as the command so it lands in a CommandBlock too.
  return trimmed
}
