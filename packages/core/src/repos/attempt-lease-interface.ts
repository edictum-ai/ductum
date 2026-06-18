import type {
  AcquireAttemptLeaseInput,
  AttemptLease,
  FencingToken,
  ReleaseAttemptLeaseInput,
  RenewAttemptLeaseInput,
} from '../attempt-lease.js'
import type { RunId } from '../types.js'

export interface AttemptLeaseRepo {
  acquire(input: AcquireAttemptLeaseInput): AttemptLease
  attachSession(attemptId: string, fenceToken: FencingToken, sessionId: string): AttemptLease
  renew(input: RenewAttemptLeaseInput): AttemptLease
  release(input: ReleaseAttemptLeaseInput): void
  expireRun(runId: RunId, now?: Date): void
  expireDueLeases(now?: Date): void
  assertCanWrite(runId: RunId, fenceToken: FencingToken, now?: Date): void
  getByAttemptId(attemptId: string): AttemptLease | null
  getByRunId(runId: RunId): AttemptLease[]
  getLatestForRun(runId: RunId): AttemptLease | null
  getActiveForRun(runId: RunId, now?: Date): AttemptLease | null
  getActiveForSession(sessionId: string, now?: Date): AttemptLease | null
}
