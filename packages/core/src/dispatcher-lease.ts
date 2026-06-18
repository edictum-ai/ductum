import type { AttemptLease, FencingToken } from './attempt-lease.js'
import type { AttemptLeaseRepo } from './repos/interfaces.js'
import type { Run } from './types.js'

export function dispatchLeaseTtlMs(run: Run): number {
  return run.heartbeatTimeoutSeconds * 2_000
}

export function acquireDispatchLease(
  repo: AttemptLeaseRepo | undefined,
  run: Run,
  ownerProcessId: string,
  now: Date,
): AttemptLease | null {
  if (repo == null) return null
  return repo.acquire({
    attemptId: run.id,
    runId: run.id,
    sessionId: null,
    ownerProcessId,
    ttlMs: dispatchLeaseTtlMs(run),
    now,
  })
}

export function attachDispatchLeaseSession(
  repo: AttemptLeaseRepo | undefined,
  lease: AttemptLease | null,
  sessionId: string,
): AttemptLease | null {
  if (repo == null || lease == null) return lease
  return repo.attachSession(lease.attemptId, lease.fenceToken, sessionId)
}

export function renewDispatchLease(
  repo: AttemptLeaseRepo | undefined,
  run: Run,
  fenceToken: FencingToken | undefined,
  now: Date,
): AttemptLease | null {
  if (repo == null || fenceToken == null) return null
  return repo.renew({ runId: run.id, fenceToken, ttlMs: dispatchLeaseTtlMs(run), now })
}

export function releaseDispatchLease(
  repo: AttemptLeaseRepo | undefined,
  lease: AttemptLease | null | undefined,
  now: Date,
): void {
  if (repo == null || lease == null) return
  repo.release({ runId: lease.runId, fenceToken: lease.fenceToken, now })
}
