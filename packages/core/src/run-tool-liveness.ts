import type { Run, RunActivity } from './types.js'
import type { RunActivityRepo } from './repos/run-activity.js'

export interface InFlightToolCall {
  toolName: string | null
  content: string
  createdAt: string
}

export function findInFlightToolCall(
  repo: RunActivityRepo | undefined,
  runId: Run['id'],
): InFlightToolCall | null {
  if (repo == null) return null
  const activities = repo.list(runId, 25)
  let pending: RunActivity | null = null
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index]
    if (activity?.kind === 'tool_result') return pending
    if (activity?.kind === 'tool_call' && pending == null) pending = activity
  }
  return pending == null
    ? null
    : { toolName: pending.toolName, content: pending.content, createdAt: pending.createdAt }
}

export function hasFreshRunHeartbeat(run: Run, now: Date): boolean {
  const iso = run.lastHeartbeat ?? run.createdAt
  const last = Date.parse(iso)
  return Number.isFinite(last)
    && now.getTime() - last <= run.heartbeatTimeoutSeconds * 1000
}

export function describeInFlightTool(call: InFlightToolCall | null): string | null {
  if (call == null) return null
  const prefix = call.toolName == null ? 'in-flight tool call' : `in-flight ${call.toolName}`
  return `${prefix}: ${call.content}`.trim()
}
