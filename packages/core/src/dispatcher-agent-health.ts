import type { Agent, AgentId } from './types.js'

export const AGENT_FAILURE_WINDOW_MS = 10 * 60_000
export const AGENT_FAILURE_THRESHOLD = 3
export const AGENT_UNHEALTHY_COOLDOWN_MS = 5 * 60_000

const RECOVERABLE_AGENT_FAILURE_PATTERNS = [
  /\bprompt_overflow\b/i,
  /\bmax_turns_reached\b/i,
  /prompt is too long/i,
  /model .*not found/i,
  /not found.*model/i,
  /selected model .* may not exist/i,
  /unsupported model/i,
  /\bauth(?:entication)?\b.*(?:expired|invalid|failed)/i,
  /(?:expired|invalid).*\bauth(?:entication)?\b/i,
  /\bunauthorized\b|\bforbidden\b|\b401\b|\b403\b/i,
  /network .*refused/i,
  /connection refused/i,
  /\bECONNREFUSED\b|\bECONNRESET\b|\bETIMEDOUT\b/i,
] as const

export interface AgentFailureEntry {
  atMs: number
  reason: string
}

export interface AgentHealthRecord {
  failures: AgentFailureEntry[]
  unhealthyUntilMs: number | null
  unhealthyReason: string | null
}

export interface AgentHealthState {
  agentId: AgentId
  agentName: string
  recentFailures: number
  unhealthy: boolean
  unhealthyUntil: string | null
  unhealthyReason: string | null
  lastFailureAt: string | null
}

export function createAgentHealthRecord(): AgentHealthRecord {
  return { failures: [], unhealthyUntilMs: null, unhealthyReason: null }
}

export function isRecoverableAgentFailure(reason: string): boolean {
  return RECOVERABLE_AGENT_FAILURE_PATTERNS.some((pattern) => pattern.test(reason))
}

export function pruneAgentHealthRecord(record: AgentHealthRecord, nowMs: number): void {
  record.failures = record.failures.filter((entry) => nowMs - entry.atMs <= AGENT_FAILURE_WINDOW_MS)
  if (record.unhealthyUntilMs != null && record.unhealthyUntilMs <= nowMs) {
    record.unhealthyUntilMs = null
    record.unhealthyReason = null
  }
}

export function hasAgentHealthRecordData(record: AgentHealthRecord): boolean {
  return record.failures.length > 0 || record.unhealthyUntilMs != null
}

export function toAgentHealthState(
  agent: Agent,
  record: AgentHealthRecord | null,
  nowMs: number,
): AgentHealthState {
  const unhealthy = record?.unhealthyUntilMs != null && record.unhealthyUntilMs > nowMs
  const lastFailureAt = record?.failures.at(-1)?.atMs ?? null
  return {
    agentId: agent.id,
    agentName: agent.name,
    recentFailures: record?.failures.length ?? 0,
    unhealthy,
    unhealthyUntil: unhealthy ? new Date(record!.unhealthyUntilMs!).toISOString() : null,
    unhealthyReason: unhealthy ? record!.unhealthyReason : null,
    lastFailureAt: lastFailureAt == null ? null : new Date(lastFailureAt).toISOString(),
  }
}
