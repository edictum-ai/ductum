import type { Run } from '@ductum/core'

import type { ApiContext } from './deps.js'

export interface OrphanedRunState {
  staleSeconds: number
  timeoutSeconds: number
  logSuffix: string
  failureSuffix: string
  livenessSource: 'dispatcher' | 'fallback'
  disposition: 'dead-claim' | 'genuinely-stalled'
}

export function resolveOrphanedRun(
  context: ApiContext,
  run: Run,
  now: Date,
  fallbackTimeoutSeconds: number,
): OrphanedRunState | null {
  const lastHeartbeat = parseHeartbeat(run)
  if (lastHeartbeat == null) return null

  if (context.hasActiveSession?.(run.id) === true) return null
  const leaseDisposition = classifyLease(context, run, now)
  if (leaseDisposition === 'already-live') return null

  const livenessSource = context.hasActiveSession == null ? 'fallback' : 'dispatcher'
  const timeoutSeconds =
    livenessSource === 'dispatcher'
      ? normalizeHeartbeatTimeout(run.heartbeatTimeoutSeconds, fallbackTimeoutSeconds)
      : fallbackTimeoutSeconds
  const staleMilliseconds = now.getTime() - lastHeartbeat.getTime()
  if (staleMilliseconds < timeoutSeconds * 1000) return null

  return {
    staleSeconds: Math.floor(staleMilliseconds / 1000),
    timeoutSeconds,
    logSuffix: livenessSource === 'dispatcher' ? 'and no live session' : 'and dispatcher liveness is unavailable',
    failureSuffix: livenessSource === 'dispatcher' ? 'no live session' : 'dispatcher liveness unavailable',
    livenessSource,
    disposition: leaseDisposition,
  }
}

function classifyLease(
  context: ApiContext,
  run: Run,
  now: Date,
): 'already-live' | 'dead-claim' | 'genuinely-stalled' {
  const lease = context.repos.attemptLeases.getLatestForRun(run.id)
  if (lease == null) return 'genuinely-stalled'
  if (lease.status === 'active' && new Date(lease.expiresAt).getTime() > now.getTime()) {
    return 'already-live'
  }
  return lease.status === 'expired' || lease.status === 'active'
    ? 'dead-claim'
    : 'genuinely-stalled'
}

function parseHeartbeat(run: Run): Date | null {
  if (run.lastHeartbeat == null || run.lastHeartbeat === '') return null
  const parsed = new Date(run.lastHeartbeat)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function normalizeHeartbeatTimeout(timeoutSeconds: number, fallbackTimeoutSeconds: number): number {
  return Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
    ? Math.floor(timeoutSeconds)
    : fallbackTimeoutSeconds
}
