import type { Run } from '@ductum/core'

import type { ApiContext } from './deps.js'

export interface OrphanedRunState {
  staleSeconds: number
  timeoutSeconds: number
  logSuffix: string
  failureSuffix: string
  livenessSource: 'dispatcher' | 'fallback'
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
  }
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
