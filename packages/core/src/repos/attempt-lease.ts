import {
  StaleFenceError,
  type AcquireAttemptLeaseInput,
  type AttemptLease,
  type FencingToken,
  type ReleaseAttemptLeaseInput,
  type RenewAttemptLeaseInput,
} from '../attempt-lease.js'
import type { RunId } from '../types.js'
import { assertFound, toIsoString, type SqliteDatabase } from './utils.js'

interface AttemptLeaseRow {
  attempt_id: string
  run_id: string
  session_id: string | null
  owner_process_id: string
  fence_token: number
  status: AttemptLease['status']
  expires_at: string
  renewed_at: string
  released_at: string | null
  created_at: string
  updated_at: string
}

function mapLease(row: AttemptLeaseRow): AttemptLease {
  return {
    attemptId: row.attempt_id,
    runId: row.run_id as RunId,
    sessionId: row.session_id,
    ownerProcessId: row.owner_process_id,
    fenceToken: row.fence_token,
    status: row.status,
    expiresAt: toIsoString(row.expires_at) ?? row.expires_at,
    renewedAt: toIsoString(row.renewed_at) ?? row.renewed_at,
    releasedAt: toIsoString(row.released_at),
    createdAt: toIsoString(row.created_at) ?? row.created_at,
    updatedAt: toIsoString(row.updated_at) ?? row.updated_at,
  }
}

export class SqliteAttemptLeaseRepo {
  constructor(private readonly db: SqliteDatabase) {}

  acquire(input: AcquireAttemptLeaseInput): AttemptLease {
    const now = input.now ?? new Date()
    const expiresAt = new Date(now.getTime() + input.ttlMs)
    return this.db.transaction(() => {
      this.expireDueLeases(now)
      const active = this.getActiveForRun(input.runId, now)
      if (active != null) {
        if (active.attemptId === input.attemptId && active.ownerProcessId === input.ownerProcessId) {
          return active
        }
        throw new Error(`Run ${input.runId} already has active attempt lease ${active.attemptId}`)
      }
      const fenceToken = this.nextFenceToken()
      this.db
        .prepare(
          `
            INSERT INTO attempt_leases (
              attempt_id, run_id, session_id, owner_process_id, fence_token,
              status, expires_at, renewed_at, released_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL, ?)
            ON CONFLICT(attempt_id) DO UPDATE SET
              run_id = excluded.run_id,
              session_id = excluded.session_id,
              owner_process_id = excluded.owner_process_id,
              fence_token = excluded.fence_token,
              status = 'active',
              expires_at = excluded.expires_at,
              renewed_at = excluded.renewed_at,
              released_at = NULL,
              updated_at = excluded.updated_at
          `,
        )
        .run(
          input.attemptId,
          input.runId,
          input.sessionId ?? null,
          input.ownerProcessId,
          fenceToken,
          toSqliteTimestamp(expiresAt),
          toSqliteTimestamp(now),
          toSqliteTimestamp(now),
        )
      return assertFound(this.getByAttemptId(input.attemptId), `Attempt lease not created: ${input.attemptId}`)
    })()
  }

  attachSession(attemptId: string, fenceToken: FencingToken, sessionId: string): AttemptLease {
    this.assertCanWriteByAttempt(attemptId, fenceToken)
    this.db
      .prepare("UPDATE attempt_leases SET session_id = ?, updated_at = datetime('now') WHERE attempt_id = ?")
      .run(sessionId, attemptId)
    return assertFound(this.getByAttemptId(attemptId), `Attempt lease not found: ${attemptId}`)
  }

  renew(input: RenewAttemptLeaseInput): AttemptLease {
    const now = input.now ?? new Date()
    this.assertCanWrite(input.runId, input.fenceToken, now)
    const expiresAt = new Date(now.getTime() + input.ttlMs)
    this.db
      .prepare(
        `
          UPDATE attempt_leases
          SET expires_at = ?, renewed_at = ?, updated_at = ?
          WHERE run_id = ? AND fence_token = ? AND status = 'active'
        `,
      )
      .run(toSqliteTimestamp(expiresAt), toSqliteTimestamp(now), toSqliteTimestamp(now), input.runId, input.fenceToken)
    return assertFound(this.getByFence(input.runId, input.fenceToken), `Attempt lease not found for run ${input.runId}`)
  }

  release(input: ReleaseAttemptLeaseInput): void {
    const now = input.now ?? new Date()
    this.db
      .prepare(
        `
          UPDATE attempt_leases
          SET status = 'released', released_at = ?, updated_at = ?
          WHERE run_id = ? AND fence_token = ? AND status = 'active'
        `,
      )
      .run(toSqliteTimestamp(now), toSqliteTimestamp(now), input.runId, input.fenceToken)
  }

  expireRun(runId: RunId, now: Date = new Date()): void {
    this.db
      .prepare(
        `
          UPDATE attempt_leases
          SET status = 'expired', updated_at = ?
          WHERE run_id = ? AND status = 'active'
        `,
      )
      .run(toSqliteTimestamp(now), runId)
  }

  expireDueLeases(now: Date = new Date()): void {
    this.db
      .prepare(
        `
          UPDATE attempt_leases
          SET status = 'expired', updated_at = ?
          WHERE status = 'active' AND expires_at <= ?
        `,
      )
      .run(toSqliteTimestamp(now), toSqliteTimestamp(now))
  }

  assertCanWrite(runId: RunId, fenceToken: FencingToken, now: Date = new Date()): void {
    this.expireDueLeases(now)
    const lease = this.getByFence(runId, fenceToken)
    if (lease == null || lease.status !== 'active') {
      throw new StaleFenceError(runId, fenceToken)
    }
    if (new Date(lease.expiresAt).getTime() <= now.getTime()) {
      this.expireRun(runId, now)
      throw new StaleFenceError(runId, fenceToken, `Expired fence token ${fenceToken} rejected for run ${runId}`)
    }
  }

  getByAttemptId(attemptId: string): AttemptLease | null {
    const row = this.db
      .prepare('SELECT * FROM attempt_leases WHERE attempt_id = ?')
      .get(attemptId) as AttemptLeaseRow | undefined
    return row == null ? null : mapLease(row)
  }

  getByRunId(runId: RunId): AttemptLease[] {
    return this.db
      .prepare('SELECT * FROM attempt_leases WHERE run_id = ? ORDER BY fence_token DESC')
      .all(runId)
      .map((row) => mapLease(row as AttemptLeaseRow))
  }

  getLatestForRun(runId: RunId): AttemptLease | null {
    return this.getByRunId(runId)[0] ?? null
  }

  getActiveForRun(runId: RunId, now: Date = new Date()): AttemptLease | null {
    this.expireDueLeases(now)
    const row = this.db
      .prepare("SELECT * FROM attempt_leases WHERE run_id = ? AND status = 'active' ORDER BY fence_token DESC LIMIT 1")
      .get(runId) as AttemptLeaseRow | undefined
    return row == null ? null : mapLease(row)
  }

  getActiveForSession(sessionId: string, now: Date = new Date()): AttemptLease | null {
    this.expireDueLeases(now)
    const row = this.db
      .prepare("SELECT * FROM attempt_leases WHERE session_id = ? AND status = 'active' ORDER BY fence_token DESC LIMIT 1")
      .get(sessionId) as AttemptLeaseRow | undefined
    return row == null ? null : mapLease(row)
  }

  private assertCanWriteByAttempt(attemptId: string, fenceToken: FencingToken): void {
    const lease = this.getByAttemptId(attemptId)
    if (lease == null || lease.fenceToken !== fenceToken || lease.status !== 'active') {
      throw new StaleFenceError((lease?.runId ?? 'unknown') as RunId, fenceToken)
    }
  }

  private getByFence(runId: RunId, fenceToken: FencingToken): AttemptLease | null {
    const row = this.db
      .prepare('SELECT * FROM attempt_leases WHERE run_id = ? AND fence_token = ?')
      .get(runId, fenceToken) as AttemptLeaseRow | undefined
    return row == null ? null : mapLease(row)
  }

  private nextFenceToken(): FencingToken {
    const result = this.db.prepare('INSERT INTO attempt_fence_sequence DEFAULT VALUES').run()
    return Number(result.lastInsertRowid)
  }
}

function toSqliteTimestamp(value: Date): string {
  return value.toISOString().replace('T', ' ').replace('Z', '')
}
